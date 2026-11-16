# Thiết kế: backend trò chơi cho Dungeonary

- **Ngày:** 2026-11-15
- **Trạng thái:** Hướng đi đã được chủ dự án duyệt trong phiên brainstorm; tài liệu này chờ duyệt chi tiết
- **Repo app:** `B:\ManhCuong_Windows\test_abc` (nhánh `release/offline-v1`)
- **Spec phía app:** `docs/superpowers/specs/2026-11-15-game-backend-overview-design.md` và `2026-11-15-backend-foundation-design.md` trong repo app
- **Nguồn:** `report.md` của repo app (mục 4, mục 5, shop đang ẩn sau cờ)
- **Cập nhật 2026-11-17:** project ở lại gói Spark, server chạy trên Render thay cho Cloud Functions. Mục 6.1, 8, 9 và 10 bị thay bởi `2026-11-17-spark-render-design.md`; các mục còn lại vẫn có hiệu lực

Tài liệu này là **hợp đồng phía server**: mô hình dữ liệu, rules, chữ ký của các hàm, bảng thưởng. Hai spec phía app tham chiếu về đây và không lặp lại các bảng số.

## 1. Mục tiêu

Chuyển phần kinh tế của trò chơi (gems, XP, streak) cùng shop, thành tựu và companion sang server giữ, trong khi việc học vẫn chạy offline trên máy.

Bốn quyết định đã chốt:

| Quyết định | Lựa chọn |
|---|---|
| Server ghi nhận phần thưởng học tập thế nào | Học offline, app gửi lô sự kiện sau; server tự tính thưởng, có trần theo ngày |
| Tài khoản | Đăng nhập tuỳ chọn. Khách vẫn học được; shop, thành tựu, companion cần tài khoản |
| Dữ liệu của khách khi đăng nhập lần đầu | Nhập một lần; XP, streak, số từ đã thuộc nhận nguyên, gems có trần |
| Tác dụng của vật phẩm | Server áp dụng (Streak Freeze, Save Streak, Double Gems) |

## 2. Phạm vi

Công việc chia thành bốn phần, làm theo thứ tự. Tài liệu này đặc tả đầy đủ phần 1 và phác thảo phần 2 đến 4; mỗi phần sau có spec riêng trước khi làm.

1. **Nền:** `players`, nhập dữ liệu khách, `syncProgress`, bảng thưởng, trần ngày, streak.
2. **Shop và túi đồ:** danh mục, mua, dùng vật phẩm, tác dụng của ba vật phẩm.
3. **Thành tựu.**
4. **Companion.**

Ngoài phạm vi: backup từ vựng lên cloud (collection `backups` giữ nguyên, tính năng vẫn tắt ở app), đồng bộ từ vựng giữa các máy, mua gems bằng tiền thật, bảng xếp hạng.

## 3. Nguyên tắc

1. **App đọc bằng listener Firestore, ghi bằng callable.** Rules chặn mọi lượt ghi trực tiếp vào dữ liệu do server giữ. Admin SDK trong functions bỏ qua rules.
2. **Server không tin số tiền thưởng do app gửi.** App gửi sự kiện ("trả lời đúng một câu quiz"), server tra bảng thưởng của chính nó.
3. **Mọi hàm ghi đều gọi lại được mà không cộng hai lần.** `syncProgress` dùng số thứ tự theo máy; các hàm còn lại dùng `requestId`.
4. **Một sự kiện hỏng không được chặn hàng đợi.** Sự kiện sai định dạng bị bỏ qua nhưng vẫn được xác nhận đã nhận.
5. **Logic tính toán là hàm thuần**, tách khỏi Firestore, để test không cần emulator.

Giới hạn cần chấp nhận: server không có từ vựng của người dùng, nên không kiểm chứng được một câu trả lời có thật hay không. Trần theo ngày giới hạn mức gian lận, không chặn tuyệt đối.

## 4. Mô hình dữ liệu Firestore

### 4.1 `players/{uid}`

