"""Puzzles B (shagai, riddle, split): screenshots + scripted solves in headless Chrome.
Run: python3 tests/puzzles-b/test_puzzles_b.py   (from anywhere)
Writes PNGs next to this file and exits non-zero on any failed check."""
import functools, http.server, json, os, sys, threading
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OPTIONAL = ('/css/puzzles.css', '/js/puzzles.js')   # designer A's files may not exist yet
SEED = 20261126
fails = []

def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond:
        fails.append(msg)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve():
    h = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

# ---- independent re-implementation of the riddle rules (cross-checks gen + ruleTest) ----
def cnt(s, c): return sum(1 for v in s if v == c)
def rule_ok(r, s):
    t = r['type']
    if t == 'two': return cnt(s, r['c']) == 2
    if t == 'none': return cnt(s, r['c']) == 0
    if t == 'any': return cnt(s, r['c']) >= 1
    if t == 'pos': return s[r['pos']] == r['c']
    if t == 'diff': return len(set(s)) == 3
    if t == 'edges': return s[0] == s[2]
    if t == 'more': return cnt(s, r['c']) > cnt(s, r['c2'])
    return True
def riddle_answer(d):
    out = ''
    for rules in d['rules']:
        for r in rules:
            if rule_ok(r, d['stones']):
                out += str(r['d']); break
    return out

def attach(page, errs):
    def on_console(m):
        if m.type != 'error': return
        url = (m.location or {}).get('url', '') or ''
        if any(url.endswith(o) for o in OPTIONAL): return
        errs.append('console: ' + m.text + ' @ ' + url)
    page.on('console', on_console)
    page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))

FIT_JS = """() => {
  const out = [];
  document.querySelectorAll('.pv-body').forEach((body, bi) => {
    const B = body.getBoundingClientRect(), root = body.querySelector('.twpzb-root');
    if (!root) { out.push('no root in body ' + bi); return; }
    const sc = root.querySelectorAll('*');
    if (root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1)
      out.push('root scrolls ' + root.scrollWidth + 'x' + root.scrollHeight + ' in ' + root.clientWidth + 'x' + root.clientHeight);
    const k = B.width / body.offsetWidth || 1;   // scaled frames (dual view)
    for (const e of [root, ...sc]) {
      const r = e.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (r.left < B.left - 1 || r.top < B.top - 1 || r.right > B.right + 1 || r.bottom > B.bottom + 1)
        out.push('outside body: ' + (e.className.baseVal != null ? e.className.baseVal : e.className) + ' ' + [r.left - B.left, r.top - B.top, r.right - B.left, r.bottom - B.top].map(v => Math.round(v)).join(','));
      if (e.tagName === 'BUTTON' && (r.width / k < 44 - 0.5 || r.height / k < 44 - 0.5))
        out.push('small target: ' + e.className + ' ' + Math.round(r.width / k) + 'x' + Math.round(r.height / k));
      if (e.children.length === 0 && e.textContent.trim() && (e.scrollWidth > e.clientWidth + 1) && getComputedStyle(e).overflow === 'hidden')
        out.push('clipped text: ' + e.className);
    }
    out.push('#body ' + Math.round(body.offsetWidth) + 'x' + Math.round(body.offsetHeight));
  });
  return out;
}"""

def fit(page, label):
    res = page.evaluate(FIT_JS)
    sizes = [r for r in res if r.startswith('#body')]
    probs = [r for r in res if not r.startswith('#body')]
    check(not probs, label + ' fits, targets >= 44px ' + ' '.join(sizes) + ('' if not probs else ' :: ' + '; '.join(probs[:6])))

def calls(page): return page.evaluate('__pzb.calls.map(c => c.r)')

def force_confirm(page, sel='.twpzb-go'):
    """Hostile second confirm: re-enable the button and click it from script; the guard must ignore it."""
    page.evaluate("""s => document.querySelectorAll('.pv-body ' + s).forEach(b => { b.disabled = false; b.click(); })""", sel)

def tap(page, sel, n=1, nth=0):
    loc = page.locator(sel).nth(nth)
    for _ in range(n):
        loc.tap()

