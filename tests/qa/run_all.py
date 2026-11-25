#!/usr/bin/env python3
"""QA end-to-end suite for «Хоёр ертөнц» (QA Tester).

Run:   python3 tests/qa/run_all.py            (all six tests)
       python3 tests/qa/run_all.py --only 3,4 (a subset)
Starts its own `python3 -m http.server` on a free port (killed at the end) and drives headless Chrome
(/usr/bin/google-chrome) with Playwright, phone landscape 844x390 (touch, mobile, dpr 2) unless stated.
Screenshots -> tests/qa/shots/, machine-readable results -> tests/qa/results.json.

Tests
 1 Boot: no console/page errors, title buttons, portrait = rotate overlay only.
 2 Solo ch1 playthrough (ch1_test.py steps) -> chapterEnd; one world per screen; the real ⇅ button switches.
 3 Solo ch2 playthrough (docs/ch2-design.md) with REAL puzzle overlays (symbols incl. a deliberate fail,
   maze, split x2, drum), dark zone, ghost map, seenBy:'other' shadow wolf.
 4 Online, two tabs, real lobby UI + js/net.js (?net=local): create/join, roles, host starts ch2, one world
   per page, cross-world puzzle -> gate, split across pages, shadow wolf + dark/ghost map, pause sync,
   partner leave overlay.
 5 Puzzle module suites (tests/puzzles, tests/puzzles-b) - run from a temp symlink farm so their PNGs
   are not rewritten in other people's folders.
 6 Performance: ch2 solo, all enemies, 600 x (update + render) < 4 s.

Test shim (bug B1, see docs/qa-report.md): game.js openPuzzle() shadows the keyboard map `K` with the puzzle
module, so `for(const k in K)K[k]=false` wipes TW.puzzles[kind] the first time any overlay opens.
Test 3 first probes the UNMODIFIED engine (this check fails while B1 is open), then installs a read-only
Proxy over TW.puzzles[*] (writes ignored = what the fix does) so the rest of the flow can be verified.
Checks that only hold because of the shim are tagged [shim].
"""
import json, os, shutil, socket, subprocess, sys, tempfile, time, traceback
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SHOTS = os.path.join(HERE, 'shots')
CHROME = '/usr/bin/google-chrome'
MOBILE = dict(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True, device_scale_factor=2)
G = 190

# ---------------------------------------------------------------- helpers
class Test:
    def __init__(self, num, name):
        self.num, self.name, self.checks, self.notes, self.shots, self.error = num, name, [], [], [], None
    def ok(self, cond, msg, shim=False, info=None):
        cond = bool(cond)
        tag = ('[shim] ' if shim else '')
        line = ('  PASS ' if cond else '  FAIL ') + tag + msg + ('' if info is None else '  -> ' + short(info))
        print(line, flush=True)
        self.checks.append({'ok': cond, 'msg': msg, 'shim': shim, 'info': None if info is None else short(info, 400)})
        return cond
    def note(self, msg):
        print('  .... ' + msg, flush=True); self.notes.append(msg)
    @property
    def status(self):
        if self.error: return 'FAIL'
        if not all(c['ok'] for c in self.checks): return 'FAIL'
        if any(c['shim'] for c in self.checks): return 'PASS*'
        return 'PASS'

def short(v, n=220):
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, default=str)
    return s if len(s) <= n else s[:n] + '…'

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

def shot(t, pg, name):
    path = os.path.join(SHOTS, name + '.png')
    try:
        pg.evaluate('__game.render()')
    except Exception:
        pass
    pg.screenshot(path=path)
    t.shots.append(os.path.relpath(path, ROOT))
    return path

def watch(pg, tag, errs, warns):
    def on_console(m):
        url = (m.location or {}).get('url', '') if hasattr(m, 'location') else ''
        if m.type == 'error':
            if 'favicon.ico' in url: warns.append(f'{tag}: favicon.ico 404'); return
            errs.append(f'{tag} console.error: {m.text}')
        elif m.type == 'warning' and 'willReadFrequently' not in m.text:   # that one comes from our own pixel probes
            warns.append(f'{tag} console.warn: {m.text}')
    pg.on('console', on_console)
    pg.on('pageerror', lambda e: errs.append(f'{tag} pageerror: {e}'))

# ---------------------------------------------------------------- page-side JS
WALK = r"""
([ci,tx,jumps,maxSteps])=>{const g=window.__game,S=g.S(),c=S.chars[ci];let hold=0;
for(let i=0;i<(maxSteps||4000);i++){const dir=c.x<tx-2?1:(c.x>tx+2?-1:0);
 if(dir===0&&Math.abs(c.vx)<5&&c.onGround){g.T.left=g.T.right=g.T.jump=false;return{ok:true,i,x:+c.x.toFixed(1)};}
 g.T.right=dir>0;g.T.left=dir<0;
 if(c.onGround&&hold<=0){const re=c.x+c.w;for(const j of jumps)if(dir>0&&re>=j-14&&re<=j+1){g.latch.jump=true;hold=25;break;}}
 g.T.jump=hold>0;hold--;g.update(1);
 if(c.dying>0){g.T.left=g.T.right=g.T.jump=false;return{ok:false,died:true,x:c.x,i};}
 if(S.mode!=='play'){g.T.left=g.T.right=g.T.jump=false;return{ok:true,mode:S.mode,x:c.x};}}
g.T.left=g.T.right=g.T.jump=false;return{ok:false,x:c.x,y:c.y};}"""

WAIT = r"""
([cond,maxSteps])=>{const g=window.__game,S=g.S();const E=id=>S.enemies.find(e=>e.id===id);const cx=o=>o.x+o.w/2;
const f=new Function('S','E','cx','G','return ('+cond+');');
for(let i=0;i<maxSteps;i++){if(f(S,E,cx,TW.G))return{ok:true,i};g.update(1);}return{ok:false};}"""

ST = r"""(()=>{const S=__game.S(),E=id=>S.enemies.find(e=>e.id===id),f=e=>e?{x:Math.round(e.x+e.w/2),st:e.state,face:e.face}:null;
return{mode:S.mode,stage:S.stage,deaths:S.deaths,active:S.active,b:[Math.round(S.chars[0].x),Math.round(S.chars[0].y+S.chars[0].h),S.chars[0].hidden],
s:[Math.round(S.chars[1].x),Math.round(S.chars[1].y+S.chars[1].h)],S1:f(E('S1')),SW1:f(E('SW1')),S2:f(E('S2')),W2:f(E('W2'))}})()"""

