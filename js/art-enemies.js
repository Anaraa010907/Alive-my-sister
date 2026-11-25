/* Хоёр ертөнц — enemy & environment art (Character & enemy artist).
   Registers TW.enemyArt.{wolf,raven,shulam} and TW.envArt.{grass,bones,perch}.
   Procedural Canvas 2D paths only: no images, no shadowBlur.
   Every function saves/restores ctx and never throws on missing fields.
   Local drawing frame for creatures: origin at the feet centre, x = forward (mirrored by e.face), y down. */
(function(){
'use strict';
var TW = window.TW = window.TW || {};
if (!TW.enemyArt) TW.enemyArt = {};
if (!TW.envArt) TW.envArt = {};

var PI = Math.PI, TAU = PI * 2;
var DEFP = [
  {world:0, sil:'#0b0a09', rim:'rgba(160,145,120,0.25)', eye:'#f3efe4', pale:'#c2c7cf', red:'#c8262d', blue:'#467dcd'},
  {world:1, sil:'#05060a', rim:'rgba(210,218,232,0.35)', eye:'#eef0f3', pale:'#c2c7cf', red:'#c8262d', blue:'#467dcd'}
];

// ---------- small helpers ----------
function num(v, d){ return (typeof v === 'number' && isFinite(v)) ? v : d; }
function str(v, d){ return (typeof v === 'string' && v) ? v : d; }
function clamp(v, a, b){ return v < a ? a : v > b ? b : v; }
function ease(x){ x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
function lerp(a, b, k){ return a + (b - a) * k; }
function groundY(){ return num(TW.G, 190); }
function rot(x, y, a){ var c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; }
function pal(P){
  var w = (P && P.world === 1) ? 1 : 0, d = DEFP[w];
  if (!P || typeof P !== 'object') return d;
  return {world:w, sil:str(P.sil, d.sil), rim:str(P.rim, d.rim), eye:str(P.eye, d.eye),
          pale:str(P.pale, d.pale), red:str(P.red, d.red), blue:str(P.blue, d.blue)};
}
function hashStr(s){ var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

var warned = {};
function safe(name, fn){
  return function(ctx){
    if (!ctx || typeof ctx.save !== 'function') return;
    ctx.save();
    try { ctx.beginPath(); fn.apply(null, arguments); }
    catch (err){ if (!warned[name]){ warned[name] = true; try { console.warn('[art-enemies] ' + name + ': ' + (err && err.message)); } catch (_){} } }
    finally { ctx.restore(); ctx.beginPath(); }
  };
}
// Entity frame: feet centre, facing, gait phase, state, state time. Missing fields get defaults.
function frame(e, dw, dh){
  e = (e && typeof e === 'object') ? e : {};
  var w = num(e.w, dw), h = num(e.h, dh), y = num(e.y, groundY() - h);
  var id = e.id != null ? e.id : (e.def && e.def.id != null ? e.def.id : num(e.x, 0) | 0);
  return {cx:num(e.x, 0) + w / 2, fy:y + h, face:num(e.face, 1) < 0 ? -1 : 1,
          anim:num(e.anim, 0), st:str(e.state, ''), et:Math.max(0, num(e.t, 0)),
          seed:(hashStr(id) % 1000) / 159.2};
}

// Pen: one figure is drawn twice — first widened in the rim colour, then in the silhouette colour on top,
// which leaves a thin outer rim (P.rim) so ink-black shapes read on dark skies.
function Pen(ctx, col, ex, fin, P){ this.c = ctx; this.col = col; this.ex = ex; this.fin = fin; this.P = P; }
Pen.prototype.fill = function(){ var c = this.c; if (this.ex > 0){ c.strokeStyle = this.col; c.lineWidth = this.ex; c.stroke(); } else { c.fillStyle = this.col; c.fill(); } };
Pen.prototype.line = function(lw){ var c = this.c; c.strokeStyle = this.col; c.lineWidth = lw + this.ex; c.stroke(); };
function twoPass(ctx, P, rimW, fig, q){
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (rimW > 0) fig(new Pen(ctx, P.rim, rimW, false, P), q);
  fig(new Pen(ctx, P.sil, 0, true, P), q);
}
// tapered limb segment (filled): half-widths w0 at a, w1 at b, round ends
function taper(pen, ax, ay, bx, by, w0, w1){
  var c = pen.c, dx = bx - ax, dy = by - ay, l = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / l, ny = dx / l;
  c.beginPath();
  c.moveTo(ax + nx * w0, ay + ny * w0); c.lineTo(bx + nx * w1, by + ny * w1);
  c.lineTo(bx - nx * w1, by - ny * w1); c.lineTo(ax - nx * w0, ay - ny * w0); c.closePath();
  pen.fill();   // separate fills: mixed-winding subpaths would punch holes under the nonzero rule
  c.beginPath(); c.moveTo(ax + w0, ay); c.arc(ax, ay, w0, 0, TAU); c.moveTo(bx + w1, by); c.arc(bx, by, w1, 0, TAU);
  pen.fill();
}
// two-bone IK: root a, target b, bone lengths, bend side s (-1 joint forward / up for down-forward limbs)
function ik(ax, ay, bx, by, l1, l2, s){
  var dx = bx - ax, dy = by - ay, d = Math.sqrt(dx * dx + dy * dy) || 1e-4, L = l1 + l2, mx = L * 1.08;
  if (d >= L){
    if (d > mx){ bx = ax + dx / d * mx; by = ay + dy / d * mx; }
    var k = l1 / L; return [ax + (bx - ax) * k, ay + (by - ay) * k, bx, by];
  }
  var dd = Math.max(d, Math.abs(l1 - l2) + 0.01), th = Math.atan2(dy, dx);
  var ang = th + s * Math.acos(clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1));
  var jx = ax + Math.cos(ang) * l1, jy = ay + Math.sin(ang) * l1, ex = bx - jx, ey = by - jy, el = Math.sqrt(ex * ex + ey * ey) || 1;
  return [jx, jy, jx + ex / el * l2, jy + ey / el * l2];
}
// foot path for a gait: u = cycle position, S = half stride, duty = stance share. Returns [dx, dy, lift 0..1]
function gaitFoot(u, S, duty, lift){
  u -= Math.floor(u);
  if (u < duty) return [S * (1 - 2 * u / duty), 0, 0];
  var v = (u - duty) / (1 - duty), sv = Math.sin(PI * v);
  return [-S + 2 * S * (0.5 - 0.5 * Math.cos(PI * v)), -lift * sv, sv];
}
// body axis frame (rump R -> front F); bp(q,u,v) = point u along the spine, v below it
function axis(q, A, B){ var dx = B[0] - A[0], dy = B[1] - A[1], L = Math.sqrt(dx * dx + dy * dy) || 1; q.L = L; q.ax = dx / L; q.ay = dy / L; q.ang = Math.atan2(dy, dx); q.O = A; }
function bp(q, u, v){ return [q.O[0] + q.ax * u - q.ay * v, q.O[1] + q.ay * u + q.ax * v]; }
function eyeDot(c, x, y, rx, ry, a, col, glow){
  c.fillStyle = col;
  if (glow > 0){ c.globalAlpha = 0.13 * glow; c.beginPath(); c.arc(x, y, rx * 2.1, 0, TAU); c.fill(); c.globalAlpha = 1; }
  c.beginPath(); c.ellipse(x, y, rx, ry, a, 0, TAU); c.fill();
}

// =====================================================================================
// WOLF — lean Mongolian steppe wolf. Hitbox 34x20, withers ≈ 21.
// =====================================================================================
function wolfPose(f, t){
  var st = f.st, A = f.anim, et = f.et, k;
  var q = {R:[-11, -19.4], F:[7, -21], D:8, W:5.2, Rd:6.6, arch:0.6,
    hd:{x:14.6, y:-19.6, a:0.24, ear:0, jaw:0, eye:1},
    tail:{a:1.12, bend:-0.34, len:12.5}, hack:0, glow:0.45, sit:false, legs:[], stance:null, gait:null};
  var bob = 0;
  if (st === 'sniff'){
    var sn = Math.sin(t * 11) * 0.5, sw = Math.sin(t * 1.7);
    q.R = [-11, -20.2]; q.F = [7, -18.4]; q.arch = 1.6; q.neck = 7;
    q.hd = {x:15.6 + sw * 0.7, y:-6.2 + sn * 0.5, a:1.0 + sn * 0.05, ear:0.35, jaw:0, eye:0.8};
    q.tail = {a:1.2 + Math.sin(t * 1.9) * 0.06, bend:-0.38, len:12};
    q.stance = [2.2, 0.2, -1.0, 0.8];
  } else if (st === 'alert'){
    k = ease(et / 0.14);
    q.R = [-11, -19.6]; q.F = [7.5, -21.6]; q.arch = 0.2;
    q.hd = {x:lerp(14.6, 13.8, k), y:lerp(-19.6, -25.4, k), a:lerp(0.24, -0.08, k), ear:k, jaw:0, eye:1};
    q.tail = {a:lerp(1.12, 0.42, k), bend:0.06, len:12.6};
    q.hack = k; q.glow = 1;
    q.stance = [2.4, 0.3, -1.6, 0.2];
  } else if (st === 'chase'){
    q.gait = 'gallop';
    var cc = Math.cos(A), ss = Math.sin(A), L = 20 + 3.3 * cc, by = -16.4 - 1.2 * cc * cc, pt = 0.07 * ss, cx0 = -2.4;
    q.F = [cx0 + L / 2 * Math.cos(pt), by - L / 2 * Math.sin(pt) - 0.8];
    q.R = [cx0 - L / 2 * Math.cos(pt), by + L / 2 * Math.sin(pt) + 0.5];
    q.D = 7.3; q.W = 4.4; q.Rd = 6.2; q.arch = 0.4 + 2.6 * (1 - cc) / 2;
    q.hd = {x:q.F[0] + 7.4, y:q.F[1] + 1.6 + 0.6 * ss, a:0.12 - 0.07 * ss, ear:-1, jaw:0.35, eye:1};
    q.tail = {a:0.14 + 0.1 * Math.sin(A * 2 + 1), bend:-0.14, len:13};
    q.glow = 1;
  } else if (st === 'howl'){
    k = ease(et / 0.4);
    var vib = 0.5 + 0.5 * Math.sin(t * 8);
    q.sit = true; q.R = [-8.6, -8.8]; q.F = [3.0, -19.8]; q.D = 7.6; q.W = 5.6; q.Rd = 6.4; q.arch = 0.2;
    q.hd = {x:lerp(8.8, 7.8, k), y:lerp(-25.4, -28.4, k) + Math.sin(t * 30) * 0.12 * k, a:lerp(-0.5, -1.12, k),
            ear:lerp(-0.2, -0.7, k), jaw:k * (0.45 + 0.3 * vib), eye:0.6};
    q.tail = {a:0.2, bend:0.5, len:12.5};
    q.stance = [5.8, 3.8];
  } else if (st === 'lost'){
    q.gait = 'trot';
    q.hd = {x:15.2, y:-18.2, a:0.4 + 0.05 * Math.sin(t * 1.3), ear:-0.35, jaw:0, eye:0.8};
    q.tail = {a:1.26 + 0.05 * Math.sin(A), bend:-0.2, len:12.2};
  } else { // 'patrol' and every unknown state: walk cycle (stands still when anim does not change)
    q.gait = 'walk';
    q.tail.a += 0.05 * Math.sin(t * 1.8 + f.seed);
  }
  if (q.gait === 'walk') bob = 0.35 * Math.cos(2 * A);
  if (q.gait === 'trot') bob = -0.6 * (0.5 - 0.5 * Math.cos(2 * A));
  if (bob){ q.R[1] += bob; q.F[1] += bob; q.hd.y += bob * 0.6; }
  axis(q, q.R, q.F);
  q.fr = bp(q, q.L - 2.0, q.D - 1.9);
  q.hr = bp(q, 2.4, q.Rd * 0.5);
  var fr = q.fr, hr = q.hr, i, g, u;
  if (q.gait === 'walk' || q.gait === 'trot'){
    var cyc = A / TAU, W = q.gait === 'walk';
    var S = W ? 5.2 : 6.2, duty = W ? 0.62 : 0.46, lift = W ? 2.6 : 3.4;
    var ph = W ? [0.25, 0.75, 0, 0.5] : [0, 0.5, 0.5, 0];   // nearF, farF, nearH, farH
    for (i = 0; i < 4; i++){
      g = gaitFoot(cyc + ph[i], S, duty, lift); var front = i < 2, root = front ? fr : hr;
      q.legs.push({fr:front, far:i % 2 === 1, x:root[0] + (front ? 0.6 : 0.4) + g[0], y:g[1], lift:g[2]});
    }
  } else if (q.gait === 'gallop'){
    for (i = 0; i < 2; i++){
      u = A - (i ? 0.5 : 0);
      q.legs.push({fr:true, far:!!i, x:fr[0] + 2.4 + 8.2 * Math.cos(u), y:-0.4 - 5.2 * Math.max(0, -Math.sin(u + 0.5)), lift:Math.max(0, -Math.sin(u + 0.5))});
      q.legs.push({fr:false, far:!!i, x:hr[0] + 1.0 - 8.4 * Math.cos(u), y:-0.4 - 4.6 * Math.max(0, Math.sin(u + 0.5)), lift:Math.max(0, Math.sin(u + 0.5))});
    }
  } else if (q.sit){
    q.legs.push({fr:true, far:false, x:q.stance[0], y:0, lift:0}, {fr:true, far:true, x:q.stance[1], y:0, lift:0});
  } else {
    var o = q.stance || [0, 0, 0, 0];
    q.legs.push({fr:true, far:false, x:fr[0] + 0.6 + o[0], y:0, lift:0}, {fr:true, far:true, x:fr[0] + 0.6 + o[1], y:0, lift:0},
                {fr:false, far:false, x:hr[0] + 0.4 + o[2], y:0, lift:0}, {fr:false, far:true, x:hr[0] + 0.4 + o[3], y:0, lift:0});
  }
  return q;
}
function wolfLeg(pen, q, lg){
  var c = pen.c, j, dx, dy, dl;
  if (lg.fr){
    var r = q.fr;
    j = ik(r[0], r[1], lg.x, lg.y, 7.4, 5.9, -1);
    taper(pen, r[0], r[1], j[0], j[1], 1.55, 1.05);
    c.beginPath(); c.moveTo(j[0], j[1]); c.lineTo(j[2], j[3]);
    dx = j[2] - j[0]; dy = j[3] - j[1]; dl = Math.sqrt(dx * dx + dy * dy) || 1;
    c.lineTo(j[2] + dy / dl * 1.7, j[3] - dx / dl * 1.7);
    pen.line(1.75);
  } else {
    var H = q.hr, vx = H[0] - lg.x, vy = H[1] - lg.y, vl = Math.sqrt(vx * vx + vy * vy) || 1;
    var mt = rot(vx / vl * 5.6, vy / vl * 5.6, -0.42 - 0.4 * lg.lift), hk = [lg.x + mt[0], lg.y + mt[1]];
    j = ik(H[0], H[1], hk[0], hk[1], 7.0, 6.4, -1);
    taper(pen, H[0], H[1], j[0], j[1], 2.7, 1.35);
    c.beginPath(); c.moveTo(j[0], j[1]); c.lineTo(j[2], j[3]); pen.line(2.0);
    dx = lg.x - j[2]; dy = lg.y - j[3]; dl = Math.sqrt(dx * dx + dy * dy) || 1;
    c.beginPath(); c.moveTo(j[2], j[3]); c.lineTo(lg.x, lg.y); c.lineTo(lg.x + dy / dl * 1.7, lg.y - dx / dl * 1.7); pen.line(1.6);
  }
}
function wolfTail(pen, q){
  var c = pen.c, T = q.tail, B = bp(q, -1.3, 1.1), n = 9, i, s, pts = [], nrm = [];
  var dA = [-Math.cos(T.a), Math.sin(T.a)], dC = [-Math.cos(T.a + T.bend), Math.sin(T.a + T.bend)];
  var C = [B[0] + dC[0] * T.len * 0.55, B[1] + dC[1] * T.len * 0.55], E = [B[0] + dA[0] * T.len, B[1] + dA[1] * T.len];
  for (i = 0; i <= n; i++){
    s = i / n; var m = 1 - s;
    pts.push([m * m * B[0] + 2 * m * s * C[0] + s * s * E[0], m * m * B[1] + 2 * m * s * C[1] + s * s * E[1]]);
    var tx = 2 * m * (C[0] - B[0]) + 2 * s * (E[0] - C[0]), ty = 2 * m * (C[1] - B[1]) + 2 * s * (E[1] - C[1]), tl = Math.sqrt(tx * tx + ty * ty) || 1;
    nrm.push([-ty / tl, tx / tl]);
  }
  c.beginPath();
  for (i = 0; i <= n; i++){ s = i / n; var hw = 0.9 * (1 - s) + 0.35 * s + 1.5 * Math.sin(PI * Math.pow(s, 0.7)); c[i ? 'lineTo' : 'moveTo'](pts[i][0] + nrm[i][0] * hw, pts[i][1] + nrm[i][1] * hw); }
  for (i = n; i >= 0; i--){ s = i / n; var hw2 = (0.9 * (1 - s) + 0.35 * s + 1.5 * Math.sin(PI * Math.pow(s, 0.7))) * (i % 2 ? 1.12 : 1); c.lineTo(pts[i][0] - nrm[i][0] * hw2, pts[i][1] - nrm[i][1] * hw2); }
  c.closePath(); pen.fill();
}
function wolfBody(pen, q){
  var c = pen.c, L = q.L, D = q.D, W = q.W, Rd = q.Rd, ar = q.arch, i;
  c.save(); c.translate(q.R[0], q.R[1]); c.rotate(q.ang);
  c.beginPath();
  c.moveTo(-1.6, 0.7);
  c.quadraticCurveTo(L * 0.45, -ar, L, -0.4);
  c.quadraticCurveTo(L + 3.3, 0.3, L + 2.9, D * 0.5);
  c.quadraticCurveTo(L + 2.5, D * 0.98, L - 1.6, D);
  c.quadraticCurveTo(L * 0.62, D + 0.2, L * 0.38, W + 0.3);
  c.quadraticCurveTo(L * 0.18, W - 0.2, 2.8, Rd + 0.9);
  c.quadraticCurveTo(-0.6, Rd + 2.0, -2.9, Rd * 0.55);
  c.quadraticCurveTo(-3.3, 1.3, -1.6, 0.7);
  c.closePath();
  pen.fill();
  if (q.hack > 0){ // raised hackles along the shoulders
    c.beginPath();
    for (i = 0; i < 5; i++){ var u = L * (0.55 + i * 0.1); c.moveTo(u - 1.0, 0.2); c.lineTo(u + 0.9, 0.2); c.lineTo(u - 0.9, -0.5 - 1.5 * q.hack * (0.7 + 0.3 * (i % 2))); c.closePath(); }
    pen.fill();
  }
  c.restore();
}
function wolfEar(pen, e, ox, oy){
  var c = pen.c, tip = e >= 0 ? [lerp(-2.3, -1.1, e), lerp(-7.4, -8.4, e)] : [lerp(-2.3, -6.6, -e), lerp(-7.4, -3.9, -e)];
  c.beginPath(); c.moveTo(-3.4 + ox, -1.6 + oy); c.quadraticCurveTo(-3.2 + ox + (tip[0] + 2.3) * 0.2, -4 + oy, tip[0] + ox, tip[1] + oy);
  c.lineTo(0.1 + ox, -2.9 + oy); c.closePath(); pen.fill();
}
function wolfHead(pen, q){
  var c = pen.c, h = q.hd;
  var nt = bp(q, q.L - (q.neck || 4.2), 0.1), nb = bp(q, q.L + 2.6, q.D * 0.55);
  var ht = rot(-2.6, -2.2, h.a), hb = rot(-0.4, 3.0, h.a);
  ht = [h.x + ht[0], h.y + ht[1]]; hb = [h.x + hb[0], h.y + hb[1]];
  c.beginPath(); c.moveTo(nt[0], nt[1]);
  c.quadraticCurveTo((nt[0] + ht[0]) / 2, (nt[1] + ht[1]) / 2 - 1.0, ht[0], ht[1]);
  c.lineTo(hb[0], hb[1]);
  c.quadraticCurveTo((hb[0] + nb[0]) / 2 + 0.6, (hb[1] + nb[1]) / 2 + 0.8, nb[0], nb[1]);
  c.closePath();
  pen.fill();
  if (q.hack > 0){ // hackles on the nape
    c.beginPath();
    for (var i = 1; i < 4; i++){ var s = i / 4, x = lerp(nt[0], ht[0], s), y = lerp(nt[1], ht[1], s) - 0.6;
      c.moveTo(x - 1.0, y + 0.6); c.lineTo(x - 1.1, y - 1.4 * q.hack); c.lineTo(x + 0.9, y + 0.5); c.closePath(); }
    pen.fill();
  }
  var nc = bp(q, q.L - 0.8, q.D * 0.35), hc = rot(-1.2, 0.3, h.a);   // solid neck core
  taper(pen, nc[0], nc[1], h.x + hc[0], h.y + hc[1], 3.3, 2.5);
  c.save(); c.translate(h.x, h.y); c.rotate(h.a);
  wolfEar(pen, h.ear, 1.3, 0.3);
  c.beginPath(); c.ellipse(0, 0, 4.1, 3.3, 0, 0, TAU); pen.fill();
  c.beginPath();                                   // muzzle
  c.moveTo(0.4, -3.0); c.quadraticCurveTo(4.6, -2.5, 8.2, -1.2); c.quadraticCurveTo(9.3, -0.8, 9.1, 0.2);
  c.lineTo(8.6, 0.7); c.lineTo(2.2, 1.3); c.lineTo(0.2, 2.2); c.closePath(); pen.fill();
  c.save(); c.translate(1.2, 1.0); c.rotate(h.jaw * 0.5);   // lower jaw
  c.beginPath(); c.moveTo(-1.6, -0.3); c.lineTo(6.9, -0.2); c.lineTo(6.6, 0.6); c.quadraticCurveTo(3.2, 2.0, -1.4, 2.3); c.closePath(); pen.fill();
  c.restore();
  c.beginPath();                                   // cheek ruff
  c.moveTo(-2.4, -1.2); c.lineTo(-5.0, 1.4); c.lineTo(-3.5, 1.7); c.lineTo(-4.1, 3.8); c.lineTo(-2.3, 2.9);
  c.lineTo(-1.7, 4.6); c.lineTo(-0.5, 3.1); c.lineTo(0.9, 3.8); c.lineTo(1.4, 1.2); c.closePath(); pen.fill();
  wolfEar(pen, h.ear, 0, 0);
  if (pen.fin) eyeDot(c, 3.1, -1.0, 1.0 * h.eye, 0.62 * h.eye, -0.28, pen.P.eye, q.glow);
  c.restore();
}
function wolfFigure(pen, q){
  var i, c = pen.c;
  for (i = 0; i < q.legs.length; i++) if (q.legs[i].far) wolfLeg(pen, q, q.legs[i]);
  wolfTail(pen, q);
  wolfBody(pen, q);
  if (q.sit){
    c.beginPath(); c.ellipse(-5.4, -4.5, 6.2, 4.5, -0.3, 0, TAU); pen.fill();          // haunch on the ground
    c.beginPath(); c.moveTo(-9.8, -1.6); c.lineTo(-2.0, -0.9); pen.line(2.0);           // hind paw
    c.beginPath(); c.moveTo(-7.6, -1.2); c.lineTo(0.4, -0.8); pen.line(1.6);
  }
  wolfHead(pen, q);
  for (i = 0; i < q.legs.length; i++) if (!q.legs[i].far) wolfLeg(pen, q, q.legs[i]);
}
TW.enemyArt.wolf = safe('wolf', function(ctx, e, t, P){
  P = pal(P); t = num(t, 0);
  var f = frame(e, 34, 20), q = wolfPose(f, t);
  ctx.translate(f.cx, f.fy); ctx.scale(f.face, 1);
  twoPass(ctx, P, 1.3, wolfFigure, q);
});

// =====================================================================================
// RAVEN — perched, ~10 tall. Hitbox 14x10, feet on the perch.
// =====================================================================================
function ravenPose(f, t){
  var st = f.st, et = f.et, sd = f.seed;
  var q = {b:0.25 * Math.sin(t * 2.3 + sd), lean:0, puff:1, ruffle:0, hx:2.7, hy:-9.4, ha:0.05, front:false,
           jaw:0, wings:null, caw:0, tailA:0, wob:0};
  if (st === 'look'){
    q.front = true; q.hx = 1.6; q.hy = -9.7; q.wob = Math.sin(et * 16) * 0.35; q.b *= 0.5;
  } else if (st === 'alarm'){
    var fl = Math.sin(t * 15 + sd);
    q.wings = {a:-2.2 + 0.6 * fl, a2:-1.75 + 0.6 * Math.sin(t * 15 + sd - 0.6)};
    q.caw = Math.max(0, Math.sin(t * 7.5)); q.jaw = q.caw;
    q.lean = 0.22; q.hx = 3.2 + 0.7 * q.caw; q.hy = -9.5 - 0.4 * q.caw; q.ha = -0.12 - 0.18 * q.caw;
    q.b = 0.35 * fl; q.puff = 1.05; q.tailA = -0.12 * fl;
  } else if (st === 'cooldown'){
    q.ruffle = 1; q.puff = 1.1 + 0.03 * Math.sin(t * 1.5); q.hx = 2.2; q.hy = -8.7; q.ha = 0.24;
    var sh = et < 0.6 ? (1 - et / 0.6) : 0; q.lean = 0.14 * Math.sin(et * 46) * sh;
  } else { // 'perch' + default: idle bob, slow glances, occasional dip, tail flick
    var dip = Math.pow(Math.max(0, Math.sin(t * 1.3 + sd * 2)), 14);
    q.hy += 0.7 * dip; q.ha = 0.06 + 0.1 * Math.sin(t * 0.8 + sd) + 0.35 * dip;
    q.tailA = 0.12 * Math.pow(Math.max(0, Math.sin(t * 0.9 + sd)), 20);
  }
  return q;
}
function ravenWing(pen, sx, sy, a, sc){
  var c = pen.c; c.save(); c.translate(sx, sy); c.rotate(a); c.scale(sc, -sc);
  c.beginPath(); c.moveTo(0, -1.1); c.quadraticCurveTo(4.5, -2.2, 8.2, -1.4); c.lineTo(10.2, -0.5); c.lineTo(8.6, 0.3);
  c.lineTo(9.8, 1.1); c.lineTo(8.0, 1.4); c.lineTo(8.9, 2.3); c.lineTo(7.0, 2.3); c.lineTo(7.4, 3.2);
  c.quadraticCurveTo(3.5, 3.4, 0, 1.6); c.closePath(); pen.fill(); c.restore();
}
function ravenFigure(pen, q){
  var c = pen.c, b = q.b, P = pen.P, i;
  c.save(); c.rotate(q.lean);
  c.beginPath(); c.moveTo(-0.7, -3.0 + b); c.lineTo(-0.4, 0); c.moveTo(0.5, -2.8 + b); c.lineTo(0.8, 0); pen.line(0.8);
  c.beginPath(); c.moveTo(-1.7, 0.1); c.lineTo(2.3, 0.1); pen.line(0.9);
  if (q.wings) ravenWing(pen, 1.0, -7.3 + b, q.wings.a2, 0.8);
  c.save(); c.translate(-3.2, -3.0 + b); c.rotate(q.tailA);           // wedge tail
  c.beginPath(); c.moveTo(-0.4, -0.7); c.lineTo(-5.2, 3.0); c.lineTo(-6.1, 4.4); c.lineTo(-4.3, 5.0); c.lineTo(0.9, 1.6); c.closePath(); pen.fill();
  c.restore();
  var cx = -0.9, cy = -5.4 + b, rx = 4.7 * q.puff, ry = 3.05 * q.puff, ra = -0.62;
  c.beginPath();
  if (q.ruffle){ // ruffled feathers: jagged ellipse
    var n = 22; for (i = 0; i <= n; i++){ var th = i / n * TAU, k = (i % 2 ? 1.0 : 1.16) + 0.03 * Math.sin(i * 2.7),
      p = rot(Math.cos(th) * rx * k, Math.sin(th) * ry * k, ra); c[i ? 'lineTo' : 'moveTo'](cx + p[0], cy + p[1]); }
    c.closePath();
  } else c.ellipse(cx, cy, rx, ry, ra, 0, TAU);
  pen.fill();
  if (!q.wings){ c.beginPath(); c.moveTo(1.0, -7.6 + b); c.quadraticCurveTo(-3.8, -6.9 + b, -7.4, -1.1 + b); c.lineTo(-5.0, -2.2 + b); c.quadraticCurveTo(-1.8, -3.3 + b, 0.6, -3.8 + b); c.closePath(); pen.fill(); }
  c.beginPath(); c.ellipse((q.hx + 1.0) / 2, (q.hy + b - 6.8) / 2, 2.2, 2.5, 0.5, 0, TAU); pen.fill();   // neck
  c.save(); c.translate(q.hx, q.hy + b); c.rotate(q.ha);
  if (q.front){ // mid-turn: head seen from the front, beak pointing at us
    c.translate(q.wob, 0);
    c.beginPath(); c.ellipse(0, 0, 2.3, 2.25, 0, 0, TAU); pen.fill();
    c.beginPath(); c.moveTo(-1.0, -0.4); c.lineTo(1.0, -0.4); c.lineTo(0.15 + q.wob * 0.6, 3.0); c.closePath(); pen.fill();
    if (pen.fin){ eyeDot(c, -1.2, -0.6, 0.42, 0.42, 0, P.eye, 0); eyeDot(c, 1.2, -0.6, 0.42, 0.42, 0, P.eye, 0); }
  } else {
    c.beginPath(); c.ellipse(0, 0, 2.55, 2.2, 0, 0, TAU); pen.fill();
    c.save(); c.translate(1.4, -0.3); c.rotate(-q.jaw * 0.28);           // upper beak (heavy, hooked)
    c.beginPath(); c.moveTo(-0.2, -1.3); c.quadraticCurveTo(2.2, -1.6, 4.4, -0.1); c.lineTo(4.5, 0.5); c.lineTo(3.2, 0.35); c.lineTo(0.2, 0.6); c.closePath(); pen.fill();
    c.restore();
    c.save(); c.translate(1.2, 0.4); c.rotate(q.jaw * 0.45);             // lower beak
    c.beginPath(); c.moveTo(0.2, 0); c.lineTo(3.8, -0.15); c.quadraticCurveTo(2.0, 1.1, -0.2, 1.2); c.closePath(); pen.fill();
    c.restore();
    c.beginPath(); c.moveTo(-0.8, 1.6); c.lineTo(2.6, 1.3); c.lineTo(2.2, 2.4); c.lineTo(1.4, 2.0); c.lineTo(1.0, 3.1); c.lineTo(0.1, 2.3); c.lineTo(-0.6, 3.0); c.closePath(); pen.fill(); // throat hackles
    if (pen.fin){
      eyeDot(c, 0.9, -0.5, 0.55, 0.5, 0, P.eye, q.caw > 0 ? 0.6 : 0);
      if (q.caw > 0.25){ // caw: two faint arcs from the open beak
        c.strokeStyle = P.eye; c.lineWidth = 0.55; c.globalAlpha = 0.45 * q.caw;
        for (i = 0; i < 2; i++){ c.beginPath(); c.arc(5.6, 0.4, 2.2 + i * 2.2 + q.caw, -0.7, 0.8); c.stroke(); }
        c.globalAlpha = 1;
      }
    }
  }
  c.restore();
  if (q.wings) ravenWing(pen, 0.2, -6.9 + b, q.wings.a, 1);
  c.restore();
}
TW.enemyArt.raven = safe('raven', function(ctx, e, t, P){
  P = pal(P); t = num(t, 0);
  var f = frame(e, 14, 10), q = ravenPose(f, t);
  ctx.translate(f.cx, f.fy); ctx.scale(f.face, 1);
  twoPass(ctx, P, 1.0, ravenFigure, q);
});

// =====================================================================================
// SHULAM — blind crawling ghoul of the dead world. Hitbox 30x16.
// =====================================================================================
function shulamPose(f, t){
  var st = f.st, A = f.anim, et = f.et, k;
  var q = {Pv:[-8, -10.4], Sh:[5, -11.2], hd:{x:10.6, y:-8.6, a:0.5, m:0, sx:1}, lag:0, ripple:0,
           gait:false, S:3.4, duty:0.6, lift:3, stance:null, search:false, reach:0, hair:1};
  var bob = 0;
  if (st === 'listen'){
    k = ease(et / 0.15);
    q.Sh = [5, lerp(-11.2, -13.4, k)]; q.Pv = [-8, -10.6];
    q.hd = {x:lerp(10.6, 9.4, k), y:lerp(-8.6, -16.6, k), a:lerp(0.5, -0.4, k), m:0, sx:1};
    q.ripple = 1; q.stance = [0, 0, 0, 0]; q.hair = 0.8;
  } else if (st === 'hunt'){
    q.gait = true; q.S = 6.6; q.duty = 0.5; q.lift = 5;
    q.Pv = [-9, -9.4]; q.Sh = [6, -10.2]; q.hd = {x:12.6, y:-9.4, a:0.16, m:0.2, sx:1}; q.lag = 1;
    bob = 0.6 * Math.cos(2 * A) + 0.25 * Math.sin(t * 41);
  } else if (st === 'search'){
    q.search = true; q.Pv = [-8, -10.6]; q.Sh = [5, -12]; q.stance = [0.8 * Math.sin(t * 1.7), 0, 0, 0.6 * Math.sin(t * 1.7 + 2)];
  } else if (st === 'return'){
    q.gait = true; q.S = 3.6; q.duty = 0.62; q.lift = 2.4;
    q.Pv = [-8, -10.2]; q.Sh = [5, -10.4]; q.hd = {x:10.1, y:-7.0, a:0.78, m:0, sx:1};
    bob = 0.3 * Math.cos(2 * A);
  } else if (st === 'attack'){
    k = ease(et / 0.22); var w = Math.sin(et * 24) * 0.35 * (et > 0.22 ? 1 : 0);
    q.Pv = [lerp(-7, -8.6, k), lerp(-8.4, -9.6, k)]; q.Sh = [lerp(3.6, 8.6, k), lerp(-8.8, -14.8, k) + w];
    q.hd = {x:lerp(8.6, 15.6, k), y:lerp(-6.4, -15.0, k) + w, a:lerp(0.6, -0.14, k), m:k, sx:1};
    q.reach = k; q.lag = 1.4 * k; q.stance = [0, 0, lerp(0, -3.2, k), lerp(0, -1.6, k)];
  } else { // 'idle' + default: slow wandering crawl
    q.gait = true; q.hd.y += 0.4 * Math.sin(t * 1.3); bob = 0.3 * Math.cos(2 * A);
  }
  if (bob){ q.Pv[1] += bob; q.Sh[1] += bob; q.hd.y += bob; }
  axis(q, q.Pv, q.Sh);
  if (q.search){ // head sweeps: low-forward to raised, profile foreshortens as it turns
    var sw = Math.sin(t * 3.3), nb = bp(q, q.L + 0.6, -0.2), phi = 0.5 + 0.6 * sw;
    q.hd = {x:nb[0] + 5.6 * Math.cos(phi), y:nb[1] + 5.6 * Math.sin(phi), a:phi - 0.1, m:0, sx:0.7 + 0.3 * Math.abs(Math.cos(t * 1.65))};
  }
  q.ar = bp(q, q.L - 0.6, 0.6); q.lr = bp(q, 0.6, 0.8);
  var ar = q.ar, lr = q.lr, i, g;
  q.limbs = [];
  var ph = [0, 0.5, 0.5, 0];   // nearArm, farArm, nearLeg, farLeg
  for (i = 0; i < 4; i++){
    var arm = i < 2, far = i % 2 === 1, root = arm ? ar : lr, nx = root[0] + (arm ? 8.2 : -5.6) + (far ? 1.6 : 0), x, y = 0, lift = 0;
    if (q.gait){ g = gaitFoot(A / TAU + ph[i], q.S, q.duty, q.lift); x = nx + g[0]; y = g[1]; lift = g[2]; }
    else x = nx + (q.stance ? q.stance[i] : 0);
    if (arm && q.reach > 0){ var tx = far ? 22.6 : 24.6, ty = far ? -9.6 : -13.8; x = lerp(x, tx, q.reach); y = lerp(y, ty, q.reach); lift = q.reach; }
    q.limbs.push({arm:arm, far:far, x:x, y:y, lift:lift});
  }
  return q;
}
function shulamLimb(pen, q, lm){
  var c = pen.c, r = lm.arm ? q.ar : q.lr, j, i;
  j = lm.arm ? ik(r[0], r[1], lm.x, lm.y, 7.0, 15.4, -1) : ik(r[0], r[1], lm.x, lm.y, 7.4, 14.0, 1);
  taper(pen, r[0], r[1], j[0], j[1], 1.05, 0.7);
  c.beginPath(); c.moveTo(j[0], j[1]); c.lineTo(j[2], j[3]); pen.line(lm.arm ? 1.2 : 1.35);
  var hx = j[2], hy = j[3];
  c.beginPath();
  if (lm.arm){ // long thin fingers, curling when lifted
    var fa = [0.08, -0.32, 0.42], fl = [3.4, 2.9, 2.4], down = lm.lift * 0.9 - q.reach * 0.9;
    for (i = 0; i < 3; i++){ var a = fa[i] + down, d1 = rot(fl[i] * 0.55, 0, a), d2 = rot(fl[i], 0, a + 0.35);
      c.moveTo(hx, hy); c.quadraticCurveTo(hx + d1[0], hy + d1[1], hx + d2[0], hy + d2[1]); }
  } else { c.moveTo(hx, hy); c.lineTo(hx - 2.6, hy + 0.1); c.moveTo(hx, hy); c.lineTo(hx - 2.0, hy - 0.9); }
  pen.line(0.55);
}
function shulamFigure(pen, q, P){
  var c = pen.c, i, L = q.L, h = q.hd, P2 = pen.P;
  for (i = 0; i < 4; i++) if (q.limbs[i].far) shulamLimb(pen, q, q.limbs[i]);
  // torso: emaciated, spine bumps, shoulder blades
  c.save(); c.translate(q.Pv[0], q.Pv[1]); c.rotate(q.ang);
  c.beginPath();
  c.moveTo(-2.0, 0.2); c.quadraticCurveTo(-1.6, -1.7, 0.8, -1.5);
  c.quadraticCurveTo(L * 0.5, -0.5, L - 1.0, -2.2);
  c.quadraticCurveTo(L + 1.4, -2.1, L + 1.6, 0.4);
  c.quadraticCurveTo(L + 0.8, 2.6, L - 2.0, 2.6);
  c.quadraticCurveTo(L * 0.5, 1.0, 1.5, 2.0);
  c.quadraticCurveTo(-1.6, 2.4, -2.0, 0.2); c.closePath();
  pen.fill();
  c.beginPath();   // spine bumps + shoulder blade (own path: same winding, no holes)
  for (i = 1; i <= 5; i++){ var u = L * (0.1 + 0.14 * i), vy = -1.15 - 0.25 * Math.sin(PI * i / 6); c.moveTo(u + 0.75, vy); c.arc(u, vy, 0.75, 0, TAU); }
  c.moveTo(L - 0.5, -2.1); c.ellipse(L - 2.4, -2.1, 1.9, 1.0, 0, 0, TAU);
  pen.fill();
  if (pen.fin){ // faint ribs
    c.strokeStyle = P2.rim; c.lineWidth = 0.4;
    c.beginPath(); for (i = 0; i < 3; i++){ var ru = L * (0.56 + 0.12 * i); c.moveTo(ru, -0.4); c.quadraticCurveTo(ru - 0.4, 1.0, ru - 1.4, 1.9); } c.stroke();
  }
  c.restore();
  // neck
  var n0 = bp(q, L + 0.4, -0.4), n1 = rot(-2.4 * h.sx, 0.3, h.a); n1 = [h.x + n1[0], h.y + n1[1]];
  taper(pen, n0[0], n0[1], n1[0], n1[1], 1.5, 1.0);
  // head: eyeless, sunken socket, mouth slit
  c.save(); c.translate(h.x, h.y); c.rotate(h.a); c.scale(h.sx, 1);
  c.beginPath();
  c.moveTo(-3.3, 0.4); c.quadraticCurveTo(-3.4, -2.6, 0.2, -2.7); c.quadraticCurveTo(2.6, -2.6, 3.2, -1.2);
  c.lineTo(2.3, -0.3); c.quadraticCurveTo(3.3, 0.1, 3.5, 0.8); c.lineTo(3.1, 1.2); c.lineTo(0.4, 1.3);
  c.quadraticCurveTo(-1.6, 1.6, -3.3, 0.4); c.closePath(); pen.fill();
  c.save(); c.translate(0.2, 1.25); c.rotate(h.m * 0.6);
  c.beginPath(); c.moveTo(-1.4, -0.1); c.lineTo(2.9, 0.0); c.quadraticCurveTo(2.8, 1.2, 1.6, 1.6); c.quadraticCurveTo(-0.6, 1.7, -1.6, 0.9); c.closePath(); pen.fill();
  c.restore();
  if (pen.fin){
    c.strokeStyle = P2.rim; c.lineWidth = 0.45;
    c.beginPath(); c.arc(2.1, -0.7, 0.9, -0.2, 1.9); c.stroke();                // sunken socket crease
    c.beginPath(); c.moveTo(0.6, 1.3); c.lineTo(3.0, 1.2); c.stroke();          // mouth slit
    if (h.m > 0.3){ c.strokeStyle = P2.eye; c.globalAlpha = 0.5 * h.m; c.lineWidth = 0.3; c.beginPath();
      for (i = 0; i < 4; i++){ var tx = 0.9 + i * 0.6; c.moveTo(tx, 1.3); c.lineTo(tx + 0.1, 1.75); } c.stroke(); c.globalAlpha = 1; }
  }
  c.restore();
  // stringy hair hanging from the crown (streams back when moving fast)
  if (q.hair > 0){
    var tm = pen.t || 0; c.beginPath();
    var roots = [[-2.6, -1.2], [-1.6, -2.2], [-0.4, -2.6], [0.8, -2.5], [1.8, -2.0]], lens = [9, 10.5, 8.5, 9.5, 7.5];
    for (i = 0; i < roots.length; i++){
      var rr = rot(roots[i][0] * h.sx, roots[i][1], h.a), rx = h.x + rr[0], ry = h.y + rr[1], ln = lens[i] * q.hair;
      var sway = 0.6 * Math.sin(tm * 1.6 + i * 1.3), lagx = -q.lag * (3.5 + i * 0.6);
      var tx2 = rx + sway + lagx, ty2 = Math.min(-0.6, ry + ln * (1 - 0.35 * Math.min(1, q.lag)));
      c.moveTo(rx, ry); c.quadraticCurveTo(rx + 0.4 + lagx * 0.2, ry + ln * 0.45, tx2, ty2);
    }
    pen.line(0.5);
  }
  for (i = 0; i < 4; i++) if (!q.limbs[i].far) shulamLimb(pen, q, q.limbs[i]);
}
TW.enemyArt.shulam = safe('shulam', function(ctx, e, t, P){
  P = pal(P); t = num(t, 0);
  var f = frame(e, 30, 16), q = shulamPose(f, t), i;
  ctx.translate(f.cx, f.fy); ctx.scale(f.face, 1);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  var rimP = new Pen(ctx, P.rim, 1.4, false, P), silP = new Pen(ctx, P.sil, 0, true, P);
  rimP.t = t; silP.t = t;
  shulamFigure(rimP, q); shulamFigure(silP, q);
  if (q.ripple){ // listening: faint rings converging on the head
    ctx.strokeStyle = P.eye; ctx.lineWidth = 0.6;
    for (i = 0; i < 3; i++){ var ph = (t * 1.2 + i / 3) % 1; ctx.globalAlpha = 0.32 * Math.sin(PI * ph);
      ctx.beginPath(); ctx.arc(q.hd.x, q.hd.y, 13 - ph * 10, 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
});

// =====================================================================================
// ENVIRONMENT
// =====================================================================================
function zoneOf(zone){
  zone = (zone && typeof zone === 'object') ? zone : {};
  var x0 = num(zone.x0, 0), x1 = num(zone.x1, x0 + 80);
  if (x1 < x0){ var s = x0; x0 = x1; x1 = s; }
  return [x0, x1];
}

// Tall steppe grass (хялгана-like). front=false: tall back layer; front=true: lower, sparser layer drawn over characters.
TW.envArt.grass = safe('grass', function(ctx, zone, t, front, P){
  P = pal(P); t = num(t, 0); front = !!front;
  var z = zoneOf(zone), x0 = z[0], x1 = z[1], W = x1 - x0, Gy = groundY();
  var col = P.world === 1 ? '#c9ced6' : P.sil, r = rng(hashStr((x0 | 0) + ':' + (x1 | 0)) + (front ? 7919 : 0)), i;
  var edge = function(x){ return clamp(Math.min(x - x0 + 6, x1 + 6 - x) / 14, 0, 1); };
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // dense base tuft
  var mh = front ? 7 : 6;
  ctx.beginPath(); ctx.moveTo(x0 - 7, Gy + 1);
  for (var mx = x0 - 7; mx <= x1 + 7; mx += 2.5) ctx.lineTo(mx, Gy - mh * edge(mx) * (0.75 + 0.25 * Math.sin(mx * 1.7 + 3)));
  ctx.lineTo(x1 + 7, Gy + 1); ctx.closePath(); ctx.fill();
  // blades
  var n = Math.max(4, Math.round(W / (front ? 2.6 : 1.8))) + 6, tips = [];
  ctx.beginPath();
  for (i = 0; i < n; i++){
    var bx = x0 - 5 + (W + 10) * (i + r()) / n, ee = edge(bx), h, bw, tall = false;
    if (!front){ h = (33 + r() * 11) * (0.35 + 0.65 * ee); bw = 1.0 + r() * 0.9; }
    else { tall = r() < 0.3; h = (tall ? 28 + r() * 12 : 9 + r() * 10) * (0.4 + 0.6 * ee); bw = tall ? 0.5 + r() * 0.3 : 0.9 + r() * 0.8; }
    var lean = (r() - 0.5) * 0.5, ph = r() * TAU;
    var sway = (Math.sin(t * 1.3 + bx * 0.05 + ph) * 0.06 + Math.sin(t * 0.55 - bx * 0.012) * 0.08) * h;
    var tx = bx + lean * h * 0.5 + sway, ty = Gy - h, mx2 = bx + (tx - bx) * 0.35;
    ctx.moveTo(bx - bw, Gy + 1);
    ctx.quadraticCurveTo(mx2 - bw * 0.45, Gy - h * 0.55, tx, ty);
    ctx.quadraticCurveTo(mx2 + bw * 0.45, Gy - h * 0.55, bx + bw, Gy + 1);
    ctx.closePath();
    if (r() < (front ? 0.18 : 0.28) && h > 20) tips.push([tx, ty, sway, 6 + r() * 6]);
  }
  ctx.fill();
  // feather-grass plumes bending downwind
  ctx.lineWidth = 0.45; ctx.beginPath();
  for (i = 0; i < tips.length; i++){ var p = tips[i], L = p[3], wv = 0.3 * Math.sin(t * 1.7 + i);
    ctx.moveTo(p[0], p[1]); ctx.quadraticCurveTo(p[0] + L * 0.45 + p[2] * 0.2, p[1] - 1.5 + wv, p[0] + L + p[2] * 0.4, p[1] + L * 0.35 + wv); }
  ctx.stroke();
});

// Dead-world noisy floor: half-buried animal bones, ribcages and skulls along the ground line.
TW.envArt.bones = safe('bones', function(ctx, zone, t, P){
  P = pal(P); t = num(t, 0);
  var z = zoneOf(zone), x0 = z[0], x1 = z[1], Gy = groundY(), dead = P.world === 1;
  var fillC = dead ? '#e7eaef' : P.sil, lineC = dead ? 'rgba(16,19,26,0.62)' : P.rim, hole = dead ? '#1a1d24' : P.rim;
  var r = rng(hashStr('b' + (x0 | 0) + ':' + (x1 | 0))), items = [], i, x = x0 + 1.5 + r() * 2, k = 0;
  var order = ['frag', 'skull', 'long', 'ribs', 'frag', 'jaw', 'long', 'frag', 'skull', 'ribs', 'long', 'frag'];
  while (x < x1 - 3){
    var ty = order[(k + (hashStr(x0 | 0) % 5)) % order.length], it = {k:ty, x:x, d:r() < 0.5 ? -1 : 1, a:(r() - 0.5) * 0.5, s:0.85 + r() * 0.3, r:r()};
    if (ty === 'ribs' && x > x1 - 14) it.k = 'long';
    if (ty === 'skull' && x > x1 - 8) it.k = 'frag';
    items.push(it);
    x += (it.k === 'ribs' ? 13 : it.k === 'skull' ? 9 : it.k === 'long' ? 8 : 4) * it.s + r() * 3; k++;
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (dead){ // disturbed grit band
    ctx.fillStyle = 'rgba(40,46,58,0.2)';
    for (var gx = x0; gx < x1; gx += 1.6 + r() * 2.4) ctx.fillRect(gx, Gy + 0.6 + r() * 3, 0.8 + r(), 0.6);
  }
  function shape(it, pass){ // pass 0: dark outline, 1: pale fill
    var ex = pass ? 0 : 0.9, s = it.s, X = it.x, j;
    ctx.strokeStyle = pass ? fillC : lineC; ctx.fillStyle = pass ? fillC : lineC;
    if (it.k === 'long'){
      var L = 7 * s, c = Math.cos(it.a), sn = Math.sin(it.a), ax = X, ay = Gy - 0.9 + (it.r - 0.5) * 0.8, bx = X + L * c, by = ay + L * sn;
      ctx.lineWidth = 1.1 + ex; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.beginPath(); var kr = 0.85 + ex / 2;
      for (j = -1; j <= 1; j += 2){ ctx.moveTo(ax - sn * 0.6 * j + kr, ay + c * 0.6 * j); ctx.arc(ax - sn * 0.6 * j, ay + c * 0.6 * j, kr, 0, TAU);
        ctx.moveTo(bx - sn * 0.6 * j + kr, by + c * 0.6 * j); ctx.arc(bx - sn * 0.6 * j, by + c * 0.6 * j, kr, 0, TAU); }
      ctx.fill();
    } else if (it.k === 'ribs'){
      var RL = 11 * s;
      ctx.lineWidth = 1.2 + ex; ctx.beginPath(); ctx.moveTo(X, Gy - 0.5); ctx.lineTo(X + RL, Gy - 0.8); ctx.stroke();
      ctx.lineWidth = 0.85 + ex; ctx.beginPath();
      for (j = 0; j < 5; j++){ var rx = X + 1 + j * RL / 5.2, rh = (6.6 - j * 0.9) * s;
        ctx.moveTo(rx, Gy - 0.6); ctx.quadraticCurveTo(rx - 0.4 * it.d, Gy - rh, rx + 2.6 * it.d, Gy - rh + 0.8); }
      ctx.stroke();
    } else if (it.k === 'skull'){
      var d = it.d, sx = X + 3;
      ctx.beginPath(); ctx.ellipse(sx, Gy - 2.0 * s, 2.6 * s + ex / 2, 2.0 * s + ex / 2, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(sx + d * 1.2, Gy - 3.4 * s - ex / 2); ctx.lineTo(sx + d * 6.0 * s + d * ex / 2, Gy - 1.5 * s);
      ctx.lineTo(sx + d * 5.8 * s + d * ex / 2, Gy - 0.2 + ex / 2); ctx.lineTo(sx + d * 1.0, Gy - 0.3 + ex / 2); ctx.closePath(); ctx.fill();
      if (it.r > 0.45){ ctx.lineWidth = 0.9 + ex; ctx.beginPath(); ctx.arc(sx - d * 1.6, Gy - 2.6 * s, 1.7 * s, d > 0 ? -2.2 : -0.9, d > 0 ? 1.6 : 4.7, d < 0); ctx.stroke(); } // ram horn
      if (pass){ ctx.fillStyle = hole; ctx.beginPath(); ctx.ellipse(sx + d * 0.9, Gy - 2.4 * s, 0.75, 0.62, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(sx + d * 4.9 * s, Gy - 1.2 * s, 0.5, 0.35, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = hole; ctx.lineWidth = 0.35; ctx.beginPath(); ctx.moveTo(sx + d * 2.2, Gy - 0.5); ctx.lineTo(sx + d * 5.2 * s, Gy - 0.4); ctx.stroke(); }
    } else if (it.k === 'jaw'){
      ctx.lineWidth = 1.0 + ex; ctx.beginPath(); ctx.moveTo(X, Gy - 0.6); ctx.lineTo(X + 5 * s * it.d / Math.abs(it.d), Gy - 1.8); ctx.lineTo(X + 5.8 * s, Gy - 0.5); ctx.stroke();
      if (pass){ ctx.lineWidth = 0.4; ctx.beginPath(); for (j = 1; j < 4; j++){ var jx = X + j * 1.3 * s; ctx.moveTo(jx, Gy - 0.9 - j * 0.25); ctx.lineTo(jx, Gy - 1.7 - j * 0.25); } ctx.stroke(); }
    } else { // fragments and pebbles
      ctx.lineWidth = 0.8 + ex; ctx.beginPath();
      ctx.moveTo(X, Gy - 0.5); ctx.lineTo(X + 2.2 * s, Gy - 0.9 - it.r);
      ctx.moveTo(X + 2.6, Gy - 0.4); ctx.lineTo(X + 3.6 * s, Gy - 0.6); ctx.stroke();
      ctx.beginPath(); ctx.arc(X + 1.4, Gy - 0.3, 0.5 + ex / 2, 0, TAU); ctx.fill();
    }
  }
  for (i = 0; i < items.length; i++) shape(items[i], 0);
  for (i = 0; i < items.length; i++) shape(items[i], 1);
  if (dead){ // faint cold mist creeping low over the bones
    for (i = 0; i < 2; i++){ var mx = x0 + (x1 - x0) * (0.5 + 0.38 * Math.sin(t * 0.25 + i * 2.4)), g = ctx.createRadialGradient(mx, Gy - 1, 0, mx, Gy - 1, (x1 - x0) * 0.35 + 6);
      g.addColorStop(0, 'rgba(225,230,240,0.10)'); g.addColorStop(1, 'rgba(225,230,240,0)');
      ctx.fillStyle = g; ctx.save(); ctx.translate(mx, Gy - 1); ctx.scale(1, 0.18); ctx.translate(-mx, -(Gy - 1));
      ctx.fillRect(mx - (x1 - x0) * 0.4 - 8, Gy - 60, (x1 - x0) * 0.8 + 16, 120); ctx.restore(); }
  }
});

// Bare dead tree from the ground G up to the perch point (x, y). The top branch spans x-9..x+15 at height y,
// so a raven whose hitbox is centred on x or starts at x both sit on it.
TW.envArt.perch = safe('perch', function(ctx, x, y, P){
  P = pal(P); var Gy = groundY();
  x = num(x, 0); y = num(y, Gy - 95); if (y > Gy - 12) y = Gy - 12;
  var col = P.world === 1 ? '#959ca8' : P.sil, h = Gy - y, i;
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  var B0 = [x - 6, Gy + 3], B1 = [x - 9.5, Gy - h * 0.4], B2 = [x + 0.5, Gy - h * 0.72], B3 = [x - 4, y + 1.4];
  function bez(s, k){ var m = 1 - s; return m * m * m * B0[k] + 3 * m * m * s * B1[k] + 3 * m * s * s * B2[k] + s * s * s * B3[k]; }
  var n = 16, L = [], R = [];
  for (i = 0; i <= n; i++){
    var s = i / n, px = bez(s, 0), py = bez(s, 1), s2 = Math.min(1, s + 0.01), qx = bez(s2, 0) - bez(Math.max(0, s2 - 0.02), 0), qy = bez(s2, 1) - bez(Math.max(0, s2 - 0.02), 1), ql = Math.sqrt(qx * qx + qy * qy) || 1;
    var hw = lerp(3.6, 1.3, Math.pow(s, 0.8)) + Math.max(0, 0.1 - s) * 40 + (Math.abs(s - 0.33) < 0.04 ? 0.6 : 0);
    L.push([px - qy / ql * hw, py + qx / ql * hw]); R.push([px + qy / ql * hw, py - qx / ql * hw]);
  }
  ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]); for (i = 1; i <= n; i++) ctx.lineTo(L[i][0], L[i][1]);
  for (i = n; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]); ctx.closePath(); ctx.fill();
  // roots
  ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - 8, Gy - 2); ctx.quadraticCurveTo(x - 13, Gy - 0.5, x - 16, Gy + 1);
  ctx.moveTo(x - 4, Gy - 2); ctx.quadraticCurveTo(x + 1, Gy - 0.6, x + 4, Gy + 1); ctx.stroke();
  // perch branch (top edge at y) + thin end twig
  ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(x - 5, y + 1.6); ctx.quadraticCurveTo(x + 2, y + 1.0, x + 10, y + 1.2); ctx.stroke();
  ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x + 9.5, y + 1.2); ctx.quadraticCurveTo(x + 14, y + 0.8, x + 16, y - 1.6); ctx.stroke();
  ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x + 15.6, y - 1.2); ctx.lineTo(x + 18.5, y - 5.5); ctx.moveTo(x + 13, y + 0.9); ctx.lineTo(x + 15, y + 4.5); ctx.stroke();
  // broken top stub and twigs
  ctx.lineWidth = 1.7; ctx.beginPath(); ctx.moveTo(x - 4.2, y + 2); ctx.lineTo(x - 7.5, y - 6); ctx.stroke();
  ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x - 6.4, y - 3.4); ctx.lineTo(x - 10, y - 6.5); ctx.stroke();
  // side branches lower down the trunk
  var sb = [[0.52, -1, 16, 0.55], [0.74, 1, 10, 0.75]];
  for (i = 0; i < sb.length; i++){
    var bs = sb[i], tx = bez(bs[0], 0), ty = bez(bs[0], 1), d = bs[1], l = Math.min(bs[2], h * 0.25);
    ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + d * l * 0.5, ty - l * 0.1, tx + d * l, ty - l * bs[3]); ctx.stroke();
    ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(tx + d * l * 0.6, ty - l * 0.2); ctx.lineTo(tx + d * l * 0.75, ty - l * 0.65);
    ctx.moveTo(tx + d * l, ty - l * bs[3]); ctx.lineTo(tx + d * (l + 3), ty - l * bs[3] - 1); ctx.stroke();
  }
});

})();
