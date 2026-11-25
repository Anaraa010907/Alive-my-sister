(function(){
'use strict';
const G=TW.G;
// Chapter 1 «Хил» — learning to help each other across the border.
TW.chapters.ch1={
  id:'ch1',num:1,title:'Хил',
  endText:'Ах дүү хоёр бие биенээ анх удаа мэдэрлээ.\nГэвч хоёр ертөнцийн хил хаалттай хэвээр…',
  width:3300,start:[100,100],
  checkpoints:[[100,620,1010,1830,2370],[100,620,1200,1910,2370]],
  worlds:[
    {ground:[[-300,560],[610,800],[960,2150],[2350,3400]],
     blocks:[{x:-80,y:-300,w:60,h:600,k:'cliff'},{x:380,y:G-22,w:36,h:22,k:'rock'},{x:1540,y:G-26,w:30,h:26,k:'rock'},{x:3220,y:-300,w:120,h:600,k:'cliff'}],
     water:[{x0:800,x1:960}],grass:[],decor:[{k:'horse',x:175}]},
    {ground:[[-300,560],[610,2150],[2350,3400]],
     blocks:[{x:-80,y:-300,w:60,h:600,k:'cliff'},{x:382,y:G-22,w:28,h:22,k:'stone'},{x:1560,y:100,w:340,h:200,k:'ledge'},{x:3220,y:-300,w:120,h:600,k:'cliff'}],
     bones:[],ice:[{x0:800,x1:960}],decor:[]}
  ],
  objects:[
    {id:'L1',type:'lever',world:1,x:1072,y:G,target:'B1'},       // sister lowers the brother's drawbridge
    {id:'B1',type:'drawbridge',world:0,x0:800,x1:960},
    {id:'C1',type:'crate',world:0,x:1300},                        // its shadow lets the sister climb the ledge
    {id:'L2',type:'lever',world:1,x:1740,y:100,target:'G1'},
    {id:'G1',type:'gate',world:0,x:1800},
    {id:'P1',type:'plate',world:0,x0:2030,x1:2080,target:'GB1'},  // brother holds the ghost bridge for her
    {id:'GB1',type:'ghostbridge',world:1,x0:2150,x1:2350},
    {id:'L3',type:'lever',world:1,x:2420,y:G,target:'R1'},
    {id:'R1',type:'ropebridge',world:0,x0:2150,x1:2350}
  ],
  enemies:[],
  exit:{x:2900,kind:'meet'},
  stages:[
    {done:S=>S.obj.B1.on,hint:()=>({world:1,x:1072,y:G-12})},
    {done:S=>S.obj.G1.on||S.obj.C1.x>=1470,hint:S=>({world:0,x:S.obj.C1.x+20,y:S.obj.C1.y+20})},
    {done:S=>S.obj.G1.on,hint:S=>{const s=S.chars[1];return s.y+s.h<=101?{world:1,x:1740,y:88}:{world:1,x:S.obj.C1.x+20,y:S.obj.C1.y+20};}},
    {done:S=>S.obj.R1.on||S.chars[1].x+S.chars[1].w/2>=2360,hint:S=>S.obj.GB1.held?{world:1,x:2250,y:G-8}:{world:0,x:2055,y:G-6}},
    {done:S=>S.obj.R1.on,hint:()=>({world:1,x:2420,y:G-12})}
  ]
};
TW.chapterOrder.push('ch1');
})();
