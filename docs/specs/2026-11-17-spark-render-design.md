# Thiết kế: server trò chơi trên Render, Firebase ở gói Spark

- **Ngày:** 2026-11-17
- **Trạng thái:** Hướng đi đã được chủ dự án chọn; tài liệu này chờ duyệt chi tiết
- **Liên quan:**
  - `2026-11-15-game-backend-design.md` (gọi là "spec gốc")
  - `2026-11-15-spark-plan-options.md` (tài liệu lựa chọn; hướng này là hướng D ở đó)

Tài liệu này chỉ ghi **phần khác với spec gốc**. Chỗ nào không nhắc tới thì spec gốc vẫn đúng.

## 1. Quyết định

Firestore và Auth ở lại Firebase, gói Spark. Phần tính toán mà spec gốc đặt trong Cloud Functions chuyển sang một web service Node chạy trên Render (gói free), dùng Admin SDK để đọc và ghi Firestore.

```
App ──(listener Firestore, chỉ đọc)──────────────► Firestore (Spark, asia-southeast1)
 │                                                     ▲
 └─(HTTPS + Firebase ID token)─► Server trên Render ───┘ (Admin SDK, service account)
                                 (free, Singapore)
```

## 2. Giữ nguyên và thay đổi

| Mục của spec gốc | Ở hướng này |
|---|---|
| 1 đến 4: mục tiêu, phạm vi, nguyên tắc, mô hình dữ liệu | Giữ nguyên. "Callable" và "functions" đọc thành "API của server" |
| 5: rules | Giữ nguyên. Service account bỏ qua rules như Admin SDK trong functions |
| 6.1: quy ước chung | Thay bằng mục 3 của tài liệu này |
| 6.2 đến 6.7: `importGuestProgress`, `syncProgress`, thời gian, bảng thưởng, level, streak | Giữ nguyên dữ liệu vào, dữ liệu ra và logic. Chỉ đổi cách gọi (mục 3) |
| 7: phác thảo phần 2 đến 4 | Giữ nguyên, kèm ghi chú ở mục 8 |
| 8: bố cục code | Thay bằng mục 5 |
| 9: kiểm thử | Thay bằng mục 6 |
| 10: triển khai | Thay bằng mục 7 |
| 11: rủi ro | Giữ nguyên, cộng thêm mục 9 |

## 3. API của server (thay mục 6.1 của spec gốc)

### 3.1 Route

| Route | Thân request | Kết quả |
|---|---|---|
| `GET /healthz` | không | `200 {"ok": true}`. Không cần token, không đụng Firestore. App dùng để đánh thức server |
| `POST /v1/importGuestProgress` | JSON như mục 6.2 của spec gốc | `200` kèm JSON như mục 6.2 |
| `POST /v1/syncProgress` | JSON như mục 6.3 của spec gốc | `200` kèm JSON như mục 6.3 |

Các hàm của phần 2 đến 4 (`purchaseItem`, `useItem`, `adoptCompanion`…) thêm route `POST /v1/<tên hàm>` theo cùng quy ước.

Thân request tối đa 256 KB. Server chỉ nhận `Content-Type: application/json`.

### 3.2 Xác thực

- App gửi `Authorization: Bearer <Firebase ID token>`. Token lấy bằng `currentUser.getIdToken()`; SDK tự làm mới khi hết hạn.
- Server gọi `getAuth().verifyIdToken(token)` và dùng `uid` trong kết quả. `uid` không bao giờ lấy từ thân request.
- Thiếu token, token sai hoặc hết hạn: `401` với `code: "unauthenticated"`. App làm mới token một lần (`getIdToken(true)`) rồi gọi lại.

### 3.3 Lỗi

Mọi lỗi trả JSON cùng một dạng. `code` giữ đúng tên mã lỗi callable của spec gốc để phía app không phải đổi cách phân loại.

```json
{ "error": { "code": "failed-precondition", "reason": "not-imported" } }
```

| `code` | HTTP | Khi nào |
|---|---|---|
| `unauthenticated` | 401 | Mục 3.2 |
| `invalid-argument` | 400 | Dữ liệu vào sai kiểu hoặc vượt giới hạn |
| `failed-precondition` | 409 | Lỗi nghiệp vụ; luôn kèm `reason` (`not-imported`, `insufficient-gems`…) |
| `internal` | 500 | Lỗi không lường trước. Chi tiết chỉ ghi vào log, không trả cho app |

