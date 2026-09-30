# Kế hoạch kiến trúc: Karaoke overlay render bằng FFmpeg (Premiere Pro 23, CEP)

Trạng thái: **đã triển khai bản đầu (xem `docs/OVERLAY_PANEL.md`); code cũ chưa bị xóa.** Phần còn lại của tài liệu là kế hoạch gốc.
Nhánh: `claude/kind-newton-ufw16i` (nhánh làm việc, không phải `main`).

```
SRT → word timing → ASS → FFmpeg/libass → overlay MOV có alpha → import 1 clip vào Premiere
```

Bản kế hoạch này dựa trên (1) khảo sát mã hiện tại và (2) một **thí nghiệm khả thi đã chạy thật** với
FFmpeg 7.0.2 (có libass, `prores_ks`, `alphamerge`, `unpremultiply`). Các kết quả đo nằm ở mục 3. Những gì
**chưa** kiểm chứng trong Premiere Pro 23 thật được đánh dấu **[CHƯA KIỂM CHỨNG]** và có "spike" tương ứng ở mục I.

---

## 1. Phát hiện quan trọng (đổi thiết kế so với ý tưởng ban đầu)

| # | Phát hiện | Bằng chứng | Hệ quả thiết kế |
|---|---|---|---|
| 1 | **Bộ lọc `ass` của FFmpeg không ghi kênh alpha.** Vẽ ASS lên nền `color=black@0` (rgba) cho RGB đúng nhưng alpha = 0 ở mọi điểm ảnh → overlay hoàn toàn trong suốt. | Thí nghiệm: `alpha-nonzero 0`, `rgb-nonzero 19899`. | Không thể "vẽ thẳng lên nền trong suốt". Phải **render hai lần** (màu trên nền đen + "matte" trắng) rồi `alphamerge`. |
| 2 | Màu đã vẽ trên nền đen là **premultiplied**; nếu để nguyên, viền chữ bị **tối** (halo đen) khi Premiere hiểu alpha là straight. | Điểm viền màu vàng: premultiplied ≈ (172,152,25,α179); sau `unpremultiply` ≈ (249,223,20,α133). | Bắt buộc `unpremultiply=inplace=1` sau `alphamerge`. |
| 3 | Phương pháp `\k` / `\kf` của ASS **không đáp ứng yêu cầu**: từ đã hát vẫn giữ màu highlight. | Ngữ nghĩa ASS (chỉ 2 trạng thái: secondary → primary). | Dùng **một Dialogue event cho mỗi từ**, cả dòng được vẽ, chỉ từ đang hoạt động có màu highlight. |
| 4 | Thời gian ASS chỉ có độ phân giải **centisecond**; 1 frame 30 fps = 33,33 ms không biểu diễn chính xác. | Tính toán. | Đổi frame → thời gian bằng **floor xuống centisecond** (chứng minh ở mục E) để không bao giờ lệch 1 frame. |
| 5 | Manifest hiện **không** bật Node (`CEFCommandLine` chỉ có `--disable-background-timer-throttling`), và `core.js` dùng UMD → khi bật Node `module` tồn tại nên `KGCore` toàn cục không được gán. | `extension/CSXS/manifest.xml`, `extension/js/core.js:2-5`. | Panel overlay mới nên là **extension riêng** trong cùng bundle, và `core.js` phải luôn gán `root.KGCore` khi có `window`. |

---

## 2. Kiến trúc đích (tóm tắt)

```
┌──────────────────────── CEP panel (Chromium + Node) ────────────────────────┐
│ SRT → core.parseSRT/timing (đã có, đã kiểm chứng)                            │
│   → overlay-plan  (frame gốc, số frame, từ, canvas, fps hữu tỉ)              │
│   → ass-writer    (ASS màu + ASS matte)                                      │
│   → ffmpeg-runner (spawn ffmpeg.exe, -progress, hủy, lỗi)  ──►  X_karaoke.mov│
│   → rpc('overlayImport'/'overlayInsert') ──► host.jsx (ExtendScript)         │
└────────────────────────────────────────────────────────────────────────────┘
host.jsx: sequenceInfo, importOverlay, insertOverlay  (đều vài lệnh DOM, không quét clip)
```

