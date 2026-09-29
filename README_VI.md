# Karaoke Graphic 23 v1.2.10 Fast — chế độ 1 dòng

Bản này chỉ xử lý **một dòng subtitle** và **một lớp chữ màu** cho mỗi cue.

## Sẵn sàng áp dụng sau khi nạp SRT

- Nạp SRT xong có thể bấm **Áp dụng các câu còn lại** ngay. Nếu chưa ghép, panel tự ghép nhanh rồi ghi; không cần bấm Quét riêng. Muốn chọn một cue thử thì ghép trước để có danh sách.
- Ghép nhanh chỉ đọc ID, track, tên và các mốc thời gian clip; không mở Crop, không kiểm tra tốc độ hoặc đọc lại keyframe. Đúng một Crop và animation có sẵn được kiểm tra ngay trước khi ghi cue đó.
- Chỉ mục ID/thời gian đã đọc được dùng lại khi bắt đầu ghi, tránh quét cả track một lần nữa. Mỗi clip vẫn được xác định bằng ID và thời gian hiện tại.
- Danh sách cue được thêm vào giao diện theo một khối. Log đo riêng đọc SRT, host inspect, ghép SRT và dựng danh sách; JSON còn giữ số đo khởi tạo/ghi theo lượt.
- Graphics cần tốc độ 100%, Crop Zoom tắt, Feather = 0. Ghép nhanh không xác minh các thông số này. Clip thiếu Crop sẽ dừng khi đến cue đó; các cue đã ghi trước đó vẫn giữ.

## Sửa xuất log

- Sửa encoding CEP khi ghi log từ `UTF8` thành `UTF-8`. Mã lỗi CEP 5 trước đây là encoding không được hỗ trợ.

## Cache kế hoạch và giảm thao tác lặp

- **Xuất log kiểm tra** dùng API lưu file trực tiếp của panel CEP, không đọc lại toàn bộ timeline rồi gửi log qua ExtendScript. Có thể xuất khi đang chạy, kể cả thông số nhập đang sai. Log chứa nhật ký, các số đo RPC, thông số, lỗi và tiến độ panel đã nhận lúc bấm; không chứa bản dump mới của tất cả hiệu ứng trên timeline.
- Giữ cache bố cục, timing, keyframe và đo chiều rộng chữ. Kiểm tra bố cục nhiều lần không xóa rồi tính lại. Đổi nội dung, thời lượng, FPS hoặc kiểu chữ sẽ tính lại phần liên quan.
- Toàn bộ kế hoạch được gửi sang host một lần, gồm các keyframe đã tính. Host giữ dữ liệu thuần và vị trí đã ghi trong RAM. Các lượt tiếp theo chỉ gửi token, vị trí tiếp tục và số cue; không gửi lại cả lô keyframe.
- Đường ghi nhanh không tìm bản sao chữ trắng, không kiểm tra lại tốc độ/khả năng keyframe, không chụp toàn bộ trạng thái và không đọc lại từng keyframe sau khi ghi. Vẫn kiểm tra ID/thời gian clip màu, sequence/FPS, khóa track, đúng một Crop và animation có sẵn. Mã lỗi ghi từ Premiere vẫn dừng và hoàn tác cue lỗi.
- Bấm Dừng rồi Áp dụng các câu còn lại sẽ tiếp tục kế hoạch đang giữ, không tính lại hoặc kiểm tra toàn bộ phần còn lại. Trước khi ghi mỗi cue ở lượt sau vẫn kiểm tra clip/Crop hiện tại; nếu sửa timeline trong lúc dừng, panel có thể dừng tại cue bị đổi sau khi các cue hợp lệ trước đó đã ghi.
- Cache kế hoạch chỉ tồn tại trong phiên mở panel/Premiere. Quét lại, nạp SRT mới, sửa thông số/nội dung, làm sạch Crop hoặc Bắt đầu video mới sẽ tạo kế hoạch mới. Không dùng cache của video cũ làm kết quả kiểm tra cho video mới.
- Sequence, track và collection của Adobe được đọc một lần trong từng lời gọi đồng bộ. Một đối tượng Time được dùng lại cho các keyframe trong lượt; không giữ tham chiếu Adobe qua lần gọi tiếp theo.
- Panel điều chỉnh số cue theo thời gian xử lý cue và trung bình các lượt; tách thời gian khởi tạo khỏi dự đoán. Log có thêm khởi tạo và xử lý cue để tìm đoạn chậm ngoài các mục kiểm tra/ghi/đọc lại.
- Bản này ưu tiên gửi đúng frame/giá trị/nội suy; không xác minh lại kết quả của từng lệnh ghi. Ghép lại chỉ đọc thông tin clip; Hoàn tác mới đọc trạng thái Crop để đối chiếu. Chưa đo tốc độ v1.2.10 trực tiếp trong Premiere.

API lưu file: [Adobe CEP 11 CEPEngine_extensions.js](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_11.x/CEPEngine_extensions.js).

## Chạy nhiều cue sau khi chia SRT

