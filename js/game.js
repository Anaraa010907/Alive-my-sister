(function(){
'use strict';
const TW=window.TW;
const H=TW.H,G=TW.G,DEATH_Y=TW.DEATH_Y,STEP=1/60;
const PROTOTYPE_UNLOCK_ALL=true;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const ease=t=>t*t*(3-2*t);
function rng(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function hashStr(str){let h=2166136261;for(let i=0;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),16777619);return h>>>0;}
const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
const errOnce={};function logErr(k,e){if(!errOnce[k]){errOnce[k]=1;console.error('['+k+']',e);}}

// ================= chapter loading =================
let CH=null,LV=null,DEC=null;
function loadChapter(def){
  CH=def;
  const worlds=[0,1].map(w=>{const d=(def.worlds&&def.worlds[w])||{};
    const ground=(d.ground||[]).map(g=>[g[0],g[1]]).sort((a,b)=>a[0]-b[0]);
    const gaps=[];for(let i=0;i<ground.length-1;i++)if(ground[i+1][0]>ground[i][1])gaps.push([ground[i][1],ground[i+1][0]]);
    return{ground,gaps,blocks:d.blocks||[],water:d.water||[],grass:d.grass||[],bones:d.bones||[],ice:d.ice||[],decor:d.decor||[],dark:d.dark||[]};});
  LV={width:def.width||3300,worlds};
  // decor
  const keep=[];
  for(const o of def.objects||[]){if(o.x0!=null)keep.push([o.x0-30,o.x1+30]);else if(o.x!=null)keep.push([o.x-40,o.x+60]);}
  for(const e of def.enemies||[])if(e.type==='raven')keep.push([e.x-30,e.x+30]);
  if(def.exit)keep.push([def.exit.x-70,def.exit.x+70]);
  DEC=[0,1].map(w=>{
    const r=rng(11+w*101+(def.num||1)*977),W=worlds[w],D={trees:[],grass:[],fg:[]};
    const onGround=x=>W.ground.some(g=>x>g[0]+12&&x<g[1]-12);
    const inBlock=x=>W.blocks.some(b=>b.k!=='cliff'&&x>b.x-10&&x<b.x+b.w+10&&b.h>30);
    const nearGap=x=>W.gaps.some(g=>x>g[0]-25&&x<g[1]+25);
    let x=-40;
    while(x<LV.width-60){x+=80+r()*160;const f=r()<0.5?1:0.8;
      if(f===1&&(!onGround(x)||nearGap(x)||inBlock(x)||keep.some(k=>x>k[0]&&x<k[1])))continue;
      const br=[];const n=2+Math.floor(r()*(w?4:3));
      for(let i=0;i<n;i++)br.push({y:G-40-r()*130,d:r()<0.5?-1:1,l:12+r()*(w?26:32),c:0.15+r()*(w?0.7:0.4)});
      D.trees.push({x,f,wd:f===1?6+r()*7:4+r()*5,lean:(r()-0.5)*(w?34:18),br});}
    for(const g of W.ground)for(let gx=Math.max(g[0],-120)+2;gx<Math.min(g[1],LV.width+200)-1;gx+=2.5+r()*4.5)D.grass.push([gx,1.5+r()*(w?4:6),(r()-0.5)*3]);
    let fx=150;while(fx<LV.width+1500){fx+=280+r()*420;D.fg.push({x:fx,h:28+r()*44,n:4+Math.floor(r()*5),s:r()*1000});}
    return D;});
}

// ================= state =================
let S;
function mkChar(i,x){const P=i===0?TW.PHYS.brother:TW.PHYS.sister;return{i,w:P.w,h:P.h,x,y:G-P.h,vx:0,vy:0,onGround:true,face:1,walk:0,stepPh:0,cp:x,dying:0,spawn:0,coyote:0,jumpBuf:0,
  gravity:P.gravity,jumpV:P.jumpV,speed:P.speed,pushing:false,look:0,lookT:0,reach:0,callCd:0,pushSnd:0,snap:false,hidden:false,stillT:0,inGrass:false};}
function makeObj(d){
  const o=Object.assign({},d,{def:d,on:false,p:0,held:false,a:0});
  if(o.type==='crate'){const P=TW.PHYS.crate;Object.assign(o,{w:P.w,h:P.h,y:G-P.h,vy:0,onGround:true,home:d.x,respawn:0,fade:1});}
  if(o.type==='lever'&&o.y==null)o.y=G;
  if(o.type==='puzzle')o.cool=0;
  return o;
}
function makeState(){
  const st=CH.start||[100,100];
  const s={t:0,time:0,mode:'title',active:0,deaths:0,paused:false,
    chars:[mkChar(0,st[0]),mkChar(1,st[1])],obj:{},objList:[],enemies:[],
    ripples:[],parts:[],amb:[[],[]],cams:[0,0],stage:0,stageT:0,noises:[],
    ending:null,introCall:false,flash:[0,0],swf:[0,0],glow:0,white:0,musicOn:{},
    seed:1,netMode:'solo',role:null,pz:null,netAcc:0,pzData:{}};
  for(const d of CH.objects||[]){const o=makeObj(d);s.objList.push(o);if(o.id)s.obj[o.id]=o;}
  return s;
}
function spawnEnemy(def){
  const e=Object.assign({},def,{def,x:def.x,y:def.y!=null?def.y:G-20,w:20,h:20,vx:0,vy:0,face:1,onGround:true,state:'idle',t:0,anim:0,alive:true});
  const T=TW.enemyTypes[def.type];
  if(T&&T.init){try{T.init(e,api);}catch(err){logErr('init:'+def.type,err);}}
  if(def.y==null&&!(T&&T.init))e.y=G-e.h;
  return e;
}
function spawnEnemies(){S.enemies=(CH.enemies||[]).filter(d=>S.netMode!=='online'||d.world===S.role).map(spawnEnemy);}

// ================= physics =================
function crates(){return S.objList.filter(o=>o.type==='crate');}
const SOLIDS={
  gate:o=>{const e=ease(o.p),top=o.top!=null?o.top:40;return{x:o.x,y:top-e*150,w:14,h:150};},
  drawbridge:o=>o.p>=1?{x:o.x0,y:G,w:o.x1-o.x0,h:14}:null,
  ropebridge:o=>o.p>=1?{x:o.x0,y:G,w:o.x1-o.x0,h:14}:null,
  ghostbridge:o=>o.a>0.5?{x:o.x0,y:G,w:o.x1-o.x0,h:14}:null
};
function solidsFor(w,noCrate){
  const out=[],W=LV.worlds[w];
  for(const g of W.ground)out.push({x:g[0],y:G,w:g[1]-g[0],h:300});
  for(const b of W.blocks)out.push({x:b.x,y:b.y,w:b.w,h:b.h});
  for(const o of S.objList){
    if(o.type==='crate'){if(o.respawn>0)continue;if(w===0&&noCrate)continue;out.push({x:o.x,y:o.y,w:o.w,h:o.h,crate:w===0?o:null});continue;}
    if(o.world!==w)continue;const f=SOLIDS[o.type];if(f){const r=f(o);if(r)out.push(r);}
  }
  return out;
}
function prefilter(b,sol){for(const s of sol)s.skip=overlap(b,s);}
function moveX(b,dx,sol){if(!dx)return;b.x+=dx;for(const s of sol){if(s.skip)continue;if(overlap(b,s))b.x=dx>0?s.x-b.w:s.x+s.w;}}
function moveY(b,dy,sol){b.y+=dy;b.onGround=false;for(const s of sol){if(s.skip)continue;if(overlap(b,s)){if(dy>0){b.y=s.y-b.h;b.onGround=true;}else b.y=s.y+s.h;b.vy=0;}}}
const inZone=(x,zs)=>zs.some(z=>x>=z.x0&&x<=z.x1);

// ================= characters =================
const IDLE={};
function updateChar(c,dt,inp){
  if(c.dying>0){c.dying-=dt;if(c.dying<=0)respawn(c);return;}
  if(c.spawn>0)c.spawn=Math.max(0,c.spawn-dt*2.2);
  if(c.lookT>0){c.lookT-=dt;if(c.lookT<=0)c.look=0;}
  if(c.callCd>0)c.callCd-=dt;
  const dir=(inp.right?1:0)-(inp.left?1:0),acc=c.onGround?1100:750,want=dir*c.speed;
  if(c.vx<want)c.vx=Math.min(want,c.vx+acc*dt);else if(c.vx>want)c.vx=Math.max(want,c.vx-acc*dt);
  if(dir)c.face=dir;
  c.coyote=c.onGround?0.1:Math.max(0,c.coyote-dt);
  c.jumpBuf=inp.jumpPressed?0.13:Math.max(0,c.jumpBuf-dt);
  if(c.jumpBuf>0&&c.coyote>0){c.vy=-c.jumpV;c.jumpBuf=0;c.coyote=0;sfx('jump',0.9);}
  c.vy=Math.min(c.vy+c.gravity*dt,520);
  const wasG=c.onGround,vyB=c.vy,sol=solidsFor(c.i);prefilter(c,sol);
  let dx=c.vx*dt;c.pushing=false;
  if(c.i===0&&dx&&c.onGround){
    for(const cr of crates()){
      if(cr.respawn>0||overlap(c,cr)||!overlap({x:c.x+dx,y:c.y,w:c.w,h:c.h},cr)||c.y+c.h<=cr.y+3)continue;
      const push=TW.PHYS.crate.push,pdx=Math.sign(dx)*Math.min(Math.abs(dx),push*dt),cs=solidsFor(0,true);
      for(const o of crates())if(o!==cr&&o.respawn<=0)cs.push({x:o.x,y:o.y,w:o.w,h:o.h});
      prefilter(cr,cs);const bx=cr.x;moveX(cr,pdx,cs);const moved=cr.x-bx;
      if(Math.abs(moved)>1e-3){c.pushing=true;dx=moved;c.vx=Math.sign(c.vx)*Math.min(Math.abs(c.vx),push);
        for(const s of sol)if(s.crate===cr)s.x=cr.x;
        c.pushSnd-=dt;if(c.pushSnd<=0){c.pushSnd=0.24;sfx('push',0.8);}}
      break;
    }
  }
  moveX(c,dx,sol);moveY(c,c.vy*dt,sol);
  const cx=c.x+c.w/2,W=LV.worlds[c.i];
  const onBones=c.onGround&&inZone(cx,W.bones);
  if(c.onGround&&!wasG&&vyB>260){
    sfx('land',0.8);
    if(c.i===1&&vyB>300){S.noises.push({world:1,x:cx,y:c.y+c.h,r:onBones?200:110,src:'land'});if(onBones)sfxAt('bones',1,cx);}
  }
  c.walk+=Math.abs(c.vx)*dt*(c.i?0.21:0.17);
  const ph=Math.floor(c.walk/Math.PI);
  if(ph!==c.stepPh){c.stepPh=ph;
    if(c.onGround&&Math.abs(c.vx)>20){
      if(onBones){S.noises.push({world:c.i,x:cx,y:c.y+c.h,r:170,src:'bones'});sfxAt('bones',c.i,cx);}
      else if(c.inGrass&&ph%2===0)sfxAt('grassRustle',c.i,cx,0.5);
    }}
  // hiding
  c.inGrass=inZone(cx,W.grass);
  c.stillT=(c.onGround&&Math.abs(c.vx)<15)?c.stillT+dt:0;
  const hid=c.inGrass&&c.onGround&&c.stillT>=0.25;
  if(hid&&!c.hidden)sfxAt('grassRustle',c.i,cx,0.4);
  c.hidden=hid;
  if(c.onGround)for(const cp of (CH.checkpoints&&CH.checkpoints[c.i])||[])if(c.x>=cp&&cp>c.cp)c.cp=cp;
  if(inZone(cx,W.water)&&c.y+c.h>G+19){die(c,'water');return;}
  if(c.y>DEATH_Y)die(c,'fall');
}
function die(c,why){
  if(c.dying>0||S.mode!=='play')return;c.dying=0.95;c.vx=0;c.vy=0;c.hidden=false;S.deaths++;S.flash[c.i]=1;
  const cx=c.x+c.w/2,cy=c.y+c.h/2;
  for(let k=0;k<26;k++)S.parts.push({w:c.i,x:cx+(Math.random()-0.5)*c.w,y:cy+(Math.random()-0.5)*c.h,vx:(Math.random()-0.5)*90,vy:-Math.random()*90-10,life:0.8+Math.random()*0.7,max:1.5,s:1+Math.random()*2,c:c.i?'#eef0f3':'#0a0908',g:why==='water'?280:120});
  if(why==='water'){splash(cx,G+16);sfx('splash');}
  sfx('death');TW.emit('death',{who:c.i,why});
  if(S.netMode==='online'&&c.i===S.role)netSend({t:'death',who:c.i});
  if(S.pz&&S.pz.who===c.i)closePuzzle();
}
function respawn(c){
  c.x=c.cp;c.y=G-c.h;c.vx=0;c.vy=0;c.dying=0;c.spawn=1;c.onGround=true;c.face=1;c.snap=true;c.stillT=0;c.hidden=false;
  S.enemies=S.enemies.map(e=>e.world===c.i?spawnEnemy(e.def):e);
}
function splash(x,y){for(let k=0;k<20;k++)S.parts.push({w:0,x:x+(Math.random()-0.5)*14,y,vx:(Math.random()-0.5)*110,vy:-60-Math.random()*120,life:0.5+Math.random()*0.4,max:0.9,s:1+Math.random()*1.5,c:'rgba(215,203,175,0.85)',g:420});}

// ================= objects =================
function targetsOf(o){return [].concat(o.target||[]).map(id=>S.obj[id]).filter(Boolean);}
function objCenter(o){
  if(o.type==='drawbridge')return{x:(o.x0+o.x1)/2,y:G-40};
  if(o.type==='gate')return{x:o.x+7,y:110};
  if(o.x0!=null)return{x:(o.x0+o.x1)/2,y:G-10};
  return{x:o.x||0,y:(o.y||G)-20};
}
function pullLever(l){
  l.on=true;sfx('lever');sfx('rumble');
  triggerTargets(l);
  S.ripples.push({w:l.world,x:l.x,y:l.y-10,t:0,c:'208,52,58'});
}
function updateObjects(dt){
  for(const o of S.objList){
    if((o.type==='gate'||o.type==='drawbridge'||o.type==='ropebridge')&&o.on&&o.p<1)o.p=Math.min(1,o.p+dt/1.4);
    if(o.type==='lever'&&o.on&&o.p<1)o.p=Math.min(1,o.p+dt*4);
    if(o.type==='plate'){
      if(S.netMode==='online'&&o.world!==S.role)continue;
      const c=S.chars[o.world],cc=c.x+c.w/2;
      let pr=c.dying<=0&&c.onGround&&cc>=o.x0&&cc<=o.x1&&Math.abs(c.y+c.h-G)<1.5;
      if(o.world===0)for(const cr of crates()){const k=cr.x+cr.w/2;if(cr.respawn<=0&&k>=o.x0&&k<=o.x1&&Math.abs(cr.y+cr.h-G)<1.5)pr=true;}
      if(pr&&!o.held){sfx('ghost');for(const t of targetsOf(o)){const cn=objCenter(t);S.ripples.push({w:t.world,x:cn.x,y:cn.y,t:0,c:'200,215,245',big:true});}}
      if(pr!==o.held&&S.netMode==='online')for(const t of targetsOf(o))if(t.world!==S.role)netSend({t:'held',id:t.id,v:pr});
      o.held=pr;o.on=pr;for(const t of targetsOf(o)){t.held=pr;}
    }
    if(o.type==='ghostbridge'){o.a+=((o.held?1:0)-o.a)*Math.min(1,dt*(o.held?4:7));o.on=o.held;}
    if(o.type==='puzzle'&&o.cool>0)o.cool-=dt;
    if(o.type==='crate'){
      if(S.netMode==='online'&&S.role!==0)continue;
      if(o.respawn>0){o.respawn-=dt;o.y+=8*dt;if(o.respawn<=0){o.x=o.home;o.y=G-o.h;o.vy=0;o.fade=0;}continue;}
      o.fade=Math.min(1,o.fade+dt*2);o.vy=Math.min(o.vy+1500*dt,520);
      const sol=solidsFor(0,true);for(const k of crates())if(k!==o&&k.respawn<=0)sol.push({x:k.x,y:k.y,w:k.w,h:k.h});
      prefilter(o,sol);moveY(o,o.vy*dt,sol);
      const cx=o.x+o.w/2,wet=inZone(cx,LV.worlds[0].water)&&o.y+o.h>G+26;
      if(o.y>DEATH_Y||wet){o.respawn=0.8;if(wet){splash(cx,G+16);sfx('splash');}}
    }
  }
}
function pzData(p){
  if(!p)return null;if(p.id in S.pzData)return S.pzData[p.id];
  const K=TW.puzzles&&TW.puzzles[p.kind];let d=null;
  if(K&&K.gen){const key=String((p.params&&p.params.pair)||p.id);try{d=K.gen(rng((S.seed^hashStr(key))>>>0),p.params||{});}catch(e){logErr('pz.gen:'+p.kind,e);}}
  S.pzData[p.id]=d;return d;
}
const pzRoot=document.getElementById('twpz');
function openPuzzle(o,mode,who){
  if(!pzRoot||S.pz)return;
  const p=mode==='clue'?S.obj[o.puzzle]:o;if(!p)return;
  const K=TW.puzzles&&TW.puzzles[p.kind],data=pzData(p),body=pzRoot.querySelector('.b');
  pzRoot.querySelector('.ti').textContent=(K&&K.title)||'Оньсого';
  pzRoot.querySelector('.su').textContent=mode==='clue'?'Найздаа хэлж өг':(p.kind==='split'?'Тэмдгээ найздаа хэлээд, түүнийхийг оруул':'Найзаасаа асууж шийд');
  body.innerHTML='';
  const z={obj:o,p,mode,who,cleanup:null,done:false};S.pz=z;
  for(const k in K)K[k]=false;for(const k in T)T[k]=false;for(const k in latch)latch[k]=false;
  const api={success:()=>finishPz(z,true),fail:()=>finishPz(z,false),close:()=>{if(S&&S.pz===z)closePuzzle();}};
  try{
    let r=null;
    if(K&&mode==='clue'&&K.showClue)r=K.showClue(body,data,api);
    else if(K&&mode==='solve'&&K.solve)r=K.solve(body,data,api);
    else{body.innerHTML='<div style="padding:28px;text-align:center;opacity:.8">Энэ оньсого удахгүй нэмэгдэнэ.</div>';
      if(mode==='solve'){const b=document.createElement('button');b.textContent='Шийдсэн гэж үзэх';b.className='twpz-fallback';b.onclick=()=>api.success();body.firstChild.appendChild(document.createElement('br'));body.firstChild.appendChild(b);}}
    if(typeof r==='function')z.cleanup=r;
  }catch(e){logErr('pz.open:'+p.kind,e);body.textContent='Алдаа гарлаа';}
  pzRoot.classList.add('open');sfx('switch',0.6);
}
function finishPz(z,ok){
  if(!S||S.pz!==z||z.done||z.mode!=='solve')return;z.done=true;const o=z.p;
  if(ok){o.on=true;sfx('ghost');triggerTargets(o);S.ripples.push({w:o.world,x:o.x,y:G-30,t:0,c:'150,190,255',big:true});}
  else{o.cool=3;S.noises.push({world:o.world,x:o.x,y:G-10,r:320,src:'fail'});sfx('fail');S.flash[o.world]=0.6;}
  setTimeout(()=>{if(S&&S.pz===z)closePuzzle();},ok?700:450);
}
function closePuzzle(){
  const z=S&&S.pz;if(!z)return;S.pz=null;
  try{if(z.cleanup)z.cleanup();}catch(e){logErr('pz.cleanup',e);}
  if(pzRoot){pzRoot.classList.remove('open');pzRoot.querySelector('.b').innerHTML='';}
}
if(pzRoot)pzRoot.querySelector('.x').addEventListener('click',()=>closePuzzle());
function triggerTargets(src){
  for(const t of targetsOf(src)){
    t.on=true;const c=objCenter(t);S.ripples.push({w:t.world,x:c.x,y:c.y,t:0,c:'208,52,58',big:true});
    if(S.netMode==='online'&&t.world!==S.role)netSend({t:'trig',id:t.id});
  }
}
function updatePuppet(c,dt){
  const r=c.remote;if(!r)return;
  const k=Math.min(1,dt*8);c.x+=(r.x-c.x)*k;c.y+=(r.y-c.y)*k;c.vx=r.vx;c.face=r.face||1;c.onGround=!!r.onGround;c.dying=r.dying?0.5:0;
  c.walk+=Math.abs(c.vx)*dt*(c.i?0.21:0.17);
}
function netSend(m){try{if(TW.net&&TW.net.connected)TW.net.send(m);}catch(e){logErr('net.send',e);}}
function netTick(dt){
  if(S.netMode!=='online')return;
  S.netAcc+=dt;if(S.netAcc<0.2)return;S.netAcc=0;
  const c=S.chars[S.role],m={t:'st',x:+c.x.toFixed(1),y:+c.y.toFixed(1),vx:Math.round(c.vx),face:c.face,onGround:c.onGround,dying:c.dying>0};
  if(S.role===0)m.crates=crates().map(o=>[o.id,+o.x.toFixed(1),+o.y.toFixed(1),o.respawn>0?1:0]);
  const sh=S.enemies.filter(e=>e.seenBy==='other'&&e.alive);if(sh.length)m.sh=sh.map(e=>[e.type,+e.x.toFixed(1),+e.y.toFixed(1),e.w,e.h,e.face,e.state,+e.anim.toFixed(2)]);
  netSend(m);
}
function onNet(m){
  if(!m||!m.t)return;
  if(m.t==='start'){startOnlineGuest(m);return;}
  if(!S||S.netMode!=='online')return;
  switch(m.t){
    case 'st':{const c=S.chars[1-S.role];c.remote=m;if(c.x===undefined||Math.abs(c.x-m.x)>200){c.x=m.x;c.y=m.y;}
      if(S.role===1&&m.crates)for(const [id,x,y,rs] of m.crates){const o=S.obj[id];if(o){o.x=x;o.y=y;o.respawn=rs?0.5:0;o.fade=1;}}
      S.ghosts=(m.sh||[]).map(a=>({type:a[0],x:a[1],y:a[2],w:a[3],h:a[4],face:a[5],state:a[6],anim:a[7],world:1-S.role,alive:true}));break;}
    case 'trig':{const o=S.obj[m.id];if(o&&!o.on){o.on=true;if(o.world===S.role){const c=objCenter(o);S.ripples.push({w:o.world,x:c.x,y:c.y,t:0,c:'208,52,58',big:true});sfx('rumble',0.8);}}break;}
    case 'held':{const o=S.obj[m.id];if(o)o.held=!!m.v;break;}
    case 'call':{S.noises.push({world:S.role,x:m.x,y:m.y,r:260,src:'echo'});S.ripples.push({w:S.role,x:m.x,y:m.y,t:-0.1,c:S.role===0?'208,52,58':'150,190,255'});
      sfxAt(S.role===0?'callS':'callB',S.role,m.x,0.7);const me=S.chars[S.role];if(me.dying<=0){me.lookT=1.4;me.look=S.role===0?-1:1;}break;}
    case 'death':S.deaths++;break;
    case 'exit':if(S.mode==='play')beginEnding();break;
    case 'restart':startChapterInternal(CH.id,{mode:'online',role:S.role,seed:S.seed});break;
    case 'pause':pauseGame(!!m.v,true);break;
    case 'menu':TW.emit('peerMenu',{});break;
  }
}
function doAction(c){
  if(c.dying>0)return;
  const cx=c.x+c.w/2;
  for(const l of S.objList)if(l.type==='lever'&&l.world===c.i&&!l.on&&Math.abs(cx-l.x)<16&&Math.abs(c.y+c.h-l.y)<6){pullLever(l);return;}
  if(c.onGround)for(const o of S.objList){
    if(o.type==='puzzle'&&o.world===c.i&&!o.on&&Math.abs(cx-o.x)<24){if(o.cool<=0)openPuzzle(o,'solve',c.i);return;}
    if(o.type==='clue'&&o.world===c.i&&Math.abs(cx-o.x)<26&&S.obj[o.puzzle]){openPuzzle(o,'clue',c.i);return;}
  }
  if(c.callCd>0)return;c.callCd=0.7;callFrom(c);
}
function callFrom(c){
  const cx=c.x+c.w/2,cy=c.y+c.h*0.45;
  S.ripples.push({w:c.i,x:cx,y:cy,t:0,c:c.i?'232,236,244':'30,27,22'});
  S.ripples.push({w:1-c.i,x:cx,y:cy,t:-0.15,c:c.i?'208,52,58':'150,190,255'});
  S.noises.push({world:c.i,x:cx,y:cy,r:220,src:'call'});
  if(S.netMode==='online'){netSend({t:'call',x:cx,y:cy});}else S.noises.push({world:1-c.i,x:cx,y:cy,r:260,src:'echo'});
  sfx(c.i?'callS':'callB');
  const o=S.chars[1-c.i];
  if(o.dying<=0){o.lookT=1.4;o.look=c.i===0?1:-1;if(Math.abs(o.vx)<5)o.face=cx>=o.x+o.w/2?1:-1;}
}

// ================= enemies =================
const api={
  get S(){return S;},G,H,dt:STEP,
  get chars(){return S.chars;},
  solidsFor:w=>solidsFor(w),
  moveBody(e,dx,dy,w){const sol=solidsFor(w);prefilter(e,sol);const bx=e.x;moveX(e,dx,sol);const hitX=Math.abs((e.x-bx)-dx)>1e-6;moveY(e,dy,sol);return{hitX};},
  groundAhead(e,w,dx){const px=e.x+e.w/2+dx,py=G+2;return solidsFor(w).some(s=>px>=s.x&&px<=s.x+s.w&&py>=s.y&&py<=s.y+s.h);},
  overlap,
  isHidden:c=>!!c.hidden,
  get noises(){return S.noises;},
  kill:(c,why)=>die(c,why||'enemy'),
  sfx:(name,world,x)=>sfxAt(name,world==null?S.active:world,x==null?S.cams[S.active]+panels[S.active].vw/2:x),
  music:(name,on)=>setMusic(name,on),
  get enemies(){return S.enemies;},
  rand:()=>Math.random()
};
function updateEnemies(dt){
  for(const e of S.enemies){const T=TW.enemyTypes[e.type];if(!T||!T.update||!e.alive)continue;
    try{T.update(e,dt,api);}catch(err){logErr('update:'+e.type,err);}}
}

// ================= flow helpers =================
function computeStage(){const st=CH.stages||[];for(let i=0;i<st.length;i++){let d=false;try{d=!!st[i].done(S);}catch(e){logErr('stage'+i,e);}if(!d)return i;}return st.length;}
function hintTarget(){const s=(CH.stages||[])[S.stage];if(!s||!s.hint)return null;try{return s.hint(S);}catch(e){logErr('hint',e);return null;}}
function updateStage(dt){const st=computeStage();if(st!==S.stage){S.stage=st;S.stageT=0;}else S.stageT+=dt;}
function checkExit(){
  if(!CH.exit)return;const X=CH.exit.x;
  const ok=c=>c.dying<=0&&c.onGround&&Math.abs(c.x+c.w/2-X)<45;
  if(S.netMode==='online'&&!(TW.net&&TW.net.isHost))return;
  if(ok(S.chars[0])&&ok(S.chars[1])){if(S.netMode==='online')netSend({t:'exit'});beginEnding();}
}
function beginEnding(){if(S.pz)closePuzzle();S.mode='ending';S.ending={t:0,kind:CH.exit.kind||'pass'};setHint(false);stopAllMusic();ambience();}
function updateEnding(dt){
  const E=S.ending,X=CH.exit.x;E.t+=dt;
  const meet=E.kind==='meet';
  for(const c of S.chars){const cx=c.x+c.w/2;if(S.netMode==='online'&&c.i!==S.role){c.x+=(X-c.w/2-c.x)*Math.min(1,dt*2);continue;}c.speed=55;updateChar(c,dt,{left:E.t<2.6&&cx>X+1.5,right:E.t<2.6&&cx<X-1.5});}
  if(meet){
    if(E.t>1.6){const r=Math.min(1,(E.t-1.6)/0.8);for(const c of S.chars){c.reach=r;c.lookT=9;}S.chars[0].look=-1;S.chars[1].look=1;}
    S.glow=clamp((E.t-0.8)/1.5,0,1);S.white=clamp((E.t-3.8)/1.6,0,1);
    if(E.t>1.8&&!E.chord){E.chord=true;sfx('end');}
    if(E.t>5.6&&!E.done)finishChapter();
  }else{
    S.glow=clamp((E.t-0.2)/1.0,0,0.6);S.white=clamp((E.t-0.8)/1.2,0,1);
    if(E.t>0.3&&!E.chord){E.chord=true;sfx('ghost');}
    if(E.t>2.2&&!E.done)finishChapter();
  }
  updateObjects(dt);
}
function finishChapter(){
  S.ending.done=true;S.mode='done';
  const order=chapterOrder(),i=order.indexOf(CH.id),next=i>=0&&i<order.length-1?order[i+1]:null;
  const prog=loadProgress();
  if(next&&prog.unlocked.indexOf(next)<0)prog.unlocked.push(next);
  const b=prog.best[CH.id];if(!b||S.time<b.time)prog.best[CH.id]={time:Math.round(S.time),deaths:S.deaths};
  saveProgress(prog);
  TW.emit('chapterEnd',{id:CH.id,num:CH.num,title:CH.title,endText:CH.endText||'',next,time:S.time,deaths:S.deaths});
  if(!TW.ui)fallbackEnd(next);
}
function switchChar(){S.active^=1;S.swf[S.active]=1;sfx('switch');ambience();}

// ================= input =================
const K={},T={},TST={},latch={};
function readInput(){
  const r={};for(const k of ['left','right','jump','action','switch'])r[k]=!!(K[k]||T[k]||TST[k]);
  r.jumpPressed=!!latch.jump;r.actionPressed=!!latch.action;r.switchPressed=!!latch.switch;
  latch.jump=latch.action=latch.switch=false;return r;
}
function update(dt){
  if(S.paused)return;
  S.t+=dt;
  const inp=readInput();
  if(S.mode==='play'){
    const solo=S.netMode!=='online';
    if(!(solo&&S.pz)){
      S.time+=dt;
      if(solo&&inp.switchPressed)switchChar();
      for(const c of S.chars){
        if(!solo&&c.i!==S.role){updatePuppet(c,dt);continue;}
        updateChar(c,dt,c.i===S.active&&!S.pz?inp:IDLE);
      }
      if(inp.actionPressed&&!S.pz)doAction(S.chars[S.active]);
      updateObjects(dt);updateEnemies(dt);updateStage(dt);checkExit();netTick(dt);
      if(!S.introCall&&S.time>1.3&&(solo||S.role===1)){S.introCall=true;callFrom(S.chars[1]);}
    }
  }else if(S.mode==='ending')updateEnding(dt);
  else if(S.mode==='title')for(const c of S.chars)updateChar(c,dt,IDLE);
  S.noises.length=0;
  updateFx(dt);updateCams(dt);
}
function newAmb(w,p,cam){
  const r=Math.random;
  return w?{x:cam+r()*p.vw,y:p.top+r()*(H-p.top),vx:(r()-0.5)*5,vy:-(5+r()*12),life:4+r()*5,max:9,s:0.6+r()*1.1,f:0.5+r(),ph:r()*6}
          :{x:cam+r()*p.vw,y:p.top+20+r()*(G-p.top-20),vx:3+r()*6,vy:(r()-0.5)*2,life:4+r()*4,max:8,s:0.5+r()*0.8,f:0.5+r(),ph:r()*6};
}
function updateFx(dt){
  for(const r of S.ripples)r.t+=dt;S.ripples=S.ripples.filter(r=>r.t<1.7);
  for(const q of S.parts){q.vy+=q.g*dt;q.x+=q.vx*dt;q.y+=q.vy*dt;q.life-=dt;}S.parts=S.parts.filter(q=>q.life>0);
  for(let w=0;w<2;w++){
    const p=panels[w],cam=S.cams[w],A=S.amb[w],max=w?46:26;
    while(A.length<max)A.push(newAmb(w,p,cam));
    for(let i=A.length-1;i>=0;i--){const a=A[i];a.x+=a.vx*dt;a.y+=a.vy*dt+Math.sin(S.t*a.f+a.ph)*dt*3;a.life-=dt;
      if(a.life<=0||a.x<cam-30||a.x>cam+p.vw+30||a.y<p.top-20)A.splice(i,1);}
    S.flash[w]=Math.max(0,S.flash[w]-dt*1.6);S.swf[w]=Math.max(0,S.swf[w]-dt*3);
  }
}
function camTarget(i){const c=S.chars[i],p=panels[i];return clamp(c.x+c.w/2-p.vw/2+c.face*Math.min(70,p.vw*0.15),-60,Math.max(-60,LV.width-p.vw));}
function updateCams(dt,snap){for(let i=0;i<2;i++){const t=camTarget(i),c=S.chars[i];if(snap||c.snap){S.cams[i]=t;c.snap=false;}else S.cams[i]+=(t-S.cams[i])*Math.min(1,dt*3.2);}}

// ================= audio =================
let AC=null,master,windG,droneG,echoIn,noiseBuf,muted=false,A=null;
function initAudio(){
  try{
    AC=new (window.AudioContext||window.webkitAudioContext)();
    master=AC.createGain();master.gain.value=muted?0:0.9;master.connect(AC.destination);
    const len=AC.sampleRate*4,buf=AC.createBuffer(1,len,AC.sampleRate),d=buf.getChannelData(0);let last=0;
    for(let i=0;i<len;i++){last=(last+0.02*(Math.random()*2-1))/1.02;d[i]=last*3.5;}
    const src=AC.createBufferSource();src.buffer=buf;src.loop=true;
    const lp=AC.createBiquadFilter();lp.type='lowpass';lp.frequency.value=520;
    windG=AC.createGain();windG.gain.value=0;src.connect(lp);lp.connect(windG);windG.connect(master);src.start();
    const lfo=AC.createOscillator(),lfoG=AC.createGain();lfo.frequency.value=0.07;lfoG.gain.value=260;lfo.connect(lfoG);lfoG.connect(lp.frequency);lfo.start();
    droneG=AC.createGain();droneG.gain.value=0;droneG.connect(master);
    [[55,'sine',0.35],[82.41,'sine',0.3],[110.6,'triangle',0.12]].forEach(([f,t,g])=>{const o=AC.createOscillator(),gg=AC.createGain();o.type=t;o.frequency.value=f;gg.gain.value=g;o.connect(gg);gg.connect(droneG);o.start();});
    echoIn=AC.createGain();const dl=AC.createDelay(1);dl.delayTime.value=0.3;const fb=AC.createGain();fb.gain.value=0.38;const ef=AC.createBiquadFilter();ef.type='lowpass';ef.frequency.value=1800;const wet=AC.createGain();wet.gain.value=0.5;
    echoIn.connect(dl);dl.connect(ef);ef.connect(fb);fb.connect(dl);ef.connect(wet);wet.connect(master);
    noiseBuf=AC.createBuffer(1,AC.sampleRate,AC.sampleRate);const nd=noiseBuf.getChannelData(0);for(let i=0;i<nd.length;i++)nd[i]=Math.random()*2-1;
    A={AC,master,echoIn,noiseBuf,tone,noise};
  }catch(e){AC=null;A=null;}
}
function env(g,t,a,d,pk){g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(0.0002,pk),t+a);g.gain.exponentialRampToValueAtTime(0.0001,t+a+d);}
function tone(f0,f1,dur,type,pk,echo){const t=AC.currentTime,o=AC.createOscillator(),g=AC.createGain();o.type=type;o.frequency.setValueAtTime(f0,t);if(f1!==f0)o.frequency.exponentialRampToValueAtTime(f1,t+dur);env(g,t,0.012,dur,pk);o.connect(g);g.connect(master);if(echo)g.connect(echoIn);o.start(t);o.stop(t+dur+0.05);}
function noise(dur,ft,fq,pk){const t=AC.currentTime,s=AC.createBufferSource(),f=AC.createBiquadFilter(),g=AC.createGain();s.buffer=noiseBuf;f.type=ft;f.frequency.value=fq;env(g,t,0.008,dur,pk);s.connect(f);f.connect(g);g.connect(master);s.start(t);s.stop(t+dur+0.05);}
function sfx(n,vol){
  if(!AC||muted||AC.state!=='running')return;
  vol=vol==null?1:vol;
  try{
    if(TW.sfxExt[n]){TW.sfxExt[n](A,vol);return;}
    switch(n){
      case 'jump':noise(0.09,'bandpass',700,0.12*vol);break;
      case 'land':noise(0.07,'lowpass',260,0.16*vol);break;
      case 'push':noise(0.14,'bandpass',300,0.05*vol);break;
      case 'lever':tone(220,110,0.12,'square',0.045*vol);noise(0.05,'highpass',2200,0.07*vol);break;
      case 'rumble':noise(1.4,'lowpass',140,0.32*vol);tone(48,40,1.4,'sine',0.12*vol);break;
      case 'death':tone(260,50,0.7,'sawtooth',0.05*vol);noise(0.4,'lowpass',500,0.18*vol);break;
      case 'splash':noise(0.5,'highpass',900,0.16*vol);break;
      case 'callB':tone(392,390,0.5,'sine',0.08*vol,true);break;
      case 'callS':tone(784,780,0.6,'sine',0.06*vol,true);tone(1175,1170,0.5,'sine',0.025*vol,true);break;
      case 'switch':tone(180,520,0.22,'sine',0.045*vol);break;
      case 'ghost':tone(523,523,1.0,'sine',0.05*vol,true);tone(784,784,1.2,'sine',0.035*vol,true);break;
      case 'end':[261.6,329.6,392,523.3].forEach(f=>tone(f,f,3.5,'sine',0.045*vol,true));break;
      case 'bones':noise(0.06,'highpass',1800,0.09*vol);break;
      case 'grassRustle':noise(0.18,'highpass',2500,0.04*vol);break;
      case 'fail':tone(196,92,0.55,'sawtooth',0.07*vol,true);tone(207,98,0.55,'sawtooth',0.05*vol);noise(0.5,'lowpass',400,0.2*vol);break;
    }
  }catch(e){logErr('sfx:'+n,e);}
}
function sfxAt(n,world,x,base){
  if(!S||!panels[world])return;
  const p=panels[world],d=Math.abs(x-(S.cams[world]+p.vw/2));
  const v=clamp(1-d/650,0,1)*(world===S.active?1:0.6)*(base==null?1:base);
  if(v>0.03)sfx(n,v);
}
function setMusic(name,on){
  if(!S)return;on=!!on;if(!!S.musicOn[name]===on)return;S.musicOn[name]=on;
  if(!A||!TW.music[name])return;
  try{on?TW.music[name].start(A):TW.music[name].stop(A);}catch(e){logErr('music:'+name,e);}
}
function stopAllMusic(){if(!S)return;for(const k in S.musicOn)if(S.musicOn[k])setMusic(k,false);}
function ambience(){
  if(!AC)return;const t=AC.currentTime,dead=S.active===1,end=S.mode==='ending'||S.mode==='done';
  windG.gain.setTargetAtTime(end?0.03:dead?0.07:0.16,t,0.6);
  droneG.gain.setTargetAtTime(end?0.02:dead?0.07:0.03,t,0.6);
}

// ================= layout & controls =================
const cv=document.getElementById('cv'),ctx=cv.getContext('2d');
const ctl=document.getElementById('controls'),pad=document.getElementById('pad'),bJ=document.getElementById('bJump'),bA=document.getElementById('bAction'),bS=document.getElementById('bSwitch');
let VW=0,VH=0,GH=0,DPR=1,panels=[],ctrlH=0,touchSeen=false;
let touchUI=(window.matchMedia&&matchMedia('(pointer:coarse)').matches)||('ontouchstart' in window&&navigator.maxTouchPoints>0);
const safeB=()=>parseFloat(getComputedStyle(document.getElementById('probe')).paddingBottom)||0;
function place(el,o){el.style.width=o.w+'px';el.style.height=o.h+'px';el.style.bottom=o.b+'px';
  if(o.l!=null){el.style.left=o.l+'px';el.style.right='auto';}else{el.style.right=o.r+'px';el.style.left='auto';}}
function layout(){
  VW=window.innerWidth;VH=window.innerHeight;DPR=Math.min(window.devicePixelRatio||1,2);
  const sb=safeB();
  ctrlH=0;GH=VH;
  cv.width=Math.round(VW*DPR);cv.height=Math.round(GH*DPR);cv.style.width=VW+'px';cv.style.height=GH+'px';
  panels=[0,1].map(()=>{const p={x:0,y:0,w:VW,h:GH};p.scale=Math.min(p.h/H,p.w/560);p.vw=p.w/p.scale;p.vh=p.h/p.scale;p.top=H-p.vh;return p;});
  bS.style.display=S&&S.netMode==='online'?'none':'';
  ctl.style.display=touchUI?'block':'none';ctl.classList.toggle('bar',ctrlH>0);ctl.style.height=(ctrlH||VH)+'px';
  if(ctrlH){
    const inner=ctrlH-sb;
    place(pad,{l:14,b:sb+(inner-76)/2,w:Math.min(176,VW*0.44),h:76});
    place(bJ,{r:16,b:sb+(inner-84)/2,w:84,h:84});
    place(bA,{r:110,b:sb+12,w:60,h:60});
    place(bS,{r:114,b:sb+84,w:52,h:52});
  }else{
    place(pad,{l:18,b:sb+16,w:176,h:70});
    place(bJ,{r:18,b:sb+16,w:78,h:78});
    place(bA,{r:106,b:sb+12,w:58,h:58});
    place(bS,{r:24,b:sb+106,w:50,h:50});
  }
  if(S)updateCams(0,true);
  TW.emit('layout',{touchUI});
}
const KEYMAP={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'jump',KeyW:'jump',Space:'jump',KeyE:'action',KeyF:'action',Enter:'action',KeyQ:'switch',Tab:'switch',ShiftLeft:'switch',ShiftRight:'switch'};
addEventListener('keydown',e=>{
  if(S&&S.pz){if(e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();closePuzzle();}return;}
  const k=KEYMAP[e.code];
  if(touchUI&&!touchSeen&&k){touchUI=false;layout();}
  if(!k||!S||S.mode!=='play'||S.paused)return;
  if(e.target&&e.target.closest&&e.target.closest('button')&&(k==='jump'||k==='action'))return;
  e.preventDefault();
  if(!e.repeat){K[k]=true;latch[k]=true;}
},true);
addEventListener('keyup',e=>{const k=KEYMAP[e.code];if(k){K[k]=false;}});
addEventListener('blur',()=>{for(const k in K)K[k]=false;});
addEventListener('touchstart',()=>{touchSeen=true;if(!touchUI){touchUI=true;layout();}},{passive:true});
addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('dblclick',e=>e.preventDefault());
const padPtr=new Map();
function updPad(){const r=pad.getBoundingClientRect(),mid=r.left+r.width/2;T.left=false;T.right=false;
  for(const x of padPtr.values()){if(x<mid)T.left=true;else T.right=true;}
  document.getElementById('pl').classList.toggle('on',!!T.left);document.getElementById('pr').classList.toggle('on',!!T.right);}
pad.addEventListener('pointerdown',e=>{e.preventDefault();try{pad.setPointerCapture(e.pointerId);}catch(_){}padPtr.set(e.pointerId,e.clientX);updPad();});
pad.addEventListener('pointermove',e=>{if(padPtr.has(e.pointerId)){padPtr.set(e.pointerId,e.clientX);updPad();}});
['pointerup','pointercancel','lostpointercapture'].forEach(ev=>pad.addEventListener(ev,e=>{padPtr.delete(e.pointerId);updPad();}));
for(const b of [bJ,bA,bS]){
  const k=b.dataset.k,ptr=new Set();
  b.addEventListener('pointerdown',e=>{e.preventDefault();try{b.setPointerCapture(e.pointerId);}catch(_){}ptr.add(e.pointerId);T[k]=true;latch[k]=true;b.classList.add('on');});
  const up=e=>{ptr.delete(e.pointerId);if(!ptr.size){T[k]=false;b.classList.remove('on');}};
  b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);b.addEventListener('lostpointercapture',up);
}
let hintOn=false;
function setHint(v){if(v!==hintOn){hintOn=v;bS.classList.toggle('pulse',v);}}

