/* Two-row layout: keep the SRT's own rows when they fit, otherwise break the cue into two balanced rows at a word boundary.
   Widths come from libass (measure(strings) -> Promise<{string: inkWidthPx}>), so the choice matches what is rendered. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KGWrap = api; else if (!(typeof module === 'object' && module.exports)) root.KGWrap = api;
}(this, function () {
  'use strict';

  /* Widest ink (px) a row may have, from the canvas width, the anchor and the background padding. */
  function widthLimit(style) {
    var W = style.width, margin = Math.round(W * 0.02), x = W * (style.anchorX == null ? 50 : style.anchorX) / 100;
    var pad = style.bgEnabled ? (style.bgPadX == null ? 24 : style.bgPadX) : 0, avail;
    if (style.align === 'left') avail = W - x - margin - pad;
    else if (style.align === 'right') avail = x - margin - pad;
    else avail = 2 * Math.min(x, W - x) - 2 * margin - 2 * pad;
    return Math.max(1, Math.floor(avail));
  }

  function splits(text) {                  // every two-row break at a single space
    var out = [], i;
    for (i = 0; i < text.length; i++) if (text.charAt(i) === ' ') out.push([text.slice(0, i), text.slice(i + 1)]);
    return out;
  }
  function estimate(text) {                // break nearest to half of the characters
    var all = splits(text), half = text.length / 2, best = null;
    all.forEach(function (s) { var d = Math.abs(s[0].length - half); if (!best || d < best.d) best = { d: d, rows: s }; });
    return best && best.rows;
  }
  function unique(list) { var seen = {}, out = []; list.forEach(function (s) { if (!seen[s]) { seen[s] = 1; out.push(s); } }); return out; }

  /* cues: KGCore.parseSRT() output (text, lines). Returns {rows: {cueId: [row, ...]}, wrapped, overflow: [cueId]} */
  function wrapCues(cues, measure, limit) {
    var rows = {}, width = {}, wrapped = 0, overflow = [];
    function srtRows(c) { return c.lines && c.lines.length > 1 ? [c.lines[0], c.lines.slice(1).join(' ')] : [c.text]; }
    function fits(list) { return list.every(function (r) { return width[r] <= limit; }); }
    function need(strings) {
      var missing = unique(strings).filter(function (s) { return width[s] === undefined; });
      if (!missing.length) return Promise.resolve();
      return measure(missing).then(function (w) { missing.forEach(function (s) { width[s] = w[s] || 0; }); });
    }
    var joined = function (r) { return r.join(' '); };
    return need([].concat.apply([], cues.map(srtRows))).then(function () {
      var todo = [];
      cues.forEach(function (c) {
        var own = srtRows(c);
        if (joined(own) !== c.text) own = [c.text];
        if (fits(own)) rows[c.id] = own; else todo.push(c);
      });
      var guess = {};
      todo.forEach(function (c) { guess[c.id] = estimate(c.text); });
      return need([].concat.apply([], todo.map(function (c) { return guess[c.id] || []; }))).then(function () {
        var hard = [];
        todo.forEach(function (c) {
          var g = guess[c.id];
          if (g && fits(g)) { rows[c.id] = g; wrapped++; } else hard.push(c);
        });
        return need([].concat.apply([], hard.map(function (c) { return [].concat.apply([], splits(c.text)); }))).then(function () {
          hard.forEach(function (c) {
            var all = splits(c.text), best = null;
            all.forEach(function (s) {
              var a = width[s[0]], b = width[s[1]], ok = a <= limit && b <= limit, score = ok ? Math.abs(a - b) : 1e6 + Math.max(a, b);
              if (!best || score < best.score) best = { score: score, rows: s, ok: ok };
            });
            if (!best) { rows[c.id] = [c.text]; overflow.push(c.id); return; }        // one word wider than the row: nothing to break
            rows[c.id] = best.rows; wrapped++;
            if (!best.ok) overflow.push(c.id);
          });
          return { rows: rows, wrapped: wrapped, overflow: overflow };
        });
      });
    });
  }
  return { widthLimit: widthLimit, splits: splits, estimate: estimate, wrapCues: wrapCues };
}));
