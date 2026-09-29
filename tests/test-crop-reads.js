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
test('write path: first cue scans fully, later cues use the cached structure with light validation',()=>{
 const a=shaped(0),t=k=>a.counts[k]||0;
 assert.equal(t('properties.numItems'),N);                 // one read per cue (full scan and cache check)
 assert.equal(t('displayName'),4*N);                       // 4 required property names per cue
 assert.equal(t('components.numItems'),N);
 assert.equal(t('matchName'),N);
 const b=shaped(4),u=k=>b.counts[k]||0;
 assert.equal(u('displayName'),4*N+4);                     // + 4 other components, first cue only
 assert.equal(u('matchName'),5+(N-1));                     // 5 on the first cue, 1 on every later cue
 assert.equal(u('components.numItems'),N);
 assert.equal(u('properties.numItems'),N);
});
test('cache statistics are reported (hits and full scans)',()=>{
 const a=shaped(4),s=a.f.call('inspect',{track:2,fast:true});assert(s.ok);
 const g=fixture(20,{json2:true}),req=compact(g.plans);req.count=20;req.maxMillis=30000;
 const r=g.call('beginRun',req);assert.equal(r.value.stats.cropFullScans,1);assert.equal(r.value.stats.cropCacheHits,19);
});
function runWith(mutate,n=4){
 const f=fixture(n,{json2:true});mutate(f);
 const req=compact(f.plans);req.count=n;req.maxMillis=30000;
 return {f,r:f.call('beginRun',req)};
}
const crop=(f,i)=>f.color[i].components;
test('a different component count falls back to the full scan and refreshes the cache',()=>{
 const {f,r}=runWith(f=>{const c=crop(f,1);c.push({displayName:'X',matchName:'ADBE X',properties:Object.assign([],{numItems:0})});c.numItems=2;});
 assert(r.ok);assert.equal(r.value.error,'');assert.equal(r.value.applied,4);
 assert.equal(r.value.stats.cropFullScans,3);assert.equal(r.value.stats.cropCacheHits,1); // cue0 learns, cue1 (2 components) and cue2 (1 component) miss, cue3 hits
});
test('same count but Crop at another index falls back and writes to the real Crop',()=>{
 const {f,r}=runWith(f=>{
  const other={displayName:'X',matchName:'ADBE X',properties:Object.assign([],{numItems:0})};
  for(let i=0;i<4;i++){const c=crop(f,i);c.push(other);c.numItems=2;}
  const c=crop(f,2),crop0=c[0];c[0]=c[1];c[1]=crop0; // cue 2: [X, Crop]
 });
 assert(r.ok);assert.equal(r.value.error,'');assert.equal(r.value.applied,4);
 for(let i=0;i<4;i++){const real=crop(f,i).find(c=>c.matchName==='AE.ADBE Crop');assert.equal(real.properties[2].keys.length,f.plans[i].items[0].keys.length);}
});
test('different property order or count falls back to the full scan',()=>{
 const {f,r}=runWith(f=>{
  const props=crop(f,1)[0].properties,left=props[0];props[0]=props[2];props[2]=left; // Right first
 });
 assert(r.ok);assert.equal(r.value.error,'');assert.equal(r.value.applied,4);
 const props=crop(f,1)[0].properties;assert.equal(props[0].displayName,'Right');assert.equal(props[0].keys.length,f.plans[1].items[0].keys.length);
 assert.equal(props[2].keys.length,0);
 const g=runWith(f=>{const p=crop(f,2)[0].properties;p.push({displayName:'Zoom',isTimeVarying:()=>false,getValue:()=>false});p.numItems=5;});
 assert.equal(g.r.value.error,'');assert.equal(g.r.value.applied,4);
});
test('a duplicate Crop (different component count) is still rejected on a later cue',()=>{
 const {r}=runWith(f=>{const c=crop(f,2);c.push(Object.assign({},c[0]));c.numItems=2;});
 assert.equal(r.value.applied,2);assert.match(r.value.error,/đúng 1 hiệu ứng Crop/);
});
test('a clip whose Crop was removed is rejected on a later cue',()=>{
 const {r}=runWith(f=>{const c=crop(f,2);c.length=0;c.numItems=0;});
 assert.equal(r.value.applied,2);assert.match(r.value.error,/đúng 1 hiệu ứng Crop/);
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
const COUNTERS=['cropCacheNoShape','cropCacheComponentCountMismatch','cropCacheComponentMissing','cropCacheMatchNameMismatch','cropCachePropertyCountMismatch','cropCachePropertyMissing','cropCachePropertyNameMismatch','cropCacheOtherFailure','cropCacheLearned','cropCacheNotLearned','cropCacheHits','cropFullScans'];
test('every cache counter is reported in beginRun stats; a clean run has one no-shape miss (first cue), one learn and the rest hits',()=>{
 const {r}=runWith(()=>{},20);const s=r.value.stats;
 COUNTERS.forEach(k=>assert.equal(typeof s[k],'number',k));
 assert.deepEqual(COUNTERS.filter(k=>s[k]).map(k=>[k,s[k]]),[['cropCacheNoShape',1],['cropCacheLearned',1],['cropCacheHits',19],['cropFullScans',1]]);
 assert.equal(s.cropSample,'');assert.match(s.cropLearnSample,/components number 1, index 0, matchName AE.ADBE Crop, properties number 4/);
});
test('miss reasons are counted separately',()=>{
 const other=()=>({displayName:'X',matchName:'ADBE X',properties:Object.assign([],{numItems:0})});
 let x=runWith(f=>{const c=crop(f,1);c.push(other());c.numItems=2;}).r.value.stats;
 assert.equal(x.cropCacheComponentCountMismatch,2);assert.match(x.cropSample,/^cropCacheComponentCountMismatch: expected number 1, actual number 2/);
 x=runWith(f=>{for(let i=0;i<4;i++){const c=crop(f,i);c.push(other());c.numItems=2;}const c=crop(f,1),first=c[0];c[0]=c[1];c[1]=first;}).r.value.stats;
 assert.equal(x.cropCacheMatchNameMismatch,2); // cue1 (swapped) and cue2 (back to the original order)
 x=runWith(f=>{const p=crop(f,1)[0].properties;p.push({displayName:'Zoom',isTimeVarying:()=>false,getValue:()=>false});p.numItems=5;}).r.value.stats;
 assert.equal(x.cropCachePropertyCountMismatch,2);
 x=runWith(f=>{const p=crop(f,1)[0].properties,l=p[0];p[0]=p[2];p[2]=l;}).r.value.stats;
 assert.equal(x.cropCachePropertyNameMismatch,2);assert.match(x.cropSample,/expected string Left, actual string Right/);
});
test('exceptions inside the cache check are counted and fall back to the full scan',()=>{
 const {f,r}=runWith(f=>{Object.defineProperty(crop(f,1)[0],'properties',{get(){throw new Error('boom');}});},3);
 // the full scan for that clip reads properties too, so the error still surfaces from the original path
 assert.equal(r.value.stats.cropCacheOtherFailure,1);assert.match(r.value.error,/boom/);
});
test('Premiere-specific value shapes are visible in the counters (Number object numItems, non-Crop matchName)',()=>{
 // numItems returned as an object: strict comparison against the learned value can never match
 let s=runWith(f=>{for(let i=0;i<4;i++){const c=crop(f,i);c.numItems=new Number(1);}}).r.value.stats;
 assert.equal(s.cropCacheHits,0);assert.equal(s.cropFullScans,4);assert.equal(s.cropCacheComponentCountMismatch,3);
 assert.match(s.cropSample,/expected object 1, actual object 1/);
 // Crop found only through displayName: the shape is never learned
 s=runWith(f=>{for(let i=0;i<4;i++)crop(f,i)[0].matchName='ADBE Something';for(let i=0;i<4;i++)crop(f,i)[0].displayName='Crop';}).r.value.stats;
 assert.equal(s.cropCacheLearned,0);assert.equal(s.cropCacheNotLearned,4);assert.equal(s.cropCacheNoShape,4);assert.equal(s.cropCacheHits,0);
 assert.match(s.cropLearnSample,/^not learned: matchName ADBE Something/);
});
