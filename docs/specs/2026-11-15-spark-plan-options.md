# Lựa chọn: làm backend trò chơi khi ở gói Spark

- **Ngày:** 2026-11-15
- **Trạng thái:** Đã quyết định ngày 2026-11-17: chọn hướng D, Spark + Render (mục 9). Spec: `2026-11-17-spark-render-design.md`
- **Liên quan:** `2026-11-15-game-backend-design.md` (gọi là "spec gốc" trong tài liệu này)

## 1. Vấn đề

Spec gốc đặt toàn bộ logic kinh tế (gems, XP, streak) trong Cloud Functions. Cloud Functions chỉ deploy được ở gói Blaze; ở Spark chỉ chạy được trên emulator. Chủ dự án muốn ở Spark trước, nên cần chọn một trong ba hướng dưới đây.

Điều cần quyết định thật ra là: **có cần server tự tính thưởng ngay từ phiên bản đầu không**, và nếu có thì chạy server ở đâu.

## 2. Ba hướng

| | A. Lên Blaze (spec gốc) | B. Spark, rules chặn biên | C. Spark + Cloudflare Workers |
|---|---|---|---|
| Ai tính thưởng | Server | App | Server |
| Chống gian lận | Trần theo nguồn và trần tổng mỗi ngày | Chỉ còn trần tổng mỗi ngày | Như A |
| Tác dụng vật phẩm | Server áp dụng | App áp dụng | Server áp dụng |
| Thay đổi so với spec gốc | Không | Lớn: bỏ hai trong bốn quyết định đã chốt | Vừa: đổi lớp handler và lớp truy cập Firestore |
| Lượng code server | Trung bình | Ít nhất (chỉ rules và test rules) | Nhiều nhất |
| Số nền tảng phải quản lý | 1 | 1 | 2 |
| Cần thẻ thanh toán | Có | Không | Không |
| Đường lên Blaze sau này | Đã ở đó | Viết lại logic từ Dart sang functions | Thay handler và lớp Firestore, giữ `domain/*` |

## 3. Hướng A: lên Blaze

Giữ nguyên spec gốc. Blaze có hạn mức miễn phí cho Cloud Functions, vượt mới tính tiền, nhưng bắt buộc gắn thẻ và nên đặt cảnh báo ngân sách.

Chọn hướng này nếu trở ngại duy nhất của Spark là chưa muốn gắn thẻ ngay, vì đây là hướng ít việc nhất.

## 4. Hướng B: Spark, app tính, rules chặn biên

Không có code server. App tính thưởng và ghi thẳng vào Firestore; rules kiểm tra những gì rules kiểm tra được.

### 4.1 Bốn quyết định của spec gốc

| Quyết định | Ở hướng B |
|---|---|
| Server tự tính thưởng từ lô sự kiện | Bỏ. App tính và ghi số dư; rules chặn trần |
| Đăng nhập tuỳ chọn | Giữ |
| Nhập dữ liệu khách một lần, gems có trần | Giữ. Thành lượt `create` `players/{uid}` từ app; rules kẹp `gems <= 2000` và các trần khác |
| Server áp dụng tác dụng vật phẩm | Bỏ. App áp dụng; rules chỉ kiểm tra được việc trừ túi đồ |

### 4.2 Phạm vi từng phần

- **Phần 1 (nền):**
  - `players/{uid}` cho chủ tài khoản ghi, kèm rules kiểm tra kiểu, không âm và trần tuyệt đối.
  - Trần tổng mỗi ngày vẫn giữ được: app ghi một batch gồm `players` và `days/{hôm nay}`; rules dùng `getAfter()` buộc hai mức tăng khớp nhau và `gemsEarned <= 2000`, `xpEarned <= 5000`.
  - Bỏ: trần theo từng nguồn, kiểm tra thời gian từng sự kiện, `ledger`, `devices` và `seq`. SDK Firestore tự xếp hàng lượt ghi khi offline và không ghi hai lần.
