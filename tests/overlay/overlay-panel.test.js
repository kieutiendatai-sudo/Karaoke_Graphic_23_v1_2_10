'use strict';
// The panel script run against a minimal fake DOM (no Node/CEP): presets, dependent fields, defaults.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { test } = require('./helper');
const ext = path.join(__dirname, '../../extension');
const html = fs.readFileSync(path.join(ext, 'overlay.html'), 'utf8'), script = fs.readFileSync(path.join(ext, 'js/overlay/overlay-panel.js'), 'utf8');

function boot(stored) {
  const els = {}, storage = Object.assign({}, stored);
  for (const m of html.matchAll(/<(input|select|textarea|button|fieldset|pre|progress|div)\b([^>]*)>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[2]); if (!id) continue;
    const type = /\btype="([^"]+)"/.exec(m[2]);
    els[id[1]] = { id: id[1], tag: m[1], type: type ? type[1] : m[1] === 'textarea' ? 'textarea' : m[1] === 'select' ? 'select-one' : 'text', value: '', checked: false, disabled: /\bdisabled\b/.test(m[2]),
      handlers: {}, children: [], textContent: '',
      set innerHTML(v) { this.children = /<option value=""/.test(v) ? [{ value: '' }] : []; }, get innerHTML() { return ''; }, style: {}, className: '',
      addEventListener(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); },
      appendChild(c) { this.children.push(c); }, getAttribute() { return null; }, click() { (this.handlers.click || []).forEach(f => f.call(this)); },
      fire(ev) { (this.handlers[ev] || []).forEach(f => f.call(this)); } };
  }
  const buttons = Object.values(els).filter(e => e.tag === 'button');
  const document = { getElementById: id => els[id] || (() => { throw new Error('missing #' + id); })(), querySelectorAll: sel => sel === 'button' ? buttons : [],
    createElement: () => ({ value: '', textContent: '' }) };
  const localStorage = { getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } };
  const context = vm.createContext({ document, localStorage, window: {}, console, JSON });
  vm.runInContext(script, context);
  return { els, storage, options: () => els.presetSelect.children.map(c => c.value) };
}

test('defaults: PNG first (ProRes and qtrle are opt-in), dependent fields disabled until their checkbox is ticked', () => {
  const { els } = boot();
  assert.equal(els.codec.value, 'png'); assert.equal(els.quality.value, 'balanced');
  assert.ok(html.indexOf('value="png"') < html.indexOf('value="prores4444"') && html.indexOf('value="prores4444"') < html.indexOf('value="qtrle"'));
  assert.equal(els.twoRows.checked, false); assert.equal(els.rowFields.disabled, true);
  assert.equal(els.bgEnabled.checked, false); assert.equal(els.bgFields.disabled, true);
  els.bgEnabled.checked = true; els.bgEnabled.fire('change'); assert.equal(els.bgFields.disabled, false);
  els.bgEnabled.checked = false; els.bgEnabled.fire('change'); assert.equal(els.bgFields.disabled, true);
  els.twoRows.checked = true; els.twoRows.fire('change'); assert.equal(els.rowFields.disabled, false);
});

test('checkboxes are not wrapped in a label: only the box itself toggles them', () => {
  for (const id of ['bold', 'twoRows', 'bgEnabled', 'autoImport']) {
    const before = html.slice(0, html.indexOf('id="' + id + '"'));
    assert.ok(before.lastIndexOf('<div class="check">') > before.lastIndexOf('<label'), id + ' is inside a <label>');
  }
});

test('presets: save under a name, apply restores the style but never the file paths; overwrite; delete', () => {
  const { els, storage, options } = boot();
  els.srtPath.value = 'D:/a.srt'; els.outputDir.value = 'D:/out'; els.fontSize.value = '72'; els.textColor.value = '#112233'; els.bgEnabled.checked = true; els.bgRadius.value = '30';
  els.presetName.value = 'Banana Tales'; els.presetSave.click();
  assert.deepEqual(options(), ['', 'Banana Tales']);
  const saved = JSON.parse(storage['kg.overlay.presets'])['Banana Tales'];
  assert.equal(saved.fontSize, 72); assert.equal(saved.bgEnabled, true); assert.equal(saved.bgRadius, 30);
  for (const k of ['srtPath', 'outputDir', 'ffmpegDir', 'previewStart', 'previewLength']) assert.equal(k in saved, false, k + ' must not be in a preset');
  // change everything, then apply the preset
  els.fontSize.value = '40'; els.textColor.value = '#FFFFFF'; els.bgEnabled.checked = false; els.srtPath.value = 'D:/other.srt';
  els.presetSelect.value = 'Banana Tales'; els.presetSelect.fire('change');
  assert.equal(els.fontSize.value, 72); assert.equal(els.textColor.value, '#112233'); assert.equal(els.bgEnabled.checked, true); assert.equal(els.bgFields.disabled, false);
  assert.equal(els.srtPath.value, 'D:/other.srt');                                    // paths untouched
  // second preset + overwrite + delete
  els.fontSize.value = '50'; els.presetName.value = 'Khác'; els.presetSave.click();
  els.fontSize.value = '55'; els.presetName.value = 'Khác'; els.presetSave.click();
  assert.equal(JSON.parse(storage['kg.overlay.presets'])['Khác'].fontSize, 55); assert.deepEqual(options().slice(1).sort(), ['Banana Tales', 'Khác']);
  els.presetSelect.value = 'Khác'; els.presetDelete.click();
  assert.deepEqual(options(), ['', 'Banana Tales']);
});

test('presets: empty name is refused; broken storage does not crash; presets persist across a reload', () => {
  const a = boot(); a.els.presetName.value = '  '; a.els.presetSave.click(); assert.equal(a.storage['kg.overlay.presets'], undefined);
  const b = boot({ 'kg.overlay.presets': '{not json' }); assert.deepEqual(b.options(), ['']);
  const c = boot({ 'kg.overlay.presets': JSON.stringify({ X: { fontSize: 99 } }) }); assert.deepEqual(c.options(), ['', 'X']);
  c.els.presetSelect.value = 'X'; c.els.presetSelect.fire('change'); assert.equal(c.els.fontSize.value, 99);
});
