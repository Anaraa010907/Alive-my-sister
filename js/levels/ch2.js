(function(){
'use strict';
const G=TW.G;
// Chapter 2 «Чонын хөндий» — HIDE, LURE and TALK.
// One player sees, describes and the other acts (Operation: Tango style). Full walkthrough: docs/ch2-design.md.
// Numbers used: wolf sees 160 front / 50 back, feet band < 40 (a 42-high rock hides the brother), hops <= 22.5;
// shulam hops <= 24.5 (26+ high blocks are walls for it), hears the brother's echo r260, sister landings r110 only
// when falling > ~39 high; sister on a block >= 16 above it is never struck.
const E=(S,id)=>S.enemies.find(e=>e.id===id);
const s1Trapped=S=>{const e=E(S,'S1');return !!e&&e.x>=1296&&e.x+e.w<=1352&&e.y+e.h>G-2;}; // S1 fell into the pit 1300-1350
TW.chapters.ch2={
  id:'ch2',num:2,title:'Чонын хөндий',
  endText:'Ахын дуу дүүг нь аюулаас хамгаалж чадлаа. Хөндийн оройгоос хөгшин чоно тэднийг ширтсээр…',
  width:4100,start:[100,100],ambience:'valley',
  checkpoints:[[100,700,1340,1600,2280,2730,2960,3190,3750],[100,950,1400,1700,2280,2800,3100,3500]],
  worlds:[
    { // 0 — living world (brother): wolves, ravens, the dark cave
      ground:[[-300,640],[680,2210],[2250,2410],[2450,2580],[2620,2680],[2720,4200]],
      blocks:[
        {x:-80,y:-300,w:60,h:600,k:'cliff'},
        {x:1660,y:G-42,w:42,h:42,k:'rock'},     // D: lookout rock before the shadow-wolf field (42 high: wolves can't see him)
        {x:2500,y:G-40,w:80,h:40,k:'rock'},     // E: step inside the dark cave
        {x:3700,y:G-42,w:42,h:42,k:'rock'},     // H: the raven's rock — refuge from the wolf chase
        {x:4020,y:-300,w:120,h:600,k:'cliff'}],
      water:[],
      grass:[{x0:450,x1:510},{x0:1930,x1:1985},{x0:3450,x1:3500}],
      dark:[{x0:2360,x1:2740}],                 // E: the cave — the sister's screen shows the ghost map
      decor:[{k:'boot',x:200}]},                 // small felt boot half in the first snow (drawn once the engine knows 'boot')
    { // 1 — world of the dead (sister): shulams, bones
      ground:[[-300,4200]],
      blocks:[
        {x:-80,y:-300,w:60,h:600,k:'cliff'},
        {x:1040,y:G-30,w:260,h:30,k:'rock'},    // B: the shulam's flat rock (shelf)
        {x:1350,y:G-36,w:40,h:36,k:'rock'},     // B: rock wall closing the pit 1300-1350 (the trap)
        {x:3150,y:G-26,w:30,h:26,k:'rock'},     // G: step stone — also stops the shulam going further left
        {x:3180,y:G-50,w:190,h:12,k:'log'},     // G: fallen trunk, the shulam crawls UNDER it (bottom at G-38)
        {x:3610,y:G-30,w:60,h:30,k:'rock'},     // H: stone A
        {x:3720,y:G-30,w:40,h:30,k:'rock'},     // H: stone B (pit 3670-3720 between them holds S3)
        {x:4020,y:-300,w:120,h:600,k:'cliff'}],
      bones:[{x0:330,x1:390}],                  // A: teaching patch, no shulam in earshot
      ice:[],
      decor:[{k:'skull',x:720},{k:'skull',x:1326},{k:'skull',x:2470},{k:'skull',x:3696}]}
  ],
  objects:[
    // C «Тамгат хад»: sister solves the symbols at her stone, brother reads the carving; opens HIS gate
    {id:'PZ1',type:'puzzle',world:1,x:1500,kind:'symbols',target:'G1',params:{}},
    {id:'CL1',type:'clue',world:0,x:1470,puzzle:'PZ1'},
    {id:'G1',type:'gate',world:0,x:1560},
    // E «Харанхуй агуй»: brother picks 4 cave doors, sister reads the map from above
    {id:'PZ2',type:'puzzle',world:0,x:2300,kind:'maze',target:'G2',params:{}},
    {id:'CL2',type:'clue',world:1,x:2300,puzzle:'PZ2'},
    {id:'G2',type:'gate',world:0,x:2340},
    // F «Хоёр цоож»: split code, each lock opens the PARTNER's gate
    {id:'PZ3A',type:'puzzle',world:0,x:2880,kind:'split',target:'G3B',params:{pair:'SP1',side:0}},
    {id:'PZ3B',type:'puzzle',world:1,x:2880,kind:'split',target:'G3A',params:{pair:'SP1',side:1}},
    {id:'G3A',type:'gate',world:0,x:2940},
    {id:'G3B',type:'gate',world:1,x:2940},
    // H finale: brother reads the drum rhythm behind the raven's rock, sister plays it; opens his last gate
    {id:'PZ4',type:'puzzle',world:1,x:3790,kind:'drum',target:'G4',params:{beats:6}},
    {id:'CL4',type:'clue',world:0,x:3790,puzzle:'PZ4'},
    {id:'G4',type:'gate',world:0,x:3830}
  ],
  enemies:[
    // A «Хөндийн ам»: first wolf, grass hiding, wolf can't follow over the gap 640-680
    {id:'W1',type:'wolf',world:0,x:470,patrol:[380,590]},
    // B: raven teaches the alarm — W1 rushes to the gap edge and howls, harmless
    {id:'RV1',type:'raven',world:0,x:893,y:G-95},
    // B «Шуламын тавцан»: shulam on the shelf; the brother's call from x>1300 drops it into the pit for good
    {id:'S1',type:'shulam',world:1,x:1160,y:G-30,range:[1130,1250]},
    // D «Сүүдэр чоно»: hidden threat — kills the brother but only the sister sees it
    {id:'SW1',type:'wolf',world:0,x:1983,patrol:[1790,2110],seenBy:'other'},
    // G «Модон саравч»: shulam under the fallen trunk; brother's call at x~3200 pulls it to the step stone
    {id:'S2',type:'shulam',world:1,x:3350,range:[3320,3440]},
    // H «Чонын сүрэг»: den wolf + raven on the rock -> chase -> brother climbs the 42-high rock
    {id:'W2',type:'wolf',world:0,x:3463,patrol:[3400,3580]},
    {id:'RV2',type:'raven',world:0,x:3714,y:G-95,face:-1},
    // H: old shulam boxed in the pit between stones A and B — the sister jumps over it
    {id:'S3',type:'shulam',world:1,x:3680,range:[3685,3705]}
  ],
  exit:{x:3950,kind:'pass'},
  stages:[
    // 0 A: brother hides in the grass while W1 walks over him
    {done:S=>S.chars[0].x>=690,hint:()=>({world:0,x:480,y:G-14})},
    // 1 B: brother calls ◎ beyond the shelf (sister tells him where)
    {done:S=>S.chars[1].x>=1395||s1Trapped(S),hint:()=>({world:0,x:1360,y:G-20})},
    // 2 B: sister crosses the shelf and jumps the pit onto the wall
    {done:S=>S.chars[1].x>=1395,hint:S=>S.chars[1].x<1040?{world:1,x:1060,y:G-42}:{world:1,x:1370,y:G-48}},
    // 3 C: symbols — sister solves, brother reads
    {done:S=>S.obj.PZ1.on||S.obj.G1.on,hint:S=>Math.abs(S.chars[0].x+7-1470)>40?{world:0,x:1470,y:G-30}:{world:1,x:1500,y:G-30}},
    // 4 D: brother through the shadow-wolf field (sister watches)
    {done:S=>S.chars[0].x>=2255,hint:S=>S.chars[0].x<1700?{world:0,x:1681,y:G-54}:{world:0,x:1957,y:G-14}},
    // 5 E: maze — sister reads the map, brother picks doors
    {done:S=>S.obj.PZ2.on||S.obj.G2.on,hint:S=>Math.abs(S.chars[1].x+6-2300)>40?{world:1,x:2300,y:G-30}:{world:0,x:2300,y:G-30}},
    // 6 E: dark cave — sister stands at ~2550 and guides
    {done:S=>S.chars[0].x>=2725,hint:()=>({world:1,x:2550,y:G-30})},
    // 7 F: split locks
    {done:S=>S.obj.G3A.on&&S.obj.G3B.on,hint:S=>!S.obj.PZ3A.on?{world:0,x:2880,y:G-30}:{world:1,x:2880,y:G-30}},
    // 8 G: sister waits on the trunk, brother calls at ~3200, sister drops and runs
    {done:S=>S.chars[1].x>=3460,hint:S=>{const s=S.chars[1];return s.y+s.h<=G-49?{world:0,x:3200,y:G-20}:{world:1,x:3300,y:G-62};}},
    // 9 H: brother reaches the pocket behind the raven's rock
    {done:S=>S.chars[0].x>=3742,hint:()=>({world:0,x:3721,y:G-54})},
    // 10 H: drum — brother reads, sister plays; G4 opens, then the ovoo glows
    {done:S=>S.obj.PZ4.on||S.obj.G4.on,hint:S=>Math.abs(S.chars[0].x+7-3790)>30?{world:0,x:3790,y:G-30}:{world:1,x:3790,y:G-30}}
  ]
};
TW.chapterOrder.push('ch2');
})();
