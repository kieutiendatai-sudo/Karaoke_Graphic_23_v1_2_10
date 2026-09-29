#include "json2.jsx"
/* Premiere 23 CEP host. No QE API, no project save, no clip deletion. */
if (typeof KG23 === 'undefined') {
var KG23 = (function () {
    var history = [], historyByKey = {}, TPS = 254016000000, batchContext = null, lastInspect=null, resetPlan=null, resetSerial=0, liveCall=null, runCache=null, runSerial=0;
    function error(s) { throw new Error(s); }
    function time(seconds) { var t = new Time(); t.seconds = seconds; return t; }
    function number(n) { return typeof n === 'number' && isFinite(n); }
    function seq() {
        if(liveCall && liveCall.sequence) return liveCall.sequence;
        if (parseInt(app.version,10) !== 23) error('Bản này dành cho Premiere 23.x.');
        var s=app.project.activeSequence;
        if(!s) error('Mở một sequence trước.');
        if(liveCall)liveCall.sequence=s;
        return s;
    }
    function projectKey(s) {
        if(liveCall && liveCall.sequence===s && liveCall.project) return liveCall.project;
        var key=String(app.project.documentID || app.project.path || '')+'|'+String(s.sequenceID);
        if(liveCall && liveCall.sequence===s)liveCall.project=key;
        return key;
    }
    function sequenceFps(s) {
        if(liveCall.fps===undefined)liveCall.fps=TPS/Number(s.timebase);
        return liveCall.fps;
    }
    // Adobe wrappers are reused only inside one synchronous call and released
    // before returning to CEP. Slot IDs/timing are resolved live on every call.
    function trackData(s,track) {
        var tracks=liveCall.videoTracks||(liveCall.videoTracks=s.videoTracks);
        if(liveCall.trackCount===undefined)liveCall.trackCount=tracks.numTracks;
        if(track<0 || track>=liveCall.trackCount)error('Track không tồn tại.');
        var key=String(track),data=liveCall.tracks[key];
        if(!data) {
            var ref=tracks[track],clips=ref.clips;
            data={track:ref,clips:clips,count:clips.numItems,scanned:[],locked:typeof ref.isLocked==='function' && ref.isLocked()};
            liveCall.tracks[key]=data;
        }
        return data;
    }
    function recordKey(s,c) { return projectKey(s)+'|'+String(c.nodeId); }
    // Premiere 23 is inconsistent: Crop methods may report 0, true, undefined
    // or null after a successful write. Explicit error codes still stop the cue.
    function checkRC(r,what) { if(r!==0 && r!==undefined && r!==null && r!==true) error(what+' thất bại (mã '+r+').'); }
    function count(a) { return typeof a.numItems==='number'?a.numItems:a.length; }
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
            var hit=slot===undefined?null:data.clips[slot];
            // Resolve the current collection slot, never reuse a detached host clip.
            if(hit && String(hit.nodeId)===String(id)) return hit;
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
    function crop(c,quick) {
        var found=[],i,j,comp;
        var components=c.components,componentCount=components.numItems;
        for(i=0;i<componentCount;i++) {
            comp=components[i];
            if(/(^|[ .])Crop$/i.test(String(comp.matchName)) || String(comp.displayName)==='Crop') found.push({index:i,component:comp});
        }
        if(found.length!==1) error('“'+c.name+'”: cần đúng 1 hiệu ứng Crop. Thêm Crop vào bản sao chữ màu rồi quét lại.');
        var obj=found[0], props=obj.component.properties, names=['Left','Top','Right','Bottom'], mapped={},idx={};
        var propertyCount=count(props);
        for(i=0;i<propertyCount;i++) {
            var p=props[i], label=String(p.displayName);
            for(j=0;j<names.length;j++) if(label===names[j]) {mapped[label]=p;idx[label]=i;}
            if(!quick && label==='Zoom' && (p.isTimeVarying() || p.getValue())) error('Tắt Zoom trong Crop trước.');
            if(!quick && /Feather/i.test(label) && (p.isTimeVarying() || Math.abs(Number(p.getValue()))>0.00001)) error('Đặt Edge Feather của Crop về 0.');
        }
        for(i=0;i<names.length;i++) if(!mapped[names[i]]) error('Không nhận diện thuộc tính Crop. Bản 1.0 cần giao diện Premiere tiếng Anh; dùng Xuất log để kiểm tra.');
        obj.params=mapped; obj.indices=idx;
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
        var s=seq(), settings=s.getSettings(), fps=sequenceFps(s), track=opts.track-1;
        if(!number(fps)||fps<1) error('Không đọc được FPS.');
        if(track<0||track>=s.videoTracks.numTracks) error('Track chữ màu không tồn tại.');
        var clips=s.videoTracks[track].clips, total=clips.numItems, list=[],fast=opts.fast===true;
        var ctx=fast?newContext(s,fps):null,index={ids:{},starts:{},count:total,ordered:true},previous=-Infinity;
        for(var i=0;i<total;i++) {
            var c=clips[i];
            if(opts.selectedOnly && !c.isSelected()) continue;
            var d=fast?{id:String(c.nodeId),track:track,start:c.start.seconds,end:c.end.seconds,inPoint:c.inPoint.seconds,name:String(c.name)}:describe(c,track);
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
        lastInspect={project:projectKey(s),sequence:String(s.name),fps:fps,videoDisplayFormat:settings.videoDisplayFormat===undefined?s.videoDisplayFormat:settings.videoDisplayFormat,zeroSeconds:Number(s.zeroPoint||0)/TPS,width:settings.videoFrameWidth||s.frameSizeHorizontal,height:settings.videoFrameHeight||s.frameSizeVertical,clips:list,version:app.version,runtimeVersion:'1.2.10',undoCount:history.length};
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
        var start=prepared?prepared.start:c.start.seconds,end=prepared?prepared.end:c.end.seconds,inPoint=prepared?prepared.inPoint:c.inPoint.seconds;
        if(trackData(s,item.track).locked) error('Track đang khóa.');
        if(Math.abs(start-item.start)>1e-7||Math.abs(end-item.end)>1e-7||Math.abs(inPoint-item.inPoint)>1e-7) error('Clip đã đổi thời gian. Quét lại.');
        var id=String(item.id),key=projectKey(s)+'|'+id,obj=prepared?prepared.crop:crop(c,true),rec=activeHistory(key);
        if(rec) error('Clip đã chạy. Hoàn tác trước nếu muốn đổi thông số.');
        var names=['Left','Top','Right','Bottom'],before={};
        for(var n=0;n<names.length;n++) {
            var p=obj.params[names[n]];
            if(p.isTimeVarying()) error('Crop có keyframe sẵn; không ghi đè.');
            before[names[n]]={varying:false,keys:[],value:p.getValue()};
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
        var began=new Date().getTime(),list=preflight(plan), touched=[],refresh=null;
        var stats={preflightMs:new Date().getTime()-began,writeMs:0,verifyMs:0,keyframes:0,staticLayers:0,skippedWrites:0};
        try {
            for(var i=0;i<list.length;i++) {
                var entry=list[i], item=plan.items[i], p=entry.crop.params,rec=entry.record;
                touched.push(rec);
                var writeStart=new Date().getTime();
                var desired={Left:0,Top:item.top,Bottom:item.bottom};
                for(var field in desired)if(desired.hasOwnProperty(field)) {
                    if(rec.before[field].value===desired[field])stats.skippedWrites++;
                    else checkRC(p[field].setValue(desired[field],false),'Crop '+field);
                }
                // One value from frame zero describes a constant stream (e.g.
                // the unused lower layer). Avoid creating an animation for it.
                var constant=item.keys.length===1 && item.keys[0].frame===0;
                if(constant) {
                    if(rec.before.Right.value!==item.keys[0].value)checkRC(p.Right.setValue(item.keys[0].value,false),'Crop Right');
                    else stats.skippedWrites++;
                    refresh={param:p.Right,value:item.keys[0].value,constant:true};
                    stats.staticLayers++;
                    if(!deferRefresh && i===list.length-1)checkRC(p.Right.setValue(item.keys[0].value,true),'Làm mới giao diện');
                } else {
                checkRC(p.Right.setTimeVarying(true),'Bật keyframe');
                var autoKeys=p.Right.getKeys();
                if(autoKeys && autoKeys.length) for(var a=autoKeys.length-1;a>=0;a--) checkRC(p.Right.removeKey(autoKeys[a]),'Xóa keyframe tự sinh');
                for(var j=0;j<item.keys.length;j++) {
                    var k=item.keys[j], t=liveCall.keyTime||(liveCall.keyTime=time(0));
                    t.seconds=entry.inPoint+k.frame/plan.fps;
                    checkRC(p.Right.addKey(t),'Thêm keyframe');
                    checkRC(p.Right.setValueAtKey(t,k.value,false),'Ghi keyframe');
                    checkRC(p.Right.setInterpolationTypeAtKey(t,k.interp,!deferRefresh&&i===list.length-1&&j===item.keys.length-1),'Nội suy keyframe');
                }
                refresh={param:p.Right,seconds:t.seconds,interp:k.interp};
                stats.keyframes+=item.keys.length;
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
        var began=new Date().getTime(),stats={preflightMs:0,writeMs:0,verifyMs:0,keyframes:0,staticLayers:0,skippedWrites:0,refreshMs:0,setupMs:0,cueMs:0};
        // Keep slot indices across yields. getClip validates count and live ID;
        // Only color clip identity, timing, Crop and track lock are checked.
        var s=seq();batchContext=cachedContext(s,sequenceFps(s));
        stats.setupMs=new Date().getTime()-began;
        for(var i=0;i<plans.length;i++) {
            var cueStart=new Date().getTime();
            try {
                var result=apply(plans[i],true);refresh=result.refresh;out.push(String(plans[i].items[0].id));
                if(liveCall.prepared)delete liveCall.prepared['$'+plans[i].items[0].id];
                stats.preflightMs+=result.stats.preflightMs;stats.writeMs+=result.stats.writeMs;
                stats.verifyMs+=result.stats.verifyMs;stats.keyframes+=result.stats.keyframes;
                stats.staticLayers+=result.stats.staticLayers;stats.skippedWrites+=result.stats.skippedWrites;
            }catch(e) {failure=String(e.message||e);break;}
            stats.cueMs+=new Date().getTime()-cueStart;
            // Yield only between complete cues, never halfway through both layers.
            if(new Date().getTime()-began>=budget)break;
        }
        var refreshStart=new Date().getTime();
        if(refresh)try {
            if(refresh.constant)checkRC(refresh.param.setValue(refresh.value,true),'Làm mới giao diện');
            else checkRC(refresh.param.setInterpolationTypeAtKey(time(refresh.seconds),refresh.interp,true),'Làm mới giao diện');
        }catch(er){warning='Đã gửi keyframe, nhưng làm mới giao diện thất bại: '+String(er.message||er);}
        stats.refreshMs=new Date().getTime()-refreshStart;
        return {applied:out.length,ids:out,error:failure,warning:warning,stats:stats,elapsedMs:new Date().getTime()-began};
    }
    function beginRun(req) {
        runCache=null;
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
        history=[];historyByKey={};batchContext=null;lastInspect=null;resetPlan=null;
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
    function saveLog(p) {
        var file=File.saveDialog('Lưu nhật ký Karaoke Graphic 23','JSON:*.json');
        if(!file)return {saved:false};
        file.encoding='UTF-8';
        if(!file.open('w'))error('Không mở được file log để ghi.');
        try{if(!file.write(String(p.text)))error('Không ghi được log.');}finally{file.close();}
        return {saved:true,path:file.fsName};
    }
    return {version:'1.2.10',call:function(method,payload) {
        var began=new Date().getTime();
        liveCall={tracks:{}};
        try {
            var p=payload?JSON.parse(decodeURIComponent(payload)):{}, value;
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
            return '{"profile":'+JSON.stringify({parseMs:parsed-began,methodMs:executed-parsed,serializeMs:finished-executed,hostMs:finished-began})+','+encoded.substring(1);
        }catch(e){return JSON.stringify({ok:false,error:String(e.message||e)});}
        finally{liveCall=null;}
    }};
}());
}