// ================= drawing =================
const COL=[
  {sil:'#0b0a09',grass:'#0b0a09',tree:'#0b0a09',tree2:'#2a261f',fog:'188,172,140',hill:['#857b66','#5a5346','#302c25']},
  {sil:'#c2c7cf',grass:'#d3d7de',tree:'#959ca8',tree2:'#4b515c',fog:'58,66,80',hill:['#101319','#1d2129','#3a404b']}];
const PAL=[{world:0,sil:'#0b0a09',rim:'rgba(160,145,120,0.25)',eye:'#f3efe4',pale:'#c2c7cf',red:'#c8262d',blue:'#467dcd'},
           {world:1,sil:'#05060a',rim:'rgba(210,218,232,0.35)',eye:'#eef0f3',pale:'#c2c7cf',red:'#c8262d',blue:'#467dcd'}];
function hn(x,s){return Math.sin(x*0.0042+s)*0.5+Math.sin(x*0.0113+s*2.1)*0.3+Math.sin(x*0.029+s*3.7)*0.2;}
function hills(p,cam,f,base,amp,col,seed){ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(-10,H+80);
  for(let sx=-10;sx<=p.vw+12;sx+=10)ctx.lineTo(sx,base-amp*(0.5+0.5*hn(sx+cam*f,seed)));
  ctx.lineTo(p.vw+12,H+80);ctx.closePath();ctx.fill();}
