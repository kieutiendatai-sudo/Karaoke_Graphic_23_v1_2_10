/* Measures the ink extents of subtitle rows with the same libass the render uses, so the background box hugs the real glyphs
   (kerning, outline, shadow included) instead of a Pillow/sfnt estimate. One frame per unique row, read back as gray pixels. */
'use strict';
const Ass = require('./ass-writer.js');

const REF_TEXT = 'Hgpqy|';           // ascender + descender extents, so the box height does not jitter with the letters of a cue
const THRESHOLD = 16;               // gray level counted as ink (antialiased edges included)

/* style: the render style (fontFamily, fontSize, bold, outline, shadow, align, anchorX, width, height). rows: unique row strings. */
function buildMeasureAss(rows, style) {
  const W = style.width, H = style.height, x = Math.round(W * (style.anchorX == null ? 50 : style.anchorX) / 100 * 100) / 100, y = H / 2;
  const an = style.align === 'left' ? 4 : style.align === 'right' ? 6 : 5, white = Ass.color('#FFFFFF');
  const out = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: ' + W, 'PlayResY: ' + H, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: M,' + style.fontFamily.replace(/,/g, ' ') + ',' + style.fontSize + ',' + white + ',' + white + ',' + white + ',' + white + ',' + (style.bold ? -1 : 0) +
      ',0,0,0,100,100,' + (style.spacing || 0) + ',0,1,' + (style.outline || 0) + ',' + (style.shadow || 0) + ',' + an + ',0,0,0,1',
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'];
  const all = [REF_TEXT].concat(rows);
  all.forEach((row, k) => out.push('Dialogue: 0,' + Ass.csToTime(k * 100) + ',' + Ass.csToTime(k * 100 + 100) + ',M,,0,0,0,,{\\an' + an + '\\pos(' + x + ',' + y + ')}' + Ass.escapeText(row)));
  return { text: out.join('\n') + '\n', frames: all.length, x, y };
}

/* Streams gray frames (W*H bytes each) and keeps the ink bbox of each. */
function frameBoxes(width, height) {
  const size = width * height, boxes = [];
  let buf = Buffer.alloc(0);
  function scan(f) {
    let l = width, r = -1, t = height, b = -1;
    for (let yy = 0; yy < height; yy++) {
      const o = yy * width;
      for (let xx = 0; xx < width; xx++) if (f[o + xx] > THRESHOLD) { if (xx < l) l = xx; if (xx > r) r = xx; if (yy < t) t = yy; b = yy; }
    }
    boxes.push(r < 0 ? null : { l, r: r + 1, t, b: b + 1 });
  }
  return {
    push(chunk) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      let o = 0;
      while (buf.length - o >= size) { scan(buf.subarray(o, o + size)); o += size; }
      buf = o ? buf.subarray(o) : buf;
    },
    boxes,
  };
}

/* Turns per-frame ink boxes into extents relative to the row anchor. */
function toRelative(rows, boxes, anchor) {
  const rel = {}, ref = boxes[0];
  if (boxes.length < rows.length + 1) throw new Error('FFmpeg trả thiếu khung khi đo chữ (' + boxes.length + '/' + (rows.length + 1) + ').');
  if (!ref) throw new Error('FFmpeg không hiển thị chữ khi đo font.');
  const blank = [];
  rows.forEach((row, i) => {
    const m = boxes[i + 1];
    if (!m) { rel[row] = null; blank.push(row); return; }            // nothing visible (invisible characters, glyph-less text): no box for it
    rel[row] = { l: m.l - anchor.x, r: m.r - anchor.x, t: m.t - anchor.y, b: m.b - anchor.y };
  });
  return { rel, ref: { t: ref.t - anchor.y, b: ref.b - anchor.y }, blank };
}

module.exports = { REF_TEXT, buildMeasureAss, frameBoxes, toRelative };
