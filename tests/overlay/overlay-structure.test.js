'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { test } = require('./helper');
const ext = path.join(__dirname, '../../extension');
const read = p => fs.readFileSync(path.join(ext, p), 'utf8');

test('manifest: a single extension (the overlay panel) with Node enabled, Premiere 23 only', () => {
  const xml = read('CSXS/manifest.xml');
  assert.equal((xml.match(/<Extension Id=/g) || []).length, 2);                         // ExtensionList + DispatchInfoList entry
  assert.ok(/MainPath>\.\/overlay\.html/.test(xml) && /--enable-nodejs/.test(xml) && /--mixed-context/.test(xml));
  assert.ok(/ScriptPath>\.\/jsx\/overlay-host\.jsx/.test(xml));
  assert.ok(/Host Name="PPRO" Version="\[23\.0,23\.9\]"/.test(xml));
});

test('the old Graphic/Crop workflow is gone', () => {
  for (const gone of ['index.html', 'js/panel.js', 'jsx/host.jsx', 'jsx/json2.jsx', 'css/panel.css'])
    assert.ok(!fs.existsSync(path.join(ext, gone)), gone + ' still exists');
  const Core = require(path.join(ext, 'js/core.js'));
  for (const fn of ['geometry', 'makeKeys', 'makeItem', 'cueIndex', 'matchCue']) assert.equal(Core[fn], undefined, fn);
  for (const fn of ['parseSRT', 'timing', 'tokens', 'oneLine']) assert.equal(typeof Core[fn], 'function', fn);   // what the overlay uses
});

test('overlay.html only references files that exist and every field id used by the panel exists', () => {
  const html = read('overlay.html');
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(ext, m[1])), m[1]);
  const panel = read('js/overlay/overlay-panel.js');
  const defaults = /var DEFAULTS = \{([\s\S]*?)\};/.exec(panel)[1];
  for (const m of defaults.matchAll(/(\w+):/g)) assert.ok(html.includes('id="' + m[1] + '"'), 'missing #' + m[1]);
  for (const m of panel.matchAll(/\$\('(\w+)'\)/g)) assert.ok(html.includes('id="' + m[1] + '"'), 'missing #' + m[1]);
});

test('core.js keeps the KGCore global when Node defines `module` inside the page (mixed-context)', () => {
  const code = read('js/core.js'), window = {}, sandbox = { window, module: { exports: {} }, console };
  vm.runInNewContext(code, sandbox);
  assert.equal(typeof window.KGCore.parseSRT, 'function');
  assert.equal(typeof sandbox.module.exports.timing, 'function');
  const plain = { window: {} };                                                         // old panel: no module at all
  vm.runInNewContext(code, plain);
  assert.equal(typeof plain.window.KGCore.timing, 'function');
});

test('no Graphic/keyframe/Crop API is used by the overlay host or panel', () => {
  const text = read('jsx/overlay-host.jsx') + read('js/overlay/overlay-panel.js') + read('js/overlay/overlay-job.js');
  for (const banned of ['addKey', 'setValueAtKey', 'setTimeVarying', 'Crop', 'createGraphic', 'importMGT']) assert.ok(!text.includes(banned), banned);
});
