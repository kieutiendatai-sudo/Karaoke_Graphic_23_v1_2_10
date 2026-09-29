#include "json2.jsx"
/* Premiere 23 CEP host. No QE API, no project save, no clip deletion. */
if (typeof KG23 === 'undefined') {
var KG23 = (function () {
    var history = [], historyByKey = {}, TPS = 254016000000, batchContext = null, lastInspect=null, resetPlan=null, resetSerial=0, liveCall=null, runCache=null, runSerial=0, cropShape=null, loadedAt=new Date().getTime(), callSerial=0, sessionKeyframes=0, inspectCalls=0, forgetCalls=0, undoCalls=0, lastWriteAt=0;
    function error(s) { throw new Error(s); }
    function time(seconds) { var t = new Time(); t.seconds = seconds; return t; }
    function number(n) { return typeof n === 'number' && isFinite(n); }
    // Lightweight timers for diagnostics. lap() returns microseconds since its previous call ($.hiresTimer
    // resets on every read); without it (tests, other hosts) it falls back to millisecond Date differences.
    var HIRES=(typeof $!=='undefined' && $ && typeof $.hiresTimer==='number'), lapClock=0;
    function lap() {
        if(HIRES) return $.hiresTimer;
        var now=new Date().getTime(),d=(now-lapClock)*1000;lapClock=now;return d;
    }
    function setupTick(name) {
        var d=lap();
        if(!liveCall) return;
        var t=liveCall.setup||(liveCall.setup={});t[name]=(t[name]||0)+d;
    }
    // Preflight (per-cue read side) and inspect timers: preallocated numeric fields, microseconds and counts.
    function pfMetrics() {
        return liveCall.pf||(liveCall.pf={trackVideoTracksUs:0,trackNumTracksUs:0,trackRefUs:0,trackClipsUs:0,trackNumItemsUs:0,trackLockedUs:0,clipRefUs:0,nodeIdUs:0,startUs:0,endUs:0,inPointUs:0,
            cropComponentsUs:0,cropComponentRefUs:0,cropPropertiesUs:0,cropPropertyNamesUs:0,isTimeVaryingUs:0,getValueUs:0,
            clipRefReads:0,nodeIdReads:0,startReads:0,endReads:0,inPointReads:0,isTimeVaryingCalls:0,getValueCalls:0});
    }
    function kfMetrics() {
        return liveCall.kf||(liveCall.kf={setTimeVaryingUs:0,getKeysUs:0,removeKeyUs:0,timeObjectUs:0,addKeyUs:0,setValueAtKeyUs:0,setInterpolationUs:0,staticWriteUs:0,
            setTimeVaryingCalls:0,getKeysCalls:0,existingKeys:0,cuesWithZeroKeys:0,cuesWithOneKey:0,cuesWithManyKeys:0,keysRemoved:0,keysAdded:0,valuesWritten:0,interpolationWrites:0,staticValueWrites:0});
    }
    function seq() {
        if(liveCall && liveCall.sequence) return liveCall.sequence;
        lap();
        if (parseInt(app.version,10) !== 23) error('Bản này dành cho Premiere 23.x.');
        setupTick('appVersionUs');
        var s=app.project.activeSequence;
        setupTick('activeSequenceUs');
        // Read-only probe: is a second read in the same call as slow as the first?
        var repeated=app.project.activeSequence;
        setupTick('activeSequenceRepeatUs');
        if(!s) error('Mở một sequence trước.');
        if(liveCall)liveCall.sequence=s;
        return s;
    }
    function projectKey(s) {
        if(liveCall && liveCall.sequence===s && liveCall.project) return liveCall.project;
        lap();
        var projectId=app.project.documentID || app.project.path || '';
        setupTick('projectIdUs');
        var key=String(projectId)+'|'+String(s.sequenceID);
        setupTick('sequenceIdUs');
        if(liveCall && liveCall.sequence===s)liveCall.project=key;
        return key;
    }
    function sequenceFps(s) {
        if(liveCall.fps===undefined){lap();liveCall.fps=TPS/Number(s.timebase);setupTick('timebaseUs');}
        return liveCall.fps;
    }
    // Adobe wrappers are reused only inside one synchronous call and released
    // before returning to CEP. Slot IDs/timing are resolved live on every call.
    function trackData(s,track) {
        var pf=pfMetrics();
        if(!liveCall.videoTracks){lap();liveCall.videoTracks=s.videoTracks;pf.trackVideoTracksUs+=lap();}
        var tracks=liveCall.videoTracks;
        if(liveCall.trackCount===undefined){lap();liveCall.trackCount=tracks.numTracks;pf.trackNumTracksUs+=lap();}
        if(track<0 || track>=liveCall.trackCount)error('Track không tồn tại.');
        var key=String(track),data=liveCall.tracks[key];
        if(!data) {
            lap();var ref=tracks[track];pf.trackRefUs+=lap();
            var clips=ref.clips;pf.trackClipsUs+=lap();
            var clipCount=clips.numItems;pf.trackNumItemsUs+=lap();
            var isLocked=typeof ref.isLocked==='function' && ref.isLocked();pf.trackLockedUs+=lap();
            data={track:ref,clips:clips,count:clipCount,scanned:[],locked:isLocked};
            liveCall.tracks[key]=data;
        }
        return data;
    }
    function recordKey(s,c) { return projectKey(s)+'|'+String(c.nodeId); }
    // Premiere 23 is inconsistent: Crop methods may report 0, true, undefined
    // or null after a successful write. Explicit error codes still stop the cue.
    function checkRC(r,what) { if(r!==0 && r!==undefined && r!==null && r!==true) error(what+' thất bại (mã '+r+').'); }
    function count(a) { var n=a.numItems; return typeof n==='number'?n:a.length; }
    function describe(c,track) {
        return {id:String(c.nodeId),track:track,start:c.start.seconds,end:c.end.seconds,inPoint:c.inPoint.seconds,name:String(c.name),selected:!!c.isSelected()};
    }
    function newContext(s,fps) { return {project:projectKey(s),fps:fps,tracks:{}}; }
    function trackIndex(s,track,fps,ctx) {
        var key=String(track),cached=ctx && ctx.tracks[key];
        var data=trackData(s,track),clips=data.clips,total=data.count;
        if(cached && cached.count===total) return cached;
        var out={ids:{},starts:{},count:total,ordered:true},previous=-Infinity;
        for(var i=0;i<total;i++) {
            var c=clips[i],id=String(c.nodeId),start=c.start.seconds;
            data.scanned[i]={clip:c,id:id,start:start};
            out.ids['$'+id]=i;
            var frame=String(Math.round(start*fps));
            (out.starts[frame]||(out.starts[frame]=[])).push(i);
            if(start<previous)out.ordered=false;
            previous=start;
        }
        if(ctx) ctx.tracks[key]=out;
        return out;
    }
    function cachedContext(s,fps) {
        return batchContext && batchContext.project===projectKey(s) && Math.abs(batchContext.fps-fps)<1e-6 ? batchContext : newContext(s,fps);
    }
    function getClip(s,track,id,ctx,fps) {
        var data=trackData(s,track);
        if(ctx && number(fps)) {
            var index=trackIndex(s,track,fps,ctx),slot=index.ids['$'+String(id)];
            var scanned=slot===undefined?null:data.scanned[slot];
            if(scanned && scanned.id===String(id))return scanned.clip;
            var pf=pfMetrics();
            lap();var hit=slot===undefined?null:data.clips[slot];pf.clipRefUs+=lap();pf.clipRefReads++;
            // Resolve the current collection slot, never reuse a detached host clip.
            if(hit) {var hitId=hit.nodeId;pf.nodeIdUs+=lap();pf.nodeIdReads++;if(String(hitId)===String(id)) return hit;}
            delete ctx.tracks[String(track)];
            index=trackIndex(s,track,fps,ctx);slot=index.ids['$'+String(id)];
            hit=slot===undefined?null:data.clips[slot];
            if(hit && String(hit.nodeId)===String(id)) return hit;
            error('Clip đã bị xóa hoặc thay thế. Quét lại timeline.');
        }
        var clips=data.clips;
        for(var i=0;i<data.count;i++) if(String(clips[i].nodeId)===String(id)) return clips[i];
        error('Clip đã bị xóa hoặc thay thế. Quét lại timeline.');
    }
    function activeHistory(key) {
        return historyByKey['$'+key] || null;
    }
    function forgetRecord(rec) {
        delete historyByKey['$'+rec.key];
        for(var i=history.length-1;i>=0;i--) if(history[i]===rec || history[i].key===rec.key) history.splice(i,1);
    }
    var CROP_NAMES=['Left','Top','Right','Bottom'];
    // Single predicate for "this matchName is a Crop effect", used by the full scan and by cache learning.
    // Premiere Pro 23 reports the native Crop as "AE.ADBE AECrop", which the older pattern (Crop after
    // a space or dot) does not match. Matching is exact after trimming, so similar names do not qualify.
    var NATIVE_CROP_MATCH_NAMES={'AE.ADBE AECrop':true};
    function isCropMatchName(name) {
        var text=String(name);
        return NATIVE_CROP_MATCH_NAMES.hasOwnProperty(text.replace(/^\s+|\s+$/g,'')) || /(^|[ .])Crop$/i.test(text);
    }
    // Write path only. Plain data learned from a fully scanned clip (cropShape) is re-checked against
    // this clip; any mismatch returns null and the caller runs the full scan below.
    // Aggregated diagnostics only (per host call); at most one value sample per call.
    var CROP_CACHE_COUNTERS=['cropCacheNoShape','cropCacheComponentCountMismatch','cropCacheComponentMissing','cropCacheMatchNameMismatch','cropCachePropertyCountMismatch','cropCachePropertyMissing','cropCachePropertyNameMismatch','cropCacheOtherFailure','cropCacheLearned','cropCacheNotLearned','cropFastPropertyHits','cropFullPropertyValidations','cropFastPropertyFallbacks'];
    function cropCount(name) { var c=liveCall.cropStats||(liveCall.cropStats={}); c[name]=(c[name]||0)+1; }
    // Only the exact native Premiere Pro 23 Crop may reuse learned property indexes without rereading names.
    var NATIVE_CROP_FAST_MATCH_NAME='AE.ADBE AECrop';
    function cropMiss(name,expected,actual) {
        cropCount(name);
        // Any failed structural check invalidates the learned shape; the caller runs the full scan and relearns.
        if(cropShape && cropShape.fastProperties && name!=='cropCacheNoShape') cropCount('cropFastPropertyFallbacks');
        cropShape=null;
        if(!liveCall.cropSample && name!=='cropCacheNoShape') liveCall.cropSample=name+': expected '+typeof expected+' '+String(expected)+', actual '+typeof actual+' '+String(actual);
        return null;
    }
    function cachedCrop(c) {
        var shape=cropShape;
        if(!shape) return cropMiss('cropCacheNoShape','shape','none');
        try {
            var pf=pfMetrics();
            lap();var components=c.components,total=components.numItems;pf.cropComponentsUs+=lap();
            if(total!==shape.components) return cropMiss('cropCacheComponentCountMismatch',shape.components,total);
            var comp=components[shape.index];
            if(comp===undefined || comp===null) return cropMiss('cropCacheComponentMissing',shape.index,comp);
            var rawMatch=comp.matchName;pf.cropComponentRefUs+=lap();
            if(String(rawMatch)!==shape.matchName) return cropMiss('cropCacheMatchNameMismatch',shape.matchName,rawMatch);
            var props=comp.properties;
            if(props===undefined || props===null) return cropMiss('cropCachePropertyMissing','properties',props);
            var propertyTotal=count(props);pf.cropPropertiesUs+=lap();
            if(propertyTotal!==shape.properties) return cropMiss('cropCachePropertyCountMismatch',shape.properties,propertyTotal);
            var mapped={};
            if(shape.fastProperties) {
                // Native Crop, component count, matchName and property count all match the learned structure:
                // reuse the learned Left/Top/Right/Bottom indexes without rereading the four displayName values.
                for(var f=0;f<CROP_NAMES.length;f++) {
                    var fastProp=props[shape.indices[CROP_NAMES[f]]];
                    if(fastProp===undefined || fastProp===null) return cropMiss('cropCachePropertyMissing',shape.indices[CROP_NAMES[f]],fastProp);
                    mapped[CROP_NAMES[f]]=fastProp;
                }
                pf.cropPropertyNamesUs+=lap();
                cropCount('cropFastPropertyHits');
                return {index:shape.index,component:comp,params:mapped,indices:shape.indices};
            }
            cropCount('cropFullPropertyValidations');
            for(var i=0;i<CROP_NAMES.length;i++) {
                var p=props[shape.indices[CROP_NAMES[i]]];
                if(p===undefined || p===null) return cropMiss('cropCachePropertyMissing',shape.indices[CROP_NAMES[i]],p);
                var rawName=p.displayName;pf.cropPropertyNamesUs+=lap();
                if(String(rawName)!==CROP_NAMES[i]) return cropMiss('cropCachePropertyNameMismatch',CROP_NAMES[i],rawName);
                mapped[CROP_NAMES[i]]=p;
            }
            return {index:shape.index,component:comp,params:mapped,indices:shape.indices};
        } catch(e) { return cropMiss('cropCacheOtherFailure','no exception',e.message); }
    }
    function crop(c,quick) {
        if(quick) {
            var cached=cachedCrop(c);
            if(cached) {liveCall.cropHits=(liveCall.cropHits||0)+1;return cached;}
            liveCall.cropScans=(liveCall.cropScans||0)+1;
        }
        var found=[],i,j,comp,matchName;
        var components=c.components,componentCount=components.numItems;
        for(i=0;i<componentCount;i++) {
            comp=components[i];matchName=String(comp.matchName);
            if(isCropMatchName(matchName) || String(comp.displayName)==='Crop') found.push({index:i,component:comp,matchName:matchName});
        }
        if(found.length!==1) error('“'+c.name+'”: cần đúng 1 hiệu ứng Crop. Thêm Crop vào bản sao chữ màu rồi quét lại.');
        var obj=found[0], props=obj.component.properties, names=['Left','Top','Right','Bottom'], mapped={},idx={};
        var propertyCount=count(props);
        var mappedCount=0;
        for(i=0;i<propertyCount;i++) {
            var p=props[i], label=String(p.displayName);
            for(j=0;j<names.length;j++) if(label===names[j]) {if(!mapped[label])mappedCount++;mapped[label]=p;idx[label]=i;}
            if(!quick && label==='Zoom' && (p.isTimeVarying() || p.getValue())) error('Tắt Zoom trong Crop trước.');
            if(!quick && /Feather/i.test(label) && (p.isTimeVarying() || Math.abs(Number(p.getValue()))>0.00001)) error('Đặt Edge Feather của Crop về 0.');
            // Quick (write) path checks no other property: stop once Left/Top/Right/Bottom are mapped.
            if(quick && mappedCount===names.length) break;
        }
        for(i=0;i<names.length;i++) if(!mapped[names[i]]) error('Không nhận diện thuộc tính Crop. Bản 1.0 cần giao diện Premiere tiếng Anh; dùng Xuất log để kiểm tra.');
        obj.params=mapped; obj.indices=idx;
        // Learn only from the built-in Crop matched by matchName, never from a displayName-only match.
        if(quick) {
            cropCount('cropFullPropertyValidations'); // this scan mapped Left/Top/Right/Bottom by reading their names
            if(isCropMatchName(obj.matchName)) {
                cropShape={components:componentCount,index:obj.index,matchName:obj.matchName,properties:propertyCount,indices:idx,fastProperties:obj.matchName===NATIVE_CROP_FAST_MATCH_NAME};
                cropCount('cropCacheLearned');
                if(!liveCall.cropLearnSample) liveCall.cropLearnSample='components '+typeof componentCount+' '+componentCount+', index '+obj.index+', matchName '+obj.matchName+', properties '+typeof propertyCount+' '+propertyCount+', indices '+JSON.stringify(idx);
            } else {
                cropCount('cropCacheNotLearned');
                if(!liveCall.cropLearnSample) liveCall.cropLearnSample='not learned: matchName '+obj.matchName+' does not end in Crop (matched by displayName)';
            }
        }
        return obj;
    }
    function snapshot(param) {
        var varying=!!param.isTimeVarying(), keys=param.getKeys(), points=[];
        if(keys && keys.length) for(var i=0;i<keys.length;i++) points.push({seconds:keys[i].seconds,value:param.getValueAtKey(keys[i])});
        points.sort(function(a,b){return a.seconds-b.seconds;});
        return {varying:varying,keys:points,value:varying?null:param.getValue()};
    }
    function sameSnapshot(a,b) {
        if(a.varying!==b.varying || a.keys.length!==b.keys.length) return false;
        if(!a.varying && (!number(a.value)||!number(b.value)||Math.abs(a.value-b.value)>0.0001)) return false;
        for(var i=0;i<a.keys.length;i++) if(!number(a.keys[i].seconds)||!number(b.keys[i].seconds)||!number(a.keys[i].value)||!number(b.keys[i].value)||Math.abs(a.keys[i].seconds-b.keys[i].seconds)>1e-7 || Math.abs(a.keys[i].value-b.keys[i].value)>0.0001) return false;
        return true;
    }
    function currentMatches(rec,obj) {
        if(rec.effectIndex!==obj.index) return false;
        for(var k in rec.after) if(rec.after.hasOwnProperty(k) && !sameSnapshot(rec.after[k],snapshot(obj.params[k]))) return false;
        return true;
    }
    function differences(rec,obj) {
        var out=[];
        if(rec.effectIndex!==obj.index) out.push({property:'effectIndex',expected:rec.effectIndex,actual:obj.index});
        for(var k in rec.after) if(rec.after.hasOwnProperty(k)) {
            var actual=snapshot(obj.params[k]);
            if(!sameSnapshot(rec.after[k],actual)) out.push({property:k,expected:rec.after[k],actual:actual});
        }
        return out;
    }
    function restore(rec,requireUnchanged) {
        var s=seq();
        if(projectKey(s)!==rec.project) error('Mở đúng sequence đã áp dụng để hoàn tác.');
        var c=getClip(s,rec.track,rec.id), obj=crop(c);
        if(obj.index!==rec.effectIndex) error('Vị trí hiệu ứng đã đổi; không tự hoàn tác clip này.');
        if(requireUnchanged && !currentMatches(rec,obj)) error('Crop đã được sửa sau khi chạy; không ghi đè chỉnh sửa của bạn.');
        for(var k in rec.before) if(rec.before.hasOwnProperty(k)) {
            var p=obj.params[k], keys=p.getKeys();
            if(keys && keys.length) for(var i=keys.length-1;i>=0;i--) checkRC(p.removeKey(keys[i]),'Xóa keyframe');
            checkRC(p.setTimeVarying(false),'Tắt keyframe');
            checkRC(p.setValue(rec.before[k].value,true),'Khôi phục Crop');
        }
    }
    function basicCheck(c) {
        if(c.disabled) error('Clip đang tắt.');
        if(Math.abs(c.getSpeed()-1)>0.000001 || c.isSpeedReversed()) error('Chỉ hỗ trợ clip tốc độ 100%, không đảo ngược.');
    }
    function inspect(opts) {
        var inspectBegan=new Date().getTime(),ip={settingsUs:0,videoTracksUs:0,numTracksUs:0,trackRefUs:0,clipsUs:0,numItemsUs:0,clipRefUs:0,isSelectedUs:0,nodeIdUs:0,startUs:0,endUs:0,inPointUs:0,nameUs:0,summaryUs:0,activeSequenceAgainUs:0,scanned:0};
        var s=seq();
        lap();var settings=s.getSettings();ip.settingsUs+=lap();
        var fps=sequenceFps(s), track=opts.track-1;
        if(!number(fps)||fps<1) error('Không đọc được FPS.');
        var trackCountValue;
        if(track>=0){lap();var videoTracksRef=s.videoTracks;ip.videoTracksUs+=lap();trackCountValue=videoTracksRef.numTracks;ip.numTracksUs+=lap();}
        if(track<0||track>=trackCountValue) error('Track chữ màu không tồn tại.');
        lap();var trackRef=s.videoTracks[track];ip.trackRefUs+=lap();
        var clips=trackRef.clips;ip.clipsUs+=lap();
        var total=clips.numItems;ip.numItemsUs+=lap();
        var list=[],fast=opts.fast===true;
        var ctx=fast?newContext(s,fps):null,index={ids:{},starts:{},count:total,ordered:true},previous=-Infinity;
        for(var i=0;i<total;i++) {
            lap();var c=clips[i];ip.clipRefUs+=lap();
            if(opts.selectedOnly) {var isSelected=c.isSelected();ip.isSelectedUs+=lap();if(!isSelected) continue;}
            var d;
            if(fast) {
                var cueId=String(c.nodeId);ip.nodeIdUs+=lap();
                var cueStart=c.start.seconds;ip.startUs+=lap();
                var cueEnd=c.end.seconds;ip.endUs+=lap();
                var cueInPoint=c.inPoint.seconds;ip.inPointUs+=lap();
                var cueName=String(c.name);ip.nameUs+=lap();
                d={id:cueId,track:track,start:cueStart,end:cueEnd,inPoint:cueInPoint,name:cueName};
                ip.scanned++;
            } else d=describe(c,track);
            var rec=activeHistory(projectKey(s)+'|'+d.id);
            d.managed=false; d.error='';d.changed=false;
            if(rec && (rec.track!==track || rec.start===undefined || Math.abs(rec.start-d.start)>1e-7 || Math.abs(rec.end-d.end)>1e-7 || Math.abs(rec.inPoint-d.inPoint)>1e-7)) {forgetRecord(rec);rec=null;}
            if(fast) {
                // Persist plain slots only. getClip still verifies the live ID.
                index.ids['$'+d.id]=i;
                var frame=String(Math.round(d.start*fps));(index.starts[frame]||(index.starts[frame]=[])).push(i);
                if(d.start<previous)index.ordered=false;previous=d.start;
                d.managed=!!rec;
            } else {
            try {
                basicCheck(c); var cp=crop(c);
            if(rec) {if(!currentMatches(rec,cp)) {d.changed=true;d.differences=differences(rec,cp);var labels=[];for(var z=0;z<d.differences.length;z++)labels.push(d.differences[z].property);error('Crop đã thay đổi ở '+labels.join(', ')+'. Kiểm tra Crop hoặc dùng Làm sạch Crop để tạo lại.');}d.managed=true;}
                else for(var n in cp.params) if(cp.params.hasOwnProperty(n) && cp.params[n].isTimeVarying()) error('Crop đã có animation; bản này không ghi đè.');
            } catch(e) {d.error=e.message;}
            }
            list.push(d);
        }
        if(ctx){ctx.tracks[String(track)]=index;batchContext=ctx;}
        lap();
        lastInspect={project:projectKey(s),sequence:String(s.name),fps:fps,videoDisplayFormat:settings.videoDisplayFormat===undefined?s.videoDisplayFormat:settings.videoDisplayFormat,zeroSeconds:Number(s.zeroPoint||0)/TPS,width:settings.videoFrameWidth||s.frameSizeHorizontal,height:settings.videoFrameHeight||s.frameSizeVertical,clips:list,version:app.version,runtimeVersion:'1.2.10',undoCount:history.length};
        ip.summaryUs+=lap();
        // Read-only probe: a further activeSequence read at the end of the scan.
        var again=app.project.activeSequence;ip.activeSequenceAgainUs+=lap();
        var us=function(v){return Math.round(v)/1000;},setupParts=liveCall.setup||{},measured=ip.settingsUs+ip.videoTracksUs+ip.numTracksUs+ip.trackRefUs+ip.clipsUs+ip.numItemsUs+ip.clipRefUs+ip.isSelectedUs+ip.nodeIdUs+ip.startUs+ip.endUs+ip.inPointUs+ip.nameUs+ip.summaryUs+ip.activeSequenceAgainUs;
        var setupMeasured=(setupParts.appVersionUs||0)+(setupParts.activeSequenceUs||0)+(setupParts.activeSequenceRepeatUs||0)+(setupParts.projectIdUs||0)+(setupParts.sequenceIdUs||0)+(setupParts.timebaseUs||0),totalMs=new Date().getTime()-inspectBegan;
        lastInspect.stats={timerSource:HIRES?'hires':'date',inspTotalMs:totalMs,inspClips:total,inspClipsRead:ip.scanned,
            setupAppVersionMs:us(setupParts.appVersionUs||0),setupActiveSequenceMs:us(setupParts.activeSequenceUs||0),setupActiveSequenceRepeatMs:us(setupParts.activeSequenceRepeatUs||0),setupProjectIdMs:us(setupParts.projectIdUs||0),setupSequenceIdMs:us(setupParts.sequenceIdUs||0),setupTimebaseMs:us(setupParts.timebaseUs||0),
            inspSettingsMs:us(ip.settingsUs),inspVideoTracksMs:us(ip.videoTracksUs),inspNumTracksMs:us(ip.numTracksUs),inspTrackRefMs:us(ip.trackRefUs),inspClipsMs:us(ip.clipsUs),inspNumItemsMs:us(ip.numItemsUs),
            inspClipRefMs:us(ip.clipRefUs),inspIsSelectedMs:us(ip.isSelectedUs),inspNodeIdMs:us(ip.nodeIdUs),inspStartMs:us(ip.startUs),inspEndMs:us(ip.endUs),inspInPointMs:us(ip.inPointUs),inspNameMs:us(ip.nameUs),
            inspSummaryMs:us(ip.summaryUs),inspActiveSequenceAgainMs:us(ip.activeSequenceAgainUs),
            inspOtherMs:Math.round((totalMs-(measured+setupMeasured)/1000)*1000)/1000};
        return lastInspect;
    }
    function partner(s,track,source,fps,ctx,bounds) {
        var data=trackData(s,track);
        var index=trackIndex(s,track,fps,ctx),hits=[],tol=0.51/fps;
        var clips=data.clips,total=data.count,start=bounds?bounds.start:source.start.seconds,end=bounds?bounds.end:source.end.seconds,lo=0,hi=total;
        if(ctx && ctx.preparing) {
            // This index was built inside the same synchronous preparation call.
            // Use its buckets only here, never across an asynchronous panel yield.
            var base=Math.round(start*fps);
            for(var f=base-2;f<=base+2;f++) {
                var slots=index.starts[String(f)]||[];
                for(var a=0;a<slots.length;a++) {
                    var scanned=data.scanned[slots[a]],prepared=scanned?scanned.clip:clips[slots[a]];
                    if(Math.abs((scanned?scanned.start:prepared.start.seconds)-start)<tol && Math.abs(prepared.end.seconds-end)<tol)hits.push(prepared);
                }
            }
            if(hits.length!==1)error('V'+(track+1)+': cần đúng 1 bản sao trùng thời gian đầu/cuối với “'+source.name+'”.');
            return hits[0];
        }
        // Timeline collections are chronological. Check this while indexing and
        // use a full live scan for collections that do not have that ordering.
        // Search live times, so same-count moves/replacements are not hidden by
        // a cached start-time bucket.
        // Consecutive cues usually have consecutive base copies. Advance live
        // slots locally; fall back to binary search for sparse or reversed cues.
        if(index.ordered && data.cursor && start>=data.cursor.start) {
            lo=data.cursor.lo;
            for(var step=0;step<8 && lo<total;step++) {
                if(clips[lo].start.seconds>=start-tol) {hi=lo;break;}
                lo++;
            }
        }
        if(index.ordered)while(lo<hi) {
            var mid=Math.floor((lo+hi)/2);
            if(clips[mid].start.seconds<start-tol)lo=mid+1;else hi=mid;
        }
        if(index.ordered)data.cursor={start:start,lo:lo};
        for(var i=lo;i<total;i++) {
            var candidate=clips[i],candidateStart=candidate.start.seconds;
            if(index.ordered && candidateStart>start+tol)break;
            if(Math.abs(candidateStart-start)<tol && Math.abs(candidate.end.seconds-end)<tol)hits.push(candidate);
        }
        if(hits.length!==1) error('V'+(track+1)+': cần đúng 1 bản sao trùng thời gian đầu/cuối với “'+source.name+'”.');
        return hits[0];
    }
    function validateItem(s,plan,item,ctx) {
        if(!number(item.start)||!number(item.end)||!number(item.inPoint))error('Thời gian cue không hợp lệ.');
        var prepared=liveCall.prepared && liveCall.prepared['$'+item.id];
        var c=prepared?prepared.clip:getClip(s,item.track,item.id,ctx,plan.fps);
        var pf=pfMetrics(),start,end,inPoint;
        if(prepared) {start=prepared.start;end=prepared.end;inPoint=prepared.inPoint;}
        else {
            lap();start=c.start.seconds;pf.startUs+=lap();pf.startReads++;
            end=c.end.seconds;pf.endUs+=lap();pf.endReads++;
            inPoint=c.inPoint.seconds;pf.inPointUs+=lap();pf.inPointReads++;
        }
        if(trackData(s,item.track).locked) error('Track đang khóa.');
        if(Math.abs(start-item.start)>1e-7||Math.abs(end-item.end)>1e-7||Math.abs(inPoint-item.inPoint)>1e-7) error('Clip đã đổi thời gian. Quét lại.');
        var id=String(item.id),key=projectKey(s)+'|'+id,cropBegan=new Date().getTime(),obj=prepared?prepared.crop:crop(c,true),rec=activeHistory(key);
        liveCall.cropMs=(liveCall.cropMs||0)+new Date().getTime()-cropBegan;
        if(rec) error('Clip đã chạy. Hoàn tác trước nếu muốn đổi thông số.');
        var names=['Left','Top','Right','Bottom'],before={};
        for(var n=0;n<names.length;n++) {
            var p=obj.params[names[n]];
            lap();var varying=p.isTimeVarying();pf.isTimeVaryingUs+=lap();pf.isTimeVaryingCalls++;
            if(varying) error('Crop có keyframe sẵn; không ghi đè.');
            var currentValue=p.getValue();pf.getValueUs+=lap();pf.getValueCalls++;
            before[names[n]]={varying:false,keys:[],value:currentValue};
            if(!number(before[names[n]].value)) error('Giá trị Crop không phải số.');
        }
        validateKeys(item,plan.fps);
        return {clip:c,crop:obj,inPoint:inPoint,record:{project:projectKey(s),key:key,id:id,track:item.track,start:start,end:end,inPoint:inPoint,effectIndex:obj.index,before:before,after:{}}};
    }
    function validateKeys(item,fps) {
        if(!number(item.start)||!number(item.end)||!number(item.inPoint))error('Thời gian cue không hợp lệ.');
        if(!item.keys || !item.keys.length || item.keys.length>3000) error('Số keyframe không hợp lệ.');
        var last=-1,limit=Math.round((item.end-item.start)*fps)-1;
        for(var i=0;i<item.keys.length;i++) {
            var k=item.keys[i];
            if(!number(k.frame)||k.frame%1!==0||k.frame<=last||k.frame<0||k.frame>limit||!number(k.value)||k.value<0||k.value>100||(k.interp!==0&&k.interp!==4)) error('Keyframe không hợp lệ.');
            last=k.frame;
        }
        if(!number(item.top)||!number(item.bottom)||item.top<0||item.bottom<0||item.top+item.bottom>=100) error('Vùng cắt dọc không hợp lệ.');
    }
    function preflight(plan,ctx) {
        var s=seq();
        if(projectKey(s)!==plan.project || !number(plan.fps) || Math.abs(sequenceFps(s)-plan.fps)>1e-6) error('Sequence hoặc FPS đã đổi. Quét lại.');
        if(plan.baseTrack===plan.track) error('Track chữ trắng và chữ màu phải khác nhau.');
        ctx=ctx||cachedContext(s,plan.fps);
        var list=[],ids={};
        for(var i=0;i<plan.items.length;i++) {
            var item=plan.items[i];
            if(ids[item.id]) error('Một clip xuất hiện hai lần trong kế hoạch.'); ids[item.id]=true;
            if(item.track!==plan.track) error('Track không hợp lệ.');
            var checked=validateItem(s,plan,item,ctx);
            list.push(checked);
        }
        return list;
    }
    function prepare(plan) { var list=preflight(plan); return {ready:list.length}; }
    function prepareAll(req) {
        var s=seq();
        if(projectKey(s)!==req.project || Math.abs(sequenceFps(s)-req.fps)>1e-6) error('Sequence hoặc FPS đã đổi. Quét lại.');
        if(req.baseTrack===req.track) error('Track chữ trắng và chữ màu phải khác nhau.');
        var ctx=newContext(s,req.fps);ctx.preparing=true;
        // Build each needed index once. This replaces thousands of full-track scans.
        trackIndex(s,req.baseTrack,req.fps,ctx);trackIndex(s,req.track,req.fps,ctx);
        for(var i=0;i<req.clips.length;i++) {
            var raw=req.clips[i],item=req.compact?{id:raw[0],start:raw[1],end:raw[2],inPoint:raw[3]}:raw;
            if(req.compact && raw.length!==4)error('Dữ liệu kiểm tra cue rút gọn không hợp lệ.');
            if(!number(item.start)||!number(item.end)||!number(item.inPoint))error('Thời gian cue không hợp lệ.');
            var c=getClip(s,req.track,item.id,ctx,req.fps),data=trackData(s,req.track),slot=ctx.tracks[String(req.track)].ids['$'+String(item.id)];
            var start=data.scanned[slot]?data.scanned[slot].start:c.start.seconds,end=c.end.seconds,inPoint=c.inPoint.seconds;
            if(Math.abs(start-item.start)>1e-7||Math.abs(end-item.end)>1e-7||Math.abs(inPoint-item.inPoint)>1e-7) error('Clip đã đổi thời gian. Quét lại.');
            if(data.locked) error('Track đang khóa.');
            basicCheck(c);var cp=crop(c),rec=activeHistory(recordKey(s,c));
            if(rec) error('Clip đã chạy. Hoàn tác trước nếu muốn đổi thông số.');
            for(var n in cp.params) if(cp.params.hasOwnProperty(n) && cp.params[n].isTimeVarying()) error('Crop đã có animation; bản này không ghi đè.');
            var b=partner(s,req.baseTrack,c,req.fps,ctx,{start:start,end:end});
            basicCheck(b);
            if(liveCall.prepared)liveCall.prepared['$'+item.id]={clip:c,crop:cp,start:start,end:end,inPoint:inPoint};
        }
        ctx.preparing=false;batchContext=ctx;
        // The one-line panel uses preparation only as a safety gate. Do not
        // serialize one unused base-copy description per cue across CEP.
        return {ready:req.clips.length};
    }
    function lookupPartners(req) {
        var s=seq();if(projectKey(s)!==req.project) error('Sequence đã đổi.');
        var ctx=cachedContext(s,req.fps),out=[];
        trackIndex(s,req.baseTrack,req.fps,ctx);trackIndex(s,req.track,req.fps,ctx);
        for(var i=0;i<req.clips.length;i++) {
            var c=getClip(s,req.track,req.clips[i].id,ctx,req.fps);
            var b=partner(s,req.baseTrack,c,req.fps,ctx);
            var item={id:String(c.nodeId),base:describe(b,req.baseTrack)};
            out.push(item);
        }
        batchContext=ctx;
        return out;
    }
    function apply(plan,deferRefresh) {
        if(plan.items.length!==1) error('Chế độ 1 dòng chỉ cho phép đúng một lớp màu cho mỗi cue.');
        var began=new Date().getTime(),cropBefore=liveCall.cropMs||0,hitsBefore=liveCall.cropHits||0,scansBefore=liveCall.cropScans||0,list=preflight(plan), touched=[],refresh=null;
        var stats={preflightMs:new Date().getTime()-began,cropMs:(liveCall.cropMs||0)-cropBefore,cropCacheHits:(liveCall.cropHits||0)-hitsBefore,cropFullScans:(liveCall.cropScans||0)-scansBefore,keyframeMs:0,writeMs:0,verifyMs:0,keyframes:0,staticLayers:0,skippedWrites:0};
        try {
            for(var i=0;i<list.length;i++) {
                var entry=list[i], item=plan.items[i], p=entry.crop.params,rec=entry.record,kf=kfMetrics();
                touched.push(rec);
                var writeStart=new Date().getTime();
                var desired={Left:0,Top:item.top,Bottom:item.bottom};
                for(var field in desired)if(desired.hasOwnProperty(field)) {
                    if(rec.before[field].value===desired[field])stats.skippedWrites++;
                    else {
                        lap();
                        checkRC(p[field].setValue(desired[field],false),'Crop '+field);
                        kf.staticWriteUs+=lap();kf.staticValueWrites++;
                    }
                }
                // One value from frame zero describes a constant stream (e.g.
                // the unused lower layer). Avoid creating an animation for it.
                var constant=item.keys.length===1 && item.keys[0].frame===0;
                if(constant) {
                    if(rec.before.Right.value!==item.keys[0].value){lap();checkRC(p.Right.setValue(item.keys[0].value,false),'Crop Right');kf.staticWriteUs+=lap();kf.staticValueWrites++;}
                    else stats.skippedWrites++;
                    refresh={param:p.Right,value:item.keys[0].value,constant:true};
                    stats.staticLayers++;
                    if(!deferRefresh && i===list.length-1)checkRC(p.Right.setValue(item.keys[0].value,true),'Làm mới giao diện');
                } else {
                var keyframeStart=new Date().getTime();
                lap();
                checkRC(p.Right.setTimeVarying(true),'Bật keyframe');
                kf.setTimeVaryingUs+=lap();kf.setTimeVaryingCalls++;
                var autoKeys=p.Right.getKeys();
                kf.getKeysUs+=lap();kf.getKeysCalls++;
                var existingKeys=autoKeys && autoKeys.length?autoKeys.length:0;
                kf.existingKeys+=existingKeys;if(existingKeys===0)kf.cuesWithZeroKeys++;else if(existingKeys===1)kf.cuesWithOneKey++;else kf.cuesWithManyKeys++;
                if(autoKeys && autoKeys.length) for(var a=autoKeys.length-1;a>=0;a--) {checkRC(p.Right.removeKey(autoKeys[a]),'Xóa keyframe tự sinh');kf.removeKeyUs+=lap();kf.keysRemoved++;}
                for(var j=0;j<item.keys.length;j++) {
                    var k=item.keys[j], t=liveCall.keyTime||(liveCall.keyTime=time(0));
                    t.seconds=entry.inPoint+k.frame/plan.fps;
                    kf.timeObjectUs+=lap();
                    checkRC(p.Right.addKey(t),'Thêm keyframe');
                    kf.addKeyUs+=lap();kf.keysAdded++;
                    checkRC(p.Right.setValueAtKey(t,k.value,false),'Ghi keyframe');
                    kf.setValueAtKeyUs+=lap();kf.valuesWritten++;
                    checkRC(p.Right.setInterpolationTypeAtKey(t,k.interp,!deferRefresh&&i===list.length-1&&j===item.keys.length-1),'Nội suy keyframe');
                    kf.setInterpolationUs+=lap();kf.interpolationWrites++;
                }
                refresh={param:p.Right,seconds:t.seconds,interp:k.interp};
                stats.keyframes+=item.keys.length;
                stats.keyframeMs+=new Date().getTime()-keyframeStart;
                }
                stats.writeMs+=new Date().getTime()-writeStart;
                // Keep the expected state for an explicit Undo or later scan.
                // Do not read thousands of keyframe values back after writing.
                for(var name in desired)if(desired.hasOwnProperty(name))rec.after[name]={varying:false,keys:[],value:desired[name]};
                var points=[];
                if(!constant)for(var v=0;v<item.keys.length;v++)points.push({seconds:entry.inPoint+item.keys[v].frame/plan.fps,value:item.keys[v].value});
                rec.after.Right={varying:!constant,keys:points,value:constant?item.keys[0].value:null};
            }
        } catch(e) {
            var rollback=[];
            for(var r=touched.length-1;r>=0;r--) try {restore(touched[r],false);} catch(er) {rollback.push(er.message);}
            error(e.message+(rollback.length?' | KHÔNG HOÀN TÁC ĐƯỢC: '+rollback.join('; '):' | Đã hoàn tác cue bị lỗi.'));
        }
        for(var h=0;h<touched.length;h++) {history.push(touched[h]);historyByKey['$'+touched[h].key]=touched[h];}
        var result={applied:touched.length,undoCount:history.length,stats:stats};
        // Host references stay inside applyBatch and must not be JSON serialized.
        if(deferRefresh)result.refresh=refresh;
        return result;
    }
    function unpackPlans(req,all) {
        if(!req.compact)return req.plans||[];
        var rows=req.items||[],plans=[];
        if(!rows.length || (!all && rows.length>5000))error('Lô ghi phải có từ 1 đến 5000 cue.');
        for(var i=0;i<rows.length;i++) {
            var row=rows[i],keys=[];
            if(!row || row.length!==7 || !row[6] || !row[6].length || row[6].length>3000)error('Dữ liệu cue rút gọn không hợp lệ.');
            for(var j=0;j<row[6].length;j++) {
                var k=row[6][j];if(!k || k.length!==3)error('Keyframe rút gọn không hợp lệ.');
                keys.push({frame:k[0],value:k[1],interp:k[2]});
            }
            plans.push({project:req.project,fps:req.fps,baseTrack:req.baseTrack,track:req.track,items:[{id:row[0],track:req.track,start:row[1],end:row[2],inPoint:row[3],top:row[4],bottom:row[5],keys:keys}]});
        }
        return plans;
    }
    function applyBatch(req) {
        var plans=unpackPlans(req),out=[],failure='',refresh=null,warning='';
        if(!plans.length || plans.length>5000) error('Lô ghi phải có từ 1 đến 5000 cue.');
        var budget=req.maxMillis===undefined?30000:req.maxMillis;
        if(!number(budget)||budget<100||budget>60000)error('Thời gian mỗi lượt phải từ 100 đến 60000 ms.');
        var began=new Date().getTime(),stats={cropSample:'',cropLearnSample:'',preflightMs:0,cropMs:0,cropCacheHits:0,cropFullScans:0,keyframeMs:0,writeMs:0,verifyMs:0,keyframes:0,staticLayers:0,skippedWrites:0,refreshMs:0,setupMs:0,cueMs:0};
        // Keep slot indices across yields. getClip validates count and live ID;
        // Only color clip identity, timing, Crop and track lock are checked.
        var s=seq();batchContext=cachedContext(s,sequenceFps(s));
        stats.setupMs=new Date().getTime()-began;
        for(var i=0;i<plans.length;i++) {
            var cueStart=new Date().getTime();
            try {
                var result=apply(plans[i],true);refresh=result.refresh;out.push(String(plans[i].items[0].id));
                if(liveCall.prepared)delete liveCall.prepared['$'+plans[i].items[0].id];
                stats.preflightMs+=result.stats.preflightMs;stats.cropMs+=result.stats.cropMs;stats.cropCacheHits+=result.stats.cropCacheHits;stats.cropFullScans+=result.stats.cropFullScans;stats.keyframeMs+=result.stats.keyframeMs;stats.writeMs+=result.stats.writeMs;
                stats.verifyMs+=result.stats.verifyMs;stats.keyframes+=result.stats.keyframes;
                stats.staticLayers+=result.stats.staticLayers;stats.skippedWrites+=result.stats.skippedWrites;
            }catch(e) {failure=String(e.message||e);break;}
            stats.cueMs+=new Date().getTime()-cueStart;
            // Yield only between complete cues, never halfway through both layers.
            if(new Date().getTime()-began>=budget)break;
        }
        var pfOut=pfMetrics(),kfOut=kfMetrics(),setupParts=liveCall.setup||{},ms=function(us){return Math.round(us)/1000;};
        // Read-only probe after this call's writes: compare with setupActiveSequenceMs (before the writes).
        lap();var probe=app.project.activeSequence;stats.activeSequenceAfterWritesMs=ms(lap());
        stats.pfTrackVideoTracksMs=ms(pfOut.trackVideoTracksUs);stats.pfTrackNumTracksMs=ms(pfOut.trackNumTracksUs);stats.pfTrackRefMs=ms(pfOut.trackRefUs);stats.pfTrackClipsMs=ms(pfOut.trackClipsUs);
        stats.pfTrackNumItemsMs=ms(pfOut.trackNumItemsUs);stats.pfTrackLockedMs=ms(pfOut.trackLockedUs);stats.pfClipRefMs=ms(pfOut.clipRefUs);stats.pfNodeIdMs=ms(pfOut.nodeIdUs);
        stats.pfStartMs=ms(pfOut.startUs);stats.pfEndMs=ms(pfOut.endUs);stats.pfInPointMs=ms(pfOut.inPointUs);
        stats.pfCropComponentsMs=ms(pfOut.cropComponentsUs);stats.pfCropComponentRefMs=ms(pfOut.cropComponentRefUs);stats.pfCropPropertiesMs=ms(pfOut.cropPropertiesUs);stats.pfCropPropertyNamesMs=ms(pfOut.cropPropertyNamesUs);
        stats.pfIsTimeVaryingMs=ms(pfOut.isTimeVaryingUs);stats.pfGetValueMs=ms(pfOut.getValueUs);
        stats.pfClipRefReads=pfOut.clipRefReads;stats.pfNodeIdReads=pfOut.nodeIdReads;stats.pfStartReads=pfOut.startReads;stats.pfEndReads=pfOut.endReads;stats.pfInPointReads=pfOut.inPointReads;
        stats.pfIsTimeVaryingCalls=pfOut.isTimeVaryingCalls;stats.pfGetValueCalls=pfOut.getValueCalls;
        // preflightMs minus every measured read (cropMs is the whole Crop lookup, so its fine-grained parts are not subtracted twice)
        stats.pfOtherMs=Math.round((stats.preflightMs-stats.cropMs-stats.pfTrackVideoTracksMs-stats.pfTrackNumTracksMs-stats.pfTrackRefMs-stats.pfTrackClipsMs-stats.pfTrackNumItemsMs-stats.pfTrackLockedMs-stats.pfClipRefMs-stats.pfNodeIdMs-stats.pfStartMs-stats.pfEndMs-stats.pfInPointMs-stats.pfIsTimeVaryingMs-stats.pfGetValueMs)*1000)/1000;
        sessionKeyframes+=stats.keyframes;if(out.length)lastWriteAt=new Date().getTime();
        stats.timerSource=HIRES?'hires':'date';
        stats.kfSetTimeVaryingMs=ms(kfOut.setTimeVaryingUs);stats.kfGetKeysMs=ms(kfOut.getKeysUs);stats.kfRemoveKeyMs=ms(kfOut.removeKeyUs);stats.kfTimeObjectMs=ms(kfOut.timeObjectUs);
        stats.kfAddKeyMs=ms(kfOut.addKeyUs);stats.kfSetValueAtKeyMs=ms(kfOut.setValueAtKeyUs);stats.kfSetInterpolationMs=ms(kfOut.setInterpolationUs);stats.staticWriteMs=ms(kfOut.staticWriteUs);
        stats.kfSetTimeVaryingCalls=kfOut.setTimeVaryingCalls;stats.kfGetKeysCalls=kfOut.getKeysCalls;stats.kfExistingKeys=kfOut.existingKeys;stats.kfCuesWithZeroKeys=kfOut.cuesWithZeroKeys;stats.kfCuesWithOneKey=kfOut.cuesWithOneKey;stats.kfCuesWithManyKeys=kfOut.cuesWithManyKeys;
        stats.kfKeysRemoved=kfOut.keysRemoved;stats.kfKeysAdded=kfOut.keysAdded;stats.kfValuesWritten=kfOut.valuesWritten;stats.kfInterpolationWrites=kfOut.interpolationWrites;stats.staticValueWrites=kfOut.staticValueWrites;
        stats.setupAppVersionMs=ms(setupParts.appVersionUs||0);stats.setupActiveSequenceMs=ms(setupParts.activeSequenceUs||0);stats.setupProjectIdMs=ms(setupParts.projectIdUs||0);
        stats.setupActiveSequenceRepeatMs=ms(setupParts.activeSequenceRepeatUs||0);stats.setupSequenceIdMs=ms(setupParts.sequenceIdUs||0);stats.setupTimebaseMs=ms(setupParts.timebaseUs||0);
        stats.setupUnattributedMs=Math.round((stats.setupMs-stats.setupAppVersionMs-stats.setupActiveSequenceMs-stats.setupActiveSequenceRepeatMs-stats.setupProjectIdMs-stats.setupSequenceIdMs-stats.setupTimebaseMs)*1000)/1000;
        var cropStats=liveCall.cropStats||{};
        for(var cc=0;cc<CROP_CACHE_COUNTERS.length;cc++) stats[CROP_CACHE_COUNTERS[cc]]=cropStats[CROP_CACHE_COUNTERS[cc]]||0;
        stats.cropSample=liveCall.cropSample||'';stats.cropLearnSample=liveCall.cropLearnSample||'';
        var refreshStart=new Date().getTime();
        if(refresh)try {
            if(refresh.constant)checkRC(refresh.param.setValue(refresh.value,true),'Làm mới giao diện');
            else checkRC(refresh.param.setInterpolationTypeAtKey(time(refresh.seconds),refresh.interp,true),'Làm mới giao diện');
        }catch(er){warning='Đã gửi keyframe, nhưng làm mới giao diện thất bại: '+String(er.message||er);}
        stats.refreshMs=new Date().getTime()-refreshStart;
        return {applied:out.length,ids:out,error:failure,warning:warning,stats:stats,elapsedMs:new Date().getTime()-began};
    }
    function beginRun(req) {
        runCache=null;cropShape=null;
        var began=new Date().getTime(),plans=unpackPlans(req,true),ids={};
        if(!plans.length)error('Kế hoạch không có cue.');
        if(!number(req.count)||req.count%1!==0||req.count<1||req.count>5000)error('Số cue mỗi lượt không hợp lệ.');
        if(!req.compact)error('Cache kế hoạch yêu cầu dữ liệu rút gọn.');
        for(var i=0;i<plans.length;i++){
            var item=plans[i].items[0];validateKeys(item,req.fps);
            if(ids['$'+item.id])error('Một clip xuất hiện hai lần trong kế hoạch.');ids['$'+item.id]=true;
        }
        // Do not pre-scan every Crop before writing. Each cue is checked directly
        // before it is written, so the same Premiere DOM work is not repeated.
        // Persist only plain plans and the cursor. Adobe objects live in this call.
        runCache={token:++runSerial,project:req.project,fps:req.fps,plans:plans,position:0};
        var preparedMs=new Date().getTime()-began,result=continueRun({token:runCache.token,position:0,count:req.count,maxMillis:req.maxMillis});
        result.prepareMs=preparedMs;
        return result;
    }
    function continueRun(req) {
        if(!runCache || req.token!==runCache.token)error('Cache kế hoạch đã hết hiệu lực. Quét lại và áp dụng.');
        if(req.position!==runCache.position)error('Tiến độ cache không khớp. Quét lại để kiểm tra các cue đã ghi.');
        if(!number(req.count)||req.count%1!==0||req.count<1||req.count>5000)error('Số cue mỗi lượt không hợp lệ.');
        var result=applyBatch({plans:runCache.plans.slice(runCache.position,runCache.position+req.count),maxMillis:req.maxMillis});
        runCache.position+=result.applied;
        result.token=runCache.token;result.position=runCache.position;result.total=runCache.plans.length;
        return result;
    }
    function undo() {
        var restored=0,errors=[];
        for(var i=history.length-1;i>=0;i--) {
            try {restore(history[i],true);delete historyByKey['$'+history[i].key];history.splice(i,1);restored++;}catch(e){errors.push(e.message);}
        }
        return {restored:restored,errors:errors,remaining:history.length};
    }
    function forgetSession() {
        var forgotten=history.length;
        history=[];historyByKey={};batchContext=null;lastInspect=null;resetPlan=null;cropShape=null;
        return {forgotten:forgotten};
    }
    function resetPreview(req) {
        var s=seq(),fps=sequenceFps(s),ctx=newContext(s,fps),items=[],seen={};
        resetPlan=null;
        if(projectKey(s)!==req.project) error('Sequence đã đổi. Quét lại.');
        if(req.baseTrack<0 || req.track<=req.baseTrack) error('Các track chữ trắng/màu không hợp lệ.');
        if(!req.clips || !req.clips.length) error('Không có clip khớp SRT trong phạm vi đã quét.');
        function add(c,track) {
            if(typeof s.videoTracks[track].isLocked==='function' && s.videoTracks[track].isLocked()) error('V'+(track+1)+' đang khóa.');
            basicCheck(c);var obj=crop(c),states={},animated=false;
            for(var name in obj.params) if(obj.params.hasOwnProperty(name)) {
                states[name]=snapshot(obj.params[name]);
                if(states[name].varying || states[name].keys.length) animated=true;
            }
            if(!animated && !activeHistory(recordKey(s,c))) return;
            var key=recordKey(s,c);if(seen['$'+key])return;seen['$'+key]=true;
            items.push({clip:describe(c,track),effectIndex:obj.index,before:states});
        }
        for(var i=0;i<req.clips.length;i++) {
            var source=req.clips[i],c=getClip(s,req.track,source.id,ctx,fps);
            if(Math.abs(c.start.seconds-source.start)>1e-7 || Math.abs(c.end.seconds-source.end)>1e-7 || Math.abs(c.inPoint.seconds-source.inPoint)>1e-7) error('Clip đã đổi thời gian. Quét lại.');
            partner(s,req.baseTrack,c,fps,ctx);add(c,req.track);
        }
        var token=projectKey(s)+'|reset|'+(++resetSerial);
        resetPlan={project:projectKey(s),token:token,items:items,cursor:0};
        var clips=[];for(var j=0;j<items.length;j++)clips.push(items[j].clip);
        return {token:token,count:items.length,clips:clips};
    }
    function resetBatch(req) {
        var s=seq(),plan=resetPlan,done=0;
        if(req.confirmed!==true) error('Đánh dấu đồng ý xóa keyframe Crop trước.');
        if(!plan || plan.token!==req.token || plan.project!==projectKey(s)) error('Danh sách làm sạch đã hết hiệu lực. Kiểm tra lại.');
        var checked=[],limit=Math.min(plan.items.length,plan.cursor+20);
        // Validate the entire batch against its reviewed snapshot before writing.
        for(var i=plan.cursor;i<limit;i++) {
            var item=plan.items[i],d=item.clip,c=getClip(s,d.track,d.id),obj=crop(c);basicCheck(c);
            if(typeof s.videoTracks[d.track].isLocked==='function' && s.videoTracks[d.track].isLocked()) error('Track đang khóa.');
            if(obj.index!==item.effectIndex || Math.abs(c.start.seconds-d.start)>1e-7 || Math.abs(c.end.seconds-d.end)>1e-7 || Math.abs(c.inPoint.seconds-d.inPoint)>1e-7) error('Clip/hiệu ứng đã đổi sau khi kiểm tra. Kiểm tra lại.');
            for(var k in item.before) if(item.before.hasOwnProperty(k) && !sameSnapshot(item.before[k],snapshot(obj.params[k]))) error('Crop đã đổi sau khi kiểm tra. Kiểm tra lại.');
            checked.push({clip:c,obj:obj,track:d.track});
        }
        for(var j=0;j<checked.length;j++) {
            try {
                var entry=checked[j],p=entry.obj.params;
                for(var name in p) if(p.hasOwnProperty(name)) {
                    var keys=p[name].getKeys();
                    if(keys&&keys.length)for(var a=keys.length-1;a>=0;a--)checkRC(p[name].removeKey(keys[a]),'Xóa keyframe Crop');
                    checkRC(p[name].setTimeVarying(false),'Tắt keyframe Crop');
                    checkRC(p[name].setValue(name==='Right'?100:0,true),'Làm sạch Crop');
                    var actual=snapshot(p[name]);
                    if(actual.varying || actual.keys.length || !number(actual.value) || Math.abs(actual.value-(name==='Right'?100:0))>0.0001)error('Crop đọc lại không khớp sau khi làm sạch.');
                }
                var key=recordKey(s,entry.clip);delete historyByKey['$'+key];
                for(var h=history.length-1;h>=0;h--)if(history[h].key===key)history.splice(h,1);
                plan.cursor++;done++;
            }catch(e){resetPlan=null;return {reset:done,remaining:plan.items.length-plan.cursor,error:'V'+(entry.track+1)+' clip '+entry.clip.nodeId+': '+e.message+'; clip này có thể đã xóa một phần keyframe. Khôi phục từ project đã lưu nếu cần.'};}
        }
        var remaining=plan.items.length-plan.cursor;if(!remaining)resetPlan=null;
        return {reset:done,remaining:remaining,error:''};
    }
    function diagnostic(opts) {
        var s=seq(), sel=s.getSelection(),out=[],fallback=false;
        if(!sel.length && number(opts.track) && opts.track>=0 && opts.track<s.videoTracks.numTracks) {
            fallback=true;var inspected=inspect({track:opts.track+1,selectedOnly:false}),ctx=newContext(s,inspected.fps),list=[];
            for(var f=0;f<inspected.clips.length && list.length<50;f++)if(inspected.clips[f].error)list.push(getClip(s,opts.track,inspected.clips[f].id,ctx,inspected.fps));
            if(!list.length && inspected.clips.length)list.push(getClip(s,opts.track,inspected.clips[0].id,ctx,inspected.fps));
            sel=list;
        }
        for(var i=0;i<sel.length;i++) {
            var c=sel[i],row={name:String(c.name),id:String(c.nodeId),start:c.start.seconds,inPoint:c.inPoint.seconds,components:[]};
            for(var j=0;j<c.components.numItems;j++) {
                var comp=c.components[j],co={name:String(comp.displayName),matchName:String(comp.matchName),params:[]};
                for(var k=0;k<count(comp.properties);k++) {
                    var p=comp.properties[k],pr={name:String(p.displayName)};
                    try{pr.keyframes=!!p.areKeyframesSupported();pr.varying=!!p.isTimeVarying();var v=p.getValue();if(typeof v==='number'||typeof v==='boolean')pr.value=v;if(typeof v==='string' && /text|font|source/i.test(pr.name)){pr.textValue=v.substring(0,32768);pr.textValueLength=v.length;pr.truncated=v.length>32768;}if(co.name==='Crop')pr.snapshot=snapshot(p);}catch(e){pr.error=e.message;}
                    co.params.push(pr);
                }
                row.components.push(co);
            }
            var rec=activeHistory(recordKey(s,c));if(rec)try{row.differences=differences(rec,crop(c));}catch(er){row.error=er.message;}
            out.push(row);
        }
        return {version:app.version,runtimeVersion:'1.2.10',build:app.build,sequence:String(s.name),fallback:fallback,clips:out,scan:lastInspect&&lastInspect.project===projectKey(s)?lastInspect:null};
    }
    // Plan payloads for beginRun are generated by this panel (numbers and ids only), so they
    // skip json2's four regex passes and go straight to eval. Every other method, and any
    // fast-path failure, keeps the original JSON.parse (json2) behavior.
    function evalTrustedJson(text) { return eval('('+text+')'); }
    function parsePayload(method,text) {
        if(!text) return {value:{},mode:'none'};
        if(method==='beginRun') {
            // Cheap native guards: no calls or assignments can be present. Anything else uses json2.
            if(text.charAt(0)==='{' && text.charAt(text.length-1)==='}' && text.indexOf('(')<0 && text.indexOf('=')<0) {
                try {
                    var fast=evalTrustedJson(text);
                    if(fast && typeof fast==='object') return {value:fast,mode:'eval'};
                } catch(e) {}
            }
            return {value:JSON.parse(text),mode:'json2-fallback'};
        }
        return {value:JSON.parse(text),mode:'json2'};
    }
    function saveLog(p) {
        var file=File.saveDialog('Lưu nhật ký Karaoke Graphic 23','JSON:*.json');
        if(!file)return {saved:false};
        file.encoding='UTF-8';
        if(!file.open('w'))error('Không mở được file log để ghi.');
        try{if(!file.write(String(p.text)))error('Không ghi được log.');}finally{file.close();}
        return {saved:true,path:file.fsName};
    }
    return {version:'1.2.10',parsePayload:parsePayload,call:function(method,payload) {
        var began=new Date().getTime();
        var sessionContext={hostCallSerial:++callSerial,hostAgeMs:began-loadedAt,sessionHistory:history.length,sessionKeyframesWritten:sessionKeyframes,sessionInspectCalls:inspectCalls,sessionForgetCalls:forgetCalls,sessionUndoCalls:undoCalls,sinceLastWriteMs:lastWriteAt?began-lastWriteAt:-1};
        if(method==='inspect')inspectCalls++;else if(method==='forgetSession')forgetCalls++;else if(method==='undo')undoCalls++;
        liveCall={tracks:{}};
        try {
            var decoded=payload?decodeURIComponent(payload):'',decodedAt=new Date().getTime();
            var parsedPayload=parsePayload(method,decoded),p=parsedPayload.value, value;
            var parsed=new Date().getTime();
            if(method==='inspect'||method==='undo'||method==='forgetSession'||method==='resetBatch')runCache=null;
            if(method==='inspect')value=inspect(p);
            else if(method==='partners')value=lookupPartners(p);
            else if(method==='prepare')value=prepare(p);
            else if(method==='prepareAll')value=prepareAll(p);
            else if(method==='apply')value=apply(p);
            else if(method==='applyBatch')value=applyBatch(p);
            else if(method==='beginRun')value=beginRun(p);
            else if(method==='continueRun')value=continueRun(p);
            else if(method==='undo')value=undo();
            else if(method==='forgetSession')value=forgetSession();
            else if(method==='resetPreview')value=resetPreview(p);
            else if(method==='resetBatch')value=resetBatch(p);
            else if(method==='diagnostic')value=diagnostic(p);
            else if(method==='saveLog')value=saveLog(p);
            else error('Lệnh không hợp lệ.');
            var executed=new Date().getTime(),encoded=JSON.stringify({ok:true,value:value}),finished=new Date().getTime();
            // Include decoding and serialization, which the per-cue timers exclude.
            return '{"profile":'+JSON.stringify({session:sessionContext,jsonMode:parsedPayload.mode,payloadChars:payload?String(payload).length:0,decodeMs:decodedAt-began,jsonMs:parsed-decodedAt,parseMs:parsed-began,methodMs:executed-parsed,serializeMs:finished-executed,hostMs:finished-began})+','+encoded.substring(1);
        }catch(e){return JSON.stringify({ok:false,error:String(e.message||e)});}
        finally{liveCall=null;}
    }};
}());
}