Premiere chỉ nhận **một** file/clip mỗi SRT. Không tạo Graphic theo cue, không keyframe theo từ.
FFmpeg chỉ vẽ **vùng phụ đề** (ví dụ 1280×180), không đọc và không mã hóa video gốc.

---

## 3. Kết quả thí nghiệm khả thi (FFmpeg 7.0.2 tĩnh, Linux — chỉ để kiểm chứng logic)

Font thử: DejaVu Serif Bold 56 px. Canvas 1280×180, 30 fps. Các con số phụ thuộc máy/font; chỉ dùng để định hướng.

| Kiểm tra | Kết quả |
|---|---|
| Có libass, `prores_ks`, `qtrle`, `alphamerge`, `unpremultiply` | Có |
| Overlay có alpha thật (2 lượt render + `alphamerge` + `unpremultiply`) | Đạt: alpha khác 0 chỉ ở vùng chữ; khung giữa 2 cue **hoàn toàn trong suốt** (frame 90–104) |
| **Chuyển màu theo cả từ, đúng frame** | Cue "She found the documents, and everything changed" (3 s): vùng highlight đổi tại frame **0, 10, 22, 32, 49, 59, 76** — trùng khớp từng frame với `KGCore.timing` (`startFrame` = 0,10,22,32,49,59,76) |
| Mỗi frame chỉ **một** vùng highlight liên tục, từ trước/sau giữ màu thường | Đạt (các vùng x không chồng nhau, tăng dần trái→phải) |
| Sai màu | Vàng (255,220,0) → (251,219,13) sau ProRes 10-bit: chấp nhận được |
| Halo đen ở viền | Có nếu bỏ `unpremultiply` (xem mục 1); không có nếu giữ |
| Tốc độ (1 lõi bận, 2 lượt libass) | ~140 frame/s cho clip ngắn |
| Kích thước ProRes 4444 (5,5 s, mật độ chữ cao) | alpha 16-bit: **11,0 MB**; alpha 8-bit: **10,0 MB**; alpha 8-bit + `-qscale:v 8`: **6,9 MB**; 5,5 s trong suốt hoàn toàn: **0,62 MB** |
| Codec thay thế | `qtrle` (Animation RGBA, lossless): **0,93 MB**; `png` trong MOV: **2,7 MB** |
| Ngoại suy 1 giờ (từ mẫu 5,5 s, cận trên) | ProRes 4444 alpha16 ≈ 7,2 GB; alpha8 ≈ 6,6 GB; qscale 8 ≈ 4,5 GB; qtrle ≈ 0,6 GB |
| Mô phỏng dài 20 phút, 462 cue, 4.157 event | 36.030 frame render trong **4 phút 12 giây** (≈143 frame/s, 4 lõi) → ngoại suy 1 giờ ≈ 12–13 phút; file **2,58 GB** (ProRes 4444, alpha 8-bit, cue phủ ~92% thời gian) → ≈ **7,7 GB/giờ**. Số event lớn không làm chậm libass so với clip ngắn. |

**Lưu ý:** `qtrle` nhỏ hơn rất nhiều nhưng tôi **chưa xác nhận** Premiere Pro 23 đọc Animation/`qtrle` có alpha ổn định trên máy của bạn. ProRes 4444 vẫn là định dạng chính như yêu cầu.

---

## A. Tái sử dụng được

