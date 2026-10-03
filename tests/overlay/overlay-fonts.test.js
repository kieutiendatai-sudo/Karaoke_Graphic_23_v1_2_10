'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { test } = require('./helper');
const ext = path.join(__dirname, '../../extension/js/overlay');
const Scan = require(path.join(ext, 'font-scan.js')), Info = require(path.join(ext, 'font-info.js'));

test('font-scan: OS font folders per platform', () => {
  assert.deepEqual(Scan.fontDirs('win32', { WINDIR: 'C:\\Windows', LOCALAPPDATA: 'C:\\U\\AppData\\Local' }, ''),
    ['C:\\Windows\\Fonts', 'C:\\U\\AppData\\Local\\Microsoft\\Windows\\Fonts']);
  assert.ok(Scan.fontDirs('darwin', {}, '/Users/a').includes('/Users/a/Library/Fonts'));
});

test('font-scan: finds fonts recursively, reads family/style from the sparse read, ignores junk, dedupes', () => {
  const sys = ['/usr/share/fonts', '/usr/share/fonts/truetype'].find(d => fs.existsSync(d));
  const sample = [];
  (function walk(d, n) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (n < 4) walk(p, n + 1); } else if (/\.ttf$/i.test(f)) sample.push(p); } })(sys, 0);
  assert.ok(sample.length, 'no .ttf on this machine to test with');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kgfonts-')), dir = path.join(home, '.fonts', 'sub');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(sample[0], path.join(dir, 'a.ttf')); fs.copyFileSync(sample[0], path.join(dir, 'copy.ttf'));
  fs.writeFileSync(path.join(dir, 'junk.ttf'), 'not a font'); fs.writeFileSync(path.join(dir, 'readme.txt'), 'x');
  const list = Scan.scanFonts({ fs, path, readFontInfo: Info.readFontInfo, dirs: [path.join(home, '.fonts')] });
  const expected = Info.readFontInfo(fs.readFileSync(sample[0]));
  assert.equal(list.length, 1);
  assert.equal(list[0].family, expected.family); assert.equal(list[0].style, expected.style);
  assert.ok(list[0].file.endsWith('.ttf'));
});
