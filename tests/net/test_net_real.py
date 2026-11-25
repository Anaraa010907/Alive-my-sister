"""TW.net real transport (Supabase Realtime via supabase-js UMD from cdn.jsdelivr.net).
Tries the real backend; if the network blocks the CDN or the WebSocket, checks that the failure surfaces as
status {state:'error', detail:'offline'} within ~6 s with nothing thrown. Also forces both failure modes.
Run: python3 tests/net/test_net_real.py   (starts and stops its own http.server)"""
import faulthandler, os, socket, subprocess, sys, threading, time
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
fails, notes = [], []

def check(cond, what):
    print(('PASS ' if cond else 'FAIL ') + what)
    if not cond: fails.append(what)

def note(s):
    print('NOTE ' + s); notes.append(s)

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

def evs(pg, kind=None):
    return pg.evaluate("k => window.__ev.filter(e => !k || e.ev === k)", kind)

def wait_for(pg, js, arg=None, timeout=8000):
    try:
        pg.wait_for_function(js, arg=arg, timeout=timeout); return True
    except Exception:
        return False

# settle the promise in JS, with a hard cap so a stuck promise can never hang the test
TRY = "p => Promise.race([p.then(v => ({ok:true, v}), e => ({ok:false, v:e.message})), new Promise(r => setTimeout(() => r({ok:false, v:'HUNG'}), 20000))])"

port = free_port()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def _watchdog():   # never leave the server running, even if the browser hangs
    print('WATCHDOG: test hung, aborting'); faulthandler.dump_traceback(); srv.kill(); os._exit(2)
