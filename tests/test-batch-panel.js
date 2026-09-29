'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('../extension/js/core.js'),root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'extension/index.html'),'utf8'),panel=fs.readFileSync(path.join(root,'extension/js/panel.js'),'utf8');
const noop=()=>{};
async function fixture(options={}){
 const elements={},groups=[],plans=[],requests=[],writes=[],calculations={timing:0,items:0};let pending=null,cached=null,cursor=0,serial=0;
 const canvas={clearRect:noop,save:noop,restore:noop,scale:noop,fillText:noop,beginPath:noop,rect:noop,clip:noop,measureText:s=>({width:s.length*20})};
 class Element {
  constructor(id){this.id=id;this.value='';this.children=[];this.events={};this.width=960;this.height=240;this.checked=false;this.disabled=false;}
  set textContent(s){this.content=s;this.children=[];}get textContent(){return this.content||'';}
  addEventListener(n,fn){this.events[n]=fn;}dispatch(n){this.events[n].call(this);}
  appendChild(el){if(el.id==='fragment'){el.children.forEach(child=>this.appendChild(child));return;}this.children.push(el);if(this.id==='cueList'&&this.children.length===1)this.value=el.value;}
  insertRow(){const e=new Element('');this.children.push(e);return e;}insertCell(){return this.insertRow();}getContext(){return canvas;}
 }
 for(const m of html.matchAll(/id="([^"]+)"/g))elements[m[1]]=new Element(m[1]);
 for(const m of html.matchAll(/<input\b[^>]*id="([^"]+)"[^>]*>/g)){const value=m[0].match(/value="([^"]*)"/);if(value)elements[m[1]].value=value[1];}
 Object.entries({baseTrack:'1',track:'2',scope:'all',weight:'600',align:'center',mode:'hold'}).forEach(([k,v])=>elements[k].value=v);
 const clips=Array.from({length:options.total||1},(_,i)=>({id:'color'+i,track:1,start:i*3,end:i*3+2,inPoint:100,name:'Graphic',managed:false}));
 const real=options.realHost?require('./test-batch-host').fixture(clips.length,{json2:true}):null;
 if(real){real.sequence.name='Test';real.sequence.getSettings=()=>({videoFrameWidth:1920,videoFrameHeight:1080,videoDisplayFormat:100});}
 const bridge={version:'1.2.10',call(method,payload){
  const req=JSON.parse(decodeURIComponent(payload));requests.push({method,req});let value;
  if(real){const result=real.call(method,req);if(options.stopAfterFirst&&method==='beginRun')queueMicrotask(()=>elements.stop.dispatch('click'));return JSON.stringify(result);}
  if(method==='inspect')value={project:'p|s',sequence:'Test',fps:30,width:1920,height:1080,clips};
  else if(method==='beginRun'||method==='continueRun'){
   assert.equal(req.maxMillis,30000);assert(req.count<=5000);
   if(method==='beginRun'){
    assert(req.compact);cursor=0;serial++;
    cached=req.items.map(i=>({project:req.project,fps:req.fps,baseTrack:req.baseTrack,track:req.track,items:[{id:i[0],track:req.track,start:i[1],end:i[2],inPoint:i[3],top:i[4],bottom:i[5],keys:i[6].map(k=>({frame:k[0],value:k[1],interp:k[2]}))}]}));
   }else{assert.equal(req.token,serial);assert.equal(req.position,cursor);assert.equal(req.items,undefined);}
   const decoded=cached.slice(cursor,cursor+req.count);groups.push(decoded.length);
   const quota=typeof options.partial==='function'?options.partial(groups.length):options.partial;
   const applied=options.noProgress?0:Math.min(quota||decoded.length,decoded.length);
   plans.push(...decoded.slice(0,applied));cursor+=applied;
   const elapsedMs=typeof options.elapsedMs==='function'?options.elapsedMs(applied):options.elapsedMs;
   value={token:serial,position:cursor,total:cached.length,prepareMs:0,applied,error:'',elapsedMs,stats:{keyframes:applied*5,cueMs:options.cueMs===undefined?elapsedMs:options.cueMs}};
   if(options.stopAfterFirst&&groups.length===1)queueMicrotask(()=>elements.stop.dispatch('click'));
  }else throw Error('Unexpected RPC '+method);
  return JSON.stringify({ok:true,value});
 }};
 class FileReader {readAsText(file){this.result=file.text;this.onload();}}
 const fsApi={showSaveDialogEx(title,initial,types,name){assert.equal(types.join(','),'json');assert(name.endsWith('.json'));return {err:options.dialogError||0,data:options.cancel?'':'C:/logs/nhật ký'};},writeFile(path,text,encoding){assert.equal(encoding,'UTF-8');writes.push({path,text});return {err:options.writeError||0};}};
 const countedCore={...C,timing(...args){calculations.timing++;return C.timing(...args);},makeItem(...args){calculations.items++;return C.makeItem(...args);}};
 const context=vm.createContext({KGCore:countedCore,document:{getElementById:id=>elements[id],createElement:()=>new Element(''),createDocumentFragment:()=>new Element('fragment'),querySelectorAll:()=>Object.values(elements),visibilityState:'hidden',fonts:{load:()=>Promise.resolve()}},localStorage:{getItem:()=>options.saved?JSON.stringify(options.saved):null,setItem:noop},Map,FileReader,performance,MessageChannel,setTimeout:()=>{throw Error('Should not use throttled timers');},window:{cep:{fs:fsApi},__adobe_cep__:{evalScript(script,callback){const raw=vm.runInContext(script,context);if(options.holdBatch&&script.includes('"beginRun"')){options.holdBatch=false;pending=()=>callback(raw);}else if(options.holdScan&&script.includes('"inspect"')){options.holdScan=false;pending=()=>callback(raw);}else callback(raw);}}},KG23:bridge});
 vm.runInContext(panel,context);
 async function click(id){elements[id].dispatch('click');for(let n=0;n<200;n++){await new Promise(resolve=>setImmediate(resolve));if(!elements.run.disabled)return;}throw Error('Panel did not finish');}
 const stamp=s=>String(Math.floor(s/3600)).padStart(2,'0')+':'+String(Math.floor(s/60)%60).padStart(2,'0')+':'+String(s%60).padStart(2,'0')+',000';
 elements.srt.files=[{name:'split.srt',text:clips.map((c,i)=>(i+1)+'\n'+stamp(c.start)+' --> '+stamp(c.end)+'\nShe found the documents,\n').join('\n')}];
 elements.srt.dispatch('change');if(!options.skipScan)await click('scan');elements.confirmed.checked=true;
 return {elements,groups,plans,click,requests,writes,calculations,real,hasPending:()=>!!pending,release(){const fn=pending;pending=null;fn();}};
}
(async()=>{
 let f=await fixture({total:2501});assert.equal(f.elements.batchSize.value,'2500');f.elements.confirmed.checked=false;await f.click('run');
 assert.deepEqual(f.groups,[2500,1]);assert.equal(f.plans.length,2501);assert.equal(new Set(f.plans.map(p=>p.items[0].id)).size,2501);
 console.log('PASS Default 2500 processes 2501 cues in two calls while panel is hidden');
 f=await fixture({total:2501});f.elements.batchSize.value='5000';await f.click('run');assert.deepEqual(f.groups,[2501]);assert.equal(f.plans.length,2501);
 console.log('PASS Maximum 5000 processes 2501 cues in one call');
 f=await fixture({total:1053,partial:137});f.elements.batchSize.value='1000';await f.click('run');assert.equal(f.plans.length,1053);assert.equal(new Set(f.plans.map(p=>p.items[0].id)).size,1053);
 console.log('PASS Partial batches resume without skipping or duplicating cues');
 f=await fixture({total:1100,stopAfterFirst:true});f.elements.batchSize.value='500';await f.click('run');assert.equal(f.plans.length,500);assert(f.elements.log.textContent.includes('Đã dừng.'));
 const calculated={...f.calculations};await f.click('run');assert.equal(f.plans.length,1100);assert.equal(new Set(f.plans.map(p=>p.items[0].id)).size,1100);
 assert.equal(f.requests.filter(r=>r.method==='beginRun').length,1);assert.deepEqual(f.calculations,calculated);
 console.log('PASS Stop and resume retain completed cues');
 f=await fixture({noProgress:true});await f.click('run');assert.equal(f.groups.length,1);assert(f.elements.log.textContent.includes('không trả tiến độ ghi'));
 console.log('PASS Zero progress stops rather than looping');
 for(const invalid of ['5001','0','500.5']){f=await fixture();f.elements.batchSize.value=invalid;await f.click('run');assert.equal(f.groups.length,0);assert(f.elements.log.textContent.includes('LỖI:'));}
 console.log('PASS Invalid batch sizes cannot write');
 f=await fixture({total:501,saved:{batchSize:'100'}});assert.equal(f.elements.batchSize.value,'100');await f.click('run');assert.deepEqual(f.groups,[100,100,100,100,100,1]);
 console.log('PASS Existing user batch setting is preserved');
 f=await fixture({total:500,partial:100,elapsedMs:8000});await f.click('run');assert(f.groups[1]>100);assert.equal(f.plans.length,500);assert.equal(new Set(f.plans.map(p=>p.items[0].id)).size,500);
 console.log('PASS Longer host batches adapt without resending a 500-cue tail');
 f=await fixture({total:500,partial:100,elapsedMs:n=>n*80});await f.click('run');assert.deepEqual(f.groups,[500,343,300,200,100]);assert.equal(f.plans.length,500);
 console.log('PASS Batch size stabilizes when the host has a consistent cost per cue');
 f=await fixture({total:500});await f.click('run');
 const sent=f.requests.find(r=>r.method==='beginRun').req;
 const compactChars=encodeURIComponent(JSON.stringify(sent)).length,legacyChars=encodeURIComponent(JSON.stringify({plans:f.plans,maxMillis:8000})).length;
 assert(compactChars<legacyChars*0.7);
 assert(!f.requests.some(r=>r.method==='prepareAll'));assert(sent.compact);assert.equal(sent.items.length,500);
 console.log('PASS Transport shrinks '+legacyChars+' to '+compactChars+' encoded characters ('+Math.round((1-compactChars/legacyChars)*100)+'% less)');
 await f.click('exportLog');assert.equal(f.writes.length,1);assert.equal(f.writes[0].path,'C:/logs/nhật ký.json');assert.equal(JSON.parse(f.writes[0].text).timeline.clipCount,500);assert(!f.requests.some(r=>r.method==='diagnostic'||r.method==='saveLog'));
 console.log('PASS Log saves UTF-8 from panel without any host diagnostic or save RPC');
 f=await fixture({total:600,holdBatch:true});f.elements.run.dispatch('click');
 for(let n=0;n<100&&!f.hasPending();n++)await new Promise(resolve=>setImmediate(resolve));
 assert(f.hasPending());assert.equal(f.elements.exportLog.disabled,false);assert.equal(f.elements.run.disabled,true);
 f.elements.exportLog.dispatch('click');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.writes.length,1);assert.equal(JSON.parse(f.writes[0].text).running,true);assert.equal(f.elements.run.disabled,true);assert.equal(f.elements.stop.disabled,false);
 f.release();for(let n=0;n<200&&f.elements.run.disabled;n++)await new Promise(resolve=>setImmediate(resolve));assert.equal(f.plans.length,600);
 console.log('PASS Log export remains available while a host call is pending and does not unlock timeline actions');
 f=await fixture();f.elements.fontSize.value='invalid';await f.click('exportLog');const badSettings=JSON.parse(f.writes[0].text);assert.equal(badSettings.settings,null);assert.equal(badSettings.rawSettings.fontSize,'invalid');assert(badSettings.settingsError);
 console.log('PASS Invalid settings cannot prevent diagnostic log export');
 f=await fixture({cancel:true});await f.click('exportLog');assert.equal(f.writes.length,0);assert(f.elements.log.textContent.includes('hủy lưu log'));
 for(const options of [{dialogError:2},{writeError:5}]){f=await fixture(options);await f.click('exportLog');assert(f.elements.log.textContent.includes('LỖI:'));assert(!f.elements.log.textContent.includes('Đã lưu log:'));}
 console.log('PASS Cancel and file/dialog failures never claim a successful export');
 f=await fixture({total:1201});f.elements.batchSize.value='500';await f.click('run');
 assert.equal(f.requests.filter(r=>r.method==='beginRun').length,1);
 const tail=f.requests.filter(r=>r.method==='continueRun');assert.equal(tail.length,2);
 assert(tail.every(r=>r.req.items===undefined&&r.req.plans===undefined&&JSON.stringify(r.req).length<150));
 console.log('PASS Plans are uploaded once; following batches send only token, cursor and limit');
 f=await fixture({total:1100,stopAfterFirst:true});f.elements.batchSize.value='500';await f.click('run');
 f.elements.fontSize.value='58';f.elements.fontSize.dispatch('change');f.elements.confirmed.checked=true;await f.click('run');
 assert.equal(f.requests.filter(r=>r.method==='beginRun').length,2);
 console.log('PASS Font changes invalidate the staged cache');
 f=await fixture({total:800,partial:round=>round===1?1:500,elapsedMs:10000,cueMs:10});f.elements.batchSize.value='500';await f.click('run');assert.equal(f.groups[1],500);
 console.log('PASS Setup delays do not collapse the next batch to one cue');
 f=await fixture({total:30});await f.click('auditLayout');const measured=f.calculations.timing;await f.click('auditLayout');assert.equal(f.calculations.timing,measured);
 console.log('PASS Repeated layout audits retain the calculated geometry');
 f=await fixture({total:1100,realHost:true,stopAfterFirst:true});f.elements.batchSize.value='500';await f.click('run');
 assert.equal(f.real.right(499).keys.length,f.real.plans[499].items[0].keys.length);assert.equal(f.real.right(500).keys.length,0);const once={...f.calculations};
 await f.click('run');assert.equal(f.requests.filter(r=>r.method==='beginRun').length,1);assert.deepEqual(f.calculations,once);
 for(let i=0;i<1100;i++)f.real.plans[i].items[0].keys.forEach((k,j)=>assert.deepEqual(f.real.right(i).keys[j],{seconds:100+k.frame/30,value:k.value,interp:k.interp}));
 console.log('PASS Actual panel and host with json2 stop/resume 1100 cues from one staged plan');
 f=await fixture({total:600,realHost:true,stopAfterFirst:true});f.elements.batchSize.value='500';await f.click('run');f.real.color[500].end.seconds++;
 await f.click('run');assert(f.elements.log.textContent.includes('Clip đã đổi thời gian'));assert.equal(f.real.right(500).keys.length,0);
 console.log('PASS Actual cached resume stops before writing a clip edited during the pause');
 f=await fixture({total:2429,skipScan:true,realHost:true});assert.equal(f.elements.run.disabled,false);assert.equal(f.requests.length,0);assert(f.elements.log.textContent.includes('Có thể bấm Áp dụng'));
 await f.click('run');assert.equal(f.requests.filter(r=>r.method==='inspect').length,1);assert.equal(f.requests.find(r=>r.method==='inspect').req.fast,true);assert.equal(f.requests.filter(r=>r.method==='beginRun').length,1);
 assert.equal(f.elements.cueList.children.length,2429);assert.equal(f.elements.progress.value,2429);
 for(let i=0;i<2429;i++)f.real.plans[i].items[0].keys.forEach((k,j)=>assert.deepEqual(f.real.right(i).keys[j],{seconds:100+k.frame/30,value:k.value,interp:k.interp}));
 await f.click('exportLog');const scanMeasured=JSON.parse(f.writes[0].text);assert(scanMeasured.rpcMetrics.some(r=>r.method==='inspect'));assert(scanMeasured.rpcMetrics.some(r=>r.method==='beginRun'&&r.stats));
 console.log('PASS SRT load immediately enables Apply; one click matches and writes 2429 cues with scan metrics');
 f=await fixture({skipScan:true});await f.click('test');assert.equal(f.requests.length,0);assert(f.elements.log.textContent.includes('chọn câu'));
 console.log('PASS Apply selected cue requires an explicit selection rather than silently choosing the first cue');
 f=await fixture({total:100,skipScan:true,holdScan:true});f.elements.run.dispatch('click');
 for(let n=0;n<100&&!f.hasPending();n++)await new Promise(resolve=>setImmediate(resolve));assert(f.hasPending());assert.equal(f.elements.exportLog.disabled,false);
 f.elements.stop.dispatch('click');await new Promise(resolve=>setImmediate(resolve));f.release();
 for(let n=0;n<100&&f.elements.run.disabled;n++)await new Promise(resolve=>setImmediate(resolve));assert(!f.requests.some(r=>r.method==='beginRun'));assert(f.elements.log.textContent.includes('Đã dừng trước khi ghi'));
 console.log('PASS Stop during automatic matching prevents any keyframe write');
 f=await fixture({skipScan:true});f.elements.offset.value='1000';await f.click('run');assert(!f.requests.some(r=>r.method==='beginRun'));assert(f.elements.log.textContent.includes('Chưa có clip hợp lệ'));assert(!f.elements.log.textContent.includes('Sẵn sàng áp dụng'));
 console.log('PASS Failed automatic matching cannot write keyframes');
})().catch(e=>{console.error(e);process.exitCode=1;});