Chủ tài khoản chỉ đọc. Chỉ functions ghi.

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `gems` | int | Số dư, không âm |
| `xp` | int | Tổng XP tích luỹ |
| `level` | int | Suy ra từ `xp` theo công thức ở mục 6.6 |
| `totalLearned` | int | Số từ đã thuộc, cộng dồn từ sự kiện của mọi máy |
| `streak` | map | `current` (int), `longest` (int), `lastDay` (`yyyy-MM-dd` hoặc null) |
| `feedQuizSinceReward` | int | Số câu quiz feed đúng kể từ thẻ thưởng gần nhất, 0 đến 3 |
| `devices` | map | `{deviceId: {lastSeq: int, lastSyncAt: timestamp}}` |
| `importedAt` | timestamp | Thời điểm tạo player từ dữ liệu khách |
| `createdAt`, `updatedAt` | timestamp | |

Các phần sau thêm trường vào document này: `buffs`, `lostStreak` (phần 2), `unitsCompleted` (phần 3), `companion` (phần 4).

`deviceId` là `keyOpen` của app (sinh một lần cho mỗi lần cài).

### 4.2 Collection con của `players/{uid}`

| Đường dẫn | Nội dung | Phần |
|---|---|---|
| `days/{yyyy-MM-dd}` | `counts` (map nguồn thưởng sang số đơn vị đã tính), `gemsEarned`, `xpEarned`, `quests` (mảng id quest đã xong), `streakDay` (bool), `frozen` (bool, phần 2) | 1 |
| `ledger/{id}` | Nhật ký thay đổi số dư: `type` (`import`, `sync`, `purchase`, `use_item`, `feed_companion`), `gems`, `xp` (chênh lệch), `at`, `deviceId`, `seqFrom`, `seqTo`, hoặc `itemId`, `quantity` | 1 |
| `inventory/{itemId}` | `quantity`, `updatedAt` | 2 |
| `achievements/{code}` | `currentValue`, `isUnlocked`, `unlockedAt`, `updatedAt` | 3 |
| `companion_history/{id}` | Companion cũ: `definitionId`, `levelReached`, `totalFoodUsed`, `totalWordsLearned`, `adoptedAt`, `retiredAt` | 4 |

Mỗi lượt `syncProgress` có đổi số dư ghi đúng một document `ledger`. `ledger` chưa có cơ chế dọn ở phiên bản đầu.

### 4.3 Danh mục

Người dùng đã đăng nhập được đọc, không ai được ghi từ app. Id cố định, không sinh ngẫu nhiên.

| Collection | Id ví dụ | Phần |
|---|---|---|
| `shop_items/{itemId}` | `streak_freeze`, `double_gems`, `save_streak` | 2 |
| `achievement_definitions/{code}` | `first_word`, `total_100`, `streak_7` | 3 |
| `companion_definitions/{id}` | `pet_golden_cat`, `plant_sakura` | 4 |

Danh mục được nạp bằng script seed trong `functions/` (mục 8). Tên và mô tả lưu dưới dạng khoá l10n; chuỗi hiển thị nằm trong file `.arb` của app.

### 4.4 Collection có sẵn

`users_profile/{uid}` và `backups/{uid}` giữ nguyên rules hiện tại. `users_profile` tiếp tục chứa email và tên hiển thị do app ghi.

## 5. Rules

Thêm vào `firestore.rules`, đặt trước khối chặn tất cả:

```
match /players/{uid} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;

  match /{sub=**} {
    allow read: if request.auth != null && request.auth.uid == uid;
    allow write: if false;
  }
}

match /shop_items/{id} {
  allow read: if request.auth != null;
  allow write: if false;
}
match /achievement_definitions/{id} {
  allow read: if request.auth != null;
  allow write: if false;
}
match /companion_definitions/{id} {
  allow read: if request.auth != null;
  allow write: if false;
}
```

Trước khi sửa rules, đọc `.agents/skills/firebase-security-rules-auditor/SKILL.md` theo `CLAUDE.md` của repo này.

## 6. Cloud Functions, phần 1

### 6.1 Quy ước chung

- `setGlobalOptions({region: "asia-southeast1", maxInstances: 10})`, cùng vùng với Firestore.
- Mọi hàm là `onCall` từ `firebase-functions/https`. Thiếu `request.auth` thì ném `unauthenticated`.
- Dữ liệu vào được kiểm tra kiểu và giới hạn bằng tay trong `domain/events.ts`; sai thì ném `invalid-argument`.
- Mã lỗi nghiệp vụ dùng `failed-precondition` kèm `details.reason` là một chuỗi cố định (`not-imported`, `insufficient-gems`…). App dịch theo `reason`, không hiển thị `message`.