App dịch theo `reason`, không hiển thị chuỗi nào từ server.

### 3.4 Gọi lại

Mọi route `POST` đều gọi lại được mà không cộng hai lần, như nguyên tắc 3 của spec gốc. Hướng này dựa vào điều đó nhiều hơn spec gốc: server có thể bị khởi động lại giữa một request, và app phải thử lại sau khi server thức dậy (mục 4.2).

## 4. Chạy trên Render

### 4.1 Cấu hình service

Khai báo trong `render.yaml` ở gốc repo:

| Thuộc tính | Giá trị |
|---|---|
| Loại | Web service, runtime Node |
| Gói | Free |
| Region | Singapore, cùng vùng với Firestore `asia-southeast1` |
| Thư mục gốc | `server/` |
| Build | `npm ci && npm run build` |
| Start | `npm start` (chạy `node lib/main.js`) |
| Health check | `/healthz` |
| Biến môi trường | `FIREBASE_SERVICE_ACCOUNT_JSON` (secret, nhập tay trên dashboard, không nằm trong repo) |

Server lắng nghe ở `0.0.0.0` trên cổng lấy từ biến `PORT` do Render cấp.

Server không giữ trạng thái: không ghi file, không cache số dư trong bộ nhớ. Mọi trạng thái nằm ở Firestore.

### 4.2 Khởi động nguội

Service free ngủ sau 15 phút không có request và mất khoảng một phút để thức dậy. Phía app phải:

1. Gọi `GET /healthz` ngay khi mở app nếu người dùng đã đăng nhập, không chờ kết quả.
2. Đặt timeout 90 giây cho mọi lượt gọi server.
3. Khi lỗi mạng, timeout hoặc `5xx`: giữ nguyên hàng đợi sự kiện, thử lại với khoảng chờ tăng dần (ví dụ 5, 15, 60 giây, sau đó chờ lần mở app kế tiếp).
4. Với các thao tác người dùng phải chờ (mua, dùng vật phẩm ở phần 2): hiện trạng thái đang xử lý, không khoá màn hình.

### 4.3 Service account

- Tạo một service account riêng trong project `project-dungeon-b317f`, chỉ gán vai trò **Cloud Datastore User** (`roles/datastore.user`). Không dùng service account mặc định của Admin SDK vì nó có quyền rộng hơn nhiều.
- `verifyIdToken` chỉ cần khoá công khai của Google, không cần thêm quyền IAM.
- Khoá JSON chỉ nằm ở hai nơi: secret của Render và máy của chủ dự án (để chạy script seed). `.gitignore` chặn `*service-account*.json`.
- Nghi lộ khoá: xoá khoá trong Google Cloud Console, tạo khoá mới, cập nhật secret trên Render.

## 5. Bố cục code (thay mục 8 của spec gốc)

```
render.yaml                    cấu hình service Render
server/
  package.json, tsconfig.json
  src/
    main.ts                    khởi tạo Admin SDK, lắng nghe ở PORT
    app.ts                     tạo ứng dụng Express: route, middleware, xử lý lỗi
    http/auth.ts               middleware xác minh ID token, gắn uid vào request
    http/errors.ts             lớp AppError và ánh xạ sang HTTP (mục 3.3)
    config/rewards.ts          như spec gốc
    domain/*                   như spec gốc, hàm thuần
    data/playerStore.ts        như spec gốc, dùng Admin SDK
    handlers/importGuestProgress.ts
    handlers/syncProgress.ts
    scripts/seedCatalog.ts     nạp danh mục (từ phần 2), chạy trên máy chủ dự án
```

- Handler là hàm thường dạng `(uid, input, deps) => output`, không biết gì về Express. `app.ts` bọc chúng thành route. Nhờ vậy khi lên Blaze chỉ cần bọc lại bằng `onCall`, không sửa handler.
- Thư viện: `express`, `firebase-admin`. Cấu hình TypeScript như `functions/tsconfig.json` (`strict`, `NodeNext`), Node 24.
- Thư mục `functions/` giữ nguyên bản mẫu, không dùng và không deploy. Vì `firebase.json` vẫn khai báo functions, lệnh `firebase deploy` không kèm `--only` sẽ lỗi; luôn deploy bằng `--only firestore:rules` hoặc `--only firestore:indexes`.

