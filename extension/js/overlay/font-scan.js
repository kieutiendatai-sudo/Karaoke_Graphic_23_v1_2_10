/* Lists installed fonts (family/style/file) from the OS font folders. Reads only the sfnt table directory, 'name' and 'OS/2'. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KGFontScan = api; else if (!(typeof module === 'object' && module.exports)) root.KGFontScan = api;
}(this, function () {
  'use strict';
  function fontDirs(platform, env, home) {
    if (platform === 'win32') return [(env.WINDIR || 'C:\\Windows') + '\\Fonts', (env.LOCALAPPDATA || '') && env.LOCALAPPDATA + '\\Microsoft\\Windows\\Fonts'];
    if (platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', (home || '') + '/Library/Fonts'];
    return ['/usr/share/fonts', '/usr/local/share/fonts', (home || '') + '/.fonts', (home || '') + '/.local/share/fonts'];
  }
  function walk(fs, path, dir, out, depth) {
    var names;
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    names.forEach(function (n) {
      var p = path.join(dir, n), st;
      try { st = fs.statSync(p); } catch (e) { return; }
      if (st.isDirectory()) { if (depth < 4) walk(fs, path, p, out, depth + 1); }
      else if (/\.(ttf|otf|ttc)$/i.test(n)) out.push({ file: p, size: st.size });
    });
  }
  /* Reads just enough of the file for readFontInfo: a zero-filled buffer of the file size holding the head, 'name' and 'OS/2'. */
  function sparseRead(fs, file, size) {
    var head = Math.min(size, 65536), buf = Buffer.alloc(size), fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buf, 0, head, 0);
      var base = buf.toString('latin1', 0, 4) === 'ttcf' ? buf.readUInt32BE(12) : 0, count = buf.readUInt16BE(base + 4);
      for (var i = 0; i < count && base + 12 + i * 16 + 16 <= head; i++) {
        var e = base + 12 + i * 16, tag = buf.toString('latin1', e, e + 4);
        if (tag === 'name' || tag === 'OS/2' || tag === 'fvar') {
          var off = buf.readUInt32BE(e + 8), len = Math.min(buf.readUInt32BE(e + 12), size - off);
          if (off + len <= size && off >= head) fs.readSync(fd, buf, off, len, off);
        }
      }
    } finally { fs.closeSync(fd); }
    return buf;
  }
  /* deps: { fs, path, readFontInfo, platform, env, home }. Returns [{family, style, file, bold}] sorted, duplicates removed. */
  function scanFonts(deps) {
    var files = [], seen = {}, out = [];
    (deps.dirs || fontDirs(deps.platform, deps.env || {}, deps.home)).filter(Boolean).forEach(function (d) { walk(deps.fs, deps.path, d, files, 0); });
    files.forEach(function (f) {
      try {
        var info = deps.readFontInfo(sparseRead(deps.fs, f.file, f.size));
        if (!info.family || info.variable) return;          // variable fonts: weight axes are not selectable through ASS
        var key = info.family + '|' + info.style;
        if (seen[key]) return; seen[key] = 1;
        out.push({ family: info.family, style: info.style, file: f.file, bold: info.bold });
      } catch (e) { /* not a usable font */ }
    });
    return out.sort(function (a, b) { return (a.family + a.style).toLowerCase() < (b.family + b.style).toLowerCase() ? -1 : 1; });
  }
  return { fontDirs: fontDirs, scanFonts: scanFonts };
}));