### 6.2 `importGuestProgress`

Tạo `players/{uid}` từ dữ liệu trên máy. Gọi sau mỗi lần đăng nhập; chỉ lần đầu tiên của một tài khoản có tác dụng.

Vào:

```ts
{
  deviceId: string,
  profile: {
    gems: number,
    experience: number,
    totalLearned: number,
    currentStreak: number,
    longestStreak: number,
    lastActiveDay: string | null   // yyyy-MM-dd, ngày theo giờ máy
  }
}
```

Ra: `{ imported: boolean, player: PlayerSnapshot }`.

Trong một transaction:

- `players/{uid}` đã tồn tại: không đổi gì, trả `imported: false` cùng trạng thái hiện có.
- Chưa tồn tại: tạo mới với các giá trị đã kẹp theo bảng dưới, ghi một dòng `ledger` kiểu `import`, trả `imported: true`.

| Trường | Quy tắc nhập |
|---|---|
| `gems` | `min(gems, 2000)`, không âm |
| `xp` | `min(experience, 1 000 000)`, không âm |
| `level` | Tính lại từ `xp`, không lấy từ máy |
| `totalLearned` | `min(totalLearned, 100 000)`, không âm |
| `streak.longest` | `min(longestStreak, 3650)` |
| `streak.current`, `streak.lastDay` | Nhận nếu `lastActiveDay` là hôm nay hoặc hôm qua theo ngày UTC của server, cho lệch một ngày vì múi giờ; ngược lại `current = 0`, `lastDay = null`. `current` không vượt `longest` |

Không nhập túi đồ, thành tựu, companion: ba tính năng này đang ẩn ở bản offline và chưa có người dùng thật.

### 6.3 `syncProgress`

Nhận một lô sự kiện, tính thưởng, trả về trạng thái mới.

Vào:

```ts
{
  deviceId: string,
  events: Array<{
    seq: number,      // tăng dần theo máy, không dùng lại
    type: string,
    at: number,       // thời điểm xảy ra, ms từ epoch
    day: string,      // yyyy-MM-dd theo giờ máy lúc xảy ra
    data?: object
  }>                  // tối đa 200; mảng rỗng là hợp lệ, dùng để lấy trạng thái
}
```

Ra: `{ ackSeq: number, player: PlayerSnapshot }`. `PlayerSnapshot` gồm `gems`, `xp`, `level`, `totalLearned`, `streak`. Phần 3 thêm `newlyUnlocked` vào kết quả.

Trong một transaction:

1. Đọc `players/{uid}`. Chưa có thì ném `failed-precondition` với `reason: "not-imported"`.
2. Bỏ các sự kiện có `seq <= devices[deviceId].lastSeq`. Sắp phần còn lại theo `seq`.
3. Với từng sự kiện: kiểm tra định dạng và thời gian (mục 6.4). Sự kiện hỏng bị bỏ qua.
4. Xác định ngày tính trần (mục 6.4), đọc các document `days` cần dùng.
5. Tính thưởng theo mục 6.5, áp trần theo mục 6.5, cập nhật streak theo mục 6.7.
6. Ghi `players/{uid}` (số dư, `level`, `streak`, `devices[deviceId].lastSeq = seq lớn nhất trong lô`, kể cả seq của sự kiện bị bỏ qua), các document `days`, và một dòng `ledger` nếu số dư đổi.

`ackSeq` là `lastSeq` sau khi ghi. App xoá khỏi hàng đợi mọi sự kiện có `seq <= ackSeq`.

### 6.4 Kiểm tra thời gian

Gọi `today` là ngày UTC của server.

| Điều kiện | Xử lý |
|---|---|
| `at` muộn hơn giờ server quá 5 phút | Bỏ qua sự kiện |
| `day` lệch quá một ngày so với ngày UTC của `at` | Bỏ qua sự kiện |
| `day` trong khoảng `today - 7` đến `today + 1` | Tính vào trần của `day`; được tính streak |
| `day` cũ hơn `today - 7` | Vẫn tính thưởng, nhưng vào trần của `today`; không tính streak |

Dòng cuối chặn việc khai sự kiện cho thật nhiều ngày cũ để vượt trần ngày, mà người dùng thật offline lâu vẫn nhận được thưởng.

