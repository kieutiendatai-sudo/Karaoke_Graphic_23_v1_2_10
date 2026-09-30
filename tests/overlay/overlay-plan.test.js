'use strict';
const assert = require('node:assert/strict');
const { test } = require('./helper');
const Core = require('../../extension/js/core.js');
const Plan = require('../../extension/js/overlay/overlay-plan.js');
const Font = require('../../extension/js/overlay/font-info.js');
const fs = require('node:fs');

const fps30 = { num: 30, den: 1 }, fps2997 = { num: 30000, den: 1001 };
const srt = (rows) => rows.map((r, i) => (i + 1) + '\n' + r[0] + ' --> ' + r[1] + '\n' + r[2] + '\n').join('\n');

test('fps from Premiere ticks per frame is exact', () => {
  assert.deepEqual(Plan.fpsFromTicks(8475667200), fps2997);
  assert.deepEqual(Plan.fpsFromTicks(8467200000), fps30);
  assert.deepEqual(Plan.fpsFromTicks(4233600000), { num: 60, den: 1 });
  assert.deepEqual(Plan.fpsFromPreset('59.94'), { num: 60000, den: 1001 });
  assert.throws(() => Plan.fpsFromTicks(0)); assert.throws(() => Plan.fpsFromPreset('12'));
});

test('events tile every cue frame by frame and reuse KGCore.timing unchanged', () => {
  const cues = Core.parseSRT(srt([['00:00:01,000', '00:00:03,500', 'She found the documents, and everything changed'],
    ['00:00:04,000', '00:00:06,000', 'Now it is over']]));
  const plan = Plan.buildPlan(cues, { fps: fps30 });
  assert.equal(plan.cues, 2); assert.equal(plan.firstFrame, 30); assert.equal(plan.lastFrame, 180);
  assert.equal(plan.durationSeconds, 5);
  cues.forEach(cue => {
    const t = Core.timing(cue.text, cue.end - cue.start, 30), start = Math.round(cue.start * 30);
    const mine = plan.events.filter(e => e.cue === cue.id);
    assert.equal(mine.length, t.words.length);
    mine.forEach((e, i) => { assert.equal(e.startFrame, start + t.words[i].startFrame); assert.equal(e.endFrame, start + t.words[i].endFrame); });
    for (let i = 1; i < mine.length; i++) assert.equal(mine[i].startFrame, mine[i - 1].endFrame);   // no gap, no overlap
    assert.equal(mine[0].startFrame, start); assert.equal(mine[mine.length - 1].endFrame, start + t.frames);
  });
  assert.ok(plan.events.every(e => e.endFrame > e.startFrame));
});

test('offset shifts frames; negative results are rejected', () => {
  const cues = Core.parseSRT(srt([['00:00:01,000', '00:00:02,000', 'hello there']]));
  assert.equal(Plan.buildPlan(cues, { fps: fps30, offset: 2 }).firstFrame, 90);
  assert.throws(() => Plan.buildPlan(cues, { fps: fps30, offset: -5 }), /âm/);
});

test('overlapping cues are cut with a warning, never silently', () => {
  const cues = Core.parseSRT(srt([['00:00:01,000', '00:00:03,000', 'first cue here'], ['00:00:02,500', '00:00:04,000', 'second cue']]));
  const plan = Plan.buildPlan(cues, { fps: fps30 });
  assert.ok(plan.warnings.some(w => /chồng/.test(w)));
  const firstCue = plan.events.filter(e => e.cue === 1);
  assert.equal(firstCue[firstCue.length - 1].endFrame, 75);
});

test('preview window keeps absolute times and cuts events', () => {
  const cues = Core.parseSRT(srt([['00:00:01,000', '00:00:03,000', 'one two three four']]));
  const plan = Plan.buildPlan(cues, { fps: fps30 }), clip = Plan.clipPlan(plan, 45, 30);
  assert.equal(clip.firstFrame, 45); assert.equal(clip.frames, 30); assert.equal(clip.startSeconds, 1.5);
  assert.ok(clip.events.every(e => e.startFrame >= 45 && e.endFrame <= 75));
  assert.throws(() => Plan.clipPlan(plan, 500, 30), /ngoài/);
});

test('29.97 timing works on the real frame grid', () => {
  const cues = Core.parseSRT(srt([['00:00:00,500', '00:00:03,500', 'She found the documents']]));
  const plan = Plan.buildPlan(cues, { fps: fps2997 });
  assert.equal(plan.events[0].startFrame, Math.round(0.5 * 30000 / 1001));
  assert.ok(Math.abs(plan.durationSeconds - plan.frames * 1001 / 30000) < 1e-9);
});

test('font info reads family/weight from a real font', () => {
  const path = ['/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find(p => fs.existsSync(p));
  if (!path) return console.log('SKIP không có font hệ thống');
  const info = Font.readFontInfo(fs.readFileSync(path));
  assert.match(info.family, /^DejaVu/); assert.equal(typeof info.weightClass, 'number'); assert.equal(info.variable, false);
  assert.throws(() => Font.readFontInfo(Buffer.from('not a font at all, sorry!!')), /font/i);
});

test('parseSRT keeps the SRT rows (cue.lines) while cue.text stays one line', () => {
  const d = Core.parseSRT('1\n00:00:01,000 --> 00:00:03,000\n<i>She  found</i> the\ndocuments   today\n')[0];
  assert.deepEqual(d.lines, ['She found the', 'documents today']); assert.equal(d.text, 'She found the documents today');
  assert.deepEqual(Core.parseSRT('1\n00:00:01,000 --> 00:00:03,000\nOne row only\n')[0].lines, ['One row only']);
});

test('a 1-frame overlap (frame rounding) is cut without a warning; a real overlap still warns', () => {
  const fps = { num: 30000, den: 1001 };
  const rounding = Plan.buildPlan(Core.parseSRT(srt([['00:00:01,000', '00:00:02,050', 'first cue here'], ['00:00:02,010', '00:00:03,000', 'second cue']])), { fps });
  const cut = rounding.events.filter(e => e.cue === 1); const next = rounding.events.find(e => e.cue === 2);
  assert.equal(cut[cut.length - 1].endFrame, next.startFrame);        // 1 frame really was cut (cue 1 would end 1 frame later)
  assert.equal(Plan.buildPlan(Core.parseSRT(srt([['00:00:01,000', '00:00:02,050', 'first cue here']])), { fps }).lastFrame, next.startFrame + 1);
  assert.ok(!rounding.warnings.some(w => /chồng/.test(w)), rounding.warnings.join('|'));
});