## 6. Kiểm thử (thay mục 9 của spec gốc)

Thêm `vitest` và script `npm test` trong `server/`.

| Loại | Phạm vi | Công cụ |
|---|---|---|
| Unit | `domain/*`, như spec gốc | vitest, không cần emulator |
| Tích hợp | Hai route: gọi lặp không cộng hai lần, sự kiện hỏng vẫn được xác nhận, `not-imported`, hai máy cùng tài khoản, thiếu hoặc sai token trả `401` | `supertest` gọi ứng dụng Express, với emulator Firestore và Auth (`firebase emulators:exec`) |
| Rules | Như spec gốc | `@firebase/rules-unit-testing` trên emulator |

Emulator chạy được ở gói Spark. Khi có biến `FIREBASE_AUTH_EMULATOR_HOST`, Admin SDK chấp nhận token do emulator Auth cấp, nên test không cần khoá thật.

## 7. Triển khai và việc thủ công của chủ dự án (thay mục 10 của spec gốc)

1. `git init` cho repo này và đẩy lên GitHub, GitLab hoặc Bitbucket (repo riêng tư được). Render deploy từ repo Git.
2. Tạo service account và khoá JSON theo mục 4.3.
3. Tạo tài khoản Render, tạo service từ `render.yaml`, nhập secret `FIREBASE_SERVICE_ACCOUNT_JSON`.
4. Thứ tự deploy: rules trước (`firebase deploy --only firestore:rules`), server sau. App chỉ bật `cloudEnabled` khi cả hai đã lên.
5. Địa chỉ server (`https://<tên>.onrender.com`) là một hằng cấu hình ở app, không viết rải rác trong code, để đổi được khi chuyển nền tảng.

Project **không** cần chuyển sang Blaze.

## 8. Ghi chú cho phần 2 đến 4

- **App Check** (mục 7.1 của spec gốc): không có `enforceAppCheck`. Nếu bật, app gửi token ở header `X-Firebase-AppCheck` và middleware gọi `getAppCheck().verifyToken()`.
- **Trần số lượt gọi:** tự làm trong server. Bộ đếm trong bộ nhớ mất khi server ngủ hoặc khởi động lại, nên chỉ chặn được spam trong thời gian ngắn; trần chặt hơn phải lưu ở Firestore và tốn lượt ghi.
- **Mua và dùng vật phẩm:** là thao tác người dùng chờ kết quả, nên chịu ảnh hưởng nặng nhất của khởi động nguội (mục 4.2 và 9.1).

## 9. Hạn chế của hướng này

Các con số về Render tra ngày 2026-11-17 từ tài liệu chính thức (mục 10).

### 9.1 Do gói free của Render

| Hạn chế | Hệ quả | Cách giảm |
|---|---|---|
| Ngủ sau 15 phút không có request; thức dậy mất khoảng một phút | Lượt đồng bộ đầu mỗi phiên chậm. Mua hoặc dùng vật phẩm lúc server ngủ phải chờ tới một phút | Mục 4.2. Số dư ở app vẫn hiện ngay vì app tự tính tạm rồi server ghi đè |
| 750 giờ chạy mỗi tháng cho cả workspace; hết giờ thì mọi service free bị treo tới tháng sau | Chỉ đủ cho một service chạy liên tục (một tháng dài nhất 744 giờ). Thêm service thứ hai (ví dụ bản staging) là có thể hết giờ | Chỉ chạy một service. Không ping giữ thức nếu không cần |
| Băng thông ra có hạn mức tháng; vượt mà không có thẻ thì mọi service free bị treo hết tháng | Kinh tế trò chơi ngừng cho tới đầu tháng | Kết quả trả về nhỏ (chỉ `PlayerSnapshot`). Theo dõi trên dashboard |
| Render có thể treo service gọi ra dịch vụ ngoài quá nhiều | Mọi request đều gọi Firestore, nên đây là rủi ro khi người dùng tăng. Ngưỡng không được công bố | Gộp sự kiện thành lô như spec gốc. Khi bị treo: lên gói trả tiền của Render hoặc lên Blaze |
| Chỉ một instance, không tự mở rộng, có thể bị khởi động lại bất cứ lúc nào | Request đang chạy có thể đứt giữa chừng; tải cao thì chậm chứ không thêm máy | Transaction Firestore và gọi lại an toàn (mục 3.4) |
| Không có ổ đĩa bền, không có one-off job, không có shell | Không lưu được gì trên máy chủ; script seed phải chạy từ máy chủ dự án | Server không giữ trạng thái (mục 4.1) |
| Phút build có hạn mức tháng; hết thì không build được bản mới | Không deploy được bản sửa lỗi cho tới tháng sau | Không deploy tự động cho mọi commit nếu commit dày |
| Không có cam kết về độ sẵn sàng; điều khoản gói free có thể đổi | Có thể phải chuyển nền tảng gấp | Handler không phụ thuộc Express (mục 5), địa chỉ server là cấu hình (mục 7) |

