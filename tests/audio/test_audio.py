"""Headless check of js/audio-ext.js (we can't listen, so we measure).

Renders every TW.sfxExt sound and every TW.music layer in an OfflineAudioContext
(44.1 kHz) with the same A helpers as the prototype and checks: no exceptions,
no NaN, peak within [0.01, 0.25] (contract: peaks <= 0.25), RMS > 0, music fades
out after stop, the scheduler interval is cleared, and repeated start/stop is safe.
Also opens audio-preview.html and clicks every button.

Run: python3 tests/audio/test_audio.py
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
TEST_PAGE = (ROOT / "tests/audio/offline.html").as_uri()
PREVIEW = (ROOT / "audio-preview.html").as_uri()
SFX = ["wolfGrowl", "wolfHowl", "wolfStep", "wolfBark", "ravenCaw", "ravenFlap",
       "shulamBreath", "shulamShriek", "shulamCrawl", "bones", "grassRustle", "heartbeat"]
RUNS = 4                      # sounds are randomised; take the worst case
PEAK_MIN, PEAK_MAX, CLIP = 0.01, 0.25, 0.9

fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)
    return cond


def launch(p):
    return p.chromium.launch(executable_path="/usr/bin/google-chrome",
                             args=["--autoplay-policy=no-user-gesture-required"])


def fresh(browser):
    page = browser.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(TEST_PAGE)
    page.wait_for_function("window.TW && TW.music.chase && TW.music.valley")
    return page, errs


with sync_playwright() as p:
    browser = launch(p)
    page, perrs = fresh(browser)

    missing = [n for n in SFX if not page.evaluate(f"typeof TW.sfxExt.{n} === 'function'")]
    check(not missing, f"missing sfx: {missing}")

    print(f"{'sound':14} {'peak(max)':>9} {'peak(min)':>9} {'rms':>7} {'len s':>6}")
    for name in SFX:
        if name in missing:
            continue
        rs = [page.evaluate("([n]) => runSfx(n, 1)", [name]) for _ in range(RUNS)]
        pk_hi = max(r["peak"] for r in rs)
        pk_lo = min(r["peak"] for r in rs)
        rms = min(r["rms"] for r in rs)
        ln = max(r["audibleUntil"] for r in rs)
        errs = sum((r["errs"] for r in rs), [])
        nan = sum(r["nan"] for r in rs)
        print(f"{name:14} {pk_hi:9.4f} {pk_lo:9.4f} {rms:7.4f} {ln:6.2f}")
        check(not errs, f"{name}: errors {errs[:2]}")
        check(nan == 0, f"{name}: {nan} NaN samples")
        check(pk_lo >= PEAK_MIN, f"{name}: too quiet (peak {pk_lo:.4f})")
        check(pk_hi <= PEAK_MAX, f"{name}: peak {pk_hi:.4f} > {PEAK_MAX}")
        check(pk_hi < CLIP, f"{name}: clips")
        check(rms > 1e-5, f"{name}: rms zero")

    # vol handling: 0, 0.5, undefined, out of range, bad A -> must not throw
    bad = page.evaluate("""async () => {
        const out = [];
        for (const n of Object.keys(TW.sfxExt)) {
            for (const v of [0, 0.5, undefined, 7, -1, NaN]) {
                const r = await runSfx(n, v);
                if (r.errs.length || r.nan) out.push(n + ' vol=' + v + ' ' + r.errs.join(';'));
                if (v === 0 && r.peak > 1e-6) out.push(n + ' vol=0 not silent');
            }
            try { TW.sfxExt[n](null, 1); TW.sfxExt[n]({}, 1); } catch (e) { out.push(n + ' bad A: ' + e); }
        }
        const hi = await runSfx('wolfHowl', 0.5), full = await runSfx('wolfHowl', 1);
        return out;
    }""")
    check(not bad, f"vol/arg handling: {bad[:3]}")
    page.close()

    # ---- music ----
    W = {"on": [0.0, 2.5], "full": [1.0, 2.0], "tail": [3.5, 4.0]}
    scenarios = {
        "chase": ([[0, "start", "chase"], [2.0, "stop", "chase"]], 4, W),
        "valley": ([[0, "start", "valley"], [2.0, "stop", "valley"]], 4, W),
        "chase start x2 / stop x2": ([[0, "stop", "chase"], [0, "start", "chase"], [0, "start", "chase"],
                                      [1.0, "stop", "chase"], [1.0, "stop", "chase"], [1.5, "start", "chase"],
                                      [1.5, "start", "chase"], [2.0, "stop", "chase"], [2.0, "stop", "chase"],
                                      [2.3, "start", "chase"], [2.4, "stop", "chase"]], 4,
                                     {"on": [0.0, 2.5], "tail": [3.6, 4.0]}),
        "valley start x2 / stop x2": ([[0, "start", "valley"], [0, "start", "valley"], [1.0, "stop", "valley"],
                                       [1.0, "stop", "valley"], [1.3, "start", "valley"], [2.0, "stop", "valley"],
                                       [2.0, "stop", "valley"], [2.1, "stop", "valley"]], 4,
                                      {"on": [0.0, 2.5], "tail": [3.5, 4.0]}),
        "chase toggled every 0.1 s": ([[round(k * 0.1, 1), "start" if k % 2 == 0 else "stop", "chase"]
                                       for k in range(0, 22)], 4, {"on": [0.0, 2.2], "tail": [3.6, 4.0]}),
        "chase+valley together": ([[0, "start", "chase"], [0, "start", "valley"],
                                   [2.0, "stop", "chase"], [2.0, "stop", "valley"]], 4, W),
        "valley 14 s (distant howls)": ([[0, "start", "valley"]], 14, {"on": [0.0, 14.0], "full": [1.0, 14.0]}),
    }
    print(f"\n{'music scenario':28} {'peak':>7} {'rms(on)':>8} {'tail pk':>8} {'maxIv':>5} {'ivEnd':>5}")
    for label, (plan, secs, wins) in scenarios.items():
        page, perrs = fresh(browser)
        r = page.evaluate("([p, s, w]) => runMusic(p, s, w)", [plan, secs, wins])
        on, tail = r["win"]["on"], r["win"].get("tail")
        print(f"{label:28} {on['peak']:7.4f} {on['rms']:8.4f} "
              f"{(tail['peak'] if tail else float('nan')):8.4f} {r['maxLive']:5} {r['liveAtEnd']:5}")
        if "14 s" in label:
            print("   per-second peak:", r["perSecondPeak"])
        check(not r["errs"] and not perrs, f"{label}: errors {r['errs'][:2]} {perrs[:2]}")
        check(r["all"]["nan"] == 0, f"{label}: NaN")
        check(PEAK_MIN <= on["peak"] <= PEAK_MAX, f"{label}: peak {on['peak']:.4f} outside range")
        check(on["rms"] > 1e-4, f"{label}: rms zero")
        if tail:
            check(tail["peak"] < 0.005, f"{label}: not faded out after stop (tail peak {tail['peak']:.4f})")
        layers = {x[2] for x in plan}
        check(r["maxLive"] <= len(layers), f"{label}: {r['maxLive']} scheduler intervals for {len(layers)} layer(s)")
        check(r["liveAtEnd"] == 0, f"{label}: {r['liveAtEnd']} scheduler interval(s) left running")
        page.close()

    # fade-in shape for chase: quiet at the start, full after ~1 s
    page, perrs = fresh(browser)
    r = page.evaluate("([p, s, w]) => runMusic(p, s, w)",
                      [[[0, "start", "chase"]], 3, {"first": [0.0, 0.25], "later": [1.2, 3.0]}])
    f0, f1 = r["win"]["first"]["rms"], r["win"]["later"]["rms"]
    print(f"\nchase fade-in rms first 0.25 s {f0:.4f} vs after 1.2 s {f1:.4f}")
    check(f0 < f1 * 0.5, "chase: no audible fade-in")
    page.close()

    # ---- preview page: click everything with a real AudioContext ----
    page = browser.new_page()
    perrs = []
    page.on("pageerror", lambda e: perrs.append(str(e)))
    page.on("console", lambda m: perrs.append(m.text) if m.type == "error" else None)
    page.goto(PREVIEW)
    btns = page.locator("button[data-sfx]")
    n_sfx = btns.count()
    for i in range(n_sfx):
        btns.nth(i).click()
    for name in ("chase", "valley"):
        t = page.locator(f"button[data-music='{name}']")
        t.click(); page.wait_for_timeout(300); t.click(); t.click(); t.click()
    page.wait_for_timeout(1500)
    state = page.evaluate("window.__previewA && __previewA.AC.state")
    print(f"\npreview: {n_sfx} sfx buttons, AudioContext {state}, errors {perrs[:2]}")
    check(n_sfx == len(SFX), f"preview has {n_sfx} sfx buttons, want {len(SFX)}")
    check(state == "running", f"preview AudioContext state {state}")
    check(not perrs, f"preview errors: {perrs[:2]}")
    browser.close()

print()
if fails:
    print("FAIL")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("PASS")
