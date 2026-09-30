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
  assert.equal(a.filter(x => x === '-i').length, 2);
  assert.ok(/alphamerge,format=gbrap,unpremultiply=inplace=1/.test(graph));
  assert.ok(a.includes('prores_ks') && a.includes('4444') && a.includes('yuva444p10le') && a.includes('bt709'));
  assert.equal(a[a.indexOf('-i') + 1], 'color=c=black:s=1280x180:r=30000/1001:d=5.500000');
  assert.ok(graph.includes("ass=filename='karaoke.ass':fontsdir='fonts'") && graph.includes("ass=filename='matte.ass'"));
  assert.ok(a.every(x => typeof x === 'string'));
  assert.ok(Args.overlayArgs({ fps: { num: 30, den: 1 }, width: 10, height: 10, durationSeconds: 1, codec: 'qtrle', output: 'x.mov' }).includes('qtrle'));
  assert.throws(() => Args.overlayArgs({ fps: { num: 30, den: 1 }, width: 10, height: 10, durationSeconds: 1, codec: 'h264', output: 'x.mov' }), /Codec/);
});

test('background box: BorderStyle 3, box colour + alpha in OutlineColour, padding in Outline; off = unchanged', () => {
  const styleLine = ass => ass.split('\n').find(l => l.startsWith('Style:')).split(',');   // [.., 5]=Outline colour, [15]=BorderStyle, [16]=Outline, [17]=Shadow
  const off = styleLine(Ass.buildAss(plan, style));
  assert.equal(off[15], '1'); assert.equal(off[16], '2');
  const on = styleLine(Ass.buildAss(plan, Object.assign({}, style, { bgEnabled: true, bgColor: '#102030', bgOpacity: 60, bgPadding: 14, shadow: 3 })));
  assert.equal(on[5], '&H66302010&');                    // 40% transparent = 0x66, BGR order
  assert.equal(on[15], '3'); assert.equal(on[16], '14'); assert.equal(on[17], '0');
  const m = styleLine(Ass.buildAss(plan, Object.assign({}, style, { bgEnabled: true, bgColor: '#102030', bgOpacity: 60 }), { matte: true }));
  assert.equal(m[5], '&H66FFFFFF&');                     // matte keeps the box alpha so the overlay alpha matches
});
