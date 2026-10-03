'use strict';
// Real FFmpeg renders (skipped when no ffmpeg with libass/prores_ks or no system font is available).
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process');
const { test, skip } = require('./helper');
const Job = require('../../extension/js/overlay/overlay-job.js');

function findFfmpeg() {
  const candidates = [process.env.KG_FFMPEG, process.env.KG_FFMPEG_DIR && path.join(process.env.KG_FFMPEG_DIR, 'ffmpeg')].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const onPath = (process.env.PATH || '').split(path.delimiter).map(p => path.join(p, 'ffmpeg')).find(p => fs.existsSync(p));
  return onPath || null;
}
const ffmpeg = findFfmpeg();
const font = ['/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', 'C:\\Windows\\Fonts\\arialbd.ttf'].find(p => fs.existsSync(p));
if (!ffmpeg || !font) { skip('cần ffmpeg (KG_FFMPEG) và font hệ thống'); return; }

const W = 1280, H = 180, HL = [0xF7, 0xD1, 0x14], WHITE = [255, 255, 255];
const SRT = '1\n00:00:00,500 --> 00:00:02,900\nShe found the documents\n\n2\n00:00:03,400 --> 00:00:05,000\nNow it is over\n';
const base = { ffmpeg, srtText: SRT, width: W, height: H, baseName: 'demo',
  style: { fontFile: font, fontSize: 56, bold: false, textColor: '#FFFFFF', highlightColor: '#F7D114', outlineColor: '#000000', outline: 2, yPercent: 85 } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kgov-'));

function decode(file) {
  const raw = cp.execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 30 });
  const size = W * H * 4;
  return { raw, count: raw.length / size, at: (f, x, y) => { const o = f * size + (y * W + x) * 4; return [raw[o], raw[o + 1], raw[o + 2], raw[o + 3]]; }, frame: f => raw.subarray(f * size, (f + 1) * size) };
}
const near = (p, c, tol) => p[3] >= 250 && Math.abs(p[0] - c[0]) <= tol && Math.abs(p[1] - c[1]) <= tol && Math.abs(p[2] - c[2]) <= tol;
function analyse(frame) {         // bbox of highlight pixels, plus counts
  let xmin = 1e9, xmax = -1, hl = 0, white = 0, alpha = 0, tx0 = 1e9, tx1 = -1, ty0 = 1e9, ty1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, p = [frame[o], frame[o + 1], frame[o + 2], frame[o + 3]];
    if (p[3]) alpha++;
    if (near(p, HL, 24)) { hl++; if (x < xmin) xmin = x; if (x > xmax) xmax = x; }
    else if (near(p, WHITE, 24)) white++;
    if (near(p, HL, 24) || near(p, WHITE, 24) || (p[3] >= 250 && Math.max(p[0], p[1], p[2]) < 40)) { if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y; }
  }
  return { xmin: hl ? xmin : -1, xmax: hl ? xmax : -1, hl, white, alpha, text: [tx0, tx1, ty0, ty1] };
}

let rendered;
async function renderDefault() {
  if (rendered) return rendered;
  const meta = await Job.renderOverlay(Object.assign({ outputDir: path.join(tmp, 'a'), fps: { num: 30000, den: 1001 } }, base));
  rendered = { meta, video: decode(meta.output) };
  return rendered;
}

test('ffmpeg has libass, alphamerge, unpremultiply and prores_ks', async () => {
  const r = await Job.checkFfmpeg(ffmpeg);
  assert.equal(r.ok, true, r.missing.join(', '));
});

