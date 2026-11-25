"""Enemy AI tests for js/enemies.js — run: python3 tests/ai/test_ai.py [--shots]"""
import json, sys, os
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = "file://" + os.path.join(HERE, "sandbox.html")
SHOTS = "--shots" in sys.argv

HELPERS = r"""
(() => {
  const g = window.__game, C = TW.chapters.sandbox, G = TW.G;
  const base = JSON.parse(JSON.stringify(C.enemies)), deaths = [];
  TW.on('death', d => deaths.push(d));
  const cx = o => o.x + o.w / 2, ft = o => o.y + o.h;
  const E = id => g.S().enemies.find(e => e.id === id);
  function setup(cfg) {
    cfg = cfg || {};
    C.start = cfg.start || [300, 1170];
    C.enemies = base.map(d => Object.assign({}, d, (cfg.en || {})[d.id] || {}));
    deaths.length = 0;
    for (const k of ['left', 'right', 'jump', 'action', 'switch']) { g.T[k] = false; g.latch[k] = false; }
    g.start('sandbox');
    if (cfg.active != null) g.S().active = cfg.active;
  }
  // step n frames; fn(i) runs before each frame (return true to stop); records state changes per enemy id
  function run(n, fn, hist) {
    hist = hist || {};
    for (let i = 0; i < n; i++) {
      if (fn && fn(i)) return { hist, i };
      g.update(1);
      for (const e of g.S().enemies) { const h = hist[e.id] = hist[e.id] || []; if (h[h.length - 1] !== e.state) h.push(e.state); }
    }
    return { hist, i: n };
  }
  const order = (h, seq) => { let k = 0; for (const s of h) if (s === seq[k]) k++; return k === seq.length; };
  window.__ai = { g, C, G, E, cx, ft, setup, run, deaths, order };
})();
"""

TESTS = {}

TESTS['a_wolf_kills_exposed'] = r"""
(() => { const A = __ai, g = A.g;
  A.setup({ start: [300, 1170], en: { W1: { face: -1 } } });
  const S = g.S(); let died = null; g.T.right = true;
  const r = A.run(900, i => { if (S.chars[0].dying > 0) { died = { frame: i, bx: Math.round(S.chars[0].x) }; return true; } });
  g.T.right = false;
  const wolfBefore = A.E('W1');
  A.run(70);
  const w2 = A.E('W1');
  const respawned = w2 !== wolfBefore && w2.state === 'patrol' && Math.abs(w2.x - 700) < 15;
  const why = A.deaths[0] && A.deaths[0].why;
  return { pass: !!died && why === 'wolf' && A.order(r.hist.W1, ['patrol', 'alert', 'chase']) && respawned,
           died, why, wolf: r.hist.W1, respawned };
})()
"""

TESTS['b_hidden_in_grass_survives'] = r"""
(() => { const A = __ai, g = A.g;
  A.setup({ start: [630, 1170] });
  const S = g.S(); let overlaps = 0, hiddenAtOverlap = true;
  const r = A.run(1500, () => { const b = S.chars[0], w = A.E('W1');
    if (g.api.overlap(w, b)) { overlaps++; if (!b.hidden) hiddenAtOverlap = false; } });
  const states = [...new Set(r.hist.W1)];
  return { pass: A.deaths.length === 0 && overlaps > 30 && hiddenAtOverlap && states.length === 1 && states[0] === 'patrol',
           deaths: A.deaths.length, overlapFrames: overlaps, hiddenAtOverlap, wolfStates: states };
})()
"""

TESTS['c_high_rock_howl_lost'] = r"""
(() => { const A = __ai, g = A.g;
  A.setup({ start: [850, 1170], en: { W1: { x: 640 } } });
  const S = g.S(), b = S.chars[0]; let phase = 0, jumpedAt = -1, minGap = 1e9;
  const r = A.run(900, i => { const w = A.E('W1');
    if (phase === 0 && (w.state === 'alert' || w.state === 'chase')) phase = 1;
    if (phase === 1) { g.T.right = true; if (b.onGround && b.x + b.w >= 872) { g.latch.jump = true; phase = 2; jumpedAt = i; } }
    else if (phase === 2) { g.T.right = A.cx(b) < 915; if (!g.T.right && b.onGround && i > jumpedAt + 5) phase = 3; }
    if (phase === 3) minGap = Math.min(minGap, Math.abs(A.cx(w) - A.cx(b)));
    return b.dying > 0;
  });
  g.T.right = false;
  const w = A.E('W1');
  return { pass: A.deaths.length === 0 && Math.abs(A.ft(b) - (A.G - 40)) < 0.5 && A.order(r.hist.W1, ['chase', 'howl', 'lost', 'patrol']),
           deaths: A.deaths.length, brotherFeet: A.ft(b), wolf: r.hist.W1, closestWolfBrother: Math.round(minGap), wolfNow: [w.state, Math.round(w.x)] };
})()
"""

