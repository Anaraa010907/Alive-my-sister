/* Хоёр ертөнц — puzzle kinds B (Puzzle & mini-game designer B).
   Registers TW.puzzles.shagai, TW.puzzles.riddle, TW.puzzles.split (docs/ARCHITECTURE-v2.md "Puzzle contract").
   - gen() uses only the seeded rand() it is given; data is plain JSON.
   - solve()/showClue() fill the engine's overlay body `el`; api.success()/api.fail() fire exactly once on confirm;
     both return a cleanup function.
   - drawDevice()/drawClue() are plain canvas paths in world coordinates (ground G), no images, no shadowBlur.
   Load after js/puzzles.js (designer A); never replaces TW.puzzles. */
(function(){
'use strict';
const TW = window.TW = window.TW || {};
TW.puzzles = TW.puzzles || {};

// ================= small helpers =================
const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
const GY = () => num(TW.G, 190);
function seeded(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rndOf = rand => typeof rand === 'function' ? rand : seeded(7);
function ri(rand, n){ const v = Math.floor(rand() * n); return v < 0 ? 0 : v >= n ? n - 1 : v; }
function shuffle(rand, a){ for (let i = a.length - 1; i > 0; i--){ const j = ri(rand, i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
const warned = {};
function warnOnce(k, e){ if (warned[k]) return; warned[k] = 1; try { console.warn('[puzzles-b] ' + k + ': ' + (e && e.message)); } catch (_){} }
const reduced = () => { try { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_){ return false; } };

// ---------- DOM ----------
function mk(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(cls, html, aria){ const b = mk('button', cls); b.type = 'button'; if (html != null) b.innerHTML = html; if (aria) b.setAttribute('aria-label', aria); return b; }
function rootEl(kind, mode){ const r = mk('div', 'twpzb-root twpzb-' + kind + ' twpzb-' + mode); r.setAttribute('data-kind', kind); r.setAttribute('data-mode', mode); return r; }
function headEl(say, hint){ const h = mk('div', 'twpzb-head'); h.appendChild(mk('p', 'twpzb-say', say)); if (hint) h.appendChild(mk('p', 'twpzb-hint', hint)); return h; }
function nudge(node, kf, ms){ if (!node || !node.animate || reduced()) return; try { node.animate(kf, {duration: ms || 220, easing: 'ease-out'}); } catch (_){} }
// Guard: the first confirm decides; success()/fail() exactly once, every button is disabled afterwards.
function finisher(api, root){
  const st = {done: false, dead: false};
  st.finish = function(ok){
    if (st.done || st.dead) return false;
    st.done = true;
    root.classList.add(ok ? 'twpzb-is-ok' : 'twpzb-is-bad');
    root.setAttribute('data-result', ok ? 'ok' : 'bad');
    root.querySelectorAll('button').forEach(b => { b.disabled = true; });
    if (!ok) nudge(root.querySelector('.twpzb-shake') || root, [{transform: 'translateX(0)'}, {transform: 'translateX(-7px)'}, {transform: 'translateX(6px)'}, {transform: 'translateX(-3px)'}, {transform: 'translateX(0)'}], 320);
    try { if (ok){ if (api && api.success) api.success(); } else if (api && api.fail) api.fail(); }
    catch (e){ try { console.error('[puzzles-b]', e); } catch (_){} }
    return true;
  };
  st.kill = function(){ st.dead = true; };
  return st;
}
function mount(el, root){ if (!el) return false; el.appendChild(root); return true; }
const CHEV_UP = '<svg class="twpzb-chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 15l7-7 7 7"/></svg>';
const CHEV_DN = '<svg class="twpzb-chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 9l7 7 7-7"/></svg>';

// ---------- canvas ----------
function safe(name, fn){
  return function(ctx){
    if (!ctx || typeof ctx.save !== 'function') return;
    ctx.save();
    try { ctx.beginPath(); fn.apply(null, arguments); }
    catch (e){ warnOnce(name, e); }
    finally { ctx.restore(); ctx.beginPath(); }
  };
}
function rr(ctx, x, y, w, h, r){ ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function glow(ctx, x, y, r, rgb, a){ const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
// World look: living world = black silhouettes on a sepia sky; dead world = pale stone on a dark sky.
function look(P){
  const d = !!(P && P.world === 1);
  return {
    d,
    body: d ? '#c3c8d0' : ((P && P.sil) || '#0b0a09'),
    body2: d ? '#a3aab6' : '#1b1712',
    line: d ? 'rgba(16,20,28,0.5)' : 'rgba(160,145,120,0.45)',
    lit: d ? '#f4f6f9' : ((P && P.eye) || '#f3efe4'),
    glow: d ? '220,228,245' : '250,238,210',
    seam: d ? '150,190,255' : '208,52,58',      // the partner's colour: red ribbon above, blue khadag below
    bone: d ? '#eef0f3' : '#cbbd9c',
    boneLine: d ? 'rgba(16,20,28,0.62)' : 'rgba(25,22,16,0.75)'
  };
}

// ================= SHAGAI =================
// Four sides of an ankle bone; tall = standing on a narrow side, wide = lying on a broad side.
const BONES = [
  {name: 'морь',  o: 'M30 16L70 16Q78 16 78 26L76 72Q75 90 50 90Q25 90 24 72L22 26Q22 16 30 16Z', d: 'M50 22L50 84M36 30Q33 50 37 72M64 30Q67 50 63 72', h: ''},
  {name: 'тэмээ', o: 'M24 84L24 44Q24 22 37 21Q46 21 47 34Q50 42 53 34Q55 19 66 19Q78 20 77 42L76 84Q70 91 50 91Q30 91 24 84Z', d: 'M37 48Q50 38 58 52Q66 66 52 80', h: ''},
  {name: 'хонь',  o: 'M10 70Q10 36 50 32Q90 36 90 70Q88 86 50 86Q12 86 10 70Z', d: 'M26 58Q50 42 74 58M43 71Q50 75 57 71', h: ''},
  {name: 'ямаа',  o: 'M10 70Q10 38 32 35Q44 34 50 47Q56 34 68 35Q90 38 90 70Q88 86 50 86Q12 86 10 70Z', d: 'M50 47L50 57', h: 'M33 68A17 8 0 1 0 67 68A17 8 0 1 0 33 68Z'}
];
function boneSVG(i){
  const b = BONES[i];
  return '<svg class="twpzb-bonesvg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
    '<ellipse class="twpzb-b-sh" cx="50" cy="93" rx="36" ry="4"/>' +
    '<path class="twpzb-b-o" d="' + b.o + '"/>' + (b.h ? '<path class="twpzb-b-h" d="' + b.h + '"/>' : '') +
    '<path class="twpzb-b-d" d="' + b.d + '"/></svg>';
}
let BP = null;
function bonePaths(){
  if (BP !== null) return BP;
  try { BP = BONES.map(b => ({o: new Path2D(b.o), d: new Path2D(b.d), h: b.h ? new Path2D(b.h) : null})); }
  catch (_){ BP = false; }
  return BP;
}
// One bone, its bottom (path y≈90) at baseY, centred on cx, 100 path units → 100*s world units.
function drawBone(ctx, side, cx, baseY, s, fill, line, detail){
  const p = bonePaths();
  ctx.save();
  if (!p){ ctx.fillStyle = fill; ctx.beginPath(); const tall = side < 2; ctx.ellipse(cx, baseY - (tall ? 37 : 28) * s, (tall ? 27 : 40) * s, (tall ? 36 : 26) * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; }
  ctx.translate(cx - 50 * s, baseY - 90 * s); ctx.scale(s, s);
  const q = p[side] || p[0];
  ctx.fillStyle = fill; ctx.fill(q.o);
  if (line){ ctx.strokeStyle = line; ctx.lineWidth = 0.7 / s; ctx.stroke(q.o); }
  if (q.h){ ctx.fillStyle = detail || line || fill; ctx.globalAlpha *= 0.7; ctx.fill(q.h); ctx.globalAlpha /= 0.7; }
  ctx.strokeStyle = detail || line || fill; ctx.lineWidth = 0.6 / s; ctx.lineCap = 'round'; ctx.stroke(q.d);
  ctx.restore();
}

function genShagai(rand){
  rand = rndOf(rand);
  const answer = [ri(rand, 4), ri(rand, 4), ri(rand, 4), ri(rand, 4)];
  const start = [ri(rand, 4), ri(rand, 4), ri(rand, 4), ri(rand, 4)];
  // at most two bones may already lie right (the device never starts solved)
  for (let i = 0, same = start.filter((v, k) => v === answer[k]).length; i < 4 && same > 2; i++)
    if (start[i] === answer[i]){ start[i] = (answer[i] + 1 + ri(rand, 3)) % 4; same--; }
  return {answer, start};
}
const shagaiAnswer = d => d.answer.map(i => BONES[i].name).join(', ');

function shagaiSolve(el, data, api){
  data = data && data.answer ? data : genShagai(seeded(1));
  const root = rootEl('shagai', 'solve'), fin = finisher(api, root), cur = data.start.slice();
  root.appendChild(headEl('Шагайг эргүүл', 'Найзынхаа хэлснээр тааруул. Дарах бүрт шагай эргэнэ.'));
  const mat = mk('div', 'twpzb-mat twpzb-shake');
  const paint = (b, i) => {
    b.innerHTML = '<span class="twpzb-num">' + (i + 1) + '</span>' + boneSVG(cur[i]) + '<span class="twpzb-lbl">' + BONES[cur[i]].name + '</span>';
    b.setAttribute('data-side', String(cur[i]));
    b.setAttribute('aria-label', (i + 1) + '-р шагай: ' + BONES[cur[i]].name + '. Эргүүлэх');
  };
  for (let i = 0; i < 4; i++){
    const b = btn('twpzb-bone'); b.setAttribute('data-i', String(i)); paint(b, i);
    b.addEventListener('click', () => {
      if (fin.done || fin.dead) return;
      cur[i] = (cur[i] + 1) % 4; paint(b, i);
      nudge(b.querySelector('svg'), [{transform: 'rotate(-28deg) scale(0.82)', opacity: 0.4}, {transform: 'none', opacity: 1}], 230);
    });
    mat.appendChild(b);
  }
  root.appendChild(mat);
  const foot = mk('div', 'twpzb-foot');
  foot.appendChild(mk('p', 'twpzb-note', 'Зүүнээс баруун тийш: 1, 2, 3, 4'));
  const go = btn('twpzb-go', 'Батлах');
  go.addEventListener('click', () => fin.finish(cur.every((v, k) => v === data.answer[k])));
  foot.appendChild(go); root.appendChild(foot);
  mount(el, root);
  return () => fin.kill();
}
function shagaiClue(el, data, api){
  data = data && data.answer ? data : genShagai(seeded(1));
  const root = rootEl('shagai', 'clue');
  root.appendChild(headEl('Шагайг найздаа хэл', 'Найз чинь дөрвөн шагайгаа яг ингэж буулгах ёстой.'));
  const mat = mk('div', 'twpzb-mat');
  data.answer.forEach((s, i) => {
    const d = mk('div', 'twpzb-bone twpzb-ro'); d.setAttribute('data-side', String(s));
    d.innerHTML = '<span class="twpzb-num">' + (i + 1) + '</span>' + boneSVG(s) + '<span class="twpzb-lbl">' + BONES[s].name + '</span>';
    mat.appendChild(d);
  });
  root.appendChild(mat);
  const foot = mk('div', 'twpzb-foot'); foot.appendChild(mk('p', 'twpzb-note', 'Зүүнээс баруун тийш: 1, 2, 3, 4')); root.appendChild(foot);
  mount(el, root);
  return () => {};
}
// In-world device: a low stone with a felt mat, four bones on it, a felt pennant on a stake.
function pennant(ctx, x, g, t, L){
  const wv = Math.sin(t * 3 + x * 0.05) * 1.4;
  ctx.strokeStyle = L.body; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, g); ctx.lineTo(x, g - 32); ctx.stroke();
  ctx.fillStyle = L.body; ctx.beginPath(); ctx.moveTo(x, g - 32);
  ctx.quadraticCurveTo(x + 6, g - 31 + wv * 0.5, x + 12, g - 28 + wv); ctx.quadraticCurveTo(x + 6, g - 27 + wv * 0.4, x, g - 24); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = L.line; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(x + 2, g - 29.5); ctx.lineTo(x + 7, g - 28.5 + wv * 0.6); ctx.stroke();
}
function drawShagaiDevice(ctx, o, t, P, solved){
  const x = num(o && o.x, 0), g = GY(), L = look(P), k = 0.5 + 0.5 * Math.sin(t * 2.2 + x * 0.01);
  if (solved) glow(ctx, x, g - 14, 48, L.glow, 0.34);
  pennant(ctx, x + 22, g, t, L);
  ctx.fillStyle = L.body; rr(ctx, x - 19, g - 12, 38, 14, 6); ctx.fill();
  ctx.fillStyle = L.body2; ctx.fillRect(x - 16, g - 14.2, 32, 2.6);
  ctx.strokeStyle = L.line; ctx.lineWidth = 0.7; ctx.beginPath();
  for (let i = 0; i <= 8; i++){ const xx = x - 15 + i * 3.75, yy = g - 9 + (i % 2 ? 1.6 : 0); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
  ctx.stroke();
  const xs = [-11, -3.7, 3.7, 11], sides = [0, 2, 1, 3];
  for (let i = 0; i < 4; i++){
    if (solved) glow(ctx, x + xs[i], g - 17, 7, L.glow, 0.5);
    ctx.globalAlpha = solved ? 1 : 0.78 + 0.22 * k;
    drawBone(ctx, sides[i], x + xs[i], g - 14, 0.058, solved ? L.lit : L.bone, L.boneLine, L.boneLine);
    ctx.globalAlpha = 1;
  }
}
// In-world clue: the four bones themselves, laid out on the ground, with the same pennant beside them.
function drawShagaiClue(ctx, c, data, t, P){
  const x = num(c && c.x, 0), g = GY(), L = look(P), ans = (data && data.answer) || [0, 1, 2, 3];
  const k = 0.5 + 0.5 * Math.sin(t * 1.6 + x * 0.02);
  glow(ctx, x, g - 6, 30, L.glow, 0.1 + 0.08 * k);
  pennant(ctx, x + 28, g, t, L);
  ctx.fillStyle = L.d ? 'rgba(20,24,32,0.22)' : 'rgba(160,145,120,0.18)';
  ctx.beginPath(); ctx.ellipse(x, g + 0.6, 26, 1.8, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 4; i++){
    if (L.d) drawBone(ctx, ans[i], x - 18 + i * 12, g + 0.2, 0.095, L.bone, L.boneLine, L.boneLine);
    else drawBone(ctx, ans[i], x - 18 + i * 12, g + 0.2, 0.095, L.body, null, 'rgba(203,189,156,0.55)');
  }
}

// ================= RIDDLE (Keep-Talking style colour stones) =================
const COLS = [
  {name: 'хар',    fill: '#171615', hi: '#4d4840'},
  {name: 'цагаан', fill: '#e9e5da', hi: '#ffffff'},
  {name: 'улаан',  fill: '#c3262d', hi: '#ec6a6e'},
  {name: 'хөх',    fill: '#3a69b8', hi: '#8fb3ec'},
  {name: 'шар',    fill: '#d1a62c', hi: '#f4d77f'}
];
const POS = ['зүүн талын', 'дунд', 'баруун талын'];
const cnt = (s, c) => (s[0] === c) + (s[1] === c) + (s[2] === c);
function ruleTest(r, s){
  switch (r.type){
    case 'two': return cnt(s, r.c) === 2;
    case 'none': return cnt(s, r.c) === 0;
    case 'any': return cnt(s, r.c) >= 1;
    case 'pos': return s[r.pos] === r.c;
    case 'diff': return s[0] !== s[1] && s[1] !== s[2] && s[0] !== s[2];
    case 'edges': return s[0] === s[2];
    case 'more': return cnt(s, r.c) > cnt(s, r.c2);
    default: return true;   // 'else'
  }
}
// Text pieces: strings, or {c: colourIndex} rendered as a colour word with a swatch.
function ruleParts(r){
  switch (r.type){
    case 'two': return ['Хэрэв ', {c: r.c}, ' чулуу яг хоёр байвал'];
    case 'none': return ['Хэрэв ', {c: r.c}, ' чулуу огт байхгүй бол'];
    case 'any': return ['Хэрэв ', {c: r.c}, ' чулуу ядаж нэг байвал'];
    case 'pos': return ['Хэрэв ' + POS[r.pos] + ' чулуу ', {c: r.c}, ' бол'];
    case 'diff': return ['Хэрэв гурван чулуу бүгд өөр өнгөтэй бол'];
    case 'edges': return ['Хэрэв хоёр захын чулуу ижил өнгөтэй бол'];
    case 'more': return ['Хэрэв ', {c: r.c}, ' чулуу ', {c: r.c2}, ' чулуунаас олон байвал'];
    default: return ['Бусад бүх үед'];
  }
}
const ruleText = r => ruleParts(r).map(p => typeof p === 'string' ? p : COLS[p.c].name).join('');
function firstMatch(rules, s){ for (let i = 0; i < rules.length; i++) if (ruleTest(rules[i], s)) return i; return rules.length - 1; }
function genTable(rand){
  const types = shuffle(rand, ['two', 'none', 'any', 'pos', 'pos', 'diff', 'edges', 'more']);
  const colours = shuffle(rand, [0, 1, 2, 3, 4]);
  const rules = [], seen = {}, posUsed = {};
  let ci = 0;
  for (let i = 0; i < types.length && rules.length < 3; i++){
    const t = types[i];
    if (t !== 'pos' && seen[t]) continue;
    const r = {type: t};
    if (t === 'two' || t === 'none' || t === 'any') r.c = colours[ci++ % 5];
    else if (t === 'pos'){ let p = ri(rand, 3); while (posUsed[p]) p = (p + 1) % 3; posUsed[p] = 1; r.pos = p; r.c = colours[ci++ % 5]; }
    else if (t === 'more'){ r.c = colours[ci++ % 5]; r.c2 = colours[ci++ % 5]; }
    seen[t] = 1; rules.push(r);
  }
  rules.push({type: 'else'});
  const digits = shuffle(rand, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  rules.forEach((r, k) => { r.d = digits[k]; });
  return rules;
}
function genRiddle(rand){
  rand = rndOf(rand);
  const A = genTable(rand), B = genTable(rand);
  // pick which row of each table should fire, then look for stones that make exactly those rows fire first
  const tA = ri(rand, 4), tB = ri(rand, 4);
  let best = null, bestScore = -1;
  for (let n = 0; n < 400; n++){
    const s = [ri(rand, 5), ri(rand, 5), ri(rand, 5)], mA = firstMatch(A, s), mB = firstMatch(B, s);
    const score = (mA === tA ? 3 : 0) + (mB === tB ? 3 : 0) + (mA < 3 ? 1 : 0) + (mB < 3 ? 1 : 0);
    if (score > bestScore){ best = s; bestScore = score; }
    if (mA === tA && mB === tB) break;
  }
  const answer = '' + A[firstMatch(A, best)].d + B[firstMatch(B, best)].d;
  let start = [ri(rand, 10), ri(rand, 10)];
  if (start.join('') === answer) start = [(start[0] + 5) % 10, start[1]];
  return {stones: best, rules: [A, B], answer, start};
}
function partsEl(parts){
  const span = mk('span', 'twpzb-cond');
  parts.forEach(p => {
    if (typeof p === 'string'){ span.appendChild(document.createTextNode(p)); return; }
    const w = mk('span', 'twpzb-cw', COLS[p.c].name); w.style.setProperty('--sw', COLS[p.c].fill); w.setAttribute('data-c', String(p.c));
    span.appendChild(w);
  });
  return span;
}
function stoneEl(c, i){
  const f = mk('div', 'twpzb-stonebox');
  f.appendChild(mk('span', 'twpzb-num', String(i + 1)));
  const s = mk('div', 'twpzb-stone'); s.setAttribute('data-c', String(c));
  s.style.setProperty('--sf', COLS[c].fill); s.style.setProperty('--sh', COLS[c].hi);
  s.style.borderRadius = ['52% 48% 46% 54% / 58% 54% 46% 42%', '46% 54% 50% 50% / 52% 60% 40% 48%', '55% 45% 52% 48% / 50% 46% 54% 50%'][i % 3];
  f.appendChild(s);
  f.appendChild(mk('span', 'twpzb-lbl', COLS[c].name));
  return f;
}
function riddleSolve(el, data, api){
  data = data && data.stones ? data : genRiddle(seeded(1));
  const root = rootEl('riddle', 'solve'), fin = finisher(api, root), cur = data.start.slice();
  root.appendChild(headEl('Тоог тохируул', 'Өнгийг найздаа хэл, түүний хэлсэн тоог тавиад батал.'));
  const wrap = mk('div', 'twpzb-rid');
  const box = mk('div', 'twpzb-stones');
  box.appendChild(mk('p', 'twpzb-cap', 'Зүүнээс баруун тийш'));
  const row = mk('div', 'twpzb-stonerow');
  data.stones.forEach((c, i) => row.appendChild(stoneEl(c, i)));
  box.appendChild(row); wrap.appendChild(box);
  const dial = mk('div', 'twpzb-dial twpzb-shake');
  dial.appendChild(mk('p', 'twpzb-cap', 'Тоо'));
  const wheels = mk('div', 'twpzb-wheels');
  const outs = [];
  [0, 1].forEach(w => {
    const col = mk('div', 'twpzb-wheel'); col.setAttribute('data-w', String(w));
    const name = w ? 'Хоёр дахь цифр' : 'Эхний цифр';
    const up = btn('twpzb-step twpzb-up', CHEV_UP, name + ': нэмэх');
    const out = mk('output', 'twpzb-digit', String(cur[w])); out.setAttribute('aria-label', name); outs.push(out);
    const dn = btn('twpzb-step twpzb-dn', CHEV_DN, name + ': хасах');
    const step = dv => { if (fin.done || fin.dead) return; cur[w] = (cur[w] + dv + 10) % 10; out.textContent = String(cur[w]);
      nudge(out, [{transform: 'translateY(' + (dv > 0 ? 6 : -6) + 'px)', opacity: 0.4}, {transform: 'none', opacity: 1}], 160); };
    up.addEventListener('click', () => step(1)); dn.addEventListener('click', () => step(-1));
    col.appendChild(up); col.appendChild(out); col.appendChild(dn); wheels.appendChild(col);
  });
  dial.appendChild(wheels);
  const go = btn('twpzb-go', 'Батлах');
  go.addEventListener('click', () => fin.finish(cur.join('') === data.answer));
  dial.appendChild(go);
  wrap.appendChild(dial); root.appendChild(wrap);
  mount(el, root);
  return () => fin.kill();
}
function riddleClue(el, data, api){
  data = data && data.rules ? data : genRiddle(seeded(1));
  const root = rootEl('riddle', 'clue');
  root.appendChild(headEl('Чулуунуудын өнгийг асуу', 'Хүснэгт бүрийг дээрээс доош унш: эхний таарсан мөрийн цифр.'));
  const tables = mk('div', 'twpzb-tables');
  data.rules.forEach((rules, ti) => {
    const tb = mk('div', 'twpzb-table'); tb.setAttribute('data-t', String(ti));
    tb.appendChild(mk('p', 'twpzb-tcap', ti ? 'Хоёр дахь цифр' : 'Эхний цифр'));
    rules.forEach((r, ri2) => {
      const line = mk('div', 'twpzb-rule' + (r.type === 'else' ? ' twpzb-else' : '')); line.setAttribute('data-r', String(ri2));
      line.appendChild(partsEl(ruleParts(r)));
      line.appendChild(mk('span', 'twpzb-arrow', '→'));
      line.appendChild(mk('span', 'twpzb-dig', String(r.d)));
      tb.appendChild(line);
    });
    tables.appendChild(tb);
  });
  root.appendChild(tables);
  mount(el, root);
  return () => {};
}
// In-world device: three round stones beside a carved dial post with two digit rings.
function drawRiddleDevice(ctx, o, t, P, solved){
  const x = num(o && o.x, 0), g = GY(), L = look(P), k = 0.5 + 0.5 * Math.sin(t * 2 + x * 0.01);
  if (solved) glow(ctx, x + 6, g - 20, 44, L.glow, 0.32);
  ctx.fillStyle = L.body; ctx.beginPath();
  ctx.moveTo(x + 4.5, g); ctx.lineTo(x + 6, g - 29); ctx.quadraticCurveTo(x + 10.5, g - 37, x + 15, g - 29); ctx.lineTo(x + 16.5, g); ctx.closePath(); ctx.fill();
  ctx.fillRect(x + 3, g - 2.5, 15, 2.5);
  for (const y of [g - 22, g - 12]){
    ctx.strokeStyle = solved ? 'rgba(' + L.glow + ',0.95)' : L.line; ctx.lineWidth = 0.9; ctx.beginPath();
    ctx.moveTo(x + 6.3, y - 3); ctx.lineTo(x + 14.7, y - 3); ctx.moveTo(x + 6.3, y + 3); ctx.lineTo(x + 14.7, y + 3);
    ctx.moveTo(x + 8.4, y - 1.6); ctx.lineTo(x + 8.4, y + 1.6); ctx.moveTo(x + 10.5, y - 1.6); ctx.lineTo(x + 10.5, y + 1.6); ctx.moveTo(x + 12.6, y - 1.6); ctx.lineTo(x + 12.6, y + 1.6);
    ctx.stroke();
  }
  [[-17, 4.4, 3.5], [-8.6, 3.8, 3.2], [-0.8, 4.2, 3.6]].forEach(([dx, rx, ry], i) => {
    ctx.fillStyle = L.body; ctx.beginPath(); ctx.ellipse(x + dx, g - ry + 0.4, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(' + L.glow + ',' + (solved ? 0.9 : 0.22 + 0.3 * k) + ')';
    ctx.beginPath(); ctx.arc(x + dx - rx * 0.3, g - ry * 1.35 + 0.4, 0.9, 0, Math.PI * 2); ctx.fill();
  });
}
// In-world clue: a standing stele with carved rows (the rules) and five colour dots on top.
const DOTS = ['#2a2724', '#e9e5da', '#c3262d', '#3a69b8', '#d1a62c'];
function drawRiddleClue(ctx, c, data, t, P){
  const x = num(c && c.x, 0), g = GY(), L = look(P), k = 0.5 + 0.5 * Math.sin(t * 1.4 + x * 0.02);
  glow(ctx, x, g - 20, 34, L.glow, 0.08 + 0.06 * k);
  ctx.fillStyle = L.body; ctx.beginPath();
  ctx.moveTo(x - 13, g); ctx.lineTo(x - 11, g - 31); ctx.quadraticCurveTo(x, g - 39, x + 11, g - 31); ctx.lineTo(x + 13, g); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x - 15, g - 1.6, 4, 2.2, 0, 0, Math.PI * 2); ctx.ellipse(x + 15.5, g - 1.3, 3.2, 1.8, 0, 0, Math.PI * 2); ctx.fill();
  DOTS.forEach((col, i) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x - 6 + i * 3, g - 31, 1.05, 0, Math.PI * 2); ctx.fill(); });
  if (!L.d){ ctx.strokeStyle = 'rgba(160,145,120,0.35)'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.arc(x - 6, g - 31, 1.05, 0, Math.PI * 2); ctx.stroke(); }
  ctx.strokeStyle = L.line; ctx.lineWidth = 0.8; ctx.lineCap = 'round'; ctx.beginPath();
  const lens = [10, 7, 9, 5, 8];
  for (let i = 0; i < 5; i++){ const y = g - 25 + i * 4.6; ctx.moveTo(x - 8.5, y); ctx.lineTo(x - 8.5 + lens[i], y); ctx.moveTo(x + 6.5, y); ctx.lineTo(x + 8, y); }
  ctx.moveTo(x + 4.5, g - 27); ctx.lineTo(x + 4.5, g - 5); ctx.stroke();
}

// ================= SPLIT (two-way code, one stele per world) =================
const SYMS = [
  {name: 'нар', s: '<circle cx="50" cy="50" r="16"/><path d="M50 8V22M50 78V92M8 50H22M78 50H92M20 20L30 30M70 70L80 80M80 20L70 30M30 70L20 80"/>'},
  {name: 'сар', s: '<path d="M73 18A34 34 0 1 0 73 82A36 36 0 0 1 73 18Z"/>'},
  {name: 'од',  s: '<polygon points="50,16 58.8,39.9 84.2,40.9 64.3,56.6 71.2,81.1 50,67 28.8,81.1 35.7,56.6 15.8,40.9 41.2,39.9"/>'},
  {name: 'гал', s: '<path d="M50 12C64 30 74 44 70 62C67 78 58 86 50 86C40 86 30 78 30 62C30 50 38 42 42 34C44 46 48 52 54 54C56 42 54 28 50 12Z"/>'},
  {name: 'ус',  s: '<path d="M12 34Q21 25 30 34T48 34T66 34T84 34M12 52Q21 43 30 52T48 52T66 52T84 52M12 70Q21 61 30 70T48 70T66 70T84 70"/>'},
  {name: 'уул', s: '<path d="M8 80L36 28L52 54L64 38L92 80Z"/><path d="M27 45L36 28L45 45"/>'},
  {name: 'мод', s: '<path d="M50 10L70 40H59L76 66H24L41 40H30Z"/><path d="M50 66V90"/>'},
  {name: 'гэр', s: '<path d="M12 82V58Q50 26 88 58V82Z"/><path d="M43 82V64H57V82M45 42V35H55V42"/>'}
];
const symSVG = i => '<svg class="twpzb-sym" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' + SYMS[i].s + '</svg>';
function genSplit(rand, params){
  rand = rndOf(rand);
  const side = params && (params.side === 1 || params.side === '1') ? 1 : 0;
  // identical rand use on both sides: the code depends only on the seed (engine seeds from session seed + params.pair)
  const code = [ri(rand, 8), ri(rand, 8), ri(rand, 8), ri(rand, 8)];
  return {pair: String((params && params.pair) || ''), side, code,
          show: side ? [0, 1] : [2, 3],   // positions this device SHOWS (the partner needs them)
          need: side ? [2, 3] : [0, 1]};  // positions this device must ENTER (the partner's device shows them)
}
const splitAnswer = d => d.need.map(p => SYMS[d.code[p]].name).join(', ');
function splitView(el, data, api, readOnly){
  data = data && data.code ? data : genSplit(seeded(1), {side: 0});
  const root = rootEl('split', readOnly ? 'clue' : 'solve'), fin = finisher(api, root);
  root.setAttribute('data-side', String(data.side));
  const wrap = mk('div', 'twpzb-sp');
  // mine: what I see and must say
  const mine = mk('div', 'twpzb-mine');
  mine.appendChild(mk('p', 'twpzb-say', 'Тэмдгээ найздаа хэл'));
  const tiles = mk('div', 'twpzb-tiles');
  data.show.forEach(p => {
    const tl = mk('div', 'twpzb-tile'); tl.setAttribute('data-p', String(p)); tl.setAttribute('data-s', String(data.code[p]));
    tl.innerHTML = '<span class="twpzb-num">' + (p + 1) + '</span>' + symSVG(data.code[p]);
    tiles.appendChild(tl);
  });
  mine.appendChild(tiles);
  mine.appendChild(mk('p', 'twpzb-note', 'Эдгээрийг зөвхөн чи харж байна.'));
  wrap.appendChild(mine);
  // theirs: what my partner tells me
  const theirs = mk('div', 'twpzb-theirs twpzb-shake');
  theirs.appendChild(mk('p', 'twpzb-say', 'Найзынхаа тэмдгийг оруул'));
  const top = mk('div', 'twpzb-slotrow');
  const val = [null, null], slots = [];
  const go = btn('twpzb-go', 'Батлах'), clr = btn('twpzb-ghost', 'Арилгах');
  const paint = () => {
    slots.forEach((s, i) => {
      s.innerHTML = '<span class="twpzb-num">' + (data.need[i] + 1) + '</span>' + (val[i] == null ? '' : symSVG(val[i]));
      s.classList.toggle('twpzb-full', val[i] != null);
      s.setAttribute('aria-label', (data.need[i] + 1) + '-р тэмдэг: ' + (val[i] == null ? 'хоосон' : SYMS[val[i]].name + '. Арилгах'));
    });
    if (!fin.done) go.disabled = readOnly || val[0] == null || val[1] == null;
  };
  data.need.forEach((p, i) => {
    const s = btn('twpzb-slot'); s.setAttribute('data-i', String(i)); if (readOnly) s.disabled = true;
    s.addEventListener('click', () => { if (fin.done || fin.dead || val[i] == null) return; val[i] = null; paint(); });
    slots.push(s); top.appendChild(s);
  });
  clr.addEventListener('click', () => { if (fin.done || fin.dead) return; val[0] = val[1] = null; paint(); });
  go.addEventListener('click', () => { if (val[0] == null || val[1] == null) return; fin.finish(val[0] === data.code[data.need[0]] && val[1] === data.code[data.need[1]]); });
  if (readOnly){ clr.disabled = true; }
  const acts = mk('div', 'twpzb-acts'); acts.appendChild(clr); if (!readOnly) acts.appendChild(go);
  top.appendChild(acts);
  theirs.appendChild(top);
  const keys = mk('div', 'twpzb-keys');
  SYMS.forEach((sy, i) => {
    const k = btn('twpzb-key', symSVG(i), sy.name); k.setAttribute('data-s', String(i)); if (readOnly) k.disabled = true;
    k.addEventListener('click', () => {
      if (fin.done || fin.dead) return;
      const at = val[0] == null ? 0 : val[1] == null ? 1 : -1;
      if (at < 0){ nudge(top, [{transform: 'translateX(-4px)'}, {transform: 'translateX(4px)'}, {transform: 'none'}], 200); return; }
      val[at] = i; paint(); nudge(slots[at].querySelector('svg'), [{transform: 'scale(0.6)', opacity: 0.3}, {transform: 'none', opacity: 1}], 180);
    });
    keys.appendChild(k);
  });
  theirs.appendChild(keys);
  if (readOnly) theirs.appendChild(mk('p', 'twpzb-note', 'Найзынхаа тэмдгийг хөшөөн дээр ◎ дарж оруулна.'));
  wrap.appendChild(theirs);
  root.appendChild(wrap);
  paint();
  mount(el, root);
  return () => fin.kill();
}
// In-world device: a stone stele split down the middle; the seam glows in the partner's colour.
const SEAM = [[0, -37], [1.6, -31], [-1, -25], [1.3, -18], [-1.2, -11], [0.9, -5], [0, 0]];
function drawStele(ctx, x, g, t, P, solved, s){
  const L = look(P), gap = solved ? 0.25 : 1.5, k = 0.5 + 0.5 * Math.sin(t * 2.4 + x * 0.013);
  ctx.save(); ctx.translate(x, g); ctx.scale(s, s);
  if (solved) glow(ctx, 0, -20, 46, L.glow, 0.36);
  else glow(ctx, 0, -18, 26, L.seam, 0.1 + 0.1 * k);
  ctx.fillStyle = L.body;
  ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(-12, -27); ctx.quadraticCurveTo(-9, -36.5, -gap, -37.5);
  for (let i = 1; i < SEAM.length; i++) ctx.lineTo(SEAM[i][0] - gap, SEAM[i][1]);
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(13.5, 0); ctx.lineTo(12, -29); ctx.quadraticCurveTo(8, -38, gap, -37.5);
  for (let i = 1; i < SEAM.length; i++) ctx.lineTo(SEAM[i][0] + gap, SEAM[i][1]);
  ctx.closePath(); ctx.fill();
  ctx.fillRect(-15, -2.2, 30.5, 2.2);
  ctx.strokeStyle = L.line; ctx.lineWidth = 0.8; ctx.beginPath();
  ctx.arc(-7, -19, 2.6, 0, Math.PI * 2); ctx.moveTo(-9.5, -11); ctx.lineTo(-4.5, -11);
  ctx.moveTo(5, -16.5); ctx.lineTo(7.5, -21.5); ctx.lineTo(10, -16.5); ctx.closePath(); ctx.moveTo(4.8, -11); ctx.lineTo(9.8, -11);
  ctx.stroke();
  ctx.strokeStyle = solved ? 'rgba(' + L.glow + ',0.95)' : 'rgba(' + L.seam + ',' + (0.45 + 0.4 * k) + ')';
  ctx.lineWidth = solved ? 1.1 : 0.9; ctx.lineJoin = 'round'; ctx.beginPath();
  SEAM.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke();
  ctx.restore();
}
const drawSplitDevice = (ctx, o, t, P, solved) => drawStele(ctx, num(o && o.x, 0), GY(), t, P, !!solved, 1);
const drawSplitClue = (ctx, c, data, t, P) => drawStele(ctx, num(c && c.x, 0), GY(), t, P, false, 0.8);

// ================= registration =================
TW.puzzles.shagai = {
  title: 'Шагай',
  gen: genShagai,
  drawDevice: safe('shagai.device', drawShagaiDevice),
  drawClue: safe('shagai.clue', drawShagaiClue),
  showClue: shagaiClue,
  solve: shagaiSolve,
  answerText: shagaiAnswer
};
TW.puzzles.riddle = {
  title: 'Өнгөт чулуу',
  gen: genRiddle,
  drawDevice: safe('riddle.device', drawRiddleDevice),
  drawClue: safe('riddle.clue', drawRiddleClue),
  showClue: riddleClue,
  solve: riddleSolve,
  answerText: d => d.answer,
  ruleText, ruleTest, firstMatch
};
TW.puzzles.split = {
  title: 'Хоёр хагас',
  // both halves of a pair must be seeded alike: engine seeds with session seed + seedKey(o) (= params.pair)
  seedKey: o => String((o && o.params && o.params.pair) || (o && o.id) || ''),
  gen: genSplit,
  drawDevice: safe('split.device', drawSplitDevice),
  drawClue: safe('split.clue', drawSplitClue),
  showClue: (el, data, api) => splitView(el, data, api, true),
  solve: (el, data, api) => splitView(el, data, api, false),
  answerText: splitAnswer,
  symbols: SYMS.map(s => s.name)
};
})();
