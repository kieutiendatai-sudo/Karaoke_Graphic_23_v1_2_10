/* Input helpers for the panel: expand the SRT list (files and/or folders) and normalise typed hex colours. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KGFiles = api; else if (!(typeof module === 'object' && module.exports)) root.KGFiles = api;
}(this, function () {
  'use strict';
  function natural(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }

  /* text: one path per line; a folder line stands for every .srt directly inside it. Returns unique file paths in order. */
  function expandSrtInputs(fs, path, text) {
    var out = [], seen = {}, errors = [];
    String(text || '').split(/\r?\n/).map(function (l) { return l.trim().replace(/^"(.*)"$/, '$1'); }).filter(Boolean).forEach(function (p) {
      var st;
      try { st = fs.statSync(p); } catch (e) { errors.push('Không tìm thấy: ' + p); return; }
      var files = st.isDirectory()
        ? fs.readdirSync(p).filter(function (n) { return /\.srt$/i.test(n); }).sort(natural).map(function (n) { return path.join(p, n); })
        : [p];
      if (st.isDirectory() && !files.length) errors.push('Thư mục không có file .srt: ' + p);
      files.forEach(function (f) { if (!seen[f]) { seen[f] = 1; out.push(f); } });
    });
    return { files: out, errors: errors };
  }

  /* '#RRGGBB', 'RRGGBB', '#RGB' (any case) -> '#RRGGBB'; null when invalid */
  function normalizeHex(v) {
    var m = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(String(v || '').trim());
    if (!m) return null;
    var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return '#' + h.toUpperCase();
  }
  return { expandSrtInputs: expandSrtInputs, normalizeHex: normalizeHex };
}));