TESTS['d_raven_alarm_far_wolf'] = r"""
(() => { const A = __ai, g = A.g;
  A.setup({ start: [1650, 1170], en: { W1: { x: 2350, patrol: [2300, 2450], face: -1 } } });
  const S = g.S(), b = S.chars[0]; let alarm = null; g.T.right = true;
  const r = A.run(400, i => { const rv = A.E('R1');
    if (rv.state === 'alarm') { const w = A.E('W1'); alarm = { frame: i, wolfState: w.state, forceT: +w.forceT.toFixed(2), dist: Math.round(Math.abs(A.cx(w) - A.cx(b))), wolfX: w.x }; return true; } });
  g.T.right = false;
  const preStates = r.hist.W1.slice();
  let x15 = null; const r2 = A.run(180, i => { if (i === 90) x15 = A.E('W1').x; }, r.hist);
  const w = A.E('W1');
  return { pass: !!alarm && alarm.wolfState === 'chase' && alarm.dist > 300 && preStates.indexOf('chase') === preStates.length - 1 &&
                 alarm.wolfX - x15 > 100 && w.x < 2150 && A.deaths.length === 0,
           alarm, wolfStatesBeforeAlarm: preStates, movedIn1_5s: alarm ? Math.round(alarm.wolfX - x15) : null,
           hoppedRock2150: w.x < 2150, wolfY: w.y, raven: r2.hist.R1 };
})()
"""

TESTS['e_shulam_silent_bones_echo'] = r"""
(() => { const A = __ai, g = A.g;
  A.setup({ start: [960, 1170], active: 1, en: { W1: { x: 2600, patrol: [2550, 2700] } } });
  const S = g.S(), s = S.chars[1];
  // 1) silent sister standing still near the shulam's range for 8 s
  let minX = 1e9, maxX = -1e9;
  const r1 = A.run(480, () => { const e = A.E('S1'); minX = Math.min(minX, e.x); maxX = Math.max(maxX, e.x); });
  const silentStates = [...new Set(r1.hist.S1)];
  // 2) sister walks onto bones and stops
  g.T.right = true;
  A.run(200, () => { if (A.cx(s) >= 1225) { g.T.right = false; return true; } });
  let huntTx = null, listenSeen = false;
  const r2 = A.run(200, () => { const e = A.E('S1'); if (e.state === 'listen') listenSeen = true; if (e.state === 'hunt') { huntTx = e.tx; return true; } });
  // 3) brother (far left, x≈967) calls → echo in the dead world
  const e0 = A.E('S1'), xBefore = e0.x;
  g.latch.switch = true; g.latch.action = true; A.run(1);
  const e1 = A.E('S1'), txAfter = e1.tx, stAfter = e1.state;
  const h3 = { S1: [stAfter] };
  A.run(120, null, h3);
  const xAfter2s = A.E('S1').x;
  const r3 = A.run(900, null, h3);
  const e2 = A.E('S1');
  return { pass: silentStates.length === 1 && silentStates[0] === 'idle' && maxX - minX > 5 &&
                 listenSeen && huntTx > 1190 && huntTx < 1270 &&
                 Math.abs(txAfter - 967) < 3 && stAfter === 'hunt' && xBefore - xAfter2s > 40 &&
                 A.deaths.length === 0 && A.order(r3.hist.S1, ['hunt', 'search', 'return', 'idle']),
           silentStates, wander: [Math.round(minX), Math.round(maxX)], listenSeen, huntTx: Math.round(huntTx),
           echo: { txAfter: Math.round(txAfter), stAfter, xBefore: Math.round(xBefore), xAfter2s: Math.round(xAfter2s) },
           after: r3.hist.S1, sisterAlive: s.dying <= 0, deaths: A.deaths.length, shulamNow: [e2.state, Math.round(e2.x)] };
})()
"""