test('overlay is ProRes 4444 with alpha, exactly canvas-sized, duration from the SRT', async () => {
  const { meta, video } = await renderDefault();
  const info = cp.spawnSync(ffmpeg, ['-hide_banner', '-i', meta.output], { encoding: 'utf8' }).stderr;
  assert.ok(/prores/.test(info) && /\(4444/.test(info) && /yuva444p/.test(info), info);
  assert.ok(/1280x180/.test(info));
  assert.equal(video.count, meta.frames);
  assert.equal(meta.startFrame, Math.round(0.5 * 30000 / 1001));
  assert.ok(Math.abs(meta.durationSeconds - (Math.round(5.0 * 30000 / 1001) - meta.startFrame) * 1001 / 30000) < 0.05);
  assert.deepEqual(meta.premiere, { position: [0.5, 0.85], scale: 100 });
  assert.ok(fs.existsSync(meta.output.replace(/\.mov$/, '.json')));
  assert.ok(!fs.readdirSync(path.join(tmp, 'a')).some(f => /partial/.test(f)));
});

test('frames between the cues are fully transparent; frames inside have text', async () => {
  const { meta, video } = await renderDefault();
  const rate = 30000 / 1001, gap = Math.round((3.1 - 0.5) * rate);
  assert.equal(analyse(video.frame(gap)).alpha, 0);
  assert.ok(analyse(video.frame(3)).alpha > 500);
});

test('colours are right and edges are not darkened (straight alpha)', async () => {
  const { video } = await renderDefault();
  const f = video.frame(20), a = analyse(f);
  assert.ok(a.hl > 100 && a.white > 100, JSON.stringify(a));
  let sum = 0, n = 0;                                       // anti-aliased highlight edge pixels keep the highlight hue
  for (let i = 0; i < f.length; i += 4) if (f[i + 3] > 60 && f[i + 3] < 200 && f[i + 2] < 90 && f[i] > 120) { sum += f[i]; n++; }
  if (n > 20) assert.ok(sum / n > 190, 'edge red channel ' + sum / n);
  // exact colour of the opaque interior
  let best = null;
  for (let i = 0; i < f.length; i += 4) if (near([f[i], f[i + 1], f[i + 2], f[i + 3]], HL, 12)) { best = [f[i], f[i + 1], f[i + 2]]; break; }
  assert.ok(best, 'no pixel within 12 of the highlight colour');
});

test('no dark fringe: semi-transparent glyph edges keep the text colour (outline off)', async () => {
  const meta = await Job.renderOverlay(Object.assign({}, base, { outputDir: path.join(tmp, 'fringe'), baseName: 'f', fps: { num: 30, den: 1 },
    window: { startSeconds: 0.6, lengthSeconds: 0.5 }, style: Object.assign({}, base.style, { outline: 0 }) }));
  const f = decode(meta.output).frame(4);
  let n = 0, sum = 0;
  for (let i = 0; i < f.length; i += 4) if (f[i + 3] >= 40 && f[i + 3] <= 200) { n++; sum += Math.max(f[i], f[i + 1], f[i + 2]); }
  assert.ok(n > 200, 'too few edge pixels: ' + n);
  assert.ok(sum / n >= 215, 'edge pixels are darkened (premultiplied colour): mean max channel ' + (sum / n).toFixed(1));
});

for (const rate of [{ num: 30, den: 1 }, { num: 25, den: 1 }, null])
test('whole-word instant change: one word highlighted per frame, switching exactly at each word start frame (' + (rate ? rate.num + ' fps' : '29.97 fps') + ')', async () => {
  let meta, video;
  if (!rate) ({ meta, video } = await renderDefault());
  else { meta = await Job.renderOverlay(Object.assign({ outputDir: path.join(tmp, 'r' + rate.num), fps: rate }, base)); video = decode(meta.output); }
  const Core = require('../../extension/js/core.js'), Plan = require('../../extension/js/overlay/overlay-plan.js');
  const plan = Plan.buildPlan(Core.parseSRT(SRT), { fps: meta.fps });
  const seq = []; for (let f = 0; f < video.count; f++) { const a = analyse(video.frame(f)); seq.push(a); }
  for (const cue of [1, 2]) {
    const events = plan.events.filter(e => e.cue === cue);
    events.forEach(e => {
      for (let f = e.startFrame; f < e.endFrame; f++) {
        const a = seq[f - plan.firstFrame];
        assert.ok(a.hl > 20, 'frame ' + f + ' cue ' + cue + ' has no highlighted word');
        // the highlighted region is the active word only: its width is less than the whole line
        const line = a.text[1] - a.text[0];
        assert.ok(a.xmax - a.xmin < line * 0.8, 'highlight spans the whole line at frame ' + f);
        assert.ok(a.hl < a.white + a.hl);
      }
    });
    // transitions between consecutive words happen exactly on the planned frame
    for (let i = 1; i < events.length; i++) {
      const before = seq[events[i].startFrame - 1 - plan.firstFrame], after = seq[events[i].startFrame - plan.firstFrame];
      assert.ok(Math.abs(before.xmin - after.xmin) > 5, 'cue ' + cue + ' word ' + i + ': highlight did not move on its start frame');
      if (events[i].startFrame - 2 >= events[i - 1].startFrame) {
        const earlier = seq[events[i].startFrame - 2 - plan.firstFrame];
        assert.ok(Math.abs(before.xmin - earlier.xmin) <= 2, 'highlight moved one frame early before word ' + i);
      }
    }
  }
});

test('text position never changes between words or frames', async () => {
  const { meta, video } = await renderDefault();
  const boxes = []; for (let f = 2; f < Math.round(2.3 * 30000 / 1001); f++) boxes.push(analyse(video.frame(f)).text);
  const ref = boxes[0];
  boxes.forEach(b => b.forEach((v, i) => assert.ok(Math.abs(v - ref[i]) <= 2, 'text bbox moved: ' + b + ' vs ' + ref)));
});

test('alignment: left text starts near the anchor, right text ends near it', async () => {
  const out = path.join(tmp, 'align');
  const metaL = await Job.renderOverlay(Object.assign({}, base, { outputDir: out, baseName: 'l', fps: { num: 30, den: 1 }, window: { startSeconds: 0.6, lengthSeconds: 0.5 },
    style: Object.assign({}, base.style, { align: 'left', anchorX: 10 }) }));
  const a = analyse(decode(metaL.output).frame(3));
  assert.ok(Math.abs(a.text[0] - 128) < 20, 'left edge ' + a.text[0]);
  const metaR = await Job.renderOverlay(Object.assign({}, base, { outputDir: out, baseName: 'r', fps: { num: 30, den: 1 }, window: { startSeconds: 0.6, lengthSeconds: 0.5 },
    style: Object.assign({}, base.style, { align: 'right', anchorX: 90 }) }));
  const b = analyse(decode(metaR.output).frame(3));
  assert.ok(Math.abs(b.text[1] - 1152) < 20, 'right edge ' + b.text[1]);
});

test('preview renders only the window, with absolute start time', async () => {
  const meta = await Job.renderOverlay(Object.assign({}, base, { outputDir: path.join(tmp, 'p'), baseName: 'pv', fps: { num: 30, den: 1 }, window: { startSeconds: 3.4, lengthSeconds: 1 } }));
  assert.equal(meta.preview, true); assert.equal(meta.frames, 30); assert.equal(meta.startSeconds, 3.4);
  assert.ok(/_preview\.mov$/.test(meta.output));
});

test('identical settings are not re-rendered; a style change is', async () => {
  const opts = Object.assign({}, base, { outputDir: path.join(tmp, 's'), fps: { num: 30, den: 1 } });
  const first = await Job.renderOverlay(opts), again = await Job.renderOverlay(opts);
  assert.equal(again.skipped, true); assert.equal(again.identity, first.identity);
  const changed = await Job.renderOverlay(Object.assign({}, opts, { style: Object.assign({}, opts.style, { highlightColor: '#38D9FF' }) }));
  assert.ok(!changed.skipped); assert.notEqual(changed.identity, first.identity);
});

test('errors: missing font, bad srt, broken ffmpeg; no partial file is left behind', async () => {
  const out = path.join(tmp, 'e');
  await assert.rejects(Job.renderOverlay(Object.assign({}, base, { outputDir: out, fps: { num: 30, den: 1 }, style: Object.assign({}, base.style, { fontFile: '/no/such.ttf' }) })), /font/);
  await assert.rejects(Job.renderOverlay(Object.assign({}, base, { outputDir: out, fps: { num: 30, den: 1 }, srtText: '1\n00:00:02,000 --> 00:00:01,000\nx\n' })), /Cue|cue|thời/);
  await assert.rejects(Job.renderOverlay(Object.assign({}, base, { outputDir: out, fps: { num: 30, den: 1 }, ffmpeg: path.join(tmp, 'nope') })), /ffmpeg/i);
  const bad = path.join(tmp, 'badffmpeg.sh'); fs.writeFileSync(bad, '#!/bin/sh\necho "boom: filter failed" >&2\nexit 7\n', { mode: 0o755 });
  await assert.rejects(Job.renderOverlay(Object.assign({}, base, { outputDir: out, fps: { num: 30, den: 1 }, ffmpeg: bad })), /mã 7[\s\S]*boom/);
  assert.ok(!fs.existsSync(out) || !fs.readdirSync(out).some(f => /partial|\.mov$/.test(f)));
});

test('cancel stops ffmpeg and rejects with cancelled', async () => {
  const token = Job.makeCancelToken(), long = '1\n00:00:00,000 --> 00:10:00,000\n' + 'word '.repeat(60).trim() + '\n';
  setTimeout(() => token.cancel(), 800);
  const t0 = Date.now();
  await assert.rejects(Job.renderOverlay(Object.assign({}, base, { outputDir: path.join(tmp, 'c'), fps: { num: 30, den: 1 }, srtText: long, cancel: token })), e => e.cancelled === true);
  assert.ok(Date.now() - t0 < 20000);
  assert.ok(!fs.existsSync(path.join(tmp, 'c')) || !fs.readdirSync(path.join(tmp, 'c')).some(f => /\.mov$/.test(f)));
});

test('progress reports rise to 1', async () => {
  const seen = [];
  await Job.renderOverlay(Object.assign({}, base, { outputDir: path.join(tmp, 'g'), fps: { num: 30, den: 1 }, onProgress: p => seen.push(p) }));
  assert.ok(seen.length >= 1 && seen[seen.length - 1] === 1 && seen.every(v => v >= 0 && v <= 1));
});

test('background box renders: opaque pixels appear around the text with the requested alpha and colour', async () => {
  const opts = o => Object.assign({}, base, { outputDir: path.join(tmp, o.dir), baseName: 'b', fps: { num: 30, den: 1 },
    window: { startSeconds: 0.6, lengthSeconds: 0.5 }, style: Object.assign({}, base.style, o.style) });
  const off = decode((await Job.renderOverlay(opts({ dir: 'bgoff', style: { outline: 0 } }))).output).frame(4);
  const on = decode((await Job.renderOverlay(opts({ dir: 'bgon', style: { bgEnabled: true, bgColor: '#0000FF', bgOpacity: 50, bgPadX: 20, bgPadY: 10, bgRadius: 0 } }))).output).frame(4);
  const cnt = f => { let n = 0; for (let i = 3; i < f.length; i += 4) if (f[i] > 0) n++; return n; };
  assert.ok(cnt(on) > cnt(off) * 1.5, 'box adds no area: ' + cnt(on) + ' vs ' + cnt(off));
  let n = 0, a = 0, blue = 0;
  for (let i = 0; i < on.length; i += 4) if (on[i + 2] > 200 && on[i] < 40 && on[i + 3] > 0) { n++; a += on[i + 3]; blue++; }
  assert.ok(n > 2000, 'blue box pixels: ' + n);
  // no seams: the topmost box rows (above any glyph) have one constant alpha across the whole width
  const W = 1280; let top = -1;
  for (let y = 0; y < on.length / 4 / W && top < 0; y++) for (let x = 0; x < W; x++) if (on[(y * W + x) * 4 + 3] > 0) { top = y; break; }
  const row = top + 3, vals = []; for (let x = 0; x < W; x++) { const v = on[(row * W + x) * 4 + 3]; if (v > 0) vals.push(v); }
  vals.splice(0, 3); vals.splice(-3);                                   // antialiased left/right edges
  assert.ok(vals.length > 200, 'box row too short: ' + vals.length);
  assert.ok(Math.max.apply(null, vals) - Math.min.apply(null, vals) <= 3, 'alpha varies along the box (seams): ' + Math.min.apply(null, vals) + '..' + Math.max.apply(null, vals));
  assert.ok(Math.abs(a / n - 127.5) < 12, 'box alpha mean ' + (a / n).toFixed(1) + ' expected ~128');
});

function inkAndBox(f) {                         // bbox of any coverage (the box) and of opaque pixels (the text with its outline)
  const box = { l: W, r: -1, t: H, b: -1 }, ink = { l: W, r: -1, t: H, b: -1 };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = f[(y * W + x) * 4 + 3];
    if (a > 0) { box.l = Math.min(box.l, x); box.r = Math.max(box.r, x); box.t = Math.min(box.t, y); box.b = Math.max(box.b, y); }
    if (a >= 250) { ink.l = Math.min(ink.l, x); ink.r = Math.max(ink.r, x); ink.t = Math.min(ink.t, y); ink.b = Math.max(ink.b, y); }
  }
  return { box, ink };
}