| File / hàm | Dùng lại thế nào | Ghi chú |
|---|---|---|
| `extension/js/core.js`: `parseSRT`, `oneLine`, `stamp`, `weight`, `allocate`, `tokens`, `timing` | **Nguyên vẹn** cho timing từng từ | `timing` đã được so khớp từng frame với render ASS (mục 3). Không thiết kế lại. |
| `core.js`: `timecode`, `duration` | Hiển thị timecode/thời lượng trong panel | |
| `core.js`: `geometry`, `measure` (canvas trong panel) | Chỉ để **cảnh báo** chữ có thể rộng hơn canvas | Không còn dùng để tính keyframe. |
| `panel.js`: đọc SRT (FileReader), `settings()`/lưu localStorage, `log`, `setBusy`, tiến độ, `exportLog`, `rpc()` (kèm profile) | Giữ khung, đổi nội dung | `rpc()` vẫn dùng để gọi host import/insert. |
| `panel.js`: `draw()` (xem thử canvas) | Có thể giữ làm xem thử **gần đúng**; xem thử thật = render clip thử vài giây | Không cam kết giống 100% libass. |
| `host.jsx`: `seq()`, `sequenceFps`, `time`, `checkRC`, dispatcher `KG23.call` (json2 + parser nhanh `parsePayload`), `saveLog` | Giữ | Payload mới rất nhỏ nên parser nhanh không còn cần thiết nhưng vô hại. |
| `json2.jsx` | Giữ | |
| `install.ps1`, `INSTALL.bat`, `UNINSTALL.bat` | Mở rộng (thêm bước ffmpeg + bundle 2 extension) | Vẫn dùng `PlayerDebugMode`. |
| Bộ test: `tests/test.js` (core), khung mock trong `tests/test-batch-host.js` (vm + Premiere DOM giả) | Tái dùng khung để test host mới | |

## B. Code cũ sẽ lỗi thời (chưa xóa; xóa chỉ sau khi qua cổng ở mục J)

| Khu vực | Nội dung |
|---|---|
| `host.jsx` | `inspect`, `partner`, `prepare*`, `lookupPartners`, `apply`, `applyBatch`, `beginRun`, `continueRun`, `runCache`, `crop`/`cachedCrop`/`cropShape`, `getClip`/`trackData`/`trackIndex`, `snapshot`/`sameSnapshot`/`currentMatches`/`differences`/`restore`, `undo`, `forgetSession`, `resetPreview`, `resetBatch`, `history*`, toàn bộ bộ đo `pf*`/`kf*`/`setup*`/`crop*`, `diagnostic` |
| `panel.js` | `scan`, `buildPlans`, `batchRequest`, `run` (chia lượt, cache, tiếp tục), `undo`, `newVideo`, `previewReset`/`resetCrop`, `model` cache theo hàng |
| `core.js` | `geometry` (phần tính x), `makeKeys`, `makeItem`, `cueIndex`, `matchCue` |
| UI | Mục "Crop / Graphic / Ghép nhanh / Hoàn tác / Làm sạch Crop" |
| Test/tài liệu | `test-batch-host.js`, `test-batch-panel.js`, `test-crop-reads.js`, `test-kf-metrics.js`, `test-fast-parse.js`, `benchmark.js`, `BENCHMARK.json`, `TEST_REPORT.txt`, các mục README nói về Graphic/Crop |

Không bao giờ còn cần: Graphic trắng/màu, Crop, đọc/ghi keyframe, khớp clip↔cue, lịch sử hoàn tác trong RAM host.

## C. Môi trường CEP có Node.js chưa?

**Chưa.** Bằng chứng:
- `extension/CSXS/manifest.xml`: `CEFCommandLine` chỉ có `--disable-background-timer-throttling`; không có `--enable-nodejs`, `--mixed-context`.
- Toàn bộ `extension/js/*.js` không có `require`/`process`; panel chỉ dùng `window.cep.fs` để lưu log.

