(function(){
 'use strict';
 var C=KGCore, $=function(id){return document.getElementById(id);}, cues=[], scanData=null, scanConfig=null, rows=[], stop=false,busy=false,logs=[];
 var fields=['baseTrack','track','offset','scope','font','fontSize','weight','tracking','align','anchor','widthFactor','padding','mode','batchSize'];
 var measuredStyle='',measureText=null,tableModel=null,scanIssues=[],scanCandidates=[],resetReview=null,layoutIssues=[];
 var rpcMetrics=[],runSession=null,loadedFont='',fontEpoch=0,RUN_BATCH_MS=30000;
 function timelineTime(seconds){return scanData?C.timecode(seconds,scanData.fps,scanData.videoDisplayFormat,scanData.zeroSeconds):C.duration(seconds);}
 function elapsed(ms){return C.duration(ms/1000);}
 function log(s){logs.push(new Date().toLocaleTimeString()+' '+s);$('log').textContent=logs.slice(-150).join('\n');$('log').scrollTop=$('log').scrollHeight;}
 function rpc(method,arg){return new Promise(function(resolve,reject){
   if(!window.__adobe_cep__){reject(new Error('Mở panel trong Premiere 23 để thao tác timeline.'));return;}
   var started=performance.now(),visibility=document.visibilityState||'unknown';
   var payload=encodeURIComponent(JSON.stringify(arg||{}));
   var call='KG23.call('+JSON.stringify(method)+','+JSON.stringify(payload)+')';
   if(method!=='diagnostic'&&method!=='saveLog')call='(typeof KG23!=="undefined"&&KG23.version==="1.2.10")?'+call+':JSON.stringify({ok:false,error:"Host cũ vẫn đang chạy. Đóng hoàn toàn Premiere, cài v1.2.10 rồi mở lại."})';
   window.__adobe_cep__.evalScript(call,function(raw){
     try{var r=JSON.parse(raw);if(!r.ok)throw new Error(r.error);
       if((method==='inspect'||method==='prepareAll'||method==='applyBatch'||method==='beginRun'||method==='continueRun')&&r.profile){
         var wall=performance.now()-started,p=r.profile,gap=Math.max(0,wall-p.hostMs);
         rpcMetrics.push({method:method,payloadChars:payload.length,wallMs:wall,host:p,stats:r.value&&r.value.stats||null,outsideHostMs:gap,visibilityStart:visibility,visibilityEnd:document.visibilityState||'unknown'});
         if(rpcMetrics.length>1000)rpcMetrics.shift();
         log('Đo '+method+': tổng '+elapsed(wall)+'; host '+elapsed(p.hostMs)+' (payload '+(p.payloadChars||0)+' ký tự; giải mã ['+(p.jsonMode||'?')+'] '+elapsed(p.parseMs)+' = decodeURI '+elapsed(p.decodeMs||0)+' + JSON '+elapsed(p.jsonMs||0)+', xử lý '+elapsed(p.methodMs)+', đóng gói '+elapsed(p.serializeMs)+'); ngoài host ≈ '+elapsed(gap)+'; panel '+visibility+' → '+(document.visibilityState||'unknown')+'.');
       }
       resolve(r.value);
     }catch(e){reject(new Error(raw==='EvalScript error.'?'Premiere không thực thi được lệnh '+method+'. Với lệnh quét, thử lại khi Premiere hết bận. Với lệnh ghi, quét lại để kiểm tra kết quả trước khi chạy tiếp.':e.message));}
   });
 });}
 function rpcSummary(){var out={};rpcMetrics.forEach(function(m){var o=out[m.method]||(out[m.method]={calls:0,wallMs:0,hostMs:0,payloadChars:0,decodeMs:0,jsonMs:0,parseMs:0,methodMs:0,serializeMs:0,outsideHostMs:0,stats:{}});o.calls++;o.wallMs+=m.wallMs;o.hostMs+=m.host.hostMs;o.payloadChars+=m.payloadChars;o.decodeMs+=m.host.decodeMs||0;o.jsonMs+=m.host.jsonMs||0;o.parseMs+=m.host.parseMs;o.methodMs+=m.host.methodMs;o.serializeMs+=m.host.serializeMs;o.outsideHostMs+=m.outsideHostMs;if(m.stats)Object.keys(m.stats).forEach(function(k){if(typeof m.stats[k]==='number')o.stats[k]=(o.stats[k]||0)+m.stats[k];});});return out;}
 function yieldToPanel(){return new Promise(function(resolve){
   if(typeof MessageChannel==='undefined'){setTimeout(resolve,0);return;}
   var channel=new MessageChannel();
   channel.port1.onmessage=function(){channel.port1.close();channel.port2.close();resolve();};
   channel.port2.postMessage(null);
 });}
 function num(id,min,max){var n=Number($(id).value);if(!isFinite(n)||n<min||n>max)throw new Error('Thông số '+id+' không hợp lệ.');return n;}
 function settings(){return {baseTrack:num('baseTrack',1,99)-1,track:num('track',1,99)-1,offset:num('offset',-86400,86400),font:$('font').value.trim(),fontSize:num('fontSize',1,2000),weight:$('weight').value,tracking:num('tracking',-20,100),align:$('align').value,anchor:num('anchor',0,100),widthFactor:num('widthFactor',1,500),padding:num('padding',0,50),mode:$('mode').value,width:scanData?Number(scanData.width):1920};}
 function save(){var v={};fields.forEach(function(k){v[k]=$(k).value;});try{localStorage.setItem('kg23.settings.1line',JSON.stringify(v));}catch(e){}}
 try{var saved=JSON.parse(localStorage.getItem('kg23.settings.1line')||'{}');fields.forEach(function(k){if(saved[k]!==undefined)$(k).value=saved[k];});}catch(e){}
 function selected(){return rows[Number($('cueList').value)]||null;}
 function measure(cfg){
   var style=cfg.weight+' '+cfg.fontSize+'px '+JSON.stringify(cfg.font);
   if(style!==measuredStyle || !measureText){
     var ctx=document.createElement('canvas').getContext('2d'),cache=new Map();ctx.font=style;measuredStyle=style;
     measureText=function(s){if(cache.has(s))return cache.get(s);var w=ctx.measureText(s).width;if(cache.size>=5000)cache.clear();cache.set(s,w);return w;};
   }
   return measureText;
 }
 function model(row,cfg){
   var key=JSON.stringify([row.cue.text,row.clip.end-row.clip.start,scanData.fps,cfg,fontEpoch]);
   if(row.modelKey===key)return row.modelData;
   row.modelData=C.geometry(C.timing(row.cue.text,row.clip.end-row.clip.start,scanData.fps),cfg,measure(cfg));row.modelKey=key;
   return row.modelData;
 }
 function draw(){
   var row=selected(),ctx=$('preview').getContext('2d'),canvas=$('preview');ctx.clearRect(0,0,canvas.width,canvas.height);$('layoutWarning').textContent='';if(!row)return;
   try{
     var cfg=settings(),data=model(row,cfg),fraction=Number($('scrub').value)/1000,frame=Math.min(data.frames-1,Math.floor(fraction*data.frames)),scale=canvas.width/cfg.width;
     ctx.save();ctx.scale(scale,scale);ctx.font=cfg.weight+' '+cfg.fontSize+'px '+JSON.stringify(cfg.font);ctx.textBaseline='middle';
     var line=data.lines[0],y=canvas.height/2/scale,x=data.rows[0].left;
     function text(){var cursor=x;Array.from(line).forEach(function(ch){ctx.fillText(ch,cursor,y);cursor+=(ctx.measureText(ch).width+cfg.tracking)*cfg.widthFactor/100;});}
     if(row.previewKey!==row.modelKey){row.previewKeys=C.makeKeys(data,cfg.mode,cfg.width,cfg.padding);row.previewKey=row.modelKey;}
     ctx.fillStyle='#f2f3f5';text();var keys=row.previewKeys,k=keys[0],next=null;
     keys.forEach(function(p,i){if(p.frame<=frame){k=p;next=keys[i+1]||null;}});
     var val=k.value;if(k.interp===0&&next&&next.frame>k.frame)val+=(next.value-k.value)*(frame-k.frame)/(next.frame-k.frame);
     ctx.save();ctx.beginPath();ctx.rect(0,0,cfg.width*(1-val/100),canvas.height/scale);ctx.clip();ctx.fillStyle='#f7ca4e';text();ctx.restore();ctx.restore();
     $('previewInfo').textContent='Mô phỏng 1 dòng · '+(frame/scanData.fps).toFixed(2)+' / '+(data.frames/scanData.fps).toFixed(2)+' giây'+(data.collapsed?' · '+data.collapsed+' từ quá ngắn, chung frame':'');
     $('layoutWarning').textContent=data.outOfBounds?'Cảnh báo: chiều rộng chữ ước tính vượt khung hình. Kiểm tra font, cỡ chữ, điểm neo hoặc Width Factor.':'';
     if(tableModel===data)return;tableModel=data;
     var table=document.createElement('table'),header=table.insertRow();['Từ','Bắt đầu','Kết thúc'].forEach(function(s){header.insertCell().textContent=s;});
     data.words.forEach(function(w){var tr=table.insertRow();[w.word,timelineTime(row.clip.start+w.startFrame/scanData.fps),timelineTime(row.clip.start+w.endFrame/scanData.fps)].forEach(function(s){tr.insertCell().textContent=s;});});
     $('wordTable').textContent='';$('wordTable').appendChild(table);
   }catch(e){tableModel=null;$('previewInfo').textContent=e.message;$('wordTable').textContent='';}
 }
 function refreshList(){var old=$('cueList').value,fragment=document.createDocumentFragment();$('cueList').textContent='';rows.forEach(function(r,i){var o=document.createElement('option');o.value=i;o.textContent=(r.done?'✓ ':'')+'Cue '+r.cue.id+' · '+timelineTime(r.clip.start)+' · '+r.cue.text.slice(0,65);fragment.appendChild(o);});$('cueList').appendChild(fragment);if(rows[+old])$('cueList').value=old;loadRow();}
 function loadRow(){var r=selected();$('cueText').value=r?r.cue.text:'';draw();}
 function setBusy(v,canStop){busy=v;document.querySelectorAll('button,input,select,textarea').forEach(function(el){el.disabled=v;});$('stop').disabled=!v||!canStop;$('exportLog').disabled=false;}
 function clearReset(){resetReview=null;$('resetConfirmed').checked=false;$('resetInfo').textContent='Kiểm tra trước để xem số clip có Crop cần tạo lại.';}
 function clipLabel(clip){return 'V'+(clip.track+1)+' · '+clip.name+' · ID '+clip.id+' · '+timelineTime(clip.start)+'–'+timelineTime(clip.end);}
 async function scan(){
   if(!cues.length)throw new Error('Mở SRT trước.');var cfg=settings();
   rows=[];scanData=null;scanConfig=null;scanIssues=[];scanCandidates=[];runSession=null;clearReset();refreshList();$('confirmed').checked=false;
   if(cfg.baseTrack>=cfg.track)throw new Error('Track chữ màu phải nằm trên track chữ trắng.');
   log('Đang ghép nhanh SRT với thông tin clip màu; Crop được kiểm tra khi ghi.');
   var d=await rpc('inspect',{track:cfg.track+1,selectedOnly:$('scope').value==='selected',fast:true}),matchedAt=performance.now();
   rows=[];scanData=d;cfg=settings();scanConfig={track:cfg.track,offset:cfg.offset,scope:$('scope').value};
   if(!d.clips.length)throw new Error('Không có clip trong phạm vi. Chọn Graphic trên V'+(cfg.track+1)+' rồi quét, hoặc chọn Phạm vi = Toàn bộ track màu.');
   var bad=[],index=C.cueIndex(cues,cfg.offset,d.fps);d.clips.forEach(function(clip){try{
     var cue=C.matchCue(clip,cues,cfg.offset,d.fps,index);scanCandidates.push(clip);
     if(clip.error)throw new Error(clip.error);rows.push({clip:clip,cue:cue,done:clip.managed});
   }catch(e){var message=clipLabel(clip)+': '+e.message;bad.push(message);scanIssues.push({clip:clip,error:e.message});}});
   $('sequence').textContent=d.sequence+' · '+d.width+'×'+d.height+' · '+d.fps.toFixed(3)+' fps';
   log('Mốc cue: giờ:phút:giây:frame'+([102,106].indexOf(d.videoDisplayFormat)>=0?' (DF, dấu ; trước frame)': ' (NDF)')+'. Thời gian xử lý: phút:giây.mili giây. Đầu mỗi dòng là giờ máy.');
   var listedAt=performance.now();refreshList();var listedMs=performance.now()-listedAt;
   log('Ghép được '+rows.length+'/'+d.clips.length+' clip. '+rows.filter(function(r){return r.done;}).length+' clip đã chạy trong phiên này.');bad.forEach(log);
   if(!rows.length)throw new Error('Chưa có clip hợp lệ. Đọc nhật ký bên dưới.');
   log('Ghép SRT: '+elapsed(listedAt-matchedAt)+'; tạo danh sách: '+elapsed(listedMs)+'. Sẵn sàng áp dụng.');
   save();
 }
 async function buildPlans(targets,checkOnly){
   var cfg=settings();
   if(!scanConfig || cfg.track!==scanConfig.track || cfg.offset!==scanConfig.offset || $('scope').value!==scanConfig.scope)throw new Error('Track, offset hoặc phạm vi đã đổi. Quét lại timeline.');
   if(!cfg.font)throw new Error('Nhập font family.');
   var fontStyle=cfg.weight+' '+cfg.fontSize+'px '+JSON.stringify(cfg.font);
   if(loadedFont!==fontStyle){await document.fonts.load(fontStyle);loadedFont=fontStyle;fontEpoch++;measuredStyle='';measureText=null;}
   layoutIssues=[];
   var started=performance.now(),models=targets.map(function(r){try{return model(r,cfg);}catch(e){layoutIssues.push({cue:r.cue.id,id:r.clip.id,start:r.clip.start,text:r.cue.text,error:e.message});return null;}});
   layoutIssues.forEach(function(issue){log('Cue '+issue.cue+' · '+timelineTime(issue.start)+' · '+issue.text+': '+issue.error);});
   if(layoutIssues.length)throw new Error('Cue '+layoutIssues[0].cue+': '+layoutIssues[0].error+' Tổng '+layoutIssues.length+' cue cần kiểm tra; chưa ghi cue nào trong lượt này.');
   log('Bố cục: '+models.length+' cue một dòng. Không có xử lý dòng 2.');
   if(checkOnly)return;
   var reused=0,plans=targets.map(function(r,i){
     var key=JSON.stringify([scanData.project,scanData.fps,cfg,r.clip.id,r.clip.start,r.clip.end,r.clip.inPoint,r.cue.text,fontEpoch]);
     if(r.planKey!==key){r.planData={project:scanData.project,fps:scanData.fps,baseTrack:cfg.baseTrack,track:cfg.track,items:[C.makeItem(r.clip,models[i],cfg)]};r.planKey=key;}else reused++;
     return {row:r,plan:r.planData};
   });
   log('Tính bố cục/kế hoạch: '+elapsed(performance.now()-started)+' · dùng lại '+reused+'/'+targets.length+' cue.');
   return plans;
 }
 function batchRequest(group){
   var p=group[0].plan;
   return {compact:true,project:p.project,fps:p.fps,baseTrack:p.baseTrack,track:p.track,maxMillis:RUN_BATCH_MS,items:group.map(function(g){
     var item=g.plan.items[0];return [item.id,item.start,item.end,item.inPoint,item.top,item.bottom,item.keys.map(function(k){return [k.frame,k.value,k.interp];})];
   })};
 }
 async function run(one){
   stop=false;
   if(!scanData||!rows.length){if(one)throw new Error('Quét Graphic trước để chọn câu.');await scan();if(stop){log('Đã dừng trước khi ghi.');return;}}
   var targets=one?[selected()]:rows.filter(function(r){return !r.done;});
   if(!targets.length)throw new Error('Không còn câu chưa xử lý.');if(targets.some(function(r){return r.done;}))throw new Error('Câu đã chạy. Hoàn tác trước khi thay đổi thông số.');
   clearReset();setBusy(true,true);var started=performance.now(),done=0;
   try{
     var batchSize=num('batchSize',1,5000);if(batchSize%1!==0)throw new Error('Số cue mỗi lượt phải là số nguyên.');
     log('Ghi nhanh: '+batchSize+' cue/lượt, khoảng 30 giây/lượt. Không đối chiếu lớp trắng hoặc đọc lại từng keyframe. Nút Dừng có hiệu lực giữa các lượt.');
     var signature=JSON.stringify([scanData.project,scanData.fps,settings()]),session=runSession,plans;
     var canResume=session&&session.signature===signature&&session.plans.length-session.position===targets.length&&targets.every(function(r,i){return session.plans[session.position+i].row===r;});
     if(canResume){plans=session.plans.slice(session.position);log('Tiếp tục cache: '+plans.length+' cue còn lại; không tính hoặc gửi lại toàn bộ kế hoạch.');}
     else{plans=await buildPlans(targets);runSession=null;}
     $('progress').max=plans.length;$('progress').value=0;
     var nextSize=batchSize,cost=null,writeStarted=performance.now(),stats={preflightMs:0,cropMs:0,cropCacheHits:0,cropFullScans:0,keyframeMs:0,writeMs:0,verifyMs:0,keyframes:0,refreshMs:0,staticLayers:0,skippedWrites:0,cueMs:0,setupMs:0};
     for(var i=0;i<plans.length;){if(stop)break;var roundStarted=performance.now(),group=plans.slice(i,i+nextSize),result;
       if(!runSession){
         var request=batchRequest(plans);request.count=nextSize;
         result=await rpc('beginRun',request);
         runSession={token:result.token,position:0,plans:plans,signature:signature};
         log('Đã lưu kế hoạch '+plans.length+' cue: '+elapsed(result.prepareMs||0)+'. Crop và timeline được kiểm tra ngay trước khi ghi từng cue.');
       }else result=await rpc('continueRun',{token:runSession.token,position:runSession.position,count:nextSize,maxMillis:RUN_BATCH_MS});
       if(!Number.isInteger(result.applied)||result.applied<0||result.applied>group.length)throw new Error('Host trả số cue không hợp lệ. Quét lại để kiểm tra kết quả.');
       if(result.position!==runSession.position+result.applied)throw new Error('Host trả tiến độ cache không khớp. Quét lại.');
       runSession.position=result.position;
       for(var n=0;n<result.applied;n++){group[n].row.done=true;done++;}$('progress').value=done;i+=result.applied;
       if(result.stats)Object.keys(stats).forEach(function(k){stats[k]+=result.stats[k]||0;});
       log('Đã áp dụng '+done+'/'+plans.length+' cue.');
       if(result.stats){var st=result.stats;log('Lượt '+result.applied+' cue · '+elapsed(performance.now()-roundStarted)+' · '+(st.keyframes||0)+' keyframe.');var cc=Object.keys(st).filter(function(k){return /^(cropCache|cropFullScans|cropSample|cropLearnSample)/.test(k)&&st[k];}).map(function(k){return k+'='+st[k];}).join('; ');if(cc)log('Bộ nhớ đệm Crop: '+cc);var kd=Object.keys(st).filter(function(k){return /^(kf|staticWriteMs|staticValueWrites|timerSource|setup(App|Active|Project|Sequence|Timebase|Unattributed))/.test(k)&&st[k];}).map(function(k){return k+'='+st[k];}).join('; ');if(kd)log('Chi tiết keyframe/thiết lập: '+kd);}
       if(result.warning)log(result.warning);
       if(result.error)throw new Error('Dừng ở cue '+(group[result.applied]?group[result.applied].row.cue.id:'cuối lô')+': '+result.error);
       if(!result.applied)throw new Error('Host không trả tiến độ ghi; đã dừng để tránh lặp vô hạn.');
       var cueMs=result.stats&&Number.isFinite(result.stats.cueMs)?result.stats.cueMs:result.elapsedMs;
       if(Number.isFinite(cueMs)&&cueMs>0){var sample=cueMs/result.applied;cost=cost===null?sample:(cost+sample)/2;nextSize=Math.min(batchSize,Math.max(1,Math.floor(27500/cost)));}
       if(i<plans.length){var yieldStarted=performance.now();await yieldToPanel();var yieldMs=performance.now()-yieldStarted;if(yieldMs>=1000)log('Chờ chuyển lượt: '+elapsed(yieldMs)+'.');}
     }
     var writeSeconds=(performance.now()-writeStarted)/1000;
     log('Áp dụng '+stats.keyframes+' keyframe trong '+C.duration(writeSeconds)+' · '+(done/Math.max(0.001,writeSeconds)).toFixed(1)+' cue/giây. Host các lượt ghi: kiểm tra '+elapsed(stats.preflightMs)+' (trong đó tìm Crop '+elapsed(stats.cropMs)+'; bộ nhớ đệm '+stats.cropCacheHits+' trúng, '+stats.cropFullScans+' quét đầy đủ), ghi '+elapsed(stats.writeMs)+' (trong đó keyframe '+elapsed(stats.keyframeMs)+'), cue '+elapsed(stats.cueMs)+', đọc lại '+elapsed(stats.verifyMs)+'.');
     log((stop?'Đã dừng. ':'Hoàn tất. ')+done+'/'+plans.length+' cue · '+elapsed(performance.now()-started)+'. Xem kết quả trong Program Monitor.');
   }catch(e){runSession=null;throw e;}finally{setBusy(false);refreshList();}
 }
 function download(name,data){var a=document.createElement('a'),url=URL.createObjectURL(new Blob([data],{type:'application/json;charset=utf-8'}));a.href=url;a.download=name;a.click();setTimeout(function(){URL.revokeObjectURL(url);},3000);}
 function action(id,fn){$(id).addEventListener('click',function(){var exclusive=id!=='stop'&&id!=='exportLog';if(busy&&exclusive)return;if(exclusive)setBusy(true,id==='run'||id==='test'||id==='resetCrop');Promise.resolve().then(fn).catch(function(e){log('LỖI: '+e.message);}).then(function(){if(exclusive)setBusy(false);});});}
 $('srt').addEventListener('change',function(){if(busy)return;var file=this.files[0];if(!file)return;setBusy(true);runSession=null;cues=[];rows=[];scanData=null;scanConfig=null;scanIssues=[];scanCandidates=[];clearReset();refreshList();$('srtInfo').textContent='Đang đọc SRT…';var readStarted=performance.now(),reader=new FileReader();reader.onload=function(){try{cues=C.parseSRT(reader.result);$('srtInfo').textContent=file.name+' · '+cues.length+' cue · 1 dòng';log('Đã nạp SRT: '+elapsed(performance.now()-readStarted)+'; '+cues.length+' cue một dòng. Có thể bấm Áp dụng các câu còn lại để tự ghép và ghi.');}catch(e){$('srtInfo').textContent='SRT không hợp lệ';log('LỖI: '+e.message);}finally{setBusy(false);}};reader.onerror=function(){setBusy(false);log('LỖI: Không đọc được file SRT.');};reader.readAsText(file,'UTF-8');});
 fields.forEach(function(id){$(id).addEventListener('change',function(){save();if(id==='batchSize')return;runSession=null;clearReset();$('confirmed').checked=false;draw();});});
 $('cueList').addEventListener('change',loadRow);$('scrub').addEventListener('input',draw);
 action('scan',scan);action('test',function(){return run(true);});action('run',function(){return run(false);});
 action('auditLayout',async function(){if(!scanData||!rows.length)throw new Error('Quét Graphic trước.');await buildPlans(rows,true);log('Đã kiểm tra '+rows.length+' cue một dòng; timeline chưa thay đổi.');});
 action('editCue',function(){var r=selected();if(!r)throw new Error('Chọn cue trước.');runSession=null;r.cue.text=C.oneLine($('cueText').value);if(!r.cue.text)throw new Error('Nội dung cue không được rỗng.');r.modelKey=null;$('confirmed').checked=false;refreshList();log('Đã đổi dữ liệu cue '+r.cue.id+' thành một dòng trong panel. Graphic không thay đổi.');});
 action('stop',function(){stop=true;log('Sẽ dừng khi lượt đang ghi kết thúc.');});
 action('undo',async function(){clearReset();var r=await rpc('undo');log('Đã khôi phục '+r.restored+' clip.');r.errors.forEach(log);await scan();});
 action('newVideo',async function(){runSession=null;clearReset();var r=await rpc('forgetSession');rows=[];scanData=null;scanConfig=null;scanIssues=[];scanCandidates=[];$('confirmed').checked=false;refreshList();log('Đã quên lịch sử '+r.forgotten+' clip của video cũ. Timeline và Crop không bị thay đổi; nạp SRT rồi quét video mới.');});
 action('previewReset',async function(){
   if(!scanData||!scanCandidates.length)throw new Error('Quét và ghép SRT trước.');var cfg=settings();
   if(!scanConfig||cfg.track!==scanConfig.track||cfg.offset!==scanConfig.offset||$('scope').value!==scanConfig.scope)throw new Error('Phạm vi đã đổi. Quét lại.');
   clearReset();resetReview=await rpc('resetPreview',{project:scanData.project,baseTrack:cfg.baseTrack,track:cfg.track,clips:scanCandidates});
   $('resetInfo').textContent=resetReview.count+' clip màu sẽ bị xóa keyframe Crop; chữ trắng giữ nguyên. Sau đó phải quét và áp dụng lại.';
   log('Danh sách làm sạch: '+resetReview.count+' clip màu trong phạm vi đã ghép SRT.');resetReview.clips.forEach(function(c){log(clipLabel(c));});
 });
 action('resetCrop',async function(){
   if(!resetReview||!resetReview.count)throw new Error('Bấm Kiểm tra Crop cần tạo lại trước.');
   if(!$('resetConfirmed').checked)throw new Error('Lưu project và đánh dấu đồng ý xóa keyframe Crop trong danh sách trước.');
   var review=resetReview,done=0;stop=false;
   try{while(done<review.count&&!stop){var r=await rpc('resetBatch',{token:review.token,confirmed:true});done+=r.reset;log('Đã làm sạch '+done+'/'+review.count+' clip màu.');if(r.error)throw new Error(r.error);if(!r.remaining)break;if(!r.reset)throw new Error('Host không trả tiến độ làm sạch.');}}
   finally{runSession=null;clearReset();rows=[];scanConfig=null;refreshList();}
   log((stop?'Đã dừng. ':'Hoàn tất. ')+'Quét lại timeline rồi thử một cue; Crop màu đã làm sạch đang ẩn bằng Right=100.');
 });
 action('exportLog',function(){
   var raw={},cfg=null,settingsError='';fields.forEach(function(id){raw[id]=$(id).value;});try{cfg=settings();}catch(e){settingsError=e.message;}
   var content=JSON.stringify({version:'1.2.10',mode:'single-line',settings:cfg,rawSettings:raw,settingsError:settingsError,batchSize:raw.batchSize,running:busy,progress:{applied:Number($('progress').value),total:Number($('progress').max)},timeline:scanData?{project:scanData.project,sequence:scanData.sequence,fps:scanData.fps,width:scanData.width,height:scanData.height,videoDisplayFormat:scanData.videoDisplayFormat,zeroSeconds:scanData.zeroSeconds,clipCount:scanData.clips.length,matched:rows.length}:null,rpcSummary:rpcSummary(),rpcMetrics:rpcMetrics,scanIssues:scanIssues.map(function(issue){return Object.assign({},issue,{startTimecode:timelineTime(issue.clip.start),endTimecode:timelineTime(issue.clip.end)});}),layoutIssues:layoutIssues.map(function(issue){return Object.assign({},issue,{startTimecode:timelineTime(issue.start)});}),log:logs},null,2);
   var fs=window.cep&&window.cep.fs;
   if(fs&&fs.showSaveDialogEx&&fs.writeFile){
     var result=fs.showSaveDialogEx('Lưu nhật ký Karaoke Graphic 23','',['json'],'Karaoke_Graphic_23_log.json');
     if(result.err)throw new Error('Không mở được hộp lưu log (CEP '+result.err+').');
     if(!result.data){log('Đã hủy lưu log.');return;}
     var path=result.data;if(!/\.json$/i.test(path))path+='.json';
   var written=fs.writeFile(path,content,'UTF-8');if(written.err)throw new Error('Không ghi được log: '+path+' (CEP '+written.err+').');
     log('Đã lưu log: '+path);
   }else download('Karaoke_Graphic_23_log.json',content);
 });
 $('stop').disabled=true;
 $('connection').textContent=window.__adobe_cep__?'CEP đã sẵn sàng · Premiere 23 · chế độ 1 dòng':'Bản xem giao diện — mở qua Window > Extensions trong Premiere 23 để chạy.';
 log('Sẵn sàng. Chế độ 1 dòng: chỉ cần lớp trắng và một lớp màu.');
}());
