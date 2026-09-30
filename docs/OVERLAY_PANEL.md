# Panel Karaoke Overlay (Premiere Pro 23)

Panel duy nhất của extension: `Window → Extensions → Karaoke Overlay`. Workflow Graphic/Crop/keyframe cũ đã bị xóa
(còn trong lịch sử git, commit `5b49fd5`).

```
SRT → KGCore.timing (đã có) → ASS (mỗi từ một Dialogue) → FFmpeg/libass → overlay MOV có alpha → 1 clip trong Premiere
```

Premiere **không** tạo Graphic theo cue và **không** tạo keyframe. Chữ đổi màu **nguyên từ**, tức thì (không quét dần
từng nét); từ trước/sau giữ màu thường.

## Cách hoạt động

1. **Timing:** dùng lại `KGCore.timing` (chia frame theo trọng số từ, đã kiểm chứng với SRT 1 dòng). Panel không tính lại thuật toán.
2. **ASS (`js/overlay/ass-writer.js`):** với mỗi từ có một `Dialogue` chỉ hiện trong khoảng frame của từ đó; nội dung là cả
   dòng, chỉ từ đang đọc có màu highlight. Các event của một cue lát kín cue nên không có lớp chữ nền trùng.
   Frame đổi sang thời gian ASS bằng **floor xuống centisecond** (đã chứng minh và kiểm tra cho 24–100 fps) để mỗi frame rơi
   đúng event của nó.
3. **Alpha (`js/overlay/ffmpeg-args.js`):** bộ lọc `ass` của FFmpeg **không ghi alpha**, nên overlay được vẽ **hai lần**
   (màu trên nền đen + ma trận trắng), `alphamerge`, `unpremultiply`, ProRes 4444 (`prores_ks`, `yuva444p10le`), BT.709.
4. **FFmpeg (`js/overlay/overlay-job.js`, Node):** chạy `ffmpeg` như tiến trình ngoài (không qua shell), đọc tiến độ từ
   `-progress`, có nút Dừng (SIGTERM rồi SIGKILL sau 2 s), ghi `.partial.mov` rồi đổi tên sau khi FFmpeg giải mã lại được
   toàn bộ file. FFmpeg chỉ vẽ dải phụ đề, **không** đọc hay mã hóa video gốc.
5. **Premiere (`jsx/overlay-host.jsx`):** nhập **một** file, `overwriteClip` **một** clip lên track V đã chọn tại thời điểm
   cue đầu tiên, đặt `Position` = `[0,5 ; Y%]` và `Scale` = 100.

Độ dài overlay lấy từ timing SRT: từ frame đầu của cue đầu đến frame cuối của cue cuối. Frame rate lấy chính xác từ
`sequence.timebase` (29,97 → 30000/1001).

## Cài đặt

Đóng Premiere, chạy `INSTALL.bat`. Panel bật `--enable-nodejs --mixed-context` để chạy FFmpeg.
Cần **FFmpeg đầy đủ** (có libass và `prores_ks`); chọn thư mục chứa `ffmpeg.exe`, hoặc đặt trong `extension\bin\`, hoặc PATH.
Bấm **Kiểm tra FFmpeg** để xác nhận bản của bạn đủ.

## Sử dụng

1. Chọn FFmpeg, file SRT, thư mục kết quả, **file font** (.ttf/.otf; font variable chỉ dùng được kiểu mặc định của nó).
2. Chỉnh cỡ chữ, màu chữ chưa đọc, màu từ đang đọc, viền, bóng, căn ngang, điểm neo X, **Vị trí Y (% chiều cao khung)**.
3. FPS để **Theo sequence** (mở đúng sequence trước). Bấm **Xem thử** để render vài giây, sau đó **Render overlay**.
4. Chọn track V và bấm **Nhập vào Premiere**.

Kết quả: `<tên SRT>_karaoke.mov` và `<tên SRT>_karaoke.json` (vị trí, thời điểm bắt đầu, `identity`). Render lại với cùng
SRT/kiểu chữ sẽ bỏ qua (cùng `identity`); đổi bất kỳ tùy chọn nào sẽ render lại.

## Giới hạn / chưa kiểm chứng trong Premiere thật

- Chưa chạy trong Premiere Pro 23: nạp panel, Node trong CEP, `importFiles`/`overwriteClip`, đặt `Position`/`Scale`, và việc
  Premiere đọc ProRes 4444 alpha + màu BT.709 như kỳ vọng. Test dùng FFmpeg thật và DOM giả.
- Một dòng: chữ dài hơn khung bị cắt; panel cảnh báo ước tính bằng số đo canvas.
- libass chọn font theo tên họ; nếu máy đã cài font trùng tên, kết quả có thể dùng font đã cài thay vì file chọn.
- Kiểu chữ không giống 100% Graphic của Premiere (libass ≠ engine chữ của Premiere).
- Overlay ProRes 4444 khá nặng (video 1 giờ khoảng vài GB); tùy chọn `qtrle` nhỏ hơn nhiều nhưng chưa xác nhận Premiere đọc ổn.

## Kiểm thử

```
node tests/overlay/run-all.js            # KG_FFMPEG=<đường dẫn ffmpeg> nếu ffmpeg không có trong PATH
```
Gồm test timing/ASS/tham số FFmpeg, render thật (alpha, màu, viền không tối, mỗi từ đổi màu đúng frame, vị trí ổn định,
căn lề, hủy, lỗi), host với DOM giả, cấu trúc manifest và test lõi SRT/timing.

## Tốc độ render

- FFmpeg chỉ dựng **một khung hình cho mỗi đoạn** (đầu/cuối từng từ, từng cue) rồi lặp lại các khung giống nhau; chữ chỉ đổi ở các mốc đó.
- ProRes dùng lượng tử cố định (`-qscale 2`, PSNR ≈ 65 dB so với mặc định của `prores_ks`) thay vì rate control mặc định (chậm hơn ~5 lần).
- Mẫu đo (4 nhân, SRT 304 s, 30 fps): 82,8 s → 22,9 s. Hai file chạy song song: 38,3 s cho cả hai (so với 45,8 s tuần tự).
- Ô **Số file render song song** chỉ có lợi khi máy còn dư nhân CPU.

## Nền bo góc và cue 2 dòng

- **Nền:** vẽ bằng một hình chữ nhật bo góc (ASS drawing, đường cong Bezier) cho **mỗi cue**, nằm dưới chữ. Kích thước lấy từ số đo thật của libass: trước khi render, panel chạy một lượt FFmpeg ngắn (mỗi dòng chữ một khung) để đo vùng chữ (gồm kerning, viền, bóng), rồi cộng **đệm ngang/dọc**. Chiều cao nền theo mẫu `Hgpqy|` nên không nhảy giữa các cue. `Bo góc = 0` cho nền vuông.
- **2 dòng:** bật "Giữ 2 dòng của SRT…" thì dòng 1 của SRT là hàng trên, phần còn lại là hàng dưới; cả hai hàng luôn hiện, màu đổi lần lượt từ từ đầu hàng trên đến từ cuối hàng dưới (thời điểm từng từ tính như chế độ 1 dòng). Khoảng cách hàng chỉnh bằng "Khoảng cách 2 dòng". Chiều cao dải phụ đề tự động tăng khi bật chế độ này.
