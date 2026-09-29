/* Shared, dependency-free timing and geometry. Single-line karaoke only. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KGCore = factory();
}(this, function() {
  'use strict';
  function fail(s) { throw new Error(s); }
  function finite(n) { return typeof n === 'number' && isFinite(n); }
  function pad(n,size) { var s=String(n);while(s.length<(size||2))s='0'+s;return s; }
  function duration(seconds) {
    if(!finite(seconds)) return '?';
    var ms=Math.round(Math.abs(seconds)*1000);
    return (seconds<0?'-':'')+pad(Math.floor(ms/60000))+':'+pad(Math.floor(ms/1000)%60)+'.'+pad(ms%1000,3);
  }
  function timecode(seconds,fps,displayFormat,zeroSeconds) {
    if(!finite(seconds)||!finite(fps)||fps<=0) return '?';
    var frame=Math.round((seconds+(zeroSeconds||0))*fps),negative=frame<0;
    frame=Math.abs(frame);
    var rate=Math.round(fps),drop=displayFormat===102?2:displayFormat===106?4:0;
    if(drop) {
      var tenMinutes=rate*600-drop*9,oneMinute=rate*60-drop;
      frame+=drop*9*Math.floor(frame/tenMinutes)+drop*Math.max(0,Math.floor((frame%tenMinutes-drop)/oneMinute));
    }
    return (negative?'-':'')+pad(Math.floor(frame/(rate*3600)))+':'+pad(Math.floor(frame/(rate*60))%60)+':'+pad(Math.floor(frame/rate)%60)+(drop?';':':')+pad(frame%rate);
  }
  function stamp(s) {
    var m = s.match(/^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/);
    if (!m || +m[2] > 59 || +m[3] > 59) fail('Timecode SRT không hợp lệ: ' + s);
    return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
  }
  function oneLine(s) {
    return s.replace(/\r\n?/g,'\n').replace(/\s*\n\s*/g,' ').replace(/[ \t]+/g,' ').trim();
  }
  function parseSRT(s) {
    var blocks = s.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n+/);
    var cues = [];
    blocks.forEach(function(block, index) {
      var lines = block.split('\n');
      if (/^\d+\s*$/.test(lines[0])) lines.shift();
      var m = (lines.shift() || '').match(/^(\d+:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d+:\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$/);
      if (!m) fail('Không đọc được cue SRT thứ ' + (index + 1));
      var text = lines.join('\n').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
      text=oneLine(text);
      var start = stamp(m[1]), end = stamp(m[2]);
      if (end <= start || !text) fail('Cue rỗng hoặc thời lượng <= 0: ' + (index + 1));
      cues.push({id:index + 1, start:start, end:end, text:text});
    });
    return cues;
  }
  var letterNumber = new RegExp('[\\p{L}\\p{N}]', 'u');
  function weight(s) {
    var n = 0;
    Array.from(s.normalize('NFC')).forEach(function(c) { if (letterNumber.test(c)) n++; });
    // Spoken duration does not grow linearly with character count. Using sqrt keeps
    // short words from becoming unrealistically brief while still giving longer
    // words more time. A small punctuation bonus preserves natural pauses.
    var w = Math.sqrt(Math.max(1,n));
    if (/[.!?…][\"'”’)]*$/.test(s)) w += 0.55;
    else if (/[,;:][\"'”’)]*$/.test(s)) w += 0.30;
    return w;
  }
  function allocate(weights, total) {
    if (!Number.isInteger(total) || total < 0 || !weights.length || weights.some(function(w) { return !finite(w) || w <= 0; })) fail('Phân bổ thời gian không hợp lệ.');
    var sum = weights.reduce(function(a,b) { return a+b; },0), used = 0;
    var rows = weights.map(function(w,i) { var x = total*w/sum, floor = Math.floor(x); used += floor; return {i:i,n:floor,r:x-floor}; });
    rows.slice().sort(function(a,b) { return b.r-a.r || a.i-b.i; }).slice(0,total-used).forEach(function(r) { r.n++; });
    return rows.map(function(r) { return r.n; });
  }
  function tokens(text) {
    var line=oneLine(text),out=[];
    if(!line) fail('Cue không có nội dung.');
    var re=/\S+/g,m;
    while ((m=re.exec(line))) out.push({word:m[0],row:0,startChar:m.index,endChar:m.index+m[0].length,weight:weight(m[0])});
    return {lines:[line],words:out};
  }
  function timing(text,duration,fps) {
    var data=tokens(text), frameCount=Math.round(duration*fps);
    if (!finite(fps) || fps<=0 || frameCount<1) fail('FPS hoặc thời lượng không hợp lệ.');
    var weights=data.words.map(function(w){return w.weight;}), counts, i;
    // Allocate on the actual Premiere frame grid instead of centiseconds. When
    // possible reserve at least one frame per word, then distribute the rest.
    // This avoids tiny words collapsing or pushing the highlight into the next word.
    if(frameCount>=data.words.length){
      var remaining=frameCount-data.words.length;
      var extra=remaining?allocate(weights,remaining):weights.map(function(){return 0;});
      counts=extra.map(function(n){return n+1;});
    } else counts=allocate(weights,frameCount);
    var previous=0;
    data.words.forEach(function(w,index) {
      w.startFrame=previous;
      w.endFrame=previous+counts[index];
      w.durationFrames=counts[index];
      w.centiseconds=Math.round(counts[index]/fps*100);
      previous=w.endFrame;
    });
    // Absorb any floating/rounding discrepancy into the last word only.
    data.words[data.words.length-1].endFrame=frameCount;
    data.words[data.words.length-1].durationFrames=frameCount-data.words[data.words.length-1].startFrame;
    data.frames=frameCount;
    data.collapsed=data.words.filter(function(w){return w.endFrame===w.startFrame;}).length;
    return data;
  }
  function geometry(data,cfg,measure) {
    var width=cfg.width, fontScale=cfg.widthFactor/100, pad=cfg.padding;
    if (!finite(width) || width<=0 || !finite(fontScale) || fontScale<=0) fail('Kích thước không hợp lệ.');
    function m(s) {return (measure(s)+Math.max(0,Array.from(s).length-1)*cfg.tracking)*fontScale;}
    var line=data.lines[0],w=m(line),anchor=width*cfg.anchor/100;
    var left=cfg.align==='left'?anchor:cfg.align==='right'?anchor-w:anchor-w/2;
    if (left-pad<0 || left+w+pad>width) data.outOfBounds=true;
    data.rows=[{left:left,right:left+w,width:w}];
    data.words.forEach(function(word,i) {
      word.xStart=left+m(line.slice(0,word.startChar));
      var next=data.words[i+1];
      word.xEnd=next?(left+(m(line.slice(0,word.endChar))+m(line.slice(0,next.startChar)))/2):left+w+pad;
    });
    return data;
  }
  function makeKeys(data,mode,width,padding) {
    var words=data.words, keys=[];
    function push(frame,x,interp) {
      var value=Math.max(0,Math.min(100,100-x/width*100));
      var point={frame:Math.max(0,Math.min(data.frames-1,frame)),value:value,interp:interp};
      if(keys.length && keys[keys.length-1].frame===point.frame) keys[keys.length-1]=point;
      else keys.push(point);
    }
    var left=data.rows[0].left-padding;
    push(0,left,4);
    if(mode==='hold') words.forEach(function(w){push(w.startFrame,w.xEnd,4);});
    else {
      push(words[0].startFrame,left,0);
      words.forEach(function(w){push(w.endFrame,w.xEnd,0);});
    }
    return keys;
  }
  function makeItem(clip,data,cfg) {
    return {id:clip.id,track:clip.track,start:clip.start,end:clip.end,inPoint:clip.inPoint,
      top:0,bottom:0,keys:makeKeys(data,cfg.mode,cfg.width,cfg.padding)};
  }
  function cueIndex(cues,offset,fps) {
    var out={},i,key;
    for(i=0;i<cues.length;i++) {
      key=Math.round((cues[i].start+offset)*fps);
      (out[key]||(out[key]=[])).push(cues[i]);
    }
    return out;
  }
  function matchCue(clip,cues,offset,fps,index) {
    var tol=1.1/fps,pool=cues;
    if(index) {
      pool=[];var seen={},base=Math.round(clip.start*fps);
      for(var f=base-2;f<=base+2;f++) {
        var bucket=index[f]||[];
        for(var b=0;b<bucket.length;b++) if(!seen[bucket[b].id]) {seen[bucket[b].id]=true;pool.push(bucket[b]);}
      }
    }
    var hits=pool.filter(function(c){return Math.abs(c.start+offset-clip.start)<=tol && Math.abs(c.end+offset-clip.end)<=tol;});
    if(hits.length!==1) fail('Clip “'+clip.name+'”: tìm thấy '+hits.length+' cue khớp cả đầu/cuối (sai số 1 frame). Kiểm tra offset và SRT.');
    return hits[0];
  }
  return {duration:duration,timecode:timecode,parseSRT:parseSRT,oneLine:oneLine,weight:weight,allocate:allocate,tokens:tokens,timing:timing,geometry:geometry,makeKeys:makeKeys,makeItem:makeItem,cueIndex:cueIndex,matchCue:matchCue};
}));
