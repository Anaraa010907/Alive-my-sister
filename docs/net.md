# TW.net — online transport (Network engineer)

Files: `js/config.js` (backend address), `js/net.js` (transport), `net-test.html` (manual test page), `tests/net/*.py` (Playwright).
Load order: `tw.js` → `config.js` → `net.js` → … → `game.js`. net.js only builds `TW.net` at load; nothing connects until `create()`/`join()`.

## API (docs/ARCHITECTURE-v2.md "TW.net contract")
| Call | Behaviour |
|---|---|
| `available()` | `true` if `WebSocket` exists (or `BroadcastChannel` with `?net=local`). |
| `await create()` | → 4-letter code from `ABCDEFGHJKLMNPQRSTUVWXYZ`; caller is host. Regenerates if the code is already in use. |
| `await join(code)` | Trims + uppercases. Rejects `Error('notfound')` (no host), `'full'` (2 already), `'offline'` (CDN/socket blocked, ~6 s), `'cancelled'` (leave() or a new create/join during the attempt). Resolves once the host has admitted this client. |
| `leave()` | Untrack, unsubscribe, remove channel. Idempotent. Emits `status {state:'idle'}` only if it was in a room; no local `peer` event. |
| `send(msg)` | Plain JSON to the other player only (never echoed). Returns `false` if not in a room. |
| `on/off('message'|'peer'|'status', fn)` | `message`: the msg object. `peer`: `{present, info}` on the other player's join / leave / info change. `status`: `{state, detail, …}`. |
| `setInfo(obj)` | Merged into my presence payload `{id, host, joinedAt, ...info}` (host also publishes `guest`); re-published within 30 ms. Call any time (before create/join too). |
| `peer()` | Other player's payload or `null`. |
| `code`, `isHost`, `connected` | Read-only. `connected` = in a room and the channel is subscribed (false while reconnecting). |
| extras | `transport` ('supabase'/'local'), `state`, `id`, `libVersion`, `_drop()` (test hook: simulate a lost channel). |

`status` values: `connecting` (detail `null`, or `'reconnect'` + `attempt` 1..3), `connected` (`'host'`/`'guest'`/`'reconnected'`, + `code`), `error` (`'offline'`/`'full'`/`'notfound'`/`'lost'`, optional `reason` text for logs), `idle`.
Note: a guest can also get `status error 'full'` *after* join resolved, if it lost a simultaneous-join race (see below); treat it like being kicked to the lobby.

## Message flow
- Supabase Realtime channel `two-worlds:<CODE>`, config `broadcast {self:false, ack:false}`, `presence {key:<random id per room session>}`. Every message is broadcast event `'m'` with payload `{f: senderId, m: msg}`.
- supabase-js **2.119.2** UMD is loaded lazily from `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.min.js` on the first create/join (`createClient(url, key, {realtime:{params:{eventsPerSecond:20}}, auth:{persistSession:false,…}})` — no storage access). One client per page.
- Seats: the **host admits** one guest (the one it has, else the earliest it sees) and publishes its id as `guest` in its presence. A joiner checks presence (host present? seat taken?), tracks itself, then waits (≤ 5 s, normally < 1 s) until the host lists it; a joiner the host did not admit leaves with `'full'`. No device clocks are compared. Supabase presence replicates between its servers with ~1–2 s delay, so join allows a missing host 3 s to appear before `'notfound'`.
- Send queue: ≤ 20 sends in any 1 s window, ≥ 50 ms apart. `t:'st'` is coalesced (one pending slot, latest wins) and an unchanged `st` is re-sent at most once per second; every other message is queued in order and never dropped (kept through a reconnect).
- Messages that arrive while my join is being confirmed are buffered and delivered right after `status connected`.
- Channel error/close while in a room → `connected=false`, up to 3 resubscribe attempts (1 s, 2 s, 4 s backoff; paused while the tab is hidden), re-track, flush queue. All fail → `status error 'lost'` + `peer {present:false}`.
- Failure to load the script or open the socket → `status error 'offline'` and rejected promise within ~6 s; nothing is thrown synchronously.
- `?net=local`: same API over `BroadcastChannel('two-worlds:'+code)` with presence emulation (hello / heartbeat 1 s / bye, member timeout 3 s). Two tabs on one computer.

## Switching to another Supabase project
Edit the two lines in `js/config.js`: `supabaseUrl` (Project URL) and `supabaseKey` (publishable `sb_publishable_…` or legacy anon key — never the secret/service_role key). Nothing else: no tables, functions or settings are used. Realtime must allow public channels (default).

## Limits (check the Supabase project's Realtime usage page)
- 2 players per room; codes are 24⁴ ≈ 330 k.
- Supabase counts a broadcast as 1 (send) + 1 per receiver. The engine sends `st` at ~10 Hz per moving player, so a room with both players moving costs ~40 counted messages/s (standing still ≈ 2–4/s thanks to the keepalive rule).
- Free plan: 100 messages/s, 200 concurrent connections, 20 presence messages/s, 256 KB per broadcast, 2 M messages/month — i.e. only ~2 rooms moving at the same time and roughly 14 hours of both-moving play per month, **shared with the other game on this project**. Pro: 500 msg/s, 5 M/month included. If this gets tight: lower the engine's `st` rate (e.g. 6 Hz) or move to its own project.
- Payloads should stay small (current messages < 0.5 KB).

## Tests
`python3 tests/net/test_net_local.py` (BroadcastChannel: create/join, peer events, ping both ways, coalescing, rate, full/notfound, reconnect, leave, heartbeat timeout) and `python3 tests/net/test_net_real.py` (real Supabase: same flow + join race + reconnect; forced CDN-blocked and socket-blocked cases). Both start and stop their own `http.server`.
Manual: open `net-test.html` on two devices (Create on one, Join on the other, Send ping shows RTT), or two tabs with `net-test.html?net=local`.