**Khi server bị treo dài ngày:** việc học vẫn chạy và sự kiện nằm trong hàng đợi ở máy. Nhưng theo mục 6.4 của spec gốc, sự kiện cũ hơn 7 ngày bị tính vào trần của ngày hiện tại và không được tính streak. Server ngừng hơn 7 ngày thì người dùng mất streak và mất phần thưởng vượt trần một ngày.

### 9.2 Do không dùng Cloud Functions

| Hạn chế | Hệ quả |
|---|---|
| Không có trigger Firestore và trigger Auth | Mọi việc phải bắt đầu từ một lượt gọi HTTP của app. Ví dụ: không tự dọn `players/{uid}` khi người dùng xoá tài khoản |
| Không có hàm chạy theo lịch | Spec gốc vốn không dùng. Việc dọn `ledger` hay đặt lại streak theo lịch, nếu sau này cần, phải tìm chỗ chạy khác |
| Khoá service account sống lâu, nằm ngoài Google | Lộ khoá là đọc và ghi được toàn bộ Firestore, bỏ qua rules. Cloud Functions không cần khoá nào. Phải tự xoay khoá (mục 4.3) |
| App không dùng được gói `cloud_functions` | Tự viết lớp gọi HTTP: gắn token, timeout, thử lại, đọc lỗi (mục 3) |
| Không có `enforceAppCheck` và giới hạn lượt gọi có sẵn | Tự viết middleware (mục 8) |
| Hai nền tảng | Hai tài khoản, hai nơi xem log, hai bước deploy có thứ tự. Lỗi có thể nằm ở bên này mà triệu chứng hiện ở bên kia |

### 9.3 Do gói Spark, hướng nào cũng gặp

| Hạn chế | Hệ quả |
|---|---|
| Mỗi ngày 50 000 lượt đọc, 20 000 lượt ghi Firestore | Một lượt đồng bộ tốn 3 đến 12 lượt đọc/ghi, nên trần ghi là giới hạn chạm trước, ở mức vài nghìn lượt đồng bộ mỗi ngày. Chạm trần thì mọi lượt ghi lỗi cho tới khi đặt lại (khoảng nửa đêm giờ Thái Bình Dương); listener của app cũng tính vào trần đọc |
| Không vượt trần được bằng cách trả tiền | Muốn hơn thì phải lên Blaze |

### 9.4 Chưa kiểm chứng

Nên xác nhận bằng một bản thử (service chỉ có `/healthz` và một route ghi một document) trước khi viết phần còn lại.

- Tạo service free trên Render không cần thẻ thanh toán. Tài liệu chỉ nói thẻ dùng để trả phần vượt hạn mức.
- Instance free tạo được ở region Singapore. Tài liệu liệt kê Singapore nhưng không nói rõ gói free có ở mọi region.
- Cấu hình máy của instance free và con số hạn mức băng thông, phút build. Tài liệu đã tra không nêu con số.
- Thời gian thức dậy thực tế của một server Node kèm `firebase-admin`.

### 9.5 Dấu hiệu nên rời hướng này

Lên Blaze (bọc lại handler bằng `onCall`) hoặc lên gói trả tiền của Render khi gặp một trong các điều sau:

- Mở shop mà độ trễ một phút khi mua làm người dùng phàn nàn.
- Service bị treo vì hết giờ, hết băng thông hoặc vì gọi ra ngoài nhiều.
- Chạm trần ghi Firestore của Spark.
- Thêm mua gems bằng tiền thật hoặc bảng xếp hạng: khi đó server ngừng là mất tiền hoặc mất công bằng, không còn chỉ là chậm.

## 10. Nguồn

- https://render.com/docs/free
- https://render.com/docs/regions
- https://firebase.google.com/docs/firestore/quotas