TESTS['f_shulam_never_falls'] = r"""
(() => { const A = __ai, g = A.g, G = A.G;
  const watch = st => { const e = A.E('S1'); st.maxFeet = Math.max(st.maxFeet, A.ft(e)); st.minLeft = Math.min(st.minLeft, e.x);
    if (A.cx(e) > 820 && A.cx(e) < 880) st.overGap++; };
  // f1: echo from across the gap → hunts to the edge, stops, searches, returns
  A.setup({ start: [760, 1170], active: 0, en: { W1: { x: 2600, patrol: [2550, 2700] }, S1: { x: 935, range: [900, 1000] } } });
  const st1 = { maxFeet: 0, minLeft: 1e9, overGap: 0 };
  g.latch.action = true;
  const r1 = A.run(600, () => watch(st1));
  // f2: wander range spanning the gap + calls from both sides, 40 s
  A.setup({ start: [700, 1170], active: 0, en: { W1: { x: 2600, patrol: [2550, 2700] }, S1: { x: 935, range: [700, 1000] } } });
  const S = g.S(), b = S.chars[0], st2 = { maxFeet: 0, minLeft: 1e9, overGap: 0 }; let calls = 0;
  const r2 = A.run(2400, i => { watch(st2);
    if (i % 300 === 150) { b.x = (calls % 2 ? 1000 : 700); b.y = G - b.h; b.vx = 0; b.vy = 0; b.callCd = 0; g.latch.action = true; calls++; } });
  const ok = st => st.maxFeet <= G + 0.5 && st.overGap === 0;
  return { pass: ok(st1) && ok(st2) && st1.minLeft < 890 && A.order(r1.hist.S1, ['listen', 'hunt', 'search', 'return', 'idle']) && r2.hist.S1.indexOf('hunt') >= 0 && A.deaths.length === 0,
           f1: Object.assign(st1, { states: r1.hist.S1 }), f2: Object.assign(st2, { calls, hunts: r2.hist.S1.filter(x => x === 'hunt').length }) };
})()
"""

TESTS['g_wolf_edge_gap'] = r"""
(() => { const A = __ai, g = A.g, G = A.G;
  A.setup({ start: [1600, 1170], en: { W1: { x: 1450, patrol: [1400, 1700] } } });
  let maxFeet = 0, overGap = 0;
  const r = A.run(1200, () => { const w = A.E('W1'); maxFeet = Math.max(maxFeet, A.ft(w)); if (A.cx(w) > 1500 && A.cx(w) < 1580) overGap++; });
  return { pass: maxFeet <= G + 0.5 && overGap === 0 && A.deaths.length === 0 && A.order(r.hist.W1, ['chase', 'howl', 'lost']),
           maxFeet, overGap, wolf: r.hist.W1, deaths: A.deaths.length };
})()
"""

TESTS['h_sniff_hidden_after_chase'] = r"""
(() => { const A = __ai, g = A.g;
  // brother is spotted right of the grass, runs left into the grass and freezes → wolf sniffs there, gives up
  A.setup({ start: [720, 1170], en: { W1: { x: 860, patrol: [520, 900], face: -1 } } });
  const S = g.S(), b = S.chars[0]; let phase = 0;
  const r = A.run(900, () => { const w = A.E('W1');
    if (phase === 0 && w.state === 'alert') phase = 1;
    if (phase === 1) { g.T.left = A.cx(b) > 640; if (!g.T.left) phase = 2; }
    return b.dying > 0; });
  g.T.left = false;
  return { pass: A.deaths.length === 0 && A.order(r.hist.W1, ['alert', 'chase', 'sniff', 'lost', 'patrol']) && b.hidden,
           wolf: r.hist.W1, deaths: A.deaths.length, hidden: b.hidden };
})()
"""

errs = []
results = {}
with sync_playwright() as p:
    br = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(URL)
    pg.wait_for_timeout(400)
    pg.evaluate("window.__game.pause(true);document.querySelectorAll('#fbStart').forEach(e=>e.remove());")
    pg.evaluate(HELPERS)
    for name, js in TESTS.items():
        try:
            results[name] = pg.evaluate(js)
        except Exception as ex:
            results[name] = {"pass": False, "exception": str(ex)}
        if SHOTS:
            pg.evaluate("__game.render()")
            pg.screenshot(path=os.path.join(HERE, name + ".png"))
    br.close()

allok = True
for k, v in results.items():
    ok = v.get("pass")
    allok &= bool(ok)
    print(("PASS " if ok else "FAIL ") + k, json.dumps({kk: vv for kk, vv in v.items() if kk != "pass"}, ensure_ascii=False))
print("CONSOLE ERRORS:", errs if errs else "none")
allok &= not errs
print("ALL PASS" if allok else "SOME FAILED")
sys.exit(0 if allok else 1)
