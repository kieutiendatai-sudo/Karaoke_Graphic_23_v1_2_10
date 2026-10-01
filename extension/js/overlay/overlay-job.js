/* Node side of the overlay panel: find/check ffmpeg, run it as an external process, publish the MOV.
   Never touches the source video and never runs through a shell. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), crypto = require('crypto');
const Core = require('../core.js'), Plan = require('./overlay-plan.js'), Ass = require('./ass-writer.js'),
  Args = require('./ffmpeg-args.js'), Font = require('./font-info.js'), Measure = require('./overlay-measure.js'), Wrap = require('./overlay-wrap.js');

const VERSION = 2;
const exe = process.platform === 'win32' ? '.exe' : '';

function resolveFfmpeg(dir, extensionRoot) {
  const candidates = [];
  if (dir) candidates.push(path.join(dir, 'ffmpeg' + exe), path.join(dir, 'bin', 'ffmpeg' + exe));
  if (extensionRoot) candidates.push(path.join(extensionRoot, 'bin', 'ffmpeg' + exe));
  for (const c of candidates) if (fs.existsSync(c)) return c;
  if (dir) throw new Error('Thư mục FFmpeg đã chọn không có ffmpeg' + exe + '.');
  const found = (process.env.PATH || '').split(path.delimiter).map(p => path.join(p, 'ffmpeg' + exe)).find(p => fs.existsSync(p));
  if (!found) throw new Error('Không tìm thấy ffmpeg. Chọn thư mục chứa ffmpeg' + exe + ' hoặc thêm vào PATH.');
  return found;
}

function makeCancelToken() {
  // SIGTERM first; some FFmpeg builds keep running a long filter graph, so force-kill after 2 s.
  const token = { cancelled: false, child: null, cancel() {
    token.cancelled = true;
    const child = token.child;
    if (!child) return;
    try { child.kill(); } catch (e) { /* already gone */ }
    const force = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* already gone */ } }, 2000);
    child.on('close', () => clearTimeout(force));
  } };
  return token;
}

/* Runs ffmpeg; resolves with {stdout, stderr}. onProgress(seconds) comes from -progress lines. */
function run(ffmpeg, args, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    if (opts.cancel && opts.cancel.cancelled) return reject(Object.assign(new Error('Đã dừng theo yêu cầu.'), { cancelled: true }));
    const child = cp.spawn(ffmpeg, args, { cwd: opts.cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    if (opts.cancel) opts.cancel.child = child;
    let out = '', err = '', pending = '';
    child.stdout.on('data', chunk => {
      if (opts.onStdout) return opts.onStdout(chunk);
      out += chunk; pending += chunk;
      const lines = pending.split(/\r?\n/); pending = lines.pop();
      lines.forEach(line => {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && opts.onProgress) opts.onProgress(Number(m[1]) / 1e6);
      });
      if (out.length > 200000) out = out.slice(-100000);
    });
    child.stderr.on('data', chunk => { err += chunk; if (err.length > 200000) err = err.slice(-100000); });
    child.on('error', e => reject(new Error('Không chạy được ffmpeg: ' + e.message)));
    child.on('close', code => {
      if (opts.cancel) opts.cancel.child = null;
      if (opts.cancel && opts.cancel.cancelled) return reject(Object.assign(new Error('Đã dừng theo yêu cầu.'), { cancelled: true }));
      if (code !== 0) {
        const tail = err.trim().split(/\r?\n/).slice(-30).join('\n');
        return reject(Object.assign(new Error('FFmpeg lỗi (mã ' + code + '):\n' + tail), { tail, code }));
      }
      resolve({ stdout: out, stderr: err });
    });
  });
}