test('rounded background: the box hugs the measured text (+padding), corners are cut, edges keep the alpha', async () => {
  const opts = (dir, style) => Object.assign({}, base, { outputDir: path.join(tmp, dir), baseName: 'rr', fps: { num: 30, den: 1 },
    window: { startSeconds: 0.6, lengthSeconds: 0.5 }, style: Object.assign({}, base.style, { bgEnabled: true, bgColor: '#0000FF', bgOpacity: 50, bgPadX: 30, bgPadY: 12 }, style) });
  const round = decode((await Job.renderOverlay(opts('rr1', { bgRadius: 24 }))).output).frame(4);
  const square = decode((await Job.renderOverlay(opts('rr0', { bgRadius: 0 }))).output).frame(4);
  const R = inkAndBox(round), S = inkAndBox(square), alpha = (f, x, y) => f[(y * W + x) * 4 + 3];
  for (const k of ['l', 'r', 't', 'b']) assert.ok(Math.abs(R.box[k] - S.box[k]) <= 1, 'box ' + k + ': ' + R.box[k] + ' vs ' + S.box[k]);   // same rectangle, only the corners differ
  assert.ok(Math.abs((R.box.r - R.box.l + 1) - (R.ink.r - R.ink.l + 1 + 60)) <= 4, 'box width ' + (R.box.r - R.box.l + 1) + ' vs ink ' + (R.ink.r - R.ink.l + 1) + ' + 2*30');
  assert.ok(R.ink.l - R.box.l >= 26 && R.box.r - R.ink.r >= 26, 'horizontal padding too small');
  assert.ok(R.ink.t - R.box.t >= 10 && R.box.b - R.ink.b >= 10, 'vertical padding too small');
  assert.ok(alpha(square, S.box.l + 1, S.box.t + 1) > 100, 'square corner should be filled');
  assert.ok(alpha(round, R.box.l + 1, R.box.t + 1) < 20, 'rounded corner should be transparent: ' + alpha(round, R.box.l + 1, R.box.t + 1));
  assert.ok(alpha(round, R.box.l + 24, R.box.t + 1) > 100, 'straight part of the top edge stays filled');
  assert.ok(Math.abs(alpha(round, Math.round((R.box.l + R.box.r) / 2), R.box.t + 3) - 128) <= 3);
});

