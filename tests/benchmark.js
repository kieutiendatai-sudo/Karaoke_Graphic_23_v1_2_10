'use strict';
// Compare mocked scan/write API counts. This does not measure Premiere runtime.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixture,compact}=require('./test-batch-host');
const root=path.resolve(__dirname,'..'),count=2429,limit=2500;
function measure(folder,fast){
 const source=fs.readFileSync(path.join(folder,'extension/jsx/host.jsx'),'utf8').replace(/^#include.*$/m,'');
 const f=fixture(count,{hostSource:source,json2:true,meters:true}),req=compact(f.plans);req.count=limit;req.maxMillis=30000;
 Object.keys(f.reads).forEach(k=>f.reads[k]=0);
 const scan=f.call('inspect',{track:2,selectedOnly:false,fast});assert(scan.ok,JSON.stringify(scan));assert.equal(scan.value.clips.length,count);
 const scanNativeCalls={...f.reads};
 let r=f.call('beginRun',req),calls=2;assert(r.ok,JSON.stringify(r));assert.equal(r.value.error,'');
 while(r.value.position<count){r=f.call('continueRun',{token:r.value.token,position:r.value.position,count:limit,maxMillis:30000});calls++;assert(r.ok,JSON.stringify(r));assert.equal(r.value.error,'');}
 const combinedNativeCalls={...f.reads};
 for(let i=0;i<count;i++)f.plans[i].items[0].keys.forEach((k,j)=>assert.deepEqual(f.right(i).keys[j],{seconds:100+k.frame/30,value:k.value,interp:k.interp}));
 return {batchLimit:limit,hostCalls:calls,keyframes:f.color.reduce((n,c)=>n+c.components[0].properties[2].keys.length,0),scanNativeCalls,combinedNativeCalls};
}
// Per-operation counters for the current host. Counters are keyed by property/method name;
// numItems is split by the collection it was read from. Mock counts, not Premiere time.
function detailed(shape){
 const source=fs.readFileSync(path.join(root,'extension/jsx/host.jsx'),'utf8').replace(/^#include.*$/m,'');
 const f=fixture(count,{hostSource:source,json2:true});
 const counts={};
 const bump=k=>{counts[k]=(counts[k]||0)+1;};
 function wrap(o,parent){
  if(o===null||(typeof o!=='object'&&typeof o!=='function'))return o;
  return new Proxy(o,{get(t,k,r){
   if(typeof k==='symbol')return Reflect.get(t,k,r);
   const v=Reflect.get(t,k,r),name=k==='numItems'?parent+'.numItems':/^\d+$/.test(k)?null:k;
   if(typeof v==='function')return function(...a){bump(k+'()');return v.apply(t,a);};
   if(name)bump(name);
   return wrap(v,/^\d+$/.test(k)?parent:k);
  }});
 }
 if(shape.extraComponents||shape.extraCropProps)for(const c of f.color){
  const crop=c.components[0];
  for(let i=0;i<shape.extraCropProps;i++){crop.properties.push({displayName:i?'Edge Feather':'Zoom',isTimeVarying:()=>false,getValue:()=>0});}
  crop.properties.numItems=crop.properties.length;
  for(let i=0;i<shape.extraComponents;i++)c.components.push({displayName:'Effect'+i,matchName:'ADBE Effect'+i,properties:Object.assign([],{numItems:0})});
  c.components.numItems=c.components.length;
 }
 const arr=f.sequence.videoTracks[1].clips;for(let i=0;i<arr.length;i++)arr[i]=wrap(arr[i],'clip');
 const req=compact(f.plans);req.count=limit;req.maxMillis=30000;
 const take=()=>{const out={...counts};for(const k of Object.keys(counts))delete counts[k];return out;};
 const scan=f.call('inspect',{track:2,selectedOnly:false,fast:true});assert(scan.ok,JSON.stringify(scan));
 const inspect=take();
 const r=f.call('beginRun',req);assert(r.ok,JSON.stringify(r));assert.equal(r.value.applied,count);
 const apply=take();
 const perCue={};for(const k of Object.keys(apply))perCue[k]=+(apply[k]/count).toFixed(3);
 return {shape,inspect,apply,applyPerCue:perCue,hostStatsKeys:Object.keys(r.value.stats),hostProfileKeys:Object.keys(JSON.parse(f.context.KG23.call('inspect',encodeURIComponent(JSON.stringify({track:2,fast:true})))).profile)};
}
const previous=process.argv[2]||path.join(root,'..','Karaoke_Graphic_23_v1_2_9_FAST');
const result={type:'Selected mocked API counts; not Premiere runtime',cues:count};
if(fs.existsSync(path.join(previous,'extension/jsx/host.jsx')))result['v1.2.9']=measure(previous,false);
result['v1.2.10']=measure(root,true);
result.detailedCounts={fixtureShape:detailed({extraComponents:0,extraCropProps:0}),assumedRealShape:detailed({extraComponents:4,extraCropProps:2})};
process.stdout.write(JSON.stringify(result,null,2)+'\n');
