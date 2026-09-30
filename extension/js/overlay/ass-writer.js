/* Overlay ASS: ONE Dialogue per word; the whole line is drawn and only the active word has the
   highlight colour (whole-word instant change, no wipe, previous/next words stay normal).
   The events of a cue tile its frames, so no second "base" layer exists. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KGAss = api; else if (!(typeof module === 'object' && module.exports)) root.KGAss = api;
}(this, function () {
  'use strict';

  /* frame -> ASS time (centiseconds), floored. libass renders frame k at trunc(k/fps*1000) ms, so a
     floored boundary is never later than its frame and the previous event ends after the previous
     frame for every rate up to 100 fps: each frame lands in exactly the intended event. */
  function frameToCs(frame, fps) {
    var n = frame * fps.den * 100;
    return (n - (n % fps.num)) / fps.num;
  }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function csToTime(cs) {
    return Math.floor(cs / 360000) + ':' + pad(Math.floor(cs / 6000) % 60, 2) + ':' + pad(Math.floor(cs / 100) % 60, 2) + '.' + pad(cs % 100, 2);
  }

  /* '#RRGGBB' -> ASS '&H00BBGGRR&' (alpha 00 = opaque) */
  function color(hex, opacity) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error('Màu không hợp lệ: ' + hex);
    var a = opacity == null ? 0 : Math.round(255 * (1 - Math.max(0, Math.min(100, opacity)) / 100));
    return '&H' + (a < 16 ? '0' : '') + a.toString(16).toUpperCase() + (hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3)).toUpperCase() + '&';
  }

  /* Cue text is one line (KGCore.oneLine). Braces would start override tags and a backslash a
     line break; escape braces, replace a stray backslash so the file can never be broken. */
  function escapeText(text) {
    return text.replace(/\\/g, '/').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
  }

  function alignCode(align) { return align === 'left' ? 4 : align === 'right' ? 6 : 5; }

  /* Rounded rectangle as an ASS drawing (cubic Bezier corners), origin at the top-left. */
  function roundedRect(w, h, radius) {
    function n(v) { return Math.round(v * 100) / 100; }
    var r = Math.max(0, Math.min(radius || 0, w / 2, h / 2)), k = r * 0.55228475;
    if (r < 0.5) return 'm 0 0 l ' + n(w) + ' 0 l ' + n(w) + ' ' + n(h) + ' l 0 ' + n(h);
    return 'm ' + n(r) + ' 0 l ' + n(w - r) + ' 0 b ' + n(w - r + k) + ' 0 ' + n(w) + ' ' + n(r - k) + ' ' + n(w) + ' ' + n(r) +
      ' l ' + n(w) + ' ' + n(h - r) + ' b ' + n(w) + ' ' + n(h - r + k) + ' ' + n(w - r + k) + ' ' + n(h) + ' ' + n(w - r) + ' ' + n(h) +
      ' l ' + n(r) + ' ' + n(h) + ' b ' + n(r - k) + ' ' + n(h) + ' 0 ' + n(h - r + k) + ' 0 ' + n(h - r) +
      ' l 0 ' + n(r) + ' b 0 ' + n(r - k) + ' ' + n(r - k) + ' 0 ' + n(r) + ' 0';
  }

  /* style: {fontFamily, fontSize, bold, textColor, highlightColor, outlineColor, outline, shadow,
             align, anchorX (% of width), width, height, lineSpacing (% of font size between two rows),
             bgEnabled, bgColor, bgOpacity (%), bgPadX, bgPadY, bgRadius (px)}
     options.matte: every colour becomes white so the rendered brightness equals the alpha coverage.
     options.boxes: {rel: {rowText: {l, r, t, b}}, ref: {t, b}} ink extents measured by libass relative to the row anchor
                    (see overlay-measure.js); required when style.bgEnabled. options.stats.clippedBoxes counts boxes leaving the canvas. */
  function buildAss(plan, style, options) {
    options = options || {};
    var white = '#FFFFFF', matte = !!options.matte;
    var text = color(matte ? white : style.textColor), high = color(matte ? white : style.highlightColor);
    var outline = color(matte ? white : style.outlineColor), back = color(matte ? white : '#000000');
    var box = !!style.bgEnabled;
    if (box && !options.boxes) throw new Error('Thiếu số đo chữ để vẽ nền.');
    var fill = box ? color(matte ? white : style.bgColor || '#000000', style.bgOpacity == null ? 100 : style.bgOpacity) : null;
    var W = style.width, H = style.height;
    var x = Math.round(W * (style.anchorX == null ? 50 : style.anchorX) / 100 * 100) / 100, y = H / 2;
    var an = alignCode(style.align), dist = style.fontSize * (style.lineSpacing == null ? 85 : style.lineSpacing) / 100;
    function styleLine(name, primary, secondary, outlineCol, outlineW, shadowW) {
      return 'Style: ' + name + ',' + style.fontFamily.replace(/,/g, ' ') + ',' + style.fontSize + ',' + primary + ',' + secondary + ',' + outlineCol + ',' + back + ',' +
        (style.bold ? -1 : 0) + ',0,0,0,100,100,' + (style.spacing || 0) + ',0,1,' + outlineW + ',' + shadowW + ',' + an + ',0,0,0,1';
    }
    var lines = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: ' + W, 'PlayResY: ' + H, 'WrapStyle: 2',
      'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      styleLine('Karaoke', text, high, outline, style.outline || 0, style.shadow || 0)].concat(
      box ? [styleLine('KaraokeBox', fill, fill, fill, 0, 0)] : [],
      ['', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']);
    var first = plan.firstFrame, fps = plan.fps;
    function time(frame) { return csToTime(frameToCs(frame - first, fps)); }
    function rowY(count, r) { return y + (r - (count - 1) / 2) * dist; }

    var cueSpan = {};
    plan.events.forEach(function (e) {
      var c = cueSpan[e.cue] || (cueSpan[e.cue] = { start: e.startFrame, end: e.endFrame, rows: e.rows || [e.line] });
      if (e.startFrame < c.start) c.start = e.startFrame;
      if (e.endFrame > c.end) c.end = e.endFrame;
    });
    var boxDone = {};
    function boxLine(cue, span) {
      var b = options.boxes, n = span.rows.length, l = Infinity, r = -Infinity, t = Infinity, bt = -Infinity;
      span.rows.forEach(function (row, i) {
        var m = b.rel[row];
        if (!m) throw new Error('Thiếu số đo cho dòng: ' + row);
        var cy = rowY(n, i);
        l = Math.min(l, x + m.l); r = Math.max(r, x + m.r);
        t = Math.min(t, cy + Math.min(m.t, b.ref.t)); bt = Math.max(bt, cy + Math.max(m.b, b.ref.b));
      });
      l -= style.bgPadX == null ? 24 : style.bgPadX; r += style.bgPadX == null ? 24 : style.bgPadX;
      t -= style.bgPadY == null ? 12 : style.bgPadY; bt += style.bgPadY == null ? 12 : style.bgPadY;
      if (options.stats && (l < 0 || t < 0 || r > W || bt > H)) options.stats.clippedBoxes = (options.stats.clippedBoxes || 0) + 1;
      return 'Dialogue: 0,' + time(span.start) + ',' + time(span.end) + ',KaraokeBox,,0,0,0,,{\\an7\\pos(' + Math.round(l * 100) / 100 + ',' + Math.round(t * 100) / 100 +
        ')\\bord0\\shad0\\p1}' + roundedRect(r - l, bt - t, style.bgRadius) + '{\\p0}';
    }
    plan.events.forEach(function (e) {
      var rows = e.rows || [e.line], t0 = time(e.startFrame), t1 = time(e.endFrame);
      if (box && !boxDone[e.cue]) { boxDone[e.cue] = 1; lines.push(boxLine(e.cue, cueSpan[e.cue])); }
      rows.forEach(function (row, i) {
        var body = i === (e.row || 0)
          ? escapeText(row.slice(0, e.startChar)) + '{\\1c' + high + '}' + escapeText(row.slice(e.startChar, e.endChar)) + '{\\1c' + text + '}' + escapeText(row.slice(e.endChar))
          : escapeText(row);
        lines.push('Dialogue: 1,' + t0 + ',' + t1 + ',Karaoke,,0,0,0,,{\\an' + an + '\\pos(' + x + ',' + Math.round(rowY(rows.length, i) * 100) / 100 + ')}' + body);
      });
    });
    return lines.join('\n') + '\n';
  }

  return { buildAss: buildAss, frameToCs: frameToCs, csToTime: csToTime, color: color, escapeText: escapeText, roundedRect: roundedRect };
}));