function fog(x,w,col,y0,y1,a){const g=ctx.createLinearGradient(0,y0,0,y1);g.addColorStop(0,`rgba(${col},0)`);g.addColorStop(1,`rgba(${col},${a})`);ctx.fillStyle=g;ctx.fillRect(x,y0,w,y1-y0);}
function drawBackdrop(w,p,cam){
  const g=ctx.createLinearGradient(0,-160,0,200);
  if(w===0){g.addColorStop(0,'#13110f');g.addColorStop(0.5,'#3d382f');g.addColorStop(0.82,'#8c816b');g.addColorStop(1,'#a3967b');}
  else{g.addColorStop(0,'#000');g.addColorStop(0.55,'#06070a');g.addColorStop(0.85,'#181c24');g.addColorStop(1,'#252a34');}
  ctx.fillStyle=g;ctx.fillRect(-2,p.top-2,p.vw+4,p.vh+4);
  if(w===0){const sx=p.vw*0.3,sy=125,r=ctx.createRadialGradient(sx,sy,0,sx,sy,150);r.addColorStop(0,'rgba(240,226,192,0.55)');r.addColorStop(0.25,'rgba(230,212,175,0.22)');r.addColorStop(1,'rgba(230,212,175,0)');ctx.fillStyle=r;ctx.fillRect(sx-150,sy-150,300,300);}
  else{const mx=p.vw*0.72,my=62,r=ctx.createRadialGradient(mx,my,0,mx,my,120);r.addColorStop(0,'rgba(210,218,232,0.16)');r.addColorStop(1,'rgba(210,218,232,0)');ctx.fillStyle=r;ctx.fillRect(mx-120,my-120,240,240);ctx.fillStyle='rgba(225,230,240,0.13)';ctx.beginPath();ctx.arc(mx,my,17,0,7);ctx.fill();}
  const hc=COL[w].hill,fc=COL[w].fog,sd=(CH.num||1)*1.7;
  hills(p,cam,0.12,150,55,hc[0],(w?4.2:1.3)+sd);fog(-2,p.vw+4,fc,105,178,w?0.25:0.3);
  hills(p,cam,0.3,166,38,hc[1],(w?7.7:2.9)+sd);fog(-2,p.vw+4,fc,140,192,w?0.2:0.25);
  hills(p,cam,0.55,182,24,hc[2],(w?1.9:5.1)+sd);
}
function drawTree(w,t,x,p){
  const base=t.f===1?G+4:G-6,top=p.top-30,col=t.f===1?COL[w].tree:COL[w].tree2,hw=t.wd/2;
  const lx=y=>x+t.lean*clamp((base-y)/(base+100),0,3);
  ctx.fillStyle=col;ctx.strokeStyle=col;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(x-hw-4,base);ctx.quadraticCurveTo(x-hw,base-8,lx(base-30)-hw,base-30);ctx.lineTo(lx(top)-hw*0.6,top);ctx.lineTo(lx(top)+hw*0.6,top);ctx.lineTo(lx(base-30)+hw,base-30);ctx.quadraticCurveTo(x+hw,base-8,x+hw+4,base);ctx.closePath();ctx.fill();
  for(const b of t.br){if(b.y<p.top-10)continue;const tx=lx(b.y);ctx.lineWidth=Math.max(0.8,hw*0.5*(1-(base-b.y)/260));
    ctx.beginPath();ctx.moveTo(tx,b.y);ctx.quadraticCurveTo(tx+b.d*b.l*0.55,b.y-b.l*0.05,tx+b.d*b.l,b.y-b.l*b.c);
    ctx.moveTo(tx+b.d*b.l*0.6,b.y-b.l*0.12);ctx.lineTo(tx+b.d*b.l*0.8,b.y-b.l*(0.35+b.c*0.4));ctx.stroke();}
}
function drawTrees(w,p,cam,f){for(const t of DEC[w].trees){if(t.f!==f)continue;const x=t.x+cam*(1-t.f);if(x<cam-90||x>cam+p.vw+90)continue;drawTree(w,t,x,p);}}
function rr(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.lineTo(x+w,y+h);ctx.lineTo(x,y+h);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function drawBlock(w,b){
  const C=COL[w];ctx.fillStyle=C.sil;
  if(b.k==='cliff'){ctx.fillRect(b.x,b.y,b.w,b.h);const L=b.x<0,ex=L?b.x+b.w:b.x;ctx.beginPath();ctx.moveTo(ex,b.y);
    for(let y=b.y;y<=G+60;y+=9)ctx.lineTo(ex+(L?1:-1)*(4+Math.abs(Math.sin(y*0.37))*9),y);ctx.lineTo(ex,G+60);ctx.closePath();ctx.fill();}
  else if(b.k==='rock'){if(w===1)ctx.fillStyle='#b4bac4';rr(b.x,b.y,b.w,b.h+4,Math.min(10,b.h*0.6,b.w/2));ctx.fill();}
  else if(b.k==='log'){if(w===1)ctx.fillStyle='#b4bac4';rr(b.x,b.y,b.w,b.h+2,Math.min(b.h/2,6));ctx.fill();ctx.strokeStyle=w?'rgba(20,24,30,0.3)':'rgba(160,145,118,0.22)';ctx.lineWidth=0.8;ctx.beginPath();for(let x=b.x+8;x<b.x+b.w-4;x+=14){ctx.moveTo(x,b.y+2);ctx.lineTo(x+3,b.y+b.h-1);}ctx.stroke();}
  else if(b.k==='stone'){ctx.fillStyle=w?'#b4bac4':C.sil;rr(b.x,b.y,b.w,b.h+2,b.w/2-1);ctx.fill();if(w){ctx.strokeStyle='rgba(20,24,30,0.35)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(b.x+b.w/2,b.y+6);ctx.lineTo(b.x+b.w/2,b.y+16);ctx.moveTo(b.x+b.w/2-4,b.y+10);ctx.lineTo(b.x+b.w/2+4,b.y+10);ctx.stroke();}}
  else{ // ledge
    ctx.fillStyle=w?'#b8bec8':C.sil;ctx.fillRect(b.x,b.y,b.w,b.h);
    if(w){ctx.fillStyle='#e1e4ea';ctx.fillRect(b.x,b.y,b.w,1.2);
      ctx.strokeStyle='rgba(15,18,24,0.3)';ctx.lineWidth=0.9;ctx.beginPath();
      for(let x=b.x+20;x<b.x+b.w-15;x+=67){const y=b.y+18+((x*7)%40);ctx.moveTo(x,y);ctx.lineTo(x+7,y+9);ctx.lineTo(x+3,y+18);ctx.lineTo(x+10,y+27);}ctx.stroke();}
    ctx.strokeStyle=C.grass;ctx.lineWidth=0.7;ctx.beginPath();for(let x=b.x+3;x<b.x+b.w-2;x+=5){ctx.moveTo(x,b.y);ctx.lineTo(x+1,b.y-2-Math.abs(Math.sin(x))*3);}ctx.stroke();}
}
function drawTerrain(w,p,cam){
  const C=COL[w],W=LV.worlds[w],x0=cam-30,x1=cam+p.vw+30;
  for(const [a,b] of W.gaps){if(b<x0||a>x1)continue;if(W.water.some(z=>z.x0<=a+1&&z.x1>=b-1))continue;const g=ctx.createLinearGradient(0,G-12,0,H);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,0.9)');ctx.fillStyle=g;ctx.fillRect(a,G-12,b-a,H+80-G);}
  for(const z of W.water){if(z.x1<x0||z.x0>x1)continue;const surf=G+16;
    ctx.fillStyle='#12110e';ctx.fillRect(z.x0,surf,z.x1-z.x0,H+80-surf);
    ctx.strokeStyle='rgba(215,200,165,0.35)';ctx.lineWidth=0.8;ctx.beginPath();
    for(let x=z.x0;x<=z.x1;x+=4){const y=surf+Math.sin(x*0.09+S.t*2.2)*0.7;x===z.x0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.stroke();
    ctx.strokeStyle='rgba(215,200,165,0.12)';ctx.beginPath();for(let x=z.x0+10;x<z.x1;x+=23){const y=surf+8+Math.sin(x+S.t)*1.5;ctx.moveTo(x,y);ctx.lineTo(x+9,y);}ctx.stroke();
    ctx.strokeStyle=C.sil;ctx.lineWidth=0.9;ctx.beginPath();
    for(const [x,h] of [[z.x0-14,13],[z.x0-8,18],[z.x0-3,10],[z.x1+3,15],[z.x1+9,11],[z.x1+15,17],[z.x0+10,8],[z.x1-10,9]]){const s=Math.sin(S.t*1.3+x)*1.2;ctx.moveTo(x,x>z.x0&&x<z.x1?surf:G);ctx.quadraticCurveTo(x+s*0.5,G-h*0.5,x+s,G-h);}ctx.stroke();}
  ctx.fillStyle=C.sil;for(const g of W.ground){if(g[1]<x0||g[0]>x1)continue;ctx.fillRect(g[0],G,g[1]-g[0],H+80-G);}
  if(w===1){const g=ctx.createLinearGradient(0,G,0,H+20);g.addColorStop(0,'rgba(8,10,14,0)');g.addColorStop(1,'rgba(8,10,14,0.55)');ctx.fillStyle=g;for(const s of W.ground)ctx.fillRect(s[0],G,s[1]-s[0],H+80-G);
    ctx.fillStyle='#e2e5ea';for(const s of W.ground)ctx.fillRect(s[0],G,s[1]-s[0],1);
    for(const z of W.ice){ctx.fillStyle='#d3dae4';ctx.fillRect(z.x0,G,z.x1-z.x0,9);ctx.strokeStyle='rgba(40,48,62,0.45)';ctx.lineWidth=0.7;ctx.beginPath();
      for(let x=z.x0+12;x<z.x1-30;x+=60){ctx.moveTo(x,G+2);ctx.lineTo(x+18,G+6);ctx.lineTo(x+33,G+3);ctx.moveTo(x+18,G+6);ctx.lineTo(x+24,G+11);}ctx.stroke();}}
  ctx.strokeStyle=C.grass;ctx.lineWidth=w?0.7:0.9;ctx.beginPath();
  for(const b of DEC[w].grass){if(b[0]<x0||b[0]>x1)continue;if(w===1&&inZone(b[0],W.ice))continue;ctx.moveTo(b[0],G+0.5);ctx.lineTo(b[0]+b[2],G-b[1]);}ctx.stroke();
  for(const z of W.bones){if(z.x1<x0||z.x0>x1)continue;
    if(TW.envArt.bones){try{TW.envArt.bones(ctx,z,S.t,PAL[w]);}catch(e){logErr('art:bones',e);}}
    else{ctx.strokeStyle='rgba(30,34,42,0.65)';ctx.lineWidth=1.2;ctx.beginPath();for(let x=z.x0+4;x<z.x1-4;x+=9){const a=Math.sin(x*1.7)*0.6;ctx.moveTo(x,G-1);ctx.lineTo(x+6*Math.cos(a),G-1-3*Math.abs(Math.sin(a)));}ctx.stroke();}}
  for(const b of W.blocks)if(b.x+b.w>=x0&&b.x<=x1)drawBlock(w,b);
}
function drawGrass(w,p,cam,front){
  for(const z of LV.worlds[w].grass){if(z.x1<cam-60||z.x0>cam+p.vw+60)continue;
    if(TW.envArt.grass){try{TW.envArt.grass(ctx,z,S.t,front,PAL[w]);}catch(e){logErr('art:grass',e);}continue;}
    ctx.fillStyle=w?'#d3d7de':'#0b0a09';
    for(let x=z.x0+(front?3:0);x<z.x1;x+=front?7:5){const h=(front?22:34)+Math.sin(x*3.1)*8,sw=Math.sin(S.t*1.4+x*0.3)*2.5;
      ctx.beginPath();ctx.moveTo(x-1.6,G+1);ctx.quadraticCurveTo(x+sw*0.4,G-h*0.5,x+sw,G-h);ctx.quadraticCurveTo(x+1+sw*0.4,G-h*0.5,x+1.6,G+1);ctx.fill();}}
}
function drawDecor(w){
  const sil=COL[w].sil;ctx.fillStyle=sil;ctx.strokeStyle=sil;
  for(const d of LV.worlds[w].decor){
    if(d.k==='horse'){const x=d.x;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x-17,G-2);ctx.quadraticCurveTo(x+1,G+3,x+19,G-2);ctx.stroke();
      ctx.beginPath();ctx.ellipse(x+1,G-12,9,4,0,0,7);ctx.fill();ctx.beginPath();ctx.moveTo(x+8,G-14);ctx.lineTo(x+13,G-24);ctx.lineTo(x+17,G-22);ctx.lineTo(x+12,G-12);ctx.fill();
      ctx.beginPath();ctx.moveTo(x-5,G-10);ctx.lineTo(x-7,G-1);ctx.moveTo(x+7,G-10);ctx.lineTo(x+9,G-1);ctx.moveTo(x-8,G-13);ctx.lineTo(x-13,G-8);ctx.stroke();}
    else if(d.k==='yurt'){const x=d.x;ctx.beginPath();ctx.moveTo(x-26,G);ctx.lineTo(x-26,G-14);ctx.quadraticCurveTo(x,G-34,x+26,G-14);ctx.lineTo(x+26,G);ctx.fill();ctx.fillRect(x-2,G-34,4,6);}
    else if(d.k==='boot'){const x=d.x;ctx.beginPath();ctx.moveTo(x-6,G);ctx.lineTo(x-5,G-11);ctx.lineTo(x+1,G-12);ctx.lineTo(x+1,G-5);ctx.quadraticCurveTo(x+8,G-5,x+10,G-1);ctx.lineTo(x+10,G);ctx.fill();
      ctx.fillStyle=w?'#e6e9ee':'rgba(235,228,210,0.55)';ctx.fillRect(x-7,G-1.2,18,1.6);}
    else if(d.k==='ribbon'){const x=d.x,y=d.y!=null?d.y:G-1;ctx.strokeStyle='#c8262d';ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+4,y-3+Math.sin(S.t*3)*1.5,x+9,y-1);ctx.moveTo(x,y);ctx.quadraticCurveTo(x-3,y-4,x-7,y-2+Math.sin(S.t*3+1)*1.5);ctx.stroke();}
    else if(d.k==='skull'){const x=d.x;ctx.fillStyle=w?'#e6e9ee':sil;ctx.beginPath();ctx.ellipse(x,G-3,4,3.2,0,0,7);ctx.fill();ctx.fillStyle=w?'#2a2e36':'#3a352d';ctx.fillRect(x-2,G-4,1.2,1.2);ctx.fillRect(x+0.8,G-4,1.2,1.2);}
  }
}
function drawOvoo(w,x){
  const col=w?'#c9ced6':'#0b0a09';
  if(S.stage>=(CH.stages||[]).length&&S.mode!=='title'){const k=0.6+0.4*Math.sin(S.t*2),r=ctx.createRadialGradient(x,G-40,0,x,G-40,70);r.addColorStop(0,`rgba(${w?'220,228,245':'250,238,210'},${0.3*k})`);r.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=r;ctx.fillRect(x-70,G-110,140,140);}
  ctx.fillStyle=col;let y=G;
  for(const [rw,rh] of [[28,7],[23,7],[18,6.5],[13,6],[8,5.5]]){ctx.beginPath();ctx.ellipse(x,y-rh/2,rw,rh/2+1,0,0,7);ctx.fill();y-=rh-0.6;}
  ctx.fillRect(x-1,y-70,2.2,72);
  ctx.strokeStyle=col;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(x,y-6);ctx.lineTo(x-12,y-32);ctx.moveTo(x,y-6);ctx.lineTo(x+11,y-29);ctx.stroke();
  if(w===0){ctx.lineWidth=2.2;for(const [dy,al] of [[0,0.95],[7,0.7]]){ctx.strokeStyle=`rgba(70,125,205,${al})`;ctx.beginPath();const px=x+1,py=y-64+dy;ctx.moveTo(px,py);
    for(let i=1;i<=10;i++){const t=i/10;ctx.lineTo(px+t*28,py+t*9+Math.sin(S.t*4-t*5+dy)*3*t);}ctx.stroke();}}
}
function drawLever(o,w,near){
  const a=-0.65+ease(o.p)*1.3,ex=o.x+Math.sin(a)*15,ey=o.y-3-Math.cos(a)*15;
  const base=w?'#cfd4dc':'#0b0a09',stick=w?'#dde1e8':'#0b0a09';
  ctx.fillStyle=base;ctx.beginPath();ctx.ellipse(o.x,o.y-1.5,7,3.2,0,Math.PI,0);ctx.fill();
  ctx.strokeStyle=stick;ctx.lineWidth=2;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(o.x,o.y-3);ctx.lineTo(ex,ey);ctx.stroke();
  ctx.fillStyle=o.on?'#c8262d':(w?'#eef0f3':'#3a352d');ctx.beginPath();ctx.arc(ex,ey,2.6,0,7);ctx.fill();
  if(near&&!o.on){const k=0.5+0.5*Math.sin(S.t*5);ctx.strokeStyle=w?`rgba(238,240,245,${0.25+0.35*k})`:`rgba(208,52,58,${0.3+0.35*k})`;ctx.lineWidth=1;ctx.beginPath();ctx.arc(o.x,o.y-12,15+k*2,0,7);ctx.stroke();}
}
const DRAW={
  lever(o,w){const c=S.chars[w],cx=c.x+c.w/2;drawLever(o,w,c.dying<=0&&Math.abs(cx-o.x)<16&&Math.abs(c.y+c.h-o.y)<6);},
  drawbridge(o,w){
    const L=o.x1-o.x0,e=ease(o.p),a=-Math.PI/2-e*Math.PI/2;ctx.fillStyle=COL[w].sil;
    ctx.fillRect(o.x1+3,G-122,5,122);
    ctx.save();ctx.translate(o.x1,G);ctx.rotate(a);ctx.fillRect(0,-7,L,7);ctx.fillStyle='rgba(160,145,120,0.2)';for(let i=20;i<L;i+=20)ctx.fillRect(i,-7,0.8,7);ctx.restore();
    const tx=o.x1+Math.cos(a)*(L-4),ty=G+Math.sin(a)*(L-4);ctx.strokeStyle=COL[w].sil;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(o.x1+5,G-120);ctx.quadraticCurveTo((o.x1+5+tx)/2,(G-120+ty)/2+12*e,tx,ty-3);ctx.stroke();},
  gate(o,w){
    const r=SOLIDS.gate(o),x=o.x,top=r.y+150*ease(o.p)-10;ctx.fillStyle=COL[w].sil;
    ctx.fillRect(x-6,top,4,G-top);ctx.fillRect(x+16,top,4,G-top);ctx.fillRect(x-11,top-5,36,6);
    ctx.save();ctx.beginPath();ctx.rect(x-3,top+1,22,G-top+5);ctx.clip();
    for(const bx of [x+1,x+6,x+11]){ctx.fillRect(bx,r.y,2.4,r.h);ctx.beginPath();ctx.moveTo(bx-0.6,r.y+r.h);ctx.lineTo(bx+1.2,r.y+r.h+4);ctx.lineTo(bx+3,r.y+r.h);ctx.fill();}
    ctx.fillRect(x-2,r.y+20,20,2.5);ctx.fillRect(x-2,r.y+r.h-30,20,2.5);ctx.restore();},
  ropebridge(o,w){
    const e=ease(o.p),x0=o.x0,x1=o.x1,L=x1-x0,mid=(x0+x1)/2;ctx.fillStyle=COL[w].sil;ctx.strokeStyle=COL[w].sil;ctx.lineWidth=1;
    ctx.fillRect(x0-7,G-26,4,26);ctx.fillRect(x1+3,G-26,4,26);
    if(e<=0){ctx.beginPath();ctx.moveTo(x0-3,G-24);ctx.quadraticCurveTo(x0+3,G+10,x0-1+Math.sin(S.t*0.9)*2,G+48);ctx.moveTo(x1+3,G-24);ctx.quadraticCurveTo(x1-3,G+8,x1+1+Math.sin(S.t*0.8+1)*2,G+40);ctx.stroke();}
    else{ctx.globalAlpha=Math.min(1,e*2);ctx.beginPath();ctx.moveTo(x0-3,G-24);ctx.quadraticCurveTo(mid,G-8,x1+3,G-24);ctx.moveTo(x0-3,G-1);ctx.quadraticCurveTo(mid,G+7,x1+3,G-1);ctx.stroke();
      const n=Math.max(4,Math.round(L/10)),vis=Math.floor(e*n+1e-3);ctx.beginPath();
      for(let i=0;i<vis;i++){const t=(i+0.5)/n,x=x0+t*L,y=G+Math.sin(Math.PI*t)*3.2-1;ctx.fillRect(x-4,y,8,3);ctx.moveTo(x,y);ctx.lineTo(x,G-24+Math.sin(Math.PI*t)*8);}ctx.stroke();ctx.globalAlpha=1;}},
  plate(o,w){
    const py=o.held?G-1.2:G-3.2;ctx.fillStyle=w?'#9aa1ad':'#14120f';ctx.beginPath();ctx.moveTo(o.x0-3,G);ctx.lineTo(o.x0+1,py);ctx.lineTo(o.x1-1,py);ctx.lineTo(o.x1+3,G);ctx.fill();
    const ga=o.held?1:0;ctx.strokeStyle=`rgba(150,190,255,${0.22+0.6*ga})`;ctx.lineWidth=0.9;ctx.beginPath();for(let x=o.x0+6;x<o.x1-6;x+=9.5){ctx.moveTo(x,py-0.6);ctx.lineTo(x+4,py-0.6);}ctx.stroke();
    if(o.held){const c=(o.x0+o.x1)/2,rg=ctx.createRadialGradient(c,G-4,0,c,G-4,40);rg.addColorStop(0,'rgba(150,190,255,0.35)');rg.addColorStop(1,'rgba(150,190,255,0)');ctx.fillStyle=rg;ctx.fillRect(c-40,G-44,80,48);}},
  ghostbridge(o,w){
    const L=o.x1-o.x0;ctx.strokeStyle=`rgba(220,228,242,${0.08+0.05*Math.sin(S.t*1.5)})`;ctx.setLineDash([3,5]);ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(o.x0,G+1);ctx.lineTo(o.x1,G+1);ctx.stroke();ctx.setLineDash([]);
    const ga=o.a;if(ga>0.02){const n=Math.round(L/10);for(let i=0;i<n;i++){ctx.fillStyle=`rgba(232,238,250,${ga*(0.55+0.35*Math.sin(S.t*3+i*0.9))})`;ctx.fillRect(o.x0+1+i*10,G,8,3);}
      const g=ctx.createLinearGradient(0,G-22,0,G+6);g.addColorStop(0,'rgba(200,215,245,0)');g.addColorStop(1,`rgba(200,215,245,${0.2*ga})`);ctx.fillStyle=g;ctx.fillRect(o.x0,G-22,L,28);}},
  puzzle(o,w){
    const K=TW.puzzles&&TW.puzzles[o.kind];
    if(K&&K.drawDevice){try{K.drawDevice(ctx,o,S.t,PAL[w],!!o.on);}catch(e){logErr('pz.draw:'+o.kind,e);}}
    else{ctx.fillStyle=w?'#b4bac4':'#0b0a09';rr(o.x-11,G-30,22,31,5);ctx.fill();ctx.strokeStyle=o.on?'rgba(150,190,255,0.9)':(w?'rgba(20,24,30,0.5)':'rgba(160,145,118,0.5)');ctx.lineWidth=1;ctx.strokeRect(o.x-6,G-24,12,12);}
    nearRing(o,w,!o.on&&o.cool<=0,24);},
  clue(o,w){
    const p=S.obj[o.puzzle],K=p&&TW.puzzles&&TW.puzzles[p.kind];
    if(K&&K.drawClue){try{K.drawClue(ctx,o,pzData(p),S.t,PAL[w]);}catch(e){logErr('pz.clue:'+p.kind,e);}}
    else{ctx.fillStyle=w?'#c9ced6':'#0b0a09';ctx.beginPath();ctx.moveTo(o.x-9,G);ctx.lineTo(o.x-7,G-26);ctx.quadraticCurveTo(o.x,G-33,o.x+7,G-26);ctx.lineTo(o.x+9,G);ctx.fill();}
    nearRing(o,w,true,26);},
  crate(o,w){
    const ca=o.respawn>0?o.respawn/0.8:o.fade;if(ca<=0)return;ctx.globalAlpha=ca;
    if(w===0){ctx.fillStyle='#100e0c';ctx.fillRect(o.x,o.y,o.w,o.h);ctx.strokeStyle='rgba(160,145,118,0.24)';ctx.lineWidth=1;ctx.strokeRect(o.x+2.5,o.y+2.5,o.w-5,o.h-5);
      ctx.beginPath();ctx.moveTo(o.x+3,o.y+3);ctx.lineTo(o.x+o.w-3,o.y+o.h-3);ctx.moveTo(o.x+o.w-3,o.y+3);ctx.lineTo(o.x+3,o.y+o.h-3);ctx.stroke();}
    else{ctx.fillStyle='rgba(4,5,8,0.94)';ctx.fillRect(o.x,o.y,o.w,o.h);ctx.strokeStyle='rgba(200,208,222,0.3)';ctx.lineWidth=0.8;ctx.strokeRect(o.x+0.5,o.y+0.5,o.w-1,o.h-1);
      ctx.fillStyle='rgba(4,5,8,0.8)';for(let i=0;i<5;i++){const ph=(S.t*0.6+i*0.2)%1,x=o.x+4+((i*37)%32)+Math.sin(S.t*2+i)*2;ctx.globalAlpha=ca*(1-ph)*0.8;ctx.beginPath();ctx.arc(x,o.y-ph*16,2.4*(1-ph*0.5),0,7);ctx.fill();}}
    ctx.globalAlpha=1;}
};
function nearRing(o,w,show,r){
  if(!show||S.mode!=='play')return;const c=S.chars[w];if(c.dying>0||Math.abs(c.x+c.w/2-o.x)>r)return;
  const k=0.5+0.5*Math.sin(S.t*5);ctx.strokeStyle=w?`rgba(238,240,245,${0.25+0.35*k})`:`rgba(208,52,58,${0.3+0.35*k})`;ctx.lineWidth=1;ctx.beginPath();ctx.arc(o.x,G-40,9+k*2,0,7);ctx.stroke();
}
function drawObjects(w){
  for(const o of S.objList){
    if(o.type==='crate'){DRAW.crate(o,w);continue;}
    if(o.world===w&&DRAW[o.type])DRAW[o.type](o,w);
    if(o.type==='plate'&&o.held)for(const t of targetsOf(o))if(t.world===w&&w!==o.world){ctx.strokeStyle='rgba(150,190,255,0.6)';ctx.lineWidth=0.8;ctx.beginPath();ctx.ellipse((o.x0+o.x1)/2,G+3,22,2.5,0,0,7);ctx.stroke();}
  }
  if(CH.exit)drawOvoo(w,CH.exit.x);
}
function drawEnemies(w,p,cam){
  const list=[];
  for(const e of S.enemies){if(!e.alive)continue;if(e.seenBy==='other'){if(e.world!==w)list.push(e);}else if(e.world===w)list.push(e);}
  if(S.netMode==='online'&&S.ghosts)for(const g of S.ghosts)list.push(g);
  for(const e of list){if(e.x+e.w<cam-120||e.x>cam+p.vw+120)continue;
    if(e.seenBy==='other'||(S.ghosts&&S.ghosts.indexOf(e)>=0)){ctx.save();ctx.globalAlpha=0.85;const art=TW.enemyArt[e.type];
      if(art){try{art(ctx,e,S.t,PAL[1]);}catch(er){logErr('art:'+e.type,er);}}else{ctx.fillStyle='#05060a';ctx.fillRect(e.x,e.y,e.w,e.h);}ctx.restore();continue;}
    if(e.type==='raven'){if(TW.envArt.perch){try{TW.envArt.perch(ctx,e.def.x,e.def.y,PAL[w]);}catch(er){logErr('art:perch',er);}}
      else{ctx.strokeStyle=COL[w].sil;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(e.def.x,G+2);ctx.lineTo(e.def.x+2,e.def.y);ctx.lineTo(e.def.x+12,e.def.y-4);ctx.stroke();}}
    const art=TW.enemyArt[e.type];
    if(art){try{art(ctx,e,S.t,PAL[w]);}catch(er){logErr('art:'+e.type,er);}}
    else{ctx.fillStyle=PAL[w].sil;ctx.fillRect(e.x,e.y,e.w,e.h);ctx.fillStyle=PAL[w].eye;ctx.fillRect(e.face>0?e.x+e.w-5:e.x+3,e.y+3,2,2);}
  }
}
function drawBrother(c,alpha,col,eyes){
  ctx.save();ctx.globalAlpha=alpha;ctx.translate(c.x+c.w/2,c.y+c.h);ctx.scale(c.face,1);
  ctx.fillStyle=col;ctx.strokeStyle=col;ctx.lineCap='round';ctx.lineJoin='round';
  const mv=c.onGround&&Math.abs(c.vx)>8,air=!c.onGround,s=mv?Math.sin(c.walk):0;
  if(c.pushing)ctx.rotate(0.22);else if(mv)ctx.rotate(0.05);
  if(c.hidden){ctx.translate(0,3);ctx.scale(1,0.9);}
  ctx.lineWidth=3;ctx.beginPath();
  if(air){ctx.moveTo(-1,-9);ctx.lineTo(-4,-5);ctx.lineTo(-2.5,-1);ctx.moveTo(1.5,-9);ctx.lineTo(4,-6);ctx.lineTo(5,-2);}
  else{const a=s*5;ctx.moveTo(-1,-9);ctx.lineTo(-1+a*0.45,-4.5-Math.max(0,s)*1.2);ctx.lineTo(-1+a,-Math.max(0,s));ctx.moveTo(1,-9);ctx.lineTo(1-a*0.45,-4.5-Math.max(0,-s)*1.2);ctx.lineTo(1-a,-Math.max(0,-s));}
  ctx.stroke();
  ctx.beginPath();ctx.moveTo(-4.6,-9);ctx.lineTo(-4.2,-20);ctx.quadraticCurveTo(0,-23.5,4.2,-20);ctx.lineTo(4.6,-9);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.arc(0.6,-25.8,5.6,0,7);ctx.fill();
  ctx.beginPath();ctx.moveTo(-4.5,-27);ctx.lineTo(-8,-29.5);ctx.lineTo(-4,-30);ctx.lineTo(-6,-33);ctx.lineTo(-0.5,-31.6);ctx.lineTo(1,-32.5);ctx.lineTo(2.5,-31);ctx.closePath();ctx.fill();
  ctx.lineWidth=2.3;ctx.beginPath();ctx.moveTo(0.5,-19);
  if(c.pushing){ctx.lineTo(5,-17);ctx.lineTo(8.5,-15.5);}
  else if(c.reach>0){const r=c.reach;ctx.lineTo(3+r*2,-15+r*3);ctx.lineTo(4+r*5,-11+r*5);}
  else if(air){ctx.lineTo(3,-22);ctx.lineTo(5.5,-25);}
  else{ctx.lineTo(-s*2.5,-14.5);ctx.lineTo(-s*4,-11);}
  ctx.stroke();
  if(eyes){ctx.fillStyle=c.hidden?'rgba(243,239,228,0.55)':'#f3efe4';const ey=-26.4-c.look*1.1;ctx.beginPath();ctx.arc(2.9,ey,1.15,0,7);ctx.arc(5.2,ey+0.1,0.95,0,7);ctx.fill();}
  ctx.restore();
}
function drawSister(c,alpha,echo){
  ctx.save();ctx.globalAlpha=alpha;ctx.translate(c.x+c.w/2,c.y+c.h);ctx.scale(c.face,1);
  ctx.fillStyle='#eef0f3';ctx.strokeStyle='#eef0f3';ctx.lineCap='round';ctx.lineJoin='round';
  if(!echo){ctx.shadowColor='rgba(235,240,255,0.55)';ctx.shadowBlur=7;}
  const mv=c.onGround&&Math.abs(c.vx)>8,air=!c.onGround,s=mv?Math.sin(c.walk):0;
  if(mv)ctx.rotate(0.04);
  ctx.lineWidth=2.3;ctx.beginPath();
  if(air){ctx.moveTo(-1.3,-6);ctx.lineTo(-3,-1.5);ctx.moveTo(1.3,-6);ctx.lineTo(3.5,-3);}
  else{ctx.moveTo(-1.3,-6);ctx.lineTo(-1.3+s*4,-Math.max(0,s)*0.8);ctx.moveTo(1.3,-6);ctx.lineTo(1.3-s*4,-Math.max(0,-s)*0.8);}
  ctx.stroke();
  ctx.beginPath();ctx.moveTo(-2.6,-15.5);ctx.lineTo(air?-7.2:-6.2,-5.5);ctx.quadraticCurveTo(0,-4.2,air?7.2:6.2,-5.5);ctx.lineTo(2.6,-15.5);ctx.quadraticCurveTo(0,-17.2,-2.6,-15.5);ctx.fill();
  ctx.beginPath();ctx.arc(0.5,-19.6,4.9,0,7);ctx.fill();
  const sw=Math.sin(S.t*3)*0.6+(mv?Math.sin(c.walk)*0.6:0);
  ctx.beginPath();ctx.moveTo(-3.2,-22);ctx.quadraticCurveTo(-8,-21.5+sw,-7.5,-16.5+sw);ctx.quadraticCurveTo(-5.5,-19,-3,-19.5);ctx.fill();
  ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0.3,-14);
  if(c.reach>0){const r=c.reach;ctx.lineTo(2+r,-17-r*4);ctx.lineTo(3+r*1.5,-20-r*5);}
  else if(air){ctx.lineTo(3,-17);ctx.lineTo(5,-19);}
  else{ctx.lineTo(-s*2,-10.5);ctx.lineTo(-s*3,-8);}
  ctx.stroke();ctx.shadowBlur=0;
  ctx.globalAlpha=Math.min(1,alpha*(echo?2.6:1));
  ctx.fillStyle='#c8262d';ctx.beginPath();ctx.moveTo(-3.6,-22.6);ctx.lineTo(-6.2,-25.2);ctx.lineTo(-6.6,-21.8);ctx.closePath();ctx.moveTo(-3.6,-22.6);ctx.lineTo(-1.6,-25.6);ctx.lineTo(-0.6,-23);ctx.closePath();ctx.fill();
  const fl=S.t*7,sp=Math.min(1,Math.abs(c.vx)/100);ctx.strokeStyle='#c8262d';ctx.lineWidth=1.3;ctx.beginPath();
  ctx.moveTo(-3.6,-22.6);ctx.quadraticCurveTo(-7-sp*3,-21+Math.sin(fl)*1.4,-10-sp*5,-20.5+Math.sin(fl+1.3)*2);
  ctx.moveTo(-3.6,-22.6);ctx.quadraticCurveTo(-6.5-sp*3,-19.5+Math.sin(fl+0.7)*1.2,-8.5-sp*4,-17.5+Math.sin(fl+2)*1.6);ctx.stroke();
  if(!echo){ctx.globalAlpha=alpha;ctx.fillStyle='#0c0d10';const ey=-20.1-c.look*1.0;ctx.beginPath();ctx.arc(2.6,ey,0.95,0,7);ctx.arc(4.5,ey,0.85,0,7);ctx.fill();}
  ctx.restore();
}
function drawChars(w){
  const [b,s]=S.chars,va=c=>c.dying>0?0:1-c.spawn;
  const meet=S.ending&&S.ending.kind==='meet'?clamp((S.ending.t-1.6)/1.2,0,1):0;
  if(w===0){if(meet>0)drawSister(s,0.5*meet,true);if(va(b)>0)drawBrother(b,va(b),'#0a0908',true);}
  else{if(meet>0)drawBrother(b,0.55*meet,'#8fb2ec',false);if(va(s)>0)drawSister(s,va(s),false);}
}
function drawDark(w,p,cam){
  const Z=LV.worlds[w].dark;if(!Z.length)return;const c=S.chars[w],cx=c.x+c.w/2,cy=c.y+c.h*0.5,R=34;
  const top=p.top-20,hh=p.vh+120;
  for(const z of Z){if(z.x1<cam-60||z.x0>cam+p.vw+60)continue;
    ctx.save();
    for(const [ex,dir] of [[z.x0,-1],[z.x1,1]]){const g=ctx.createLinearGradient(ex,0,ex+dir*36,0);g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(Math.min(ex,ex+dir*36),top,36,hh);}
    const inside=c.dying<=0&&cx>z.x0-R&&cx<z.x1+R;
    ctx.beginPath();ctx.rect(z.x0,top,z.x1-z.x0,hh);if(inside)ctx.arc(cx,cy,R,0,Math.PI*2,true);
    ctx.fillStyle='#000';ctx.fill('evenodd');
    if(inside){ctx.beginPath();ctx.rect(z.x0,top,z.x1-z.x0,hh);ctx.clip();
      const g=ctx.createRadialGradient(cx,cy,R*0.4,cx,cy,R);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,1)');ctx.fillStyle=g;ctx.fillRect(cx-R,cy-R,R*2,R*2);}
    ctx.restore();}
}
function drawGhostMap(w,p,cam){
  const o=1-w,W=LV.worlds[o],Z=W.dark;if(!Z.length)return;
  const col=w===1?'52,98,190':'150,190,255',pul=0.75+0.2*Math.sin(S.t*2);
  for(const z of Z){if(z.x1<cam-60||z.x0>cam+p.vw+60)continue;
    ctx.save();ctx.beginPath();ctx.rect(z.x0-2,p.top-20,z.x1-z.x0+4,p.vh+120);ctx.clip();
    ctx.fillStyle=`rgba(${col},0.07)`;ctx.fillRect(z.x0,G-110,z.x1-z.x0,130);
    ctx.fillStyle=`rgba(${col},0.35)`;for(const [ga,gb] of W.gaps){const a=Math.max(ga,z.x0),b=Math.min(gb,z.x1);if(b>a)ctx.fillRect(a,G,b-a,28);}
    ctx.strokeStyle=`rgba(${col},${pul})`;ctx.lineWidth=1.8;ctx.setLineDash([]);ctx.beginPath();
    for(const g of W.ground){const a=Math.max(g[0],z.x0),b=Math.min(g[1],z.x1);if(b<=a)continue;ctx.moveTo(a,G-0.5);ctx.lineTo(b,G-0.5);
      if(g[0]>=z.x0&&g[0]<=z.x1){ctx.moveTo(g[0],G-0.5);ctx.lineTo(g[0],G+28);}if(g[1]>=z.x0&&g[1]<=z.x1){ctx.moveTo(g[1],G-0.5);ctx.lineTo(g[1],G+28);}}
    for(const bl of W.blocks){if(bl.k==='cliff'||bl.x+bl.w<z.x0||bl.x>z.x1)continue;ctx.rect(bl.x,bl.y,bl.w,Math.min(bl.h,G-bl.y));}
    for(const wa of W.water){const a=Math.max(wa.x0,z.x0),b=Math.min(wa.x1,z.x1);if(b<=a)continue;for(let x=a+4;x<b-4;x+=10){ctx.moveTo(x,G+16);ctx.quadraticCurveTo(x+2.5,G+14,x+5,G+16);}}
    ctx.stroke();
    ctx.strokeStyle=`rgba(${col},0.25)`;ctx.setLineDash([2,4]);ctx.strokeRect(z.x0,G-110,z.x1-z.x0,140);ctx.setLineDash([]);
    const pc=S.chars[o];if(pc&&pc.dying<=0){const px=pc.x+pc.w/2;if(px>z.x0-80&&px<z.x1+80){const py=pc.y+pc.h*0.5;
      const g=ctx.createRadialGradient(px,py,0,px,py,14);g.addColorStop(0,`rgba(255,250,235,${0.9})`);g.addColorStop(1,'rgba(255,250,235,0)');ctx.fillStyle=g;ctx.fillRect(px-14,py-14,28,28);
      ctx.fillStyle='rgba(255,250,235,0.95)';ctx.beginPath();ctx.arc(px,py,2.2,0,7);ctx.fill();}}
    ctx.restore();}
}
function drawFx(w){
  for(const a of S.amb[w]){const al=Math.min(1,(a.max-a.life)*0.8,a.life*0.8)*(w?0.55:0.4);ctx.fillStyle=w?`rgba(230,236,246,${al})`:`rgba(245,232,200,${al})`;ctx.fillRect(a.x,a.y,a.s,a.s);}
  for(const r of S.ripples){if(r.w!==w||r.t<=0)continue;const rad=6+r.t*(r.big?90:60),al=(1-r.t/1.7)*0.6;ctx.strokeStyle=`rgba(${r.c},${al})`;ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(r.x,r.y,rad,0,7);ctx.stroke();ctx.lineWidth=0.8;ctx.beginPath();ctx.arc(r.x,r.y,rad*0.6,0,7);ctx.stroke();}
  for(const q of S.parts){if(q.w!==w)continue;ctx.globalAlpha=clamp(q.life/q.max*1.6,0,1);ctx.fillStyle=q.c;ctx.fillRect(q.x-q.s/2,q.y-q.s/2,q.s,q.s);}
  ctx.globalAlpha=1;
  const ht=S.mode==='play'?hintTarget():null;
  if(ht&&ht.world===w&&S.stageT>12){const k=0.5+0.5*Math.sin(S.t*3.2);ctx.strokeStyle=`rgba(${w?'235,240,250':'208,52,58'},${0.25+0.3*k})`;ctx.lineWidth=1.3;ctx.beginPath();ctx.arc(ht.x,ht.y,13+k*4,0,7);ctx.stroke();}
}
function drawFG(w,p,cam){
  ctx.fillStyle=w?'rgba(10,12,17,0.88)':'#050504';
  for(const f of DEC[w].fg){const x=f.x-cam*0.35;if(x<cam-120||x>cam+p.vw+120)continue;
    for(let i=0;i<f.n;i++){const bx=x+(i-f.n/2)*5+Math.sin(f.s+i)*3,h=f.h*(0.55+0.45*Math.abs(Math.sin(f.s*1.7+i*2.3))),sw=Math.sin(S.t*1.2+f.s+i)*2;
      ctx.beginPath();ctx.moveTo(bx-2.2,H+12);ctx.quadraticCurveTo(bx-1+sw*0.4,H-h*0.5,bx+sw,H-h);ctx.quadraticCurveTo(bx+1.2+sw*0.4,H-h*0.5,bx+2.2,H+12);ctx.fill();}}
}
function drawPanel(w){
  const p=panels[w],cam=S.cams[w];
  ctx.save();ctx.beginPath();ctx.rect(p.x,p.y,p.w,p.h);ctx.clip();
  ctx.translate(p.x,p.y);ctx.scale(p.scale,p.scale);ctx.translate(0,-p.top);
  drawBackdrop(w,p,cam);
  ctx.translate(-cam,0);
  drawTrees(w,p,cam,0.8);fog(cam-2,p.vw+4,COL[w].fog,150,195,w?0.18:0.22);
  drawTrees(w,p,cam,1);
  drawTerrain(w,p,cam);drawDecor(w);drawObjects(w);drawGhostMap(w,p,cam);
  drawGrass(w,p,cam,false);drawEnemies(w,p,cam);
  drawChars(w);drawGrass(w,p,cam,true);drawFx(w);drawDark(w,p,cam);drawFG(w,p,cam);
  ctx.restore();
  const cx=p.x+p.w/2,cy=p.y+p.h/2,R=Math.max(p.w,p.h),vg=ctx.createRadialGradient(cx,cy,R*0.25,cx,cy,R*0.78);
  vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(1,w?'rgba(0,0,0,0.75)':'rgba(0,0,0,0.6)');ctx.fillStyle=vg;ctx.fillRect(p.x,p.y,p.w,p.h);
  if(S.flash[w]>0){ctx.fillStyle=`rgba(0,0,0,${S.flash[w]*0.45})`;ctx.fillRect(p.x,p.y,p.w,p.h);}
  if(S.swf[w]>0){ctx.fillStyle=`rgba(255,250,240,${S.swf[w]*0.07})`;ctx.fillRect(p.x,p.y,p.w,p.h);}
  if(S.mode==='play'){ctx.font='600 10px system-ui,sans-serif';ctx.textBaseline='top';ctx.textAlign='left';ctx.fillStyle='rgba(255,255,255,0.5)';
    ctx.fillText(w?'ДҮҮ · ҮХЭГСДИЙН ЕРТӨНЦ':'АХ · АМЬД ЕРТӨНЦ',p.x+12,p.y+12);}
}
const grain=document.createElement('canvas');grain.width=grain.height=128;
{const g=grain.getContext('2d'),id=g.createImageData(128,128);for(let i=0;i<id.data.length;i+=4){const v=Math.random()*255|0;id.data[i]=id.data[i+1]=id.data[i+2]=v;id.data[i+3]=255;}g.putImageData(id,0,0);}
let grainPat=null;
function viewW(){return S.netMode==='online'?S.role:S.active;}
function render(){
  ctx.setTransform(DPR,0,0,DPR,0,0);ctx.clearRect(0,0,VW,GH);
  const w=viewW();drawPanel(w);
  if(S.mode==='play'&&S.netMode!=='online'){
    const ht=hintTarget(),need=!!ht&&ht.world!==S.active&&S.stageT>5&&!S.paused&&!S.pz;
    setHint(need&&touchUI);
    if(need&&!touchUI){const k=0.5+0.5*Math.sin(S.t*4);ctx.font='600 12px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle=`rgba(255,255,255,${0.35+0.4*k})`;ctx.fillText('⇅  Q',VW/2,12);ctx.textAlign='left';}
  }else setHint(false);
  if(S.glow>0){const g=ctx.createRadialGradient(VW/2,GH*0.6,0,VW/2,GH*0.6,Math.max(VW,GH)*0.7);g.addColorStop(0,`rgba(255,248,235,${S.glow*0.35})`);g.addColorStop(1,'rgba(255,248,235,0)');ctx.fillStyle=g;ctx.fillRect(0,0,VW,GH);}
  if(S.white>0){ctx.fillStyle=`rgba(244,242,238,${S.white})`;ctx.fillRect(0,0,VW,GH);}
  if(S.paused){ctx.fillStyle='rgba(0,0,0,0.45)';ctx.fillRect(0,0,VW,GH);}
  if(!grainPat)grainPat=ctx.createPattern(grain,'repeat');
  ctx.save();ctx.globalAlpha=0.05;ctx.globalCompositeOperation='overlay';ctx.translate(-(Math.random()*128|0),-(Math.random()*128|0));ctx.fillStyle=grainPat;ctx.fillRect(0,0,VW+128,GH+128);ctx.restore();
}

// ================= progress & game API =================
let memProg={unlocked:['ch1'],best:{}};
function loadProgress(){try{const v=JSON.parse(localStorage.getItem('tw.progress')||'null');if(v&&v.unlocked&&v.best)return v;}catch(e){}return JSON.parse(JSON.stringify(memProg));}
function saveProgress(p){memProg=p;try{localStorage.setItem('tw.progress',JSON.stringify(p));}catch(e){}}
function chapterOrder(){const seen={},out=[];for(const id of TW.chapterOrder)if(TW.chapters[id]&&!seen[id]){seen[id]=1;out.push(id);}
  return out.sort((a,b)=>(TW.chapters[a].num||0)-(TW.chapters[b].num||0));}
function startChapterInternal(id,opts){
  opts=opts||{};
  const def=TW.chapters[id]||TW.chapters[chapterOrder()[0]];if(!def)return;
  if(!AC)initAudio();if(AC&&AC.state!=='running')AC.resume().catch(()=>{});
  if(S){stopAllMusic();if(S.pz)closePuzzle();}
  for(const k in K)K[k]=false;for(const k in latch)latch[k]=false;
  loadChapter(def);S=makeState();S.mode='play';
  S.seed=opts.seed||((Math.random()*1e9)|0);
  if(opts.mode==='online'){S.netMode='online';S.role=opts.role===1?1:0;S.active=S.role;}
  spawnEnemies();layout();updateCams(0,true);
  if(def.ambience)setMusic(def.ambience,true);
  ambience();
  TW.emit('chapterStart',{id:def.id,num:def.num,title:def.title,mode:S.netMode,role:S.role});
}
function startChapter(id){startChapterInternal(id,{mode:'solo'});}
let myInfo={};
function myRole(){if(myInfo.role===0||myInfo.role===1)return myInfo.role;return TW.net&&TW.net.isHost?0:1;}
function startOnline(id){
  if(!TW.net||!TW.net.connected)return false;
  const seed=(Math.random()*1e9)|0,role=myRole();
  netSend({t:'start',chapter:id,seed});
  startChapterInternal(id,{mode:'online',role,seed});
  TW.emit('onlineStart',{chapter:id,role});return true;
}
function startOnlineGuest(m){
  const role=myRole();
  startChapterInternal(m.chapter,{mode:'online',role,seed:m.seed});
  TW.emit('onlineStart',{chapter:m.chapter,role});
}
function pauseGame(v,fromNet){
  if(!S||(S.mode!=='play'&&S.mode!=='ending'))v=false;
  v=!!v;if(S.paused===v)return;S.paused=v;
  if(!fromNet&&S.netMode==='online')netSend({t:'pause',v});
  for(const k in K)K[k]=false;for(const k in T)T[k]=false;
  if(AC){if(v)AC.suspend().catch(()=>{});else AC.resume().catch(()=>{});}
  TW.emit('pause',{paused:v});
}
TW.game={
  startChapter,startSolo:startChapter,startOnline,
  restart(){if(!CH)return;if(S&&S.netMode==='online'){netSend({t:'restart'});startChapterInternal(CH.id,{mode:'online',role:S.role,seed:S.seed});}else startChapter(CH.id);},
  mode:()=>S&&S.netMode==='online'?'online':'solo',
  role:()=>S&&S.netMode==='online'?S.role:null,
  leaveOnline(){try{if(TW.net)TW.net.leave();}catch(e){}if(S){stopAllMusic();if(S.pz)closePuzzle();}const d=TW.chapters[chapterOrder()[0]];loadChapter(d);S=makeState();layout();updateCams(0,true);ambience();},
  pause:pauseGame,
  isPaused:()=>!!(S&&S.paused),
  setMuted(v){muted=!!v;if(AC)master.gain.value=muted?0:0.9;},
  isMuted:()=>muted,
  chapters(){const pr=loadProgress();return chapterOrder().map(id=>{const c=TW.chapters[id];return{id,num:c.num,title:c.title,unlocked:PROTOTYPE_UNLOCK_ALL||id===chapterOrder()[0]||pr.unlocked.indexOf(id)>=0,best:pr.best[id]||null};});},
  current:()=>CH&&S&&S.mode!=='title'?{id:CH.id,num:CH.num,title:CH.title}:null,
  touchUI:()=>touchUI
};

// ================= fallback UI (only if ui.js is missing) =================
function fallbackStart(){
  const d=document.createElement('div');d.id='fbStart';d.style.cssText='position:fixed;inset:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.7);color:#eee;font-family:Georgia,serif';
  d.innerHTML='<div style="font-size:40px;letter-spacing:.3em;margin-bottom:24px">ХОЁР ЕРТӨНЦ</div>';
  for(const c of TW.game.chapters()){const b=document.createElement('button');b.textContent=c.num+'. '+c.title;b.style.cssText='margin:6px;padding:12px 30px;font-size:16px;border-radius:99px;border:1px solid #888;background:transparent;color:#fff';b.onclick=()=>{d.remove();startChapter(c.id);};d.appendChild(b);}
  document.body.appendChild(d);
}
function fallbackEnd(next){
  const d=document.createElement('div');d.style.cssText='position:fixed;inset:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f4f2ee;color:#222;font-family:Georgia,serif';
  d.innerHTML='<div style="font-size:36px;margin-bottom:12px">'+(CH.title||'')+'</div>';
  const b=document.createElement('button');b.textContent=next?'Дараагийн бүлэг':'Дахин тоглох';b.style.cssText='padding:12px 30px;font-size:16px;border-radius:99px';
  b.onclick=()=>{d.remove();startChapter(next||CH.id);};d.appendChild(b);document.body.appendChild(d);
}

// ================= boot =================
addEventListener('resize',layout);
document.addEventListener('visibilitychange',()=>{if(!AC)return;if(document.hidden)AC.suspend();else if(S&&S.mode!=='title'&&!S.paused)AC.resume().catch(()=>{});});
if(TW.net){
  try{const orig=TW.net.setInfo;if(orig)TW.net.setInfo=function(o){myInfo=Object.assign({},myInfo,o||{});return orig.apply(TW.net,arguments);};
    TW.net.on('message',onNet);TW.net.on('peer',p=>TW.emit('peer',{present:!!(p&&p.present),info:p&&p.info}));}catch(e){logErr('net.hook',e);}
}
const firstId=chapterOrder()[0];
loadChapter(TW.chapters[firstId]);S=makeState();layout();updateCams(0,true);
if(TW.ui&&TW.ui.init){try{TW.ui.init(TW.game);}catch(e){console.error(e);fallbackStart();}}else fallbackStart();
let last=performance.now(),acc=0,loopPaused=false;
function frame(now){
  const dt=Math.min(0.1,(now-last)/1000);last=now;
  if(!loopPaused){acc+=dt;let n=0;while(acc>=STEP&&n<8){update(STEP);acc-=STEP;n++;}if(n===8)acc=0;}
  render();requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__game={S:()=>S,update:n=>{for(let i=0;i<(n||1);i++)update(STEP);},T:TST,latch,start:id=>startChapter(id||firstId),pause:v=>{loopPaused=v;},render,api,CH:()=>CH};
})();
