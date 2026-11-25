import subprocess,time
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(["python3","-m","http.server","8766","--bind","127.0.0.1"],cwd="/home/claude/two-worlds",stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
try:
 with sync_playwright() as p:
  br=p.chromium.launch(executable_path="/usr/bin/google-chrome")
  pg=br.new_page(viewport={"width":844,"height":390},device_scale_factor=2);errs=[]
  pg.on("pageerror",lambda e:errs.append(str(e)))
  pg.on("console",lambda m:errs.append(m.text) if m.type=="error" and '404' not in m.text and 'Failed to load' not in m.text else None)
  pg.goto("http://127.0.0.1:8766/tango_test.html");pg.wait_for_timeout(500)
  pg.evaluate("__game.pause(true);document.querySelectorAll('#fbStart').forEach(e=>e.remove());__game.start('tango');__game.update(30)")
  # brother walks into dark zone
  pg.evaluate("(()=>{const g=__game;g.T.right=true;for(let i=0;i<330;i++)g.update(1);g.T.right=false;g.update(20);g.render()})()")
  print("b",pg.evaluate("__game.S().chars[0].x"));pg.screenshot(path="tango_dark_w0.png")
  # switch to sister view (ghost map)
  pg.evaluate("(()=>{const g=__game;g.latch.switch=true;g.update(2);const S=g.S();S.chars[1].x=640;g.update(40);g.render()})()");pg.screenshot(path="tango_ghost_w1.png")
  # sister sees shadow wolf
  pg.evaluate("(()=>{const g=__game,S=g.S();S.chars[1].x=1300;g.update(60);g.render()})()");pg.screenshot(path="tango_shadowwolf_w1.png")
  # open clue at 400 in sister world
  pg.evaluate("(()=>{const g=__game,S=g.S();S.chars[1].x=394;g.update(30);g.latch.action=true;g.update(1);g.render()})()");pg.wait_for_timeout(200)
  print("pz open",pg.evaluate("!!__game.S().pz"),pg.evaluate("document.getElementById('twpz').className"))
  pg.screenshot(path="tango_clue.png")
  pg.click("#twpz .x");print("closed",pg.evaluate("!__game.S().pz"))
  # brother solve (fallback or real)
  pg.evaluate("(()=>{const g=__game,S=g.S();g.latch.switch=true;g.update(2);S.chars[0].x=393;S.chars[0].y=TW.G-30;g.update(30);g.latch.action=true;g.update(1)})()");pg.wait_for_timeout(200)
  pg.screenshot(path="tango_solve.png")
  print("solve open",pg.evaluate("!!__game.S().pz"),"kind registered",pg.evaluate("!!(TW.puzzles&&TW.puzzles.symbols)"))
  print("errors",errs);br.close()
finally: srv.terminate()