### 6.5 Bảng sự kiện, thưởng và trần

Các con số là bản sao của logic hiện có trong app (xem `report.md`, nhóm D). Chúng nằm trong `functions/src/config/rewards.ts`.

| `type` | `data` | XP | Gems | Trần mỗi ngày |
|---|---|---|---|---|
| `feed_quiz_correct` | `multiplier` thuộc {1, 1.25, 1.5, 2}; `eventActive` bool; `combo` bool | `round(10 × multiplier)`, cộng 3 nếu `combo` | 3 nếu `eventActive`, ngược lại 1 | 200 câu |
| `feed_reward_card` | `xp`, `gems` do app quay | `min(xp, 39)` | `min(gems, 19)` | 30 thẻ |
| `flashcard_session` | `remembered` (1 đến 200) | 5 mỗi thẻ | 1 mỗi thẻ | 200 thẻ |
| `test_level_up` | `level` (level từ vừa đạt) | 1 và thấp hơn: 5; 2: 10; 3: 15; 4: 25; từ 5: 40 | 0: 5; 1: 10; 2: 20; 3: 35; 4: 50; từ 5: 75 | 100 lần |
| `matching_session` | `pairs` (1 đến 50) | 20 mỗi cặp | 5 mỗi cặp | 100 cặp |
| `quest_completed` | `questId` | 0 | Theo bảng quest của server | 3 quest khác nhau |
| `word_mastered` | không | 0 | 0 | không có trần; `totalLearned + 1` |
| `word_unmastered` | không | 0 | 0 | không có trần; `totalLearned - 1`, không dưới 0 |

Quy tắc kèm theo:

- **Giá trị ngoài miền** (`multiplier` lạ, `level` âm, `pairs` bằng 0): bỏ qua sự kiện.
- **Thẻ thưởng** chỉ được trả khi `feedQuizSinceReward >= 3`, sau đó bộ đếm về 0. Mỗi `feed_quiz_correct` tăng bộ đếm, tối đa 3, kể cả câu đã vượt trần. App có bộ đếm riêng trong bộ nhớ và về 0 khi đóng app, nên app luôn đòi ít nhất bằng server; trường hợp lệch duy nhất là ngay sau khi liên kết tài khoản, khi app đã đếm trước còn server bắt đầu từ 0, và thẻ đầu tiên có thể không được trả.
- **Bảng quest** là bản sao `MissionPool` của app (`lib/page/daily_quest/models/mission_pool.dart`): quest mặc định 5 gems; trong pool có học 5 từ (10), học 10 từ (15), một bài kiểm tra (15), 5 câu quiz feed (10), 10 câu quiz feed (15). Mỗi ngày nhận tối đa một quest mặc định và hai quest của pool; cùng một `questId` trong một ngày chỉ trả một lần.
- **Vượt trần theo nguồn:** phần vượt không được thưởng. Sự kiện tính theo đơn vị (`flashcard_session`, `matching_session`) được trả cho phần còn trong trần.
- **Trần tổng mỗi ngày:** 2000 gems và 5000 XP cho mọi nguồn cộng lại. Phần vượt bị cắt.
- `type` không có trong bảng: bỏ qua.

Các trần là giá trị đề xuất và sửa được trong `rewards.ts` mà không đổi cấu trúc dữ liệu.

### 6.6 Level

Server giữ một bản sao của `LevelHelper` phía app: XP cần cho level `n` là `round(30 × 1.5 × (n - 1) + 30)`. `level` là số level đạt được khi trừ dần `xp` theo công thức đó, bắt đầu từ 1. Hai bên phải cho cùng kết quả; test phía server dùng cùng bộ số với test phía app.

### 6.7 Streak

Một ngày là **ngày streak** khi có đủ 3 quest khác nhau hoàn thành cho ngày đó (cùng quy tắc với app: cả ba nhiệm vụ ngày xong thì đánh dấu chuỗi).

Khi ngày `D` vừa trở thành ngày streak:

