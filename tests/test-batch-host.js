'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('../extension/js/core.js');
const host=fs.readFileSync(path.join(__dirname,'../extension/jsx/host.jsx'),'utf8').replace(/^#include.*$/m,'');
const collection=a=>Object.assign(a,{numItems:a.length});
class Time {constructor(){this.seconds=0;}}
class Param {
 constructor(name){this.displayName=name;this.value=0;this.varying=false;this.keys=[];this.refreshes=0;this.onWrite=()=>{};}
 areKeyframesSupported(){return true;}isTimeVarying(){return this.varying;}
 getValue(){return this.value;}getKeys(){return this.keys.map(k=>({seconds:k.seconds}));}
 setTimeVarying(v){this.varying=v;return 0;}setValue(v){this.value=v;return 0;}
 addKey(t){this.keys.push({seconds:t.seconds,value:0});return 0;}
 setValueAtKey(t,v){this.onWrite(t);this.keys.find(k=>k.seconds===t.seconds).value=v;return 0;}
 getValueAtKey(t){return this.keys.find(k=>k.seconds===t.seconds).value;}
 setInterpolationTypeAtKey(t,v,ui){this.keys.find(k=>k.seconds===t.seconds).interp=v;if(ui)this.refreshes++;return 0;}
 removeKey(t){this.keys=this.keys.filter(k=>k.seconds!==t.seconds);return 0;}
}
function clip(id,start){
 const props=collection(['Left','Top','Right','Bottom'].map(n=>new Param(n)));
 return {nodeId:id,name:'Graphic',start:{seconds:start},end:{seconds:start+2},inPoint:{seconds:100},components:collection([{displayName:'Crop',matchName:'AE.ADBE Crop',properties:props}]),isSelected:()=>true,getSpeed:()=>1,isSpeedReversed:()=>false};
}
function fixture(n,options={}){
 const white=Array.from({length:n},(_,i)=>clip('white'+i,i*3)),color=Array.from({length:n},(_,i)=>clip('color'+i,i*3));
 const sequence={sequenceID:'s',name:'Test',timebase:String(254016000000/30),getSettings:()=>({videoFrameWidth:1920,videoFrameHeight:1080,videoDisplayFormat:100}),videoTracks:[{clips:collection(white)},{clips:collection(color)}]};
 sequence.videoTracks.numTracks=2;
 const app={version:'23.6',project:{documentID:'p',activeSequence:sequence}},reads={};
 function meter(obj,key,label){let value=obj[key];Object.defineProperty(obj,key,{get(){reads[label]=(reads[label]||0)+1;return value;},set(v){value=v;},configurable:true});}
 meter(app.project,'activeSequence','sequence');meter(app.project,'documentID','project');meter(sequence,'videoTracks','tracks');meter(sequence,'timebase','fps');
 sequence.videoTracks.forEach((t,i)=>meter(t,'clips','clips'+i));
 white.forEach(c=>meter(c.start,'seconds','baseStarts'));
 const FixtureTime=options.meters?class extends Time {constructor(){super();reads.timeObjects=(reads.timeObjects||0)+1;}}:Time;
 if(options.meters)for(const list of [white,color])for(const c of list){
  for(const name of ['getSpeed','isSpeedReversed']){const original=c[name];c[name]=function(...args){reads[name]=(reads[name]||0)+1;return original.apply(this,args);};}
  for(const p of c.components[0].properties)for(const name of ['areKeyframesSupported','isTimeVarying','getValue','getKeys','getValueAtKey']){
   const original=p[name];p[name]=function(...args){reads[name]=(reads[name]||0)+1;return original.apply(this,args);};
  }
 }
 if(options.meters)for(const c of color){meter(c,'components','cropCollections');meter(c.start,'seconds','colorStarts');}
 const context=vm.createContext({app,Time:FixtureTime,JSON:options.json2?{}:JSON,decodeURIComponent});
 if(options.json2)vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/jsx/json2.jsx'),'utf8'),context);
 vm.runInContext(options.hostSource||host,context);
 const data=C.geometry(C.timing('She found the documents,',2,30),{width:1920,widthFactor:100,padding:3,tracking:0,anchor:50,align:'center'},s=>s.length*20);
 const plans=color.map((c,i)=>({project:'p|s',fps:30,baseTrack:0,track:1,items:[C.makeItem({id:c.nodeId,track:1,start:i*3,end:i*3+2,inPoint:100},data,{mode:'hold',width:1920,padding:3})]}));
 const call=(method,p)=>JSON.parse(context.KG23.call(method,encodeURIComponent(JSON.stringify(p))));
 return {context,app,sequence,plans,white,color,call,reads,right:i=>color[i].components[0].properties[2]};
}
function compact(plans){const p=plans[0];return {compact:true,project:p.project,fps:p.fps,baseTrack:p.baseTrack,track:p.track,maxMillis:8000,items:plans.map(p=>{const i=p.items[0];return [i.id,i.start,i.end,i.inPoint,i.top,i.bottom,i.keys.map(k=>[k.frame,k.value,k.interp])];})};}
function preparation(f){return {compact:true,project:'p|s',fps:30,baseTrack:0,track:1,clips:f.plans.map(p=>{const i=p.items[0];return [i.id,i.start,i.end,i.inPoint];})};}
function test(name,fn){if(require.main!==module)return;fn();console.log('PASS '+name);}
module.exports={fixture,compact,preparation};
test('1000-cue batch retains every keyframe and refreshes once',()=>{
 const f=fixture(1000),r=f.call('applyBatch',{plans:f.plans,maxMillis:8000});
 assert(r.ok,JSON.stringify(r));assert.equal(r.value.applied,1000);assert.equal(r.value.error,'');
 let refreshes=0,total=0;
 f.plans.forEach((p,i)=>{
  const right=f.right(i),expected=p.items[0].keys;assert.equal(right.keys.length,expected.length);
  expected.forEach((k,j)=>{assert.equal(right.keys[j].seconds,100+k.frame/30);assert.equal(right.keys[j].value,k.value);assert.equal(right.keys[j].interp,k.interp);});
  refreshes+=right.refreshes;total+=right.keys.length;
  f.white[i].components[0].properties.forEach(p=>{assert.equal(p.keys.length,0);assert.equal(p.value,0);});
 });
 assert.equal(refreshes,1);assert.equal(r.value.stats.keyframes,total);
 assert.equal(f.call('undo',{}).value.restored,1000);
 for(let i=0;i<1000;i++){assert.equal(f.right(i).keys.length,0);assert.equal(f.right(i).varying,false);}
});
test('5001-cue request rejected before any write',()=>{
 const f=fixture(1),r=f.call('applyBatch',{plans:Array(5001).fill(f.plans[0])});
 assert.equal(r.ok,false);assert.equal(f.right(0).keys.length,0);
});
test('8-second budget ends at complete cues and resumes without skips',()=>{
 const f=fixture(5);let clock=0;
 f.context.Date=class {getTime(){return clock;}};
 f.color.forEach((c,i)=>{f.right(i).onWrite=t=>{if(t.seconds===100)clock+=4500;};});
 let done=0,rounds=[];
 while(done<5){const r=f.call('applyBatch',{plans:f.plans.slice(done),maxMillis:8000});assert(r.ok);assert.equal(r.value.error,'');rounds.push(r.value.applied);done+=r.value.applied;}
 assert.deepEqual(rounds,[2,2,1]);
 f.plans.forEach((p,i)=>assert.equal(f.right(i).keys.length,p.items[0].keys.length));
});
test('Mid-batch error rolls back failing cue and leaves later cues untouched',()=>{
 const f=fixture(1000);f.right(603).onWrite=()=>{throw Error('Simulated write failure');};
 const r=f.call('applyBatch',{plans:f.plans,maxMillis:8000});assert(r.ok);assert.equal(r.value.applied,603);assert(r.value.error.includes('Đã hoàn tác'));
 assert(f.right(602).keys.length>0);assert.equal(f.right(603).keys.length,0);assert.equal(f.right(603).varying,false);
 for(let i=604;i<1000;i++)assert.equal(f.right(i).keys.length,0);
});
test('Large-batch checks still reject moved clips and locked tracks',()=>{
 for(const mutate of [f=>f.color[0].start.seconds++,f=>f.sequence.videoTracks[1].isLocked=()=>true]){
  const f=fixture(2);mutate(f);const r=f.call('applyBatch',{plans:f.plans});assert(r.ok);assert.equal(r.value.applied,0);assert(r.value.error);assert.equal(f.right(0).keys.length,0);
 }
});
test('Compact transport and json2 retain every frame, value and interpolation',()=>{
 const f=fixture(200,{json2:true});assert(f.call('prepareAll',preparation(f)).ok);
 const r=f.call('applyBatch',compact(f.plans));assert(r.ok,JSON.stringify(r));assert.equal(r.value.applied,200);assert.equal(r.value.error,'');
 f.plans.forEach((p,i)=>p.items[0].keys.forEach((k,j)=>assert.deepEqual(f.right(i).keys[j],{seconds:100+k.frame/30,value:k.value,interp:k.interp})));
});
test('Live Adobe collections and FPS are read once per call, not once per cue',()=>{
 const f=fixture(500);assert(f.call('prepareAll',preparation(f)).ok);
 Object.keys(f.reads).forEach(k=>f.reads[k]=0);
 const r=f.call('applyBatch',compact(f.plans));assert(r.ok);assert.equal(r.value.applied,500);
 assert.equal(f.reads.sequence,1);assert.equal(f.reads.project,1);assert.equal(f.reads.tracks,1);assert.equal(f.reads.fps,1);
 assert.equal(f.reads.clips0,0);assert.equal(f.reads.clips1,1);assert.equal(f.reads.baseStarts,0);
});
test('Persistent slots cannot hide moves, replacements, duplicates or lock changes between calls',()=>{
 for(const mutate of [f=>f.color[1].start.seconds++,f=>f.color[1].nodeId='replacement',f=>f.sequence.videoTracks[1].isLocked=()=>true]){
  const f=fixture(3);assert(f.call('prepareAll',preparation(f)).ok);assert.equal(f.call('applyBatch',compact([f.plans[0]])).value.applied,1);
  mutate(f);const r=f.call('applyBatch',compact([f.plans[1]]));assert(r.ok);assert.equal(r.value.applied,0);assert(r.value.error);assert.equal(f.right(1).keys.length,0);
 }
});
test('Sequence and FPS changes are detected after returning to panel',()=>{
 for(const mutate of [f=>f.app.project.documentID='different',f=>f.sequence.timebase=String(254016000000/25),f=>f.app.project.activeSequence={...f.sequence,sequenceID:'other'}]){
  const f=fixture(2);assert(f.call('prepareAll',preparation(f)).ok);mutate(f);const r=f.call('applyBatch',compact(f.plans));assert(r.ok);assert.equal(r.value.applied,0);assert(r.value.error);assert.equal(f.right(0).keys.length,0);
 }
});
test('Color cues in sparse or reversed order apply independently of white order',()=>{
 const f=fixture(120);const wanted=[0,50,20,110,40];assert(f.call('prepareAll',preparation(f)).ok);
 const r=f.call('applyBatch',compact(wanted.map(i=>f.plans[i])));assert(r.ok);assert.equal(r.value.applied,wanted.length);assert.equal(r.value.error,'');
 const g=fixture(5);g.sequence.videoTracks[0].clips=collection([g.white[4],g.white[1],g.white[0],g.white[3],g.white[2]]);
 assert(g.call('prepareAll',preparation(g)).ok);const s=g.call('applyBatch',compact(g.plans));assert(s.ok);assert.equal(s.value.applied,5);assert.equal(s.value.error,'');
});
test('Malformed compact data cannot write',()=>{
 for(const mutate of [r=>r.items[0].pop(),r=>r.items[0][1]=null,r=>r.items[0][6][0][0]=1.5,r=>r.fps=null,r=>r.items[0][6][0].pop()]){
  const f=fixture(1),req=compact(f.plans);mutate(req);const r=f.call('applyBatch',req);assert(!r.ok||r.value.applied===0);assert.equal(f.right(0).keys.length,0);
 }
});
test('Writing does not call getValueAtKey for detailed readback',()=>{
 const f=fixture(2),right=f.right(1);
 right.getValueAtKey=function(){throw Error('Readback must not run');};
 const r=f.call('applyBatch',compact(f.plans));assert(r.ok);assert.equal(r.value.applied,2);assert.equal(r.value.error,'');assert.equal(r.value.stats.verifyMs,0);assert.equal(right.keys.length,f.plans[1].items[0].keys.length);assert.equal(right.varying,true);
});
test('Starting the next video clears session without changing existing Crop',()=>{
 const f=fixture(2);assert.equal(f.call('applyBatch',compact(f.plans)).value.applied,2);
 const before=JSON.stringify(f.color.map(c=>c.components[0].properties.map(p=>({value:p.value,varying:p.varying,keys:p.keys}))));
 assert.equal(f.call('forgetSession',{}).value.forgotten,2);
 assert.equal(JSON.stringify(f.color.map(c=>c.components[0].properties.map(p=>({value:p.value,varying:p.varying,keys:p.keys})))),before);
 f.sequence.videoTracks[1].clips=collection(f.plans.map((p,i)=>clip(p.items[0].id,i*3)));
 assert(f.call('prepareAll',preparation(f)).ok);const r=f.call('applyBatch',compact(f.plans));assert(r.ok);assert.equal(r.value.applied,2);assert.equal(r.value.error,'');
});
test('Staged plan cache handles more than 1000 cues and tiny continuation requests',()=>{
 const f=fixture(2313),request=compact(f.plans);request.count=500;
 let r=f.call('beginRun',request);assert(r.ok,JSON.stringify(r));assert.equal(r.value.applied,500);
 assert.equal(r.value.total,2313);assert.equal(r.value.position,500);assert.equal(r.value.error,'');
 const token=r.value.token;let position=r.value.position;
 while(position<2313){
  const next={token,position,count:500,maxMillis:8000};assert(JSON.stringify(next).length<150);
  r=f.call('continueRun',next);assert(r.ok,JSON.stringify(r));assert.equal(r.value.error,'');position=r.value.position;
 }
 assert.equal(position,2313);
 f.plans.forEach((p,i)=>assert.equal(f.right(i).keys.length,p.items[0].keys.length));
});
test('Staged batches skip repeated speed checks when writing',()=>{
 const f=fixture(8),checks=Array(8).fill(0);
 f.color.forEach((c,i)=>c.getSpeed=()=>{checks[i]++;return 1;});
 const req=compact(f.plans);req.count=3;
 const r=f.call('beginRun',req);assert(r.ok);assert.equal(r.value.applied,3);assert.deepEqual(checks,[0,0,0,0,0,0,0,0]);
 const next=f.call('continueRun',{token:r.value.token,position:3,count:3,maxMillis:8000});
 assert(next.ok);assert.equal(next.value.applied,3);assert.deepEqual(checks,[0,0,0,0,0,0,0,0]);
});
test('Invalid later cues stop when reached without a full pre-scan',()=>{
 for(const mutate of [f=>f.color[9].end.seconds++,f=>f.right(9).varying=true]){
  const f=fixture(10);mutate(f);const req=compact(f.plans);req.count=3;
  let r=f.call('beginRun',req);assert(r.ok);assert.equal(r.value.applied,3);
  r=f.call('continueRun',{token:r.value.token,position:3,count:3,maxMillis:8000});assert(r.ok);assert.equal(r.value.applied,3);
  r=f.call('continueRun',{token:r.value.token,position:6,count:3,maxMillis:8000});assert(r.ok);assert.equal(r.value.applied,3);
  r=f.call('continueRun',{token:r.value.token,position:9,count:1,maxMillis:8000});assert(r.ok);assert.equal(r.value.applied,0);assert(r.value.error);
  for(let i=0;i<9;i++)assert(f.right(i).keys.length>0);
  assert.equal(f.right(9).keys.length,0);
 }
});
test('Staged cache never hides live changes after an asynchronous yield',()=>{
 for(const mutate of [f=>f.color[1].start.seconds++,f=>f.sequence.videoTracks[1].isLocked=()=>true,f=>f.right(1).varying=true,f=>f.color[1].components.push({displayName:'Crop',matchName:'AE.ADBE Crop'}),f=>f.sequence.timebase=String(254016000000/25)]){
  const f=fixture(3);const req=compact(f.plans);req.count=1;const first=f.call('beginRun',req);assert(first.ok);assert.equal(first.value.applied,1);
  mutate(f);f.color[1].components.numItems=f.color[1].components.length;
  const r=f.call('continueRun',{token:first.value.token,position:1,count:2,maxMillis:8000});
  assert(!r.ok||r.value.applied===0);assert.equal(f.right(1).keys.length,0);
 }
});
test('Staged cursors reject duplicated calls, expired tokens and invalid limits',()=>{
 const f=fixture(4),req=compact(f.plans);req.count=1;const first=f.call('beginRun',req);assert(first.ok);
 for(const change of [{position:0},{token:first.value.token+1},{count:5001},{count:0}]){
  const r=f.call('continueRun',{token:first.value.token,position:1,count:1,maxMillis:8000,...change});assert.equal(r.ok,false);
 }
 assert.equal(f.right(1).keys.length,0);
 f.call('forgetSession',{});
 assert.equal(f.call('continueRun',{token:first.value.token,position:1,count:1,maxMillis:8000}).ok,false);
});
test('Staged budget includes complete cues and preserves cached remainder',()=>{
 const f=fixture(7);let clock=0;f.context.Date=class {getTime(){return clock;}};
 f.color.forEach((c,i)=>f.right(i).onWrite=t=>{if(t.seconds===100)clock+=4500;});
 const req=compact(f.plans);req.count=5;
 let r=f.call('beginRun',req);assert(r.ok);assert.equal(r.value.applied,2);
 let position=r.value.position,token=r.value.token;
 while(position<7){r=f.call('continueRun',{token,position,count:5,maxMillis:8000});assert(r.ok);position=r.value.position;}
 assert.equal(position,7);f.plans.forEach((p,i)=>assert.equal(f.right(i).keys.length,p.items[0].keys.length));
});

test('5000-cue limit preserves all frame times, values and interpolation',()=>{
 const f=fixture(5000),req=compact(f.plans);req.count=5000;req.maxMillis=30000;
 const r=f.call('beginRun',req);assert(r.ok,JSON.stringify(r));assert.equal(r.value.applied,5000);assert.equal(r.value.error,'');
 for(let i=0;i<5000;i++)f.plans[i].items[0].keys.forEach((k,j)=>assert.deepEqual(f.right(i).keys[j],{seconds:100+k.frame/30,value:k.value,interp:k.interp}));
});
test('Fast write omits white-track access, support checks and keyframe readback',()=>{
 const f=fixture(50,{meters:true});Object.defineProperty(f.sequence.videoTracks[0],'clips',{get(){throw Error('White access');}});
 const r=f.call('applyBatch',compact(f.plans));assert(r.ok);assert.equal(r.value.applied,50);
 for(const name of ['getSpeed','isSpeedReversed','areKeyframesSupported','getValueAtKey','baseStarts'])assert.equal(f.reads[name]||0,0,name);
 assert.equal(f.reads.getKeys,50);assert.equal(f.reads.timeObjects,2);assert.equal(r.value.stats.verifyMs,0);
});
test('Final refresh retains the last successful time after a later write fails',()=>{
 const f=fixture(2);f.plans[1].items[0].inPoint=110;f.color[1].inPoint.seconds=110;
 f.right(1).onWrite=()=>{throw Error('Write failure at a different time');};
 const r=f.call('applyBatch',compact(f.plans));assert(r.ok);assert.equal(r.value.applied,1);assert.equal(r.value.warning,'');assert.equal(f.right(0).refreshes,1);assert.equal(f.right(1).keys.length,0);
});
test('Undo checks the expected written state and preserves subsequent user edits',()=>{
 const f=fixture(2);assert.equal(f.call('applyBatch',compact(f.plans)).value.applied,2);
 f.right(0).keys[0].value+=1;const edited=JSON.stringify(f.right(0).keys);
 const r=f.call('undo',{});assert(r.ok);assert.equal(r.value.restored,1);assert.equal(r.value.remaining,1);assert.equal(JSON.stringify(f.right(0).keys),edited);assert.equal(f.right(1).keys.length,0);
});
test('Nonzero native write errors still stop and roll back the affected cue',()=>{
 const f=fixture(2);f.right(1).setValueAtKey=()=>7;
 const r=f.call('applyBatch',compact(f.plans));assert(r.ok);assert.equal(r.value.applied,1);assert(r.value.error.includes('mã 7'));assert.equal(f.right(1).keys.length,0);
});

test('Fast scan reads clip metadata without opening Crop or checking speed',()=>{
 const f=fixture(2429,{meters:true}),r=f.call('inspect',{track:2,selectedOnly:false,fast:true});
 assert(r.ok,JSON.stringify(r));assert.equal(r.value.clips.length,2429);
 for(const name of ['cropCollections','getSpeed','isSpeedReversed','isTimeVarying','getKeys','getValue','getValueAtKey'])assert.equal(f.reads[name]||0,0,name);
 assert.equal(f.reads.colorStarts,2429);assert.deepEqual(r.value.clips[8],{id:'color8',track:1,start:24,end:26,inPoint:100,name:'Graphic',managed:false,error:'',changed:false});
 const req=compact(f.plans);req.count=2500;const applied=f.call('beginRun',req);assert(applied.ok);assert.equal(applied.value.applied,2429);
 assert.equal(f.reads.colorStarts,2429*2,'Cached slots avoid a second full timing-index pass');
 for(let i=0;i<2429;i++)f.plans[i].items[0].keys.forEach((k,j)=>assert.deepEqual(f.right(i).keys[j],{seconds:100+k.frame/30,value:k.value,interp:k.interp}));
});
test('Missing or duplicate Crop is rejected when writing after a fast scan',()=>{
 for(const components of [[],[{displayName:'Crop',matchName:'AE.ADBE Crop'},{displayName:'Crop',matchName:'AE.ADBE Crop'}]]){
  const f=fixture(3);f.color[1].components=collection(components);
  const scan=f.call('inspect',{track:2,fast:true});assert(scan.ok);assert.equal(scan.value.clips.length,3);
  const req=compact(f.plans);req.count=3;const r=f.call('beginRun',req);assert(r.ok);assert.equal(r.value.applied,1);assert(r.value.error.includes('đúng 1 hiệu ứng Crop'));assert.equal(f.right(2).keys.length,0);
 }
});
test('Fast scanned slots do not hide moved or replaced clips before apply',()=>{
 for(const mutate of [f=>f.color[0].start.seconds++,f=>f.color[0].nodeId='replacement',f=>f.sequence.videoTracks[1].isLocked=()=>true]){
  const f=fixture(3);assert(f.call('inspect',{track:2,fast:true}).ok);mutate(f);
  const req=compact(f.plans);req.count=3;const r=f.call('beginRun',req);assert(r.ok);assert.equal(r.value.applied,0);assert(r.value.error);assert.equal(f.right(0).keys.length,0);
 }
});
test('Fast selected scan caches actual slots and remains compatible with full preparation',()=>{
 const f=fixture(5);f.color.forEach((c,i)=>c.isSelected=()=>i%2===1);
 const scan=f.call('inspect',{track:2,selectedOnly:true,fast:true});assert(scan.ok);assert.deepEqual(scan.value.clips.map(c=>c.id),['color1','color3']);
 assert(f.call('prepareAll',preparation(f)).ok);
 const r=f.call('applyBatch',compact([f.plans[1],f.plans[3]]));assert(r.ok);assert.equal(r.value.applied,2);assert.equal(f.right(0).keys.length,0);
});
test('Fast scan tracks completed cues but full scan still checks user edits',()=>{
 const f=fixture(2);assert.equal(f.call('applyBatch',compact(f.plans)).value.applied,2);f.right(0).keys[0].value++;
 const fast=f.call('inspect',{track:2,fast:true});assert(fast.ok);assert(fast.value.clips.every(c=>c.managed));
 const full=f.call('inspect',{track:2});assert(full.ok);assert(full.value.clips[0].error.includes('Crop đã thay đổi'));assert.equal(full.value.clips[1].error,'');
 f.color[0].start.seconds+=10;f.color[0].end.seconds+=10;const next=f.call('inspect',{track:2,fast:true});assert(next.ok);assert.equal(next.value.clips[0].managed,false);
});