HOOKS = r"""
(()=>{ if(window.__qaHooks) return; window.__qaHooks=true;
 window.__lbl=[]; const ft=CanvasRenderingContext2D.prototype.fillText;
 CanvasRenderingContext2D.prototype.fillText=function(t){ if(typeof t==='string'&&t.indexOf('ЕРТӨНЦ')>=0) __lbl.push(t); return ft.apply(this,arguments); };
 window.__art=[]; for(const k of Object.keys(TW.enemyArt)){ const f=TW.enemyArt[k]; TW.enemyArt[k]=function(ctx,e){ __art.push(e&&e.id?e.id:('ghost:'+(e&&e.type))); return f.apply(this,arguments); }; }
 window.__heard=[]; for(const k of Object.keys(TW.enemyTypes)){ const T=TW.enemyTypes[k]; const u=T.update; if(!u) continue;
   T.update=function(e,dt,api){ try{ if(api.noises.some(n=>n&&n.src==='fail'&&n.world===e.world)) __heard.push(e.id); }catch(_){} return u.apply(this,arguments); }; }
 window.__end=null; TW.on('chapterEnd',d=>{window.__end=d;});
 window.__deaths=[]; TW.on('death',d=>{__deaths.push(d);});
 const Q=window.__qa={};
 Q.map=w=>{const S=__game.S(),W=innerWidth,Hh=innerHeight,sc=Math.min(Hh/240,W/560),top=240-Hh/sc,cam=S.cams[w];return{sc,top,cam,vw:W/sc,toS:(x,y)=>[(x-cam)*sc,(y-top)*sc]};};
 Q.grab=()=>{const cv=document.getElementById('cv');Q.k=cv.width/innerWidth;Q.img=cv.getContext('2d').getImageData(0,0,cv.width,cv.height);};
 Q.px=(sx,sy)=>{const k=Q.k,img=Q.img,X=Math.round(sx*k),Y=Math.round(sy*k);if(X<0||Y<0||X>=img.width||Y>=img.height)return null;const i=(Y*img.width+X)*4,d=img.data;return[d[i],d[i+1],d[i+2]];};
 Q.render=()=>{__lbl=[];__art=[];__game.render();return{lbl:__lbl.slice(),art:__art.slice()};};
 const avg=a=>a.length?+(a.reduce((s,v)=>s+v,0)/a.length).toFixed(1):null;
 // dark zone check on the brother's screen (world 0 view must be active)
 Q.dark=(z0,z1)=>{const S=__game.S(),c=S.chars[0];S.ripples=[];const r=Q.render();Q.grab();const m=Q.map(0);
   const cx=c.x+c.w/2,cy=c.y+c.h*0.5,near=[],far=[],out=[];
   for(let a=0;a<24;a++){const an=a/24*Math.PI*2;for(const rr of [10,12,14]){const x=cx+Math.cos(an)*rr,y=cy+Math.sin(an)*rr;
     if(Math.abs(x-cx)<9&&y>c.y-6&&y<c.y+c.h+1)continue;const s=m.toS(x,y),p=Q.px(s[0],s[1]);if(p)near.push((p[0]+p[1]+p[2])/3);}}
   for(let x=z0+5;x<z1-5;x+=5){if(Math.abs(x-cx)<60)continue;for(let y=m.top+6;y<236;y+=5){const s=m.toS(x,y),p=Q.px(s[0],s[1]);if(p)far.push(Math.max(p[0],p[1],p[2]));}}
   for(let x=m.cam+8;x<z0-40;x+=5){for(let y=60;y<170;y+=5){const s=m.toS(x,y),p=Q.px(s[0],s[1]);if(p)out.push((p[0]+p[1]+p[2])/3);}}
   return{lbl:r.lbl,cx:Math.round(cx),near:avg(near),nearN:near.length,farMax:far.length?Math.max(...far):null,farAvg:avg(far),farN:far.length,outside:avg(out),outsideN:out.length};};
 // ghost-map blue pixels + partner light on the sister's screen (world 1 view)
 Q.ghost=(x0,x1)=>{const S=__game.S();S.ripples=[];const r=Q.render();Q.grab();const m=Q.map(1);let n=0,tot=0;
   const a=Math.max(x0,m.cam),b=Math.min(x1,m.cam+m.vw);
   for(let x=a+1;x<b-1;x+=1.5){for(let y=60;y<238;y+=1.5){const s=m.toS(x,y),p=Q.px(s[0],s[1]);if(!p)continue;tot++;if(p[2]>110&&p[2]-p[0]>70&&p[2]-p[1]>35)n++;}}
   const B=S.chars[0],bx=B.x+B.w/2,by=B.y+B.h*0.5;let light=0;
   for(let dx=-3;dx<=3;dx++)for(let dy=-3;dy<=3;dy++){const s=m.toS(bx+dx,by+dy),p=Q.px(s[0],s[1]);if(p)light=Math.max(light,Math.min(p[0],p[1],p[2]));}
   return{lbl:r.lbl,art:r.art,blue:n,tot,light,bx:Math.round(bx)};};
 // mean colour of the sky band (to tell the sepia living world from the cold dead world)
 Q.sky=()=>{Q.render();Q.grab();let R=0,Gg=0,B=0,n=0;for(let sx=40;sx<innerWidth-40;sx+=9)for(let sy=60;sy<150;sy+=9){const p=Q.px(sx,sy);if(p){R+=p[0];Gg+=p[1];B+=p[2];n++;}}
   return n?[Math.round(R/n),Math.round(Gg/n),Math.round(B/n)]:null;};
 Q.vis=sel=>{const e=document.querySelector(sel);return !!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';};
})()"""

SHIM = r"""(()=>{for(const k of Object.keys(TW.puzzles)){const m=TW.puzzles[k];if(m&&!m.__qaProxy)TW.puzzles[k]=new Proxy(m,{set(){return true;},get(t,p){return p==='__qaProxy'?true:t[p];}});}return Object.keys(TW.puzzles).length;})()"""

PZ = "(()=>{const z=__game.S().pz;return z?{id:z.p.id,mode:z.mode,who:z.who,kind:z.p.kind}:null})()"
TELE = r"""([ci,x])=>{const S=__game.S(),c=S.chars[ci];c.x=x;c.y=TW.G-c.h;c.vx=0;c.vy=0;c.onGround=true;c.snap=true;c.cp=x;c.stillT=0;__game.update(2);return{x:+c.x.toFixed(1),foot:+(c.y+c.h).toFixed(1),onGround:c.onGround};}"""


class Page:
    """Thin wrapper with game helpers for one Playwright page."""
    def __init__(self, pg):
        self.pg = pg
    def ev(self, js, arg=None):
        return self.pg.evaluate(js, arg) if arg is not None else self.pg.evaluate(js)
    def walk(self, ci, tx, jumps=(), m=4000):
        return self.ev(WALK, [ci, tx, list(jumps), m])
    def wait(self, cond, m=2000):
        return self.ev(WAIT, [cond, m])
    def step(self, n):
        self.ev(f'__game.update({int(n)})')
    def tap(self, k):
        self.ev(f"__game.latch['{k}']=true")
    def st(self):
        return self.ev(ST)
    def sw(self, to):
        if self.ev('__game.S().active') != to:
            self.tap('switch'); self.step(1)
    def action(self):
        self.ev('__game.latch.action=true;__game.update(1)')
    def pz(self):
        return self.ev(PZ)
    def overlay_open(self):
        return self.ev("document.getElementById('twpz').classList.contains('open')")
    def obj(self, *ids):
        return self.ev("ids=>{const S=__game.S();const o={};for(const i of ids)o[i]=!!(S.obj[i]&&S.obj[i].on);return o;}", list(ids))
    def tele(self, ci, x):
        return self.ev(TELE, [ci, x])
    def data(self, pid):
        return self.ev("id=>__game.S().pzData[id]", pid)
    def answer(self, kind, pid):
        return self.ev("([k,id])=>{const K=TW.puzzles[k];return K&&typeof K.answerText==='function'?K.answerText(__game.S().pzData[id]):null;}", [kind, pid])
    def close_overlay(self):
        self.pg.tap('#twpz .x')
    def tiles(self):
        return self.ev("[...document.querySelectorAll('#twpz .twpzb-tile')].map(e=>[+e.dataset.p,+e.dataset.s])")


def new_page(ctx, url, tag, errs, warns):
    pg = ctx.new_page()
    watch(pg, tag, errs, warns)
    pg.goto(url)
    pg.wait_for_function('window.__game && window.TW && TW.ui && document.querySelector(".twui-title")')
    pg.evaluate(HOOKS)
    return pg

