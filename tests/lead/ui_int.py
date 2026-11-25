from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    br=p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--autoplay-policy=no-user-gesture-required"])
    ctx=br.new_context(viewport={"width":390,"height":844},device_scale_factor=2,has_touch=True,is_mobile=True)
    pg=ctx.new_page();errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.on("console",lambda m:errs.append(m.text) if m.type=="error" and 'Failed to load' not in m.text and 'ERR_FILE' not in m.text else None)
    pg.goto("file:///home/claude/two-worlds/index.html");pg.wait_for_timeout(700)
    pg.screenshot(path="int_title.png")
    btns=pg.evaluate("[...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.textContent.trim())")
    print("buttons",btns)
    pg.get_by_text("Эхлэх",exact=True).first.tap();pg.wait_for_timeout(1200)
    pg.screenshot(path="int_card.png")
    print("current",pg.evaluate("TW.game.current()"),"mode",pg.evaluate("__game.S().mode"))
    pg.wait_for_timeout(2500);pg.screenshot(path="int_play.png")
    print("errors",errs);br.close()