| Quan hệ giữa `D` và `streak.lastDay` | Kết quả |
|---|---|
| `lastDay` là null | `current = 1`, `lastDay = D` |
| `D` bằng `lastDay` | Không đổi |
| `D` là ngày liền sau `lastDay` | `current + 1`, `lastDay = D` |
| `D` sau `lastDay` hơn một ngày | `current = 1`, `lastDay = D` (phần 2 chèn bước dùng Streak Freeze vào đây) |
| `D` trước `lastDay` | Tính lại từ đầu: truy vấn các `days` có `streakDay == true`, đếm chuỗi ngày liền nhau kết thúc ở ngày mới nhất |

`longest` là giá trị lớn nhất `current` từng đạt.

Server không tự đưa `current` về 0 khi người dùng bỏ học: không có hàm chạy theo lịch. `current` là độ dài chuỗi tính tới `lastDay`. Bên đọc coi chuỗi là đã đứt khi `lastDay` cũ hơn hôm qua; lần đánh dấu kế tiếp sẽ đặt lại theo bảng trên.

Truy vấn tính lại cần index một trường trên `streakDay`, Firestore tự tạo; `firestore.indexes.json` chưa cần đổi.

## 7. Phác thảo các phần sau

Mỗi phần có spec riêng; các ý dưới đây là hướng đã thống nhất.

### 7.1 Phần 2: shop và túi đồ

- `shop_items/{itemId}`: `kind` (`streak_freeze`, `save_streak`, `double_gems`), `price` (int), `maxOwned`, `active`, `sortOrder`, `titleKey`, `descriptionKey`, `iconKey`. Giá giữ như hiện nay: 100, 500, 1000.
- Bỏ `stock` toàn cục. Giới hạn sở hữu đề xuất: Streak Freeze 2, Double Gems 3, Save Streak 1.
- `purchaseItem({itemId, quantity, requestId})`: một transaction kiểm tra vật phẩm còn bán, đủ gems, không vượt `maxOwned`; trừ gems, cộng `inventory`, ghi `ledger/{requestId}`. `ledger/{requestId}` đã tồn tại thì trả lại kết quả cũ. Lỗi: `insufficient-gems`, `max-owned`, `item-unavailable`.
- `useItem({itemId, requestId})` cho hai vật phẩm dùng chủ động:
  - **Double Gems:** ghi `buffs.doubleGems = {from, until}`, 30 phút tính từ giờ server. Sự kiện có `at` trong khoảng đó được nhân đôi gems trước khi áp trần ngày, nên buff không vượt được trần.
  - **Save Streak:** khi streak bị đặt lại, server lưu `lostStreak = {value, lostOn}`. Trong 7 ngày kể từ `lostOn`, dùng vật phẩm sẽ cộng `value` trở lại vào `current`.
- **Streak Freeze** không cần hàm: ở dòng "`D` sau `lastDay` hơn một ngày" của mục 6.7, nếu số ngày lỡ không vượt số Freeze đang có thì trừ Freeze, đánh dấu `days/{ngày lỡ}.frozen = true` và nối chuỗi.
- Thêm trần số lượt gọi để hạn chế spam, và cân nhắc bật App Check (`enforceAppCheck`) trước khi mở shop.

### 7.2 Phần 3: thành tựu

- `achievement_definitions/{code}` thêm trường `metric` (`totalLearned`, `currentStreak`, `unitsCompleted`, `special`) thay cho việc suy ra từ `category` như code app hiện nay.
- Cuối mỗi lượt `syncProgress` và `importGuestProgress`, server chấm các thành tựu chưa mở, ghi `players/{uid}/achievements/{code}`, trả `newlyUnlocked: string[]`.
- Cần thêm loại sự kiện `unit_completed` (cho `complete_unit_1`, `complete_unit_5`) và quy tắc cho `night_owl`. Định nghĩa "hoàn thành unit" chốt ở spec phần 3.
- Việc này sửa mục 4 của report: `checkAfterLearning` không còn là thứ phải nhớ gọi ở từng màn học.

### 7.3 Phần 4: companion

- `players/{uid}.companion`: `definitionId`, `level`, `foodInventory`, `pendingWords`, `foodUsedInCurrentLevel`, `totalFoodUsed`, `totalWordsLearned`, `xpBonus`, `adoptedAt`.
- Food được cộng trong `syncProgress` từ các sự kiện được tính là "học một từ" (đề xuất: `word_mastered` và `test_level_up`), theo `wordsPerFood` của định nghĩa.
- `xpBonus` được nhân vào XP của mọi sự kiện ngay trong `syncProgress`.
- `adoptCompanion({definitionId})` kiểm tra `unlockUserLevel` so với `level` của player; `switchCompanion` chuyển con cũ vào `companion_history`; `feedCompanion({requestId})` trừ food, tăng tiến độ, lên cấp.
- Việc này sửa cả bốn ý của mục 5 trong report: food không còn phụ thuộc `activeCompanion` phía app, bonus XP có tác dụng thật, điều kiện mở khoá được kiểm tra, và không còn chỗ truyền nhầm số food vào số từ.