# ================================================================ TEST 1: boot
def test_boot(t, br, base):
    errs, warns = [], []
    ctx = br.new_context(**MOBILE)
    pg = ctx.new_page(); watch(pg, 'boot', errs, warns)
    pg.goto(base + '/index.html'); pg.wait_for_timeout(1500)
    P = Page(pg); pg.evaluate(HOOKS)
    t.ok(pg.evaluate("!!(window.TW&&TW.game&&TW.ui&&window.__game)"), 'engine + UI booted (TW.game, TW.ui, __game)')
    labels = pg.evaluate("[...document.querySelectorAll('.twui-title .twui-trow button')].filter(b=>__qa.vis('.twui-title')&&b.getClientRects().length).map(b=>b.textContent.trim())")
    t.ok(labels == ['Ганцаараа тоглох', 'Онлайн тоглох', 'Бүлгүүд'], 'title shows Ганцаараа тоглох / Онлайн тоглох / Бүлгүүд', info=labels)
    t.ok(not pg.evaluate("__qa.vis('.twui-rotate')"), 'landscape: rotate overlay hidden')
    shot(t, pg, '01_title_landscape')
    pg.wait_for_timeout(500)
    t.ok(not errs, 'zero console errors / page errors on load (favicon 404 excluded, see minor bug)', info=errs or None)
    if any('favicon' in w for w in warns):
        t.note('favicon.ico 404 on every load (console "Failed to load resource") - minor')
    ctx.close()
    # portrait
    errs2, warns2 = [], []
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    pg = ctx.new_page(); watch(pg, 'portrait', errs2, warns2)
    pg.goto(base + '/index.html'); pg.wait_for_timeout(1200); pg.evaluate(HOOKS)
    r = pg.evaluate("""(()=>{const e=document.querySelector('.twui-rotate');if(!e)return null;const b=e.getBoundingClientRect();
      const pts=[[5,5],[innerWidth-5,5],[innerWidth/2,innerHeight/2],[5,innerHeight-5],[innerWidth-5,innerHeight-5],[innerWidth/2,innerHeight*0.2]];
      const hit=pts.map(p=>{const el=document.elementFromPoint(p[0],p[1]);return !!(el&&el.closest('.twui-rotate'));});
      return{vis:__qa.vis('.twui-rotate'),rect:[b.left,b.top,b.width,b.height],hit,text:e.textContent.trim().slice(0,60)};})()""")
    t.ok(r and r['vis'], 'portrait 390x844: rotate overlay visible', info=r)
    t.ok(r and all(r['hit']) and r['rect'][2] >= 389 and r['rect'][3] >= 843, 'portrait: rotate overlay covers the whole screen (only it is hit-testable)', info=r and r['hit'])
    t.ok(r and 'Утсаа хэвтээ эргүүлнэ үү' in r['text'], 'portrait: text «Утсаа хэвтээ эргүүлнэ үү»')
    shot(t, pg, '01_portrait_rotate')
    # start in landscape, rotate to portrait mid-game -> paused; back -> resumed
    pg.set_viewport_size({'width': 844, 'height': 390}); pg.wait_for_timeout(300)
    t.ok(not pg.evaluate("__qa.vis('.twui-rotate')"), 'back to landscape: rotate overlay hidden')
    pg.tap('.twui-title [data-act=solo]'); pg.wait_for_timeout(300)
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(300)
    a = pg.evaluate("({vis:__qa.vis('.twui-rotate'),paused:TW.game.isPaused(),mode:__game.S().mode})")
    t.ok(a['vis'] and a['paused'] and a['mode'] == 'play', 'rotating to portrait mid-game shows the overlay and pauses', info=a)
    pg.set_viewport_size({'width': 844, 'height': 390}); pg.wait_for_timeout(300)
    b = pg.evaluate("({vis:__qa.vis('.twui-rotate'),paused:TW.game.isPaused()})")
    t.ok(not b['vis'] and not b['paused'], 'rotating back to landscape hides it and resumes', info=b)
    t.ok(not errs2, 'portrait run: no console/page errors', info=errs2 or None)
    ctx.close()

# ================================================================ TEST 2: solo ch1
def test_ch1(t, br, base):
    errs, warns = [], []
    ctx = br.new_context(**MOBILE)
    pg = new_page(ctx, base + '/index.html', 'ch1', errs, warns); P = Page(pg)
    pg.evaluate('__game.pause(true)')
    pg.tap('.twui-title [data-act=solo]')        # real UI: continue target = ch1 on a fresh profile
    s = pg.evaluate("({id:__game.CH().id,mode:__game.S().mode,active:__game.S().active,net:__game.S().netMode})")
    t.ok(s == {'id': 'ch1', 'mode': 'play', 'active': 0, 'net': 'solo'}, 'Ганцаараа тоглох starts ch1 in solo mode', info=s)
    P.step(3)
    r0 = P.ev('__qa.render()'); sky0 = P.ev('__qa.sky()')
    t.ok(r0['lbl'] == ['АХ · АМЬД ЕРТӨНЦ'], 'solo: one panel per frame, the active (brother) world only', info=r0['lbl'])
    shot(t, pg, '02_ch1_brother_view')
    t.ok(pg.evaluate("__qa.vis('#bSwitch')"), 'solo: ⇅ button visible on touch')
    pg.tap('#bSwitch'); P.step(1)
    a1 = pg.evaluate('__game.S().active'); r1 = P.ev('__qa.render()'); sky1 = P.ev('__qa.sky()')
    t.ok(a1 == 1 and r1['lbl'] == ['ДҮҮ · ҮХЭГСДИЙН ЕРТӨНЦ'], 'tapping ⇅ switches the whole view to the sister world', info={'active': a1, 'lbl': r1['lbl']})
    t.ok(sky0[0] - sky0[2] > 8 and sky1[2] >= sky1[0], 'sky colour: sepia living world vs cold dead world', info={'w0': sky0, 'w1': sky1})
    shot(t, pg, '02_ch1_sister_view')
    pg.tap('#bSwitch'); P.step(1)
    t.ok(pg.evaluate('__game.S().active') == 0 and P.ev('__qa.render()')['lbl'] == ['АХ · АМЬД ЕРТӨНЦ'], '⇅ again switches back to the brother')
    # --- ch1_test.py steps (lead) ---
    W = P.walk; st = lambda: P.ev("(()=>{const S=__game.S();return{mode:S.mode,stage:S.stage,deaths:S.deaths,B1:S.obj.B1.on,G1:S.obj.G1.on,R1:S.obj.R1.on,crate:Math.round(S.obj.C1.x),b:Math.round(S.chars[0].x),s:Math.round(S.chars[1].x)}})()")
    r = {}
    r['river'] = W(0, 780, [380, 560]); r['drown'] = W(0, 900, []); P.step(80); r['after'] = st(); W(0, 780, [])
    P.tap('switch'); P.step(1); r['sL1'] = W(1, 1066, [380, 560]); P.tap('action'); P.step(100); r['L1'] = st()
    P.tap('switch'); P.step(1); W(0, 1270, []); W(0, 1486, [], 1500); r['crate'] = st()['crate']; r['bover'] = W(0, 1785, [1500])
    P.tap('switch'); P.step(1); W(1, 1515, [1300, 1500]); r['ledge'] = W(1, 1734, [1560]); P.tap('action'); P.step(100); r['L2'] = st()
    W(1, 2120, []); P.tap('switch'); P.step(1); W(0, 2048, []); P.step(30); P.tap('switch'); P.step(1); r['cross'] = W(1, 2414, []); P.tap('action'); P.step(100); r['L3'] = st()
    P.tap('switch'); P.step(1); W(0, 2893, []); P.tap('switch'); P.step(1); r['meet'] = W(1, 2894, []); P.step(400)
    r['final'] = st()
    t.ok(r['drown'].get('died') and r['after']['deaths'] == 1 and r['after']['b'] < 800, 'river: walking into deep water kills, respawn at checkpoint', info=r['after'])
    t.ok(r['L1']['B1'] and r['L2']['G1'] and r['L3']['R1'], 'levers B1 / G1 / R1 operated by the sister', info={k: r[k] for k in ('L1', 'L2', 'L3')})
    t.ok(r['crate'] >= 1490, 'crate pushed onto the plate', info=r['crate'])
    end = pg.evaluate('window.__end')
    t.ok(r['final']['mode'] == 'done' and end and end.get('id') == 'ch1', 'ch1 ends: mode done + chapterEnd event', info={'final': r['final'], 'end': end and {k: end[k] for k in ('id', 'next', 'deaths')}})
    pg.wait_for_timeout(300)
    t.ok(pg.evaluate("__qa.vis('.twui-end')"), 'UI shows the chapter-end paper')
    shot(t, pg, '02_ch1_end')
    t.ok(not errs, 'no console/page errors', info=errs or None)
    ctx.close()

