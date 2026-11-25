(function(){
'use strict';
// TW.net — online transport for 2 players (docs/ARCHITECTURE-v2.md "TW.net contract", docs/net.md).
// Transports: Supabase Realtime broadcast + presence (default) or BroadcastChannel (?net=local, two tabs).
// net.js only moves plain JSON messages; the engine interprets them. Nothing here runs at load time
// except building the TW.net object; the Supabase library is loaded lazily on the first create/join.
const TW = window.TW || (window.TW = {});

const SB_VERSION = '2.119.2';   // exact pinned @supabase/supabase-js v2 (UMD)
const SB_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@' + SB_VERSION + '/dist/umd/supabase.min.js';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I/O (and no digits) → no 1/0 lookalikes
const PREFIX = 'two-worlds:';
const MAX_PLAYERS = 2;
const SEND_GAP = 50;            // ms between two sends → ≤ 20 msgs/s
const OFFLINE_MS = 6000;        // script load / channel subscribe deadline
const SYNC_MS = 6000;           // join: wait for the first presence sync
const CREATE_SYNC_MS = 2500;    // create: wait this long for presence that would mean "code taken"
const RESYNC_MS = 3000;         // after a reconnect: wait for presence before judging the peer
const HOST_GRACE = 3000;
const CONFIRM_MS = 5000;        // join: wait at most this long for the host to publish me as its guest
                                // (cross-node presence takes ~1–2 s each way in practice)        // join (Supabase): presence replicates between Realtime nodes with a delay,
                                // so a missing host gets this long to show up before 'notfound'
const BACKOFF = [1000, 2000, 4000];   // reconnect attempts (3)
const QUEUE_MAX = 1000;
const ST_KEEPALIVE = 1000;      // an unchanged 'st' is re-sent at most once per second (idle players cost ~nothing)
const LOCAL_HB = 1000, LOCAL_TIMEOUT = 3000, LOCAL_SYNC = 400;
const KNOWN = { full:1, notfound:1, offline:1, cancelled:1 };

const local = (function(){ try { return /(?:^|[?&])net=local(?:[&#]|$)/.test(location.search); } catch(e){ return false; } })();
const noop = function(){};
const err = m => new Error(m);
const delay = ms => new Promise(r => setTimeout(r, ms));
function warn(){ try { console.warn.apply(console, ['[TW.net]'].concat([].slice.call(arguments))); } catch(e){} }
function randInt(n){
  try { const u = new Uint32Array(1); crypto.getRandomValues(u); return u[0] % n; }
  catch(e){ return Math.floor(Math.random() * n); }
}
function rid(){ let s = ''; const a = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < 12; i++) s += a[randInt(36)]; return s; }
function newCode(){ let s = ''; for (let i = 0; i < 4; i++) s += ALPHA[randInt(ALPHA.length)]; return s; }
function validCode(c){ return c.length === 4 && [].every.call(c, ch => ALPHA.indexOf(ch) >= 0); }
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function stable(o){
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}
function capped(p, ms){ return Promise.race([Promise.resolve(p).catch(noop), delay(ms)]); }

// ---------------- events ----------------
const handlers = { message: [], peer: [], status: [] };
function emit(ev, data){
  (handlers[ev] || []).slice().forEach(f => { try { f(data); } catch(e){ try { console.error('[TW.net] ' + ev + ' handler', e); } catch(_){} } });
}

// ---------------- state ----------------
const S = {
  phase: 'idle',      // idle | opening | in | reconnecting
  op: 0,              // bumps on every create/join/leave/teardown → stale async steps stop
  tr: null, code: null, isHost: false, connected: false,
  myId: null, joinedAt: 0, info: {},
  early: [],          // messages that arrived while my join was still being confirmed
  guest: null,        // host only: id of the guest the host admitted (published in the host's presence)
  members: [],        // others' presence payloads (me excluded), as last reported by the transport
  peer: null,         // the other player's payload
  state: 'idle'
};
function setStatus(state, detail, extra){
  S.state = state;
  const o = { state, detail: detail || null };
  if (extra) for (const k in extra) o[k] = extra[k];
  emit('status', o);
}
function myPayload(){
  let p = {};
  try { p = clone(S.info) || {}; } catch(e){ p = {}; }
  p.id = S.myId; p.host = S.isHost; p.joinedAt = S.joinedAt;
  if (S.isHost) p.guest = S.guest;
  return p;
}
function inRoom(){ return S.phase === 'in' || S.phase === 'reconnecting'; }

// The host is the arbiter of the second seat: it admits one guest (the one it already has, else the earliest
// it sees) and publishes that id as `guest` in its presence. Presence replicates between Realtime nodes with a
// delay, so two guests can both think they got in; the one the host did not admit leaves with 'full'.
// No client clocks are compared across devices for this decision.
const hostOf = list => (list || []).find(p => p.host) || null;
const present = (list, id) => !!id && (list || []).some(p => p.id === id);
function earliest(list){
  return list.slice().sort((a, b) => ((+a.joinedAt || 0) - (+b.joinedAt || 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] || null;
}
function onPresence(others){
  S.members = others || [];
  if (!inRoom()) return;                       // while opening, create/join inspect the list themselves
  if (S.isHost) {
    const guests = S.members.filter(p => !p.host);
    const g = (S.peer && guests.find(p => p.id === S.peer.id)) || earliest(guests);
    const gid = g ? g.id : null;
    if (gid !== S.guest) { S.guest = gid; scheduleTrack(); }
    updatePeer(g);
    return;
  }
  const h = hostOf(S.members);
  if (h && h.guest && h.guest !== S.myId && present(S.members, h.guest)) {   // host admitted someone else
    const prev = S.peer;
    teardown(); setStatus('error', 'full');
    if (prev) emit('peer', { present: false, info: prev });
    return;
  }
  updatePeer(h);
}
function updatePeer(p){
  const prev = S.peer, op = S.op;
  if (!prev && !p) return;
  if (prev && (!p || p.id !== prev.id)) { S.peer = null; emit('peer', { present: false, info: prev }); if (op !== S.op) return; }
  if (p && (!S.peer || stable(p) !== stable(S.peer))) { S.peer = p; emit('peer', { present: true, info: Object.assign({}, p) }); }
}

function onEnvelope(env){
  if (!env || typeof env !== 'object' || env.m === undefined) return;
  if (S.phase === 'opening' && S.tr) { if (S.early.length < 100) S.early.push(env); return; }   // host may talk before my join resolves
  if (!inRoom()) return;
  const from = env.f;
  if (from && from === S.myId) return;
  // ignore a known third client (e.g. one that lost the join race); unknown senders are accepted because
  // a broadcast can arrive slightly before that sender's presence does
  if (from && S.peer && from !== S.peer.id && S.members.some(p => p.id === from)) return;
  emit('message', env.m);
}

// ---------------- send queue: ≤ 20/s, 'st' coalesced, everything else in order ----------------
const Q = [];
const RATE = 20, sentAt = [];   // times of the last RATE sends → never more than RATE in any 1 s window
let lastSent = -1e9, pumpT = null, lastSt = { key: '', at: -1e9 };
const now = () => (window.performance && performance.now) ? performance.now() : Date.now();
function send(msg){
  if (!inRoom() || !msg || typeof msg !== 'object') return false;
  const st = msg.t === 'st';
  let m;
  try { m = clone(msg); } catch(e){ warn('send: message is not JSON', e); return false; }
  if (st) for (let i = Q.length - 1; i >= 0; i--) if (Q[i].st) { Q[i].m = m; pump(); return true; }   // keep latest
  if (Q.length >= QUEUE_MAX) {
    let i = Q.findIndex(x => x.st); if (i < 0) i = 0;
    Q.splice(i, 1); warn('send queue overflow, dropped one message');
  }
  Q.push({ st, m });
  pump();
  return true;
}
function pump(){
  if (pumpT || !S.connected || !S.tr || !Q.length) return;
  const t = now();
  const wait = Math.max(lastSent + SEND_GAP, sentAt.length >= RATE ? sentAt[0] + 1000 : 0) - t;
  if (wait > 0) { pumpT = setTimeout(() => { pumpT = null; pump(); }, Math.ceil(wait)); return; }
  const item = Q.shift();
  let key = '';
  if (item.st) {
    key = stable(item.m);
    if (key === lastSt.key && t - lastSt.at < ST_KEEPALIVE) { pump(); return; }   // nothing changed: skip
  }
  let ok = false;
  try { ok = S.tr.send({ f: S.myId, m: item.m }) !== false; } catch(e){ ok = false; }
  if (!ok) { Q.unshift(item); pumpT = setTimeout(() => { pumpT = null; pump(); }, 200); return; }
  lastSent = t; sentAt.push(t); if (sentAt.length > RATE) sentAt.shift();
  if (item.st) lastSt = { key, at: t };
  if (Q.length) pumpT = setTimeout(() => { pumpT = null; pump(); }, SEND_GAP);
}
function clearQueue(){ Q.length = 0; clearTimeout(pumpT); pumpT = null; lastSt = { key: '', at: -1e9 }; }

// ---------------- transport: BroadcastChannel (?net=local) ----------------
function makeLocal(cb){
  let bc = null, code = null, myId = null, members = {}, tracked = false, payload = null, hbT = null, pruneT = null;
  const list = () => Object.keys(members).map(k => members[k].p);
  const post = o => { try { if (bc) bc.postMessage(o); } catch(e){} };
  const changed = () => cb.presence(list());
  function prune(){
    const now = Date.now(); let ch = false;
    for (const k in members) if (now - members[k].last > LOCAL_TIMEOUT) { delete members[k]; ch = true; }
    if (ch) changed();
  }
  function onmsg(ev){
    const d = ev && ev.data;
    if (!d || typeof d !== 'object' || !d.f || d.f === myId) return;
    if (d.k === 'q') { if (tracked) post({ k: 'hb', f: myId, p: payload }); return; }
    if (d.k === 'hello' || d.k === 'hb') {
      if (!d.p || typeof d.p !== 'object') return;
      const old = members[d.f];
      members[d.f] = { p: d.p, last: Date.now() };
      if (d.k === 'hello' && tracked) post({ k: 'hb', f: myId, p: payload });
      if (!old || stable(old.p) !== stable(d.p)) changed();
      return;
    }
    if (d.k === 'bye') { if (members[d.f]) { delete members[d.f]; changed(); } return; }
    if (d.k === 'm') cb.message(d.e);
  }
  function openBC(){
    try { bc = new BroadcastChannel(PREFIX + code); bc.onmessage = onmsg; return true; } catch(e){ bc = null; return false; }
  }
  return {
    name: 'local',
    open(c, id){
      code = c; myId = id;
      if (!openBC()) return Promise.reject(err('offline'));
      pruneT = setInterval(prune, 500);
      return Promise.resolve();
    },
    reopen(){                     // members are kept; heartbeats refresh them
      try { if (bc) bc.close(); } catch(e){}
      if (!openBC()) return Promise.reject(err('offline'));
      return Promise.resolve();
    },
    snapshot(ms){ post({ k: 'q', f: myId }); return delay(Math.min(ms, LOCAL_SYNC)).then(list); },
    others: list,
    track(p){
      payload = p;
      post({ k: tracked ? 'hb' : 'hello', f: myId, p });
      tracked = true;
      if (!hbT) hbT = setInterval(() => post({ k: 'hb', f: myId, p: payload }), LOCAL_HB);
      return Promise.resolve();
    },
    send(env){ if (!bc) return false; post({ k: 'm', f: myId, e: env }); return true; },
    close(){
      if (tracked) post({ k: 'bye', f: myId });
      tracked = false; clearInterval(hbT); clearInterval(pruneT); hbT = pruneT = null;
      try { if (bc) bc.close(); } catch(e){}
      bc = null; members = {};
    }
  };
}

// ---------------- transport: Supabase Realtime ----------------
let libP = null, client = null;
function loadLib(){
  const have = () => window.supabase && typeof window.supabase.createClient === 'function';
  if (have()) return Promise.resolve(window.supabase);
  if (libP) return libP;
  libP = new Promise((res, rej) => {
    let done = false, s = null;
    const fin = ok => {
      if (done) return; done = true; clearTimeout(t);
      if (ok && have()) { res(window.supabase); return; }
      libP = null;                                   // allow a later retry
      if (!ok && s && s.parentNode && !s.dataset.loaded) try { s.parentNode.removeChild(s); } catch(e){}
      rej(err('offline'));
    };
    const t = setTimeout(() => fin(false), OFFLINE_MS);
    try {
      s = document.createElement('script');
      s.src = SB_SRC; s.async = true;
      s.onload = () => { s.dataset.loaded = '1'; fin(true); };
      s.onerror = () => fin(false);
      (document.head || document.documentElement).appendChild(s);
    } catch(e){ fin(false); }
  });
  return libP;
}
function getClient(lib){
  if (client) return client;
  const cfg = TW.config || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey) throw err('offline');
  client = lib.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    realtime: { params: { eventsPerSecond: 20 } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }   // no storage use
  });
  return client;
}
function makeSupabase(cb){
  let ch = null, gen = 0, code = null, myId = null, synced = false, joined = false, waiters = [], lastErr = '';
  function others(){
    let st = {};
    try { st = (ch && ch.presenceState()) || {}; } catch(e){}
    const a = [];
    for (const k in st) {
      if (k === myId) continue;
      const metas = st[k];
      if (!metas || !metas.length) continue;
      const m = metas[metas.length - 1], p = {};
      for (const j in m) if (j !== 'presence_ref') p[j] = m[j];
      if (!p.id) p.id = k;
      a.push(p);
    }
    return a;
  }
  function flushWaiters(v){ const w = waiters; waiters = []; w.forEach(f => f(v)); }
  async function openChannel(){
    const g = ++gen;
    const lib = await loadLib();
    if (g !== gen) throw err('cancelled');
    let c;
    try { c = getClient(lib); } catch(e){ lastErr = String(e && e.message || e); throw err('offline'); }
    synced = false; joined = false;
    return new Promise((res, rej) => {
      let settled = false;
      const t = setTimeout(() => { if (!settled) { settled = true; rej(err('offline')); } }, OFFLINE_MS);
      try {
        const my = c.channel(PREFIX + code, { config: { broadcast: { self: false, ack: false }, presence: { key: myId } } });
        ch = my;
        my.on('broadcast', { event: 'm' }, ev => { if (g === gen) cb.message(ev && ev.payload); });
        my.on('presence', { event: 'sync' }, () => {
          if (g !== gen) return;
          synced = true; const l = others(); flushWaiters(l); cb.presence(l);
        });
        my.subscribe((status, e) => {
          if (g !== gen) return;
          if (status === 'SUBSCRIBED') {
            joined = true;
            if (!settled) { settled = true; clearTimeout(t); res(); }
            return;
          }
          if (e) lastErr = status + ': ' + String(e && e.message || e); else lastErr = status;
          const was = joined; joined = false;
          // before the first SUBSCRIBED realtime-js keeps retrying on its own until our deadline
          if (settled && was) cb.drop(status);
        });
      } catch(e){
        lastErr = String(e && e.message || e);
        if (!settled) { settled = true; clearTimeout(t); rej(err('offline')); }
      }
    });
  }
  async function closeChannel(wait){
    gen++; joined = false; synced = false; flushWaiters(null);
    const c = ch; ch = null;
    if (!c || !client) return;
    try { const p = c.untrack(); if (p && p.catch) p.catch(noop); } catch(e){}
    let r;
    try { r = client.removeChannel(c); } catch(e){}
    if (wait) await capped(r, 11000);
    else if (r && r.catch) r.catch(noop);
  }
  return {
    name: 'supabase',
    settleMs: HOST_GRACE,
    get lastError(){ return lastErr; },
    open(c, id){ code = c; myId = id; return openChannel(); },
    async reopen(){ await closeChannel(true); return openChannel(); },
    snapshot(ms){
      if (synced) return Promise.resolve(others());
      return new Promise(res => {
        let done = false;
        const t = setTimeout(() => { if (!done) { done = true; res(null); } }, ms);
        waiters.push(v => { if (!done) { done = true; clearTimeout(t); res(v); } });
      });
    },
    others,
    async track(p){
      if (!ch) throw err('offline');
      const r = await Promise.race([ch.track(p), delay(OFFLINE_MS + 2000).then(() => 'timed out')]);
      if (r !== 'ok') { lastErr = 'track: ' + r; throw err('offline'); }
    },
    send(env){
      if (!ch || !joined) return false;
      if (ch.state && ch.state !== 'joined') return false;   // never fall back to the REST endpoint
      const p = ch.send({ type: 'broadcast', event: 'm', payload: env });
      if (p && p.catch) p.catch(noop);
      return true;
    },
    close(){ closeChannel(false); }
  };
}

function makeTransport(){
  const cb = { message: onEnvelope, presence: l => onPresence(l), drop: r => onDrop(r) };
  return local ? makeLocal(cb) : makeSupabase(cb);
}

// ---------------- room lifecycle ----------------
function teardown(){
  S.op++;
  const tr = S.tr; S.tr = null;
  if (tr) try { tr.close(); } catch(e){}
  clearTimeout(trackT); trackT = null;
  clearQueue();
  S.phase = 'idle'; S.connected = false; S.code = null; S.isHost = false; S.guest = null; S.peer = null; S.members = []; S.early = [];
}
function check(op){ if (op !== S.op) throw err('cancelled'); }

function startOp(fn){
  if (S.phase !== 'idle') teardown();
  const op = ++S.op;
  S.phase = 'opening'; S.myId = rid(); S.isHost = false; S.guest = null;
  setStatus('connecting');
  return (async () => {
    if (!api.available()) throw err('offline');
    return fn(op);
  })().catch(e => {
    let reason = e && e.message;
    if (!KNOWN[reason]) { warn('unexpected', e); reason = 'offline'; }
    if (op === S.op) {
      const why = S.tr && S.tr.lastError;
      teardown();
      setStatus('error', reason, why ? { reason: why } : null);
    } else if (reason !== 'cancelled') reason = 'cancelled';
    throw err(reason);
  });
}
async function enter(op, tr){
  S.joinedAt = Date.now();
  await tr.track(myPayload()); check(op);
  if (!S.isHost) {                     // wait for the host to admit me (normally one presence round trip)
    let ok = false, missing = 0;
    for (let t = 0; t < CONFIRM_MS && !ok; t += 100) {
      const l = tr.others(), h = hostOf(l);
      if (!h) { if ((missing += 100) > 1500) throw err('notfound'); await delay(100); check(op); continue; }
      missing = 0;
      if (h.guest === S.myId) { ok = true; break; }
      if (h.guest && present(l, h.guest)) throw err('full');
      await delay(100); check(op);
    }
    const h = hostOf(tr.others());
    if (!ok && h && h.guest && h.guest !== S.myId) throw err('full');   // host kept someone else
  }
  S.phase = 'in'; S.connected = true; lastSent = -1e9;
  setStatus('connected', S.isHost ? 'host' : 'guest', { code: S.code, transport: tr.name });
  if (op !== S.op) return;
  onPresence(tr.others());
  const early = S.early; S.early = [];
  for (const env of early) { if (op !== S.op) return; onEnvelope(env); }
  pump();
}

function create(){
  return startOp(async op => {
    for (let tries = 0; tries < 6; tries++) {
      const code = newCode(), tr = makeTransport();
      S.tr = tr; S.code = code;
      await tr.open(code, S.myId); check(op);
      const others = await tr.snapshot(CREATE_SYNC_MS); check(op);
      if (others && others.length) { tr.close(); S.tr = null; S.early = []; continue; }   // code in use → new code
      S.isHost = true;
      await enter(op, tr); check(op);
      return code;
    }
    throw err('offline');
  });
}
function join(code){
  return startOp(async op => {
    code = String(code == null ? '' : code).trim().toUpperCase();
    if (!validCode(code)) throw err('notfound');
    const tr = makeTransport();
    S.tr = tr; S.code = code;
    await tr.open(code, S.myId); check(op);
    let others = await tr.snapshot(SYNC_MS); check(op);
    const hasHost = l => !!l && l.some(p => p.host);
    for (let t = 0; others && !hasHost(others) && t < (tr.settleMs || 0); t += 100) {
      await delay(100); check(op); others = tr.others();
    }
    if (!hasHost(others)) throw err('notfound');
    const h = hostOf(others);
    if (present(others, h.guest) || others.length >= MAX_PLAYERS) throw err('full');
    S.isHost = false;
    await enter(op, tr); check(op);
    return code;
  });
}
function leave(){
  const active = S.phase !== 'idle';
  teardown();
  if (active) setStatus('idle');
}

function whenVisible(fn){
  let hidden = false;
  try { hidden = document.hidden; } catch(e){}
  if (!hidden) { fn(); return; }
  const h = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', h); fn(); } };
  document.addEventListener('visibilitychange', h);
}
function onDrop(reason){
  if (S.phase !== 'in') return;
  S.phase = 'reconnecting'; S.connected = false;
  clearTimeout(pumpT); pumpT = null;
  const op = S.op;
  const attempt = n => {
    if (op !== S.op) return;
    if (n > BACKOFF.length) {
      const prev = S.peer, why = S.tr && S.tr.lastError;
      teardown(); setStatus('error', 'lost', why ? { reason: why } : null);
      if (prev) emit('peer', { present: false, info: prev });
      return;
    }
    setStatus('connecting', 'reconnect', { attempt: n, reason: String(reason || '') });
    if (op !== S.op) return;
    setTimeout(() => whenVisible(async () => {
      if (op !== S.op) return;
      try {
        const tr = S.tr;
        await tr.reopen(); check(op);
        await tr.track(myPayload()); check(op);
        S.phase = 'in'; S.connected = true; lastSt = { key: '', at: -1e9 };
        setStatus('connected', 'reconnected', { code: S.code, transport: tr.name });
        if (op !== S.op) return;
        const l = await tr.snapshot(RESYNC_MS);
        if (op !== S.op) return;
        if (l) onPresence(l);
        pump();
      } catch(e){
        if (op !== S.op) return;
        S.phase = 'reconnecting'; S.connected = false;
        attempt(n + 1);
      }
    }), BACKOFF[n - 1]);
  };
  attempt(1);
}

let trackT = null;
function scheduleTrack(){              // re-publish my presence payload (coalesced)
  if (S.phase !== 'in' || trackT) return;
  trackT = setTimeout(() => {
    trackT = null;
    if (S.phase === 'in' && S.tr) S.tr.track(myPayload()).catch(noop);
  }, 30);
}
function setInfo(obj){
  if (obj && typeof obj === 'object') for (const k in obj) S.info[k] = obj[k];
  scheduleTrack();
}

// ---------------- public API ----------------
const api = {
  available(){
    try { return local ? typeof BroadcastChannel === 'function' : typeof WebSocket === 'function'; }
    catch(e){ return false; }
  },
  create, join, leave, send, setInfo,
  on(ev, fn){ if (handlers[ev] && typeof fn === 'function') handlers[ev].push(fn); },
  off(ev, fn){ if (handlers[ev]) handlers[ev] = handlers[ev].filter(f => f !== fn); },
  peer(){ return S.peer ? Object.assign({}, S.peer) : null; },
  libVersion: SB_VERSION,
  _drop(){ onDrop('test'); }        // test hook: simulate a lost channel (reconnect path)
};
Object.defineProperties(api, {
  code:      { enumerable: true, get: () => S.code },
  isHost:    { enumerable: true, get: () => S.isHost },
  connected: { enumerable: true, get: () => S.connected },
  state:     { enumerable: true, get: () => S.state },
  transport: { enumerable: true, get: () => local ? 'local' : 'supabase' },
  id:        { enumerable: true, get: () => S.myId }
});
TW.net = api;

try { window.addEventListener('pagehide', () => { if (S.phase !== 'idle') leave(); }); } catch(e){}
})();
