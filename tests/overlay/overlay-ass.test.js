'use strict';
const assert = require('node:assert/strict');
const { test } = require('./helper');
const Core = require('../../extension/js/core.js');
const Plan = require('../../extension/js/overlay/overlay-plan.js');
const Ass = require('../../extension/js/overlay/ass-writer.js');
const Args = require('../../extension/js/overlay/ffmpeg-args.js');

const style = { fontFamily: 'DejaVu Serif', fontSize: 56, bold: true, textColor: '#FFFFFF', highlightColor: '#F7D114', outlineColor: '#000000',
  outline: 2, shadow: 0, align: 'center', anchorX: 50, width: 1280, height: 180 };
const cues = Core.parseSRT('1\n00:00:01,000 --> 00:00:03,000\nShe found the documents\n\n2\n00:00:04,000 --> 00:00:05,000\nNow over\n');
const plan = Plan.buildPlan(cues, { fps: { num: 30, den: 1 } });
const bodyOf = row => row.split(',,').slice(2).join(',,');
const dialogues = ass => ass.split('\n').filter(l => l.startsWith('Dialogue:'));

test('one Dialogue per word; only the active word has the highlight colour', () => {
  const ass = Ass.buildAss(plan, style), rows = dialogues(ass);
  assert.equal(rows.length, plan.words);
  rows.forEach((row, i) => {
    const e = plan.events[i], text = bodyOf(row).replace(/^\{[^}]*\}/, '');
    const active = /\{\\1c&H0014D1F7&\}([^{]*)\{/.exec(text);
    assert.ok(active, row);
    assert.equal(active[1], e.word);                                                   // exactly the active word
    assert.equal((text.match(/&H0014D1F7&/g) || []).length, 1);                        // highlighted once per event
    assert.equal(text.replace(/\{[^}]*\}/g, ""), e.line);                         // whole line, spaces intact
  });
});

test('events of a cue are contiguous and start at 0 (overlay clock)', () => {
  const rows = dialogues(Ass.buildAss(plan, style)).map(r => r.split(','));
  assert.equal(rows[0][1], '0:00:00.00');
  for (let i = 1; i < rows.length; i++) {
    const sameCue = plan.events[i].cue === plan.events[i - 1].cue;
    if (sameCue) assert.equal(rows[i][1], rows[i - 1][2]);
  }
  assert.equal(rows[rows.length - 1][2], '0:00:04.00');                                // last cue end - first cue start
});

test('frame -> centisecond floor puts every frame in exactly its intended event (<= 100 fps)', () => {
  for (const fps of [{ num: 24000, den: 1001 }, { num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 },
    { num: 50, den: 1 }, { num: 60000, den: 1001 }, { num: 60, den: 1 }, { num: 100, den: 1 }]) {
    // libass renders frame k at trunc(k / fps * 1000) ms; ASS boundaries are floor(boundary) centiseconds
    const ms = k => Math.floor(k * fps.den * 1000 / fps.num);
    for (let boundary = 1; boundary < 6000; boundary += 7) {
      const b = Ass.frameToCs(boundary, fps) * 10;
      assert.ok(ms(boundary) >= b, 'frame ' + boundary + ' must be at/after its own boundary @' + fps.num + '/' + fps.den);
      assert.ok(ms(boundary - 1) < b, 'previous frame must be before the boundary @' + fps.num + '/' + fps.den);
    }
  }
});

test('ASS times format', () => {
  assert.equal(Ass.csToTime(0), '0:00:00.00'); assert.equal(Ass.csToTime(366123), '1:01:01.23');
  assert.equal(Ass.frameToCs(30, { num: 30, den: 1 }), 100); assert.equal(Ass.frameToCs(10, { num: 30000, den: 1001 }), 33);
});

test('colours are BGR with opaque alpha and are validated', () => {
  assert.equal(Ass.color('#F7D114'), '&H0014D1F7&'); assert.equal(Ass.color('#FFFFFF'), '&H00FFFFFF&');
  assert.throws(() => Ass.color('yellow'), /màu/i);
});

test('alignment and anchor: left/center/right use \\an4/5/6 at anchorX% and vertical centre', () => {
  const at = (align, x) => dialogues(Ass.buildAss(plan, Object.assign({}, style, { align, anchorX: x })))[0];
  assert.match(at('left', 5), /\{\\an4\\pos\(64,90\)\}/); assert.match(at('center', 50), /\{\\an5\\pos\(640,90\)\}/); assert.match(at('right', 95), /\{\\an6\\pos\(1216,90\)\}/);
  assert.match(Ass.buildAss(plan, style), /PlayResX: 1280\nPlayResY: 180\nWrapStyle: 2/);
});

