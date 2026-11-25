import subprocess,time,json
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(["python3","-m","http.server","8765","--bind","127.0.0.1"],cwd="/home/claude/two-worlds",stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(1)
WALK=open('ch1_test.py').read().split('WALK="""')[1].split('"""')[0]
try:
  with sync_playwright() as p:
    br=p.chromium.launch(executable_path="/usr/bin/google-chrome")
    ctx=br.new_context(viewport={"width":844,"height":390})
    A=ctx.new_page();B=ctx.new_page();errs=[]
    for pg,n in((A,'A'),(B,'B')):
        pg.on("pageerror",lambda e,n=n:errs.append(n+':'+str(e)))
    A.goto("http://127.0.0.1:8765/tests/lead/online.html#host");B.goto("http://127.0.0.1:8765/tests/lead/online.html");A.wait_for_timeout(600)
    for pg in(A,B):pg.evaluate("__game.pause(true);document.querySelectorAll('#fbStart').forEach(e=>e.remove())")
    A.evaluate("TW.net.setInfo({role:0})");B.evaluate("TW.net.setInfo({role:1})")
    A.evaluate("TW.game.startOnline('ch1')");B.wait_for_timeout(300)
    st=lambda pg:pg.evaluate("(()=>{const S=__game.S();return{mode:S.mode,net:S.netMode,role:S.role,seed:S.seed,B1:S.obj.B1.on,GB1:S.obj.GB1.held,crate:S.obj.C1.x,b:Math.round(S.chars[0].x),s:Math.round(S.chars[1].x),en:S.enemies.length}})()")
    print("start A",st(A));print("start B",st(B))
    W=lambda pg,ci,tx,j=[]:pg.evaluate(WALK,[ci,tx,j,4000])
    print("B walk",W(B,1,1066,[380,560]));B.evaluate("__game.latch.action=true;__game.update(2)");B.wait_for_timeout(200)
    A.evaluate("__game.update(100)");print("A after trig",st(A))
    print("A walk",W(A,0,780,[380,560]),W(A,0,1270,[]),W(A,0,1486,[]));A.wait_for_timeout(250);B.evaluate("__game.update(5)")
    print("B crate mirror",st(B)['crate'],"A crate",st(A)['crate'])
    A.evaluate("__game.S().obj.G1.on=true;__game.update(100)");print(W(A,0,1785,[1500]),W(A,0,2048,[]));A.evaluate("__game.update(5)");A.wait_for_timeout(200);B.evaluate("__game.update(5)")
    print("B GB1 held",st(B)['GB1'],"B sees brother x",st(B)['b'])
    A.evaluate("__game.latch.action=true;__game.update(3)");B.wait_for_timeout(200)
    print("B noises/ripples",B.evaluate("__game.S().ripples.length"))
    A.evaluate("__game.render()");A.screenshot(path="online_A.png");B.evaluate("__game.render()");B.screenshot(path="online_B.png")
    print("errors",errs);br.close()
finally:
  srv.terminate()
