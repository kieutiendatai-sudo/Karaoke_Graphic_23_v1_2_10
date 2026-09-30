/* Karaoke Overlay panel (CEP, Premiere Pro 23). Needs Node (manifest: --enable-nodejs --mixed-context)
   to run ffmpeg. Without Node it does nothing and says so. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var hasNode = typeof require === 'function' && typeof process !== 'undefined';
  var Job = null, fs = null, path = null, Plan = null, Core = null, FontScan = null, FontInfo = null, Files = null, lastMetaSrt = null;
  var logs = [], lastMeta = null, cancels = [], stopAll = false, seqInfo = null;
  var DEFAULTS = { ffmpegDir: '', srtPath: '', outputDir: '', fontFile: '', fontSize: 56, bold: false, align: 'center',
    textColor: '#FFFFFF', highlightColor: '#F7D114', outlineColor: '#000000', outline: 2, shadow: 0, bgEnabled: false, bgColor: '#000000', bgOpacity: 60, bgPadX: 24, bgPadY: 12, bgRadius: 16, twoRows: false, lineSpacing: 85, anchorX: 50, yPercent: 85,
    canvasHeight: 0, fps: 'auto', width: 0, offset: 0, codec: 'prores4444', previewStart: 0, previewLength: 4,
    parallel: 2, insertTrack: 2, insertOffset: 0, insertIntoTimeline: true };
  var FIELDS = Object.keys(DEFAULTS), COLORS = ['textColor', 'highlightColor', 'outlineColor', 'bgColor'];

  function extensionRoot() {
    var p = decodeURIComponent(window.__adobe_cep__.getSystemPath('extension')).replace(/^file:\/\//, '');
    return /^\/[A-Za-z]:/.test(p) ? p.slice(1) : p;
  }
  function log(text) {
    logs.push(new Date().toLocaleTimeString() + ' ' + text);
    $('log').textContent = logs.slice(-300).join('\n'); $('log').scrollTop = $('log').scrollHeight;
  }
  function load() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem('kg.overlay.settings') || '{}'); } catch (e) { /* defaults */ }
    FIELDS.forEach(function (k) {
      var el = $(k), v = saved[k] !== undefined ? saved[k] : DEFAULTS[k];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
  }
  function swatches() {
    Array.prototype.forEach.call(document.querySelectorAll('.sw'), function (sw) {
      var hex = Files ? Files.normalizeHex($(sw.getAttribute('data-for')).value) : null;
      sw.style.background = hex || 'transparent'; sw.title = hex || 'Mã hex không hợp lệ';
    });
  }
  function read() {
    var s = {};
    FIELDS.forEach(function (k) {
      var el = $(k);
      s[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? NaN : Number(el.value)) : el.value.trim();
    });
    return s;
  }
  function save() { try { localStorage.setItem('kg.overlay.settings', JSON.stringify(read())); } catch (e) { /* ignore */ } }
  function busy(v) {
    Array.prototype.forEach.call(document.querySelectorAll('button'), function (b) { b.disabled = v; });
    $('stop').disabled = !v;
  }
  function rpc(fn, arg) {
    return new Promise(function (resolve, reject) {
      if (!window.__adobe_cep__) return reject(new Error('Mở panel trong Premiere để thao tác timeline.'));
      var call = 'KGO.' + fn + '(' + (arg === undefined ? '' : JSON.stringify(encodeURIComponent(JSON.stringify(arg)))) + ')';
      window.__adobe_cep__.evalScript('(typeof KGO!=="undefined")?' + call + ':\'{"ok":false,"error":"Host chưa nạp; đóng và mở lại panel."}\'', function (raw) {
        try { var r = JSON.parse(raw); if (!r.ok) throw new Error(r.error); resolve(r.value); }
        catch (e) { reject(new Error(raw === 'EvalScript error.' ? 'Premiere không chạy được lệnh ' + fn : e.message)); }
      });
    });
  }
  function guard(fn) {
    return function () {
      save(); busy(true); $('progress').value = 0;
      Promise.resolve().then(fn).catch(function (e) { log((e && e.cancelled ? 'Đã dừng: ' : 'LỖI: ') + (e && e.message || e)); })
        .then(function () { cancels = []; busy(false); });
    };
  }
  function sequenceInfo() {
    return rpc('info').then(function (info) { seqInfo = info; return info; });
  }
  function resolveFrame(s) {
    // frame rate, width and canvas height from the form, or from the active sequence
    var needSeq = s.fps === 'auto' || !(s.width > 0);
    return (needSeq ? sequenceInfo() : Promise.resolve(seqInfo || { width: s.width, height: 720 })).then(function (info) {
      var fps = s.fps === 'auto' ? Plan.fpsFromTicks(info.timebase) : Plan.fpsFromPreset(s.fps);
      var width = s.width > 0 ? s.width : info.width, seqHeight = (info && info.height) || 720;
      var height = s.canvasHeight > 0 ? s.canvasHeight : Math.round(seqHeight * (s.twoRows ? 0.36 : 0.25) / 2) * 2;
      if (s.yPercent / 100 * seqHeight + height / 2 > seqHeight + 1) log('Cảnh báo: dải phụ đề vượt mép dưới khung hình ở Y=' + s.yPercent + '%.');
      return { fps: fps, width: width, height: height, seqHeight: seqHeight };
    });
  }
  function warnWidths(s, srtText, frame) {
    try {
      var font = new FontFace('KGOverlayFont', 'url("file:///' + s.fontFile.replace(/\\/g, '/').replace(/^\//, '') + '")');
      return font.load().then(function () {
        document.fonts.add(font);
        var ctx = document.createElement('canvas').getContext('2d');
        ctx.font = (s.bold ? 'bold ' : '') + s.fontSize + 'px KGOverlayFont';
        var wide = Core.parseSRT(srtText).filter(function (c) {
          return (s.twoRows && c.lines.length > 1 ? c.lines : [c.text]).some(function (row) { return ctx.measureText(row).width > frame.width * 0.98; });   // two-row mode: each row must fit, not the merged text
        });
        if (wide.length) log('Cảnh báo: ' + wide.length + ' cue có thể rộng hơn khung (' + frame.width + ' px), ví dụ cue ' + wide[0].id + '. Giảm cỡ chữ hoặc chia cue.');
      }).catch(function () { /* estimate only */ });
    } catch (e) { return Promise.resolve(); }
  }
  function listSrts() {
    var r = Files.expandSrtInputs(fs, path, $('srtPath').value);
    r.errors.forEach(function (e) { log('Cảnh báo: ' + e); });
    return r.files;
  }
  function refreshImportList() {
    if (!Files) return;
    var sel = $('importSrt'), keep = sel.value, files = Files.expandSrtInputs(fs, path, $('srtPath').value).files;
    sel.innerHTML = '';
    files.forEach(function (f) { var o = document.createElement('option'); o.value = f; o.textContent = path.basename(f); sel.appendChild(o); });
    if (files.indexOf(keep) >= 0) sel.value = keep;
  }
  function outDirFor(s, srt) { return s.outputDir || path.dirname(srt); }
  function render(preview) {
    var s = read(), errors = [], files = listSrts();
    if (!files.length) errors.push('Chưa chọn SRT.');
    if (!s.fontFile) errors.push('Chưa chọn file font.');
    if (!(s.fontSize > 0)) errors.push('Cỡ chữ không hợp lệ.');
    COLORS.forEach(function (k) { if (k !== 'bgColor' || s.bgEnabled) { if (!Files.normalizeHex(s[k])) errors.push('Mã màu không hợp lệ (' + k + '): nhập dạng #RRGGBB.'); else s[k] = Files.normalizeHex(s[k]); } });
    if (errors.length) throw new Error(errors.join(' '));
    if (preview) files = files.slice(0, 1);
    var ffmpeg = Job.resolveFfmpeg(s.ffmpegDir, extensionRoot()), failed = [], done = 0;
    var workers = Math.max(1, Math.min(files.length, Math.floor(s.parallel) || 1)), progress = files.map(function () { return 0; }), stopped = null;
    stopAll = false; cancels = [];
    if (files.length > 1) log('Render ' + files.length + ' file SRT (' + workers + ' luồng song song)' + (s.outputDir ? ' vào ' + s.outputDir : ' (lưu cạnh từng file SRT)') + '.');
    return resolveFrame(s).then(function (frame) {
      function one(i) {
        var srt = files[i], tag = files.length > 1 ? '[' + (i + 1) + '/' + files.length + '] ' + path.basename(srt) + ': ' : '';
        return Promise.resolve().then(function () {
          var srtText = fs.readFileSync(srt, 'utf8'), token = Job.makeCancelToken();
          cancels.push(token);
          return warnWidths(s, srtText, frame).then(function () {
            return Job.renderOverlay({ ffmpeg: ffmpeg, srtText: srtText, outputDir: outDirFor(s, srt), baseName: path.basename(srt).replace(/\.[^.]+$/, ''),
              fps: frame.fps, width: frame.width, height: frame.height, offset: s.offset, codec: s.codec, cancel: token, twoRows: s.twoRows,
              window: preview ? { startSeconds: s.previewStart, lengthSeconds: s.previewLength } : null, force: false,
              style: { fontFile: s.fontFile, fontSize: s.fontSize, bold: s.bold, align: s.align, textColor: s.textColor, highlightColor: s.highlightColor,
                outlineColor: s.outlineColor, outline: s.outline, shadow: s.shadow, bgEnabled: s.bgEnabled, bgColor: s.bgColor, bgOpacity: s.bgOpacity, bgPadX: s.bgPadX, bgPadY: s.bgPadY, bgRadius: s.bgRadius, lineSpacing: s.lineSpacing, anchorX: s.anchorX, yPercent: s.yPercent },
              onLog: function (t) { log(tag + t); },
              onProgress: function (p) { progress[i] = p; $('progress').value = progress.reduce(function (a, b) { return a + b; }, 0) / files.length; } });
          });
        }).then(function (meta) {
          progress[i] = 1; lastMeta = meta; lastMetaSrt = srt; done++;
          log(tag + (meta.skipped ? 'Đã có sẵn: ' : preview ? 'Xem thử xong: ' : 'Render xong: ') + meta.output);
          log(tag + meta.canvas.w + 'x' + meta.canvas.h + ' · ' + meta.words + ' từ · bắt đầu ' + meta.startSeconds.toFixed(3) + ' s · dài ' + meta.durationSeconds.toFixed(2) + ' s');
        }, function (e) {
          if (e && e.cancelled) { stopped = e; return; }
          failed.push(path.basename(srt)); log(tag + 'LỖI: ' + (e && e.message || e));
        });
      }
      return Files.runPool(files.length, workers, one, function () { return stopped || stopAll; }).then(function () { if (stopped || stopAll) throw stopped || { cancelled: true, message: 'đã dừng lô render.' }; });
    }).then(function () {
      if (files.length > 1) log('Xong lô: ' + done + '/' + files.length + ' file' + (failed.length ? '; lỗi: ' + failed.join(', ') : '') + '.');
      if (failed.length && !done) throw new Error('Tất cả file đều lỗi.');
    });
  }
  function importResult() {
    var s = read(), meta = null, srt = $('importSrt').value;
    if (srt && lastMeta && lastMetaSrt === srt) meta = lastMeta;
    else if (srt) {
      var sidecar = path.join(outDirFor(s, srt), path.basename(srt).replace(/\.[^.]+$/, '') + '_karaoke.json');
      if (fs.existsSync(sidecar)) meta = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    }
    if (!meta) return Promise.reject(new Error('Chưa có kết quả. Bấm "Render overlay" trước.'));
    var start = meta.startSeconds + (s.insertOffset || 0);
    log('Nhập vào Premiere: ' + meta.output + (s.insertIntoTimeline ? ' → V' + s.insertTrack + ' tại ' + start.toFixed(3) + ' s' : ' (chỉ Project)'));
    return rpc('importOverlay', { file: meta.output, startSeconds: start, trackIndex: s.insertTrack - 1, position: meta.premiere.position,
      scale: meta.premiere.scale, insert: !!s.insertIntoTimeline }).then(function (r) {
      log('Xong. Đã nhập: ' + r.projectItem + (r.inserted ? '; đã chèn clip tại ' + r.start.toFixed(3) + ' s.' : '.'));
    });
  }
  function pick(id, kind, ext) {
    var f = window.cep && window.cep.fs; if (!f) return;
    var r = kind === 'dir' ? f.showOpenDialogEx(false, true, 'Chọn thư mục', '', []) : f.showOpenDialogEx(false, false, 'Chọn file', '', ext ? [ext] : []);
    if (r.err === 0 && r.data && r.data.length) { $(id).value = r.data[0]; save(); }
  }

  Array.prototype.forEach.call(document.querySelectorAll('button[data-pick]'), function (b) {
    b.addEventListener('click', function () { pick(b.getAttribute('data-pick'), b.getAttribute('data-kind'), b.getAttribute('data-ext')); });
  });
  FIELDS.forEach(function (k) { $(k).addEventListener('change', save); });
  COLORS.forEach(function (k) {
    $(k).addEventListener('input', swatches);
    $(k).addEventListener('change', function () { var h = Files && Files.normalizeHex($(k).value); if (h) $(k).value = h; swatches(); save(); });
  });
  $('srtPath').addEventListener('change', refreshImportList);
  load();
  if (hasNode) {
    try {
      fs = require('fs'); path = require('path');
      var root = extensionRoot();
      Job = require(path.join(root, 'js', 'overlay', 'overlay-job.js'));
      Plan = require(path.join(root, 'js', 'overlay', 'overlay-plan.js'));
      Core = require(path.join(root, 'js', 'core.js'));
      Files = require(path.join(root, 'js', 'overlay', 'overlay-files.js'));
      FontScan = require(path.join(root, 'js', 'overlay', 'font-scan.js'));
      FontInfo = require(path.join(root, 'js', 'overlay', 'font-info.js'));
    } catch (e) { hasNode = false; log('Không nạp được mô-đun: ' + e.message); }
  }
  $('env').className = 'notice' + (hasNode ? ' ok' : '');
  $('env').textContent = hasNode ? 'Node.js sẵn sàng: panel tự chạy FFmpeg.' : 'Node.js KHÔNG khả dụng trong panel này: không thể chạy FFmpeg. Kiểm tra manifest (--enable-nodejs --mixed-context).';
  swatches(); refreshImportList();
  busy(false); $('stop').disabled = true;
  if (!hasNode) { busy(true); $('stop').disabled = true; return; }
  $('checkFfmpeg').addEventListener('click', guard(function () {
    var ffmpeg = Job.resolveFfmpeg(read().ffmpegDir, extensionRoot());
    return Job.checkFfmpeg(ffmpeg).then(function (r) {
      log('FFmpeg: ' + ffmpeg + ' — ' + r.version);
      log(r.ok ? 'Đủ bộ lọc/encoder cần thiết (libass, alphamerge, unpremultiply, prores_ks).' : 'THIẾU: ' + r.missing.join(', '));
    });
  }));
  function scanSystemFonts() {
    var sel = $('systemFont'), t = Date.now();
    var list = FontScan.scanFonts({ fs: fs, path: path, readFontInfo: FontInfo.readFontInfo, platform: process.platform, env: process.env, home: process.env.HOME || process.env.USERPROFILE });
    sel.innerHTML = '<option value="">— chọn font (' + list.length + ') —</option>';
    list.forEach(function (f) {
      var o = document.createElement('option'); o.value = f.file; o.textContent = f.family + (f.style && f.style !== 'Regular' ? ' — ' + f.style : ''); sel.appendChild(o);
    });
    var cur = $('fontFile').value; if (cur) sel.value = cur;
    log('Đã quét ' + list.length + ' font hệ thống (' + (Date.now() - t) + ' ms).');
  }
  $('scanFonts').addEventListener('click', function () { try { scanSystemFonts(); } catch (e) { log('LỖI quét font: ' + e.message); } });
  $('systemFont').addEventListener('change', function () { if (this.value) { $('fontFile').value = this.value; save(); } });
  function appendSrt(paths) {
    var box = $('srtPath'), cur = box.value.trim();
    box.value = (cur ? cur + '\n' : '') + paths.join('\n'); save(); refreshImportList();
  }
  $('addSrtFiles').addEventListener('click', function () {
    var f = window.cep && window.cep.fs; if (!f) return;
    var r = f.showOpenDialogEx(true, false, 'Chọn các file SRT', '', ['srt']);
    if (r.err === 0 && r.data && r.data.length) appendSrt(r.data);
  });
  $('addSrtDir').addEventListener('click', function () {
    var f = window.cep && window.cep.fs; if (!f) return;
    var r = f.showOpenDialogEx(false, true, 'Chọn thư mục chứa SRT', '', []);
    if (r.err === 0 && r.data && r.data.length) appendSrt(r.data);
  });
  $('preview').addEventListener('click', guard(function () { return render(true); }));
  $('render').addEventListener('click', guard(function () { return render(false); }));
  $('import').addEventListener('click', guard(importResult));
  $('stop').addEventListener('click', function () { stopAll = true;
    if (cancels.length) { cancels.forEach(function (t) { t.cancel(); }); log('Đã gửi lệnh dừng.'); } });
  $('openFolder').addEventListener('click', function () {
    var s = read(); if (!s.outputDir) return log('Chưa chọn thư mục kết quả.');
    require('child_process').spawn(process.platform === 'win32' ? 'explorer' : 'open', [s.outputDir], { detached: true, stdio: 'ignore' }).unref();
  });
  log('Sẵn sàng. ' + (window.__adobe_cep__ ? 'Premiere đã kết nối.' : 'Premiere chưa kết nối (đang xem giao diện).'));
}());
