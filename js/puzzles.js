/* Хоёр ертөнц — puzzle mini-games A (Puzzle & mini-game designer A).
   Registers TW.puzzles.{symbols, drum, stars, maze} per docs/ARCHITECTURE-v2.md "Puzzle contract".
   One player has the device (solve), the other world holds the clue (showClue) — they must talk.
   - gen(rand, params) uses only rand(); data is plain JSON, identical on both devices.
   - solve/showClue fill an empty el (≈780×290) and return a cleanup function (timers, listeners).
   - api.success()/api.fail() are called exactly once, on confirm. After success the overlay closes itself
     after a short glow (api.close()), unless the engine closed it first (cleanup cancels that timer).
   - drawDevice/drawClue draw in world coordinates (ground G), save/restore ctx, never throw.
   Also exposes TW.pzkit (shared DOM helpers + symbol/landmark art) for designer B. */
(function(){
'use strict';
var TW = window.TW = window.TW || {};
TW.puzzles = TW.puzzles || {};

var SVGNS = 'http://www.w3.org/2000/svg';
var PI = Math.PI, TAU = PI * 2;
function gY(){ return (typeof TW.G === 'number' && isFinite(TW.G)) ? TW.G : 190; }
function now(){ return (window.performance && performance.now) ? performance.now() : Date.now(); }
function report(e){ try { console.error('[puzzles] ', e); } catch (_){} }
function clamp(v, a, b){ return v < a ? a : v > b ? b : v; }

// ---------- deterministic helpers (gen uses only the rand it is given) ----------
function mulberry(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function rr(rand){ return typeof rand === 'function' ? rand : mulberry(1); }
function ri(rand, n){ var v = Math.floor(rand() * n); return v < 0 ? 0 : v >= n ? n - 1 : v; }
function shuffle(a, rand){ for (var i = a.length - 1; i > 0; i--){ var j = ri(rand, i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function gcd(a, b){ a = Math.abs(a); b = Math.abs(b); while (b){ var t = a % b; a = b; b = t; } return a; }
function lcg(seed){ var s = (seed >>> 0) || 1; return function(){ s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------- path builders ----------
function f1(v){ return Math.round(v * 10) / 10; }
function poly(pts, cont){ var s = ''; for (var i = 0; i < pts.length; i++) s += ((i || cont) ? 'L' : 'M') + f1(pts[i][0]) + ' ' + f1(pts[i][1]); return s; }
function spiral(cx, cy, r0, r1, a0, a1, n){ var o = []; for (var i = 0; i <= n; i++){ var k = i / n, a = a0 + (a1 - a0) * k, r = r0 + (r1 - r0) * k; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return o; }
function mirror(pts){ return pts.map(function(p){ return [100 - p[0], p[1]]; }); }
function ell(cx, cy, rx, ry){ return 'M' + (cx - rx) + ' ' + cy + 'A' + rx + ' ' + ry + ' 0 1 0 ' + (cx + rx) + ' ' + cy + 'A' + rx + ' ' + ry + ' 0 1 0 ' + (cx - rx) + ' ' + cy + 'Z'; }

// ---------- 9 carved symbols (тамга), stroke art in a 0..100 box ----------
var SYM = {};
(function(){
  var cl = spiral(30, 60, 3, 15, -2.5 * PI, -0.5 * PI, 44);
  var cloud = poly(cl) + 'Q38 24 50 33Q62 24 70 45' + poly(mirror(cl).reverse(), true);
  var hl = spiral(31, 40, 19, 4, 0.9, 0.9 - TAU * 1.05, 48);
  var horn = 'M50 88L50 60' + poly(hl, true) + 'M50 60' + poly(mirror(hl), true);
  var wv = function(y0){ var o = []; for (var x = 12; x <= 88; x += 2) o.push([x, y0 + 7 * Math.sin((x - 12) / 76 * TAU * 1.5)]); return poly(o); };
  var rays = ''; for (var i = 0; i < 8; i++){ var a = i * PI / 4 - PI / 2; rays += 'M' + f1(50 + 23 * Math.cos(a)) + ' ' + f1(50 + 23 * Math.sin(a)) + 'L' + f1(50 + 35 * Math.cos(a)) + ' ' + f1(50 + 35 * Math.sin(a)); }
  SYM = {
    ulzii:    {name: 'Өлзий хээ', say: 'дөрвөн гогцоотой сүлжмэл дөрвөлжин',
               d: 'M50 22L78 50L50 78L22 50ZM36 36L64 64M64 36L36 64M45 27C34 8 66 8 55 27M73 45C92 34 92 66 73 55M55 73C66 92 34 92 45 73M27 55C8 66 8 34 27 45'},
    khas:     {name: 'Хас', say: 'дөрвөн мурий салаатай эргэлдсэн тэмдэг',
               d: 'M50 50L50 28C50 14 66 12 74 20M50 50L72 50C86 50 88 66 80 74M50 50L50 72C50 86 34 88 26 80M50 50L28 50C14 50 12 34 20 26'},
    cloud:    {name: 'Үүлэн хээ', say: 'доороо хоёр ороомогтой, дээрээ долгиотой', d: cloud},
    horn:     {name: 'Эвэр хээ', say: 'иш дээрээ хоёр тийш мушгирсан эвэр', d: horn},
    wave:     {name: 'Долгион', say: 'хоёр долгионтой зураас', d: wv(37) + wv(63)},
    sun:      {name: 'Нар', say: 'туяатай дугуй', d: 'M36 50A14 14 0 1 0 64 50A14 14 0 1 0 36 50Z' + rays},
    moon:     {name: 'Сар', say: 'хавирган сар', d: 'M60 22A30 30 0 1 0 60 78A34 34 0 0 1 60 22Z'},
    fire:     {name: 'Гал', say: 'гурван хэлтэй дөл', d: 'M50 88C31 88 23 72 31 56C33 64 38 67 41 66C36 50 43 34 54 16C55 32 68 40 67 58C70 55 72 50 71 44C81 58 78 88 50 88Z'},
    mountain: {name: 'Уул', say: 'хоёр оройтой уул', d: 'M8 80L34 36L47 56L63 24L92 80ZM55 40L59 45L63 39L67 45L71 40'}
  };
})();
var SYM_IDS = ['sun', 'ulzii', 'moon', 'cloud', 'khas', 'horn', 'wave', 'fire', 'mountain'];

// ---------- 6 cave landmarks, filled silhouettes in a 0..100 box (also stroked on the map) ----------
var LM = {
  skull:  {name: 'Гавал', rule: 'evenodd',
           d: 'M50 12C27 12 15 29 15 47C15 59 21 67 29 71L29 86L71 86L71 71C79 67 85 59 85 47C85 29 73 12 50 12Z' + ell(37, 47, 9, 9) + ell(63, 47, 9, 9) + 'M50 57L44 67L56 67ZM37 76h5v10h-5ZM47.5 76h5v10h-5ZM58 76h5v10h-5Z'},
  horse:  {name: 'Морины гавал', rule: 'evenodd',
           d: 'M8 46C8 29 22 18 40 22L62 28L88 38C97 41 97 53 88 56L64 63L50 71L40 77C22 81 8 65 8 46Z' + ell(30, 41, 8, 8) + 'M50 33L84 43L83 46L49 36ZM84 56.4L81.5 50.5L79 57.8ZM76 58.7L73.5 52.8L71 60.1ZM68 61L65.5 55.1L63 62.3Z'},
  tree:   {name: 'Хугарсан мод', rule: 'nonzero',
           d: 'M37 92L42 52L22 40L27 33L43 43L44 24L50 32L54 18L58 30L60 92ZM64 92L90 76L95 84L69 97Z'},
  well:   {name: 'Худаг', rule: 'nonzero',
           d: 'M14 20h72v8h-72ZM22 28h7v40h-7ZM71 28h7v40h-7ZM49 28h2v14h-2ZM42 42h16l-3 13h-10ZM12 66h76v22h-76Z'},
  yurt:   {name: 'Гэр', rule: 'nonzero',
           d: 'M10 88L10 64C10 54 30 38 50 34C70 38 90 54 90 64L90 88ZM44 34h12v-8h-12ZM43 88L57 88L57 69L43 69ZM11 63L89 63L89 60L11 60Z'},
  stones: {name: 'Овоолсон чулуу', rule: 'nonzero',
           d: ell(27, 80, 14, 9) + ell(52, 82, 13, 8) + ell(75, 80, 14, 9) + ell(38, 63, 12, 8) + ell(63, 63, 12, 8) + ell(50, 47, 10, 7) + ell(50, 34, 5, 4)}
};
var LM_IDS = ['skull', 'horse', 'tree', 'well', 'yurt', 'stones'];

// ---------- DOM helpers ----------
function mk(tag, cls, parent, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
function sv(tag, attrs, parent){ var e = document.createElementNS(SVGNS, tag); if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function btn(parent, text, cls){ var b = mk('button', 'twpz-btn' + (cls ? ' ' + cls : ''), parent, text); b.type = 'button'; return b; }
function symSvg(id, cls){
  var s = SYM[id] || SYM.sun, svg = sv('svg', {viewBox: '0 0 100 100', 'class': 'twpz-sym' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true', focusable: 'false'});
  sv('path', {d: s.d}, svg); return svg;
}
function lmSvg(id, cls){
  var l = LM[id] || LM.skull, svg = sv('svg', {viewBox: '0 0 100 100', 'class': 'twpz-lm' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true', focusable: 'false'});
  sv('path', {d: l.d, 'fill-rule': l.rule}, svg); return svg;
}
function setLm(p, id){ var l = LM[id] || LM.skull; p.setAttribute('d', l.d); p.setAttribute('fill-rule', l.rule); }
function digitOf(e){ var m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || ''); if (m) return +m[1]; if (/^[0-9]$/.test(e.key || '')) return +e.key; return -1; }
var uid = 0;

// Layout: stage (left, interactive) + side (right: role, instruction, status, buttons — right thumb).
function layout(el, kind, clue){
  if (!el) el = document.createElement('div');
  while (el.firstChild) el.removeChild(el.firstChild);
  var root = mk('div', 'twpz twpz--' + kind + (clue ? ' twpz--clue' : ' twpz--solve'), el);
  var stage = mk('div', 'twpz-stage', root), side = mk('div', 'twpz-side', root);
  return {root: root, stage: stage, side: side};
}
function sideText(side, clue, title, note){
  mk('div', 'twpz-kick', side, clue ? 'Чи харж хэлнэ' : 'Чи хийнэ');
  mk('div', 'twpz-h', side, title);
  if (note) mk('p', 'twpz-note', side, note);
}

// Session: owns timers / rAF loops / listeners; guarantees one success|fail.
function Session(api){ this.api = api || {}; this.timers = []; this.loops = []; this.offs = []; this.done = false; this.dead = false; this.root = null; this.msg = null; }
Session.prototype.after = function(ms, fn){
  if (this.dead) return 0; var self = this, id = setTimeout(function(){ var i = self.timers.indexOf(id); if (i >= 0) self.timers.splice(i, 1); if (!self.dead){ try { fn(); } catch (e){ report(e); } } }, ms);
  this.timers.push(id); return id;
};
Session.prototype.cancel = function(id){ if (!id) return; clearTimeout(id); var i = this.timers.indexOf(id); if (i >= 0) this.timers.splice(i, 1); };
Session.prototype.loop = function(fn){
  if (this.dead) return null; var self = this, rec = {id: 0};
  function step(ts){ rec.id = 0; if (self.dead) return; var r; try { r = fn(ts); } catch (e){ report(e); r = false; } if (r !== false) rec.id = requestAnimationFrame(step); }
  rec.id = requestAnimationFrame(step); this.loops.push(rec); return rec;
};
Session.prototype.listen = function(t, type, fn, opt){ if (!t) return; t.addEventListener(type, fn, opt); this.offs.push(function(){ t.removeEventListener(type, fn, opt); }); };
// keyboard: handler returns true when it used the key (then default + propagation are stopped)
Session.prototype.keys = function(down, up){
  var self = this;
  function wrap(h){ return function(e){ if (self.dead || e.ctrlKey || e.metaKey || e.altKey) return; var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; if (h(e) === true){ e.preventDefault(); e.stopPropagation(); } }; }
  if (down) this.listen(document, 'keydown', wrap(down));
  if (up) this.listen(document, 'keyup', wrap(up));
};
Session.prototype.nudge = function(node){ if (!node) return; node.classList.remove('is-nudge'); void node.offsetWidth; node.classList.add('is-nudge'); this.after(380, function(){ node.classList.remove('is-nudge'); }); };
Session.prototype.say = function(text, kind){ if (!this.msg) return; this.msg.textContent = text || ''; this.msg.className = 'twpz-msg' + (kind ? ' is-' + kind : ''); };
Session.prototype.finish = function(ok){
  if (this.done || this.dead) return false;
  this.done = true; var api = this.api, self = this;
  if (this.root) this.root.classList.add(ok ? 'is-solved' : 'is-failed');
  this.say(ok ? 'Зөв. Нээгдлээ.' : 'Буруу. Чимээ гарлаа…', ok ? 'ok' : 'bad');
  try { if (ok){ if (typeof api.success === 'function') api.success(); } else if (typeof api.fail === 'function') api.fail(); } catch (e){ report(e); }
  if (ok) this.after(1200, function(){ self.close(); });
  return true;
};
Session.prototype.close = function(){ if (this.dead) return; try { if (typeof this.api.close === 'function') this.api.close(); } catch (e){ report(e); } };
Session.prototype.cleanup = function(){
  if (this.dead) return; this.dead = true;
  this.timers.forEach(clearTimeout); this.timers = [];
  this.loops.forEach(function(r){ if (r.id) cancelAnimationFrame(r.id); }); this.loops = [];
  this.offs.forEach(function(f){ try { f(); } catch (_){} }); this.offs = [];
};
function ender(s){ return function(){ s.cleanup(); }; }

// ---------- in-world drawing helpers ----------
function ink(P){
  var w = (P && P.world === 1) ? 1 : 0;
  if (!w) return {w: 0, base: (P && P.sil) || '#0b0a09', hole: '#000', top: 'rgba(170,154,126,0.32)',
    line: 'rgba(182,166,138,0.62)', faint: 'rgba(160,145,120,0.3)',
    lit: function(a){ return 'rgba(248,236,208,' + a + ')'; }, ghost: function(a){ return 'rgba(242,230,204,' + a + ')'; },
    star: '248,240,222', accent: (P && P.blue) || '#467dcd'};
  return {w: 1, base: '#b4bac4', hole: '#14171d', top: '#e2e5ea',
    line: 'rgba(14,18,26,0.62)', faint: 'rgba(14,18,26,0.3)',
    lit: function(a){ return 'rgba(226,234,250,' + a + ')'; }, ghost: function(a){ return 'rgba(222,230,245,' + a + ')'; },
    star: '238,242,250', accent: (P && P.red) || '#c8262d'};
}
var P2D = {};
function path2d(d){ if (typeof Path2D === 'undefined') return null; return P2D[d] || (P2D[d] = new Path2D(d)); }
// stroke a 0..100 symbol path centred at (x,y), size in world units, lw in world units
function cSym(ctx, d, x, y, size, col, lw){
  var p = path2d(d); ctx.save(); ctx.translate(x - size / 2, y - size / 2); ctx.scale(size / 100, size / 100);
  ctx.strokeStyle = col; ctx.lineWidth = lw * 100 / size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (p) ctx.stroke(p); else { ctx.fillStyle = col; ctx.fillRect(40, 40, 20, 20); }
  ctx.restore();
}
function cFill(ctx, d, rule, x, y, size, col){
  var p = path2d(d); ctx.save(); ctx.translate(x - size / 2, y - size / 2); ctx.scale(size / 100, size / 100); ctx.fillStyle = col;
  if (p) ctx.fill(p, rule || 'nonzero'); else ctx.fillRect(20, 20, 60, 60);
  ctx.restore();
}
function halo(ctx, x, y, r, c0){ var g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, c0); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
function arch(ctx, cx, base, w, h){ var r = w / 2; ctx.moveTo(cx - r, base); ctx.lineTo(cx - r, base - h + r); ctx.arc(cx, base - h + r, r, PI, 0); ctx.lineTo(cx + r, base); ctx.closePath(); }
var warned = {};
function safe(name, fn){
  return function(ctx){
    if (!ctx || typeof ctx.save !== 'function') return;
    ctx.save();
    try { ctx.beginPath(); fn.apply(null, arguments); }
    catch (err){ if (!warned[name]){ warned[name] = true; try { console.warn('[puzzles] ' + name + ': ' + (err && err.message)); } catch (_){} } }
    finally { ctx.restore(); ctx.beginPath(); }
  };
}
function ox(o){ return (o && typeof o.x === 'number' && isFinite(o.x)) ? o.x : 0; }

// =====================================================================================
// 1. symbols — тамга. Solver: 9 carved symbols, press 4 in order. Clue: grave stone with 4.
// =====================================================================================
TW.puzzles.symbols = {
  title: 'Тамгат чулуу',
  gen: function(rand, params){
    rand = rr(rand); var ids = shuffle(SYM_IDS.slice(), rand);
    return {grid: SYM_IDS.slice(), seq: ids.slice(0, 4)};            // 9·8·7·6 = 3024 orders
  },
  answerText: function(d){ return (d && d.seq || []).map(function(id){ return SYM[id] ? SYM[id].name : id; }).join(' → '); },
  drawDevice: safe('symbols.device', function(ctx, o, t, P, solved){
    var G = gY(), x = ox(o), k = ink(P), pulse = 0.75 + 0.25 * Math.sin(t * 2.4);
    if (solved) halo(ctx, x, G - 20, 34, k.lit(0.32 * pulse));
    ctx.fillStyle = k.base; ctx.beginPath(); ctx.moveTo(x - 17, G); ctx.lineTo(x - 15, G - 5); ctx.lineTo(x + 15, G - 5); ctx.lineTo(x + 17, G); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 12.5, G - 4); ctx.lineTo(x - 11.5, G - 30); ctx.quadraticCurveTo(x - 11.5, G - 36, x - 5, G - 36); ctx.lineTo(x + 5, G - 36);
    ctx.quadraticCurveTo(x + 11.5, G - 36, x + 11.5, G - 30); ctx.lineTo(x + 12.5, G - 4); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = k.top; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x - 11.2, G - 29); ctx.quadraticCurveTo(x - 11, G - 35.5, x - 5, G - 35.6); ctx.lineTo(x + 5, G - 35.6); ctx.stroke();
    ctx.strokeStyle = k.faint; ctx.lineWidth = 0.6; ctx.strokeRect(x - 9, G - 31.5, 18, 24.5);
    var col = solved ? (k.w ? k.accent : k.lit(0.95)) : k.line;
    for (var i = 0; i < 9; i++) cSym(ctx, SYM[SYM_IDS[i]].d, x + ((i % 3) - 1) * 5.6, G - 25.8 + ((i / 3) | 0) * 6.6, 4.9, col, 0.55);
  }),
  drawClue: safe('symbols.clue', function(ctx, c, data, t, P){
    var G = gY(), x = ox(c), k = ink(P), seq = (data && data.seq) || ['sun', 'moon', 'fire', 'wave'], pulse = 0.5 + 0.5 * Math.sin(t * 2);
    halo(ctx, x, G - 18, 26, k.ghost(0.07 + 0.06 * pulse));
    ctx.fillStyle = k.base; ctx.beginPath(); ctx.ellipse(x + 1, G + 0.5, 15, 3.4, 0, PI, 0); ctx.fill();
    ctx.translate(x, G); ctx.rotate(-0.07);
    ctx.fillStyle = k.base; ctx.beginPath(); ctx.moveTo(-8.5, 1); ctx.lineTo(-8.5, -23); ctx.quadraticCurveTo(-8.5, -32, 0, -32); ctx.quadraticCurveTo(8.5, -32, 8.5, -23); ctx.lineTo(8.5, 1); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = k.top; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(-8.2, -22); ctx.quadraticCurveTo(-8.2, -31.6, 0, -31.6); ctx.stroke();
    var col = k.w ? 'rgba(14,18,26,' + (0.55 + 0.25 * pulse) + ')' : 'rgba(226,212,182,' + (0.45 + 0.3 * pulse) + ')';
    for (var i = 0; i < 4; i++) cSym(ctx, (SYM[seq[i]] || SYM.sun).d, 0, -25.5 + i * 6.2, 5, col, 0.6);
  }),
  showClue: function(el, data, api){
    var s = new Session(api), L = layout(el, 'symbols', true); s.root = L.root;
    data = data || this.gen(mulberry(1)); var seq = data.seq || [], id = 'twpzst' + (++uid);
    var svg = sv('svg', {viewBox: '0 0 520 260', 'class': 'twpz-art', role: 'img', 'aria-label': 'Тамгат чулуу'}, L.stage);
    var defs = sv('defs', null, svg), gr = sv('radialGradient', {id: id, cx: '45%', cy: '38%', r: '75%'}, defs);
    sv('stop', {offset: '0', 'stop-color': '#3a3630'}, gr); sv('stop', {offset: '1', 'stop-color': '#1c1a17'}, gr);
    sv('path', {d: 'M22 236L18 70C17 40 40 22 70 20L452 16C484 16 502 36 502 66L498 238C440 246 360 244 260 246C160 248 80 246 22 236Z', fill: 'url(#' + id + ')', stroke: 'rgba(232,228,218,.14)', 'stroke-width': '1.5'}, svg);
    sv('path', {d: 'M40 60L64 84L58 110M470 50L452 74M478 232L490 210L496 196M120 232L136 214', fill: 'none', stroke: 'rgba(0,0,0,.45)', 'stroke-width': '1.4'}, svg);
    for (var i = 0; i < seq.length; i++){
      var cx = 85 + i * 117, g = sv('g', {transform: 'translate(' + (cx - 46) + ' 62) scale(.92)'}, svg), d = (SYM[seq[i]] || SYM.sun).d;
      sv('path', {d: d, 'class': 'twpz-carve-sh', transform: 'translate(1.8 2.2)'}, g);
      sv('path', {d: d, 'class': 'twpz-carve', 'data-sym': seq[i]}, g);
      for (var n = 0; n <= i; n++) sv('path', {d: 'M' + (cx - i * 6 + n * 12) + ' 192v16', 'class': 'twpz-tally'}, svg);
    }
    sideText(L.side, true, 'Тамгыг дүрсэл', 'Зүүнээс баруун тийш 4 тамга. Хэлбэрийг нь найздаа дарааллаар нь хэл.');
    mk('div', 'twpz-grow', L.side);
    mk('p', 'twpz-tip', L.side, 'Хэлбэрийг нь хэл: «дугуй, эргэн тойрон туяатай»…');
    return ender(s);
  },
  solve: function(el, data, api){
    var s = new Session(api), L = layout(el, 'symbols', false); s.root = L.root;
    data = data || this.gen(mulberry(1));
    var grid = data.grid || SYM_IDS, ans = data.seq || [], need = ans.length || 4, picked = [], btns = [];
    var keys = mk('div', 'twpz-keys', L.stage);
    grid.forEach(function(id, i){
      var b = mk('button', 'twpz-key', keys); b.type = 'button'; b.setAttribute('data-sym', id); b.setAttribute('aria-label', 'Тамга ' + (i + 1));
      b.appendChild(symSvg(id)); mk('span', 'twpz-badge', b); mk('span', 'twpz-kbd', b, String(i + 1));
      s.listen(b, 'click', function(){ press(i); });
      btns.push(b);
    });
    sideText(L.side, false, 'Дарааллаар нь дар', 'Найз чинь чулуун дээрх 4 тамгыг хэлнэ. Тэр дарааллаар нь дар.');
    mk('div', 'twpz-grow', L.side);
    var slots = mk('div', 'twpz-slots', L.side), slotEls = [];
    for (var i = 0; i < need; i++) slotEls.push(mk('div', 'twpz-slot', slots));
    s.msg = mk('div', 'twpz-msg', L.side);
    var row = mk('div', 'twpz-row', L.side), bClr = btn(row, 'Арилгах'), bGo = btn(row, 'Батлах', 'twpz-btn--go');
    function render(){
      btns.forEach(function(b, i){ var k = picked.indexOf(i); b.classList.toggle('is-on', k >= 0); b.querySelector('.twpz-badge').textContent = k >= 0 ? String(k + 1) : ''; });
      slotEls.forEach(function(sl, k){ while (sl.firstChild) sl.removeChild(sl.firstChild); sl.classList.toggle('is-full', k < picked.length); sl.classList.toggle('is-next', k === picked.length && !s.done); if (k < picked.length) sl.appendChild(symSvg(grid[picked[k]])); });
      bGo.disabled = s.done || picked.length !== need; bClr.disabled = s.done || !picked.length;
    }
    function press(i){
      if (s.done) return;
      if (picked.indexOf(i) >= 0){ s.nudge(btns[i]); return; }
      if (picked.length >= need){ s.nudge(slots); s.say('Дөрөв болсон. Батлах эсвэл Арилгах.', ''); return; }
      picked.push(i); s.say(''); render();
    }
    function confirm(){
      if (s.done) return; if (picked.length !== need){ s.nudge(slots); return; }
      var ok = picked.every(function(p, k){ return grid[p] === ans[k]; });
      s.finish(ok); render();
    }
    s.listen(bClr, 'click', function(){ if (s.done) return; picked = []; s.say(''); render(); });
    s.listen(bGo, 'click', confirm);
    s.keys(function(e){
      if (s.done) return false;
      var d = digitOf(e); if (d >= 1 && d <= grid.length){ if (!e.repeat) press(d - 1); return true; }
      if (e.key === 'Backspace'){ if (!e.repeat){ picked.pop(); render(); } return true; }
      if (e.key === 'Delete'){ picked = []; render(); return true; }
      if (e.key === 'Enter'){ if (!e.repeat) confirm(); return true; }
      return false;
    });
    render();
    return ender(s);
  }
};

// =====================================================================================
// 2. drum — бөөгийн хэнгэрэг. Clue drum flashes 5–6 long/short beats; solver taps them back.
// =====================================================================================
var DR = {lead: 700, short: 260, long: 780, gap: 380, rest: 1900, hold: 300, max: 8};
function drumTimeline(beats){ var t = DR.lead, ev = []; for (var i = 0; i < beats.length; i++){ var d = beats[i] ? DR.long : DR.short; ev.push([t, t + d]); t += d + DR.gap; } return {ev: ev, end: t - DR.gap}; }
function drumLit(beats, ms){
  var tl = drumTimeline(beats), m = ms % (tl.end + DR.rest), v = 0;
  for (var i = 0; i < tl.ev.length; i++){ var e = tl.ev[i]; if (m >= e[0] && m < e[1]) return 1; if (m >= e[1] && m < e[1] + 140) v = Math.max(v, 1 - (m - e[1]) / 140); }
  return v;
}
function drumSvg(parent){
  var svg = sv('svg', {viewBox: '-110 -110 220 220', 'class': 'twpz-drumsvg', 'aria-hidden': 'true', focusable: 'false'}, parent);
  sv('circle', {r: 105, 'class': 'twpz-drum-rim'}, svg);
  var face = sv('circle', {r: 94, 'class': 'twpz-drum-face'}, svg);
  var art = sv('g', {'class': 'twpz-drum-art'}, svg);
  sv('path', {d: 'M0 66L0 -64M0 -22L-26 -46M0 -22L26 -46M0 8L-36 -14M0 8L36 -14M0 38L-24 24M0 38L24 24M-62 66Q0 82 62 66'}, art);
  sv('circle', {cx: -52, cy: -44, r: 11}, art);
  sv('path', {d: 'M58 -57A13 13 0 1 0 58 -31A10 10 0 0 1 58 -57Z'}, art);
  for (var i = 0; i < 24; i++){ var a = i * TAU / 24; sv('circle', {cx: f1(Math.cos(a) * 86), cy: f1(Math.sin(a) * 86), r: 1.8, 'class': 'twpz-drum-dot'}, art); }
  var C = 2 * PI * 100, ring = sv('circle', {r: 100, 'class': 'twpz-drum-ring', transform: 'rotate(-90)', 'stroke-dasharray': f1(C), 'stroke-dashoffset': f1(C)}, svg);
  var rip = sv('circle', {r: 94, 'class': 'twpz-drum-rip'}, svg);
  return {svg: svg, face: face, ring: ring, rip: rip, C: C};
}
TW.puzzles.drum = {
  title: 'Бөөгийн хэнгэрэг',
  gen: function(rand, params){
    rand = rr(rand); params = params || {};
    var n = (params.beats === 5 || params.beats === 6) ? params.beats : (rand() < 1 / 3 ? 5 : 6), b = [], longs = 0;
    for (var tries = 0; tries < 60; tries++){
      b = []; longs = 0; for (var i = 0; i < n; i++){ var v = rand() < 0.5 ? 1 : 0; b.push(v); longs += v; }
      if (longs >= 2 && longs <= n - 2) break;                         // ≥2 of each: 20 (5 beats) / 50 (6 beats) patterns
    }
    if (longs < 2 || longs > n - 2){ b = []; for (var j = 0; j < n; j++) b.push(j % 2); }
    return {beats: b};
  },
  answerText: function(d){ var b = (d && d.beats) || []; return b.map(function(v){ return v ? 'урт' : 'богино'; }).join(', ') + '  (' + b.map(function(v){ return v ? '—' : '•'; }).join(' ') + ')'; },
  drawDevice: safe('drum.device', function(ctx, o, t, P, solved){
    var G = gY(), x = ox(o), k = ink(P), pulse = 0.7 + 0.3 * Math.sin(t * 2.6), cy = G - 22.5;
    if (solved) halo(ctx, x, cy, 32, k.lit(0.34 * pulse));
    ctx.strokeStyle = k.base; ctx.lineCap = 'round'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(x - 11, G); ctx.lineTo(x + 6, G - 27); ctx.moveTo(x + 11, G); ctx.lineTo(x - 6, G - 27); ctx.stroke();
    ctx.fillStyle = k.base; ctx.beginPath(); ctx.ellipse(x, cy, 12.5, 13, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = solved ? (k.w ? k.accent : k.lit(0.9)) : k.line; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.ellipse(x, cy, 10.3, 10.8, 0, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, cy + 7); ctx.lineTo(x, cy - 7); ctx.moveTo(x, cy - 2); ctx.lineTo(x - 3.5, cy - 5); ctx.moveTo(x, cy - 2); ctx.lineTo(x + 3.5, cy - 5);
    ctx.moveTo(x, cy + 2); ctx.lineTo(x - 4, cy - 0.5); ctx.moveTo(x, cy + 2); ctx.lineTo(x + 4, cy - 0.5); ctx.stroke();
    ctx.strokeStyle = k.top; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.ellipse(x, cy, 12.4, 12.9, 0, PI * 1.05, PI * 1.6); ctx.stroke();
    for (var i = 0; i < 3; i++){
      var sx = x - 4 + i * 4, sw = Math.sin(t * 2.2 + i * 1.7) * 1.2;
      ctx.strokeStyle = i === 1 ? k.accent : k.base; ctx.lineWidth = i === 1 ? 1.4 : 1.1;
      ctx.beginPath(); ctx.moveTo(sx, cy + 12.5); ctx.quadraticCurveTo(sx + sw * 0.5, cy + 16, sx + sw, cy + 19.5 - Math.abs(i - 1)); ctx.stroke();
    }
    ctx.strokeStyle = k.base; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x + 13, G); ctx.lineTo(x + 18, G - 15); ctx.stroke();
    ctx.fillStyle = k.base; ctx.beginPath(); ctx.ellipse(x + 18.4, G - 16.5, 2, 2.6, 0.3, 0, TAU); ctx.fill();
  }),
  drawClue: safe('drum.clue', function(ctx, c, data, t, P){
    var G = gY(), x = ox(c), k = ink(P), beats = (data && data.beats) || [1, 0, 0, 1, 0];
    var lit = drumLit(beats, t * 1000), cy = G - 36 + Math.sin(t * 1.3) * 1.6;
    var tr = ctx.createLinearGradient(0, cy, 0, G); tr.addColorStop(0, k.ghost(0.12)); tr.addColorStop(1, k.ghost(0));
    ctx.fillStyle = tr; ctx.beginPath(); ctx.moveTo(x - 9, cy + 6); ctx.quadraticCurveTo(x - 4, G - 6, x - 1 + Math.sin(t * 1.7) * 2, G - 1); ctx.lineTo(x + 2, G - 1); ctx.quadraticCurveTo(x + 5, G - 8, x + 9, cy + 6); ctx.closePath(); ctx.fill();
    if (lit > 0) halo(ctx, x, cy, 34, k.ghost(0.45 * lit));
    ctx.fillStyle = k.ghost(0.1 + 0.6 * lit); ctx.beginPath(); ctx.ellipse(x, cy, 12, 12.6, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = k.ghost(0.55 + 0.4 * lit); ctx.lineWidth = 1.3; ctx.stroke();
    ctx.strokeStyle = k.ghost(0.3); ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(x, cy + 7); ctx.lineTo(x, cy - 7); ctx.moveTo(x, cy - 2); ctx.lineTo(x - 3.5, cy - 5); ctx.moveTo(x, cy - 2); ctx.lineTo(x + 3.5, cy - 5); ctx.stroke();
    ctx.fillStyle = k.w ? 'rgba(10,12,16,0.22)' : 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x, G, 9, 1.6, 0, 0, TAU); ctx.fill();
  }),
  showClue: function(el, data, api){
    var s = new Session(api), L = layout(el, 'drum', true); s.root = L.root;
    data = data || this.gen(mulberry(1)); var beats = data.beats || [];
    var wrap = mk('div', 'twpz-drumwrap', L.stage), drum = mk('div', 'twpz-drum is-ghost', wrap), D = drumSvg(drum);
    sideText(L.side, true, 'Хэмнэлийг хэл', 'Хэнгэрэг богино, урт гэрэлтэнэ. Дарааллаар нь хэл: «урт, богино…»');
    mk('div', 'twpz-grow', L.side);
    var legend = mk('div', 'twpz-legend', L.side);
    mk('span', 'twpz-beat', legend); mk('span', 'twpz-legend-t', legend, 'богино');
    mk('span', 'twpz-beat twpz-beat--long', legend); mk('span', 'twpz-legend-t', legend, 'урт');
    s.msg = mk('div', 'twpz-msg', L.side);
    var bRe = btn(L.side, 'Дахин үзүүлэх', 'twpz-btn--go twpz-btn--wide'), ids = [];
    function play(){
      ids.forEach(function(id){ s.cancel(id); }); ids = []; drum.classList.remove('is-lit');
      var tl = drumTimeline(beats); L.root.classList.add('is-playing'); s.say('Ажигла…', '');
      tl.ev.forEach(function(e){ ids.push(s.after(e[0], function(){ drum.classList.add('is-lit'); })); ids.push(s.after(e[1], function(){ drum.classList.remove('is-lit'); })); });
      ids.push(s.after(tl.end + 300, function(){ L.root.classList.remove('is-playing'); s.say('Дахин харах бол доорх товч.', ''); }));
    }
    s.listen(bRe, 'click', play);
    s.keys(function(e){ if (e.key === ' ' || e.key === 'Enter'){ if (!e.repeat) play(); return true; } return false; });
    play();
    return ender(s);
  },
  solve: function(el, data, api){
    var s = new Session(api), L = layout(el, 'drum', false); s.root = L.root;
    data = data || this.gen(mulberry(1)); var ans = data.beats || [], taps = [];
    var wrap = mk('div', 'twpz-drumwrap', L.stage), drum = mk('button', 'twpz-drum', wrap); drum.type = 'button'; drum.setAttribute('aria-label', 'Хэнгэрэг');
    var D = drumSvg(drum); mk('span', 'twpz-kbd twpz-kbd--drum', drum, 'Space');
    sideText(L.side, false, 'Хэмнэлийг давт', 'Богино — товш. Урт — дараад барь. Найз чинь хэнгэргийн гэрлийг хэлнэ.');
    mk('div', 'twpz-grow', L.side);
    var beatsEl = mk('div', 'twpz-beats', L.side);
    s.msg = mk('div', 'twpz-msg', L.side);
    var row = mk('div', 'twpz-row', L.side), bClr = btn(row, 'Арилгах'), bGo = btn(row, 'Батлах', 'twpz-btn--go');
    var downAt = 0, pid = null, keyDown = false;
    function render(){
      while (beatsEl.firstChild) beatsEl.removeChild(beatsEl.firstChild);
      if (!taps.length) mk('span', 'twpz-beats-empty', beatsEl, 'Цохилт алга');
      taps.forEach(function(v){ mk('span', 'twpz-beat' + (v ? ' twpz-beat--long' : ''), beatsEl); });
      bGo.disabled = s.done || !taps.length; bClr.disabled = s.done || !taps.length;
    }
    function ringAt(k){ D.ring.setAttribute('stroke-dashoffset', f1(D.C * (1 - k))); drum.classList.toggle('is-long', k >= 1); }
    function start(){
      if (s.done || downAt) return;
      if (taps.length >= DR.max){ s.nudge(beatsEl); s.say('Хэт олон. Арилгаад дахин.', ''); return; }
      downAt = now(); drum.classList.add('is-down'); ringAt(0);
      s.loop(function(){ if (!downAt) return false; ringAt(clamp((now() - downAt) / DR.hold, 0, 1)); });
    }
    function end(){
      if (!downAt) return; var d = now() - downAt; downAt = 0;
      drum.classList.remove('is-down', 'is-long'); ringAt(0);
      if (s.done) return;
      taps.push(d >= DR.hold ? 1 : 0); s.say('');
      D.rip.classList.remove('is-go'); void D.rip.getBoundingClientRect(); D.rip.classList.add('is-go');
      render();
    }
    function abort(){ downAt = 0; drum.classList.remove('is-down', 'is-long'); ringAt(0); }
    s.listen(drum, 'pointerdown', function(e){ if (e.button > 0 || pid !== null) return; e.preventDefault(); pid = e.pointerId; try { drum.setPointerCapture(pid); } catch (_){} start(); });
    s.listen(drum, 'pointerup', function(e){ if (e.pointerId !== pid) return; pid = null; end(); });
    s.listen(drum, 'pointercancel', function(e){ if (e.pointerId !== pid) return; pid = null; abort(); });
    s.listen(drum, 'lostpointercapture', function(e){ if (e.pointerId !== pid) return; pid = null; end(); });
    s.listen(drum, 'contextmenu', function(e){ e.preventDefault(); });
    function confirm(){
      if (s.done || downAt) return; if (!taps.length){ s.nudge(beatsEl); return; }
      var ok = taps.length === ans.length && taps.every(function(v, i){ return v === ans[i]; });
      s.finish(ok); render();
    }
    s.listen(bClr, 'click', function(){ if (s.done) return; taps = []; s.say(''); render(); });
    s.listen(bGo, 'click', confirm);
    s.keys(function(e){
      if (e.key === ' ' || e.code === 'Space'){ if (!e.repeat && !keyDown && !s.done){ keyDown = true; start(); } return true; }
      if (s.done) return false;
      if (e.key === 'Backspace'){ if (!e.repeat && !downAt){ taps.pop(); render(); } return true; }
      if (e.key === 'Delete'){ taps = []; render(); return true; }
      if (e.key === 'Enter'){ if (!e.repeat) confirm(); return true; }
      return false;
    }, function(e){
      if (e.key === ' ' || e.code === 'Space'){ if (keyDown){ keyDown = false; end(); } return true; }
      return false;
    });
    render();
    return ender(s);
  }
};

// =====================================================================================
// 3. stars — одны зураг. Clue: constellation in the other world's sky. Solver: 4×3 grid, connect.
// =====================================================================================
var SC = 4, SR = 3;
function starPos(data, i, x0, y0, dx, dy){ var j = (data && data.jit && data.jit[i]) || [0, 0]; return [x0 + (i % SC) * dx + j[0] * dx, y0 + ((i / SC) | 0) * dy + j[1] * dy]; }
function ekey(a, b){ return a < b ? a + '-' + b : b + '-' + a; }
function segCross(p, q, r, s){
  function o(a, b, c){ var v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); return v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0; }
  return o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0;
}
function cellOf(i){ return [i % SC, (i / SC) | 0]; }
var COLS = ['A', 'B', 'C', 'D'];
function starName(i){ var c = cellOf(i); return COLS[c[0]] + (c[1] + 1); }
TW.puzzles.stars = {
  title: 'Одны зураг',
  gen: function(rand, params){
    rand = rr(rand); params = params || {};
    var n = (params.stars === 4 || params.stars === 5) ? params.stars : (rand() < 0.5 ? 4 : 5);
    var moves = []; for (var dx = -2; dx <= 2; dx++) for (var dy = -2; dy <= 2; dy++) if ((dx || dy) && gcd(dx, dy) === 1) moves.push([dx, dy]);
    var best = null;
    for (var tries = 0; tries < 80 && !best; tries++){
      var nodes = [ri(rand, SC * SR)], edges = [], guard = 0;
      while (nodes.length < n && guard++ < 200){
        var a = nodes[ri(rand, nodes.length)], m = moves[ri(rand, moves.length)], ca = cellOf(a), cx = ca[0] + m[0], cy = ca[1] + m[1];
        if (cx < 0 || cy < 0 || cx >= SC || cy >= SR) continue;
        var b = cy * SC + cx; if (nodes.indexOf(b) >= 0) continue;
        if (crosses(edges, a, b)) continue;
        nodes.push(b); edges.push([Math.min(a, b), Math.max(a, b)]);
      }
      if (nodes.length < n) continue;
      if (rand() < 0.4){                                                // sometimes close one loop
        for (var t2 = 0; t2 < 12; t2++){
          var u = nodes[ri(rand, n)], v = nodes[ri(rand, n)]; if (u === v) continue;
          var cu = cellOf(u), cv = cellOf(v), ddx = cv[0] - cu[0], ddy = cv[1] - cu[1];
          if (Math.abs(ddx) > 2 || Math.abs(ddy) > 2 || gcd(ddx, ddy) !== 1) continue;
          if (edges.some(function(e){ return ekey(e[0], e[1]) === ekey(u, v); }) || crosses(edges, u, v)) continue;
          edges.push([Math.min(u, v), Math.max(u, v)]); break;
        }
      }
      var rows = {}, cols = {}; nodes.forEach(function(q){ var c = cellOf(q); rows[c[1]] = 1; cols[c[0]] = 1; });
      if (Object.keys(rows).length < 2 || Object.keys(cols).length < 2) continue;
      best = {nodes: nodes, edges: edges};
    }
    if (!best) best = {nodes: [0, 5, 6, 11], edges: [[0, 5], [5, 6], [6, 11]]};
    var jit = []; for (var i = 0; i < SC * SR; i++) jit.push([Math.round((rand() - 0.5) * 16) / 100, Math.round((rand() - 0.5) * 16) / 100]);
    best.edges.sort(function(p, q){ return p[0] - q[0] || p[1] - q[1]; });
    return {cols: SC, rows: SR, nodes: best.nodes.slice().sort(function(p, q){ return p - q; }), edges: best.edges, jit: jit};
    function crosses(list, a, b){
      var pa = cellOf(a), pb = cellOf(b);
      return list.some(function(e){ if (e[0] === a || e[0] === b || e[1] === a || e[1] === b) return false; return segCross(pa, pb, cellOf(e[0]), cellOf(e[1])); });
    }
  },
  answerText: function(d){ return ((d && d.edges) || []).map(function(e){ return starName(e[0]) + '–' + starName(e[1]); }).join(', ') + '  (A–D зүүнээс, 1–3 дээрээс)'; },
  drawDevice: safe('stars.device', function(ctx, o, t, P, solved){
    var G = gY(), x = ox(o), k = ink(P), pulse = 0.7 + 0.3 * Math.sin(t * 2.2);
    if (solved){
      var bm = ctx.createLinearGradient(0, G - 30, 0, G - 110); bm.addColorStop(0, k.lit(0.28 * pulse)); bm.addColorStop(1, k.lit(0));
      ctx.fillStyle = bm; ctx.beginPath(); ctx.moveTo(x - 10, G - 29); ctx.lineTo(x - 18, G - 110); ctx.lineTo(x + 18, G - 110); ctx.lineTo(x + 10, G - 29); ctx.closePath(); ctx.fill();
      halo(ctx, x, G - 29, 24, k.lit(0.3 * pulse));
    }
    ctx.fillStyle = k.base;
    ctx.fillRect(x - 9, G - 4, 18, 4); ctx.fillRect(x - 6.5, G - 6, 13, 2.5);
    ctx.beginPath(); ctx.moveTo(x - 4.5, G - 5); ctx.lineTo(x - 3.6, G - 23); ctx.lineTo(x + 3.6, G - 23); ctx.lineTo(x + 4.5, G - 5); ctx.closePath(); ctx.fill();
    ctx.fillRect(x - 7, G - 26, 14, 3.2);
    ctx.beginPath(); ctx.ellipse(x, G - 28.4, 13.5, 4.4, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = k.top; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.ellipse(x, G - 28.4, 13.3, 4.2, 0, PI, TAU); ctx.stroke();
    ctx.fillStyle = solved ? (k.w ? k.accent : k.lit(0.95)) : k.line;
    for (var i = 0; i < 12; i++){ var c = i % 4, r = (i / 4) | 0; ctx.beginPath(); ctx.arc(x + (c - 1.5) * 5.6 + (r - 1) * 0.6, G - 28.6 + (r - 1) * 2.2, 0.62, 0, TAU); ctx.fill(); }
  }),
  drawClue: safe('stars.clue', function(ctx, c, data, t, P){
    var G = gY(), x = ox(c), k = ink(P), d = data && data.edges ? data : null;
    var nodes = d ? d.nodes : [1, 5, 6, 10], edges = d ? d.edges : [[1, 5], [5, 6], [6, 10]];
    function pos(i){ return starPos(d, i, x - 25.5, 50, 17, 16); }
    ctx.strokeStyle = 'rgba(' + k.star + ',' + (0.42 + 0.08 * Math.sin(t * 1.1)) + ')'; ctx.lineWidth = 0.6; ctx.beginPath();
    edges.forEach(function(e){ var a = pos(e[0]), b = pos(e[1]); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }); ctx.stroke();
    for (var i = 0; i < SC * SR; i++){
      var p = pos(i), on = nodes.indexOf(i) >= 0, tw = 0.75 + 0.25 * Math.sin(t * 2.3 + i * 1.9);
      if (on){ halo(ctx, p[0], p[1], 4.5, 'rgba(' + k.star + ',' + (0.35 * tw) + ')'); ctx.fillStyle = 'rgba(' + k.star + ',' + (0.95 * tw) + ')';
        ctx.beginPath(); ctx.arc(p[0], p[1], 1.25, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(' + k.star + ',' + (0.5 * tw) + ')'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(p[0] - 2.6, p[1]); ctx.lineTo(p[0] + 2.6, p[1]); ctx.moveTo(p[0], p[1] - 2.6); ctx.lineTo(p[0], p[1] + 2.6); ctx.stroke(); }
      else { ctx.fillStyle = 'rgba(' + k.star + ',' + (0.24 * tw) + ')'; ctx.beginPath(); ctx.arc(p[0], p[1], 0.6, 0, TAU); ctx.fill(); }
    }
    ctx.fillStyle = k.base; ctx.beginPath(); ctx.moveTo(x - 11, G + 1); ctx.quadraticCurveTo(x - 10, G - 7, x - 1, G - 7.5); ctx.quadraticCurveTo(x + 9, G - 7, x + 11, G + 1); ctx.closePath(); ctx.fill();
    var sp = 0.5 + 0.5 * Math.sin(t * 2);
    ctx.strokeStyle = k.w ? 'rgba(14,18,26,' + (0.5 + 0.2 * sp) + ')' : 'rgba(226,212,182,' + (0.4 + 0.3 * sp) + ')'; ctx.lineWidth = 0.6; ctx.beginPath();
    for (var q = 0; q < 5; q++){ var a1 = -PI / 2 + q * TAU * 2 / 5, a2 = -PI / 2 + (q + 1) * TAU * 2 / 5; ctx.moveTo(x + Math.cos(a1) * 3, G - 3.6 + Math.sin(a1) * 3); ctx.lineTo(x + Math.cos(a2) * 3, G - 3.6 + Math.sin(a2) * 3); }
    ctx.stroke();
  }),
  showClue: function(el, data, api){
    var s = new Session(api), L = layout(el, 'stars', true); s.root = L.root;
    data = data || this.gen(mulberry(1)); var nodes = data.nodes || [], edges = data.edges || [];
    var svg = sv('svg', {viewBox: '0 0 480 270', 'class': 'twpz-art twpz-skysvg', role: 'img', 'aria-label': 'Тэнгэр'}, L.stage);
    sv('rect', {x: 0, y: 0, width: 480, height: 270, rx: 14, 'class': 'twpz-skybg'}, svg);
    var nz = lcg(7 + nodes.length * 31 + edges.length * 977);
    for (var i = 0; i < 46; i++) sv('circle', {cx: f1(nz() * 480), cy: f1(nz() * 270), r: f1(0.5 + nz() * 0.9), 'class': 'twpz-speck'}, svg);
    var gl = sv('g', {'class': 'twpz-clines'}, svg);
    function pos(i){ return starPos(data, i, 60, 45, 120, 90); }
    edges.forEach(function(e){ var a = pos(e[0]), b = pos(e[1]); sv('line', {x1: f1(a[0]), y1: f1(a[1]), x2: f1(b[0]), y2: f1(b[1])}, gl); });
    for (var j = 0; j < SC * SR; j++){
      var p = pos(j), on = nodes.indexOf(j) >= 0, g = sv('g', {'class': 'twpz-cstar' + (on ? ' is-on' : ''), transform: 'translate(' + f1(p[0]) + ' ' + f1(p[1]) + ')', 'data-i': j}, svg);
      if (on){ sv('circle', {r: 16, 'class': 'twpz-cstar-halo'}, g); sv('path', {d: 'M-13 0L13 0M0 -13L0 13', 'class': 'twpz-cstar-x'}, g); }
      sv('circle', {r: on ? 6 : 3, 'class': 'twpz-cstar-dot'}, g);
    }
    sideText(L.side, true, 'Зургийг хэл', '4 багана, 3 эгнээ од. Аль од аль одтой холбогдсоныг хэл.');
    mk('div', 'twpz-grow', L.side);
    mk('p', 'twpz-tip', L.side, '«Дээд эгнээний 2-р одоос дунд эгнээний 3-р од руу»');
    return ender(s);
  },
  solve: function(el, data, api){
    var s = new Session(api), L = layout(el, 'stars', false); s.root = L.root;
    data = data || this.gen(mulberry(1));
    var ans = {}; (data.edges || []).forEach(function(e){ ans[ekey(e[0], e[1])] = 1; });
    var nAns = Object.keys(ans).length, edges = [], sel = -1, cur = 5, kb = false;
    var svg = sv('svg', {viewBox: '0 0 480 270', 'class': 'twpz-art twpz-skysvg', role: 'group', 'aria-label': 'Одод'}, L.stage);
    sv('rect', {x: 0, y: 0, width: 480, height: 270, rx: 14, 'class': 'twpz-skybg'}, svg);
    var nz = lcg(91);
    for (var i = 0; i < 40; i++) sv('circle', {cx: f1(nz() * 480), cy: f1(nz() * 270), r: f1(0.5 + nz() * 0.8), 'class': 'twpz-speck'}, svg);
    var gl = sv('g', {'class': 'twpz-slines'}, svg), stars = [];
    function pos(i){ return starPos(data, i, 60, 45, 120, 90); }
    for (var j = 0; j < SC * SR; j++) (function(j){
      var p = pos(j), g = sv('g', {'class': 'twpz-star', transform: 'translate(' + f1(p[0]) + ' ' + f1(p[1]) + ')', 'data-i': j, role: 'button', 'aria-label': 'Од ' + starName(j)}, svg);
      sv('circle', {r: 38, 'class': 'twpz-star-hit'}, g);
      sv('circle', {r: 17, 'class': 'twpz-star-sel'}, g);
      sv('rect', {x: -24, y: -24, width: 48, height: 48, rx: 10, 'class': 'twpz-star-cur'}, g);
      sv('path', {d: 'M-11 0L11 0M0 -11L0 11', 'class': 'twpz-star-x'}, g);
      sv('circle', {r: 5.5, 'class': 'twpz-star-dot'}, g);
      s.listen(g, 'click', function(){ kb = false; tap(j); });
      stars.push(g);
    })(j);
    sideText(L.side, false, 'Оддыг холбо', 'Хоёр одыг дараалан дарж зураас тат. Дахин татвал арилна.');
    mk('div', 'twpz-grow', L.side);
    var cnt = mk('div', 'twpz-count', L.side);
    s.msg = mk('div', 'twpz-msg', L.side);
    var row = mk('div', 'twpz-row', L.side), bClr = btn(row, 'Арилгах'), bGo = btn(row, 'Батлах', 'twpz-btn--go');
    function has(key){ return edges.indexOf(key) >= 0; }
    function render(){
      while (gl.firstChild) gl.removeChild(gl.firstChild);
      edges.forEach(function(key){ var ab = key.split('-'), a = pos(+ab[0]), b = pos(+ab[1]); sv('line', {x1: f1(a[0]), y1: f1(a[1]), x2: f1(b[0]), y2: f1(b[1])}, gl); });
      var used = {}; edges.forEach(function(key){ key.split('-').forEach(function(q){ used[q] = 1; }); });
      stars.forEach(function(g, i){ g.classList.toggle('is-sel', i === sel); g.classList.toggle('is-used', !!used[i]); g.classList.toggle('is-cur', kb && i === cur); });
      cnt.textContent = 'Зураас: ' + edges.length;
      bGo.disabled = s.done || !edges.length; bClr.disabled = s.done || !edges.length;
    }
    function tap(i){
      if (s.done) return;
      if (sel < 0){ sel = i; s.say(''); }
      else if (sel === i){ sel = -1; }
      else {
        var a = cellOf(sel), b = cellOf(i);
        if (gcd(b[0] - a[0], b[1] - a[1]) !== 1){ s.say('Дундуур нь өөр од байна.', ''); s.nudge(stars[i]); sel = i; }
        else { var key = ekey(sel, i); if (has(key)) edges.splice(edges.indexOf(key), 1); else edges.push(key); sel = -1; s.say(''); }
      }
      render();
    }
    function confirm(){
      if (s.done) return; if (!edges.length){ s.nudge(cnt); return; }
      var ok = edges.length === nAns && edges.every(function(key){ return ans[key] === 1; });
      sel = -1; s.finish(ok); render();
    }
    s.listen(bClr, 'click', function(){ if (s.done) return; edges = []; sel = -1; s.say(''); render(); });
    s.listen(bGo, 'click', confirm);
    s.keys(function(e){
      if (s.done) return false;
      var c = cellOf(cur), mv = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[e.key];
      if (mv){ kb = true; cur = clamp(c[1] + mv[1], 0, SR - 1) * SC + clamp(c[0] + mv[0], 0, SC - 1); render(); return true; }
      if (e.key === ' '){ if (!e.repeat){ if (!kb){ kb = true; render(); } else tap(cur); } return true; }
      if (e.key === 'Backspace'){ if (!e.repeat){ edges.pop(); sel = -1; render(); } return true; }
      if (e.key === 'Delete'){ edges = []; sel = -1; render(); return true; }
      if (e.key === 'Enter'){ if (!e.repeat) confirm(); return true; }
      return false;
    });
    render();
    return ender(s);
  }
};

// =====================================================================================
// 4. maze — агуйн хаалга. Solver: 3 doors × 4 steps (81). Clue: map scratched on a rock.
// =====================================================================================
var MZ = {fx0: 80, dx: 120, fy: 140, exitX: 568, icon: [[42, 74], [52, 140], [42, 206]], ir: 19};
function mapGeo(data){
  var forks = (data && data.forks) || [], out = {lines: [], ends: [], icons: [], dots: []};
  out.lines.push([[12, MZ.fy], [MZ.fx0, MZ.fy]]);
  forks.forEach(function(f, i){
    var Fx = MZ.fx0 + i * MZ.dx, last = i === forks.length - 1, NX = last ? MZ.exitX - 18 : Fx + MZ.dx, len = f.len || [0.5, 0.5, 0.5];
    out.dots.push([Fx, MZ.fy]);
    for (var sl = 0; sl < 3; sl++){
      var I = [Fx + MZ.icon[sl][0], MZ.icon[sl][1]], vx = I[0] - Fx, vy = I[1] - MZ.fy, L = Math.sqrt(vx * vx + vy * vy);
      out.lines.push([[Fx, MZ.fy], [I[0] - vx / L * (MZ.ir + 2), I[1] - vy / L * (MZ.ir + 2)]]);
      out.icons.push({x: I[0], y: I[1], lm: f.map[sl]});
      var O = [I[0] + MZ.ir + 1, I[1]], sgn = sl === 0 ? -1 : 1;
      if (sl === f.ok){
        if (sl === 1) out.lines.push([O, [NX, MZ.fy]]);
        else out.lines.push(bez(O, [O[0] + 33, O[1]], [NX - 8, MZ.fy + sgn * 36], [NX, MZ.fy + (last ? sgn * 10 : 0)], 14));
      } else {
        var E;
        if (sl === 1){ var dev = f.ok === 0 ? 9 : f.ok === 2 ? -9 : (len[sl] - 0.5) * 16; E = [O[0] + 12 + len[sl] * 8, MZ.fy + dev]; out.lines.push(bez(O, [O[0] + 8, MZ.fy], [E[0] - 6, E[1]], E, 6)); }
        else { E = [O[0] + 14 + len[sl] * 14, O[1] + sgn * (8 + len[sl] * 10)]; out.lines.push(bez(O, [O[0] + 10, O[1]], [E[0] - 6, E[1] - sgn * 4], E, 6)); }
        out.ends.push(E);
      }
    }
  });
  return out;
  function bez(p0, p1, p2, p3, n){ var o = []; for (var j = 0; j <= n; j++){ var t = j / n, u = 1 - t; o.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } return o; }
}
function wobble(pts, nz, amp){
  var o = [];
  for (var i = 0; i < pts.length - 1; i++){
    var a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.sqrt(dx * dx + dy * dy) || 1, n = Math.max(1, Math.round(L / 9)), nx = -dy / L, ny = dx / L;
    for (var j = 0; j < n; j++){ var t = j / n, w = (i === 0 && j === 0) ? 0 : (nz() - 0.5) * amp; o.push([a[0] + dx * t + nx * w, a[1] + dy * t + ny * w]); }
  }
  o.push(pts[pts.length - 1]); return o;
}
TW.puzzles.maze = {
  title: 'Агуйн хаалга',
  gen: function(rand, params){
    rand = rr(rand); var steps = 4, forks = [];
    for (var k = 0; k < steps; k++){
      var map = shuffle(LM_IDS.slice(), rand).slice(0, 3), ok = ri(rand, 3), ansLm = map[ok], doors = null;
      for (var t = 0; t < 24; t++){ doors = shuffle(map.slice(), rand); if (doors.indexOf(ansLm) !== ok) break; }
      if (doors.indexOf(ansLm) === ok){ doors.splice(ok, 1); doors.splice((ok + 1) % 3, 0, ansLm); }
      forks.push({map: map, ok: ok, doors: doors, len: [f1(rand()), f1(rand()), f1(rand())]});
    }
    return {forks: forks, seed: ri(rand, 1e9)};                         // 3^4 = 81 paths
  },
  answerText: function(d){ return ((d && d.forks) || []).map(function(f){ var lm = f.map[f.ok]; return (LM[lm] ? LM[lm].name : lm) + ' [' + (f.doors.indexOf(lm) + 1) + ']'; }).join(' → '); },
  drawDevice: safe('maze.device', function(ctx, o, t, P, solved){
    var G = gY(), x = ox(o), k = ink(P), pulse = 0.7 + 0.3 * Math.sin(t * 2.1);
    if (solved) halo(ctx, x, G - 10, 36, k.lit(0.3 * pulse));
    ctx.fillStyle = k.base; ctx.beginPath(); ctx.moveTo(x - 35, G); ctx.lineTo(x - 32, G - 13); ctx.lineTo(x - 25, G - 25); ctx.lineTo(x - 14, G - 32); ctx.lineTo(x - 3, G - 38);
    ctx.lineTo(x + 9, G - 35); ctx.lineTo(x + 20, G - 29); ctx.lineTo(x + 28, G - 18); ctx.lineTo(x + 33, G - 7); ctx.lineTo(x + 35, G); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = k.top; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x - 31, G - 14); ctx.lineTo(x - 25, G - 24.5); ctx.lineTo(x - 14, G - 31.5); ctx.lineTo(x - 3, G - 37.4); ctx.lineTo(x + 9, G - 34.4); ctx.stroke();
    var doors = [[-14, 8, 13], [0, 9.5, 16], [14, 8, 13]];
    doors.forEach(function(d){
      ctx.beginPath(); arch(ctx, x + d[0], G, d[1], d[2]);
      ctx.fillStyle = solved ? k.lit(0.55 * pulse) : k.hole; ctx.fill();
      ctx.strokeStyle = k.line; ctx.lineWidth = 0.7; ctx.stroke();
      ctx.strokeStyle = k.faint; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.arc(x + d[0], G - d[2] - 3.4, 1.4, 0, TAU); ctx.stroke();
    });
  }),
  drawClue: safe('maze.clue', function(ctx, c, data, t, P){
    var G = gY(), x = ox(c), k = ink(P), sp = 0.5 + 0.5 * Math.sin(t * 2);
    halo(ctx, x, G - 8, 24, k.ghost(0.05 + 0.05 * sp));
    ctx.fillStyle = k.base; ctx.beginPath(); ctx.moveTo(x - 18, G + 1); ctx.quadraticCurveTo(x - 19, G - 11, x - 7, G - 14); ctx.quadraticCurveTo(x + 9, G - 17, x + 16, G - 9); ctx.quadraticCurveTo(x + 19, G - 4, x + 18, G + 1); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = k.top; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(x - 17.5, G - 6); ctx.quadraticCurveTo(x - 17, G - 12.5, x - 7, G - 13.6); ctx.stroke();
    ctx.strokeStyle = k.w ? 'rgba(14,18,26,' + (0.5 + 0.2 * sp) + ')' : 'rgba(226,212,182,' + (0.42 + 0.3 * sp) + ')'; ctx.lineWidth = 0.55; ctx.beginPath();
    var forks = (data && data.forks) || [{ok: 1}, {ok: 0}, {ok: 2}, {ok: 1}], y0 = G - 7;
    ctx.moveTo(x - 15, y0);
    for (var i = 0; i < forks.length; i++){
      var fx = x - 11 + i * 6.5;
      ctx.lineTo(fx, y0); ctx.moveTo(fx, y0); ctx.lineTo(fx + 2.6, y0 - 3); ctx.moveTo(fx, y0); ctx.lineTo(fx + 2.6, y0 + 3); ctx.moveTo(fx, y0);
    }
    ctx.lineTo(x + 14, y0); ctx.stroke();
  }),
  showClue: function(el, data, api){
    var s = new Session(api), L = layout(el, 'maze', true); s.root = L.root;
    data = data || this.gen(mulberry(1)); var id = 'twpzmz' + (++uid), nz = lcg(data.seed || 1);
    var svg = sv('svg', {viewBox: '0 0 600 280', 'class': 'twpz-art twpz-map', role: 'img', 'aria-label': 'Агуйн зураг'}, L.stage);
    var defs = sv('defs', null, svg), gr = sv('radialGradient', {id: id, cx: '48%', cy: '44%', r: '70%'}, defs);
    sv('stop', {offset: '0', 'stop-color': '#37332d'}, gr); sv('stop', {offset: '1', 'stop-color': '#1b1916'}, gr);
    var rock = []; for (var a = 0; a < 28; a++){ var an = a / 28 * TAU, rx = 296 + (nz() - 0.5) * 10, ry = 136 + (nz() - 0.5) * 10, sx = Math.cos(an), sy = Math.sin(an), q = Math.pow(Math.abs(sx), 0.28) * (sx < 0 ? -1 : 1), w2 = Math.pow(Math.abs(sy), 0.28) * (sy < 0 ? -1 : 1); rock.push([300 + q * rx, 140 + w2 * ry]); }
    sv('path', {d: poly(rock) + 'Z', fill: 'url(#' + id + ')', stroke: 'rgba(232,228,218,.12)', 'stroke-width': '1.5', 'stroke-linejoin': 'round'}, svg);
    for (var i = 0; i < 70; i++) sv('circle', {cx: f1(24 + nz() * 552), cy: f1(16 + nz() * 248), r: f1(0.6 + nz() * 1.4), fill: nz() < 0.5 ? 'rgba(0,0,0,.28)' : 'rgba(255,248,230,.05)'}, svg);
    for (var cr = 0; cr < 3; cr++){ var cx0 = 60 + nz() * 480, cy0 = nz() < 0.5 ? 20 + nz() * 20 : 240 + nz() * 18, pts = [[cx0, cy0]]; for (var m = 0; m < 4; m++) pts.push([pts[m][0] + 8 + nz() * 18, pts[m][1] + (nz() - 0.5) * 16]); sv('path', {d: poly(pts), 'class': 'twpz-crack'}, svg); }
    var geo = mapGeo(data), carve = sv('g', {'class': 'twpz-scratch'}, svg);
    function scratch(pts){ var w = wobble(pts, nz, 2.2), d = poly(w); sv('path', {d: d, 'class': 'twpz-scratch-sh', transform: 'translate(1 1.3)'}, carve); sv('path', {d: d, 'class': 'twpz-scratch-ln'}, carve); }
    geo.lines.forEach(scratch);
    geo.ends.forEach(function(E){ scratch([[E[0] - 5, E[1] - 5], [E[0] + 5, E[1] + 5]]); scratch([[E[0] + 5, E[1] - 5], [E[0] - 5, E[1] + 5]]); });
    geo.dots.forEach(function(p){ sv('circle', {cx: p[0], cy: p[1], r: 3.6, 'class': 'twpz-scratch-dot'}, carve); });
    scratch([[31, 132], [40, 140], [31, 148]]);
    var ex = MZ.exitX; sv('circle', {cx: ex, cy: MZ.fy, r: 7, 'class': 'twpz-scratch-dot is-ring'}, carve);
    for (var r = 0; r < 8; r++){ var ra = r * PI / 4; scratch([[ex + Math.cos(ra) * 11, MZ.fy + Math.sin(ra) * 11], [ex + Math.cos(ra) * 17, MZ.fy + Math.sin(ra) * 17]]); }
    var lab = sv('text', {x: 26, y: 176, 'class': 'twpz-maplabel'}, svg); lab.textContent = 'орц';
    lab = sv('text', {x: ex, y: 176, 'class': 'twpz-maplabel'}, svg); lab.textContent = 'гарц';
    geo.icons.forEach(function(ic){
      sv('circle', {cx: ic.x, cy: ic.y, r: MZ.ir, 'class': 'twpz-mapdisc'}, svg);
      var g = sv('g', {transform: 'translate(' + (ic.x - 15) + ' ' + (ic.y - 15) + ') scale(.3)', 'class': 'twpz-mapicon', 'data-lm': ic.lm}, svg);
      sv('path', {d: LM[ic.lm].d, 'fill-rule': LM[ic.lm].rule}, g);
    });
    sideText(L.side, true, 'Замыг хэл', 'Орцоос гарц хүртэлх замыг ол. Салаа бүрт ямар тэмдэг рүү орохыг хэл.');
    mk('div', 'twpz-grow', L.side);
    mk('p', 'twpz-tip', L.side, '× — нурсан мухар зам. Найзынх нь хаалганы байрлал өөр.');
    return ender(s);
  },
  solve: function(el, data, api){
    var s = new Session(api), L = layout(el, 'maze', false); s.root = L.root;
    data = data || this.gen(mulberry(1));
    var forks = data.forks || [], steps = forks.length, pick = [], lockUntil = 0;
    var doorsEl = mk('div', 'twpz-doors', L.stage), doors = [];
    for (var j = 0; j < 3; j++) (function(j){
      var b = mk('button', 'twpz-door', doorsEl); b.type = 'button';
      var svg = sv('svg', {viewBox: '0 0 150 230', 'aria-hidden': 'true', focusable: 'false'}, b);
      var g = sv('g', {transform: 'translate(39 4) scale(.72)', 'class': 'twpz-door-lm'}, svg), p = sv('path', {d: LM.skull.d}, g);
      sv('path', {d: 'M30 84H120', 'class': 'twpz-door-ledge'}, svg);
      sv('path', {d: 'M22 230V142C22 108 46 92 75 92C104 92 128 108 128 142V230Z', 'class': 'twpz-door-arch'}, svg);
      sv('path', {d: 'M30 230C36 222 44 224 50 230M98 230C104 220 114 222 120 230', 'class': 'twpz-door-rubble'}, svg);
      mk('span', 'twpz-kbd', b, String(j + 1));
      s.listen(b, 'click', function(){ choose(j); });
      doors.push({b: b, p: p});
    })(j);
    var sum = mk('div', 'twpz-sum', L.stage); sum.hidden = true;
    mk('div', 'twpz-sum-t', sum, 'Сонгосон зам');
    var sumRow = mk('div', 'twpz-sum-row', sum);
    mk('div', 'twpz-sum-q', sum, 'Энэ замаар гарах уу?');
    sideText(L.side, false, 'Хаалгаа сонго', '4 салаа. Хаалганы тэмдгийг найздаа хэлж, аль руу орохыг асуу.');
    mk('div', 'twpz-grow', L.side);
    var track = mk('div', 'twpz-track', L.side), cells = [];
    for (var i = 0; i < steps; i++){ var c = mk('div', 'twpz-step', track); mk('span', 'twpz-step-n', c, String(i + 1)); cells.push(c); }
    s.msg = mk('div', 'twpz-msg', L.side);
    var row = mk('div', 'twpz-row', L.side), bBack = btn(row, 'Буцах'), bGo = btn(row, 'Гарах', 'twpz-btn--go');
    function render(){
      var k = pick.length, end = k >= steps;
      doorsEl.hidden = end; sum.hidden = !end;
      if (!end) doors.forEach(function(d, j){ var lm = forks[k].doors[j]; setLm(d.p, lm); d.b.setAttribute('data-lm', lm); d.b.setAttribute('aria-label', 'Хаалга ' + (j + 1)); });
      else { while (sumRow.firstChild) sumRow.removeChild(sumRow.firstChild); pick.forEach(function(j, q){ if (q) mk('span', 'twpz-sum-arr', sumRow, '→'); sumRow.appendChild(lmSvg(forks[q].doors[j])); }); }
      cells.forEach(function(c, q){
        var old = c.querySelector('svg'); if (old) c.removeChild(old);
        c.classList.toggle('is-done', q < k); c.classList.toggle('is-cur', q === k && !s.done);
        if (q < k) c.appendChild(lmSvg(forks[q].doors[pick[q]]));
      });
      bBack.disabled = s.done || !k; bGo.disabled = s.done || !end;
    }
    function choose(j){
      if (s.done || pick.length >= steps || now() < lockUntil) return;
      pick.push(j); lockUntil = now() + 260; s.say('');
      doorsEl.classList.remove('is-walk'); void doorsEl.offsetWidth; doorsEl.classList.add('is-walk');
      s.after(300, function(){ doorsEl.classList.remove('is-walk'); });
      render();
    }
    function back(){ if (s.done || !pick.length) return; pick.pop(); render(); }
    function confirm(){
      if (s.done) return; if (pick.length < steps){ s.nudge(track); return; }
      var ok = pick.every(function(j, q){ var f = forks[q]; return f.doors[j] === f.map[f.ok]; });
      s.finish(ok); render();
    }
    s.listen(bBack, 'click', back); s.listen(bGo, 'click', confirm);
    s.keys(function(e){
      if (s.done) return false;
      var d = digitOf(e), map = {ArrowLeft: 1, ArrowUp: 2, ArrowDown: 2, ArrowRight: 3};
      if (d < 1 && map[e.key]) d = map[e.key];
      if (d >= 1 && d <= 3){ if (!e.repeat) choose(d - 1); return true; }
      if (e.key === 'Backspace'){ if (!e.repeat) back(); return true; }
      if (e.key === 'Enter'){ if (!e.repeat) confirm(); return true; }
      return false;
    });
    render();
    return ender(s);
  }
};

// shared kit for designer B (optional to use)
TW.pzkit = {mk: mk, sv: sv, btn: btn, layout: layout, sideText: sideText, Session: Session, ender: ender, ink: ink, halo: halo,
            symbols: SYM, symbolIds: SYM_IDS, landmarks: LM, landmarkIds: LM_IDS, symSvg: symSvg, lmSvg: lmSvg, shuffle: shuffle, ri: ri};
})();
