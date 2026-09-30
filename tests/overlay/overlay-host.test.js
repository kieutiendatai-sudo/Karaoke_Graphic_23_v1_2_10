'use strict';
// Mocked Premiere DOM: files go into the Project with one importFiles call; sequences, Graphics and keyframes are never touched.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { test } = require('./helper');
const source = fs.readFileSync(path.join(__dirname, '../../extension/jsx/overlay-host.jsx'), 'utf8');
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));      // vm objects are cross-realm
const collection = a => Object.assign(a, { numItems: a.length });
class Time { constructor() { this.seconds = 0; } }

function setup(options = {}) {
  const calls = { imports: [], sequenceTouched: 0 };
  const project = { rootItem: { type: 2, children: collection([]) }, getInsertionBin() { return this.rootItem; },
    importFiles(files, suppress, bin) {
      if (options.importFails) return false;
      calls.imports.push(files.slice());
      files.forEach((f, i) => { if (!(options.dropFile && i === 0)) bin.children.push({ type: 1, name: path.basename(f), nodeId: 'N' + bin.children.length, getMediaPath: () => f }); });
      bin.children.numItems = bin.children.length; return true; } };
  Object.defineProperty(project, 'activeSequence', { get() { calls.sequenceTouched++; return options.noSequence ? null : { name: 'Seq', timebase: '8475667200',
    getSettings: () => ({ videoFrameWidth: 1280, videoFrameHeight: 720 }), videoTracks: Object.assign([{}, {}], { numTracks: 2, numItems: 2 }) }; } });
  const context = vm.createContext({ app: { version: options.version || '23.6', project }, decodeURIComponent, encodeURIComponent });
  vm.runInContext(source, context);
  const call = (fn, arg) => JSON.parse(context.KGO[fn](arg === undefined ? undefined : encodeURIComponent(JSON.stringify(arg))));
  return { call, calls };
}
const files = ['D:/out/001_karaoke.mov', 'D:/out/002_karaoke.mov', 'D:/out/003_karaoke.mov'];

test('all rendered files are imported into the Project with ONE importFiles call, without touching a sequence', () => {
  const { call, calls } = setup(), r = call('importFiles', { files });
  assert.equal(r.ok, true); assert.equal(r.value.imported, 3); assert.equal(r.value.alreadyInProject, 0);
  same(calls.imports, [files]); assert.equal(calls.sequenceTouched, 0);
});

test('files already in the project are not imported twice (case/slash-insensitive); a mixed list imports only the new ones', () => {
  const { call, calls } = setup(); call('importFiles', { files: [files[0]] });
  const r = call('importFiles', { files: ['d:\\OUT\\001_karaoke.mov', files[1], files[2]] });
  assert.equal(r.value.imported, 2); assert.equal(r.value.alreadyInProject, 1);
  same(calls.imports, [[files[0]], [files[1], files[2]]]);
  const again = call('importFiles', { files }); assert.equal(again.value.imported, 0); assert.equal(calls.imports.length, 2);   // nothing left: no call
});

test('errors: empty list, refused import, file missing after import, old Premiere', () => {
  assert.match(setup().call('importFiles', { files: [] }).error, /Không có file/);
  assert.match(setup({ importFails: true }).call('importFiles', { files }).error, /không nhập được 3 file/);
  assert.match(setup({ dropFile: true }).call('importFiles', { files }).error, /không thấy trong Project: D:\/out\/001/);
  assert.match(setup({ version: '22.1' }).call('importFiles', { files }).error, /Premiere Pro 23/);
});

test('info still needs an open sequence and returns the exact timebase ticks used for the frame rate', () => {
  assert.match(setup({ noSequence: true }).call('info').error, /sequence/);
  assert.match(setup({ version: '22.1' }).call('info').error, /Premiere Pro 23/);
  const r = setup().call('info');
  assert.equal(r.value.timebase, '8475667200'); assert.equal(r.value.width, 1280); assert.equal(r.value.videoTracks, 2);
});
