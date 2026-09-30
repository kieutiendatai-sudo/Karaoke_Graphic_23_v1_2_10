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
  function color(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error('Màu không hợp lệ: ' + hex);
    return '&H00' + (hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3)).toUpperCase() + '&';
  }

  /* Cue text is one line (KGCore.oneLine). Braces would start override tags and a backslash a
     line break; escape braces, replace a stray backslash so the file can never be broken. */
  function escapeText(text) {
    return text.replace(/\\/g, '/').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
  }

  function alignCode(align) { return align === 'left' ? 4 : align === 'right' ? 6 : 5; }

  /* style: {fontFamily, fontSize, bold, textColor, highlightColor, outlineColor, outline, shadow,
             align, anchorX (% of width), width, height}
     options.matte: every colour becomes white so the rendered brightness equals the alpha coverage. */
  function buildAss(plan, style, options) {
    options = options || {};
    var white = '#FFFFFF', matte = !!options.matte;
    var text = color(matte ? white : style.textColor), high = color(matte ? white : style.highlightColor);
    var outline = color(matte ? white : style.outlineColor);
    var W = style.width, H = style.height;
    var x = Math.round(W * (style.anchorX == null ? 50 : style.anchorX) / 100 * 100) / 100, y = H / 2;
    var an = alignCode(style.align);
    var lines = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: ' + W, 'PlayResY: ' + H, 'WrapStyle: 2',
      'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Karaoke,' + style.fontFamily.replace(/,/g, ' ') + ',' + style.fontSize + ',' + text + ',' + high + ',' + outline + ',' + color('#000000') + ',' +
        (style.bold ? -1 : 0) + ',0,0,0,100,100,' + (style.spacing || 0) + ',0,1,' + (style.outline || 0) + ',' + (style.shadow || 0) + ',' + an + ',0,0,0,1',
      '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'];
    var first = plan.firstFrame, fps = plan.fps;
    plan.events.forEach(function (e) {
      var line = e.line;
      var body = escapeText(line.slice(0, e.startChar)) + '{\\1c' + high + '}' + escapeText(line.slice(e.startChar, e.endChar)) +
        '{\\1c' + text + '}' + escapeText(line.slice(e.endChar));
      lines.push('Dialogue: 0,' + csToTime(frameToCs(e.startFrame - first, fps)) + ',' + csToTime(frameToCs(e.endFrame - first, fps)) +
        ',Karaoke,,0,0,0,,{\\an' + an + '\\pos(' + x + ',' + y + ')}' + body);
    });
    return lines.join('\n') + '\n';
  }

  return { buildAss: buildAss, frameToCs: frameToCs, csToTime: csToTime, color: color, escapeText: escapeText };
}));