Hai đường có thể chạy tiến trình ngoài:
1. **Node.js** (`child_process.spawn`): cần thêm `--enable-nodejs` và `--mixed-context` vào `CEFCommandLine` của extension đó. Ưu: có `cwd`, `env`, stream stdout/stderr ổn định, kill, mã thoát. Premiere 23 = CEP 11 (Node được đóng gói kèm CEP; **phiên bản Node thật cần đọc ở spike 0**).
2. **`window.cep.process.createProcess`** (không cần Node): từ `CEPEngine_extensions.js` của CEP 11: `createProcess(exe, ...args)` → `{data: pid | -1, err}`, `stdout(pid, cb)`, `stderr(pid, cb)`, `stdin`, `waitfor`, `isRunning`, `terminate`, `onquit`. **Không có tùy chọn cwd/env**, và định dạng dữ liệu callback không được mô tả rõ.

Khuyến nghị: dùng **Node `spawn`**, vì cần `cwd` (xem mục D), tiến độ ổn định và hủy an toàn. `cep.process` là phương án dự phòng nếu spike 0 cho thấy Node không chạy.

**Cách ly rủi ro:** đặt panel overlay là **extension thứ hai** trong cùng bundle (mỗi `<Extension>` có `CEFCommandLine` riêng). Panel Graphic cũ giữ nguyên, không bật Node, không bị đổi hành vi.

## D. Cách chạy `ffmpeg.exe` từ extension