test('two rows: both rows visible, the highlight goes through row 1 then row 2', async () => {
  const srt = '1\n00:00:00,500 --> 00:00:03,500\nShe found the\ndocuments today\n';
  const meta = await Job.renderOverlay(Object.assign({}, base, { srtText: srt, outputDir: path.join(tmp, 'two'), baseName: 'two', fps: { num: 30, den: 1 }, twoRows: true,
    style: Object.assign({}, base.style, { fontSize: 44, outline: 0 }) }));
  const video = decode(meta.output), mid = H / 2, byRow = f => {                 // highlight and white pixel counts in the upper / lower half
    const o = { hlTop: 0, hlBot: 0, whiteTop: 0, whiteBot: 0 };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (f * W * H + y * W + x) * 4, p = [video.raw[i], video.raw[i + 1], video.raw[i + 2], video.raw[i + 3]];
      if (near(p, HL, 40)) o[y < mid ? 'hlTop' : 'hlBot']++; else if (near(p, WHITE, 40)) o[y < mid ? 'whiteTop' : 'whiteBot']++;
    }
    return o;
  };
  const first = byRow(2), last = byRow(video.count - 3);
  assert.ok(first.whiteTop > 100 && first.whiteBot > 100, 'both rows must be visible from the start: ' + JSON.stringify(first));
  assert.ok(first.hlTop > 20 && first.hlBot === 0, 'first word highlights row 1 only: ' + JSON.stringify(first));
  assert.ok(last.hlBot > 20 && last.hlTop === 0, 'last word highlights row 2 only: ' + JSON.stringify(last));
});