## 8. Bố cục code

```
functions/src/
  index.ts                     setGlobalOptions và export các hàm
  config/rewards.ts            bảng thưởng, trần, giới hạn nhập, bảng quest
  domain/events.ts             kiểu sự kiện và kiểm tra dữ liệu vào
  domain/level.ts              công thức level
  domain/rewards.ts            (sự kiện, bộ đếm ngày) -> thưởng; hàm thuần
  domain/streak.ts             cập nhật streak; hàm thuần
  domain/importProfile.ts      kẹp dữ liệu khách; hàm thuần
  data/playerStore.ts          đọc và ghi players, days, ledger trong transaction
  handlers/importGuestProgress.ts
  handlers/syncProgress.ts
  scripts/seedCatalog.ts       nạp danh mục (từ phần 2)
```

`index.ts` hiện import `onRequest` và `logger` mà không dùng nên build lỗi TS6133; hai dòng đó được thay bằng import thật khi thêm hàm đầu tiên.

## 9. Kiểm thử

Repo chưa có trình chạy test. Thêm `vitest` và script `npm test`.

| Loại | Phạm vi | Công cụ |
|---|---|---|
| Unit | `domain/*`: bảng thưởng, trần theo nguồn và trần tổng, kẹp dữ liệu nhập, công thức level, mọi dòng của bảng streak, kiểm tra thời gian | vitest, không cần emulator |
| Tích hợp | Hai handler: gọi lặp không cộng hai lần, sự kiện hỏng vẫn được xác nhận, `not-imported`, hai máy cùng tài khoản | Firestore emulator và `firebase-functions-test` |
| Rules | Chủ tài khoản đọc được `players` của mình, không ghi được; người khác không đọc được; danh mục chỉ đọc | `@firebase/rules-unit-testing` trên emulator |

## 10. Triển khai và việc thủ công của chủ dự án

1. Chuyển project `project-dungeon-b317f` sang gói **Blaze**. Cloud Functions không deploy được ở gói Spark.
2. `git init` cho repo này. Hiện chưa có lịch sử, nên chưa commit được tài liệu này và không có đường lùi khi sửa rules.
3. Thứ tự deploy: rules trước, functions sau. App chỉ bật `cloudEnabled` khi cả hai đã lên.
4. Spec bản offline yêu cầu đặt rules thành chặn toàn bộ trong lúc app chưa dùng cloud. Bộ rules ở mục 5 thay cho trạng thái đó.

## 11. Rủi ro và giới hạn

| Rủi ro | Cách xử lý |
|---|---|
| Sửa app để gửi sự kiện giả | Trần theo nguồn và trần tổng mỗi ngày. Tối đa 2000 gems một ngày cho một tài khoản |
| Tạo nhiều tài khoản, mỗi tài khoản nhập 2000 gems | Gems không chuyển được giữa các tài khoản, nên không có lợi ích cộng dồn |
| Đồng hồ máy bị chỉnh | `at` trong tương lai bị bỏ; ngày cũ hơn 7 ngày tính vào trần hôm nay |
| Hai máy cùng tài khoản khôi phục cùng một file backup rồi cùng học một từ | `totalLearned` trên server đếm hai lần. Chấp nhận ở phiên bản đầu; chỉ ảnh hưởng thành tựu |
| Bảng thưởng ở app và server lệch nhau sau một bản cập nhật | Số của server thắng; app ghi đè số trên máy sau mỗi lần đồng bộ. Người dùng có thể thấy số gems giảm nhẹ |
| `devices` phình ra khi cài lại nhiều lần | Mỗi lần cài thêm một mục nhỏ. Chưa xử lý |
| Chi phí | Một lượt gọi function cho mỗi lô, mỗi lô khoảng 3 đến 12 lượt đọc/ghi Firestore |