- `spawn(ffmpegPath, argsArray, {cwd: workDir, windowsHide: true, stdio: ['ignore','pipe','pipe']})` — **không dùng shell**, đối số là mảng (tránh lỗi khoảng trắng/dấu ngoặc trong đường dẫn).
- Thư mục làm việc tạm cho mỗi job: `<tmp>/KaraokeOverlay/<jobId>/` chứa `karaoke.ass`, `matte.ass`, `fonts/`, `ffmpeg.log`. Bộ lọc dùng **tên tương đối** (`ass=karaoke.ass:fontsdir=fonts`) nhờ `cwd`; tránh phải escape dấu `:` và `\` của đường dẫn Windows trong filtergraph.
- Tiến độ: `-progress pipe:1 -nostats -loglevel warning`; đọc `frame=`/`out_time_us` chia cho tổng frame đã biết trước → thanh tiến độ; giữ ~50 dòng stderr cuối để hiển thị lỗi.
- Hủy: `child.kill()`; xóa file `.partial` dở dang.
- Ghi ra `<tên>.partial.mov` rồi đổi tên thành `<tên>_karaoke.mov` khi mã thoát = 0 (không để file hỏng trông như hợp lệ).
- Tìm ffmpeg: (1) đường dẫn đã lưu trong cài đặt → (2) `<extension>/bin/ffmpeg.exe` → (3) `where ffmpeg` trong PATH. Kiểm tra trước khi chạy: `-version`, `-filters` có `ass`, `alphamerge`, `unpremultiply`; `-encoders` có `prores_ks`. Báo lỗi rõ nếu thiếu.
- Giấy phép: bản FFmpeg phổ biến có libass là GPL; cân nhắc khi đóng gói kèm (nếu chỉ dùng nội bộ thì bỏ vào `bin/` hoặc chọn đường dẫn thủ công).

## E. Phương pháp tạo ASS: đổi màu **nguyên từ**, tức thì

**Nguyên tắc:** với mỗi từ `w` của cue có một `Dialogue` chỉ hiện trong `[startFrame(w), endFrame(w))`. Nội dung event là **cả dòng**, từ `w` bọc trong màu highlight, các từ khác dùng màu thường:

```
Dialogue: 0,0:00:00.00,0:00:00.33,Karaoke,,0,0,0,,{\an5\pos(640,90)}{\1c&H0000DCFF&}She{\1c&H00FFFFFF&} found the documents, ...
Dialogue: 0,0:00:00.33,0:00:00.73,Karaoke,,0,0,0,,{\an5\pos(640,90)}She {\1c&H0000DCFF&}found{\1c&H00FFFFFF&} the documents, ...
```

- Các event của một cue **lát kín** khoảng từ frame đầu đến frame cuối của cue (timing hiện tại đã phân bổ toàn bộ frame của cue cho các từ), nên không cần event "nền" riêng và không có hiện tượng chồng hai lớp gây viền màu.
- Vì mỗi event dùng **cùng một chuỗi** với chỉ đổi thẻ màu, vị trí từng chữ giữ nguyên giữa các từ (đã thấy ổn trong thí nghiệm; test kiểm tra bounding box ổn định ở mục J).
- `\an5` + `\pos(x,y)` bám theo điều khiển hiện có: căn trái/giữa/phải dùng `\an4` / `\an5` / `\an6`, `x = anchorX% × canvasWidth`, `y = canvasHeight/2`.
- `WrapStyle: 2` (không tự xuống dòng) để luôn một dòng; chữ dài hơn canvas sẽ bị cắt → cảnh báo bằng `measure`.
- `PlayResX/Y` = kích thước canvas, `ScaledBorderAndShadow: yes`. Màu ASS là `&HAABBGGRR&`, alpha `00` = đục.
- Escape: `{`, `}`, `\` trong lời (sau `parseSRT` đã bỏ thẻ `{\...}`), xuống dòng không xuất hiện vì `oneLine`.
- **Đổi frame → thời gian ASS:** `t = frame / fps` (fps hữu tỉ, ví dụ 30000/1001), rồi **floor xuống centisecond**. Với mọi fps ≤ 60 (khoảng cách frame ≥ 16,7 ms > 10 ms), mốc đầu event `≤ t_k` và mốc cuối event của từ trước = mốc đầu event của từ sau, nên frame `k` luôn thuộc đúng event và không nhảy sớm/trễ 1 frame. Test có kiểm tra bằng vét cạn mọi frame của 25, 29.97, 30, 50, 59.94, 60 fps.
- Cue chồng thời gian: phát hiện khi tạo plan; mặc định cắt cuối cue trước về đầu cue sau và **cảnh báo** (không im lặng).
- Font: chỉ định `Fontname` + thư mục `fonts/` chứa đúng file font người dùng chọn; "độ đậm" ASS chỉ là cờ Bold, nên độ đậm 600 phải chọn đúng **file/họ font** (ví dụ "Merriweather SemiBold"). Đây là điểm dễ sai lệch so với Premiere (xem rủi ro).
- Alpha: sinh thêm `matte.ass` giống hệt nhưng **mọi màu (chữ, highlight, viền, bóng) đặt trắng** để render mặt nạ alpha.

## F. Đầu ra có alpha cho Premiere Pro 23

Lệnh chính (đã chạy được trong thí nghiệm; đường dẫn tương đối nhờ `cwd`):

```
ffmpeg -y -hide_banner -nostats -progress pipe:1 -loglevel warning
  -f lavfi -i "color=c=black:s=WxH:r=NUM/DEN:d=DURATION"
  -f lavfi -i "color=c=black:s=WxH:r=NUM/DEN:d=DURATION"
  -filter_complex "[0:v]ass=karaoke.ass:fontsdir=fonts,format=gbrp[c];
                   [1:v]ass=matte.ass:fontsdir=fonts,format=gray[a];
                   [c][a]alphamerge,format=gbrap,unpremultiply=inplace=1,
                   scale=out_color_matrix=bt709:out_range=limited,format=yuva444p10le[v]"
  -map "[v]" -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -alpha_bits 16 -vendor apl0
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv
  X.partial.mov