# ------------------------------------------------------------------
def run():
    srv = serve()
    url = 'http://127.0.0.1:%d/puzzles-b-preview.html' % srv.server_address[1]
    errs = []
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path='/usr/bin/google-chrome')

        # ---------- canvases (desktop, dpr 2) ----------
        desk = br.new_context(viewport={'width': 1280, 'height': 900}, device_scale_factor=2)
        pg = desk.new_page(); attach(pg, errs)
        pg.goto(url); pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(HERE, 'canvas-all.png'), full_page=True)
        for kind in ('shagai', 'riddle', 'split'):
            for w in (0, 1):
                pg.evaluate("""id => { const c = document.getElementById(id); c.style.width = '1200px'; }""", 'cv-%s-%d' % (kind, w))
        pg.wait_for_timeout(120); pg.evaluate('__pzb.redraw()')
        for kind in ('shagai', 'riddle', 'split'):
            for w in (0, 1):
                pg.locator('#cv-%s-%d' % (kind, w)).screenshot(path=os.path.join(HERE, 'canvas-%s-w%d.png' % (kind, w)))

        # ---------- determinism, consistency, answer spaces (pure JS) ----------
        st = pg.evaluate("""() => {
          const P = TW.puzzles, g = __pzb.genFor, J = JSON.stringify, R = {};
          R.kinds = ['shagai','riddle','split'].map(k => !!(P[k] && P[k].title && P[k].gen && P[k].drawDevice && P[k].drawClue && P[k].showClue && P[k].solve));
          R.det = ['shagai','riddle','split'].every(k => J(g(k, 777, 0)) === J(g(k, 777, 0)) && J(g(k, 777, 1)) === J(g(k, 777, 1)));
          let splitOk = true, codes0 = new Set(), codes1 = new Set();
          for (let s = 1; s <= 600; s++) {
            const a = g('split', s, 0), b = g('split', s, 1);
            if (J(a.code) !== J(b.code) || a.side !== 0 || b.side !== 1 || J(a.show) !== J(b.need) || J(a.need) !== J(b.show) || J(a.show) !== '[2,3]' || J(a.need) !== '[0,1]') splitOk = false;
            codes0.add(a.need.map(i => a.code[i]).join('-')); codes1.add(b.need.map(i => b.code[i]).join('-'));
          }
          R.split = splitOk; R.split0 = codes0.size; R.split1 = codes1.size;
          // the engine rand differs per pair: pair P1 vs P2 must give different codes for most seeds
          let diffPair = 0;
          for (let s = 1; s <= 100; s++) {
            const a = P.split.gen(__pzb.rng(__pzb.hashStr(s + ':P1')), {pair:'P1', side:0}), b = P.split.gen(__pzb.rng(__pzb.hashStr(s + ':P2')), {pair:'P2', side:0});
            if (J(a.code) !== J(b.code)) diffPair++;
          }
          R.diffPair = diffPair;
          const sh = new Set(); let startSolved = 0, maxSame = 0;
          for (let s = 1; s <= 3000; s++) { const d = g('shagai', s, 0); sh.add(d.answer.join(''));
            const same = d.start.filter((v, i) => v === d.answer[i]).length; maxSame = Math.max(maxSame, same); if (same === 4) startSolved++; }
          R.shagai = sh.size; R.shStartSolved = startSolved; R.shMaxSame = maxSame;
          const ans = new Set(), rows = [[0,0,0,0],[0,0,0,0]], ruleSets = new Set(); let bad = 0, startEq = 0, samples = [];
          for (let s = 1; s <= 3000; s++) { const d = g('riddle', s, 0); ans.add(d.answer);
            ruleSets.add(J(d.rules));
            d.rules.forEach((t, i) => rows[i][P.riddle.firstMatch(t, d.stones)]++);
            if (!/^[0-9]{2}$/.test(d.answer)) bad++; if (d.start.join('') === d.answer) startEq++;
            if (s <= 60) samples.push(d); }
          R.riddle = ans.size; R.rows = rows; R.ruleSets = ruleSets.size; R.badAns = bad; R.startEq = startEq; R.samples = samples;
          R.texts = g('riddle', 5, 0).rules.map(t => t.map(r => P.riddle.ruleText(r) + ' -> ' + r.d));
          return R;
        }""")
        check(all(st['kinds']), 'all three kinds register title/gen/drawDevice/drawClue/showClue/solve')
        check(st['det'], 'gen is deterministic for a given seed')
        check(st['split'], 'split: both sides of one pair share the code; side 0 shows 3-4 / enters 1-2, side 1 the reverse (600 seeds)')
        check(st['split0'] == 64 and st['split1'] == 64, 'split: every side has 8x8 = 64 possible entries (seen %d / %d)' % (st['split0'], st['split1']))
        check(st['diffPair'] >= 90, 'split: different pairs give different codes (%d/100)' % st['diffPair'])
        check(st['shagai'] == 256, 'shagai: 4^4 = 256 answers reachable (seen %d)' % st['shagai'])
        check(st['shStartSolved'] == 0 and st['shMaxSame'] <= 2, 'shagai: never starts solved, at most 2 bones start right')
        check(st['riddle'] >= 95 and st['badAns'] == 0, 'riddle: answers are two digits and spread over 00-99 (seen %d distinct)' % st['riddle'])
        check(st['startEq'] == 0, 'riddle: dial never starts on the answer')
        check(st['ruleSets'] >= 2990, 'riddle: rule tables differ per seed (%d distinct of 3000)' % st['ruleSets'])
        print('     riddle matched row counts (first digit / second digit):', st['rows'])
        check(all(min(r) > 300 for r in st['rows']), 'riddle: every row (incl. «Бусад») fires often, not always the default')
        check(all(riddle_answer(d) == d['answer'] for d in st['samples']), 'riddle: answer matches an independent Python evaluation of the rules (60 seeds)')
        print('     sample rules seed 5:', json.dumps(st['texts'], ensure_ascii=False))
        desk.close()

        # ---------- overlays at 844x390 (touch phone, dpr 2) ----------
        phone = br.new_context(viewport={'width': 844, 'height': 390}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = phone.new_page(); attach(pg, errs)
        pg.goto(url); pg.wait_for_timeout(300)
        pg.evaluate('__pzb.autoClose = false')
        shots = [('shagai', 'solve', 0), ('shagai', 'clue', 0), ('riddle', 'solve', 0), ('riddle', 'clue', 0),
                 ('split', 'solve', 0), ('split', 'solve', 1), ('split', 'clue', 0)]
        for kind, mode, side in shots:
            pg.evaluate('([k, m, s, sd]) => __pzb.open(k, m, {seed: sd, side: s})', [kind, mode, side, SEED])
            pg.wait_for_timeout(120)
            name = 'ov-%s-%s%s.png' % (kind, mode, ('-side%d' % side) if kind == 'split' and mode == 'solve' else '')
            pg.screenshot(path=os.path.join(HERE, name))
            fit(pg, '844x390 %s %s side %d' % (kind, mode, side))
            check(pg.evaluate('__pzb.cleanups') == ['function'], '%s %s returns a cleanup function' % (kind, mode))
        dark = pg.evaluate('''() => { for (let s = 1; s < 5000; s++) { const d = __pzb.genFor('riddle', s, 0);
            if (d.stones.includes(0) && d.rules.some(t => t.some(r => r.type === 'more' && (r.c === 0 || r.c2 === 0)))) return s; } return 1; }''')
        for mode in ('solve', 'clue'):
            pg.evaluate('([m, sd]) => __pzb.open("riddle", m, {seed: sd})', [mode, dark])
            pg.screenshot(path=os.path.join(HERE, 'ov-riddle-%s-black.png' % mode)); fit(pg, '844x390 riddle %s seed %d (black stone)' % (mode, dark))
        # a second riddle seed with long rules for a look at wrapping
        pg.evaluate('([sd]) => __pzb.open("riddle", "clue", {seed: sd})', [11])
        pg.screenshot(path=os.path.join(HERE, 'ov-riddle-clue-seed11.png')); fit(pg, '844x390 riddle clue seed 11')
        pg.evaluate('([sd]) => __pzb.openDual("split", {seed: sd})', [SEED]); pg.wait_for_timeout(120)
        pg.screenshot(path=os.path.join(HERE, 'ov-split-dual.png'))

        # ---------- shagai: correct / wrong ----------
        d = pg.evaluate('([sd]) => __pzb.open("shagai", "solve", {seed: sd})', [SEED])
        for i in range(4):
            tap(pg, '.twpzb-bone[data-i="%d"]' % i, (d['answer'][i] - d['start'][i]) % 4)
        sides = pg.evaluate('() => [...document.querySelectorAll(".twpzb-bone")].map(b => +b.dataset.side)')
        check(sides == d['answer'], 'shagai: tapping cycles bones to the answer %s' % sides)
        tap(pg, '.twpzb-go'); pg.wait_for_timeout(50)
        pg.screenshot(path=os.path.join(HERE, 'ov-shagai-success.png'))
        force_confirm(pg)
        check(calls(pg) == ['success'], 'shagai: correct answer -> success exactly once %s' % calls(pg))
        d = pg.evaluate('([sd]) => __pzb.open("shagai", "solve", {seed: sd})', [SEED])
        for i in range(4):
            want = (d['answer'][i] + (1 if i == 2 else 0)) % 4
            tap(pg, '.twpzb-bone[data-i="%d"]' % i, (want - d['start'][i]) % 4)
        tap(pg, '.twpzb-go'); force_confirm(pg); pg.wait_for_timeout(50)
        pg.screenshot(path=os.path.join(HERE, 'ov-shagai-fail.png'))
        check(calls(pg) == ['fail'], 'shagai: one wrong bone -> fail exactly once %s' % calls(pg))
        pg.evaluate('([sd]) => __pzb.open("shagai", "clue", {seed: sd})', [SEED])
        labels = pg.evaluate('() => [...document.querySelectorAll(".twpzb-bone")].map(b => +b.dataset.side)')
        check(labels == d['answer'] and pg.locator('.pv-body button').count() == 0, 'shagai clue shows the answer bones, read-only')

        # ---------- riddle: correct / wrong ----------
        def set_dial(start, target):
            for w in (0, 1):
                up = (int(target[w]) - start[w]) % 10
                if up <= 5: tap(pg, '.twpzb-wheel[data-w="%d"] .twpzb-up' % w, up)
                else: tap(pg, '.twpzb-wheel[data-w="%d"] .twpzb-dn' % w, 10 - up)
        d = pg.evaluate('([sd]) => __pzb.open("riddle", "solve", {seed: sd})', [SEED])
        check(riddle_answer(d) == d['answer'], 'riddle: data answer %s = rules applied to stones %s' % (d['answer'], d['stones']))
        set_dial(d['start'], d['answer'])
        shown = pg.evaluate('() => [...document.querySelectorAll(".twpzb-digit")].map(o => o.textContent).join("")')
        check(shown == d['answer'], 'riddle: dial shows %s' % shown)
        stones = pg.evaluate('() => [...document.querySelectorAll(".twpzb-stone")].map(s => +s.dataset.c)')
        check(stones == d['stones'], 'riddle: solver sees the generated stones')
        tap(pg, '.twpzb-go'); force_confirm(pg); pg.wait_for_timeout(50)
        pg.screenshot(path=os.path.join(HERE, 'ov-riddle-success.png'))
        check(calls(pg) == ['success'], 'riddle: correct number -> success exactly once %s' % calls(pg))
        d = pg.evaluate('([sd]) => __pzb.open("riddle", "solve", {seed: sd})', [SEED])
        wrong = str((int(d['answer'][0]) + 3) % 10) + d['answer'][1]
        set_dial(d['start'], wrong); tap(pg, '.twpzb-go'); force_confirm(pg)
        check(calls(pg) == ['fail'], 'riddle: wrong number %s -> fail exactly once %s' % (wrong, calls(pg)))
        pg.evaluate('([sd]) => __pzb.open("riddle", "clue", {seed: sd})', [SEED])
        digs = pg.evaluate('() => [...document.querySelectorAll(".twpzb-table")].map(t => [...t.querySelectorAll(".twpzb-dig")].map(x => +x.textContent))')
        check(digs == [[r['d'] for r in t] for t in d['rules']] and pg.locator('.pv-body .twpzb-rule').count() == 8, 'riddle clue: two tables x 4 rows with the generated digits')
        check(pg.locator('.pv-body .twpzb-stone').count() == 0, 'riddle clue does not show the stones')

        # ---------- split: both sides, correct / wrong ----------
        S = pg.evaluate('() => TW.puzzles.split.symbols')
        for side in (0, 1):
            d = pg.evaluate('([sd, s]) => __pzb.open("split", "solve", {seed: sd, side: s})', [SEED, side])
            go_dis = pg.evaluate('() => document.querySelector(".pv-body .twpzb-go").disabled')
            tap(pg, '.twpzb-key[data-s="%d"]' % d['code'][d['need'][0]])
            tap(pg, '.twpzb-key[data-s="%d"]' % ((d['code'][d['need'][1]] + 1) % 8))
            tap(pg, '.twpzb-slot[data-i="1"]')          # tapping a filled slot clears it
            go_dis2 = pg.evaluate('() => document.querySelector(".pv-body .twpzb-go").disabled')
            tap(pg, '.twpzb-key[data-s="%d"]' % d['code'][d['need'][1]])
            check(go_dis and go_dis2 and not pg.evaluate('() => document.querySelector(".pv-body .twpzb-go").disabled'), 'split side %d: Батлах enabled only with both slots filled' % side)
            shown = pg.evaluate('() => [...document.querySelectorAll(".twpzb-tile")].map(t => [+t.dataset.p, +t.dataset.s])')
            check(shown == [[p, d['code'][p]] for p in d['show']], 'split side %d shows positions %s' % (side, [p + 1 for p in d['show']]))
            tap(pg, '.twpzb-go'); force_confirm(pg); pg.wait_for_timeout(50)
            if side == 0: pg.screenshot(path=os.path.join(HERE, 'ov-split-success.png'))
            check(calls(pg) == ['success'], 'split side %d: partner symbols %s -> success exactly once %s' % (side, [S[d['code'][p]] for p in d['need']], calls(pg)))
            d = pg.evaluate('([sd, s]) => __pzb.open("split", "solve", {seed: sd, side: s})', [SEED, side])
            tap(pg, '.twpzb-key[data-s="%d"]' % d['code'][d['need'][0]])
            tap(pg, '.twpzb-key[data-s="%d"]' % ((d['code'][d['need'][1]] + 3) % 8))
            tap(pg, '.twpzb-go'); force_confirm(pg)
            check(calls(pg) == ['fail'], 'split side %d: one wrong symbol -> fail exactly once %s' % (side, calls(pg)))
        # dual view: what side 0 shows is exactly what side 1 must enter, and both can be solved from each other's screen
        dd = pg.evaluate('([sd]) => __pzb.openDual("split", {seed: sd})', [SEED])
        tiles = pg.evaluate('() => [...document.querySelectorAll(".pv-frame")].map(f => [...f.querySelectorAll(".twpzb-tile")].map(t => +t.dataset.s))')
        need = [[dd[k]['code'][p] for p in dd[k]['need']] for k in (0, 1)]
        check(tiles[0] == need[1] and tiles[1] == need[0], 'split dual: side 0 shows %s = side 1 needs; side 1 shows %s = side 0 needs' % (tiles[0], tiles[1]))
        for k in (0, 1):
            for s in tiles[1 - k]:
                pg.locator('.pv-frame').nth(k).locator('.twpzb-key[data-s="%d"]' % s).tap(force=True)
            pg.locator('.pv-frame').nth(k).locator('.twpzb-go').tap(force=True)
        pg.wait_for_timeout(50)
        pg.screenshot(path=os.path.join(HERE, 'ov-split-dual-solved.png'))
        check(sorted(calls(pg)) == ['success', 'success'], 'split dual: both sides solved from the partner\'s symbols %s' % calls(pg))
        pg.evaluate('__pzb.close()')
        phone.close()

        # ---------- smaller landscape phones ----------
        for (w, h) in ((740, 360), (667, 375), (640, 320)):
            ctx = br.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, has_touch=True, is_mobile=True)
            pg = ctx.new_page(); attach(pg, errs)
            pg.goto(url); pg.wait_for_timeout(200)
            for kind, mode, side in shots:
                pg.evaluate('([k, m, s, sd]) => __pzb.open(k, m, {seed: sd, side: s})', [kind, mode, side, SEED])
                fit(pg, '%dx%d %s %s side %d' % (w, h, kind, mode, side))
                if (w, h) == (640, 320) and mode == 'solve' and side == 0:
                    pg.screenshot(path=os.path.join(HERE, 'small-%dx%d-%s.png' % (w, h, kind)))
            pg.evaluate('([sd]) => __pzb.open("riddle", "clue", {seed: sd})', [11]); fit(pg, '%dx%d riddle clue seed 11' % (w, h))
            if (w, h) == (640, 320): pg.screenshot(path=os.path.join(HERE, 'small-%dx%d-riddle-clue.png' % (w, h)))
            ctx.close()
        br.close()
    srv.shutdown()
    check(not errs, 'no console errors' + ('' if not errs else ' :: ' + ' | '.join(errs[:5])))
    print('\n%d check(s) failed' % len(fails) if fails else '\nall checks passed')
    return 1 if fails else 0

if __name__ == '__main__':
    sys.exit(run())
