/* Хоёр ертөнц — UI layer v2 (title, chapter select, online lobby, pause, title card, chapter end,
   partner-left overlay, rotate overlay).
   Owner: UI/UX designer. Contracts: docs/ARCHITECTURE.md → "UI contract",
   docs/ARCHITECTURE-v2.md → "Lobby & screens". Only registers TW.ui; builds its DOM inside
   TW.ui.init(game). Never throws: every game.* / TW.net.* call is guarded. */
(function(){
'use strict';

var TW = window.TW || (window.TW = {});

var G = null;              // TW.game
var built = false;
var state = 'title';       // title | chapters | lobby | playing | paused | end | peerleft
var chaptersFrom = 'title';
var lastEnd = null;
var lastKeyboard = false;
var openedAt = 0;
var cardTimer = 0;
var legendTouch = null;
var el = {};

/* online lobby state */
var L = {
  view: 'menu',            // menu | na | busy | join | err | room
  code: '',
  host: false,
  myRole: null,            // 0 = Ах (living), 1 = Дүү (dead)
  selCh: null,             // host's chosen chapter id
  at: 'lobby',             // what I tell my partner: 'lobby' | 'game'
  note: '', noteTimer: 0,
  joinErr: '',
  tok: 0,                  // cancels stale create/join promises
  poll: 0,
  peer: { seen: false, present: false, info: null },
  hooked: null,            // the TW.net object we subscribed to
  leftOnce: false,
  reconnecting: false,
  errFull: false           // the 'err' view shows «Өрөө дүүрсэн байна» instead of the network message
};
var PL = { waiting: false, pausedByMe: false, kind: 'left' };   // partner-left overlay
var rotateOn = false, pausedByRotate = false;

var ROLE_NAME = ['Ах', 'Дүү'];
var ROLE_WORLD = ['амьд ертөнц', 'үхэгсдийн ертөнц'];
var TIP = 'Утсаар эсвэл Discord-оор ярилцаж тоглоорой — та нар бие биеийнхээ ертөнцийг харахгүй.';
var NET_NOTE = 'Нийтэлсэн preview хуудас сүлжээнд холбогдож чаддаггүй. Онлайн горим hosted хувилбар дээр ажиллана.';

/* ---------- helpers ---------- */
function warn(e){ try{ console.warn('[ui]', e); }catch(_){} }
function safe(fn){ return function(){ try{ return fn.apply(this, arguments); }catch(e){ warn(e); } }; }
function call(name){
  var args = Array.prototype.slice.call(arguments, 1);
  try{
    var g = G || TW.game;
    if(g && typeof g[name] === 'function') return g[name].apply(g, args);
  }catch(e){ warn(e); }
  return undefined;
}
function hasApi(name){ var g = G || TW.game; return !!(g && typeof g[name] === 'function'); }
function net(){ var n = TW.net; return n && (typeof n === 'object' || typeof n === 'function') ? n : null; }
function netCall(name){
  var n = net(), args = Array.prototype.slice.call(arguments, 1);
  if(!n || typeof n[name] !== 'function') return undefined;
  try{ return n[name].apply(n, args); }catch(e){ warn(e); }
  return undefined;
}
function h(tag, cls, attrs, kids){
  var n = document.createElement(tag);
  if(cls) n.className = cls;
  if(attrs) for(var k in attrs){ if(attrs[k] != null) n.setAttribute(k, attrs[k]); }
  if(kids != null){
    if(!Array.isArray(kids)) kids = [kids];
    for(var i = 0; i < kids.length; i++){
      var c = kids[i];
      if(c == null) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return n;
}
function svg(markup, cls){
  var s = h('span', cls, { 'aria-hidden': 'true' });
  s.innerHTML = markup;                   // static, author-written markup only
  return s;
}
function show(n, on){ if(n){ if(on) n.removeAttribute('hidden'); else n.setAttribute('hidden', ''); } }
function numOr(v, d){ v = +v; return isFinite(v) && v > 0 ? Math.round(v) : d; }
function ord(n){ return n + '-р бүлэг'; }
function fmtTime(s){
  s = Math.max(0, Math.floor(+s || 0));
  var m = Math.floor(s / 60), r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}
function deathsText(d){ return Math.max(0, Math.floor(+d || 0)) + ' удаа үхсэн'; }
function roleOf(info){ var r = info && info.role; return r === 0 || r === 1 ? r : (r === '0' || r === '1' ? +r : null); }
function mm(q){ try{ return !!(window.matchMedia && window.matchMedia(q).matches); }catch(_){ return false; } }

/* ---------- data ---------- */
function chapters(){
  var r = call('chapters'), out = [];
  if(!Array.isArray(r)) return out;
  for(var i = 0; i < r.length; i++){
    var c = r[i];
    if(!c || c.id == null) continue;
    var b = c.best && isFinite(+c.best.time) ? { time: +c.best.time, deaths: +c.best.deaths || 0 } : null;
    out.push({
      id: String(c.id),
      num: numOr(c.num, out.length + 1),
      title: c.title ? String(c.title) : '',
      unlocked: c.unlocked === undefined ? true : !!c.unlocked,
      best: b
    });
  }
  return out;
}
/* Solo "continue": the first unlocked chapter without a best record, else the last unlocked one. */
function continueTarget(list){
  list = list || chapters();
  var last = null;
  for(var i = 0; i < list.length; i++){
    if(!list[i].unlocked) continue;
    if(!list[i].best) return list[i];
    last = list[i];
  }
  return last || list[0] || null;
}
function findCh(id, list){
  list = list || chapters();
  for(var i = 0; i < list.length; i++) if(list[i].id === id) return list[i];
  return null;
}
function chName(c){ return c ? ord(c.num) + (c.title ? ' · ' + c.title : '') : ''; }
function current(){
  var c = call('current');
  if(!c || c.id == null) return null;
  return { id: String(c.id), num: numOr(c.num, 0), title: c.title ? String(c.title) : '' };
}
function isTouch(){ return !!call('touchUI'); }
function isTouchDevice(){
  return isTouch() || mm('(pointer:coarse)') || (('ontouchstart' in window) && (navigator.maxTouchPoints || 0) > 0);
}
function isOnline(){ return call('mode') === 'online'; }
function isHost(){ var n = net(); return n && n.isHost != null ? !!n.isHost : L.host; }
function myGameRole(){ var r = call('role'); return r === 0 || r === 1 ? r : L.myRole; }

/* ---------- fullscreen + landscape lock (inside the click handler; failures are fine) ---------- */
function goLandscape(){
  if(!isTouchDevice()) return;            // never yank a desktop browser into fullscreen
  var lock = function(){
    try{
      var o = screen.orientation;
      if(o && typeof o.lock === 'function'){ var r = o.lock('landscape'); if(r && r.catch) r.catch(function(){}); }
    }catch(_){}
  };
  try{
    var de = document.documentElement, p = null;
    if(!document.fullscreenElement && de && typeof de.requestFullscreen === 'function') p = de.requestFullscreen({ navigationUI: 'hide' });
    if(p && typeof p.then === 'function') p.then(lock, lock); else lock();
  }catch(_){ lock(); }
}

/* ---------- actions (all run synchronously inside the click / key handler: audio unlock) ---------- */
function startGame(id){
  id = id || 'ch1';
  if(hasApi('startSolo')) call('startSolo', id); else call('startChapter', id);
  if(call('isPaused')) call('pause', false);
  setState('playing');
}
function doPause(){
  if(state !== 'playing') return;
  call('pause', true);
  fillPause();
  setState('paused');
}
function doResume(){
  call('pause', false);
  setState('playing');
}
function doRestart(){
  call('restart');
  if(call('isPaused')) call('pause', false);
  setState('playing');
}
function openChapters(){
  chaptersFrom = state === 'chapters' ? chaptersFrom : state;
  renderChapters();
  setState('chapters');
  try{ el.chapters.scrollTop = 0; }catch(_){}
}
function closeChapters(){
  var to = chaptersFrom || 'title';
  if(to === 'paused') fillPause();
  if(to === 'title') renderTitle();
  if(to === 'end' && lastEnd) fillEnd(lastEnd);
  setState(to);
}
function toggleSound(){
  call('setMuted', !call('isMuted'));
  renderSound();
}
function toTitle(){
  renderTitle();
  setState('title');
}

/* ---------- online: TW.net wiring ---------- */
function hookNet(){
  var n = net();
  if(!n || L.hooked === n || typeof n.on !== 'function') return;
  try{
    if(L.hooked && typeof L.hooked.off === 'function'){ L.hooked.off('peer', onPeer); L.hooked.off('status', onStatus); }
    n.on('peer', onPeer);
    n.on('status', onStatus);
    L.hooked = n;
  }catch(e){ warn(e); }
}
function peerNow(){
  var pi = null;
  var n = net();
  try{ if(n && typeof n.peer === 'function') pi = n.peer(); }catch(_){}
  var present = L.peer.seen ? L.peer.present : pi != null;
  var info = present ? (pi || L.peer.info || {}) : null;
  return { present: present, info: info };
}
function pushInfo(){
  var o = { role: L.myRole, at: L.at };
  if(isHost() && L.selCh) o.ch = L.selCh;
  netCall('setInfo', o);
}
function resetRoom(){
  L.tok++;
  L.code = ''; L.host = false; L.myRole = null; L.selCh = null; L.at = 'lobby';
  L.note = ''; L.joinErr = ''; L.leftOnce = false; L.reconnecting = false; L.errFull = false;
  L.peer = { seen: false, present: false, info: null };
  clearTimeout(L.noteTimer);
  // net.js merges setInfo() into a payload that outlives the room: clear what the next room must not see
  // (a stale at:'game' would make a re-joining partner look like they are still in the game)
  netCall('setInfo', { role: null, at: 'lobby', ch: null });
}
function setNote(t){
  L.note = t || '';
  clearTimeout(L.noteTimer);
  if(t) L.noteTimer = setTimeout(safe(function(){ L.note = ''; renderRoom(); }), 5200);
}
/* Roles must differ; the host wins. Only the guest ever changes its own role automatically. */
function resolveRoles(){
  var p = peerNow(), pr = p.present ? roleOf(p.info) : null;
  if(isHost()){
    if(L.myRole !== 0 && L.myRole !== 1){ L.myRole = 0; pushInfo(); }
    return;
  }
  if(L.myRole !== 0 && L.myRole !== 1){
    L.myRole = pr != null ? 1 - pr : 1;
    pushInfo();
  }else if(pr != null && pr === L.myRole){
    L.myRole = 1 - pr;
    pushInfo();
    setNote('Найз чинь ' + (pr === 0 ? 'Ахыг' : 'Дүүг') + ' сонгосон тул чи ' + ROLE_NAME[L.myRole] + ' боллоо.');
  }
}
/* Safety net only: net.js has its own deadlines. If ours fires first, cancel the pending operation. */
function withTimeout(p, ms){
  return new Promise(function(res, rej){
    var done = false, t = setTimeout(function(){ if(!done){ done = true; netCall('leave'); rej(new Error('offline')); } }, ms);
    Promise.resolve(p).then(function(v){ if(!done){ done = true; clearTimeout(t); res(v); } },
                            function(e){ if(!done){ done = true; clearTimeout(t); rej(e); } });
  });
}
function errKind(e){
  var m = String((e && (e.message || e.code)) || e || '').toLowerCase();
  if(m.indexOf('notfound') >= 0 || m.indexOf('not found') >= 0) return 'notfound';
  if(m.indexOf('full') >= 0) return 'full';
  if(m.indexOf('cancel') >= 0) return 'cancelled';
  return 'offline';
}

function openLobby(){
  hookNet();
  var n = net();
  if(!n){ setView('na'); }
  else if(typeof n.available === 'function' && !safeBool(function(){ return n.available(); })){ setView('na'); }
  else if(L.code && n.connected) { setView('room'); }
  else setView('menu');
  setState('lobby');
}
function safeBool(fn){ try{ return !!fn(); }catch(_){ return false; } }

function doCreate(){
  var n = net();
  if(!n || typeof n.create !== 'function'){ setView('na'); return; }
  goLandscape();
  resetRoom();
  var tok = ++L.tok;
  setView('busy');
  var p;
  try{ p = n.create(); }catch(e){ p = Promise.reject(e); }
  withTimeout(p, 30000).then(safe(function(code){
    if(tok !== L.tok) return;
    L.code = String(code || n.code || '').toUpperCase();
    L.host = true;
    L.myRole = 0;
    L.selCh = defaultOnlineChapter();
    L.at = 'lobby';
    pushInfo();
    setView('room');
  }), safe(function(e){
    if(tok !== L.tok) return;
    if(errKind(e) === 'cancelled') return;
    L.errFull = false;
    setView('err');
  }));
}
function doJoin(){
  var n = net();
  if(!n || typeof n.join !== 'function'){ setView('na'); return; }
  var code = sanitizeCode(el.jInput.value);
  if(code.length !== 4){
    L.joinErr = '4 үсэгтэй код оруулна уу';
    renderJoin();
    try{ el.jInput.focus(); }catch(_){}
    return;
  }
  goLandscape();
  try{ el.jInput.blur(); }catch(_){}
  var keep = code;
  resetRoom();
  var tok = ++L.tok;
  L.code = keep;
  setView('busy');
  var p;
  try{ p = n.join(keep); }catch(e){ p = Promise.reject(e); }
  withTimeout(p, 30000).then(safe(function(){
    if(tok !== L.tok) return;
    L.code = String(n.code || keep).toUpperCase();
    L.host = false;
    L.at = 'lobby';
    resolveRoles();                       // picks the role the host does not hold
    if(L.myRole == null){ L.myRole = 1; pushInfo(); }
    setView('room');
  }), safe(function(e){
    if(tok !== L.tok) return;
    var k = errKind(e);
    if(k === 'cancelled') return;
    if(k === 'offline'){ L.errFull = false; setView('err'); return; }
    L.joinErr = k === 'full' ? 'Өрөө дүүрсэн байна' : 'Ийм өрөө олдсонгүй';
    el.jInput.value = keep;
    setView('join');
  }));
}
function leaveRoom(){
  L.tok++;
  if(isOnline() && hasApi('leaveOnline')) call('leaveOnline');
  else netCall('leave');
  resetRoom();
}
function lobbyBack(){
  var v = L.view;
  if(v === 'room' || v === 'busy'){ leaveRoom(); setView('menu'); return; }
  if(v === 'join' || v === 'err'){ L.joinErr = ''; setView(net() ? 'menu' : 'na'); return; }
  toTitle();
}
function defaultOnlineChapter(){
  var cur = isOnline() ? current() : null;
  if(cur) return cur.id;
  var t = continueTarget();
  return t ? t.id : null;
}
function pickRole(r){
  r = +r;
  if(r !== 0 && r !== 1) return;
  var p = peerNow(), pr = p.present ? roleOf(p.info) : null;
  if(!isHost() && pr === r){
    setNote('Энэ дүрийг найз чинь сонгосон.');
    renderRoom();
    return;
  }
  L.myRole = r;
  setNote('');
  pushInfo();
  renderRoom();
}
function pickChapter(id){
  var c = findCh(id);
  if(!c || !c.unlocked) return;
  L.selCh = c.id;
  pushInfo();
  renderRoom();
}
function canStart(){
  var p = peerNow(), pr = p.present ? roleOf(p.info) : null;
  if(!p.present) return { ok: false, why: 'Найзыгаа хүлээж байна…' };
  if(pr == null) return { ok: false, why: 'Найз чинь дүрээ сонгож байна…' };
  if(L.myRole == null || pr === L.myRole) return { ok: false, why: 'Хоёр өөр дүр сонгоно уу' };
  var c = findCh(L.selCh);
  if(!c || !c.unlocked) return { ok: false, why: 'Бүлгээ сонгоно уу' };
  return { ok: true, why: 'Бэлэн. ' + ROLE_NAME[L.myRole] + ' — чи, ' + ROLE_NAME[pr] + ' — найз чинь.' };
}
function doOnlineStart(id){
  goLandscape();
  id = id || L.selCh;
  if(!id) return false;
  if(L.myRole === 0 || L.myRole === 1) pushInfo();
  var ok = hasApi('startOnline') ? call('startOnline', id) : undefined;
  if(ok === false || ok === undefined && !hasApi('startOnline')){
    L.selCh = id;
    if(state !== 'lobby'){ setView('room'); setState('lobby'); }
    el.rWhy.textContent = hasApi('startOnline') ? 'Найз чинь холбогдоогүй байна' : 'Онлайн горим бэлэн биш';
    return false;
  }
  if(state === 'lobby') setState('playing');   // chapterStart normally did this already
  return true;
}
/* Host only: go back to the room to pick another chapter; the partner's screen follows. */
function backToRoom(){
  netCall('send', { t: 'menu' });
  L.selCh = defaultOnlineChapter();
  L.at = 'lobby';
  pushInfo();
  setView('room');
  setState('lobby');
}
function leaveToTitle(){
  leaveRoom();
  hidePeerLeft(false);
  toTitle();
}

var ACTIONS = {
  solo: function(){ goLandscape(); var t = continueTarget(); startGame(t ? t.id : 'ch1'); },
  start: function(){ ACTIONS.solo(); },
  online: openLobby,
  chapters: openChapters,
  back: closeChapters,
  play: function(btn){ var id = btn.getAttribute('data-id'); if(id){ goLandscape(); startGame(id); } },
  resume: doResume,
  restart: doRestart,
  sound: toggleSound,
  next: function(){
    if(!lastEnd || !lastEnd.next) return;
    if(isOnline()) doOnlineStart(lastEnd.next); else startGame(lastEnd.next);
  },
  replay: function(){
    var id = (lastEnd && lastEnd.id) || ((current() || {}).id) || 'ch1';
    if(isOnline()) doOnlineStart(id); else startGame(id);
  },
  room: backToRoom,
  leave: leaveToTitle,
  lobbyBack: lobbyBack,
  create: doCreate,
  joinView: function(){
    L.joinErr = '';
    el.jInput.value = '';
    setView('join');
    try{ el.jInput.focus({ preventScroll: true }); }catch(_){ try{ el.jInput.focus(); }catch(__){} }
  },
  join: doJoin,
  retry: function(){ L.joinErr = ''; setView('menu'); },
  role: function(b){ pickRole(b.getAttribute('data-role')); },
  pickCh: function(b){ pickChapter(b.getAttribute('data-id')); },
  ostart: function(){ var c = canStart(); if(c.ok) doOnlineStart(L.selCh); else { el.rWhy.textContent = c.why; } },
  plWait: function(){ PL.waiting = true; renderPeerLeft(); focusPrimary(el.peerleft); },
  plMenu: leaveToTitle
};

function onClick(e){
  var t = e.target, btn = t && t.closest ? t.closest('[data-act]') : null;
  if(!btn || btn.disabled) return;
  var fn = ACTIONS[btn.getAttribute('data-act')];
  if(fn) fn(btn);
}

/* ---------- state ---------- */
function overlayFor(s){
  return s === 'title' ? el.title : s === 'chapters' ? el.chapters : s === 'lobby' ? el.lobby :
         s === 'paused' ? el.pause : s === 'end' ? el.end : s === 'peerleft' ? el.peerleft : null;
}
function setState(s){
  var prev = state;
  state = s;
  show(el.title, s === 'title');
  show(el.chapters, s === 'chapters');
  show(el.lobby, s === 'lobby');
  show(el.pause, s === 'paused');
  show(el.end, s === 'end');
  show(el.peerleft, s === 'peerleft');
  show(el.pauseBtn, s === 'playing');
  if(s !== 'playing') hideCard();
  if(s !== prev) openedAt = Date.now();
  if(s === 'lobby' && L.view === 'room') startPoll(); else stopPoll();
  var ov = overlayFor(s);
  if(ov){
    if(lastKeyboard && s !== prev) focusPrimary(ov);
  }else{
    var a = document.activeElement;
    if(a && a.blur && el.root && el.root.contains(a)) a.blur();
  }
}
function visible(b){ return b && !b.disabled && b.offsetParent !== null; }
function primaryOf(ov){
  var c = ov.querySelectorAll('[data-primary]');
  for(var i = 0; i < c.length; i++) if(visible(c[i])) return c[i];
  var b = ov.querySelectorAll('button, input');
  for(var j = 0; j < b.length; j++) if(visible(b[j])) return b[j];
  return null;
}
function focusPrimary(ov){
  var b = primaryOf(ov);
  if(b){ try{ b.focus({ preventScroll: true }); }catch(_){ try{ b.focus(); }catch(__){} } }
}

/* ---------- build ---------- */
function btn(label, act, cls, extra){
  var a = { type: 'button', 'data-act': act };
  if(extra) for(var k in extra) a[k] = extra[k];
  return h('button', 'twui-btn' + (cls ? ' ' + cls : ''), a, label);
}

function buildTitle(){
  var lead = h('p', 'twui-lead', null, [
    h('span', 'twui-nw', null, [h('span', 'twui-b', null, 'ах'), ' — амьд ертөнц']),
    h('span', 'twui-sep', { 'aria-hidden': 'true' }, ' · '),
    h('span', 'twui-nw', null, [h('span', 'twui-r', null, 'дүү'), ' — үхэгсдийн ертөнц'])
  ]);
  el.tSolo = btn('Ганцаараа тоглох', 'solo', 'twui-btn--primary', { 'data-primary': '', 'aria-describedby': 'twui-cont' });
  el.tCont = h('span', 'twui-capline', { id: 'twui-cont' });
  el.tOnline = btn('Онлайн тоглох', 'online', 'twui-btn--primary twui-btn--duo', { 'aria-describedby': 'twui-oncap' });
  el.tChapters = btn('Бүлгүүд', 'chapters', 'twui-btn--ghost');
  el.tColSolo = h('div', 'twui-tcol', null, [el.tSolo, el.tCont]);
  el.tColOnline = h('div', 'twui-tcol', null, [el.tOnline, h('span', 'twui-capline', { id: 'twui-oncap' }, 'Хоёр утсаар, хамтдаа')]);
  el.tColCh = h('div', 'twui-tcol twui-tcol--sm', null, [el.tChapters, h('span', 'twui-capline', { 'aria-hidden': 'true' }, ' ')]);
  el.keys = h('div', 'twui-keys', { role: 'list', 'aria-label': 'Удирдлага' });
  var inner = h('div', 'twui-inner twui-inner--title', null, [
    h('h1', 'twui-h1', null, 'ХОЁР ЕРТӨНЦ'),
    h('p', 'twui-sub', null, 'Дүүгээ ол.'),
    lead,
    h('div', 'twui-trow', null, [el.tColSolo, el.tColOnline, el.tColCh]),
    el.keys
  ]);
  return h('section', 'twui-ov twui-title', { 'aria-label': 'Хоёр ертөнц' }, [
    inner, h('p', 'twui-tag twui-tag--corner', null, 'Prototype')
  ]);
}

function buildChapters(){
  el.list = h('div', 'twui-list');
  var inner = h('div', 'twui-inner twui-inner--list', null, [
    h('h2', 'twui-h2', { id: 'twui-ch-h' }, 'Бүлгүүд'),
    el.list,
    btn('Буцах', 'back', 'twui-btn--ghost twui-btn--back')
  ]);
  return h('section', 'twui-ov twui-chapters', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'twui-ch-h' }, inner);
}

var FIG = [
  // Ах: tall, blue khadag scarf
  '<svg viewBox="0 0 24 36" width="24" height="36"><circle cx="12" cy="6.6" r="4.1" fill="currentColor"/>' +
  '<rect x="7.8" y="11.6" width="8.4" height="13" rx="2.2" fill="currentColor"/>' +
  '<rect x="8.4" y="23.4" width="2.8" height="11.6" rx="1.2" fill="currentColor"/><rect x="12.8" y="23.4" width="2.8" height="11.6" rx="1.2" fill="currentColor"/>' +
  '<path d="M8.2 12.6h7.6M15.4 12.6l4.6 3.4" stroke="#7fa7e6" stroke-width="2.1" stroke-linecap="round" fill="none"/></svg>',
  // Дүү: small girl, red ribbon
  '<svg viewBox="0 0 24 36" width="24" height="36"><circle cx="12" cy="14.2" r="3.7" fill="currentColor"/>' +
  '<path d="M9.4 18.8h5.2l2.6 10.2H6.8z" fill="currentColor"/>' +
  '<rect x="9.5" y="28" width="2.1" height="7" rx="1" fill="currentColor"/><rect x="12.4" y="28" width="2.1" height="7" rx="1" fill="currentColor"/>' +
  '<path d="M15 11.6l3.4-1.8M15 11.6l2.8 2.3" stroke="#d0343a" stroke-width="1.9" stroke-linecap="round" fill="none"/></svg>'
];

function buildLobby(){
  el.lBack = btn('Буцах', 'lobbyBack', 'twui-btn--ghost twui-btn--sm twui-lback');
  el.lTitle = h('h2', 'twui-h2 twui-h2--lobby', { id: 'twui-l-h' }, 'Онлайн тоглох');
  var head = h('div', 'twui-lhead', null, [el.lBack, el.lTitle, h('span', 'twui-lhead-sp', { 'aria-hidden': 'true' })]);

  // menu: create / join
  var vMenu = h('div', 'twui-lview twui-lview--menu', { 'data-v': 'menu' }, [
    h('div', 'twui-tiles', null, [
      h('button', 'twui-tile', { type: 'button', 'data-act': 'create', 'data-primary': '' }, [
        h('span', 'twui-tile-t', null, 'Өрөө үүсгэх'),
        h('span', 'twui-tile-s', null, 'Код аваад найздаа хэлнэ')
      ]),
      h('button', 'twui-tile', { type: 'button', 'data-act': 'joinView' }, [
        h('span', 'twui-tile-t', null, 'Өрөөнд орох'),
        h('span', 'twui-tile-s', null, 'Найзынхаа 4 үсэгтэй кодыг оруулна')
      ])
    ])
  ]);

  // not available
  el.naNote = h('p', 'twui-netnote', null, NET_NOTE);
  var vNa = h('div', 'twui-lview twui-lview--msg', { 'data-v': 'na' }, [
    h('p', 'twui-msg-big', null, 'Онлайн горим бэлэн биш'),
    el.naNote
  ]);

  // busy
  var vBusy = h('div', 'twui-lview twui-lview--msg', { 'data-v': 'busy' }, [
    h('p', 'twui-msg-big twui-busy', { role: 'status' }, [
      h('span', 'twui-dots', { 'aria-hidden': 'true' }, [h('i'), h('i'), h('i')]),
      'Холбогдож байна'
    ])
  ]);

  // error
  el.errMsg = h('p', 'twui-msg-big twui-msg-err', { role: 'alert' }, 'Сүлжээнд холбогдож чадсангүй');
  el.errNote = h('p', 'twui-netnote', null, NET_NOTE);
  var vErr = h('div', 'twui-lview twui-lview--msg', { 'data-v': 'err' }, [
    el.errMsg,
    el.errNote,
    btn('Дахин оролдох', 'retry', 'twui-btn--primary twui-btn--mid', { 'data-primary': '' })
  ]);

  // join: 4 big letter slots over one real input
  el.jInput = h('input', 'twui-code-input', {
    id: 'twui-code', type: 'text', maxlength: '4', autocomplete: 'off', autocorrect: 'off',
    autocapitalize: 'characters', spellcheck: 'false', inputmode: 'text', enterkeyhint: 'go',
    'aria-label': 'Өрөөний код, 4 үсэг', 'aria-describedby': 'twui-jerr'
  });
  el.jSlots = [];
  for(var i = 0; i < 4; i++) el.jSlots.push(h('span', 'twui-slot', { 'aria-hidden': 'true' }));
  el.jBox = h('label', 'twui-codebox', { 'for': 'twui-code' }, el.jSlots.concat([el.jInput]));
  el.jGo = btn('Орох', 'join', 'twui-btn--primary twui-btn--go', { 'data-primary': '' });
  el.jErr = h('p', 'twui-jerr', { id: 'twui-jerr', role: 'alert' });
  var vJoin = h('div', 'twui-lview twui-lview--join', { 'data-v': 'join' }, [
    h('p', 'twui-label', null, 'Найзынхаа өрөөний код'),
    h('div', 'twui-joinrow', null, [el.jBox, el.jGo]),
    el.jErr
  ]);

  // room
  el.rCode = h('div', 'twui-bigcode', { 'aria-live': 'polite' });
  el.rCodeCap = h('p', 'twui-codecap');
  el.rPeerTxt = h('span', 'twui-peer-t');
  el.rPeer = h('p', 'twui-peer', { role: 'status' }, [h('span', 'twui-peer-dot', { 'aria-hidden': 'true' }), el.rPeerTxt]);
  var left = h('div', 'twui-room-l', null, [
    h('p', 'twui-kick twui-kick--room', null, 'ӨРӨӨНИЙ КОД'), el.rCode, el.rCodeCap, el.rPeer
  ]);
  el.rRoles = []; el.rBadge = [];
  for(var r = 0; r < 2; r++){
    el.rBadge[r] = h('span', 'twui-badge');
    el.rRoles[r] = h('button', 'twui-role twui-role--' + r, { type: 'button', 'data-act': 'role', 'data-role': String(r), 'aria-pressed': 'false' }, [
      svg(FIG[r], 'twui-role-fig'),
      h('span', 'twui-role-txt', null, [h('span', 'twui-role-n', null, ROLE_NAME[r]), h('span', 'twui-role-w', null, ROLE_WORLD[r])]),
      el.rBadge[r]
    ]);
  }
  el.rNote = h('p', 'twui-note', { 'aria-live': 'polite' });
  el.rChips = h('div', 'twui-chips', { role: 'group', 'aria-label': 'Бүлэг' });
  el.rStart = btn('Эхлэх', 'ostart', 'twui-btn--primary twui-btn--start', { 'data-primary': '' });
  el.rWhy = h('p', 'twui-why', { 'aria-live': 'polite' });
  el.rHostBlock = h('div', 'twui-hostblock', null, [
    h('p', 'twui-label', null, 'Бүлэг'),
    el.rChips,
    h('div', 'twui-startrow', null, [el.rStart, el.rWhy])
  ]);
  el.rGuestCh = h('span', 'twui-guest-ch');
  el.rGuestBlock = h('div', 'twui-guestblock', null, [
    h('p', 'twui-label', null, 'Бүлэг'),
    h('p', 'twui-guest-wait', { role: 'status' }, [
      h('span', 'twui-dots', { 'aria-hidden': 'true' }, [h('i'), h('i'), h('i')]),
      'Найз чинь бүлгээ сонгож байна…'
    ]),
    el.rGuestCh
  ]);
  var right = h('div', 'twui-room-r', null, [
    h('p', 'twui-label', null, 'Дүрээ сонго'),
    h('div', 'twui-roles', { role: 'group', 'aria-label': 'Дүр' }, el.rRoles),
    el.rNote,
    el.rHostBlock,
    el.rGuestBlock
  ]);
  var vRoom = h('div', 'twui-lview twui-lview--room', { 'data-v': 'room' }, h('div', 'twui-room', null, [left, right]));

  el.lViews = [vMenu, vNa, vBusy, vErr, vJoin, vRoom];
  el.lTip = h('p', 'twui-tip', null, TIP);
  var inner = h('div', 'twui-inner twui-inner--lobby', null, [head, h('div', 'twui-lbody', null, el.lViews), el.lTip]);
  return h('section', 'twui-ov twui-lobby', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'twui-l-h' }, inner);
}

function buildPause(){
  el.pKick = h('p', 'twui-kick');
  el.pTitle = h('h2', 'twui-h2 twui-h2--pause', { id: 'twui-p-h' });
  el.pResume = btn('Үргэлжлүүлэх', 'resume', 'twui-btn--primary', { 'data-primary': '' });
  el.pRestart = btn('Бүлгийг дахин эхлэх', 'restart', 'twui-btn--ghost');
  el.pChapters = btn('Бүлгүүд', 'chapters', 'twui-btn--ghost');
  el.pRoom = btn('Бүлэг солих', 'room', 'twui-btn--ghost');
  el.pSound = btn('Дуу: асаалттай', 'sound', 'twui-btn--ghost', { 'aria-pressed': 'true' });
  el.pLeave = btn('Өрөөнөөс гарах', 'leave', 'twui-btn--ghost twui-btn--leave');
  el.pGrid = h('div', 'twui-grid', null, [el.pResume, el.pRestart, el.pChapters, el.pRoom, el.pSound, el.pLeave]);
  var inner = h('div', 'twui-inner', null, [el.pKick, el.pTitle, el.pGrid]);
  return h('section', 'twui-ov twui-pause', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'twui-p-h' }, inner);
}

function buildEnd(){
  el.eKick = h('p', 'twui-kick');
  el.eTitle = h('h2', 'twui-h2 twui-h2--end', { id: 'twui-e-h' });
  el.eText = h('p', 'twui-endtext');
  el.eStats = h('p', 'twui-stats');
  el.eNext = btn('Дараагийн бүлэг', 'next', 'twui-btn--primary', { 'data-primary': '' });
  el.eReplay = btn('Дахин тоглох', 'replay', '');
  el.eChapters = btn('Бүлгүүд', 'chapters', 'twui-btn--ghost');
  el.eRoom = btn('Бүлэг солих', 'room', 'twui-btn--ghost');
  el.eLeave = btn('Өрөөнөөс гарах', 'leave', 'twui-btn--ghost');
  el.eWait = h('p', 'twui-ewait', { role: 'status' });
  el.eTag = h('p', 'twui-tag twui-tag--cont', null, 'Үргэлжлэл бий…');
  var inner = h('div', 'twui-inner twui-inner--end', null, [
    el.eKick, el.eTitle, el.eText, el.eStats, el.eWait,
    h('div', 'twui-actions', null, [el.eNext, el.eReplay, el.eChapters, el.eRoom, el.eLeave]),
    el.eTag
  ]);
  return h('section', 'twui-ov twui-end', { role: 'dialog', 'aria-labelledby': 'twui-e-h' }, inner);
}

function buildPeerLeft(){
  el.plTitle = h('h2', 'twui-h2 twui-h2--pl', { id: 'twui-pl-h' });
  el.plMsg = h('p', 'twui-plmsg', { role: 'status' });
  el.plWait = btn('Хүлээх', 'plWait', 'twui-btn--primary', { 'data-primary': '' });
  el.plMenu = btn('Цэс', 'plMenu', 'twui-btn--ghost');
  var inner = h('div', 'twui-inner', null, [
    h('p', 'twui-kick', null, 'ОНЛАЙН'),
    el.plTitle, el.plMsg,
    h('div', 'twui-actions', null, [el.plWait, el.plMenu])
  ]);
  return h('section', 'twui-ov twui-peerleft', { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'twui-pl-h' }, inner);
}

function buildRotate(){
  var pic = svg(
    '<svg viewBox="0 0 120 120" width="120" height="120">' +
      '<rect x="25" y="41" width="70" height="38" rx="7" fill="none" stroke="rgba(232,228,218,.22)" stroke-width="2" stroke-dasharray="4 5"/>' +
      '<g class="twui-rot-phone">' +
        '<rect x="41" y="25" width="38" height="70" rx="7" fill="rgba(255,255,255,.04)" stroke="#e8e4da" stroke-width="2.4"/>' +
        '<rect x="54" y="30" width="12" height="2.4" rx="1.2" fill="#e8e4da" opacity=".7"/>' +
        '<circle cx="60" cy="88" r="2.4" fill="#d0343a"/>' +
      '</g>' +
      '<path class="twui-rot-arc" d="M93 30 A44 44 0 0 1 104 64" fill="none" stroke="#7fa7e6" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path class="twui-rot-arc" d="M98.6 59.6 L104 64.6 L108.4 58.6" fill="none" stroke="#7fa7e6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>', 'twui-rot-pic');
  return h('div', 'twui-rotate', { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Утсаа хэвтээ эргүүлнэ үү', hidden: '' }, [
    pic,
    h('p', 'twui-rot-t', null, 'Утсаа хэвтээ эргүүлнэ үү'),
    h('p', 'twui-rot-s', null, 'Хоёр ертөнц зөвхөн хэвтээ дэлгэц дээр тоглогдоно.')
  ]);
}

function buildCard(){
  el.cKick = h('div', 'twui-card-kick');
  el.cTitle = h('div', 'twui-card-title');
  el.cRole = h('div', 'twui-card-role');
  return h('div', 'twui-card', { role: 'status', 'aria-live': 'polite', hidden: '' },
    h('div', 'twui-card-in', null, [el.cKick, el.cTitle, el.cRole]));
}

function buildPauseBtn(){
  return h('button', 'twui-pausebtn', { type: 'button', 'aria-label': 'Түр зогсоох', title: 'Түр зогсоох (Esc)', hidden: '' },
    h('span', 'twui-pausebtn-ico', { 'aria-hidden': 'true' }));
}

/* ---------- render ---------- */
var LEGEND_TOUCH = [
  [[{ t: '◀︎ ▶︎', touch: 1, wide: 1 }], 'алхах'],
  [[{ t: '▲', touch: 1 }], 'үсрэх'],
  [[{ t: '◎', touch: 1 }], 'татах, дуудах'],
  [[{ t: '⇅', touch: 1 }], 'ах ↔︎ дүү']
];
var LEGEND_KEYS = [
  [[{ t: '←' }, { t: '→' }], 'алхах'],
  [[{ t: '↑' }, '/', { t: 'Space' }], 'үсрэх'],
  [[{ t: 'E' }], 'татах, дуудах'],
  [[{ t: 'Q' }, '/', { t: 'Tab' }], 'ах ↔︎ дүү'],
  [[{ t: 'Esc' }], 'түр зогсоох']
];
function renderLegend(){
  var touch = isTouch();
  if(touch === legendTouch && el.keys.firstChild) return;
  legendTouch = touch;
  var rows = touch ? LEGEND_TOUCH : LEGEND_KEYS;
  el.keys.textContent = '';
  el.keys.className = 'twui-keys' + (touch ? ' twui-keys--touch' : '');
  for(var i = 0; i < rows.length; i++){
    var keys = rows[i][0], kn = h('span', 'twui-k');
    for(var j = 0; j < keys.length; j++){
      var k = keys[j];
      if(typeof k === 'string'){ kn.appendChild(h('span', 'twui-or', { 'aria-hidden': 'true' }, k)); continue; }
      kn.appendChild(h('span', 'twui-cap' + (k.touch ? ' twui-cap--touch' : '') + (k.wide ? ' twui-cap--wide' : ''), null, k.t));
    }
    el.keys.appendChild(h('span', 'twui-krow', { role: 'listitem' }, [kn, h('span', 'twui-a', null, rows[i][1])]));
  }
}

function renderTitle(){
  var list = chapters(), t = continueTarget(list);
  var any = list.length > 0;
  show(el.tColOnline, any);
  show(el.tColCh, any);
  el.tCont.textContent = t ? chName(t) : ' ';
  renderLegend();
}

function renderChapters(){
  var list = chapters(), t = continueTarget(list);
  el.list.textContent = '';
  el.list.className = 'twui-list' + (list.length <= 1 ? ' twui-list--one' : list.length === 2 ? ' twui-list--two' : '');
  if(!list.length){
    el.list.appendChild(h('p', 'twui-empty', null, '—'));
    return;
  }
  for(var i = 0; i < list.length; i++){
    var c = list[i];
    var meta;
    if(!c.unlocked){
      meta = h('span', 'twui-chap-meta', null, [h('span', 'twui-lock', { 'aria-hidden': 'true' }), 'Түгжээтэй']);
    }else if(c.best){
      meta = h('span', 'twui-chap-meta', null, 'Шилдэг ' + fmtTime(c.best.time) + ' · ' + deathsText(c.best.deaths));
    }else{
      meta = h('span', 'twui-chap-meta', null, 'Тоглоогүй');
    }
    var label = ord(c.num) + (c.title ? ': ' + c.title : '') + '. ' + meta.textContent;
    var isNext = t && t.id === c.id && c.unlocked;
    var b = h('button', 'twui-chap' + (c.unlocked ? '' : ' is-locked') + (isNext ? ' is-next' : ''),
      { type: 'button', 'data-act': 'play', 'data-id': c.id, 'aria-label': label }, [
        h('span', 'twui-chap-num', { 'aria-hidden': 'true' }, String(c.num)),
        h('span', 'twui-chap-body', null, [
          h('span', 'twui-chap-title', null, c.title || ord(c.num)),
          meta
        ])
      ]);
    if(!c.unlocked){ b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
    if(isNext) b.setAttribute('data-primary', '');
    el.list.appendChild(b);
  }
}

function renderSound(){
  var m = !!call('isMuted');
  el.pSound.textContent = m ? 'Дуу: унтраалттай' : 'Дуу: асаалттай';
  el.pSound.setAttribute('aria-pressed', m ? 'false' : 'true');
}

/* An odd number of secondary buttons: the last one spans both columns. */
function balanceGrid(grid){
  var kids = Array.prototype.slice.call(grid.children), vis = [];
  for(var i = 0; i < kids.length; i++){
    kids[i].classList.remove('is-wide');
    if(!kids[i].hasAttribute('hidden') && !kids[i].classList.contains('twui-btn--primary')) vis.push(kids[i]);
  }
  if(vis.length % 2 === 1) vis[vis.length - 1].classList.add('is-wide');
}

function fillPause(){
  var c = current(), online = isOnline(), host = isHost(), r = myGameRole();
  el.pKick.textContent = 'Түр зогсоосон' + (c && c.num ? ' · ' + ord(c.num) : '') +
    (online && (r === 0 || r === 1) ? ' · ' + ROLE_NAME[r] : '');
  el.pTitle.textContent = (c && c.title) || 'Хоёр ертөнц';
  show(el.pChapters, !online && chapters().length > 0);
  show(el.pRoom, online && host);
  show(el.pLeave, online);
  renderSound();
  balanceGrid(el.pGrid);
}

function fillEnd(d){
  d = d || {};
  var c = current() || {};
  var online = isOnline(), host = isHost();
  var num = numOr(d.num, c.num || 0);
  el.eKick.textContent = num ? ord(num) : '';
  show(el.eKick, !!num);
  el.eTitle.textContent = d.title ? String(d.title) : (c.title || '');
  el.eText.textContent = d.endText ? String(d.endText) : '';
  show(el.eText, !!d.endText);
  var hasStats = d.time != null || d.deaths != null;
  el.eStats.textContent = hasStats ? 'Хугацаа ' + fmtTime(d.time) + ' · ' + deathsText(d.deaths) : '';
  show(el.eStats, hasStats);
  var hasNext = !!d.next;
  var canDrive = !online || host;
  show(el.eNext, hasNext && canDrive);
  show(el.eReplay, canDrive);
  show(el.eChapters, !online && chapters().length > 0);
  show(el.eRoom, online && host);
  show(el.eLeave, online);
  show(el.eWait, online && !host);
  el.eWait.textContent = hasNext ? 'Найз чинь дараагийн бүлгийг эхлүүлнэ…' : 'Найз чинь дараагийн алхмаа сонгоно…';
  show(el.eTag, !hasNext);
  var replayPrimary = canDrive && !hasNext;
  el.eReplay.className = 'twui-btn' + (replayPrimary ? ' twui-btn--primary' : '');
  if(replayPrimary) el.eReplay.setAttribute('data-primary', ''); else el.eReplay.removeAttribute('data-primary');
}

/* ---------- lobby render ---------- */
function setView(v){
  L.view = v;
  for(var i = 0; i < el.lViews.length; i++) show(el.lViews[i], el.lViews[i].getAttribute('data-v') === v);
  el.lBack.textContent = v === 'room' ? 'Гарах' : 'Буцах';
  el.lTitle.textContent = v === 'join' ? 'Өрөөнд орох' : v === 'room' ? (isHost() ? 'Чиний өрөө' : 'Найзын өрөө') : 'Онлайн тоглох';
  el.lobby.setAttribute('data-view', v);
  if(v === 'join') renderJoin();
  if(v === 'room'){ buildChips(); renderRoom(); }
  if(v === 'err'){
    el.errMsg.textContent = L.errFull ? 'Өрөө дүүрсэн байна' : 'Сүлжээнд холбогдож чадсангүй';
    show(el.errNote, !L.errFull);
  }
  if(state === 'lobby'){ if(v === 'room') startPoll(); else stopPoll(); }
  openedAt = Date.now();
  if(lastKeyboard && state === 'lobby' && v !== 'join') focusPrimary(el.lobby);
}

var CYR = { 'А':'A','В':'B','Е':'E','Ё':'E','К':'K','М':'M','Н':'H','О':'O','Р':'P','С':'C','Т':'T','У':'Y','Ү':'Y','Х':'X' };
function sanitizeCode(v){
  v = String(v || '').toUpperCase();
  var out = '';
  for(var i = 0; i < v.length && out.length < 4; i++){
    var ch = CYR[v[i]] || v[i];
    if(ch >= 'A' && ch <= 'Z') out += ch;
  }
  return out;
}
function renderJoin(){
  var v = sanitizeCode(el.jInput.value);
  var focused = document.activeElement === el.jInput;
  for(var i = 0; i < 4; i++){
    var s = el.jSlots[i];
    s.textContent = v[i] || '';
    s.className = 'twui-slot' + (v[i] ? ' is-filled' : '') + (focused && i === Math.min(v.length, 3) ? ' is-active' : '');
  }
  el.jBox.classList.toggle('is-focus', focused);
  el.jBox.classList.toggle('is-bad', !!L.joinErr);
  el.jErr.textContent = L.joinErr || ' ';
  el.jGo.disabled = v.length !== 4;
}

function buildChips(){
  var list = chapters();
  el.rChips.textContent = '';
  if(!findCh(L.selCh, list) || !findCh(L.selCh, list).unlocked){ var t = continueTarget(list); L.selCh = t ? t.id : null; }
  for(var i = 0; i < list.length; i++){
    var c = list[i];
    var b = h('button', 'twui-chip' + (c.unlocked ? '' : ' is-locked'), {
      type: 'button', 'data-act': 'pickCh', 'data-id': c.id, 'aria-pressed': 'false',
      'aria-label': ord(c.num) + (c.title ? ': ' + c.title : '') + (c.unlocked ? '' : '. Түгжээтэй')
    }, [
      h('span', 'twui-chip-n', { 'aria-hidden': 'true' }, String(c.num)),
      h('span', 'twui-chip-t', null, [c.unlocked ? null : h('span', 'twui-lock', { 'aria-hidden': 'true' }), c.title || ord(c.num)])
    ]);
    if(!c.unlocked){ b.disabled = true; }
    el.rChips.appendChild(b);
  }
}
function renderRoom(){
  if(!el.lobby || L.view !== 'room') return;
  var host = isHost(), p = peerNow(), pr = p.present ? roleOf(p.info) : null;
  el.rCode.textContent = L.code || '····';
  el.rCode.setAttribute('aria-label', 'Өрөөний код ' + (L.code || '').split('').join(' '));
  el.rCodeCap.textContent = host ? 'Найздаа энэ кодыг хэл' : 'Чи найзынхаа өрөөнд орлоо';
  el.rPeer.className = 'twui-peer' + (p.present ? ' is-on' : '');
  el.rPeerTxt.textContent = L.reconnecting ? 'Дахин холбогдож байна…' : p.present ? 'Найз чинь өрөөнд байна'
    : (host && !L.leftOnce ? 'Найзыгаа хүлээж байна…' : 'Найз чинь гарлаа — хүлээж байна…');
  for(var r = 0; r < 2; r++){
    var mine = L.myRole === r, theirs = pr === r;
    var card = el.rRoles[r];
    card.classList.toggle('is-mine', mine);
    card.classList.toggle('is-theirs', theirs && !mine);
    card.classList.toggle('is-taken', theirs && !mine && !host);
    card.setAttribute('aria-pressed', mine ? 'true' : 'false');
    el.rBadge[r].textContent = mine && theirs ? 'Чи · Найз' : mine ? 'Чи' : theirs ? 'Найз' : '';
    el.rBadge[r].className = 'twui-badge' + (mine ? ' is-me' : theirs ? ' is-friend' : '');
  }
  el.rNote.textContent = L.note || ' ';
  show(el.rHostBlock, host);
  show(el.rGuestBlock, !host);
  if(host){
    var chips = el.rChips.children;
    for(var i = 0; i < chips.length; i++){
      var on = chips[i].getAttribute('data-id') === L.selCh;
      chips[i].classList.toggle('is-on', on);
      chips[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var cs = canStart();
    el.rStart.disabled = !cs.ok;
    el.rStart.setAttribute('aria-disabled', cs.ok ? 'false' : 'true');
    el.rWhy.textContent = cs.why;
    el.rWhy.className = 'twui-why' + (cs.ok ? ' is-ok' : '');
  }else{
    var ch = p.info && p.info.ch != null ? findCh(String(p.info.ch)) : null;
    el.rGuestCh.textContent = ch ? 'Одоогоор: ' + chName(ch) : ' ';
  }
}
function startPoll(){
  if(L.poll) return;
  L.poll = setInterval(safe(function(){
    if(state !== 'lobby' || L.view !== 'room'){ stopPoll(); return; }
    resolveRoles();
    renderRoom();
  }), 900);
}
function stopPoll(){ if(L.poll){ clearInterval(L.poll); L.poll = 0; } }

/* ---------- partner left ---------- */
function showPeerLeft(kind){
  PL.kind = kind || 'left';
  PL.waiting = false;
  if(state === 'playing' && !call('isPaused')){ call('pause', true); PL.pausedByMe = true; }
  renderPeerLeft();
  setState('peerleft');
}
function renderPeerLeft(){
  var net_ = PL.kind === 'net';
  el.plTitle.textContent = net_ ? 'Сүлжээнд холбогдож чадсангүй' : 'Найз чинь гарлаа';
  if(PL.waiting){
    el.plMsg.textContent = '';
    el.plMsg.appendChild(h('span', 'twui-dots', { 'aria-hidden': 'true' }, [h('i'), h('i'), h('i')]));
    el.plMsg.appendChild(document.createTextNode('Найзыгаа хүлээж байна' + (L.code ? ' · өрөө ' + L.code : '')));
  }else{
    el.plMsg.textContent = net_ ? 'Холболт тасарлаа. Хүлээх эсвэл цэс рүү гарах уу?'
      : 'Тоглоом түр зогслоо. Найз чинь' + (L.code ? ' ' + L.code + ' кодоор' : '') + ' буцаж орж болно.';
  }
  show(el.plWait, !PL.waiting);
  el.plMenu.className = 'twui-btn ' + (PL.waiting ? 'twui-btn--primary' : 'twui-btn--ghost');
  if(PL.waiting) el.plMenu.setAttribute('data-primary', ''); else el.plMenu.removeAttribute('data-primary');
}
function hidePeerLeft(resume){
  var was = state === 'peerleft';
  if(resume && PL.pausedByMe && call('isPaused')) call('pause', false);
  PL.pausedByMe = false; PL.waiting = false;
  if(was && resume) setState('playing');
}

/* ---------- rotate overlay ---------- */
function checkRotate(){
  var portrait = window.innerHeight > window.innerWidth;
  var on = portrait && isTouchDevice();
  if(on === rotateOn) return;
  rotateOn = on;
  show(el.rotate, on);
  if(on){
    try{ if(document.activeElement && document.activeElement.blur) document.activeElement.blur(); }catch(_){}
    pauseForRotate();
  }else if(pausedByRotate){
    pausedByRotate = false;
    if(call('isPaused')) call('pause', false);
  }
}
function pauseForRotate(){
  if(!rotateOn || pausedByRotate) return;
  if(state === 'playing' && !call('isPaused')){ pausedByRotate = true; call('pause', true); }
}

/* ---------- chapter title card ---------- */
/* v2 shows one world per screen: the card sits in that world's sky (upper ~70% of the canvas),
   clear of the ground line where the characters walk. */
function gameRect(){
  var top = 0, hgt = window.innerHeight;
  try{
    var cv = document.getElementById('cv') || document.querySelector('canvas');
    if(cv){
      var r = cv.getBoundingClientRect();
      if(r.height > 60 && r.width > 60){
        top = Math.max(0, r.top);
        hgt = Math.min(r.height, window.innerHeight - top);
      }
    }
  }catch(_){}
  return { top: top, height: Math.max(150, Math.round(hgt * 0.7)) };
}
function showCard(d){
  if(!d) return;
  var num = numOr(d.num, 0), title = d.title ? String(d.title) : '';
  if(!num && !title) return;
  el.cKick.textContent = num ? ord(num) : '';
  show(el.cKick, !!num);
  el.cTitle.textContent = title;
  var online = d.mode === 'online' || isOnline();
  var r = d.role === 0 || d.role === 1 ? d.role : myGameRole();
  if(online && (r === 0 || r === 1)){
    el.cRole.textContent = 'Чи — ' + ROLE_NAME[r] + ' · ' + ROLE_WORLD[r];
    el.cRole.className = 'twui-card-role twui-card-role--' + r;
    show(el.cRole, true);
  }else show(el.cRole, false);
  var g = gameRect();
  el.card.style.top = g.top + 'px';
  el.card.style.height = g.height + 'px';
  el.card.classList.remove('is-on');
  show(el.card, true);
  void el.card.offsetWidth;           // restart the CSS animation
  el.card.classList.add('is-on');
  clearTimeout(cardTimer);
  cardTimer = setTimeout(hideCard, 2650);
}
function hideCard(){
  clearTimeout(cardTimer);
  if(!el.card) return;
  el.card.classList.remove('is-on');
  show(el.card, false);
}

/* ---------- events from the engine / network ---------- */
var onChapterStart = safe(function(d){
  if(state === 'peerleft'){ PL.pausedByMe = false; PL.waiting = false; }
  setState('playing');
  showCard(d || current());
  if(rotateOn){ pausedByRotate = false; pauseForRotate(); }
});
var onOnlineStart = safe(function(d){
  if(d && (d.role === 0 || d.role === 1)) L.myRole = d.role;
  L.at = 'game';
  pushInfo();
  if(state !== 'playing') setState('playing');
});
var onChapterEnd = safe(function(d){
  lastEnd = d || {};
  fillEnd(lastEnd);
  setState('end');
});
var onPause = safe(function(d){
  var p = !!(d && d.paused);
  if(p){
    if(state === 'playing'){ fillPause(); setState('paused'); }
  }else if(state === 'paused' || (state === 'chapters' && chaptersFrom === 'paused')){
    setState('playing');
  }
});
var onPeer = safe(function(d){
  var present = !!(d && d.present);
  var wasPresent = L.peer.seen ? L.peer.present : null;
  L.peer.seen = true;
  L.peer.present = present;
  L.peer.info = present ? (d && d.info) || L.peer.info || {} : null;
  if(!present && wasPresent) L.leftOnce = true;

  if(state === 'lobby'){
    if(L.view === 'room'){ resolveRoles(); renderRoom(); }
    return;
  }
  var inGame = isOnline() && (state === 'playing' || state === 'paused' || state === 'end' || state === 'chapters');
  if(!present && inGame){ showPeerLeft('left'); return; }
  if(present && state === 'peerleft'){
    var at = L.peer.info && L.peer.info.at;
    if(at === 'game'){ hidePeerLeft(true); }
    else{
      // the partner came back through the lobby: meet again in the room to restart together
      PL.pausedByMe = false; PL.waiting = false;
      L.selCh = defaultOnlineChapter();
      L.at = 'lobby'; pushInfo();
      setView('room'); setState('lobby');
      resolveRoles(); renderRoom();
    }
  }
});
/* net.js reports 'error' (detail notfound|full|offline|lost|cancelled) also for a failing create/join:
   while one is pending ('busy') its promise shows the precise message, so the status is ignored here. */
var onStatus = safe(function(d){
  var s = d && d.state, det = String((d && d.detail) || '');
  var rec = s === 'connecting' && det === 'reconnect';
  if(rec !== L.reconnecting && (s === 'connecting' || s === 'connected' || s === 'error' || s === 'idle')){
    L.reconnecting = rec;
    if(state === 'lobby' && L.view === 'room') renderRoom();
  }
  if(s !== 'error' || det === 'cancelled') return;
  if(state === 'lobby'){
    if(L.view === 'room'){ L.tok++; L.errFull = det === 'full'; setView('err'); }
    return;
  }
  if(isOnline() && (state === 'playing' || state === 'paused' || state === 'end')) showPeerLeft('net');
});
var onPeerMenu = safe(function(){
  if(!isOnline()) return;
  if(state === 'playing' || state === 'paused' || state === 'end' || state === 'chapters' || state === 'peerleft'){
    PL.pausedByMe = false;
    L.at = 'lobby'; pushInfo();
    setView('room'); setState('lobby');
  }
});

/* ---------- keyboard ---------- */
var NAV_KEYS = { Enter: 1, ' ': 1, Spacebar: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Tab: 1 };
var onKeyDown = safe(function(e){
  lastKeyboard = true;
  if(rotateOn){ e.stopPropagation(); return; }
  var key = e.key, isEsc = key === 'Escape' || key === 'Esc' || e.code === 'Escape';
  var isP = e.code === 'KeyP' || key === 'p' || key === 'P';
  if(e.ctrlKey || e.metaKey || e.altKey) return;

  // typing a room code: letters go to the input, Enter joins, Esc goes back; nothing reaches the game
  if(e.target === el.jInput){
    e.stopPropagation();
    if(key === 'Enter'){ e.preventDefault(); if(!e.repeat) doJoin(); }
    else if(isEsc){ e.preventDefault(); lobbyBack(); }
    return;
  }

  if(isEsc || (isP && state !== 'lobby')){
    if(e.repeat) return;
    if(state === 'playing'){ doPause(); e.preventDefault(); }
    else if(state === 'paused'){ doResume(); e.preventDefault(); }
    else if(state === 'chapters' && isEsc){ closeChapters(); e.preventDefault(); }
    else if(state === 'lobby' && isEsc){ lobbyBack(); e.preventDefault(); }
    return;
  }

  var ov = overlayFor(state);
  if(!ov || !NAV_KEYS[key]) return;
  // A menu is open: keep these keys away from the game's own key handler.
  e.stopPropagation();
  if(key === 'Tab') return;                      // native focus movement
  e.preventDefault();
  if(e.repeat && (key === 'Enter' || key === ' ' || key === 'Spacebar')) return;
  var btns = Array.prototype.slice.call(ov.querySelectorAll('button')).filter(visible);
  var a = document.activeElement, i = btns.indexOf(a);
  if(key === 'ArrowDown' || key === 'ArrowUp' || key === 'ArrowLeft' || key === 'ArrowRight'){
    if(!btns.length) return;
    var fwd = key === 'ArrowDown' || key === 'ArrowRight';
    var n = i < 0 ? (fwd ? 0 : btns.length - 1) : (i + (fwd ? 1 : -1) + btns.length) % btns.length;
    btns[n].focus();
    return;
  }
  // Enter / Space: activate the focused button, or the screen's primary one.
  // Ignored for a moment after a screen opens, so a mashed jump key cannot skip the end screen.
  if(Date.now() - openedAt < 400) return;
  var target = i >= 0 ? a : primaryOf(ov);
  if(target && target.tagName === 'INPUT'){ try{ target.focus(); }catch(_){} return; }
  if(target) target.click();
});

/* ---------- init ---------- */
function build(){
  el.root = h('div', 'twui', { id: 'twui' });
  el.title = buildTitle();
  el.chapters = buildChapters();
  el.lobby = buildLobby();
  el.pause = buildPause();
  el.end = buildEnd();
  el.peerleft = buildPeerLeft();
  el.card = buildCard();
  el.pauseBtn = buildPauseBtn();
  el.rotate = buildRotate();
  [el.card, el.pauseBtn, el.title, el.chapters, el.lobby, el.pause, el.end, el.peerleft, el.rotate]
    .forEach(function(n){ el.root.appendChild(n); });
  document.body.appendChild(el.root);

  el.root.addEventListener('click', safe(onClick));
  el.pauseBtn.addEventListener('click', safe(function(e){
    try{ e.currentTarget.blur(); }catch(_){}
    doPause();
  }));
  el.jInput.addEventListener('input', safe(function(){
    var v = sanitizeCode(el.jInput.value);
    if(el.jInput.value !== v) el.jInput.value = v;
    L.joinErr = '';
    renderJoin();
  }));
  el.jInput.addEventListener('focus', safe(renderJoin));
  el.jInput.addEventListener('blur', safe(renderJoin));

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointerdown', function(){ lastKeyboard = false; }, true);
  var relegend = safe(function(){ if(state === 'title') renderLegend(); });
  window.addEventListener('touchstart', function(){ setTimeout(relegend, 0); }, { passive: true, capture: true });
  window.addEventListener('keydown', function(){ setTimeout(relegend, 0); }, true);
  var onResize = safe(function(){
    relegend();
    checkRotate();
    if(el.card && !el.card.hasAttribute('hidden')){
      var r = gameRect(); el.card.style.top = r.top + 'px'; el.card.style.height = r.height + 'px';
    }
  });
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', function(){ setTimeout(onResize, 60); });
  document.addEventListener('visibilitychange', safe(function(){ if(document.hidden && state === 'playing') doPause(); }));

  if(typeof TW.on === 'function'){
    TW.on('chapterStart', onChapterStart);
    TW.on('chapterEnd', onChapterEnd);
    TW.on('pause', onPause);
    TW.on('onlineStart', onOnlineStart);
    TW.on('peer', onPeer);
    TW.on('peerMenu', onPeerMenu);
    TW.on('layout', safe(function(){ relegend(); checkRotate(); }));
  }
  hookNet();

  renderTitle();
  state = '';
  setView('menu');
  setState('title');
  checkRotate();
}

TW.ui = {
  init: function(game){
    try{
      if(game) G = game;
      if(built) return;
      if(!document.body){
        document.addEventListener('DOMContentLoaded', function(){ TW.ui.init(game); });
        return;
      }
      built = true;
      build();
    }catch(e){ warn(e); }
  }
};

})();