wd = threading.Timer(240, _watchdog); wd.daemon = True; wd.start()
try:
    time.sleep(0.6)
    URL = f'http://127.0.0.1:{port}/net-test.html'
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    with sync_playwright() as p:
        kw = {'executable_path': '/usr/bin/google-chrome'}
        if proxy: kw['proxy'] = {'server': proxy, 'bypass': '127.0.0.1,localhost'}
        br = p.chromium.launch(**kw)
        errs, cons, wsl = [], [], []

        def page(ctx, name):
            pg = ctx.new_page()
            pg.on('pageerror', lambda e, n=name: errs.append(f'{n}: {e}'))
            pg.on('console', lambda m, n=name: cons.append(f'{n} {m.type}: {m.text}'))
            pg.on('websocket', lambda ws, n=name: (wsl.append(f'{n} ws open {ws.url.split("?")[0]}'),
                  ws.on('close', lambda _=None: wsl.append(f'{n} ws closed')),
                  ws.on('socketerror', lambda e: wsl.append(f'{n} ws error {e}'))))
            pg.goto(URL); pg.wait_for_function('window.TW && TW.net && window.__ev')
            return pg

        def create(pg):
            t = time.time(); r = pg.evaluate(f"({TRY})(TW.net.create())"); return r, time.time() - t

        # ---------- 1. the real thing ----------
        ctx = br.new_context()
        A = page(ctx, 'A')
        check(A.evaluate('TW.net.transport') == 'supabase' and A.evaluate('TW.net.available()'), 'supabase transport, available() true')
        r, dt = create(A)
        lib = A.evaluate('!!(window.supabase && supabase.createClient)')
        note(f'real create → {r} in {dt:.1f}s; supabase-js script loaded from CDN: {lib}')
        if r['ok']:
            code = r['v']
            B = page(ctx, 'B'); C = page(ctx, 'C')
            j = B.evaluate(f"c => ({TRY})(TW.net.join(c))", code)
            check(j == {'ok': True, 'v': code}, f'B join {code} → {j}')
            okA = wait_for(A, "() => __ev.some(e => e.ev==='peer' && e.d.present)")
            okB = wait_for(B, "() => __ev.some(e => e.ev==='peer' && e.d.present && e.d.info.host)")
            check(okA and okB, 'peer {present:true} on both sides')
            A.evaluate("TW.net.send({t:'ping', n:1, ts:Date.now()})")
            check(wait_for(A, "() => __ev.some(e => e.ev==='message' && e.d.t==='pong' && e.d.n===1)"), 'A → B ping/pong')
            B.evaluate("TW.net.send({t:'ping', n:2, ts:Date.now()})")
            check(wait_for(B, "() => __ev.some(e => e.ev==='message' && e.d.t==='pong' && e.d.n===2)"), 'B → A ping/pong')
            B.evaluate("window.__ev.length = 0")
            A.evaluate("for (let i = 1; i <= 10; i++) TW.net.send({t:'st', x:i})")
            B.wait_for_timeout(1500)
            sts = [m['d']['x'] for m in evs(B, 'message') if m['d'].get('t') == 'st']
            check(1 <= len(sts) <= 3 and sts[-1] == 10, f"'st' coalescing over Supabase → {sts}")
            j = C.evaluate(f"c => ({TRY})(TW.net.join(c))", code)
            check(j == {'ok': False, 'v': 'full'}, f'third page → {j}')
            B.evaluate("window.__ev.length = 0"); B.evaluate("TW.net._drop()")
            ok = wait_for(B, "() => __ev.some(e => e.ev==='status' && e.d.detail==='reconnected')", timeout=12000)
            check(ok, 'simulated channel loss → B resubscribes (status reconnected)')
            A.evaluate("TW.net.send({t:'ping', n:3, ts:Date.now()})")
            check(wait_for(A, "() => __ev.some(e => e.ev==='message' && e.d.t==='pong' && e.d.n===3)", timeout=10000), 'ping/pong after reconnect')
            check(A.evaluate("!!TW.net.peer()") and B.evaluate("!!TW.net.peer()"), 'both see the peer after reconnect')
            B.evaluate('TW.net.leave()')
            check(wait_for(A, "() => __ev.some(e => e.ev==='peer' && !e.d.present)", timeout=10000), 'B leave → A peer {present:false}')
            # two guests join at the same moment → exactly one gets the seat, the other 'full'
            A.wait_for_timeout(1500)
            for pg in (B, C):
                pg.evaluate(f"c => {{ window.__j = null; ({TRY})(TW.net.join(c)).then(r => window.__j = r); }}", code)
            okj = wait_for(B, "() => window.__j", timeout=20000) and wait_for(C, "() => window.__j", timeout=20000)
            res = sorted([B.evaluate('__j.v'), C.evaluate('__j.v')])
            note('race statuses B: %s | C: %s' % ([e['d'].get('detail') for e in evs(B, 'status')][-3:], [e['d'].get('detail') for e in evs(C, 'status')][-3:]))
            A.wait_for_timeout(3000)
            seated = [pg.evaluate('TW.net.connected') for pg in (B, C)]
            check(okj and res == sorted([code, 'full']) and seated.count(True) == 1,
                  f'simultaneous join race → {res}, connected {seated}, host peer {A.evaluate("TW.net.peer() && TW.net.peer().id") is not None}')
            A.evaluate('TW.net.leave()')
        else:
            st = [e['d'] for e in evs(A, 'status')]
            last = st[-1] if st else {}
            check(r['v'] == 'offline', f"real backend unreachable → create rejects Error('offline') ({r['v']})")
            check(last.get('state') == 'error' and last.get('detail') == 'offline', f'status error/offline emitted: {last}')
            check(dt <= 7.5, f'failure surfaced in {dt:.1f}s (≤ ~6 s after the script loaded)')
            note('websocket: ' + '; '.join(wsl[:6]))
            note('console: ' + ' | '.join(c for c in cons if 'ws' in c.lower() or 'socket' in c.lower() or 'error' in c.lower())[:600])
            t = time.time(); j = A.evaluate(f"({TRY})(TW.net.join('ABCD'))")
            check(j == {'ok': False, 'v': 'offline'} and time.time() - t <= 7.5, f'real join also → {j} in {time.time()-t:.1f}s')
        ctx.close()

        # ---------- 2. CDN script blocked ----------
        ctx = br.new_context()
        ctx.route('**/cdn.jsdelivr.net/**', lambda route: route.abort())
        P = page(ctx, 'P')
        r, dt = create(P)
        st = [e['d'] for e in evs(P, 'status')]
        check(r == {'ok': False, 'v': 'offline'} and dt <= 6.5, f'script blocked → {r} in {dt:.1f}s')
        check(st and st[-1]['state'] == 'error' and st[-1]['detail'] == 'offline', f'script blocked → status {st[-1] if st else None}')
        j = P.evaluate(f"({TRY})(TW.net.join('ABCD'))")
        check(j == {'ok': False, 'v': 'offline'}, f'script blocked join → {j}')
        ctx.close()

        # ---------- 3. WebSocket blocked (script OK) ----------
        # 3a: socket accepted but black-holed (route without connect_to_server: nothing ever answers)
        # 3b: socket refused (WebSocket that errors and closes at once, like a proxy/firewall refusal)
        refuse = """(() => { const R = window.WebSocket; window.WebSocket = class extends EventTarget {
            constructor(u){ super(); this.url = u; this.readyState = 0; this.bufferedAmount = 0;
              setTimeout(() => { this.readyState = 3; const e = new Event('error'); this.onerror && this.onerror(e);
                const c = new Event('close'); c.code = 1006; c.wasClean = false; this.onclose && this.onclose(c); }, 30); }
            send(){} close(){ this.readyState = 3; } };
          Object.assign(window.WebSocket, {CONNECTING:0, OPEN:1, CLOSING:2, CLOSED:3}); })();"""
        for label, setup in (('black-holed', lambda c: c.route_web_socket('**/realtime/**', lambda ws: None)),
                             ('refused', lambda c: c.add_init_script(refuse))):
            ctx = br.new_context()
            setup(ctx)
            W = page(ctx, 'W-' + label)
            r, dt = create(W)
            st = [e['d'] for e in evs(W, 'status')]
            check(W.evaluate('!!window.supabase'), f'socket {label}: CDN script loaded')
            check(r == {'ok': False, 'v': 'offline'} and dt <= 7.5, f'socket {label} → create {r} in {dt:.1f}s')
            check(st and st[-1]['state'] == 'error' and st[-1]['detail'] == 'offline', f'socket {label} → status {st[-1] if st else None}')
            t = time.time(); j = W.evaluate(f"({TRY})(TW.net.join('ABCD'))")
            check(j == {'ok': False, 'v': 'offline'} and time.time() - t <= 7.5, f'socket {label} → join {j} in {time.time()-t:.1f}s')
            W.wait_for_timeout(1500)
            check(W.evaluate("TW.net.state === 'error' && !TW.net.connected && __ev.filter(e => e.ev === 'status').length === 4"),
                  f'socket {label}: stays in error, no further status events')
            ctx.close()

        check(not errs, f'no page errors (nothing thrown) {errs}')
        br.close()
finally:
    wd.cancel()
    srv.terminate()
    try: srv.wait(5)
    except Exception: srv.kill()

print('\nNOTES:\n  ' + '\n  '.join(notes))
print('RESULT:', 'ALL PASS' if not fails else f'{len(fails)} FAIL: {fails}')
sys.exit(1 if fails else 0)