test('background: a cue with only invisible characters does not fail the batch and gets no box', async () => {
  const srt = '1\n00:00:00,500 --> 00:00:01,500\n​\n\n2\n00:00:02,000 --> 00:00:03,000\nVisible words here\n';
  const logs = [];
  const meta = await Job.renderOverlay(Object.assign({}, base, { srtText: srt, outputDir: path.join(tmp, 'zw'), baseName: 'zw', fps: { num: 30, den: 1 }, onLog: t => logs.push(t),
    style: Object.assign({}, base.style, { bgEnabled: true, bgColor: '#0000FF', bgOpacity: 50, bgPadX: 20, bgPadY: 10, bgRadius: 8 }) }));
  const video = decode(meta.output);
  const covered = f => { let n = 0; const fr = video.frame(f); for (let i = 3; i < fr.length; i += 4) if (fr[i] > 0) n++; return n; };
  assert.equal(covered(5), 0, 'invisible cue must draw nothing');
  assert.ok(covered(Math.round(2.3 * 30) - Math.round(0.5 * 30)) > 3000, 'the visible cue keeps its box');
  assert.ok(logs.some(l => /không có chữ nhìn thấy/.test(l)));
});

test('two rows: a line wider than the canvas is broken into two rows that both fit; highlight still crosses both', async () => {
  const srt = '1\n00:00:00,500 --> 00:00:04,500\nShe found the hidden documents under the old wooden bridge yesterday morning\n';
  const logs = [];
  const meta = await Job.renderOverlay(Object.assign({}, base, { srtText: srt, outputDir: path.join(tmp, 'wrap'), baseName: 'wrap', fps: { num: 30, den: 1 }, twoRows: true, onLog: t => logs.push(t),
    style: Object.assign({}, base.style, { fontSize: 64, outline: 0, bgEnabled: true, bgColor: '#0000FF', bgOpacity: 50, bgPadX: 24, bgPadY: 10, bgRadius: 10 }) }));
  assert.ok(logs.some(l => /tự ngắt 1 cue/.test(l)), logs.join('\n'));
  assert.ok(!logs.some(l => /quá dài cho 2 dòng/.test(l)));
  const video = decode(meta.output), F = 6;
  let l = W, r = -1, upper = 0, lower = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = video.frame(F)[(y * W + x) * 4 + 3]; if (a >= 250) { l = Math.min(l, x); r = Math.max(r, x); if (y < H / 2) upper++; else lower++; } }
  assert.ok(l >= 0 + 20 && r <= W - 20, 'text leaves the canvas: ' + l + '..' + r);
  assert.ok(upper > 200 && lower > 200, 'two rows expected: ' + upper + '/' + lower);
});

