(function(){
'use strict';
const ev={};
window.TW={
  H:240,G:190,DEATH_Y:330,
  PHYS:{
    brother:{w:14,h:30,speed:120,jumpV:430,gravity:1500},
    sister:{w:12,h:24,speed:118,jumpV:375,gravity:1150},
    crate:{w:40,h:40,push:62}
  },
  chapters:{},chapterOrder:[],
  enemyTypes:{},enemyArt:{},envArt:{},
  sfxExt:{},music:{},
  ui:null,game:null,
  on(n,f){(ev[n]=ev[n]||[]).push(f);},
  off(n,f){if(ev[n])ev[n]=ev[n].filter(x=>x!==f);},
  emit(n,d){(ev[n]||[]).slice().forEach(f=>{try{f(d);}catch(e){console.error(e);}});}
};
})();
