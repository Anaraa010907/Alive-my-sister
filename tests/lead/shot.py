import sys
from playwright.sync_api import sync_playwright
url,ch,steps,out=sys.argv[1],sys.argv[2],int(sys.argv[3]),sys.argv[4]
with sync_playwright() as p:
    br=p.chromium.launch(executable_path="/usr/bin/google-chrome")
    pg=br.new_page(viewport={"width":1280,"height":720})
    errs=[];pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto(url);pg.wait_for_timeout(400)
    pg.evaluate(f"window.__game.pause(true);document.querySelectorAll('#fbStart').forEach(e=>e.remove());window.__game.start('{ch}');__game.update({steps});__game.render()")
    pg.screenshot(path=out);print("errors",errs);br.close()