test('cue text can never break the ASS file', () => {
  const evil = Core.parseSRT('1\n00:00:00,000 --> 00:00:01,000\n{\\an9\\c&H0000FF&}red \\N {x}\n');
  const p = Plan.buildPlan(evil, { fps: { num: 30, den: 1 } }), rows = dialogues(Ass.buildAss(p, style));
  rows.forEach(r => {
    const body = bodyOf(r).replace(/^\{[^}]*\}/, '');
    assert.ok(!/\\an9|\\c&H0000FF/.test(body.replace(/\{\\1c[^}]*\}/g, '')), body);
    // every remaining brace is either one of our colour tags or an escaped literal
    assert.equal(body.replace(/\{\\1c&H[0-9A-F]{8}&\}/g, '').replace(/\\[{}]/g, '').search(/[{}]/), -1);
  });
});

test('matte ASS: identical geometry/timing, every colour white', () => {
  const colour = Ass.buildAss(plan, style), matte = Ass.buildAss(plan, style, { matte: true });
  const strip = s => s.replace(/&H[0-9A-F]{8}&/g, 'C');
  assert.equal(strip(colour), strip(matte));
  assert.ok(!/&H0014D1F7&/.test(matte)); assert.ok(/&H00FFFFFF&/.test(matte));
});

test('ffmpeg args: two inputs, alphamerge + unpremultiply, ProRes 4444 with alpha, BT.709, no shell text', () => {
  const a = Args.overlayArgs({ fps: { num: 30000, den: 1001 }, width: 1280, height: 180, durationSeconds: 5.5, output: 'out.partial.mov' });
  const graph = a[a.indexOf('-filter_complex') + 1];
  assert.equal(a.filter(x => x === '-i').length, 1);
  assert.ok(/alphamerge,format=gbrap,unpremultiply=inplace=1/.test(graph));
  assert.ok(a.includes('prores_ks') && a.includes('4444') && a.includes('yuva444p10le') && a.includes('bt709'));
  assert.equal(a[a.indexOf('-i') + 1], 'color=c=black:s=1280x180:r=30000/1001:d=5.500000');
  assert.ok(graph.includes("ass=filename='karaoke.ass':fontsdir='fonts'") && graph.includes("ass=filename='matte.ass'"));
  assert.ok(a.every(x => typeof x === 'string'));
  assert.ok(Args.overlayArgs({ fps: { num: 30, den: 1 }, width: 10, height: 10, durationSeconds: 1, codec: 'qtrle', output: 'x.mov' }).includes('qtrle'));
  assert.ok(Args.overlayArgs({ fps: { num: 30, den: 1 }, width: 10, height: 10, durationSeconds: 1, codec: 'png', output: 'x.mov' }).includes('png'));
  assert.throws(() => Args.overlayArgs({ fps: { num: 30, den: 1 }, width: 10, height: 10, durationSeconds: 1, codec: 'h264', output: 'x.mov' }), /Codec/);
});

const boxesFor = plan => { const rel = {}; plan.events.forEach(e => (e.rows || [e.line]).forEach(r => { rel[r] = { l: -r.length * 10, r: r.length * 10, t: -30, b: 20 }; }));
  return { rel, ref: { t: -40, b: 25 } }; };

