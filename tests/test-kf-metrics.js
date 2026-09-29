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
 assert.equal(s.kfExistingKeys,0);assert.equal(s.kfKeysRemoved,0);assert.equal(s.kfCuesWithZeroKeys,N);assert.equal(s.kfCuesWithOneKey,0);assert.equal(s.kfCuesWithManyKeys,0); // mock creates no automatic key
 assert.equal(s.staticValueWrites,0);
 ['kfSetTimeVaryingMs','kfGetKeysMs','kfRemoveKeyMs','kfTimeObjectMs','kfAddKeyMs','kfSetValueAtKeyMs','kfSetInterpolationMs','staticWriteMs'].forEach(k=>assert(typeof s[k]==='number'&&s[k]>=0,k));
 assert.equal(s.timerSource,'date'); // no $.hiresTimer outside Premiere
});
test('automatic keys after setTimeVarying(true) are counted and removed',()=>{
 const f=fixture(N,{json2:true});
 for(let i=0;i<N;i++){const p=right(f,i);p.setTimeVarying=function(v){this.varying=v;if(v)this.keys.push({seconds:1,value:0});return 0;};}
 const r=run(f),s=r.value.stats;assert(r.ok,JSON.stringify(r));
 assert.equal(s.kfExistingKeys,N);assert.equal(s.kfKeysRemoved,N);assert.equal(s.kfCuesWithOneKey,N);assert.equal(s.kfCuesWithZeroKeys,0);
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
const PF_MS=['pfTrackVideoTracksMs','pfTrackNumTracksMs','pfTrackRefMs','pfTrackClipsMs','pfTrackNumItemsMs','pfTrackLockedMs','pfClipRefMs','pfNodeIdMs','pfStartMs','pfEndMs','pfInPointMs','pfCropComponentsMs','pfCropComponentRefMs','pfCropPropertiesMs','pfCropPropertyNamesMs','pfIsTimeVaryingMs','pfGetValueMs','pfOtherMs'];
test('preflight read counters equal the expected reads per cue and per call (after an inspect, like the panel)',()=>{
 const f=fixture(N,{json2:true});assert(f.call('inspect',{track:2,fast:true}).ok);const s=run(f).value.stats;
 PF_MS.forEach(k=>assert.equal(typeof s[k],'number',k));
 assert.equal(s.pfClipRefReads,N);assert.equal(s.pfNodeIdReads,N);assert.equal(s.pfStartReads,N);assert.equal(s.pfEndReads,N);assert.equal(s.pfInPointReads,N);
 assert.equal(s.pfIsTimeVaryingCalls,4*N);assert.equal(s.pfGetValueCalls,4*N);
 assert.equal(typeof s.activeSequenceAfterWritesMs,'number');assert.equal(typeof s.setupActiveSequenceRepeatMs,'number');
});
test('Adobe track/sequence reads stay constant when the number of cues grows (no per-cue collection access)',()=>{
 const reads=n=>{const f=fixture(n,{json2:true});Object.keys(f.reads).forEach(k=>f.reads[k]=0);run(f,n);return {sequence:f.reads.sequence,tracks:f.reads.tracks,clips1:f.reads.clips1,fps:f.reads.fps};};
 assert.deepEqual(reads(60),reads(240));
});
test('inspect reports every read-side timer and does not change its result',()=>{
 const f=fixture(N,{json2:true}),r=f.call('inspect',{track:2,selectedOnly:false,fast:true});assert(r.ok);
 const s=r.value.stats;
 ['inspSettingsMs','inspVideoTracksMs','inspNumTracksMs','inspTrackRefMs','inspClipsMs','inspNumItemsMs','inspClipRefMs','inspIsSelectedMs','inspNodeIdMs','inspStartMs','inspEndMs','inspInPointMs','inspNameMs','inspSummaryMs','inspActiveSequenceAgainMs','inspOtherMs','setupActiveSequenceMs','setupActiveSequenceRepeatMs'].forEach(k=>assert.equal(typeof s[k],'number',k));
 assert.equal(s.inspClips,N);assert.equal(s.inspClipsRead,N);
 assert.equal(r.value.clips.length,N);assert.deepEqual(Object.keys(r.value.clips[0]),['id','track','start','end','inPoint','name','managed','error','changed']);
 assert.equal(r.value.clips[0].name,'Graphic');assert.equal(r.value.fps,30);assert.equal(r.value.width,1920);
 const sel=f.call('inspect',{track:2,selectedOnly:true,fast:true}).value.stats;assert.equal(sel.inspClipsRead,N);
});
test('session context reports call serial, inspect/forget/undo counts and writes so far',()=>{
 const f=fixture(N,{json2:true});
 const a=f.call('inspect',{track:2,fast:true}).profile.session;
 assert.equal(a.hostCallSerial,1);assert.equal(a.sessionInspectCalls,0);assert.equal(a.sinceLastWriteMs,-1);
 const w=run(f),b=w.profile.session;assert.equal(b.hostCallSerial,2);assert.equal(b.sessionInspectCalls,1);assert.equal(b.sessionHistory,0);
 const c=f.call('inspect',{track:2,fast:true}).profile.session;
 assert.equal(c.hostCallSerial,3);assert.equal(c.sessionHistory,N);assert.equal(c.sessionKeyframesWritten,w.value.stats.keyframes);assert(c.sinceLastWriteMs>=0);
 f.call('forgetSession',{});f.call('undo',{});
 const d=f.call('inspect',{track:2,fast:true}).profile.session;assert.equal(d.sessionForgetCalls,1);assert.equal(d.sessionUndoCalls,1);
});
