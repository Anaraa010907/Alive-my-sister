import subprocess,time
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(["python3","-m","http.server","8767","--bind","127.0.0.1"],cwd="/home/claude/two-worlds",stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
try:
 with sync_playwright() as p:
  br=p.chromium.launch(executable_path="/usr/bin/google-chrome")
  pg=br.new_page(viewport={"width":844,"height":390},device_scale_factor=2);errs=[];pg.on("pageerror",lambda e:errs.append(str(e)))
  pg.goto("http://127.0.0.1:8767/tango_test.html");pg.wait_for_timeout(500)
  pg.evaluate("(()=>{const g=__game;g.pause(true);document.querySelectorAll('#fbStart').forEach(e=>e.remove());g.start('tango');const S=g.S();S.chars[0].x=650;S.chars[0].snap=true;g.update(40);g.render()})()")
  pg.screenshot(path="tango_dark2_w0.png")
  pg.evaluate("(()=>{const g=__game,S=g.S();g.latch.switch=true;g.update(2);S.chars[1].x=700;S.chars[1].snap=true;g.update(30);g.render()})()");pg.screenshot(path="tango_ghost2_w1.png")
  print(errs);br.close()
finally: srv.terminate()