# ================================================================ TEST 3: solo ch2 with real overlays
def test_ch2(t, br, base):
    errs, warns = [], []
    ctx = br.new_context(**MOBILE)
    # ---------- 3.0 strict probe on the unmodified engine
    pg = new_page(ctx, base + '/index.html', 'ch2-strict', errs, warns); P = Page(pg)
    pg.evaluate('__game.pause(true)')
    pg.tap('.twui-title [data-act=chapters]'); pg.tap('.twui-chapters [data-act=play][data-id=ch2]')
    t.ok(pg.evaluate("__game.CH().id") == 'ch2', 'Бүлгүүд -> ch2 card starts chapter 2')
    P.ev("__game.S().active=1"); P.tele(1, 1494)
    P.action()
    probe = P.ev("""(()=>{const b=document.querySelector('#twpz .b');return{open:document.getElementById('twpz').classList.contains('open'),
       keys:b.querySelectorAll('.twpz-key').length,text:b.innerText.trim().slice(0,80),fallback:!!b.querySelector('.twpz-fallback'),
       solveFn:typeof TW.puzzles.symbols.solve,genFn:typeof TW.puzzles.symbols.gen,drawFn:typeof TW.puzzles.symbols.drawDevice};})()""")
    shot(t, pg, '03_strict_symbols_overlay')
    t.ok(probe['open'] and probe['keys'] == 9 and not probe['fallback'], 'STRICT engine: PZ1 overlay shows the real symbols solver (9 keys)', info=probe)
    t.ok(probe['solveFn'] == 'function' and probe['genFn'] == 'function' and probe['drawFn'] == 'function',
         'STRICT engine: TW.puzzles.symbols intact after opening an overlay', info={k: probe[k] for k in ('solveFn', 'genFn', 'drawFn')})
    if probe['fallback']:
        pg.tap('#twpz .twpz-fallback'); pg.wait_for_timeout(900)
        t.note('fallback button «Шийдсэн гэж үзэх» solves the puzzle with no clue: PZ1/G1 = ' + json.dumps(P.obj('PZ1', 'G1')))
    pg.close()

    # ---------- 3.1 full playthrough with the shim
    pg = new_page(ctx, base + '/index.html', 'ch2', errs, warns); P = Page(pg)
    pg.evaluate('__game.pause(true)'); n = pg.evaluate(SHIM)
    t.note(f'shim installed over {n} puzzle modules (writes ignored)')
    pg.tap('.twui-title [data-act=chapters]'); pg.tap('.twui-chapters [data-act=play][data-id=ch2]')
    W, wait, st = P.walk, P.wait, P.st
    log = {}
    def L(k, v):
        log[k] = v
        if isinstance(v, dict) and v.get('ok') is False:
            t.ok(False, f'walk/wait step {k}', info=v)
        return v
    P.step(5)
    # A
    L('A_spot', W(0, 180)); L('A_wolf_right', wait("E('W1').state==='patrol'&&E('W1').face===1&&cx(E('W1'))>=470", 1500))
    L('A_grass', W(0, 473)); L('A_hidden', wait('S.chars[0].hidden', 60))
    L('A_passed', wait("E('W1').face===-1&&cx(E('W1'))<425", 1500)); L('A_gap', W(0, 720, [640]))
    # B
    L('B_call', W(0, 1353)); P.tap('action'); P.step(1)
    L('B_trapped', wait("(()=>{const e=E('S1');return e.x>=1296&&e.x+e.w<=1352&&e.y+e.h>G-2&&(e.state==='idle'||e.state==='return')})()", 900))
    P.sw(1); L('B_shelf', W(1, 1494, [1040, 1300]))
    t.ok(log['B_trapped'].get('ok') and log['B_shelf'].get('ok'), 'A+B: brother hides from W1, calls; S1 trapped; sister crosses to PZ1')
    # C: symbols - brother reads CL1, sister solves PZ1 (one deliberate fail first)
    P.sw(0); L('C_clue', W(0, 1463)); P.action()
    z = P.pz(); t.ok(z == {'id': 'PZ1', 'mode': 'clue', 'who': 0, 'kind': 'symbols'}, 'C: ◎ at CL1 opens the symbols clue overlay', True, z)
    seq = P.ev("[...document.querySelectorAll('#twpz .twpz-carve')].map(e=>e.getAttribute('data-sym'))")
    d1 = P.data('PZ1')
    t.ok(d1 and seq == d1['seq'] and len(seq) == 4, 'C: clue stone shows the 4 generated symbols in order', True, {'dom': seq, 'answer': P.answer('symbols', 'PZ1')})
    shot(t, pg, '03_c_symbols_clue')
    P.close_overlay(); t.ok(P.pz() is None and not P.overlay_open(), 'C: ✕ closes the clue overlay', True)
    P.sw(1); P.action()
    z = P.pz(); nk = P.ev("document.querySelectorAll('#twpz .twpz-key').length")
    t.ok(z and z['id'] == 'PZ1' and z['mode'] == 'solve' and nk == 9, 'C: ◎ at PZ1 opens the solver (9 symbols)', True, {'pz': z, 'keys': nk})
    for s in reversed(seq):
        pg.tap(f'#twpz .twpz-key[data-sym="{s}"]')
    P.ev("window.__heard=[]")
    s1_before = P.ev("__game.S().enemies.find(e=>e.id==='S1').state")
    pg.tap('#twpz .twpz-btn--go')
    noise = P.ev("__game.S().noises.filter(n=>n.src==='fail').map(n=>({w:n.world,x:n.x,r:n.r}))")
    t_fail = P.ev('__game.S().time')
    t.ok(noise == [{'w': 1, 'x': 1500, 'r': 320}], "C fail: wrong order -> 'fail' noise r320 in the solver's world", True, noise)
    shot(t, pg, '03_c_symbols_fail')
    pg.evaluate('__game.pause(false)'); pg.wait_for_timeout(1300); pg.evaluate('__game.pause(true)')   # real-time loop
    heard = P.ev('[...new Set(__heard)]'); s1_after = P.ev("__game.S().enemies.find(e=>e.id==='S1').state")
    t.ok(P.pz() is None and not P.overlay_open(), 'C fail: overlay closes by itself', True)
    t.ok('S1' in heard, "C fail (solo, real-time loop): the 'fail' noise reaches nearby S1 (185 away) and wakes it", True,
         {'heard': heard, 'S1': [s1_before, s1_after]})
    rr = P.ev("""(t0)=>{const g=__game,S=g.S();let tried=0;for(let i=0;i<420;i++){g.latch.action=true;g.update(1);tried++;if(S.pz)return{opened:true,dt:+(S.time-t0).toFixed(2)};}return{opened:false,dt:+(S.time-t0).toFixed(2)};}""", t_fail)
    t.ok(rr['opened'] and 2.85 <= rr['dt'] <= 3.3, 'C fail: ◎ is ignored until 3 s after the fail, then the solver reopens', True, rr)
    for s in seq:
        pg.tap(f'#twpz .twpz-key[data-sym="{s}"]')
    shot(t, pg, '03_c_symbols_solve')
    pg.tap('#twpz .twpz-btn--go'); pg.wait_for_timeout(1000)
    o = P.obj('PZ1', 'G1'); P.step(100)
    t.ok(o == {'PZ1': True, 'G1': True} and P.pz() is None, 'C: correct order solves PZ1 -> brother gate G1 opens, overlay auto-closes', True, o)
    # D: shadow wolf, only the sister sees it
    P.sw(1); L('D_sister', W(1, 1950))
    P.sw(0); L('D_rock', W(0, 1675, [1650]))
    L('D_wolf_right', wait("E('SW1').state==='patrol'&&E('SW1').face===1&&cx(E('SW1'))>=1930", 1500))
    rb = P.ev('__qa.render()'); shot(t, pg, '03_d_brother_view_no_wolf')
    P.sw(1); rs = P.ev('__qa.render()'); shot(t, pg, '03_d_sister_view_shadow_wolf')
    base_blue = P.ev('(()=>{const m=__qa.map(1);return __qa.ghost(m.cam,m.cam+m.vw).blue;})()')
    P.sw(0)
    t.ok(rb['lbl'] == ['АХ · АМЬД ЕРТӨНЦ'] and 'SW1' not in rb['art'], "D: seenBy:'other' SW1 is NOT drawn in the brother's view", info=rb)
    t.ok(rs['lbl'] == ['ДҮҮ · ҮХЭГСДИЙН ЕРТӨНЦ'] and 'SW1' in rs['art'], "D: SW1 is drawn (as a shadow) in the sister's view", info=rs)
    L('D_grass', W(0, 1950)); L('D_hidden', wait('S.chars[0].hidden', 60))
    L('D_passed', wait("E('SW1').face===-1&&cx(E('SW1'))<1905", 1500)); L('D_gap', W(0, 2293, [2210]))
    # E: maze - sister reads CL2, brother picks doors
    P.sw(1); L('E_sclue', W(1, 2294)); P.action()
    z = P.pz(); t.ok(z == {'id': 'PZ2', 'mode': 'clue', 'who': 1, 'kind': 'maze'}, 'E: ◎ at CL2 opens the cave-map clue', True, z)
    shot(t, pg, '03_e_maze_clue'); P.close_overlay()
    P.sw(0); P.action()
    z = P.pz(); t.ok(z == {'id': 'PZ2', 'mode': 'solve', 'who': 0, 'kind': 'maze'}, 'E: ◎ at PZ2 opens the door solver', True, z)
    d2 = P.data('PZ2'); ok_doors = True
    for k, f in enumerate(d2['forks']):
        lm = f['map'][f['ok']]; j = f['doors'].index(lm)
        dom = P.ev(f"document.querySelectorAll('#twpz .twpz-door')[{j}].getAttribute('data-lm')")
        ok_doors &= dom == lm
        pg.locator('#twpz .twpz-door').nth(j).tap(); pg.wait_for_timeout(340)
    t.ok(ok_doors, 'E: each step shows the landmark from the map on a door (positions differ from the map)', True, P.answer('maze', 'PZ2'))
    shot(t, pg, '03_e_maze_solve')
    pg.tap('#twpz .twpz-btn--go'); pg.wait_for_timeout(1000)
    o = P.obj('PZ2', 'G2'); P.step(100)
    t.ok(o == {'PZ2': True, 'G2': True}, 'E: right doors -> G2 opens', True, o)
    # E: dark cave + ghost map
    P.sw(1); L('E_guide', W(1, 2544))
    P.sw(0); L('E_in', W(0, 2455, [2410]))
    dk = P.ev('__qa.dark(2360,2740)'); shot(t, pg, '03_e_dark_brother')
    t.ok(dk['lbl'] == ['АХ · АМЬД ЕРТӨНЦ'] and dk['farMax'] is not None and dk['farMax'] <= 8 and dk['near'] > 18 and dk['outside'] > 18,
         'E: living world is black inside the cave except a circle around the brother', info=dk)
    P.sw(1); gh = P.ev('__qa.ghost(2360,2740)'); shot(t, pg, '03_e_ghost_map_sister')
    t.ok(gh['lbl'] == ['ДҮҮ · ҮХЭГСДИЙН ЕРТӨНЦ'] and gh['blue'] > 150 and gh['blue'] > 20 * (base_blue + 1),
         "E: sister's view draws the blue ghost map of the cave", info={'cave': gh['blue'], 'elsewhere': base_blue})
    t.ok(gh['light'] >= 200, "E: ghost map shows the brother as a small light", info=gh['light'])
    P.sw(0); L('E_dark', W(0, 2735, [2488, 2580, 2680]))
    t.ok(log['E_dark'].get('ok'), 'E: brother crosses the dark cave (3 gaps + rock) without dying', info=log['E_dark'])
    # F: split - both locks via overlays
    L('F_b', W(0, 2873)); P.sw(1); L('F_s', W(1, 2874))
    P.action(); z = P.pz(); tB = P.tiles(); P.close_overlay()
    t.ok(z and z['id'] == 'PZ3B' and z['mode'] == 'solve' and [p for p, _ in tB] == [0, 1], 'F: sister stele shows code positions 1-2', True, {'pz': z, 'tiles': tB})
    P.sw(0); P.action(); z = P.pz(); tA = P.tiles()
    t.ok(z and z['id'] == 'PZ3A' and [p for p, _ in tA] == [2, 3], 'F: brother stele shows positions 3-4', True, {'pz': z, 'tiles': tA})
    mB, mA = dict(tB), dict(tA)
    for p in P.data('PZ3A')['need']:
        pg.tap(f'#twpz .twpzb-key[data-s="{mB[p]}"]')
    shot(t, pg, '03_f_split_brother')
    pg.tap('#twpz .twpzb-go'); pg.wait_for_timeout(1000)
    o = P.obj('PZ3A', 'G3B'); t.ok(o == {'PZ3A': True, 'G3B': True}, "F: brother enters the sister's symbols -> sister gate G3B opens", True, o)
    P.sw(1); P.action()
    for p in P.data('PZ3B')['need']:
        pg.tap(f'#twpz .twpzb-key[data-s="{mA[p]}"]')
    pg.tap('#twpz .twpzb-go'); pg.wait_for_timeout(1000)
    o = P.obj('PZ3B', 'G3A'); P.step(100)
    t.ok(o == {'PZ3B': True, 'G3A': True}, "F: sister enters the brother's symbols -> brother gate G3A opens", True, o)
    # G
    L('G_trunk', W(1, 3355, [3150, 3180]))
    P.sw(0); L('G_call', W(0, 3193)); P.tap('action'); P.step(1); P.sw(1)
    L('G_lured', wait("cx(E('S2'))<3240&&['hunt','search','return'].includes(E('S2').state)", 600)); L('G_drop', W(1, 3520))
    t.ok(log['G_drop'].get('ok'), 'G: call lures S2 under the trunk, sister drops and runs past', info=st())
    # H
    P.sw(0)
    L('H_wolf_right', wait("E('W2').state==='patrol'&&E('W2').face===1&&cx(E('W2'))>=3430", 1500))
    L('H_grass', W(0, 3468)); L('H_hidden', wait('S.chars[0].hidden', 60))
    L('H_passed', wait("E('W2').face===-1&&cx(E('W2'))<3422", 1500)); L('H_rock', W(0, 3783, [3690])); P.step(120)
    t.ok(log['H_rock'].get('ok') and st()['deaths'] == 0, 'H: brother escapes W2 to the pocket behind the raven rock', info=st())
    P.action(); z = P.pz()
    t.ok(z == {'id': 'PZ4', 'mode': 'clue', 'who': 0, 'kind': 'drum'}, 'H: ◎ at CL4 opens the drum clue', True, z)
    shot(t, pg, '03_h_drum_clue'); P.close_overlay()
    P.sw(1); L('H_pit', W(1, 3783, [3610, 3670])); P.action(); z = P.pz()
    t.ok(z == {'id': 'PZ4', 'mode': 'solve', 'who': 1, 'kind': 'drum'}, 'H: ◎ at PZ4 opens the drum solver', True, z)
    beats = P.data('PZ4')['beats']
    for b in beats:
        pg.keyboard.down('Space'); pg.wait_for_timeout(520 if b else 70); pg.keyboard.up('Space'); pg.wait_for_timeout(170)
    dom = P.ev("[...document.querySelectorAll('#twpz .twpz-beats .twpz-beat')].map(e=>e.classList.contains('twpz-beat--long')?1:0)")
    t.ok(dom == beats, 'H: tapped rhythm (Space short/hold) matches the clue', True, {'beats': beats, 'dom': dom, 'answer': P.answer('drum', 'PZ4')})
    shot(t, pg, '03_h_drum_solve')
    pg.tap('#twpz .twpz-btn--go'); pg.wait_for_timeout(1000)
    o = P.obj('PZ4', 'G4'); P.step(100)
    t.ok(o == {'PZ4': True, 'G4': True}, 'H: drum solved -> G4 opens', True, o)
    # exit
    P.sw(0); L('X_b', W(0, 3943)); P.sw(1); L('X_s', W(1, 3944)); P.step(300)
    end = pg.evaluate('window.__end'); fin = st()
    t.ok(fin['mode'] == 'done' and end and end.get('id') == 'ch2' and fin['deaths'] == 0, 'ch2 ends (mode done, chapterEnd, 0 deaths)', info={'final': fin, 'time': end and round(end['time'], 1)})
    pg.wait_for_timeout(300); shot(t, pg, '03_ch2_end')
    t.ok(not errs, 'no console/page errors', info=errs or None)
    if warns: t.note('console warnings: ' + short(sorted(set(warns))))
    ctx.close()

