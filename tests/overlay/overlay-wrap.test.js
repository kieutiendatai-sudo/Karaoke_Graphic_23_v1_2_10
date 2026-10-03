'use strict';
const assert = require('node:assert/strict');
const { test } = require('./helper');
const Wrap = require('../../extension/js/overlay/overlay-wrap.js');
const Core = require('../../extension/js/core.js');

const mk = text => Core.parseSRT('1\n00:00:01,000 --> 00:00:03,000\n' + text + '\n')[0];
const fake = calls => async strings => { calls.push(strings.length); const w = {}; strings.forEach(s => { w[s] = s.length * 10; }); return w; };   // 10 px per character

test('widthLimit: canvas, margin, anchor and background padding', () => {
  assert.equal(Wrap.widthLimit({ width: 1280, anchorX: 50, align: 'center' }), 1280 - 2 * 26);
  assert.equal(Wrap.widthLimit({ width: 1280, anchorX: 50, align: 'center', bgEnabled: true, bgPadX: 30 }), 1280 - 52 - 60);
  assert.equal(Wrap.widthLimit({ width: 1000, anchorX: 10, align: 'left' }), 1000 - 100 - 20);
  assert.equal(Wrap.widthLimit({ width: 1000, anchorX: 90, align: 'right' }), 900 - 20);
});

test('widthLimit: maxWidthPercent caps the whole subtitle (box padding included), never enlarges the default', () => {
  assert.equal(Wrap.widthLimit({ width: 1280, anchorX: 50, align: 'center', maxWidthPercent: 70 }), 896);
  assert.equal(Wrap.widthLimit({ width: 1280, anchorX: 50, align: 'center', bgEnabled: true, bgPadX: 30, maxWidthPercent: 70 }), 896 - 60);
  assert.equal(Wrap.widthLimit({ width: 1280, anchorX: 50, align: 'center', maxWidthPercent: 100 }), 1280 - 52);        // margin still applies
  assert.equal(Wrap.widthLimit({ width: 1000, anchorX: 10, align: 'left', maxWidthPercent: 50, bgEnabled: true, bgPadX: 20 }), 480);
  assert.equal(Wrap.widthLimit({ width: 1280, anchorX: 50, align: 'center', maxWidthPercent: 0 }), 1280 - 52);         // 0 = no cap
});

test('rows that already fit are kept (SRT layout wins); a fitting single line stays one row', async () => {
  const c = [Object.assign(mk('short line\nsecond row'), { id: 1 }), Object.assign(mk('just one row'), { id: 2 })];
  const r = await Wrap.wrapCues(c, fake([]), 300);
  assert.deepEqual(r.rows[1], ['short line', 'second row']); assert.deepEqual(r.rows[2], ['just one row']);
  assert.equal(r.wrapped, 0); assert.deepEqual(r.overflow, []);
});

test('a too-wide line is broken at a space into two balanced rows that each fit', async () => {
  const text = 'she found the documents hidden inside the old wooden box';       // 56 chars = 560 px
  const r = await Wrap.wrapCues([Object.assign(mk(text), { id: 5 })], fake([]), 400);
  const rows = r.rows[5];
  assert.equal(rows.length, 2); assert.equal(rows.join(' '), text);
  assert.ok(rows.every(x => x.length * 10 <= 400)); assert.ok(Math.abs(rows[0].length - rows[1].length) <= 8);
  assert.equal(r.wrapped, 1); assert.deepEqual(r.overflow, []);
});

test('SRT rows too wide are re-broken (merged text re-wrapped), never losing or reordering words', async () => {
  const c = Object.assign(mk('this first row is definitely far too long to fit\nend'), { id: 1 });
  const r = await Wrap.wrapCues([c], fake([]), 300);
  assert.equal(r.rows[1].join(' '), c.text); assert.ok(r.rows[1].every(x => x.length * 10 <= 300));
});

test('when the estimate does not fit, every break is measured and the best is chosen; impossible cues are reported', async () => {
  // uneven widths: 'm' is 40 px, other letters 10 px, so the character-half estimate is wrong
  const measure = async strings => { const w = {}; strings.forEach(s => { w[s] = [...s].reduce((a, ch) => a + (ch === 'm' ? 40 : 10), 0); }); return w; };
  const text = 'mmm mmm a b c d e f g h i j k l';
  const r = await Wrap.wrapCues([Object.assign(mk(text), { id: 1 })], measure, 260);
  const w = s => [...s].reduce((a, ch) => a + (ch === 'm' ? 40 : 10), 0);
  assert.ok(r.rows[1].every(x => w(x) <= 260), r.rows[1].join(' | ')); assert.deepEqual(r.overflow, []);
  const tooLong = await Wrap.wrapCues([Object.assign(mk('aaaa bbbb cccc dddd eeee ffff gggg hhhh'), { id: 2 })], fake([]), 150);
  assert.deepEqual(tooLong.overflow, [2]); assert.equal(tooLong.rows[2].join(' '), 'aaaa bbbb cccc dddd eeee ffff gggg hhhh');
  const oneWord = await Wrap.wrapCues([Object.assign(mk('supercalifragilisticexpialidocious'), { id: 3 })], fake([]), 100);
  assert.deepEqual(oneWord.overflow, [3]); assert.deepEqual(oneWord.rows[3], ['supercalifragilisticexpialidocious']);
});

test('measures in few batches (all rows once, then only the problem cues)', async () => {
  const calls = [], c = [];
  for (let i = 1; i <= 50; i++) c.push(Object.assign(mk('word '.repeat(i % 5 + 3).trim()), { id: i }));
  await Wrap.wrapCues(c, fake(calls), 200);
  assert.ok(calls.length <= 3, 'batches: ' + calls.join(','));
});
