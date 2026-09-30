'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { test } = require('./helper');
const ext = path.join(__dirname, '../../extension');
const read = p => fs.readFileSync(path.join(ext, p), 'utf8');

test('manifest: second extension with Node only for the overlay panel; old panel unchanged', () => {
  const xml = read('CSXS/manifest.xml');
  const blocks = xml.split('<Extension Id=').slice(1);
  const oldBlock = blocks.find(b => /local\.karaoke\.graphic23\.panel"/.test(b) && /MainPath/.test(b));
  const newBlock = blocks.find(b => /local\.karaoke\.graphic23\.overlay"/.test(b) && /MainPath/.test(b));
  assert.ok(/MainPath>\.\/index\.html/.test(oldBlock) && !/nodejs/.test(oldBlock));
  assert.ok(/--disable-background-timer-throttling/.test(oldBlock));
  assert.ok(/MainPath>\.\/overlay\.html/.test(newBlock) && /--enable-nodejs/.test(newBlock) && /--mixed-context/.test(newBlock));
  assert.ok(/ScriptPath>\.\/jsx\/overlay-host\.jsx/.test(newBlock));
  assert.ok(/Host Name="PPRO" Version="\[23\.0,23\.9\]"/.test(xml));                    // still Premiere 23 only
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
