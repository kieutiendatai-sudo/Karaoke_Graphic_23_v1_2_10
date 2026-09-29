'use strict';
// Aggregated keyframe/write and setup counters, and what a second run over processed Graphics does.
const assert=require('node:assert/strict');
const {fixture,compact}=require('./test-batch-host');
function test(name,fn){fn();console.log('PASS '+name);}
const N=30;
function run(f,n=N){const req=compact(f.plans);req.count=n;req.maxMillis=30000;return f.call('beginRun',req);}
const right=(f,i)=>f.color[i].components[0].properties[2];
test('keyframe counters match the writes actually made',()=>{
 const f=fixture(N,{json2:true}),r=run(f);assert(r.ok,JSON.stringify(r));const s=r.value.stats,kfs=s.keyframes;
 assert.equal(s.kfSetTimeVaryingCalls,N);assert.equal(s.kfGetKeysCalls,N);
 assert.equal(s.kfKeysAdded,kfs);assert.equal(s.kfValuesWritten,kfs);assert.equal(s.kfInterpolationWrites,kfs);
 assert.equal(s.kfExistingKeys,0);assert.equal(s.kfKeysRemoved,0);assert.equal(s.kfCuesWithUnexpectedKeys,N); // mock creates no automatic key
 assert.equal(s.staticValueWrites,0);
 ['kfSetTimeVaryingMs','kfGetKeysMs','kfRemoveKeyMs','kfTimeObjectMs','kfAddKeyMs','kfSetValueAtKeyMs','kfSetInterpolationMs','staticWriteMs'].forEach(k=>assert(typeof s[k]==='number'&&s[k]>=0,k));
 assert.equal(s.timerSource,'date'); // no $.hiresTimer outside Premiere
});
test('automatic keys after setTimeVarying(true) are counted and removed',()=>{
 const f=fixture(N,{json2:true});
 for(let i=0;i<N;i++){const p=right(f,i);p.setTimeVarying=function(v){this.varying=v;if(v)this.keys.push({seconds:1,value:0});return 0;};}
 const r=run(f),s=r.value.stats;assert(r.ok,JSON.stringify(r));
 assert.equal(s.kfExistingKeys,N);assert.equal(s.kfKeysRemoved,N);assert.equal(s.kfCuesWithUnexpectedKeys,0);
 f.plans.forEach((p,i)=>assert.equal(right(f,i).keys.length,p.items[0].keys.length));
});
test('static Crop value writes are counted separately from keyframe writes',()=>{
 const f=fixture(N,{json2:true});f.color[3].components[0].properties[0].value=5;f.color[7].components[0].properties[3].value=2;
 const r=run(f),s=r.value.stats;assert(r.ok,JSON.stringify(r));
 assert.equal(s.staticValueWrites,2);assert.equal(s.skippedWrites,3*N-2);assert.equal(s.kfKeysAdded,s.keyframes);
});
test('setup counters are reported and add up to setupMs',()=>{
 const f=fixture(N,{json2:true}),s=run(f).value.stats;
 ['setupAppVersionMs','setupActiveSequenceMs','setupProjectIdMs','setupSequenceIdMs','setupTimebaseMs','setupUnattributedMs','setupMs'].forEach(k=>assert.equal(typeof s[k],'number',k));
 const parts=s.setupAppVersionMs+s.setupActiveSequenceMs+s.setupProjectIdMs+s.setupSequenceIdMs+s.setupTimebaseMs+s.setupUnattributedMs;
 assert(Math.abs(parts-s.setupMs)<0.01,parts+' vs '+s.setupMs);
});
test('a second run over processed Graphics stops at the first cue before any Premiere write',()=>{
 const f=fixture(N,{json2:true});assert.equal(run(f).value.applied,N);
 const before=f.color.reduce((n,c)=>n+c.components[0].properties[2].keys.length,0);
 const again=run(f);assert(again.ok);assert.equal(again.value.applied,0);assert.match(again.value.error,/Clip đã chạy/);
 assert.equal(again.value.stats.kfSetTimeVaryingCalls,0);assert.equal(again.value.stats.kfKeysAdded,0);
 assert.equal(f.color.reduce((n,c)=>n+c.components[0].properties[2].keys.length,0),before);
 // a new session (history forgotten) sees the existing animation and refuses to overwrite it
 assert(f.call('forgetSession',{}).ok);
 const fresh=run(f);assert.equal(fresh.value.applied,0);assert.match(fresh.value.error,/Crop có keyframe sẵn/);assert.equal(fresh.value.stats.kfKeysAdded,0);
});
test('run, Undo, run again applies normally and reports the same write counts',()=>{
 const f=fixture(N,{json2:true}),a=run(f).value.stats;
 assert.equal(f.call('undo',{}).value.restored,N);
 const b=run(f),s=b.value.stats;assert(b.ok);assert.equal(b.value.applied,N);
 ['kfKeysAdded','kfValuesWritten','kfInterpolationWrites','kfSetTimeVaryingCalls','keyframes'].forEach(k=>assert.equal(s[k],a[k],k));
});