- **Phần 2 (shop):** mua bằng một batch trừ gems và cộng `inventory`; rules đọc giá từ `shop_items` để kiểm tra. Tác dụng ba vật phẩm chạy ở app.
- **Phần 3 và 4 (thành tựu, companion):** logic ở app, Firestore chỉ lưu trạng thái. Các lỗi ở mục 4 và 5 của `report.md` phải sửa trong code app.
- **Code và test:** logic thưởng, level, streak viết bằng Dart trong repo app. Repo này còn rules, script seed danh mục và test rules trên emulator.
- **Deploy:** `firebase deploy --only firestore:rules`. Lệnh `firebase deploy` không kèm `--only` sẽ lỗi ở phần functions.

### 4.3 Cái mất

Người sửa app có thể tự cộng tới trần ngày mà không cần học, và tự áp buff hay Streak Freeze. Thiệt hại bị giới hạn vì spec gốc đã loại mua gems bằng tiền thật và bảng xếp hạng, và gems không chuyển được giữa các tài khoản: gian lận chỉ ảnh hưởng chính người đó.

Rules cho hướng này phức tạp hơn bộ rules ở mục 5 của spec gốc và là lớp bảo vệ duy nhất, nên test rules trở thành phần test quan trọng nhất.

## 5. Hướng C: Spark + Cloudflare Workers

Cloudflare Workers (gói free) đứng vào chỗ của Cloud Functions. Firestore và Auth vẫn ở Firebase, gói Spark.

### 5.1 Cách chạy

1. App gọi Worker qua HTTPS, kèm Firebase ID token ở header.
2. Worker xác minh token bằng khoá công khai của Google, lấy ra `uid`.
3. Worker đọc và ghi Firestore qua REST API bằng service account. Service account bỏ qua rules như Admin SDK; REST API có transaction.
4. App vẫn đọc `players/{uid}` bằng listener Firestore như spec gốc.

### 5.2 Thay đổi so với spec gốc

| Mục của spec gốc | Thay đổi |
|---|---|
| Bốn quyết định, mô hình dữ liệu (mục 4), rules (mục 5), bảng thưởng, streak | Giữ nguyên |
| `domain/*` (hàm thuần TypeScript) | Giữ nguyên |
| `handlers/*` | Từ `onCall` thành route HTTP; tự xác minh token, tự trả mã lỗi kèm `reason` |
| `data/playerStore.ts` | Viết lại trên Firestore REST |
| Phía app | Gọi HTTP kèm ID token thay cho gói `cloud_functions` |
| Deploy | `wrangler deploy` cho Worker; `firebase deploy --only firestore:rules` cho rules |
| Thư mục `functions/` | Không dùng; code Worker nằm ở thư mục riêng |

### 5.3 Điểm cần biết

- **CPU 10 ms mỗi request ở gói free.** Thời gian chờ Firestore không tính, nhưng ký JWT cho service account thì có. Phải cache access token (sống 1 giờ) thay vì ký lại mỗi request.
- **Khoá service account nằm trong secret của Worker.** Lộ khoá là lộ toàn bộ database. Cần một service account riêng chỉ có quyền Firestore.
- **Firestore REST dài dòng.** Phải tự viết lớp chuyển kiểu (`integerValue`, `mapValue`…) và tự thử lại khi transaction xung đột. Đây là phần tốn công nhất của hướng C.
- **Độ trễ.** Mỗi lượt đồng bộ là 3 đến 4 lượt gọi từ Worker tới `asia-southeast1`. Chấp nhận được vì đồng bộ chạy nền.
- **Test.** Unit test `domain/*` không đổi. Test tích hợp dùng Firestore emulator qua REST.

### 5.4 Chưa kiểm chứng

Hai điểm dưới đây là hiểu biết sẵn có, chưa chạy thử trong dự án này. Nên làm một bản thử nhỏ (một Worker ghi một document) trước khi cam kết hướng C.