- Trong mục 3, đặt **Số cue tối đa mỗi lượt = 2.500**. Có thể tăng lên **5.000** để giảm chuyển lượt.
- Mặc định mới là 2.500; số cue đã lưu từ bản cũ vẫn được giữ, nên hãy đổi ô nếu nó còn 500 hoặc 800.
- Mỗi lượt kết thúc sau khoảng 30 giây, tại ranh giới cue hoàn chỉnh, rồi tự tiếp tục. Đây là số cue tối đa; panel có thể gửi ít hơn để phù hợp tốc độ Premiere.
- Lượt dài giảm số lần Premiere phải khởi tạo lại timeline. Nút Dừng chỉ có hiệu lực sau khi lượt đang chạy kết thúc.
- Dùng cùng SRT đã chia để tạo Graphic và nạp vào panel. Chọn đúng phạm vi clip của video đang làm để tránh quét cả các video khác.

Đóng hoàn toàn Premiere trước khi chạy INSTALL.bat của bản này, rồi mở lại. Chưa benchmark tốc độ thực tế trong Premiere; kết quả test dùng mô phỏng API.

## Tối ưu cho một dòng

- SRT có Enter hoặc `<br>` được nối thành một khoảng trắng trước khi tạo timing.
- Mỗi cue có đúng một Crop Right trên đúng một lớp màu. Top và Bottom luôn bằng 0, nên màu không thể chạy sang dòng 2.
- Timing từng từ được phân bổ trực tiếp trên số frame của sequence. Khi cue đủ dài, mỗi từ có ít nhất một frame; từ ngắn và dấu câu không còn bị cấp thời gian quá ngắn theo số ký tự.
- Không bắt buộc đánh dấu xác nhận xem thử. Lớp trắng/màu cần được chuẩn bị trùng font/cỡ chữ/vị trí vì đường ghi không đối chiếu chúng.
- Kiểm tra ban đầu không còn trả danh sách bản sao chữ trắng không được dùng sang panel, giảm dữ liệu truyền qua CEP khi chạy nhiều cue.

Mốc cue và mốc từng từ trong panel dùng `giờ:phút:giây:frame`, đúng theo FPS, định dạng Drop-frame/Non-drop-frame và giờ bắt đầu của sequence. Thời lượng xử lý dùng `phút:giây.mili giây`, ví dụ `01:11.350`. Nếu đổi FPS, định dạng timecode hoặc giờ bắt đầu sequence, hãy Quét lại.

Sau khi render xong và xóa Graphic của video cũ để làm video mới trong cùng Premiere: bấm **Bắt đầu video mới**, nạp SRT mới rồi Quét. Nút chỉ quên lịch sử Crop đang nằm trong bộ nhớ panel; nó không sửa Crop, không xóa keyframe và không sửa Timeline. Sau thao tác này không thể dùng nút Hoàn tác để khôi phục video cũ.

Premiere có thể tái dùng ID clip sau khi bạn xóa clip cũ. v1.2.3 cũng tự bỏ lịch sử nếu cùng ID nhưng track, thời gian đầu/cuối hoặc in-point đã khác. Nếu clip mới giữ đúng cả ID lẫn mọi mốc thời gian cũ, hãy dùng nút **Bắt đầu video mới** để tránh bị nhận nhầm.

## Chuẩn bị timeline

1. Giữ Graphic chữ trắng ở một track, ví dụ V2.
2. Nhân bản Graphic lên track phía trên, ví dụ V3, rồi đổi Fill sang màu karaoke.
3. Thêm đúng một hiệu ứng **Crop** vào các clip chữ màu. Giữ Zoom tắt và Edge Feather = 0.
4. Hai lớp trắng/màu phải trùng thời gian, vị trí, font và cỡ chữ.
5. Không cần V4 hoặc lớp màu dành cho dòng 2.

## Xử lý SRT

- Mỗi cue được đưa về **một dòng duy nhất**.
- Nếu trong cue SRT có Enter hoặc `<br>`, panel tự nối các phần bằng một dấu cách.
- Panel không tự chia chữ thành hai dòng và không còn thông số ranh Y/dòng 2.

## Quy trình

1. Nạp SRT.
2. Chọn track chữ trắng và track chữ màu.
3. Có thể bỏ bước ghép riêng khi áp dụng toàn bộ. Muốn xem thử/chọn một cue thì bấm Ghép nhanh Graphic và SRT.
4. Nhập đúng font, cỡ chữ, độ đậm, tracking, điểm neo và Width Factor.
5. Xem thử một cue, đối chiếu với Program Monitor.
6. Áp dụng một cue thử hoặc chạy phần còn lại. Ô xác nhận xem thử là tùy chọn.

## Lưu ý

Panel chỉ tạo keyframe Crop trên **track chữ màu duy nhất**. Nếu chữ thực tế trong Premiere vẫn tự wrap thành hai dòng vì khung text quá hẹp, hãy chỉnh Graphic/box text trong Premiere để nó thật sự hiển thị một dòng trước khi chạy panel.

## Thay đổi v1.2.1 — timing từ ổn định hơn

- Chia thời gian trực tiếp trên frame của sequence, không chia centisecond rồi làm tròn lần hai.
- Không còn dùng thời lượng tỷ lệ tuyến tính theo số ký tự; từ ngắn được đủ thời gian hơn, từ dài không chiếm quá nhiều cue.
- Khi cue đủ dài, mỗi từ được giữ tối thiểu 1 frame.
- Dấu câu nhận thêm một khoảng nhỏ để giảm hiện tượng màu nhảy sang từ kế tiếp quá sớm.

Lưu ý: SRT câu chỉ có thời gian đầu/cuối của cả câu, nên timing từng từ vẫn là ước lượng. Muốn khớp tuyệt đối với giọng nói cần timestamp từng từ từ forced alignment/ASR.
