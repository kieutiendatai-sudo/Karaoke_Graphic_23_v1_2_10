# Karaoke Overlay cho Premiere Pro 23

Panel CEP tạo phụ đề karaoke **đổi màu nguyên từ** bằng FFmpeg và nhập vào Premiere như **một clip overlay trong suốt**.
Không tạo Graphic theo cue, không tạo keyframe Crop.

```
SRT → thời gian từng từ → ASS → FFmpeg (ProRes 4444 alpha) → 1 clip trong Premiere
```

## Cài đặt

1. Đóng hoàn toàn Premiere. Chạy `INSTALL.bat` (không cần quyền quản trị).
2. Chuẩn bị **FFmpeg bản đầy đủ** (có libass và `prores_ks`): đặt `ffmpeg.exe` trong `extension\bin\`, hoặc trong PATH, hoặc chọn thư mục trong panel.
3. Mở Premiere 23 → **Window → Extensions → Karaoke Overlay** → bấm **Kiểm tra FFmpeg**.

## Sử dụng

1. Chọn SRT, thư mục kết quả, file font (.ttf/.otf), rồi chỉnh cỡ chữ, màu chữ chưa đọc, màu từ đang đọc, viền, bóng, căn ngang, điểm neo X, vị trí Y.
2. **Xem thử** để render vài giây, sau đó **Render overlay**.
3. Chọn track V và bấm **Nhập vào Premiere**.

Chi tiết cơ chế, giới hạn và kiểm thử: `docs/OVERLAY_PANEL.md`. `SAMPLE.srt` là ví dụ.

Workflow Graphic + Crop + keyframe trước đây đã bị xóa; xem lịch sử git (commit `5b49fd5`) nếu cần lấy lại.