test('ProRes quality presets: lighter presets give smaller files, the same frame count and still decode', async () => {
  const sizes = {}, frames = {};
  for (const quality of ['high', 'balanced', 'light']) {
    const meta = await Job.renderOverlay(Object.assign({}, base, { outputDir: path.join(tmp, 'q' + quality), baseName: 'q', fps: { num: 30, den: 1 }, quality,
      style: Object.assign({}, base.style, { bgEnabled: true, bgColor: '#0000FF', bgOpacity: 50, bgPadX: 20, bgPadY: 10, bgRadius: 8 }) }));
    sizes[quality] = fs.statSync(meta.output).size; frames[quality] = decode(meta.output).count;
  }
  assert.ok(sizes.balanced < sizes.high * 0.85 && sizes.light < sizes.balanced, JSON.stringify(sizes));
  assert.equal(frames.high, frames.balanced); assert.equal(frames.high, frames.light);
});

test('balanced and light presets keep 16-bit alpha; png codec renders the same frame count with straight alpha', async () => {
  for (const quality of ['balanced', 'light']) {
    await Job.renderOverlay(Object.assign({}, base, { outputDir: path.join(tmp, 'a16' + quality), baseName: 'a', fps: { num: 30, den: 1 }, quality, keepWork: true }));
    const root = path.join(os.tmpdir(), 'KaraokeOverlay'), newest = fs.readdirSync(root).map(d => path.join(root, d)).sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs)[0];
    const args = JSON.parse(fs.readFileSync(path.join(newest, 'ffmpeg_args.json'), 'utf8'));
    fs.rmSync(newest, { recursive: true, force: true });
    assert.equal(args[args.indexOf('-alpha_bits') + 1], '16');
  }
  const ref = await Job.renderOverlay(Object.assign({}, base, { outputDir: path.join(tmp, 'pref'), baseName: 'r', fps: { num: 30, den: 1 } }));
  const png = await Job.renderOverlay(Object.assign({}, base, { outputDir: path.join(tmp, 'ppng'), baseName: 'p', fps: { num: 30, den: 1 }, codec: 'png' }));
  const a = decode(ref.output), b = decode(png.output);
  assert.equal(b.count, a.count);
  const f = Math.round(1.5 * 30);
  assert.ok(near(b.at(f, 0, 0), [0, 0, 0], 0) === false && b.at(f, 0, 0)[3] === 0, 'corner stays transparent');
  assert.ok(analyse(b.frame(f)).hl > 20, 'highlight visible in the png render');
});