# ================================================================ TEST 4: online
def test_online(t, br, base):
    errs, warns = [], []
    ctx = br.new_context(**MOBILE)
    url = base + '/index.html?net=local'
    pa = new_page(ctx, url, 'A', errs, warns); pb = new_page(ctx, url, 'B', errs, warns)
    A, B = Page(pa), Page(pb)
    for p in (pa, pb):
        p.evaluate('__game.pause(true)'); p.evaluate(SHIM)
    t.note('shim installed on both pages (needed because of B1)')
    # lobby
    pa.tap('.twui-title [data-act=online]'); pa.tap('.twui-lobby [data-act=create]')
    pa.wait_for_function("(document.querySelector('.twui-bigcode')||{}).textContent && document.querySelector('.twui-bigcode').textContent.trim().length===4 && /^[A-Z]{4}$/.test(document.querySelector('.twui-bigcode').textContent.trim())", timeout=8000)
    code = pa.evaluate("document.querySelector('.twui-bigcode').textContent.trim()")
    t.ok(len(code) == 4 and pa.evaluate("TW.net.transport==='local'&&TW.net.isHost"), 'A: Өрөө үүсгэх -> 4-letter code (local transport, host)', info=code)
    shot(t, pa, '04_lobby_host_waiting')
    pb.tap('.twui-title [data-act=online]'); pb.tap('.twui-lobby [data-act=joinView]')
    pb.fill('#twui-code', code.lower()); pb.tap('.twui-lobby [data-act=join]')
    pb.wait_for_function("document.querySelector('.twui-lobby').getAttribute('data-view')==='room' && TW.net.connected", timeout=8000)
    pa.wait_for_function("TW.net.peer()!=null", timeout=6000)
    pa.tap('.twui-role--0'); pb.tap('.twui-role--1')
    pa.tap('.twui-lobby [data-act=pickCh][data-id=ch2]')
    ok_start = True
    try:
        pa.wait_for_function("!document.querySelector('.twui-lobby [data-act=ostart]').disabled", timeout=6000)
    except Exception:
        ok_start = False
    rs = {'A': pa.evaluate("[...document.querySelectorAll('.twui-badge')].map(e=>e.textContent)"), 'B': pb.evaluate("[...document.querySelectorAll('.twui-badge')].map(e=>e.textContent)")}
    t.ok(ok_start and rs['A'] == ['Чи', 'Найз'] and rs['B'] == ['Найз', 'Чи'], 'roles Ах (A) / Дүү (B); host Эхлэх enabled', info=rs)
    gw = pb.evaluate("__qa.vis('.twui-guestblock') && document.querySelector('.twui-guestblock').innerText")
    t.ok(gw and 'Найз чинь бүлгээ сонгож байна' in gw, 'B (guest) sees «Найз чинь бүлгээ сонгож байна…»', info=gw)
    shot(t, pa, '04_lobby_host_ready'); shot(t, pb, '04_lobby_guest')
    pa.tap('.twui-lobby [data-act=ostart]')
    pb.wait_for_function("__game.S().netMode==='online' && __game.CH().id==='ch2'", timeout=5000)
    sa = A.ev("({role:__game.S().role,ch:__game.CH().id,seed:__game.S().seed,ew:[...new Set(__game.S().enemies.map(e=>e.world))],sw:getComputedStyle(document.getElementById('bSwitch')).display})")
    sb = B.ev("({role:__game.S().role,ch:__game.CH().id,seed:__game.S().seed,ew:[...new Set(__game.S().enemies.map(e=>e.world))],sw:getComputedStyle(document.getElementById('bSwitch')).display})")
    t.ok(sa['role'] == 0 and sb['role'] == 1 and sa['ch'] == sb['ch'] == 'ch2' and sa['seed'] == sb['seed'], 'host Эхлэх: both start ch2 online, roles 0/1, same seed', info={'A': sa, 'B': sb})
    t.ok(sa['ew'] == [0] and sb['ew'] == [1] and sa['sw'] == 'none' and sb['sw'] == 'none', 'each page simulates only its world\'s enemies; ⇅ hidden online', info={'A': sa, 'B': sb})
    card = pb.evaluate("(document.querySelector('.twui-card-role')||{}).textContent||''")
    t.ok('Дүү' in card, 'B title card: «Чи — Дүү · үхэгсдийн ертөнц»', info=card)
    la, lb = A.ev('__qa.render()')['lbl'], B.ev('__qa.render()')['lbl']
    t.ok(la == ['АХ · АМЬД ЕРТӨНЦ'] and lb == ['ДҮҮ · ҮХЭГСДИЙН ЕРТӨНЦ'], 'both pages show only their own world', info={'A': la, 'B': lb})
    shot(t, pa, '04_A_start'); shot(t, pb, '04_B_start')
    def sync(n=6):
        A.step(n); B.step(n); pa.wait_for_timeout(250); A.step(1); B.step(1)
    # cross-world puzzle: A reads CL1, B solves PZ1 (with one fail) -> A's gate G1
    A.tele(0, 1463); B.tele(1, 1494); sync()
    A.action(); za = A.pz()
    seq = A.ev("[...document.querySelectorAll('#twpz .twpz-carve')].map(e=>e.getAttribute('data-sym'))")
    t.ok(za and za['mode'] == 'clue' and len(seq) == 4, 'A: ◎ at CL1 shows the clue (brother screen)', True, {'pz': za, 'seq': seq})
    shot(t, pa, '04_A_symbols_clue')
    B.action(); zb = B.pz()
    t.ok(zb and zb['mode'] == 'solve' and seq == B.data('PZ1')['seq'], "B: ◎ at PZ1 opens the solver; A's clue matches B's answer (same seed)", True, zb)
    for s in reversed(seq):
        pb.tap(f'#twpz .twpz-key[data-sym="{s}"]')
    B.ev('window.__heard=[]'); pb.tap('#twpz .twpz-btn--go'); tf = B.ev('__game.S().time')
    B.step(5); heard = B.ev('[...new Set(__heard)]'); pb.wait_for_timeout(600)
    t.ok('S1' in heard and B.pz() is None, "B fail (online): 'fail' noise reaches S1, overlay closes", True, heard)
    rr = B.ev("""(t0)=>{const g=__game,S=g.S();for(let i=0;i<420;i++){g.latch.action=true;g.update(1);if(S.pz)return{opened:true,dt:+(S.time-t0).toFixed(2)};}return{opened:false};}""", tf)
    t.ok(rr['opened'] and 2.9 <= rr['dt'] <= 3.3, 'B: retry possible after 3 s', True, rr)
    for s in seq:
        pb.tap(f'#twpz .twpz-key[data-sym="{s}"]')
    shot(t, pb, '04_B_symbols_solve')
    pb.tap('#twpz .twpz-btn--go'); pb.wait_for_timeout(900)
    try:
        pa.wait_for_function("__game.S().obj.G1.on", timeout=3000); g1 = True
    except Exception:
        g1 = False
    t.ok(B.obj('PZ1')['PZ1'] and g1, "B solves PZ1 -> trig -> gate G1 opens on A's screen", True, {'B': B.obj('PZ1', 'G1'), 'A': A.obj('PZ1', 'G1')})
    A.close_overlay(); A.step(100)
    t.ok(A.ev('__game.S().obj.G1.p') >= 1, 'A: G1 rises fully', True)
    # shadow wolf streamed to the sister
    B.tele(1, 1950); A.step(15); pa.wait_for_timeout(300); B.step(2); A.step(1)
    ra, rb_ = A.ev('__qa.render()'), B.ev('__qa.render()')
    ghosts = B.ev('(__game.S().ghosts||[]).map(g=>g.type+"@"+Math.round(g.x))')
    t.ok('SW1' not in ra['art'] and 'ghost:wolf' in rb_['art'], "SW1 streamed: drawn on B (sister) only, not on A", info={'A': ra['art'], 'B': rb_['art'], 'ghosts': ghosts})
    shot(t, pb, '04_B_shadow_wolf')
    # dark zone + ghost map across pages
    A.tele(0, 2455); B.tele(1, 2544); sync(15)
    dk = A.ev('__qa.dark(2360,2740)'); gh = B.ev('__qa.ghost(2360,2740)')
    t.ok(dk['farMax'] is not None and dk['farMax'] <= 8 and dk['near'] > 18, 'A: cave is black except a circle around the brother', info=dk)
    t.ok(gh['blue'] > 150 and gh['light'] >= 200, "B: ghost map of A's cave + brother light (from the network position)", info={k: gh[k] for k in ('blue', 'light', 'bx')})
    shot(t, pa, '04_A_dark'); shot(t, pb, '04_B_ghost_map')
    # split across both pages
    A.tele(0, 2873); B.tele(1, 2874); sync()
    A.action(); B.action()
    za, zb = A.pz(), B.pz(); tA, tB = A.tiles(), B.tiles()
    t.ok(za and za['id'] == 'PZ3A' and zb and zb['id'] == 'PZ3B', 'split: both steles open at the same time', True, {'A': za, 'B': zb})
    mA, mB = dict(tA), dict(tB)
    for p in A.data('PZ3A')['need']:
        pa.tap(f'#twpz .twpzb-key[data-s="{mB[p]}"]')
    for p in B.data('PZ3B')['need']:
        pb.tap(f'#twpz .twpzb-key[data-s="{mA[p]}"]')
    shot(t, pa, '04_A_split'); shot(t, pb, '04_B_split')
    pa.tap('#twpz .twpzb-go'); pb.tap('#twpz .twpzb-go'); pa.wait_for_timeout(1000)
    A.step(2); B.step(2)
    oa, ob = A.obj('PZ3A', 'G3A', 'G3B'), B.obj('PZ3B', 'G3A', 'G3B')
    t.ok(oa['PZ3A'] and oa['G3A'] and ob['PZ3B'] and ob['G3B'], "split: each enters the other's symbols -> both partner gates open on both pages", True, {'A': oa, 'B': ob})
    # pause sync
    TOP = """(sel)=>{const e=document.elementFromPoint(innerWidth/2,innerHeight/2);return e?(e.closest('#twpz')?'#twpz':e.closest(sel)?sel:e.tagName):null;}"""
    pa.tap('.twui-pausebtn')
    try:
        pb.wait_for_function("__game.S().paused && __qa.vis('.twui-pause')", timeout=3000); pz_ok = True
    except Exception:
        pz_ok = False
    t.ok(A.ev('__game.S().paused') and pz_ok, 'pause on A -> B paused + pause menu', info={'A': A.ev('__game.S().paused'), 'B': B.ev('__game.S().paused')})
    shot(t, pb, '04_B_paused_by_A')
    pb.tap('.twui-pause [data-act=resume]')
    try:
        pa.wait_for_function("!__game.S().paused", timeout=3000)
    except Exception:
        pass
    # same, but B has a clue overlay open when A pauses
    B.tele(1, 2294); B.action(); zc = B.pz()
    pa.tap('.twui-pausebtn')
    try:
        pb.wait_for_function("__game.S().paused", timeout=3000)
    except Exception:
        pass
    top = pb.evaluate(TOP, '.twui-pause')
    t.ok(zc and top == '.twui-pause', 'B has a puzzle/clue overlay open when A pauses: the pause menu is on top (not hidden behind #twpz)', info={'B overlay': zc, 'on top': top})
    shot(t, pb, '04_B_pause_hidden_behind_overlay')
    if B.pz(): B.close_overlay()
    pb.tap('.twui-pause [data-act=resume]')
    try:
        pa.wait_for_function("!__game.S().paused && !__qa.vis('.twui-pause')", timeout=3000); rs_ok = True
    except Exception:
        rs_ok = False
    t.ok(rs_ok and not B.ev('__game.S().paused'), 'resume on B -> A resumes')
    # partner leaves while A reads a clue
    A.tele(0, 1463); A.action(); zc = A.pz()
    pb.close()
    try:
        pa.wait_for_function("__qa.vis('.twui-peerleft')", timeout=8000); left = True
    except Exception:
        left = False
    title = pa.evaluate("(document.getElementById('twui-pl-h')||{}).textContent||''")
    t.ok(left and title == 'Найз чинь гарлаа' and A.ev('__game.S().paused'), 'B closes the tab -> A shows «Найз чинь гарлаа» and pauses', info=title)
    top = pa.evaluate(TOP, '.twui-peerleft')
    t.ok(zc and top == '.twui-peerleft', '«Найз чинь гарлаа» is on top even though A had a clue overlay open', info={'A overlay': zc, 'on top': top})
    shot(t, pa, '04_A_peer_left_behind_overlay')
    if A.pz(): A.close_overlay()
    shot(t, pa, '04_A_peer_left')
    t.ok(not errs, 'no console/page errors on either page', info=errs or None)
    ctx.close()