/* Verifies the build has what the overlay needs (libass, alphamerge, unpremultiply, ProRes encoder). */
async function checkFfmpeg(ffmpeg) {
  const filters = (await run(ffmpeg, ['-hide_banner', '-filters'])).stdout;
  const encoders = (await run(ffmpeg, ['-hide_banner', '-encoders'])).stdout;
  const missing = [];
  Args.REQUIRED_FILTERS.forEach(f => { if (!new RegExp('\\s' + f + '\\s').test(filters)) missing.push('bộ lọc ' + f + (f === 'ass' ? ' (cần bản FFmpeg có libass)' : '')); });
  Args.REQUIRED_ENCODERS.forEach(e => { if (!new RegExp('\\s' + e + '\\s').test(encoders)) missing.push('encoder ' + e); });
  const version = ((await run(ffmpeg, ['-hide_banner', '-version'])).stdout.split(/\r?\n/)[0] || '').trim();
  return { ok: missing.length === 0, missing, version };
}

function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

/* opts: {ffmpeg, srtText, outputDir, baseName, fps:{num,den}, width, height, style, offset,
          window:{startSeconds,lengthSeconds}, codec, alphaBits, force, keepWork, onProgress, onLog, cancel} */
async function renderOverlay(opts) {
  const log = opts.onLog || (() => {});
  const timings = {}; let lapAt = Date.now();
  const lap = name => { const n = Date.now(); timings[name] = Math.round((n - lapAt) / 100) / 10; lapAt = n; };     // seconds per stage, reported in the log and the .json
  const style = Object.assign({ textColor: '#FFFFFF', highlightColor: '#F7D114', outlineColor: '#000000', outline: 0, shadow: 0,
    bold: false, align: 'center', anchorX: 50, yPercent: 85 }, opts.style);
  if (!style.fontFile) throw new Error('Chưa chọn file font (.ttf/.otf).');
  if (!fs.existsSync(style.fontFile)) throw new Error('Không tìm thấy file font: ' + style.fontFile);
  const fontBytes = fs.readFileSync(style.fontFile);
  const font = Font.readFontInfo(fontBytes);
  const cues = Core.parseSRT(opts.srtText);
  const preview = !!opts.window;
  const makePlan = () => {           // rows never change the timing, so this can be rebuilt after the rows are wrapped
    const p = Plan.buildPlan(cues, { fps: opts.fps, offset: opts.offset, twoRows: !!opts.twoRows });
    return preview ? Plan.clipPlan(p, Math.round(opts.window.startSeconds * opts.fps.num / opts.fps.den),
      Math.max(1, Math.round(opts.window.lengthSeconds * opts.fps.num / opts.fps.den))) : p;
  };
  let plan = makePlan();
  const assStyle = Object.assign({}, style, { fontFamily: font.family, fontSize: style.fontSize, bold: !!style.bold && !font.bold,
    width: opts.width, height: opts.height });
  // ProRes 4444 quality presets: a coarser quantiser (and 8-bit alpha) shrinks the file a lot; flat subtitle graphics tolerate it.
  const QUALITY = { high: { qscale: 2, alphaBits: 16 }, balanced: { qscale: 10, alphaBits: 8 }, light: { qscale: 20, alphaBits: 8 } };
  const codec = opts.codec || 'prores4444', q = QUALITY[opts.quality || 'high'] || QUALITY.high, qscale = q.qscale, alphaBits = opts.alphaBits || q.alphaBits;
  const identity = sha(JSON.stringify({ v: VERSION, codec, alphaBits, qscale: codec === 'qtrle' ? 0 : qscale, fps: opts.fps, w: opts.width, h: opts.height, style: assStyle,
    font: sha(fontBytes), wrap: opts.twoRows ? Wrap.widthLimit(assStyle) : 0, first: plan.firstFrame, events: plan.events.map(e => [e.startFrame, e.endFrame, e.rows || e.line, e.row || 0, e.startChar, e.endChar]) }));

  fs.mkdirSync(opts.outputDir, { recursive: true });
  const name = opts.baseName + '_karaoke' + (preview ? '_preview' : '');
  const output = path.join(opts.outputDir, name + '.mov'), sidecar = path.join(opts.outputDir, name + '.json');
  if (!opts.force && !preview && fs.existsSync(output) && fs.existsSync(sidecar)) {
    try {
      const meta = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
      if (meta.identity === identity) { log('Bỏ qua ' + name + '.mov: đầu ra cùng cấu hình đã có.'); return Object.assign(meta, { skipped: true }); }
    } catch (e) { /* re-render */ }
  }

  lap('chuan_bi');
  const work = path.join(os.tmpdir(), 'KaraokeOverlay', sha(output + Date.now() + Math.random()).slice(0, 12));
  fs.mkdirSync(path.join(work, 'fonts'), { recursive: true });
  const partial = name + '.partial.mov', partialPath = path.join(opts.outputDir, partial);
  try {
    fs.copyFileSync(style.fontFile, path.join(work, 'fonts', path.basename(style.fontFile)));
    // Measures rows with libass (one frame per row); results are kept for the whole render.
    const rel = {}; let ref = null;
    const measureRows = async strings => {
      const missing = Array.from(new Set(strings)).filter(r => rel[r] === undefined);
      for (let i = 0; i < missing.length || (i === 0 && !ref); i += 2000) {
        const part = missing.slice(i, i + 2000), m = Measure.buildMeasureAss(part, assStyle), grab = Measure.frameBoxes(opts.width, opts.height);
        fs.writeFileSync(path.join(work, 'measure.ass'), m.text, 'utf8');
        await run(opts.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=' + opts.width + 'x' + opts.height + ':r=1:d=' + m.frames,
          '-vf', "ass=filename='measure.ass':fontsdir='fonts':shaping=simple,format=gray", '-frames:v', String(m.frames), '-f', 'rawvideo', '-'],
          { cwd: work, cancel: opts.cancel, onStdout: c => grab.push(c) });
        const r = Measure.toRelative(part, grab.boxes, m);
        Object.assign(rel, r.rel); ref = ref || r.ref;
      }
    };
    if (opts.twoRows) {
      const limit = Wrap.widthLimit(assStyle);
      log('Kiểm tra độ rộng dòng chữ (giới hạn ' + limit + ' px)…');
      const wrapResult = await Wrap.wrapCues(cues, async strings => {
        await measureRows(strings);
        const w = {}; strings.forEach(x => { w[x] = rel[x] ? rel[x].r - rel[x].l : 0; });
        return w;
      }, limit);
      cues.forEach(c => { c.lines = wrapResult.rows[c.id]; });
      plan = makePlan();
      if (wrapResult.wrapped) log('Đã tự ngắt ' + wrapResult.wrapped + ' cue thành 2 dòng.');
      if (wrapResult.overflow.length) log('Cảnh báo: ' + wrapResult.overflow.length + ' cue quá dài cho 2 dòng (ví dụ cue ' + wrapResult.overflow[0] + '); chữ sẽ vượt khung. Giảm cỡ chữ hoặc chia cue trong SRT.');
    }
    let boxes = null;
    if (assStyle.bgEnabled) {
      const rows = Array.from(new Set([].concat(...plan.events.map(e => e.rows || [e.line]))));
      log('Đo ' + rows.length + ' dòng chữ để vẽ nền…');
      await measureRows(rows);
      const only = {}; rows.forEach(r => { only[r] = rel[r]; });
      boxes = { rel: only, ref, blank: rows.filter(r => !rel[r]) };
      if (boxes.blank.length) log('Bỏ qua nền của ' + boxes.blank.length + ' dòng không có chữ nhìn thấy (ký tự vô hình).');
    }
    lap('do_chu');
    const stats = {};
    fs.writeFileSync(path.join(work, 'karaoke.ass'), Ass.buildAss(plan, assStyle, { boxes, stats }), 'utf8');
    fs.writeFileSync(path.join(work, 'matte.ass'), Ass.buildAss(plan, assStyle, { matte: true, boxes }), 'utf8');
    if (stats.clippedBoxes) log('Cảnh báo: ' + stats.clippedBoxes + ' nền vượt khung ' + opts.width + 'x' + opts.height + ' (tăng "Cao dải phụ đề" hoặc giảm cỡ chữ/đệm).');
    try { fs.unlinkSync(partialPath); } catch (e) { /* none */ }
    // one still frame per segment instead of every output frame (the text only changes at word/cue boundaries)
    await run(opts.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=' + opts.width + 'x' + opts.height, '-frames:v', '1', '-c:v', 'rawvideo', '-pix_fmt', 'yuv420p', '-enc_time_base', '1:1000000', '-f', 'nut', 'black.nut'], { cwd: work, cancel: opts.cancel });
    fs.writeFileSync(path.join(work, 'segments.txt'), Args.segmentList(plan, 'black.nut'), 'utf8');
    const args = Args.overlayArgs({ fps: opts.fps, width: opts.width, height: opts.height, durationSeconds: plan.durationSeconds, codec, alphaBits, qscale, output: partialPath,
      segments: plan.frames });
    fs.writeFileSync(path.join(work, 'ffmpeg_args.json'), JSON.stringify(args, null, 1));
    log('Render overlay ' + opts.width + 'x' + opts.height + ', ' + plan.durationSeconds.toFixed(2) + 's, ' + plan.words + ' từ, ' + codec + '.');
    plan.warnings.slice(0, 3).forEach(w => log('Cảnh báo: ' + w));
    if (plan.warnings.length > 3) log('Cảnh báo: còn ' + (plan.warnings.length - 3) + ' cảnh báo tương tự (xem file .json).');
    lap('tao_ass');
    await run(opts.ffmpeg, args, { cwd: work, cancel: opts.cancel,
      onProgress: s => opts.onProgress && opts.onProgress(Math.min(0.999, s / plan.durationSeconds)) });
    if (!fs.existsSync(partialPath) || fs.statSync(partialPath).size === 0) throw new Error('FFmpeg không tạo được file đầu ra.');
    lap('ffmpeg_render');
    // Full decoding of a multi-GB ProRes file costs as much as a third of the render. Read every packet (container integrity + duration) and
    // decode short samples at the start, middle and end instead; opts.fullVerify restores the complete decode (always used for qtrle, which decodes in a few seconds).
    if (opts.fullVerify || codec === 'qtrle') await run(opts.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', partialPath, '-f', 'null', '-'], { cancel: opts.cancel });
    else {
      let seen = 0;
      await run(opts.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', partialPath, '-map', '0:v:0', '-c', 'copy', '-progress', 'pipe:1', '-f', 'null', '-'],
        { cancel: opts.cancel, onProgress: sec => { seen = sec; } });
      if (seen < plan.durationSeconds - 0.25) throw new Error('File overlay bị thiếu đoạn cuối (' + seen.toFixed(2) + ' s / ' + plan.durationSeconds.toFixed(2) + ' s).');
      const sample = Math.min(1.5, plan.durationSeconds);
      for (const at of [0, Math.max(0, plan.durationSeconds / 2 - sample / 2), Math.max(0, plan.durationSeconds - sample - 0.1)])
        await run(opts.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-ss', at.toFixed(3), '-i', partialPath, '-t', sample.toFixed(3), '-map', '0:v:0', '-f', 'null', '-'], { cancel: opts.cancel });
    }
    lap('kiem_tra_file');
    fs.renameSync(partialPath, output);
  } catch (e) {
    try { fs.unlinkSync(partialPath); } catch (x) { /* none */ }
    throw e;
  } finally {
    if (!opts.keepWork) fs.rmSync(work, { recursive: true, force: true });
  }
  const meta = { version: VERSION, mode: 'overlay', identity, output, codec, fps: opts.fps, frames: plan.frames,
    canvas: { w: opts.width, h: opts.height }, startFrame: plan.firstFrame, startSeconds: plan.startSeconds, durationSeconds: plan.durationSeconds,
    words: plan.words, cues: plan.cues, preview, font: font.family, warnings: plan.warnings, timings,
    premiere: { position: [0.5, style.yPercent / 100], scale: 100 } };
  log('Thời gian (giây): ' + Object.keys(timings).map(k => k + ' ' + timings[k]).join(' · ') + ' · dung lượng ' + Math.round(fs.statSync(output).size / 1048576) + ' MB');
  fs.writeFileSync(sidecar, JSON.stringify(meta, null, 1));
  if (opts.onProgress) opts.onProgress(1);
  return meta;
}

module.exports = { resolveFfmpeg, checkFfmpeg, run, renderOverlay, makeCancelToken, VERSION };