test('background box: one rounded-rectangle drawing per cue (single run) under the text; off = unchanged', () => {
  const styles = ass => Object.fromEntries(ass.split('\n').filter(l => l.startsWith('Style:')).map(l => { const f = l.slice(7).split(','); return [f[0], f]; }));
  const offAss = Ass.buildAss(plan, style), off = styles(offAss);
  assert.deepEqual(Object.keys(off), ['Karaoke']); assert.equal(off.Karaoke[15], '1'); assert.equal(off.Karaoke[16], '2');
  assert.ok(dialogues(offAss).every(r => r.startsWith('Dialogue: 1,') && !r.includes('KaraokeBox')));
  const bg = Object.assign({}, style, { bgEnabled: true, bgColor: '#102030', bgOpacity: 60, bgPadX: 30, bgPadY: 10, bgRadius: 12, shadow: 3 });
  const boxes = boxesFor(plan), stats = {};
  assert.throws(() => Ass.buildAss(plan, bg), /số đo/);
  const onAss = Ass.buildAss(plan, bg, { boxes, stats }), on = styles(onAss);
  assert.equal(on.KaraokeBox[4], '&H66302010&'); assert.equal(on.KaraokeBox[5], '&H66302010&');    // fill = colour + 40% transparency (BGR)
  assert.equal(on.Karaoke[15], '1'); assert.equal(on.Karaoke[16], '2'); assert.equal(on.Karaoke[17], '3');    // text keeps outline/shadow
  const rows = dialogues(onAss), draws = rows.filter(r => r.includes(',KaraokeBox,')), texts = rows.filter(r => r.includes(',Karaoke,'));
  assert.equal(draws.length, plan.cues); assert.equal(texts.length, plan.words);           // one box per cue, not per word
  draws.forEach(r => { assert.ok(r.startsWith('Dialogue: 0,')); assert.ok(/\\p1\}m /.test(r) && /\{\\p0\}$/.test(r)); assert.ok(r.includes(' b '), 'no curved corners'); });
  // box = ink extents of the row + padding (x anchor 640 = 50% of 1280, y anchor 90)
  const first = plan.events[0], w = first.line.length * 20 + 60, h = 65 + 20;
  const m = /\\pos\(([\d.-]+),([\d.-]+)\)\\bord0\\shad0\\p1\}m ([\d.]+) 0 l ([\d.]+) 0/.exec(draws[0]);
  assert.equal(Number(m[1]), 640 - first.line.length * 10 - 30); assert.equal(Number(m[2]), 90 - 40 - 10);
  assert.ok(Math.abs(Number(m[4]) + Number(m[3]) - w) < 1e-6, m[3] + ' ' + m[4]);          // right end of the top edge = w - r, start = r
  assert.equal(stats.clippedBoxes, undefined);
  const flat = styles(Ass.buildAss(plan, bg, { boxes, matte: true }));
  assert.equal(flat.KaraokeBox[4], '&H66FFFFFF&');                                          // matte keeps the alpha
  assert.equal(flat.Karaoke[6], '&H00FFFFFF&');                                             // shadow colour is white in the matte, so the shadow reaches the alpha
  const square = draws.length && Ass.buildAss(plan, Object.assign({}, bg, { bgRadius: 0 }), { boxes }).split('\n').find(l => l.includes(',KaraokeBox,'));
  assert.ok(!square.includes(' b '), 'radius 0 must be a plain rectangle');
  assert.ok(Ass.roundedRect(100, 40, 999).includes('b '));                                   // radius clamps to half the height, still valid
});

test('two rows: both rows are drawn each event; the highlight moves across rows; rows stacked around the centre', () => {
  const c2 = Core.parseSRT('1\n00:00:01,000 --> 00:00:04,000\nShe found the\ndocuments today\n');
  const p2 = Plan.buildPlan(c2, { fps: { num: 30, den: 1 }, twoRows: true });
  assert.deepEqual(p2.events[0].rows, ['She found the', 'documents today']);
  assert.deepEqual(p2.events.map(e => e.row), [0, 0, 0, 1, 1]);
  assert.deepEqual(p2.events.map(e => e.line.slice(0, 0) + e.rows[e.row].slice(e.startChar, e.endChar)), ['She', 'found', 'the', 'documents', 'today']);
  const ass = Ass.buildAss(p2, Object.assign({}, style, { lineSpacing: 80 })), rows = dialogues(ass);
  assert.equal(rows.length, p2.words * 2);                                                  // two rows per word event
  const y = r => Number(/\\pos\([\d.]+,([\d.]+)\)/.exec(r)[1]);
  assert.ok(Math.abs(y(rows[1]) - y(rows[0]) - 56 * 0.8) < 1e-6);
  assert.ok(Math.abs((y(rows[0]) + y(rows[1])) / 2 - 90) < 1e-6);                          // block centred on the row anchor
  assert.ok(/\{\\1c&H0014D1F7&\}She/.test(rows[0]) && !/\\1c/.test(rows[1]));               // first word: row 1 highlighted, row 2 plain
  assert.ok(!/\\1c/.test(rows[6]) && /\{\\1c&H0014D1F7&\}documents/.test(rows[7]));         // fourth word (row 2): row 2 highlighted
  // default (one row): a two-line cue is still one merged line
  const p1 = Plan.buildPlan(c2, { fps: { num: 30, den: 1 } });
  assert.deepEqual(p1.events[0].rows, ['She found the documents today']);
});