```

- `NUM/DEN`: fps **hữu tỉ chính xác** của sequence, tính từ `sequence.timebase` (ticks/frame; `TPS = 254016000000`): `NUM = TPS/g`, `DEN = ticks/g`. Ví dụ 29,97 → `30000/1001`. Overlay phải có **đúng fps sequence** để Premiere không nội suy.
- `DURATION` = `frames/fps` với `frames` = frame cuối của cue cuối − frame đầu của cue đầu (độ dài xác định từ timing SRT). File bắt đầu tại cue đầu; Premiere chèn tại thời điểm cue đầu.
- Ma trận màu **BT.709 + tag** để màu highlight không lệch khi Premiere hiểu HD là 709. **[CHƯA KIỂM CHỨNG trong Premiere]**
- `unpremultiply` cho alpha **straight** (không halo). Nếu Premiere hiểu khác, có thể đặt Interpret Footage. **[CHƯA KIỂM CHỨNG]**
- Tùy chọn kích thước: `-alpha_bits 8`, `-qscale:v 6..10` (nhỏ hơn ~30%, mất chất lượng viền rất ít). Định dạng thay thế: `qtrle` (`-pix_fmt argb`, ~10 lần nhỏ hơn) nếu Premiere đọc ổn định.
- ProRes 4444 alpha trong Premiere Pro 23 (Windows) — **[CHƯA KIỂM CHỨNG]**; xem spike 1.

## G. Canvas phụ đề và định vị trong Premiere

- **Chiều rộng canvas = chiều rộng sequence** (ví dụ 1280). Không nên khác vì "Set to frame size" của Premiere có thể tự scale clip khác kích thước.
- **Chiều cao mặc định = 180 px tại 720p** (tỉ lệ theo chiều cao sequence, ví dụ 270 px tại 1080p), chỉnh được; tối thiểu ≈ `fontSize × 2,2` để đủ chỗ cho dấu tiếng Việt, viền, bóng. Kích thước chẵn.
- Chữ căn giữa dọc trong canvas. **Y position** (điều khiển của người dùng) = vị trí tâm dòng chữ theo **% chiều cao khung hình**, thực hiện bằng `Motion → Position` của clip overlay: `[0,5, Y%/100]` (giá trị chuẩn hóa 0–1 của Motion Position trong ExtendScript). **[CHƯA KIỂM CHỨNG đơn vị Position; spike 1]**
- **Căn ngang / điểm neo X %** thực hiện **bên trong ASS** (`\an` + `\pos`), như bản hiện tại.
- Sau khi chèn, host **đặt tường minh** `Scale = 100` và (nếu có) tắt scale-to-frame, để kết quả không phụ thuộc tùy chọn "Default Media Scaling".
- Chèn: `importFiles([file], true, bin, false)` → tìm `ProjectItem` theo `getMediaPath()` → `videoTracks[n].overwriteClip(item, time)` (không dùng `insertClip` để không đẩy clip khác) → đọc lại `start` của clip mới để kiểm tra khớp thời điểm → đặt Position/Scale. Track do người dùng nhập số V (như hiện nay), kiểm tra không bị khóa. Thời điểm chèn = frame đầu cue đầu (+ offset).
- Tên file có `jobId`/timestamp để Premiere không dùng lại media cũ khi render lại.

## H. File/module mới cần có

```
extension/
  overlay.html                     panel mới (extension thứ 2)
  css/overlay.css
  js/
    core.js                        (sửa nhỏ: luôn gán root.KGCore khi có window)
    overlay-plan.js   (UMD, thuần)  SRT+style+seq → {fpsNum,fpsDen,firstFrame,frames,cues,words}
    ass-writer.js     (UMD, thuần)  sinh ASS màu + ASS matte, đổi frame→centisecond
    ffmpeg-args.js    (UMD, thuần)  dựng mảng đối số (fps hữu tỉ, filtergraph, tùy chọn codec)
    ffmpeg-runner.js  (Node)        tìm/kiểm tra ffmpeg, spawn, -progress, hủy, tail stderr, .partial
    overlay-panel.js  (UI)          nạp SRT, cài đặt kiểu chữ, chạy, tiến độ, lỗi, nhập vào Premiere
  jsx/
    overlay-host.jsx                sequenceInfo, importOverlay, insertOverlay (dùng lại json2 + call)
  bin/ffmpeg.exe                    (tùy chọn) hoặc chọn đường dẫn trong cài đặt
  CSXS/manifest.xml                 thêm <Extension> thứ 2 với --enable-nodejs --mixed-context
