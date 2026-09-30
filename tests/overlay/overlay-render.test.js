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

test('whole-word instant change: one word highlighted per frame, switching exactly at each word start frame', async () => {
  const { meta, video } = await renderDefault();
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
