/* FFmpeg argument lists (no shell). Paths are relative to the job folder (run with cwd = folder). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KGFfmpegArgs = api; else if (!(typeof module === 'object' && module.exports)) root.KGFfmpegArgs = api;
}(this, function () {
  'use strict';
  var BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
  var ASS = "ass=filename='{f}':fontsdir='fonts':shaping=simple";

  /* The `ass` filter writes RGB but never alpha, so the overlay is rendered twice: the colours on
     black (premultiplied) and a white matte (brightness = coverage). alphamerge + unpremultiply
     give straight alpha without dark fringes. */
  function overlayArgs(o) {
    var rate = o.fps.num + '/' + o.fps.den;
    var source = 'color=c=black:s=' + o.width + 'x' + o.height + ':r=' + rate + ':d=' + o.durationSeconds.toFixed(6);
    var tail, encode;
    if (o.codec === 'qtrle') {
      tail = 'format=argb';
      encode = ['-c:v', 'qtrle', '-pix_fmt', 'argb'];
    } else if (!o.codec || o.codec === 'prores4444') {
      tail = 'scale=out_color_matrix=bt709:out_range=limited,format=yuva444p10le';
      encode = ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', String(o.alphaBits || 16), '-vendor', 'apl0'].concat(BT709);
    } else throw new Error('Codec overlay phải là prores4444 hoặc qtrle.');
    var graph = '[0:v]' + ASS.replace('{f}', 'karaoke.ass') + ',format=gbrp[c];[1:v]' + ASS.replace('{f}', 'matte.ass') + ',format=gray[a];' +
      '[c][a]alphamerge,format=gbrap,unpremultiply=inplace=1,' + tail + '[v]';
    return ['-hide_banner', '-nostdin', '-nostats', '-y', '-loglevel', 'warning', '-f', 'lavfi', '-i', source, '-f', 'lavfi', '-i', source,
      '-filter_complex', graph, '-map', '[v]'].concat(encode, ['-progress', 'pipe:1', o.output]);
  }

  var REQUIRED_FILTERS = ['ass', 'alphamerge', 'unpremultiply'];
  var REQUIRED_ENCODERS = ['prores_ks'];
  return { overlayArgs: overlayArgs, REQUIRED_FILTERS: REQUIRED_FILTERS, REQUIRED_ENCODERS: REQUIRED_ENCODERS };
}));
