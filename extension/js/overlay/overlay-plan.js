/* SRT cues -> frame-accurate word events for the karaoke overlay.
   Word timing is KGCore.timing (frame based, already verified): the overlay must not change it. */
(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports ? require('../core.js') : (typeof window !== 'undefined' ? window.KGCore : root.KGCore));
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KGOverlayPlan = api; else if (!(typeof module === 'object' && module.exports)) root.KGOverlayPlan = api;
}(this, function (Core) {
  'use strict';
  var TPS = 254016000000;

  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }

  /* Exact frame rate from Premiere's sequence.timebase (ticks per frame). 29.97 -> 30000/1001. */
  function fpsFromTicks(ticks) {
    ticks = Number(ticks);
    if (!(ticks > 0) || Math.floor(ticks) !== ticks) throw new Error('timebase không hợp lệ.');
    var g = gcd(TPS, ticks);
    return { num: TPS / g, den: ticks / g };
  }

  var PRESETS = { '23.976': [24000, 1001], '24': [24, 1], '25': [25, 1], '29.97': [30000, 1001], '30': [30, 1],
    '50': [50, 1], '59.94': [60000, 1001], '60': [60, 1] };
  function fpsFromPreset(name) {
    var p = PRESETS[String(name)];
    if (!p) throw new Error('FPS không hợp lệ: ' + name);
    return { num: p[0], den: p[1] };
  }

  /* opts: {fps:{num,den}, offset (s), minFrames}. cues: KGCore.parseSRT() output. */
  function buildPlan(cues, opts) {
    var fps = opts.fps, rate = fps.num / fps.den, offset = Number(opts.offset || 0), warnings = [];
    if (!cues.length) throw new Error('SRT không có cue.');
    var items = cues.map(function (cue) {
      var timing = Core.timing(cue.text, cue.end - cue.start, rate);
      var start = Math.round((cue.start + offset) * rate);
      if (start < 0) throw new Error('Cue ' + cue.id + ': thời gian âm sau khi cộng offset.');
      return { cue: cue, timing: timing, startFrame: start, endFrame: start + timing.frames };
    }).sort(function (a, b) { return a.startFrame - b.startFrame || a.cue.id - b.cue.id; });

    var events = [], collapsed = 0, i;
    for (i = 0; i < items.length; i++) {
      var item = items[i], next = items[i + 1], end = item.endFrame;
      if (next && next.startFrame < end) {
        warnings.push('Cue ' + item.cue.id + ' chồng cue ' + next.cue.id + ' ' + (end - next.startFrame) + ' frame; đã cắt cue trước.');
        end = next.startFrame;
      }
      if (end <= item.startFrame) { warnings.push('Cue ' + item.cue.id + ' bị bỏ (không còn frame).'); continue; }
      var line = item.timing.lines[0];
      item.timing.words.forEach(function (w) {
        var a = item.startFrame + w.startFrame, b = Math.min(end, item.startFrame + w.endFrame);
        if (b <= a) { collapsed++; return; }
        events.push({ cue: item.cue.id, startFrame: a, endFrame: b, line: line, startChar: w.startChar, endChar: w.endChar, word: w.word });
      });
    }
    if (collapsed) warnings.push(collapsed + ' từ quá ngắn (0 frame) không được tô riêng.');
    if (!events.length) throw new Error('Không có từ nào để render.');
    var first = events[0].startFrame, last = events[events.length - 1].endFrame;
    events.forEach(function (e) { if (e.startFrame < first) first = e.startFrame; if (e.endFrame > last) last = e.endFrame; });
    return { fps: fps, firstFrame: first, lastFrame: last, frames: last - first, events: events, cues: items.length,
             words: events.length, warnings: warnings,
             startSeconds: first * fps.den / fps.num, durationSeconds: (last - first) * fps.den / fps.num };
  }

  /* Keep only [startFrame, startFrame+frames) (preview); events are cut, first frame stays absolute. */
  function clipPlan(plan, startFrame, frames) {
    var lo = Math.max(startFrame, plan.firstFrame), hi = Math.min(startFrame + frames, plan.lastFrame);
    if (hi <= lo) throw new Error('Đoạn xem thử nằm ngoài thời lượng phụ đề.');
    var events = plan.events.filter(function (e) { return e.endFrame > lo && e.startFrame < hi; })
      .map(function (e) { return Object.assign({}, e, { startFrame: Math.max(e.startFrame, lo), endFrame: Math.min(e.endFrame, hi) }); });
    var fps = plan.fps;
    return Object.assign({}, plan, { firstFrame: lo, lastFrame: hi, frames: hi - lo, events: events, words: events.length,
      startSeconds: lo * fps.den / fps.num, durationSeconds: (hi - lo) * fps.den / fps.num });
  }

  return { fpsFromTicks: fpsFromTicks, fpsFromPreset: fpsFromPreset, PRESETS: PRESETS, buildPlan: buildPlan, clipPlan: clipPlan, TPS: TPS };
}));
