"""Puzzle kinds A (symbols, drum, stars, maze): screenshots + correct/incorrect solves.

Run:  python3 tests/puzzles/test_puzzles.py
- mobile context 844x390, has_touch, is_mobile, dpr 2: every overlay screenshotted, solved by real touch
  (taps + CDP touch holds for the drum), success/fail must fire exactly once, layout must fit without scrolling,
  touch targets >= 44 px.
- desktop context: in-world canvases (both palettes) + keyboard solves.
- no console errors / page errors anywhere.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(ROOT, 'puzzles-preview.html')
KINDS = ['symbols', 'drum', 'stars', 'maze']
errors, fails = [], []


def check(cond, msg):
    if cond:
        print('  ok  ', msg)
    else:
        print('  FAIL', msg)
        fails.append(msg)


def watch(page, tag):
    page.on('console', lambda m: m.type == 'error' and errors.append(f'{tag} console: {m.text}'))
    page.on('pageerror', lambda e: errors.append(f'{tag} pageerror: {e}'))


def shot(page, name, el=None):
    path = os.path.join(OUT, name + '.png')
    (el or page).screenshot(path=path)
    return path


def calls(page):
    return page.evaluate('window.__pz.cur ? window.__pz.cur.calls : (window.__pz.last ? window.__pz.last.calls : null)')


def open_pz(page, kind, mode):
    data = page.evaluate('([k,m]) => window.__pz.open(k, m)', [kind, mode])
    page.wait_for_timeout(120)
    return data


def center(page, sel):
    b = page.locator(sel).first.bounding_box()
    return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2


def tap(page, sel):
    x, y = center(page, sel)
    page.touchscreen.tap(x, y)
    page.wait_for_timeout(60)


def touch_hold(cdp, x, y, ms):
    pt = [{'x': x, 'y': y, 'id': 1}]
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pt})
    time.sleep(ms / 1000)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    time.sleep(0.09)


def layout_ok(page, kind, mode):
    r = page.evaluate('''() => {
      const b = document.querySelector('.pv-b'), root = b.querySelector('.twpz'), br = b.getBoundingClientRect();
      const out = []; let small = [];
      root.querySelectorAll('button, .twpz-star-hit').forEach(e => {
        if (e.closest('[hidden]')) return;
        const r = e.getBoundingClientRect();
        if (r.left < br.left - 1 || r.right > br.right + 1 || r.top < br.top - 1 || r.bottom > br.bottom + 1) out.push(e.className.baseVal || e.className);
        if (r.width < 44 || r.height < 44) small.push((e.className.baseVal || e.className) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
      const txt = [...root.querySelectorAll('.twpz-side > *')].filter(e => { const r = e.getBoundingClientRect(); return r.bottom > br.bottom + 1 || r.right > br.right + 1; }).map(e => e.className);
      return {w: br.width, h: br.height, scroll: root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1, out, small, txt};
    }''')
    check(not r['scroll'] and not r['out'] and not r['txt'], f'{kind}/{mode} fits {r["w"]:.0f}x{r["h"]:.0f} without scrolling {r["out"] or ""}{r["txt"] or ""}')
    if mode == 'solve':
        check(not r['small'], f'{kind}/{mode} touch targets >= 44px {r["small"] or ""}')


# ---------------- correct / wrong answers through the UI (touch) ----------------
def do_symbols(page, cdp, data, right):
    seq = list(data['seq'])
    if not right:
        seq[1], seq[2] = seq[2], seq[1]
    for i, s in enumerate(seq):
        tap(page, f'.twpz-key[data-sym="{s}"]')
        if i == 1 and right:
            shot(page, 'm_symbols_solve_2picked')
    tap(page, '.twpz-btn--go')


def do_drum(page, cdp, data, right):
    beats = list(data['beats'])
    if not right:
        beats[0] = 1 - beats[0]
    x, y = center(page, '.twpz-drum')
    for i, b in enumerate(beats):
        touch_hold(cdp, x, y, 620 if b else 50)
        if i == 2 and right:
            shot(page, 'm_drum_solve_3taps')
    tap(page, '.twpz-btn--go')


def do_stars(page, cdp, data, right):
    edges = [list(e) for e in data['edges']]
    if not right:
        edges = edges[:-1]   # one line missing
    for i, (a, b) in enumerate(edges):
        tap(page, f'.twpz-star[data-i="{a}"]')
        tap(page, f'.twpz-star[data-i="{b}"]')
        if i == 0 and right:
            tap(page, f'.twpz-star[data-i="{edges[1][0]}"]')   # leave one star selected for the screenshot
            shot(page, 'm_stars_solve_progress')
            tap(page, f'.twpz-star[data-i="{edges[1][0]}"]')   # deselect again
    tap(page, '.twpz-btn--go')


def do_maze(page, cdp, data, right):
    for q, f in enumerate(data['forks']):
        lm = f['map'][f['ok']]
        if not right and q == 3:
            lm = [d for d in f['doors'] if d != lm][0]
        tap(page, f'.twpz-door[data-lm="{lm}"]')
        page.wait_for_timeout(330)
        if q == 1 and right:
            shot(page, 'm_maze_solve_step3')
    shot(page, 'm_maze_solve_summary' if right else 'm_maze_wrong_summary')
    tap(page, '.twpz-btn--go')


DO = {'symbols': do_symbols, 'drum': do_drum, 'stars': do_stars, 'maze': do_maze}


def run_mobile(p, browser):
    ctx = browser.new_context(viewport={'width': 844, 'height': 390}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page(); watch(page, 'mobile')
    page.goto(URL); page.wait_for_timeout(300)
    cdp = ctx.new_cdp_session(page)
    page.evaluate('window.__pz.closeDelay = {ok: 1000, bad: 1600}')   # keep the result frame up for the screenshot
    for kind in KINDS:
        print(f'[mobile] {kind}')
        # clue view
        open_pz(page, kind, 'clue')
        if kind == 'drum':
            page.wait_for_function("document.querySelector('.twpz-drum.is-lit')", timeout=3000)
        page.wait_for_timeout(60)
        shot(page, f'm_{kind}_clue'); layout_ok(page, kind, 'clue')
        if kind == 'drum':   # the lit frame, for review: stop the flash timers via cleanup, then light it
            page.evaluate('''() => { const b = document.querySelector('.pv-b'); window.__pz.close(); const ov = document.getElementById('pvOv'); ov.hidden = false;
              const stop = TW.puzzles.drum.showClue(b, window.__pz.genFor('drum', 20261126), {}); stop();
              b.querySelector('.twpz-drum').classList.add('is-lit'); }''')
            page.wait_for_timeout(120)
            shot(page, 'm_drum_clue_lit')
            page.evaluate("document.getElementById('pvOv').hidden = true; document.querySelector('.pv-b').innerHTML = ''")
        page.evaluate('window.__pz.close()')
        # solve view
        open_pz(page, kind, 'solve')
        shot(page, f'm_{kind}_solve'); layout_ok(page, kind, 'solve')
        for right in (True, False):
            print('   ..', kind, 'right' if right else 'wrong', flush=True)
            data = open_pz(page, kind, 'solve')
            DO[kind](page, cdp, data, right)
            page.evaluate("() => { const b = document.querySelector('.pv-b .twpz-btn--go'); if (b) { b.disabled = false; b.click(); } }")
            page.wait_for_timeout(60)
            c = calls(page)
            exp = {'success': 1, 'fail': 0} if right else {'success': 0, 'fail': 1}
            print('   .. answered', c, flush=True)
            if right:
                shot(page, f'm_{kind}_solved')
            else:
                shot(page, f'm_{kind}_failed')
            # hammer the confirm button again: must not call again
            page.evaluate("() => { const b = document.querySelector('.pv-b .twpz-btn--go'); if (b) { b.disabled = false; b.click(); } }")
            page.wait_for_timeout(1900)   # engine-like auto close (delays raised for screenshots)
            c = page.evaluate('window.__pz.last && window.__pz.last.calls')
            closed = page.evaluate('window.__pz.last && window.__pz.last.closed')
            check(c and c['success'] == exp['success'] and c['fail'] == exp['fail'],
                  f'{kind} {"correct" if right else "wrong"} -> success {c and c["success"]}, fail {c and c["fail"]} (exactly once)')
            check(closed == 'engine' and c['close'] == 0, f'{kind} closed by engine timer, no extra api.close ({closed}, close={c and c["close"]})')
    ctx.close()


# ---------------- desktop: in-world canvases + keyboard ----------------
def run_desktop(p, browser):
    ctx = browser.new_context(viewport={'width': 1100, 'height': 900}, device_scale_factor=2)
    page = ctx.new_page(); watch(page, 'desktop')
    page.goto(URL); page.wait_for_timeout(400)
    page.evaluate('window.__pz.freeze(1.05)')   # drum clue lit at t=1.05 s
    for kind in KINDS:
        for w in (0, 1):
            shot(page, f'w_{kind}_{w}', page.locator(f'#cv-{kind}-{w}'))
    # zoomed crops of in-world art at real game scale x3 (single device + clue)
    page.evaluate('''() => {
      const c = document.createElement('canvas'); c.id = 'zoom'; c.width = 1200; c.height = 330; c.style.width = '1200px'; document.body.prepend(c);
      const ctx = c.getContext('2d'), P = window.__pz.PAL, K = ['symbols','drum','stars','maze'];
      [0,1].forEach(w => { ctx.setTransform(3,0,0,3,0,w*165);
        const g = ctx.createLinearGradient(0,0,0,55); g.addColorStop(0, w ? '#06070a' : '#3d382f'); g.addColorStop(1, w ? '#252a34' : '#a3967b');
        ctx.fillStyle = g; ctx.fillRect(0,0,400,55); ctx.fillStyle = w ? '#c2c7cf' : '#0b0a09'; ctx.fillRect(0,45,400,10);
        ctx.translate(0,-145);
        K.forEach((k,i) => { const T = TW.puzzles[k], d = window.__pz.genFor(k, 20261126);
          T.drawDevice(ctx, {x: 42 + i*100}, 1.05, P[w], w === 1); T.drawClue(ctx, {x: 84 + i*100}, d, 1.05, P[w]); });
      });
      ctx.setTransform(1,0,0,1,0,0);
    }''')
    shot(page, 'w_zoom_ground_x3', page.locator('#zoom'))
    page.evaluate("document.getElementById('zoom').remove()")
    # keyboard solves
    print('[desktop] keyboard')
    d = open_pz(page, 'symbols', 'solve')
    grid = d['grid']
    for s in d['seq']:
        page.keyboard.press(str(grid.index(s) + 1))
    page.keyboard.press('Enter'); page.keyboard.press('Enter')
    page.wait_for_timeout(50); c = calls(page)
    check(c['success'] == 1 and c['fail'] == 0, f'symbols keyboard (digits + Enter twice) -> success once ({c})')
    page.wait_for_timeout(800)

    d = open_pz(page, 'drum', 'solve')
    for b in d['beats']:
        page.keyboard.down(' '); page.wait_for_timeout(520 if b else 110); page.keyboard.up(' '); page.wait_for_timeout(80)
    shot(page, 'd_drum_keyboard_taps')
    page.keyboard.press('Enter'); page.wait_for_timeout(50); c = calls(page)
    check(c['success'] == 1 and c['fail'] == 0, f'drum keyboard (Space hold) -> success once ({c})')
    page.wait_for_timeout(800)

    d = open_pz(page, 'stars', 'solve')
    def go(i):
        page.keyboard.press('ArrowLeft'); [page.keyboard.press('ArrowLeft') for _ in range(4)]
        [page.keyboard.press('ArrowUp') for _ in range(3)]
        for _ in range(i % 4): page.keyboard.press('ArrowRight')
        for _ in range(i // 4): page.keyboard.press('ArrowDown')
        page.keyboard.press(' ')
    page.keyboard.press(' ')   # first Space only shows the cursor
    for a, b in d['edges']:
        go(a); go(b)
    shot(page, 'd_stars_keyboard')
    page.keyboard.press('Enter'); page.wait_for_timeout(50); c = calls(page)
    check(c['success'] == 1 and c['fail'] == 0, f'stars keyboard (arrows + Space) -> success once ({c})')
    page.wait_for_timeout(800)

    d = open_pz(page, 'maze', 'solve')
    for f in d['forks']:
        page.keyboard.press(str(f['doors'].index(f['map'][f['ok']]) + 1)); page.wait_for_timeout(300)
    page.keyboard.press('Enter'); page.wait_for_timeout(50); c = calls(page)
    check(c['success'] == 1 and c['fail'] == 0, f'maze keyboard (1/2/3 + Enter) -> success once ({c})')
    page.wait_for_timeout(800)

    # cleanup: no engine close -> module closes itself once after success; closing early cancels timers
    r = page.evaluate('''async () => {
      const T = TW.puzzles, out = {};
      for (const k of ['symbols','drum','stars','maze']) {
        const el = document.createElement('div'); el.style.cssText = 'position:relative;width:780px;height:290px'; document.body.appendChild(el);
        const n = {success:0, fail:0, close:0}, api = {success(){n.success++}, fail(){n.fail++}, close(){n.close++}};
        const d = window.__pz.genFor(k, 5), stop = T[k].solve(el, d, api);
        const root = el.querySelector('.twpz');
        if (k === 'symbols') { d.seq.forEach(s => root.querySelector(`.twpz-key[data-sym="${s}"]`).click()); }
        if (k === 'stars') { d.edges.forEach(([a,b]) => { root.querySelector(`.twpz-star[data-i="${a}"]`).dispatchEvent(new MouseEvent('click',{bubbles:true})); root.querySelector(`.twpz-star[data-i="${b}"]`).dispatchEvent(new MouseEvent('click',{bubbles:true})); }); }
        if (k === 'maze') { for (const f of d.forks) { root.querySelector(`.twpz-door[data-lm="${f.map[f.ok]}"]`).click(); await new Promise(r => setTimeout(r, 300)); } }
        if (k === 'drum') { stop(); out[k] = n; el.remove(); continue; }
        root.querySelector('.twpz-btn--go').click(); root.querySelector('.twpz-btn--go').click();
        await new Promise(r => setTimeout(r, 1400));
        stop(); stop(); out[k] = n; el.remove();
      }
      // showClue drum: timers cancelled by cleanup
      const el = document.createElement('div'); document.body.appendChild(el);
      const stop = T.drum.showClue(el, window.__pz.genFor('drum', 5), {close(){}});
      await new Promise(r => setTimeout(r, 900)); stop();
      const lit0 = el.querySelector('.twpz-drum').classList.contains('is-lit');
      await new Promise(r => setTimeout(r, 2500));
      out.clueAfter = el.querySelector('.twpz-drum').classList.contains('is-lit') !== lit0 ? 'changed' : 'frozen';
      el.remove();
      return out;
    }''')
    for k in ['symbols', 'stars', 'maze']:
        check(r[k] == {'success': 1, 'fail': 0, 'close': 1}, f'{k}: without engine close -> success 1, self-close 1 ({r[k]})')
    check(r['clueAfter'] == 'frozen', f'drum clue timers stop after cleanup ({r["clueAfter"]})')

    # determinism + answer space sanity
    r = page.evaluate('''() => {
      const out = {}, P = TW.puzzles;
      for (const k of ['symbols','drum','stars','maze']) {
        const a = JSON.stringify(window.__pz.genFor(k, 77)), b = JSON.stringify(window.__pz.genFor(k, 77));
        const seen = new Set(); for (let s = 0; s < 400; s++) seen.add(JSON.stringify(k==='stars' ? window.__pz.genFor(k, s).edges : k==='maze' ? window.__pz.genFor(k,s).forks.map(f=>f.map[f.ok]) : k==='drum' ? window.__pz.genFor(k,s).beats : window.__pz.genFor(k,s).seq));
        out[k] = {same: a === b, distinct: seen.size};
      }
      const lens = {}; for (let s = 0; s < 400; s++) { const n = window.__pz.genFor('drum', s).beats.length; lens[n] = (lens[n]||0)+1; }
      out.drumLens = lens;
      let okDoors = true; for (let s = 0; s < 400; s++) window.__pz.genFor('maze', s).forks.forEach(f => { if (f.doors.indexOf(f.map[f.ok]) === f.ok) okDoors = false; });
      out.doorsShuffled = okDoors;
      return out;
    }''')
    for k in KINDS:
        check(r[k]['same'], f'{k} gen deterministic for the same seed; {r[k]["distinct"]} distinct answers in 400 seeds')
    check(set(r['drumLens'].keys()) <= {'5', '6'}, f'drum lengths {r["drumLens"]}')
    check(r['doorsShuffled'], 'maze: the right door is never at its map position')
    page.evaluate('window.__pz.close()')
    shot(page, 'd_preview_top')
    ctx.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/google-chrome')
        run_mobile(p, browser)
        run_desktop(p, browser)
        browser.close()
    check(not errors, 'no console errors' + ('' if not errors else ': ' + ' | '.join(errors[:6])))
    print('\n' + ('ALL OK' if not fails else f'{len(fails)} FAILED'))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
