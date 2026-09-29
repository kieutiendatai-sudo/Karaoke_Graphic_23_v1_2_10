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
const previous=process.argv[2]||path.join(root,'..','Karaoke_Graphic_23_v1_2_9_FAST');
process.stdout.write(JSON.stringify({type:'Selected mocked API counts; not Premiere runtime',cues:count,'v1.2.9':measure(previous,false),'v1.2.10':measure(root,true)},null,2)+'\n');
