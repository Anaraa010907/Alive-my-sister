# Хоёр ертөнц — v2 contracts: landscape, one world per screen, online, puzzles

Read docs/ARCHITECTURE.md first; everything there still holds unless changed here.

## What changed (product decision by the owner)
1. **Always landscape.** Phones in portrait get a rotate overlay and the game pauses.
2. **Each screen shows only ONE world.** No split screen, no partner echo, no partner markers. The brother's player sees only the living world; the sister's player only the world of the dead. What is on the other screen is secret — players must **talk** (phone call / Discord in v1, no in-game voice yet) to coordinate.
3. **Two modes.**
   - `solo` — one device: the engine simulates both worlds; the screen shows only the active character's world; ⇅ switches the whole view to the other world.
   - `online` — two devices: each device is one role (0 = brother, 1 = sister) and shows only its world.
4. **Puzzle mini-games.** Some tasks are passed by solving a small asymmetric puzzle: one player has the device (solver), the other player has the clue in their world. Wrong answer = loud noise that wakes enemies.

## Online authority & messages (engine implements; net.js only transports)
Each client is authoritative for **its own world**: its character, every object whose `world` equals its role, and the enemies in its world. Crates (world 0) are owned by the brother's client; the sister's client only mirrors their x,y for the shadow.
Messages (plain JSON objects, `TW.net.send(msg)`):
- `{t:'start', chapter, seed}` host → guest: both start the chapter with the same seed.
- `{t:'st', x, y, vx, face, onGround, dying, crates:[[id,x,y,respawn]]}` own character state, ~5 Hz (saves Supabase quota; the receiver interpolates).
- `{t:'trig', id}` an object in my world (lever, solved puzzle) turned on target `id` in the other world.
- `{t:'held', id, v}` a plate in my world is held/released for target `id` in the other world.
- `{t:'call', x, y}` I called ◎ → receiver adds an echo noise (r 260) and a faint ripple at x.
- `{t:'death', who}` for stats. `{t:'exit'}` host saw both characters at the exit → both play the ending.
- `{t:'restart'}`, `{t:'pause', v}`, `{t:'menu'}`.

## TW.net contract — `js/net.js` + `js/config.js` (Network engineer)
```js
TW.config = { supabaseUrl: '...', supabaseKey: 'sb_publishable_...' };   // js/config.js
TW.net = {
  available(),          // true if a transport can be used
  async create(),       // → room code (4 letters, no I/O/0/1 lookalikes); caller is host
  async join(code),     // resolves when joined; rejects Error('full'|'notfound'|'offline')
  leave(),
  send(msg),            // to the other player only (not echoed back)
  on(event, fn), off(event, fn), // 'message' (msg), 'peer' ({present, info}), 'status' ({state:'idle'|'connecting'|'connected'|'error', detail})
  setInfo(obj),         // my presence payload, e.g. {role:0, ready:true}
  peer(),               // other player's presence info or null
  code, isHost, connected
};
```
Transports: **Supabase Realtime** broadcast + presence on channel `two-worlds:<CODE>` (supabase-js v2 UMD from cdn.jsdelivr.net, exact pinned version; `broadcast: { self: false }`), and **BroadcastChannel** when the page URL has `?net=local` (two tabs on one computer — for testing). Max 2 players (presence count). Peer leave detected via presence. No database tables, no edge functions.

## Engine API additions (lead implements in game.js)
`game.startSolo(id)` (= old startChapter), `game.startOnline(id)` (host only; sends start), `game.mode()` → 'solo'|'online', `game.role()` → 0|1|null, `game.leaveOnline()`.
Events: `onlineStart {chapter, role}`, `peer {present}`, plus the old ones.

## Lobby & screens — UI/UX designer (`js/ui.js`, `css/ui.css`)
Title: **Ганцаараа тоглох** (solo, as before) / **Онлайн тоглох** / **Бүлгүүд**.
Online flow: Өрөө үүсгэх → big code + «Найздаа энэ кодыг хэл» + waiting state; Өрөөнд орох → 4-letter input. Both pick a role: **Ах** (амьд ертөнц) / **Дүү** (үхэгсдийн ертөнц); the two must differ (host wins a conflict). Host picks the chapter and presses Эхлэх (enabled only when the partner is present and roles differ) → `game.startOnline(id)`; guest sees «Найз чинь бүлгээ сонгож байна…». Partner leaves mid-game → overlay «Найз чинь гарлаа» (Хүлээх / Цэс). Show a one-line tip in the lobby: «Тоглохдоо утсаар эсвэл Discord-оор ярилцаарай — бие биеийнхээ ертөнцийг харахгүй.»
Rotate overlay: touch device in portrait → «Утсаа хэвтээ эргүүлнэ үү» + simple phone-rotate drawing; pauses the game; disappears in landscape. Start buttons try `document.documentElement.requestFullscreen()` then `screen.orientation.lock('landscape')` inside the click handler, ignoring failures.