# ================================================================ TEST 5: puzzle suites
def test_suites(t, br, base):
    farm = tempfile.mkdtemp(prefix='twqa_')
    try:
        for name in os.listdir(ROOT):
            if name == 'tests': continue
            os.symlink(os.path.join(ROOT, name), os.path.join(farm, name))
        for suite, f in (('puzzles', 'test_puzzles.py'), ('puzzles-b', 'test_puzzles_b.py')):
            os.makedirs(os.path.join(farm, 'tests', suite))
            dst = os.path.join(farm, 'tests', suite, f)
            shutil.copy(os.path.join(ROOT, 'tests', suite, f), dst)
            t0 = time.time()
            p = subprocess.run([sys.executable, dst], cwd=farm, capture_output=True, text=True, timeout=900)
            out = p.stdout + p.stderr
            fails = [l.strip() for l in out.splitlines() if 'FAIL' in l]
            oks = sum(1 for l in out.splitlines() if l.strip().startswith(('ok', 'PASS')))
            t.ok(p.returncode == 0 and not fails, f'tests/{suite}/{f}: exit {p.returncode}, {oks} ok, {len(fails)} FAIL ({time.time()-t0:.0f}s)',
                 info=fails[:6] or out.strip().splitlines()[-1:])
    finally:
        for dp, dn, fn in os.walk(farm, topdown=False, followlinks=False):
            for n in dn + fn:
                q = os.path.join(dp, n)
                if os.path.islink(q): os.unlink(q)
        shutil.rmtree(farm, ignore_errors=True)

