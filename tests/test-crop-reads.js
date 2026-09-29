'use strict';
// Crop lookup read counts on the write path, and unchanged validation rules.
const assert=require('node:assert/strict');
const {fixture,compact}=require('./test-batch-host');
function test(name,fn){fn();console.log('PASS '+name);}
const N=50;
function shaped(extraComponents){
 const f=fixture(N,{json2:true}),counts={};
 const bump=k=>{counts[k]=(counts[k]||0)+1;};
 function wrap(o,parent){
  if(o===null||(typeof o!=='object'&&typeof o!=='function'))return o;
  return new Proxy(o,{get(t,k,r){
   if(typeof k==='symbol')return Reflect.get(t,k,r);
   const v=Reflect.get(t,k,r);
   if(typeof v==='function')return function(...a){bump(k+'()');return v.apply(t,a);};
   const numeric=/^\d+$/.test(k);
   if(!numeric)bump(k==='numItems'?parent+'.numItems':k);
   return wrap(v,numeric?parent:k);
  }});
 }
 const zoomFeather=(name,value)=>({displayName:name,value,isTimeVarying:()=>false,getValue:()=>value});
 for(const c of f.color){
  const crop=c.components[0];crop.properties.push(zoomFeather('Zoom',false),zoomFeather('Edge Feather',0));crop.properties.numItems=crop.properties.length;
  for(let i=0;i<extraComponents;i++)c.components.push({displayName:'Effect'+i,matchName:'ADBE Effect'+i,properties:Object.assign([],{numItems:0})});
  c.components.numItems=c.components.length;
 }
 const arr=f.sequence.videoTracks[1].clips;for(let i=0;i<arr.length;i++)arr[i]=wrap(arr[i],'clip');
 const req=compact(f.plans);req.count=N;req.maxMillis=30000;
 assert(f.call('inspect',{track:2,selectedOnly:false,fast:true}).ok);
 for(const k of Object.keys(counts))delete counts[k];
 const r=f.call('beginRun',req);assert(r.ok,JSON.stringify(r));assert.equal(r.value.applied,N);assert.equal(r.value.error,'');
 return {f,counts,per:k=>(counts[k]||0)/N};
}
test('write path reads properties.numItems once and stops after the 4 needed properties',()=>{
 const a=shaped(0);
 assert.equal(a.per('properties.numItems'),1);
 assert.equal(a.per('displayName'),4);          // was 6 (Zoom and Edge Feather were also read)
 assert.equal(a.per('components.numItems'),1);
 assert.equal(a.per('matchName'),1);
 const b=shaped(4);
 assert.equal(b.per('displayName'),8);          // 4 other components + 4 Crop properties
 assert.equal(b.per('matchName'),5);            // every component is still checked on every cue
});
test('write path still enforces exactly one Crop on every cue',()=>{
 const f=fixture(3,{json2:true});
 const extra=f.color[1].components[0];f.color[1].components.push(Object.assign({},extra));f.color[1].components.numItems=2;
 const req=compact(f.plans);req.count=3;req.maxMillis=30000;
 const r=f.call('beginRun',req);assert(r.ok);assert.equal(r.value.applied,1);assert.match(r.value.error,/đúng 1 hiệu ứng Crop/);
});
test('write path still rejects existing animation and missing properties',()=>{
 const f=fixture(2,{json2:true});f.color[0].components[0].properties[2].varying=true;
 const req=compact(f.plans);req.count=2;req.maxMillis=30000;
 assert.match(f.call('beginRun',req).value.error,/Crop có keyframe sẵn/);
 const g=fixture(2,{json2:true});g.color[0].components[0].properties.pop();g.color[0].components[0].properties.numItems=3;
 const r2=compact(g.plans);r2.count=2;r2.maxMillis=30000;
 assert.match(g.call('beginRun',r2).value.error,/Không nhận diện thuộc tính Crop/);
});
test('full (non-quick) Crop check still reads and validates Zoom and Edge Feather',()=>{
 for(const [name,value,pattern] of [['Zoom',true,/Tắt Zoom/],['Edge Feather',5,/Edge Feather/]]){
  const f=fixture(1,{json2:true});const props=f.color[0].components[0].properties;
  props.push({displayName:name,isTimeVarying:()=>false,getValue:()=>value});props.numItems=props.length;
  const r=f.call('inspect',{track:2,selectedOnly:false});assert(r.ok);assert.match(r.value.clips[0].error,pattern);
 }
});
