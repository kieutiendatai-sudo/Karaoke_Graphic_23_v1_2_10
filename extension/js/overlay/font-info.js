/* Reads family/style/weight from a TrueType/OpenType file (sfnt) so the ASS style can name the font. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KGFontInfo = api; else if (!(typeof module === 'object' && module.exports)) root.KGFontInfo = api;
}(this, function () {
  'use strict';
  function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
  function u32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function tag(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }

  function decode(b, start, length, platform) {
    var out = '', i;
    if (platform === 3 || platform === 0) {            // UTF-16BE
      for (i = 0; i + 1 < length; i += 2) out += String.fromCharCode(u16(b, start + i));
    } else {                                           // Macintosh Roman (ASCII range is enough for family names)
      for (i = 0; i < length; i++) out += String.fromCharCode(b[start + i]);
    }
    return out;
  }

  /* bytes: Uint8Array/Buffer of a .ttf/.otf/.ttc (first font of a collection). */
  function readFontInfo(bytes) {
    var b = bytes, base = 0;
    if (b.length < 12) throw new Error('File font quá nhỏ.');
    if (tag(b, 0) === 'ttcf') base = u32(b, 12);
    var kind = tag(b, base);
    if (['\u0000\u0001\u0000\u0000', 'OTTO', 'true', 'typ1'].indexOf(kind) < 0) throw new Error('Không phải file font TrueType/OpenType.');
    var count = u16(b, base + 4), tables = {}, i;
    for (i = 0; i < count; i++) {
      var e = base + 12 + i * 16;
      tables[tag(b, e)] = { offset: u32(b, e + 8), length: u32(b, e + 12) };
    }
    if (!tables.name) throw new Error('Font không có bảng tên.');
    var n = tables.name.offset, records = u16(b, n + 2), strings = n + u16(b, n + 4), names = {};
    for (i = 0; i < records; i++) {
      var r = n + 6 + i * 12, platform = u16(b, r), id = u16(b, r + 6), len = u16(b, r + 8), off = u16(b, r + 10);
      var text = decode(b, strings + off, len, platform);
      // prefer Windows English, then any Unicode, then Mac
      var rank = platform === 3 && u16(b, r + 4) === 0x409 ? 3 : platform === 3 || platform === 0 ? 2 : 1;
      if (!names[id] || rank > names[id].rank) names[id] = { text: text, rank: rank };
    }
    function pick() { for (var k = 0; k < arguments.length; k++) if (names[arguments[k]]) return names[arguments[k]].text; return ''; }
    var weight = 400;
    if (tables['OS/2'] && tables['OS/2'].length >= 6) weight = u16(b, tables['OS/2'].offset + 4);
    var family = pick(1, 16);
    return { family: family, typographicFamily: pick(16, 1), style: pick(2, 17), fullName: pick(4),
             weightClass: weight, bold: weight >= 600, variable: !!tables.fvar };
  }
  return { readFontInfo: readFontInfo };
}));
