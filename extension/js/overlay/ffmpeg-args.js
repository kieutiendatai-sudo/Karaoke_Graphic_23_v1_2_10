/* FFmpeg argument lists (no shell). Paths are relative to the job folder (run with cwd = folder). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KGFfmpegArgs = api; else if (!(typeof module === 'object' && module.exports)) root.KGFfmpegArgs = api;
}(this, function () {
  'use strict';
  /* prores_ks with its default rate control is ~5x slower than with a fixed quantiser; -qscale 2 stays within ~65 dB PSNR of the default output. */
  var BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
  var ASS = "ass=filename='{f}':fontsdir='fonts':shaping=simple";

  /* The `ass` filter writes RGB but never alpha, so the overlay is rendered twice: the colours on
     black (premultiplied) and a white matte (brightness = coverage). alphamerge + unpremultiply
     give straight alpha without dark fringes. */
  /* Frames only change at word/cue boundaries, so the ass filters only need one frame per segment. The segment list feeds a
     one-frame clip (NUT, 1 us time base) for each segment (concat demuxer, timestamps in microseconds nudged 2 us LATE so libass never sees a time before the
     intended frame time) and `fps` at the end of the chain repeats those frames back to constant frame rate. */
  function segmentBoundaries(plan) {
    var set = { 0: 1 }, total = plan.lastFrame - plan.firstFrame;
    set[total] = 1;
    plan.events.forEach(function (e) { set[e.startFrame - plan.firstFrame] = 1; set[e.endFrame - plan.firstFrame] = 1; });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }
  function segmentList(plan, image) {
    var b = segmentBoundaries(plan), fps = plan.fps, prev = 0, out = ['ffconcat version 1.0'], i;
    function micro(frame) { var n = frame * fps.den * 1000000; return Math.ceil(n / fps.num) + 2; }   // +2 us: the ass filter multiplies pts by a float time base and truncates to ms, so an exact boundary can land 1 ms early
    for (i = 1; i < b.length; i++) {
      var t = micro(b[i]);
      out.push("file '" + image + "'", 'duration ' + ((t - prev) / 1000000).toFixed(6));
      prev = t;
    }
    out.push("file '" + image + "'");           // the concat demuxer ignores the duration of the last entry unless the file repeats
    return out.join('\n') + '\n';
  }

  function overlayArgs(o) {
    var rate = o.fps.num + '/' + o.fps.den;
    var source = 'color=c=black:s=' + o.width + 'x' + o.height + ':r=' + rate + ':d=' + o.durationSeconds.toFixed(6);
    var tail, encode;
    if (o.codec === 'qtrle') {
      tail = 'format=argb';
      encode = ['-c:v', 'qtrle', '-pix_fmt', 'argb'];
    } else if (o.codec === 'png') {
      tail = 'format=rgba';
      encode = ['-c:v', 'png', '-pix_fmt', 'rgba'];
    } else if (!o.codec || o.codec === 'prores4444') {
      tail = 'scale=out_color_matrix=bt709:out_range=limited,format=yuva444p10le';
      encode = ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', String(o.alphaBits || 16), '-qscale:v', String(o.qscale || 2), '-vendor', 'apl0'].concat(BT709);
    } else throw new Error('Codec overlay phải là prores4444, png hoặc qtrle.');
    var head = '[0:v]format=yuv420p,split[k][m];[k]', matteIn = '[m]', fpsTail = ',fps=' + rate + ':round=near', input;
    if (o.segments) input = ['-f', 'concat', '-safe', '0', '-i', 'segments.txt'];
    else {
      input = ['-f', 'lavfi', '-i', source];
      head = '[0:v]split[k][m];[k]'; fpsTail = '';            // one frame per output frame: no repeat step
    }
    var graph = head + ASS.replace('{f}', 'karaoke.ass') + ',format=gbrp[c];' + matteIn + ASS.replace('{f}', 'matte.ass') + ',format=gray[a];' +
      '[c][a]alphamerge,format=gbrap,unpremultiply=inplace=1,' + tail + fpsTail + '[v]';
    return ['-hide_banner', '-nostdin', '-nostats', '-y', '-loglevel', 'warning'].concat(input,
      ['-filter_complex', graph, '-map', '[v]'], o.segments ? ['-frames:v', String(o.segments)] : [], encode, ['-progress', 'pipe:1', o.output]);
  }

  var REQUIRED_FILTERS = ['ass', 'alphamerge', 'unpremultiply'];
  var REQUIRED_ENCODERS = ['prores_ks'];
  return { overlayArgs: overlayArgs, segmentList: segmentList, segmentBoundaries: segmentBoundaries, REQUIRED_FILTERS: REQUIRED_FILTERS, REQUIRED_ENCODERS: REQUIRED_ENCODERS };
}));
