(function(){
'use strict';
const G=TW.G;
// AI sandbox chapter (num 99). Tests tweak start/enemy defs before TW.game.startChapter('sandbox').
// World 0: wolf patrol [520,860] over grass [600,680]; 40-high rock [900,940]; gap [1500,1580];
//          raven perch at 1900 (faces left); 20-high rock at 2150 (wolf hop).
// World 1: gap [820,880]; shulam range [1040,1120]; bones [1195,1260].
TW.chapters.sandbox={
  id:'sandbox',num:99,title:'AI sandbox',endText:'',
  width:3200,start:[300,1170],checkpoints:[[],[]],
  worlds:[
    {ground:[[-300,1500],[1580,3300]],
     blocks:[{x:-80,y:-300,w:60,h:600,k:'cliff'},{x:900,y:G-40,w:40,h:40,k:'rock'},{x:2150,y:G-20,w:24,h:20,k:'rock'},{x:3120,y:-300,w:120,h:600,k:'cliff'}],
     water:[],grass:[{x0:600,x1:680}],decor:[]},
    {ground:[[-300,820],[880,3300]],
     blocks:[{x:-80,y:-300,w:60,h:600,k:'cliff'},{x:3120,y:-300,w:120,h:600,k:'cliff'}],
     bones:[{x0:1195,x1:1260}],ice:[],decor:[]}
  ],
  objects:[],
  enemies:[
    {id:'W1',type:'wolf',world:0,x:700,patrol:[520,860]},
    {id:'R1',type:'raven',world:0,x:1900,y:G-95,face:-1},
    {id:'S1',type:'shulam',world:1,x:1070,range:[1040,1120]}
  ],
  exit:{x:3050,kind:'pass'},
  stages:[{done:()=>false,hint:()=>null}]
};
TW.chapterOrder.push('sandbox');
})();