# ================================================================ TEST 6: performance
def test_perf(t, br, base):
    errs, warns = [], []
    ctx = br.new_context(**MOBILE)
    pg = new_page(ctx, base + '/index.html', 'perf', errs, warns); P = Page(pg)
    pg.evaluate('__game.pause(true)'); pg.evaluate("__game.start('ch2')"); P.step(2)
    ne = P.ev('__game.S().enemies.length')
    run = "(n)=>{const g=__game;const t0=performance.now();for(let i=0;i<n;i++){g.update(1);g.render();}return +(performance.now()-t0).toFixed(1);}"
    P.ev(run, 30)   # warm-up
    ms = P.ev(run, 600)
    t.ok(ne == 8 and ms < 4000, f'ch2 start, {ne} enemies: 600 x (update+render) = {ms:.0f} ms ({ms/600:.2f} ms/frame), limit 4000', info=ms)
    # Chrome records 2D draw calls and rasterises lazily; a 1-px readback per frame forces the real raster work.
    runf = "(n)=>{const g=__game,c=document.getElementById('cv').getContext('2d');const t0=performance.now();for(let i=0;i<n;i++){g.update(1);g.render();c.getImageData(0,0,1,1);}return +(performance.now()-t0).toFixed(1);}"
    msf = P.ev(runf, 300)
    t.note(f'info (not a pass/fail criterion): forcing a raster flush every frame (1-px getImageData), dpr 2 software raster: {msf/300:.1f} ms/frame')
    # heavier frame: sister view over the cave (ghost map) while the brother is in the dark
    P.tele(0, 2455); P.ev('__game.S().active=1'); P.tele(1, 2544)
    ms2 = P.ev(run, 600)
    t.ok(ms2 < 4000, f'cave (ghost map + dark zone in view): 600 x (update+render) = {ms2:.0f} ms ({ms2/600:.2f} ms/frame)', info=ms2)
    shot(t, pg, '06_perf_cave_sister')
    # real rAF loop (includes raster + compositing)
    fps = """(ms)=>new Promise(res=>{const ts=[];function f(t){ts.push(t);if(t-ts[0]<ms)requestAnimationFrame(f);else{const d=[];for(let i=1;i<ts.length;i++)d.push(ts[i]-ts[i-1]);d.sort((a,b)=>a-b);
      res({fps:+(1000*d.length/(ts[ts.length-1]-ts[0])).toFixed(1),p50:+d[d.length>>1].toFixed(1),p95:+d[Math.floor(d.length*0.95)].toFixed(1)});}}requestAnimationFrame(f);})"""
    pg.evaluate('__game.pause(false)'); f2 = pg.evaluate(fps, 3000); pg.evaluate('__game.pause(true)')
    t.note(f'info: real rAF loop, dpr 2 (1688x780 canvas), headless software raster: {f2["fps"]} fps, frame p50 {f2["p50"]} ms, p95 {f2["p95"]} ms (dpr 1 holds 60 fps)')
    t.ok(not errs, 'no console/page errors', info=errs or None)
    ctx.close()

