(function(){const G=TW.G;
TW.chapters.tango={id:'tango',num:98,title:'Тест',width:1800,start:[100,100],checkpoints:[[100],[100]],
 worlds:[{ground:[[-300,700],[745,1900]],blocks:[{x:-80,y:-300,w:60,h:600,k:'cliff'},{x:820,y:G-30,w:30,h:30,k:'rock'}],dark:[{x0:600,x1:900}],grass:[]},
         {ground:[[-300,1900]],blocks:[{x:-80,y:-300,w:60,h:600,k:'cliff'}],bones:[]}],
 objects:[{id:'PZ1',type:'puzzle',world:0,x:400,kind:'symbols',target:'G1'},{id:'CL1',type:'clue',world:1,x:400,puzzle:'PZ1'},{id:'G1',type:'gate',world:0,x:1000}],
 enemies:[{id:'SW',type:'wolf',world:0,x:1300,patrol:[1250,1450],seenBy:'other'}],
 exit:{x:1700,kind:'pass'},stages:[]};
TW.chapterOrder.push('tango');})();
