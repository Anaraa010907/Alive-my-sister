import json,sys
from playwright.sync_api import sync_playwright
URL=sys.argv[1] if len(sys.argv)>1 else "file:///home/claude/two-worlds/tests/lead/engine_only.html"
WALK="""
([ci,tx,jumps,maxSteps])=>{const g=window.__game,S=g.S(),c=S.chars[ci];let hold=0;
for(let i=0;i<(maxSteps||4000);i++){const dir=c.x<tx-2?1:(c.x>tx+2?-1:0);
 if(dir===0&&Math.abs(c.vx)<5&&c.onGround){g.T.left=g.T.right=g.T.jump=false;return{ok:true,i,x:c.x};}
 g.T.right=dir>0;g.T.left=dir<0;
 if(c.onGround&&hold<=0){const re=c.x+c.w;for(const j of jumps)if(dir>0&&re>=j-14&&re<=j+1){g.latch.jump=true;hold=25;break;}}
 g.T.jump=hold>0;hold--;g.update(1);
 if(c.dying>0){g.T.left=g.T.right=g.T.jump=false;return{ok:false,died:true,x:c.x,i};}
 if(S.mode!=='play'){g.T.left=g.T.right=g.T.jump=false;return{ok:true,mode:S.mode,x:c.x};}}
g.T.left=g.T.right=g.T.jump=false;return{ok:false,x:c.x,y:c.y};}"""
errs=[]
with sync_playwright() as p:
    br=p.chromium.launch(executable_path="/usr/bin/google-chrome")
    pg=br.new_page(viewport={"width":1280,"height":720})
    pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.on("console",lambda m:errs.append(m.text) if m.type=="error" and 'Failed to load' not in m.text else None)
    pg.goto(URL);pg.wait_for_timeout(500)
    pg.screenshot(path="title.png")
    pg.evaluate("window.__game.pause(true);document.querySelectorAll('#fbStart,.twui-root').forEach(e=>e.style.display='none');window.__game.start('ch1')")
    W=lambda ci,tx,j=[],m=4000:pg.evaluate(WALK,[ci,tx,j,m])
    st=lambda:pg.evaluate("(()=>{const S=__game.S();return{mode:S.mode,stage:S.stage,deaths:S.deaths,B1:S.obj.B1.on,G1:S.obj.G1.on,R1:S.obj.R1.on,crate:S.obj.C1.x,b:S.chars[0].x,s:S.chars[1].x}})()")
    step=lambda n:pg.evaluate(f"__game.update({n})")
    tap=lambda k:pg.evaluate(f"__game.latch['{k}']=true")
    r={}
    r['river']=W(0,780,[380,560]);r['drown']=W(0,900,[]);step(80);r['after']=st();W(0,780,[])
    tap('switch');step(1);r['sL1']=W(1,1066,[380,560]);tap('action');step(100);r['L1']=st()
    tap('switch');step(1);W(0,1270,[]);W(0,1486,[],1500);r['crate']=st()['crate'];r['bover']=W(0,1785,[1500])
    tap('switch');step(1);W(1,1515,[1300,1500]);r['ledge']=W(1,1734,[1560]);tap('action');step(100);r['L2']=st()
    W(1,2120,[]);tap('switch');step(1);W(0,2048,[]);step(30);tap('switch');step(1);r['cross']=W(1,2414,[]);tap('action');step(100);r['L3']=st()
    tap('switch');step(1);W(0,2893,[]);tap('switch');step(1);r['meet']=W(1,2894,[]);step(400)
    r['final']=st()
    pg.evaluate("__game.render()");pg.screenshot(path="ch1_end.png")
    br.close()
for k,v in r.items():print(k,v)
print("ERRORS",errs)