# ================================================================ main
TESTS = [(1, 'Boot + title + portrait rotate overlay', test_boot),
         (2, 'Solo ch1 playthrough, one world per screen, ⇅', test_ch1),
         (3, 'Solo ch2 playthrough with real puzzle overlays, dark zone, ghost map, shadow wolf', test_ch2),
         (4, 'Online two tabs (real lobby + net.js ?net=local)', test_online),
         (5, 'Puzzle module suites (tests/puzzles, tests/puzzles-b)', test_suites),
         (6, 'Performance: ch2, 600 updates+renders < 4 s', test_perf)]

def main():
    only = None
    if '--only' in sys.argv:
        only = {int(x) for x in sys.argv[sys.argv.index('--only') + 1].split(',')}
    os.makedirs(SHOTS, exist_ok=True)
    port = free_port()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f'http://127.0.0.1:{port}'
    done = []
    try:
        for _ in range(50):
            try:
                socket.create_connection(('127.0.0.1', port), timeout=0.2).close(); break
            except OSError:
                time.sleep(0.1)
        with sync_playwright() as p:
            br = p.chromium.launch(executable_path=CHROME)
            for num, name, fn in TESTS:
                if only and num not in only: continue
                t = Test(num, name); print(f'\n=== {num}. {name}', flush=True)
                t0 = time.time()
                try:
                    fn(t, br, base)
                except Exception as e:
                    t.error = f'{type(e).__name__}: {e}'
                    print('  ERROR ' + t.error); traceback.print_exc()
                t.secs = round(time.time() - t0, 1)
                print(f'--- {num}: {t.status} ({t.secs}s)', flush=True)
                done.append(t)
            br.close()
    finally:
        srv.terminate()
        try: srv.wait(5)
        except Exception: srv.kill()
    print('\n================ SUMMARY')
    for t in done:
        nf = sum(1 for c in t.checks if not c['ok'])
        print(f'{t.num}. {t.status:5} {t.name}  ({len(t.checks)-nf}/{len(t.checks)} checks{", error" if t.error else ""})')
    print('PASS* = passes only with the test shim for bug B1 (see docs/qa-report.md)')
    res = [{'num': t.num, 'name': t.name, 'status': t.status, 'secs': t.secs, 'error': t.error, 'checks': t.checks,
            'notes': t.notes, 'shots': t.shots} for t in done]
    if not only:
        with open(os.path.join(HERE, 'results.json'), 'w', encoding='utf-8') as f:
            json.dump(res, f, ensure_ascii=False, indent=1)
    sys.exit(0 if all(t.status == 'PASS' for t in done) else 1)

if __name__ == '__main__':
    main()
