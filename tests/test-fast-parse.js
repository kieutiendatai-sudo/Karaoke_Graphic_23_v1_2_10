'use strict';
// Fast (eval) parsing of trusted beginRun payloads must decode to the same object as json2 JSON.parse.
const assert=require('node:assert/strict');
const {fixture,compact}=require('./test-batch-host');
function test(name,fn){fn();console.log('PASS '+name);}
const f=fixture(2314,{json2:true}),host=f.context.KG23,json2=f.context.JSON;
// Cross-realm objects: compare through serialization (exact for doubles) and key order.
const same=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b));
function req(){const r=compact(f.plans);r.count=2500;r.maxMillis=30000;return r;}
function realistic(){
 // Non-integer doubles, negatives, exponents, zeros, escapes and non-ASCII text, like real plans.
 const r=req();
 r.items=r.items.map((row,i)=>[row[0]+'"\\/'+i,100.03333333333333+i/30,101.13333333333334+i/7,0.1+i*1e-9,0,0,[[0,52.083333333333336,4],[7,-1e-7,4],[13,99.99999999999999,0],[29,5e-324*0+1.5e21,4]]]);
 r.project='Dự án Karaoke|abc';
 return r;
}
test('beginRun payload uses the fast path and matches json2 exactly (fixture plan)',()=>{
 const text=JSON.stringify(req()),fast=host.parsePayload('beginRun',text);
 assert.equal(fast.mode,'eval');same(fast.value,json2.parse(text));same(fast.value,JSON.parse(text));
});
test('realistic doubles, escapes, non-ASCII text decode identically',()=>{
 const text=JSON.stringify(realistic()),fast=host.parsePayload('beginRun',text);
 assert.equal(fast.mode,'eval');same(fast.value,json2.parse(text));
 fast.value.items.forEach((row,i)=>assert.equal(row[1],JSON.parse(text).items[i][1]));
});
test('other methods keep the json2 path',()=>{
 for(const m of ['inspect','continueRun','undo','resetBatch','applyBatch']){
  const text=JSON.stringify({track:2,fast:true,token:1,position:0,count:5});
  const r=host.parsePayload(m,text);assert.equal(r.mode,'json2');same(r.value,json2.parse(text));
 }
 assert.equal(host.parsePayload('undo','').mode,'none');same(host.parsePayload('undo','').value,{});
});
test('untrusted-looking or unsafe text is never evaluated',()=>{
 f.context.evil=0;
 assert.throws(()=>host.parsePayload('beginRun','{"a":(function(){evil=1})()}'));
 assert.equal(f.context.evil,0);
 assert.throws(()=>host.parsePayload('beginRun','{"a":1'));
 assert.throws(()=>host.parsePayload('beginRun','{"a":evil=2}'));
 assert.equal(f.context.evil,0);
 const eq=host.parsePayload('beginRun','{"id":"AB==","items":[]}');assert.equal(eq.mode,'json2-fallback');same(eq.value,{id:'AB==',items:[]});
});
test('U+2028 in a string decodes identically (ES3 eval rejects it and falls back; V8 accepts it)',()=>{
 const text='{"project":"a b","items":[[1,2]]}',r=host.parsePayload('beginRun',text);
 assert(['eval','json2-fallback'].includes(r.mode));same(r.value,json2.parse(text));
});
test('beginRun through KG23.call reports fast mode and writes the same keyframes',()=>{
 const g=fixture(300,{json2:true});
 const p=compact(g.plans);p.count=300;p.maxMillis=30000;
 const out=g.call('beginRun',p);assert(out.ok,JSON.stringify(out));assert.equal(out.profile.jsonMode,'eval');
 assert.equal(out.value.applied,300);
 for(let i=0;i<300;i++)g.plans[i].items[0].keys.forEach((k,j)=>assert.deepEqual(g.right(i).keys[j],{seconds:100+k.frame/30,value:k.value,interp:k.interp}));
 ['payloadChars','decodeMs','jsonMs','parseMs','hostMs'].forEach(k=>assert.equal(typeof out.profile[k],'number'));
});
