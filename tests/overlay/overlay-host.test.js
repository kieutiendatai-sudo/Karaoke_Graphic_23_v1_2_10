'use strict';
// Mocked Premiere DOM: one import, one clip, no Graphics and no keyframes.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { test } = require('./helper');
const source = fs.readFileSync(path.join(__dirname, '../../extension/jsx/overlay-host.jsx'), 'utf8');
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));      // vm objects are cross-realm
const collection = a => Object.assign(a, { numItems: a.length });
class Time { constructor() { this.seconds = 0; } }

function setup(options = {}) {
  const calls = { imports: [], overwrites: [], setValues: [] };
  const motion = { matchName: 'AE.ADBE Motion', displayName: 'Motion', properties: collection(['Position', 'Scale', 'Rotation'].map(n => ({
    displayName: n, setValue(v, ui) { calls.setValues.push([n, v, ui]); return 0; } }))) };
  const project = { rootItem: { type: 2, children: collection([]) }, getInsertionBin() { return this.rootItem; },
    importFiles(files, suppress, bin) {
      if (options.importFails) return false;
      calls.imports.push(files);
      bin.children.push({ type: 1, name: path.basename(files[0]), nodeId: 'N1', getMediaPath: () => files[0] });
      bin.children.numItems = bin.children.length; return true; } };
  const track = { isLocked: () => !!options.locked, clips: collection([]),
    overwriteClip(item, t) { calls.overwrites.push([item.name, t.seconds]);
      this.clips.push({ start: { seconds: t.seconds }, projectItem: item, components: collection([motion]) }); this.clips.numItems = this.clips.length; } };
  project.activeSequence = options.noSequence ? null : { name: 'Seq', timebase: '8475667200', getSettings: () => ({ videoFrameWidth: 1280, videoFrameHeight: 720 }),
    videoTracks: Object.assign([track, track], { numTracks: 2, numItems: 2 }) };
  const context = vm.createContext({ app: { version: options.version || '23.6', project }, Time, decodeURIComponent, encodeURIComponent });
  vm.runInContext(source, context);
  const call = (fn, arg) => JSON.parse(context.KGO[fn](arg === undefined ? undefined : encodeURIComponent(JSON.stringify(arg))));
  return { call, calls };
}
const payload = { file: 'D:/out/001_karaoke.mov', startSeconds: 0.5, trackIndex: 1, position: [0.5, 0.85], scale: 100, insert: true };

test('imports once, overwrites one clip, sets Position/Scale', () => {
  const { call, calls } = setup(), r = call('importOverlay', payload);
  assert.equal(r.ok, true); assert.equal(r.value.inserted, true);
  same(calls.imports, [['D:/out/001_karaoke.mov']]); same(calls.overwrites, [['001_karaoke.mov', 0.5]]);
  same(calls.setValues.map(v => v[0]), ['Position', 'Scale']); same(calls.setValues[0][1], [0.5, 0.85]); assert.equal(calls.setValues[1][1], 100);
});

test('a file already in the project is not imported twice', () => {
  const { call, calls } = setup(); call('importOverlay', payload); call('importOverlay', payload);
  assert.equal(calls.imports.length, 1);
});

test('insert=false only imports', () => {
  const { call, calls } = setup(), r = call('importOverlay', Object.assign({}, payload, { insert: false }));
  assert.equal(r.value.inserted, false); assert.equal(calls.overwrites.length, 0);
});

test('errors are reported', () => {
  assert.match(setup({ locked: true }).call('importOverlay', payload).error, /khóa/);
  assert.match(setup().call('importOverlay', Object.assign({}, payload, { trackIndex: 9 })).error, /không tồn tại/);
  assert.match(setup({ noSequence: true }).call('importOverlay', payload).error, /sequence/);
  assert.match(setup({ importFails: true }).call('importOverlay', payload).error, /không nhập được/);
  assert.match(setup({ version: '22.1' }).call('info').error, /Premiere Pro 23/);
});

test('info returns the exact timebase ticks used for the frame rate', () => {
  const r = setup().call('info');
  assert.equal(r.value.timebase, '8475667200'); assert.equal(r.value.width, 1280); assert.equal(r.value.videoTracks, 2);
});