- `firebase-admin` không chạy được trên Workers, nên phải dùng REST.
- Xác minh token cộng một transaction Firestore nằm gọn trong 10 ms CPU.

## 6. Hạn mức miễn phí

Tra ngày 2026-11-15 từ tài liệu chính thức.

| Dịch vụ | Hạn mức |
|---|---|
| Firestore (Spark) | 1 GiB lưu trữ; mỗi ngày 50 000 lượt đọc, 20 000 lượt ghi, 20 000 lượt xoá; 10 GiB truyền ra mỗi tháng. Đặt lại khoảng nửa đêm giờ Thái Bình Dương |
| Cloudflare Workers (Free) | Mỗi ngày 100 000 request; 10 ms CPU mỗi request; 50 subrequest mỗi request; 128 MB bộ nhớ; tối đa 64 secret và biến mỗi Worker |

Ước lượng theo spec gốc: một lượt đồng bộ tốn 3 đến 12 lượt đọc/ghi Firestore ở hướng A và C, 2 đến 3 lượt ghi ở hướng B. Giới hạn chạm trước là 20 000 lượt ghi Firestore mỗi ngày, chung cho cả ba hướng khi ở Spark.

Nguồn:

- https://firebase.google.com/docs/firestore/quotas
- https://developers.cloudflare.com/workers/platform/limits/
- https://firebase.google.com/docs/functions/get-started

## 7. Khuyến nghị

1. **Chưa muốn gắn thẻ nhưng vẫn muốn server giữ kinh tế:** chọn C. Giữ được toàn bộ thiết kế đã duyệt; cái giá là lớp Firestore REST và thêm một nền tảng.
2. **Muốn ít việc nhất và chấp nhận app tự tính thưởng ở phiên bản đầu:** chọn B. Hợp lý chừng nào chưa có mua gems bằng tiền thật và bảng xếp hạng.
3. **Gắn thẻ được:** chọn A. Ít việc hơn C mà kết quả như nhau.

Thời điểm buộc phải có server tính thưởng (A hoặc C): khi thêm mua gems bằng tiền thật, bảng xếp hạng, hoặc bất kỳ cách nào để gems của người này ảnh hưởng người khác.

## 8. Việc tiếp theo sau khi quyết định

| Chọn | Việc cần làm với spec gốc |
|---|---|
| A | Không đổi. Làm mục 10 của spec gốc (lên Blaze, `git init`) |
| B | Viết lại mục 1 đến 3 và 5 đến 9; bộ rules mới thay mục 5; spec phía app nhận thêm phần logic thưởng |
| C | Sửa mục 6.1, 8, 9, 10; thêm mục về xác minh token và service account; làm bản thử ở mục 5.4 trước |

## 9. Hướng D: Spark + Render (đã chọn)

Thêm ngày 2026-11-17. Giống hướng C, nhưng server là một web service Node trên Render (gói free) thay cho Cloudflare Workers.

| | C. Cloudflare Workers | D. Render |
|---|---|---|
| Truy cập Firestore | REST tự viết | Admin SDK, như spec gốc |
| Xác minh token | Tự kiểm tra bằng khoá công khai | `verifyIdToken` của Admin SDK |
| Giới hạn CPU mỗi request | 10 ms | Không |
| Khởi động nguội | Gần như không | Khoảng một phút sau 15 phút không có request |
| Hạn mức | 100 000 request mỗi ngày | 750 giờ chạy mỗi tháng |
| Đường lên Blaze | Thay handler và lớp Firestore | Chỉ bọc lại handler bằng `onCall` |

Lý do chọn D thay cho C: giữ được `data/playerStore.ts` trên Admin SDK, bỏ được phần tốn công nhất của C (mục 5.3). Cái giá là khởi động nguội. Thiết kế và danh sách hạn chế đầy đủ nằm ở `2026-11-17-spark-render-design.md`.
