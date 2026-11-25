(function(){
'use strict';
// Enemy AI for «Хоёр ертөнц»: wolf (чоно), raven (хэрээ), shulam (шулам).
// Registers TW.enemyTypes.<type> = { init(e, api), update(e, dt, api) }. See docs/enemy-ai.md.
const TW=window.TW;if(!TW)return;
TW.enemyTypes=TW.enemyTypes||{};

const GRAV=1500,VMAX=520;
const WOLF={w:34,h:20,patrol:45,pause:1,chase:135,trot:70,sniffSpeed:60,sniffT:2.5,alertT:0.5,howlT:1.5,lostMin:1.5,
  front:160,back:50,band:40,hop:22.5,reach:60,track:320,forced:4,stuckHowl:0.9};
const RAVEN={w:14,h:10,turn:3,look:0.3,alarm:1.2,cooldown:6,sight:190,call:600};
const SHU={w:30,h:16,wander:20,listen:0.6,hunt:90,search:2,sweep:30,sweepR:14,ret:35,hop:24.5,strike:26,band:14,lunge:150,lungeT:0.45};

// ---------- helpers (all defensive: never throw on missing fields) ----------
const num=(v,d)=>(typeof v==='number'&&isFinite(v))?v:d;
const sgn=v=>v>0?1:v<0?-1:0;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const cx=o=>num(o.x,0)+num(o.w,0)/2;
const ft=o=>num(o.y,0)+num(o.h,0);
const rnd=api=>{try{const r=api&&api.rand?api.rand():Math.random();return num(r,0.5);}catch(_){return Math.random();}};
const gOf=api=>num(api&&api.G,num(TW.G,190));
function worldOf(e,d){if(e.world!==0&&e.world!==1)e.world=d;return e.world;}
function charOf(api,w){let c=null;try{c=api&&api.chars;}catch(_){c=null;}return(c&&c[w])||null;}
const alive=c=>!!c&&!(num(c.dying,0)>0);
function hidden(c,api){try{return api&&api.isHidden?!!api.isHidden(c):!!c.hidden;}catch(_){return !!(c&&c.hidden);}}
function solids(api,w){try{const s=api&&api.solidsFor?api.solidsFor(w):null;return Array.isArray(s)?s:[];}catch(_){return [];}}
function overlap(api,a,b){try{if(api&&api.overlap)return !!api.overlap(a,b);}catch(_){}
  return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function sfx(api,name,e){try{if(api&&api.sfx)api.sfx(name,e.world,cx(e));}catch(_){}}
function kill(api,c,why){try{if(api&&api.kill)api.kill(c,why);}catch(_){}}
function enemies(api){let l=null;try{l=api&&api.enemies;}catch(_){l=null;}return Array.isArray(l)?l:[];}
function noises(api){let l=null;try{l=api&&api.noises;}catch(_){l=null;}return Array.isArray(l)?l:[];}
const inside=(s,px,py)=>px>s.x&&px<s.x+s.w&&py>s.y&&py<s.y+s.h;

// ghost bridges flicker: the shulam treats them as gaps so it can never drop through one
function onGhost(api,w,px){
  let L=null;try{L=api&&api.S&&api.S.objList;}catch(_){L=null;}
  if(!Array.isArray(L))return false;
  for(const o of L)if(o&&o.type==='ghostbridge'&&o.world===w&&px>=num(o.x0,1e9)&&px<=num(o.x1,-1e9))return true;
  return false;
}
function groundOK(e,api,dx,avoidGhost){
  const w=e.world;let ok=true;
  try{if(api&&api.groundAhead)ok=!!api.groundAhead(e,w,dx);
    else{const px=cx(e)+dx,py=gOf(api)+2;ok=solids(api,w).some(s=>px>=s.x&&px<=s.x+s.w&&py>=s.y&&py<=s.y+s.h);}}catch(_){ok=true;}
  if(ok&&avoidGhost&&onGhost(api,w,cx(e)+dx))ok=false;
  return ok;
}
// height of the obstacle just in front of e (0 if none)
function obstacleRise(e,dir,api){
  const p={x:dir>0?e.x+e.w:e.x-2,y:e.y,w:2,h:e.h-0.5};let top=Infinity;
  for(const s of solids(api,e.world))if(s&&overlap(api,p,s))top=Math.min(top,s.y);
  return top===Infinity?0:ft(e)-top;
}
// line of sight: false if a solid lies between the two points (solids containing an end point are ignored)
function los(api,w,x0,y0,x1,y1){
  const a=Math.min(x0,x1),b=Math.max(x0,x1),c=Math.min(y0,y1),d=Math.max(y0,y1),cand=[];
  for(const s of solids(api,w)){if(!s||s.x>b||s.x+s.w<a||s.y>d||s.y+s.h<c)continue;
    if(inside(s,x0,y0)||inside(s,x1,y1))continue;cand.push(s);}
  if(!cand.length)return true;
  const n=Math.max(1,Math.ceil(Math.hypot(x1-x0,y1-y0)/4));
  for(let i=1;i<n;i++){const t=i/n,px=x0+(x1-x0)*t,py=y0+(y1-y0)*t;for(const s of cand)if(inside(s,px,py))return false;}
  return true;
}
// one physics step: walk dir*speed with edge stop, gravity, small hops. Call exactly once per frame.
function step(e,dir,speed,dt,api,hop,avoidGhost){
  const res={edge:false,blocked:false,hopped:false};
  let vx=dir*speed;
  if(vx&&!groundOK(e,api,sgn(vx)*(e.w/2+3),avoidGhost)){vx=0;res.edge=true;}
  e.vy=Math.min(num(e.vy,0)+GRAV*dt,VMAX);
  const wasG=!!e.onGround,x0=e.x;let r=null;
  try{r=api.moveBody(e,vx*dt,e.vy*dt,e.world);}
  catch(_){e.x+=vx*dt;const G=gOf(api);e.y=Math.min(e.y+e.vy*dt,G-e.h);if(e.y>=G-e.h){e.vy=0;e.onGround=true;}r=null;}
  if(r&&r.hitX&&vx){
    const rise=obstacleRise(e,sgn(vx),api);
    if(wasG&&rise>0&&rise<=hop){e.vy=-Math.sqrt(2*GRAV*(rise+5));e.onGround=false;res.hopped=true;}
    else if(wasG)res.blocked=true;
  }
  const moved=num(e.x,x0)-x0;
  e.vx=dt>0?moved/dt:0;
  if(dir)e.face=dir>0?1:-1;
  e.anim=num(e.anim,0)+Math.abs(moved)*0.25;
  return res;
}
function setState(e,s){e.state=s;e.t=0;}

// ---------- chase music: evaluated once per engine frame ----------
let musS=null,musT=-1;
function chaseMusic(api){
  let S=null;try{S=api.S;}catch(_){S=null;}
  if(!S)return;const t=num(S.t,0);
  if(S===musS&&t===musT)return;musS=S;musT=t;
  let any=false;for(const o of enemies(api))if(o&&o.type==='wolf'&&o.alive!==false&&o.state==='chase'){any=true;break;}
  try{if(api.music)api.music('chase',any);}catch(_){}
}

// ================= WOLF =================
function wolfSees(e,b,api){
  if(!b||!alive(b)||hidden(b,api))return false;
  const dx=cx(b)-cx(e),f=dx*e.face;
  if(f>WOLF.front||f<-WOLF.back)return false;
  if(Math.abs(ft(b)-ft(e))>=WOLF.band)return false;
  return los(api,e.world,cx(e)+e.face*e.w*0.4,e.y+4,cx(b),b.y+b.h*0.35);
}
function toAlert(e,b,api){setState(e,'alert');e.lastX=cx(b);e.face=sgn(cx(b)-cx(e))||e.face;sfx(api,'wolfGrowl',e);}
function toChase(e,b,api,force){setState(e,'chase');e.forceT=force||0;e.stuck=0;e.lastX=cx(b);e.stepT=0;e.barkT=1.2+rnd(api)*2;}
function toSniff(e,x){setState(e,'sniff');e.sx=num(x,cx(e));e.phase=0;e.st=0;}
function toHowl(e,api){setState(e,'howl');e.stuck=0;sfx(api,'wolfHowl',e);}
function toLost(e){setState(e,'lost');e.forceT=0;e.stuck=0;}

TW.enemyTypes.wolf={
  init(e,api){
    const d=e.def||{},G=gOf(api);
    worldOf(e,num(d.world,0));
    e.w=WOLF.w;e.h=WOLF.h;
    e.x=num(d.x,num(e.x,0));e.y=num(d.y,G)-e.h;           // optional def.y = feet level, default ground
    e.vx=0;e.vy=0;e.onGround=true;e.alive=true;
    let p0=cx(e)-80,p1=cx(e)+80;
    if(Array.isArray(d.patrol)&&d.patrol.length>=2){p0=num(d.patrol[0],p0);p1=num(d.patrol[1],p1);}
    if(p0>p1){const k=p0;p0=p1;p1=k;}
    e.p0=p0;e.p1=p1;
    e.face=d.face===-1?-1:1;
    e.state='patrol';e.t=0;e.anim=0;
    e.pauseT=0;e.turnAfter=false;e.lastX=cx(e);e.forceT=0;e.stuck=0;e.sx=cx(e);e.phase=0;e.st=0;e.stepT=0;e.barkT=2;
  },
  update(e,dt,api){
    if(!(dt>0))return;dt=Math.min(dt,0.05);
    chaseMusic(api);
    const w=worldOf(e,0),b=charOf(api,w),live=alive(b),hid=live&&hidden(b,api);
    const dx=b?cx(b)-cx(e):0,adx=Math.abs(dx);
    e.t=num(e.t,0)+dt;
    const still=()=>step(e,0,0,dt,api,WOLF.hop);
    switch(e.state){
      case 'patrol':{
        if(wolfSees(e,b,api)){toAlert(e,b,api);still();break;}
        const c=cx(e);let dir=0;
        if(e.pauseT>0){e.pauseT-=dt;if(e.pauseT<=0&&e.turnAfter){e.face=-e.face;e.turnAfter=false;}}
        else if(c<e.p0-2)dir=1;
        else if(c>e.p1+2)dir=-1;
        else{dir=e.face;if((dir>0&&c>=e.p1)||(dir<0&&c<=e.p0)){dir=0;e.pauseT=WOLF.pause;e.turnAfter=true;}}
        const r=step(e,dir,WOLF.patrol,dt,api,WOLF.hop);
        if(dir&&(r.edge||r.blocked)){e.pauseT=WOLF.pause;e.turnAfter=true;}
        break;}
      case 'alert':{
        still();
        if(!live){toLost(e);break;}
        if(!hid){e.lastX=cx(b);if(adx>2)e.face=sgn(dx);}
        if(e.t>=WOLF.alertT){if(hid)toSniff(e,e.lastX);else toChase(e,b,api,0);}
        break;}
      case 'chase':{
        e.forceT=Math.max(0,num(e.forceT,0)-dt);
        if(!live){toLost(e);still();break;}
        if(hid||(adx>WOLF.track&&e.forceT<=0)){toSniff(e,e.lastX);still();break;}
        e.lastX=cx(b);
        const dir=adx>3?sgn(dx):0;
        const r=step(e,dir,WOLF.chase,dt,api,WOLF.hop);
        const elevated=!!b.onGround&&ft(e)-ft(b)>WOLF.hop;
        e.stuck=(r.edge||r.blocked||!dir)?num(e.stuck,0)+dt:Math.max(0,num(e.stuck,0)-dt*2);
        if((elevated&&adx<WOLF.reach&&e.stuck>0.15)||e.stuck>WOLF.stuckHowl){toHowl(e,api);break;}
        e.stepT-=dt;if(e.stepT<=0&&Math.abs(e.vx)>40){e.stepT=0.24;sfx(api,'wolfStep',e);}
        e.barkT-=dt;if(e.barkT<=0){e.barkT=2+rnd(api)*2.5;sfx(api,'wolfBark',e);}
        break;}
      case 'sniff':{
        if(wolfSees(e,b,api)){toAlert(e,b,api);still();break;}
        if(e.phase===0){
          const d=e.sx-cx(e),dir=Math.abs(d)>3?sgn(d):0;
          const r=step(e,dir,WOLF.sniffSpeed,dt,api,WOLF.hop);
          if(!dir||r.edge||r.blocked||e.t>4){e.phase=1;e.st=0;}
        }else{
          still();e.st+=dt;
          if(e.st>=WOLF.sniffT)toLost(e);
        }
        break;}
      case 'howl':{
        still();
        if(live&&adx>2)e.face=sgn(dx);
        if(e.t>=WOLF.howlT)toLost(e);
        break;}
      case 'lost':{
        const c=cx(e),tg=clamp(c,e.p0,e.p1),dir=Math.abs(tg-c)>3?sgn(tg-c):0;
        step(e,dir,WOLF.trot,dt,api,WOLF.hop);
        if((e.t>=WOLF.lostMin&&!dir)||e.t>8){setState(e,'patrol');e.pauseT=0.4;e.turnAfter=false;}
        break;}
      default:setState(e,'patrol');still();
    }
    if(live&&!hidden(b,api)&&overlap(api,e,b))kill(api,b,'wolf');
  }
};

// ================= RAVEN =================
function ravenSees(e,b,api){
  if(!b||!alive(b)||hidden(b,api))return false;
  const f=(cx(b)-cx(e))*e.face;
  if(f<=0||f>RAVEN.sight)return false;
  if(ft(b)>gOf(api)+20)return false;                     // fell into a pit: not "above the ground"
  return los(api,e.world,cx(e),e.y+e.h/2,cx(b),b.y+b.h*0.35);
}
function ravenAlarm(e,b,api){
  setState(e,'alarm');sfx(api,'ravenCaw',e);sfx(api,'ravenFlap',e);
  for(const o of enemies(api)){
    if(!o||o===e||o.type!=='wolf'||o.alive===false||o.world!==e.world)continue;
    if(Math.abs(cx(o)-cx(e))>RAVEN.call)continue;
    if(o.state==='chase'){o.forceT=Math.max(num(o.forceT,0),WOLF.forced);o.lastX=cx(b);continue;}
    toChase(o,b,api,WOLF.forced);o.face=sgn(cx(b)-cx(o))||o.face;sfx(api,'wolfGrowl',o);
  }
}
TW.enemyTypes.raven={
  init(e,api){
    const d=e.def||{},G=gOf(api);
    worldOf(e,num(d.world,0));
    e.w=RAVEN.w;e.h=RAVEN.h;
    e.x=num(d.x,num(e.x,0));e.y=num(d.y,G-95)-e.h;           // sits on top of its perch point
    e.vx=0;e.vy=0;e.onGround=true;e.alive=true;
    e.face=d.face===-1?-1:1;
    e.state='perch';e.t=0;e.anim=0;e.turnT=RAVEN.turn+rnd(api)*0.5;
  },
  update(e,dt,api){
    if(!(dt>0))return;dt=Math.min(dt,0.05);
    const d=e.def||{},w=worldOf(e,0),b=charOf(api,w);
    e.x=num(d.x,e.x);e.y=num(d.y,gOf(api)-95)-e.h;e.vx=0;e.vy=0;
    e.t=num(e.t,0)+dt;
    e.anim=num(e.anim,0)+dt*(e.state==='alarm'?22:1.5);       // wing/breath phase
    switch(e.state){
      case 'perch':
        if(ravenSees(e,b,api)){ravenAlarm(e,b,api);break;}
        if(e.t>=num(e.turnT,RAVEN.turn))setState(e,'look');
        break;
      case 'look':
        if(ravenSees(e,b,api)){ravenAlarm(e,b,api);break;}
        if(e.t>=RAVEN.look){e.face=-e.face;setState(e,'perch');e.turnT=RAVEN.turn+rnd(api)*0.5;}
        break;
      case 'alarm':
        if(e.t>=RAVEN.alarm)setState(e,'cooldown');
        break;
      case 'cooldown':
        if(e.t>=RAVEN.cooldown){setState(e,'perch');e.turnT=RAVEN.turn+rnd(api)*0.5;}
        break;
      default:setState(e,'perch');
    }
  }
};

// ================= SHULAM =================
function hear(e,api){
  const ex=cx(e),ey=e.y+e.h/2;let best=null,bd=Infinity;
  for(const n of noises(api)){
    if(!n||n.world!==e.world)continue;
    const nx=num(n.x,NaN);if(!isFinite(nx))continue;
    const d=Math.hypot(nx-ex,num(n.y,ey)-ey);
    if(d<=num(n.r,0)&&d<bd){best=n;bd=d;}
  }
  return best;
}
function canStrike(e,s){return alive(s)&&Math.abs(cx(s)-cx(e))<=SHU.strike&&Math.abs(ft(s)-ft(e))<SHU.band;}
function toListen(e,n){setState(e,'listen');e.tx=num(n.x,cx(e));}
function toHunt(e,api){setState(e,'hunt');if(num(e.shriekCd,0)<=0){sfx(api,'shulamShriek',e);e.shriekCd=1.5;}}
function toSearch(e){setState(e,'search');e.sx=cx(e);e.sweepDir=e.face||1;}
function toReturn(e){setState(e,'return');e.retStuck=0;}
function toIdle(e,api){setState(e,'idle');e.wt=null;e.wp=0.4+rnd(api)*1.2;}
function pickWander(e,api){
  const c=cx(e),a=e.r0,b=e.r1;
  if(c<a||c>b||b-a<4)return clamp(c,a,b);
  for(let i=0;i<4;i++){const t=a+rnd(api)*(b-a);if(Math.abs(t-c)>=Math.min(20,(b-a)/3))return t;}
  return c-a>b-c?a:b;
}
TW.enemyTypes.shulam={
  init(e,api){
    const d=e.def||{},G=gOf(api);
    worldOf(e,num(d.world,1));
    e.w=SHU.w;e.h=SHU.h;
    e.x=num(d.x,num(e.x,0));e.y=num(d.y,G)-e.h;            // optional def.y = feet level, default ground
    e.vx=0;e.vy=0;e.onGround=true;e.alive=true;
    let r0=cx(e)-60,r1=cx(e)+60;
    if(Array.isArray(d.range)&&d.range.length>=2){r0=num(d.range[0],r0);r1=num(d.range[1],r1);}
    if(r0>r1){const k=r0;r0=r1;r1=k;}
    e.r0=r0;e.r1=r1;
    e.face=d.face===-1?-1:1;
    e.state='idle';e.t=0;e.anim=0;
    e.tx=cx(e);e.sx=cx(e);e.wt=null;e.wp=0.5+rnd(api);e.breathT=1.5+rnd(api)*2;e.crawlT=0;e.shriekCd=0;e.sweepDir=1;e.retStuck=0;
  },
  update(e,dt,api){
    if(!(dt>0))return;dt=Math.min(dt,0.05);
    const w=worldOf(e,1),s=charOf(api,w),live=alive(s);
    e.t=num(e.t,0)+dt;e.shriekCd=Math.max(0,num(e.shriekCd,0)-dt);
    const n=e.state==='attack'?null:hear(e,api);
    const mv=(dir,sp)=>step(e,dir,sp,dt,api,SHU.hop,true),still=()=>mv(0,0);
    if(e.state!=='attack'&&live&&canStrike(e,s)){
      setState(e,'attack');e.face=sgn(cx(s)-cx(e))||e.face;if(e.onGround)e.vy=-150;
      if(e.shriekCd<=0){sfx(api,'shulamShriek',e);e.shriekCd=1.5;}
    }
    switch(e.state){
      case 'idle':{
        if(n){toListen(e,n);still();break;}
        let dir=0;
        if(e.wp>0)e.wp-=dt;
        else{if(e.wt==null)e.wt=pickWander(e,api);const d=e.wt-cx(e);
          if(Math.abs(d)<2){e.wt=null;e.wp=0.8+rnd(api)*1.8;}else dir=sgn(d);}
        const r=mv(dir,SHU.wander);
        if(dir&&(r.edge||r.blocked)){e.wt=null;e.wp=0.6+rnd(api);}
        e.breathT-=dt;if(e.breathT<=0){e.breathT=3+rnd(api)*3;sfx(api,'shulamBreath',e);}
        break;}
      case 'listen':{
        if(n)e.tx=num(n.x,e.tx);
        const f=sgn(e.tx-cx(e));if(f)e.face=f;
        still();
        if(e.t>=SHU.listen)toHunt(e,api);
        break;}
      case 'hunt':{
        if(n)e.tx=num(n.x,e.tx);                                // newer noise retargets
        const d=e.tx-cx(e),dir=Math.abs(d)>3?sgn(d):0;
        const r=mv(dir,SHU.hunt);
        if(!dir||r.edge||r.blocked||e.t>10)toSearch(e);
        break;}
      case 'search':{
        if(n){e.tx=num(n.x,e.tx);toHunt(e,api);still();break;}
        let dir=e.sweepDir||1;const c=cx(e);
        if((dir>0&&c>e.sx+SHU.sweepR)||(dir<0&&c<e.sx-SHU.sweepR)){dir=-dir;e.sweepDir=dir;}
        const r=mv(dir,SHU.sweep);
        if(r.edge||r.blocked)e.sweepDir=-dir;
        if(e.t>=SHU.search)toReturn(e);
        break;}
      case 'return':{
        if(n){toListen(e,n);still();break;}
        const c=cx(e),tg=clamp(c,e.r0,e.r1),dir=Math.abs(tg-c)>2?sgn(tg-c):0;
        const r=mv(dir,SHU.ret);
        if(!dir)toIdle(e,api);
        else if(r.edge||r.blocked){e.retStuck=num(e.retStuck,0)+dt;if(e.retStuck>1.5)toIdle(e,api);}
        else e.retStuck=0;
        break;}
      case 'attack':{
        if(e.t<SHU.lungeT)mv(e.face,SHU.lunge);
        else{still();toSearch(e);}
        break;}
      default:toIdle(e,api);still();
    }
    if(Math.abs(e.vx)>50){e.crawlT-=dt;if(e.crawlT<=0){e.crawlT=0.2;sfx(api,'shulamCrawl',e);}}
    if(live&&overlap(api,e,s))kill(api,s,'shulam');
  }
};
})();