## Puzzle contract — `js/puzzles.js`, `css/puzzles.css` (Puzzle & mini-game designer)
Chapter data objects:
```js
{ id:'PZ1', type:'puzzle', world:0, x:1500, kind:'drum', target:'G2', params:{} } // device; ◎ near it opens the solve overlay
{ id:'CL1', type:'clue',   world:1, x:1520, puzzle:'PZ1' }                         // clue in the OTHER world; ◎ near it opens the clue view
```
Module registers `TW.puzzles[kind]`:
```js
TW.puzzles.drum = {
  title: 'Хэнгэрэг',
  gen(rand, params) { return data; },          // deterministic: use only rand() (seeded, same on both devices)
  drawDevice(ctx, o, t, P, solved) {},          // in-world device standing on ground G=190 at o.x (20–40 tall), lit hint when solved
  drawClue(ctx, c, data, t, P) {},              // in-world clue marker at c.x (stone, carving, sky sign) — readable silhouette, details come in the overlay
  showClue(el, data, api) {},                   // fill el with a read-only clue view; api.close()
  solve(el, data, api) {}                       // fill el with the interactive solver; api.success() | api.fail(); api.close()
};
```
The engine owns the overlay frame (`#twpz` with title bar + close ✕), freezes that player's character while it is open, seeds `rand` from (session seed + puzzle id), and: on success sets the puzzle `on` and triggers its targets (locally or via net); on fail emits a loud noise in the solver's world (r 320, src 'fail', wakes enemies), plays 'fail', closes the overlay; retry allowed after 3 s. `ctx` and `P` are as in the art contract. `el` is an empty div sized to the overlay body (landscape phone ≈ 780×300 usable).
Kinds: `symbols` (тамга — press 4 of 9 carved symbols in the order shown on the clue stone), `drum` (бөөгийн хэнгэрэг — clue drum flashes a long/short rhythm of 5–6 beats; solver taps it back), `stars` (одны зураг — clue shows a constellation in the other world's sky; solver connects 4–5 stars on a 4×3 grid), `shagai` (шагай — clue shows 4 ankle bones as морь/тэмээ/хонь/ямаа; solver flips 4 bones to match), `riddle` (Keep-Talking style: solver sees 3 coloured stones and a number dial; clue is a short rules table that turns the colours into the number).
Rules: solver alone can't brute-force it (≤ 1 in 50 to guess); clue alone is useless without the device; big touch targets (≥ 44 px), fits 844×390 without scrolling, Mongolian text, the game's look (black, Georgia titles, warm off-white, red #d0343a / blue #7fa7e6), no emoji. Each module must also work in solo mode (the player walks to the clue, reads it, switches back and solves).

## Operation: Tango-style tasks (owner's direction: "one sees it and tells, the other does it")
The core loop of every chapter is **asymmetric information**: one player sees something only on their screen and describes it; the other acts. Besides the puzzle overlays above, the engine supports two level-level tools (lead implements):
- **Dark zones** — `worlds[w].dark: [{x0, x1}]`. Inside, that world's screen is pitch black except a small circle around its own character (the player can't see pits, blocks or enemies). The **other** world draws a glowing "ghost map" of that region (ground edges, gaps, blocks of world w, plus the partner's position as a small light) so the other player can guide: «зогс… одоо үсэр… баруун тийш 3 алхам».
- **Hidden threats** — enemy def flag `seenBy: 'other'`: the enemy lives and kills in its own world but is drawn **only in the other world** (as a shadow). E.g. an invisible shadow-wolf hunting the brother that only the sister can see and warn about. (Engine streams its position online.)
Puzzle kinds added for this style: `split` (each player has half of a code and a lock — info must flow both ways: both a puzzle and a clue in each world, see Puzzle contract) and `maze` (solver stands before branching cave doors and must choose a sequence of 4 doors; the other world shows the map from above).

## Level design rules (v2)
- Only one world visible per screen → design for conversation: patrol timings, positions, clue contents must be described aloud.
- Online: both act at the same time. Solo: whenever a switch is expected, the idle character must be safe.
- Each chapter from ch2 on: at least 2 puzzles, clue always in the other world, placed so that the clue reader is safe while reading/describing.
