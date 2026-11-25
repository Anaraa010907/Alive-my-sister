"""TW.net local transport (BroadcastChannel, ?net=local): two/three pages in one browser context.
Run: python3 tests/net/test_net_local.py   (starts and stops its own http.server)"""
import os, socket, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
fails = []

def check(cond, what):
    print(('PASS ' if cond else 'FAIL ') + what)
    if not cond: fails.append(what)

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

def evs(pg, kind=None):
    return pg.evaluate("k => window.__ev.filter(e => !k || e.ev === k)", kind)

def wait_for(pg, js, arg=None, timeout=5000):
    try:
        pg.wait_for_function(js, arg=arg, timeout=timeout); return True
    except Exception:
        return False

port = free_port()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(0.6)
    URL = f'http://127.0.0.1:{port}/net-test.html?net=local'
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path='/usr/bin/google-chrome')
        ctx = br.new_context()
        errs = []
        def page(name):
            pg = ctx.new_page()
            pg.on('pageerror', lambda e, n=name: errs.append(f'{n}: {e}'))
            pg.goto(URL); pg.wait_for_function('window.TW && TW.net && window.__ev')
            return pg
        A, B, C = page('A'), page('B'), page('C')
        check(A.evaluate('TW.net.transport') == 'local' and A.evaluate('TW.net.available()'), 'local transport available')

        # --- create / join ---
        A.evaluate("TW.net.setInfo({role:0})")
        t = time.time(); code = A.evaluate('TW.net.create()'); dt = time.time() - t
        check(isinstance(code, str) and len(code) == 4 and all(c in ALPHA for c in code), f'create → code {code!r} ({dt:.2f}s)')
        check(A.evaluate('TW.net.isHost && TW.net.connected && TW.net.code') == code, 'A is host, connected, code set')
        st = [e['d']['state'] for e in evs(A, 'status')]
        check(st[:2] == ['connecting', 'connected'], f'A status sequence {st}')
        r = B.evaluate("c => TW.net.join(c).then(v => 'ok:' + v, e => 'err:' + e.message)", code.lower())
        check(r == 'ok:' + code, f'B join (lowercase input) → {r}')
        check(B.evaluate('!TW.net.isHost && TW.net.connected'), 'B is guest, connected')
        okA = wait_for(A, "() => __ev.some(e => e.ev==='peer' && e.d.present && e.d.info.host===false)")
        okB = wait_for(B, "() => __ev.some(e => e.ev==='peer' && e.d.present && e.d.info.host===true && e.d.info.role===0)")
        check(okA and okB, 'peer {present:true} on both sides (B sees host info role 0)')
        B.evaluate("TW.net.setInfo({role:1, ready:true})")
        check(wait_for(A, "() => { const p = TW.net.peer(); return p && p.role===1 && p.ready===true; }"), 'setInfo on B → A sees peer info change')
        check(any(e['d']['present'] and e['d']['info'].get('role') == 1 for e in evs(A, 'peer')), 'A got a peer event for the info change')

        # --- ping both ways, no echo ---
        A.evaluate("TW.net.send({t:'ping', n:1, ts:Date.now()})")
        check(wait_for(A, "() => __ev.some(e => e.ev==='message' && e.d.t==='pong' && e.d.n===1)"), 'A ping → B → pong back to A')
        B.evaluate("TW.net.send({t:'ping', n:2, ts:Date.now()})")
        check(wait_for(B, "() => __ev.some(e => e.ev==='message' && e.d.t==='pong' && e.d.n===2)"), 'B ping → A → pong back to B')
        check(not any(m['d'].get('t') == 'ping' and m['d'].get('n') == 1 for m in evs(A, 'message')), 'sender does not receive its own message')

        # --- 'st' coalescing ---
        B.evaluate("window.__ev.length = 0")
        A.evaluate("for (let i = 1; i <= 10; i++) TW.net.send({t:'st', x:i, y:0})")
        B.wait_for_timeout(500)
        sts = [m['d']['x'] for m in evs(B, 'message') if m['d'].get('t') == 'st']
        check(1 <= len(sts) <= 3 and sts[-1] == 10, f"10 'st' in one tick → received {sts} (coalesced, latest kept)")

        # --- unchanged 'st' (idle player) is not re-sent more than once per second ---
        B.evaluate("window.__ev.length = 0")
        A.evaluate("window.__idle = setInterval(() => TW.net.send({t:'st', x:7, y:0}), 100); 0")
        B.wait_for_timeout(2600)
        A.evaluate("clearInterval(__idle)")
        n7 = len([m for m in evs(B, 'message') if m['d'].get('t') == 'st'])
        check(2 <= n7 <= 4, f"26 identical 'st' over 2.6 s → {n7} sent (1 s keepalive)")
        A.evaluate("TW.net.send({t:'st', x:8, y:0})")
        check(wait_for(B, "() => __ev.some(e => e.ev==='message' && e.d.t==='st' && e.d.x===8)", timeout=1000), "a changed 'st' goes out at once")

        # --- events: none dropped, in order, ≤ 20/s; st interleaved stays latest ---
        B.evaluate("window.__ev.length = 0")
        A.evaluate("""window.__sent = []; const pm = BroadcastChannel.prototype.postMessage;
            BroadcastChannel.prototype.postMessage = function(d){ if (d && d.k === 'm') __sent.push(performance.now()); return pm.call(this, d); }; 0""")
        A.evaluate("for (let i = 0; i < 30; i++) { TW.net.send({t:'trig', id:'T'+i}); TW.net.send({t:'st', x:100+i}); }")
        check(wait_for(B, "() => __ev.filter(e => e.ev==='message' && e.d.t==='trig').length >= 30", timeout=8000), '30 events all delivered')
        B.wait_for_timeout(300)
        ms = [m for m in evs(B, 'message')]
        trig = [m['d']['id'] for m in ms if m['d']['t'] == 'trig']
        check(trig == ['T%d' % i for i in range(30)], 'events in order, none dropped')
        sent = A.evaluate('__sent'); n = len(sent); span = (sent[-1] - sent[0]) / 1000
        win = max(sum(1 for y in sent if x <= y < x + 1000) for x in sent)
        gap = min(b - a for a, b in zip(sent, sent[1:]))
        check(n == len(ms) and win <= 20 and gap >= 49.5, f'rate limit (sender side): {n} msgs over {span:.2f}s, max {win} in any 1 s window, min gap {gap:.1f} ms')
        sx = [m['d']['x'] for m in ms if m['d']['t'] == 'st']
        check(len(sx) < 30 and sx and sx[-1] == 129, f"interleaved 'st' coalesced: {len(sx)} sent, last x={sx[-1] if sx else None}")

        # --- third player → full; unknown code → notfound ---
        r = C.evaluate("c => TW.net.join(c).then(v => 'ok', e => 'err:' + e.message)", code)
        check(r == 'err:full', f'third page join → {r}')
        check(any(e['d']['state'] == 'error' and e['d']['detail'] == 'full' for e in evs(C, 'status')), "C status {state:'error', detail:'full'}")
        bad = 'ZZZZ' if code != 'ZZZZ' else 'YYYY'
        t = time.time(); r = C.evaluate("c => TW.net.join(c).then(v => 'ok', e => 'err:' + e.message)", bad)
        check(r == 'err:notfound', f'join unknown code {bad} → {r} ({time.time()-t:.2f}s)')
        r = C.evaluate("TW.net.join('I0O1').then(v => 'ok', e => 'err:' + e.message)")
        check(r == 'err:notfound', f'join invalid code → {r}')
        A.wait_for_timeout(300)
        check(all(e['d']['info'].get('id') == B.evaluate('TW.net.id') for e in evs(A, 'peer')), 'A peer events only ever about B (C never counted)')

        # --- reconnect path (simulated channel loss) ---
        A.evaluate("window.__ev.length = 0"); B.evaluate("window.__ev.length = 0")
        B.evaluate("TW.net._drop()")
        check(B.evaluate("TW.net.connected") is False, 'during reconnect connected=false')
        ok = wait_for(B, "() => __ev.some(e => e.ev==='status' && e.d.state==='connected' && e.d.detail==='reconnected')", timeout=6000)
        sts = [(e['d']['state'], e['d'].get('detail'), e['d'].get('attempt')) for e in evs(B, 'status')]
        check(ok and sts[0] == ('connecting', 'reconnect', 1), f'B reconnect statuses {sts}')
        A.evaluate("TW.net.send({t:'ping', n:3, ts:Date.now()})")
        check(wait_for(A, "() => __ev.some(e => e.ev==='message' && e.d.t==='pong' && e.d.n===3)"), 'messages flow after reconnect')
        check(not any(not e['d']['present'] for e in evs(A, 'peer')), 'A saw no peer leave during the short reconnect')

        # --- leave → peer {present:false}; idempotent ---
        A.evaluate("window.__ev.length = 0"); B.evaluate("window.__ev.length = 0")
        B.evaluate("TW.net.leave(); TW.net.leave();")
        check(wait_for(A, "() => __ev.some(e => e.ev==='peer' && !e.d.present)", timeout=2000), 'B leave → A peer {present:false} (bye)')
        check(A.evaluate('TW.net.peer()') is None and A.evaluate('TW.net.connected'), 'A still in room, peer() null')
        bst = [e['d']['state'] for e in evs(B, 'status')]
        check(bst == ['idle'] and B.evaluate('!TW.net.connected && TW.net.code === null'), f'B leave idempotent, statuses {bst}')
        check(B.evaluate("TW.net.send({t:'x'})") is False, 'send after leave → false, no throw')

        # --- heartbeat timeout (frozen tab, no bye) ---
        r = C.evaluate("c => TW.net.join(c).then(v => 'ok', e => 'err:' + e.message)", code)
        check(r == 'ok', f'C can join after B left → {r}')
        check(wait_for(A, "() => __ev.some(e => e.ev==='peer' && e.d.present)"), 'A sees C')
        A.evaluate("window.__ev.length = 0")
        C.evaluate("BroadcastChannel.prototype.postMessage = function(){}; 0")   # C goes silent, never says bye
        t = time.time()
        ok = wait_for(A, "() => __ev.some(e => e.ev==='peer' && !e.d.present)", timeout=6000)
        check(ok and time.time() - t <= 4.5, f'silent peer timed out after {time.time()-t:.1f}s (timeout 3 s)')

        # --- host leaves → guest sees it ---
        D = page('D')
        r = D.evaluate("c => TW.net.join(c).then(v => 'ok', e => 'err:' + e.message)", code)
        check(r == 'ok', f'D joins → {r}')
        A.evaluate("TW.net.leave()")
        check(wait_for(D, "() => __ev.some(e => e.ev==='peer' && !e.d.present && e.d.info.host)", timeout=2000), 'host leave → guest peer {present:false}')

        # --- cancel: leave during join rejects, nothing hangs ---
        r = D.evaluate("(() => { const p = TW.net.join('ABCD').then(v => 'ok', e => 'err:' + e.message); TW.net.leave(); return p; })()")
        check(r == 'err:cancelled', f'leave while joining → {r}')

        check(not errs, f'no page errors {errs}')
        br.close()
finally:
    srv.terminate()
    try: srv.wait(5)
    except Exception: srv.kill()

print('\nRESULT:', 'ALL PASS' if not fails else f'{len(fails)} FAIL: {fails}')
sys.exit(1 if fails else 0)