tests/overlay/
  ass-writer.test.js  overlay-plan.test.js  ffmpeg-args.test.js
  ffmpeg-render.test.js (bỏ qua nếu không có ffmpeg)  overlay-host.test.js
docs/FFMPEG_OVERLAY_ARCHITECTURE.md  (file này)
```

Thiết kế cho **batch sau này**: `overlay-plan` và `ffmpeg-runner` nhận `{srtPath, outPath}` độc lập với UI; batch chỉ là vòng lặp `001.srt → 001_karaoke.mov`, `002.srt → 002_karaoke.mov`, mỗi job có thư mục tạm riêng, chạy tuần tự, một job lỗi không dừng cả lô (ghi lại lỗi).

## I. Kế hoạch MVP tối thiểu

**Spike 0 — môi trường (0,5 ngày):** thêm nút "Kiểm tra môi trường" trong panel thử: `typeof require`, `process.versions`, `require('child_process')`, chạy `ffmpeg -version`, `-filters`, `-encoders`. Quyết định Node hay `cep.process`.

**Spike 1 — Premiere đọc overlay (0,5 ngày):** dùng file `out2.mov` sinh bằng lệnh mục F (hoặc file mẫu 5 s): import thủ công + qua ExtendScript vào sequence, kiểm tra: alpha đúng (không halo, không viền đen), màu highlight đúng, đơn vị `Position`, `Scale`, khớp frame tại thời điểm chèn, và `qtrle` như phương án dự phòng. **Cổng: nếu ProRes 4444 alpha không đạt thì dừng kế hoạch và bàn lại định dạng.**

**MVP (sau khi qua hai spike):**
1. `core.js`: sửa UMD (gán `KGCore` khi có `window`); test.
2. `ass-writer.js` + `overlay-plan.js` + `ffmpeg-args.js` (thuần, có test) — dùng `core.timing` nguyên vẹn.
3. `ffmpeg-runner.js` + tiến độ + hiển thị lỗi FFmpeg.
4. `overlay-host.jsx`: `sequenceInfo` (fps hữu tỉ, kích thước, tên — **không quét clip**), `importOverlay`, `insertOverlay`.
5. Panel: nạp SRT → kiểu chữ (font file + họ, cỡ, màu thường, màu highlight, căn ngang, điểm neo X, Y%, chiều cao canvas, viền tùy chọn) → **Render thử 3 giây** → Render đầy đủ → Nhập vào Premiere (+ chèn lên track V n).
6. Chạy kiểm thử thủ công theo mục J trên 1 video ngắn, rồi 1 video 1 giờ.

Không nằm trong MVP: batch UI, xem trước động, hiệu ứng ngoài đổi màu, sửa Graphic cũ.

## J. Kiểm thử bắt buộc trước khi xóa workflow cũ

**Tự động (không cần Premiere):**
1. `ass-writer`: đúng số event = số từ; các event của một cue **lát kín** (không hở, không chồng); từ đang hoạt động là từ duy nhất có màu highlight; escape; `WrapStyle 2`; thứ tự Dialogue; màu `&HAABBGGRR&`.
2. Đổi frame → centisecond: vét cạn mọi frame của 25, 29.97, 30, 50, 59.94, 60 fps; frame `k` luôn nằm trong đúng event của từ theo `core.timing` (không lệch ±1).
3. `overlay-plan`: fps hữu tỉ từ ticks (30000/1001 v.v.); `firstFrame`, `frames`, duration; phát hiện cue chồng nhau/cue rỗng; offset SRT.
4. `ffmpeg-args`: chuỗi đối số đúng, không có shell, đường dẫn có khoảng trắng/Unicode, filtergraph dùng tên tương đối.
5. **Render vàng** (cần ffmpeg, bỏ qua nếu không có): decode từng frame và kiểm tra (a) alpha = 0 ở frame ngoài cue, (b) đúng một vùng highlight mỗi frame, (c) thời điểm đổi màu trùng `startFrame` từng từ, (d) không halo (màu viền ≈ màu chữ), (e) bounding box dòng ổn định giữa các event, (f) chữ tiếng Việt có dấu render đủ, (g) kích thước ảnh = canvas.
6. Host (mock DOM): `importOverlay`, `insertOverlay` (đúng track/thời điểm, từ chối track khóa, đọc lại `start`, đặt Position/Scale), lỗi khi file thiếu.
7. Runner (giả lập process): parse `-progress`, hủy, mã thoát ≠ 0 kèm tail stderr, file `.partial` bị xóa.

**Thủ công trong Premiere Pro 23 (cổng để xóa code cũ):**
1. Cả bốn fps (25, 29.97, 30, 59.94): overlay khớp **từng frame** với SRT tại ≥ 5 cue đầu/giữa/cuối.
2. Alpha trên nền sáng và tối: không halo, màu highlight đúng, độ sắc nét chấp nhận được.
3. Định vị: Y%, căn trái/giữa/phải, sequence 720p và 1080p, `Set to frame size` bật/tắt.
4. So sánh thị giác với kết quả Graphic hiện tại trên cùng đoạn (font, vị trí, thời điểm đổi màu).
5. Video 1 tiếng, ~5.000 cue: thời gian render, kích thước file, Premiere không lag khi phát.
6. Lỗi: thiếu ffmpeg, font không tìm thấy, hủy giữa chừng, đĩa đầy, đường dẫn Unicode/có khoảng trắng, track khóa.
7. Cài đặt sạch bằng `INSTALL.bat` trên máy chưa từng cài; gỡ cài đặt; hai extension cùng tồn tại.

**Cổng xóa workflow cũ:** toàn bộ mục trên đạt, **và** bạn xác nhận đã dùng workflow mới ổn định trên ít nhất một video thật.

---

## Rủi ro và quyết định cần bạn xác nhận

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| ProRes 4444 alpha / màu 709 hiển thị khác kỳ vọng trong Premiere 23 | Trung bình | Spike 1 trước khi làm tiếp |
| Font trên Windows: libass/FFmpeg tìm sai font hoặc thiếu glyph tiếng Việt; "độ đậm 600" không có trong ASS | **Cao** | Người dùng chọn file font, sao chép vào `fonts/` của job; cảnh báo nếu render dùng font dự phòng; test dấu tiếng Việt |
| Kiểu chữ không giống 100% Graphic Premiere (libass ≠ Premiere text engine) | Trung bình | Xem thử 3 giây; so sánh thủ công; chấp nhận khác biệt nhỏ |
| Dung lượng overlay 1 giờ khoảng 4,5–7 GB (ProRes 4444) | Trung bình | `-alpha_bits 8`, `-qscale:v`, hoặc `qtrle` nếu Premiere đọc ổn; render theo đoạn |
| Bật Node làm hỏng UMD của `core.js` | Thấp (đã biết) | Extension riêng + sửa UMD |
| Antivirus/quyền chạy `ffmpeg.exe` | Thấp–TB | Báo lỗi rõ; cho chọn đường dẫn |
| GPL khi kèm ffmpeg trong bản phát hành | Tùy | Không đóng gói mặc định; hướng dẫn tải |
| Cue chồng thời gian gây hiển thị chồng | Thấp | Cảnh báo + cắt cue trước |

**Cần bạn quyết định:**
1. Chấp nhận extension thứ hai (giữ panel cũ nguyên vẹn) hay thay hẳn panel?
2. Font chính là gì và bạn có file font (.ttf/.otf) không? (`Merriweather 600` cần đúng file SemiBold.)
3. Dung lượng ~5–7 GB/giờ có chấp nhận được không, hay muốn thử `qtrle` trước?
4. Overlay có bắt đầu từ cue đầu tiên (đề xuất) hay từ 0 của sequence?
