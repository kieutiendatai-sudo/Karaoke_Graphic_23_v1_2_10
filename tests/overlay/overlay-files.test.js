'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { test } = require('./helper');
const F = require('../../extension/js/overlay/overlay-files.js');

test('hex colours: only typed hex is accepted, normalised to #RRGGBB', () => {
  assert.equal(F.normalizeHex('#f7d114'), '#F7D114'); assert.equal(F.normalizeHex(' F7D114 '), '#F7D114'); assert.equal(F.normalizeHex('#fa0'), '#FFAA00');
  for (const bad of ['', '#12345', '#GGGGGG', 'red', '#1234567', null, undefined]) assert.equal(F.normalizeHex(bad), null, String(bad));
});

test('SRT list: files and folders expand in natural order, dedupe, quotes stripped, problems reported', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kgsrt-')), sub = path.join(d, 'sub'), empty = path.join(d, 'empty');
  fs.mkdirSync(sub); fs.mkdirSync(empty);
  for (const n of ['10.srt', '2.srt', '1.SRT', 'note.txt']) fs.writeFileSync(path.join(sub, n), '');
  fs.writeFileSync(path.join(d, 'single.srt'), '');
  const text = [sub, '"' + path.join(d, 'single.srt') + '"', path.join(sub, '2.srt'), path.join(d, 'nope.srt'), empty, ''].join('\r\n');
  const r = F.expandSrtInputs(fs, path, text);
  assert.deepEqual(r.files.map(f => path.relative(d, f)), ['sub/1.SRT', 'sub/2.srt', 'sub/10.srt', 'single.srt'].map(p => p.split('/').join(path.sep)));
  assert.equal(r.errors.length, 2);
});
