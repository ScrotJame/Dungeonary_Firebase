import {describe, expect, it} from "vitest";
import {CATALOG, type CatalogItem} from "../../src/config/shop";
import {
  decidePurchase,
  decideUse,
  extendDoubleGems,
  parseCatalogItem,
  parsePurchaseInput,
  parseUseInput,
  type PurchaseState,
  type UseState,
} from "../../src/domain/shop";

const RID = "123e4567-e89b-42d3-a456-426614174000";

/** Lỗi mà `fn` ném ra; ném tiếp nếu `fn` không ném gì. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a throw");
}
const fp = (reason: string) => ({code: "failed-precondition", reason});

describe("parsePurchaseInput", () => {
  const body = (over: object = {}) => ({
    itemId: "streak_freeze", quantity: 1, expectedPrice: 100, requestId: RID, ...over,
  });

  it("nhận dữ liệu hợp lệ", () => {
    expect(parsePurchaseInput(body({quantity: 10}))).toEqual(body({quantity: 10}));
  });

  it("itemId đúng dạng nhưng không có thật vẫn qua bước này", () => {
    expect(parsePurchaseInput(body({itemId: "khong_co"})).itemId).toBe("khong_co");
  });

  it.each([
    ["không phải object", null],
    ["requestId không phải UUID", body({requestId: "abc"})],
    ["requestId bỏ gạch ngang", body({requestId: RID.replaceAll("-", "")})],
    ["quantity 0", body({quantity: 0})],
    ["quantity 11", body({quantity: 11})],
    ["quantity không nguyên", body({quantity: 1.5})],
    ["expectedPrice âm", body({expectedPrice: -1})],
    ["expectedPrice là chuỗi", body({expectedPrice: "100"})],
    ["itemId rỗng", body({itemId: ""})],
    ["itemId có dấu /", body({itemId: "a/b"})],
    ["itemId dạng __x__", body({itemId: "__x__"})],
    ["itemId không phải chuỗi", body({itemId: 1})],
  ])("%s thì invalid-argument", (_name, input) => {
    expect(thrown(() => parsePurchaseInput(input))).toMatchObject({code: "invalid-argument"});
  });
});

describe("parseUseInput", () => {
  it("nhận dữ liệu hợp lệ", () => {
    expect(parseUseInput({itemId: "double_gems", requestId: RID}))
      .toEqual({itemId: "double_gems", requestId: RID});
  });

  it.each([
    ["thiếu requestId", {itemId: "double_gems"}],
    ["requestId sai dạng", {itemId: "double_gems", requestId: "x"}],
    ["itemId sai dạng", {itemId: "../x", requestId: RID}],
  ])("%s thì invalid-argument", (_name, input) => {
    expect(thrown(() => parseUseInput(input))).toMatchObject({code: "invalid-argument"});
  });
});

describe("parseCatalogItem", () => {
  const doc = (over: object = {}) => ({...CATALOG.streak_freeze, ...over});

  it("đọc document đủ trường", () => {
    expect(parseCatalogItem("streak_freeze", doc())).toEqual(CATALOG.streak_freeze);
  });

  it("bỏ qua trường thừa", () => {
    expect(parseCatalogItem("streak_freeze", doc({kind: "streak_freeze"})))
      .toEqual(CATALOG.streak_freeze);
  });

  it.each([
    ["itemId code không biết", "khong_co", doc()],
    ["thiếu price", "streak_freeze", doc({price: undefined})],
    ["price là chuỗi", "streak_freeze", doc({price: "100"})],
    ["price vượt 1 000 000", "streak_freeze", doc({price: 1_000_001})],
    ["maxOwned bằng 0", "streak_freeze", doc({maxOwned: 0})],
    ["maxOwned bằng 100", "streak_freeze", doc({maxOwned: 100})],
    ["active không phải bool", "streak_freeze", doc({active: "yes"})],
    ["sortOrder không nguyên", "streak_freeze", doc({sortOrder: 1.5})],
    ["titleKey thiếu", "streak_freeze", doc({titleKey: undefined})],
    ["iconKey không phải chuỗi", "streak_freeze", doc({iconKey: 3})],
  ])("%s thì null", (_name, itemId, data) => {
    expect(parseCatalogItem(itemId, data)).toBeNull();
  });
});

describe("decidePurchase: các dòng của bảng 5.1 theo thứ tự", () => {
  const input = (over: object = {}) => ({
    itemId: "streak_freeze", quantity: 1, expectedPrice: 100, requestId: RID, ...over,
  });
  const item = (over: Partial<CatalogItem> = {}): CatalogItem => ({...CATALOG.streak_freeze, ...over});
  const state = (over: Partial<PurchaseState> = {}): PurchaseState => ({
    gems: 1000, item: item(), owned: 0, ledger: undefined, ...over,
  });
  const purchaseRow = {type: "purchase", itemId: "streak_freeze", quantity: 1};

  it("1. ledger đã có lượt mua khớp: replay, kể cả khi giờ không đủ gems", () => {
    expect(decidePurchase(input(), state({ledger: purchaseRow, gems: 0}))).toEqual({kind: "replay"});
  });

  it.each([
    ["khác itemId", {...purchaseRow, itemId: "double_gems"}],
    ["khác quantity", {...purchaseRow, quantity: 2}],
    ["khác loại", {type: "use_item", itemId: "streak_freeze", quantity: 1}],
  ])("2. ledger đã có nhưng %s: invalid-argument, đứng trước item-unavailable", (_n, ledger) => {
    expect(thrown(() => decidePurchase(input(), state({ledger, item: null}))))
      .toMatchObject({code: "invalid-argument"});
  });

  it("3. không có vật phẩm: item-unavailable, đứng trước price-changed", () => {
    expect(thrown(() => decidePurchase(input({expectedPrice: 1}), state({item: null}))))
      .toMatchObject(fp("item-unavailable"));
  });

  it("3. active false: item-unavailable", () => {
    expect(thrown(() => decidePurchase(input(), state({item: item({active: false})}))))
      .toMatchObject(fp("item-unavailable"));
  });

  it("4. expectedPrice khác price: price-changed, đứng trước max-owned", () => {
    expect(thrown(() => decidePurchase(input({expectedPrice: 90}), state({owned: 2}))))
      .toMatchObject(fp("price-changed"));
  });

  it("5. vượt maxOwned: max-owned, đứng trước insufficient-gems", () => {
    expect(thrown(() => decidePurchase(input({quantity: 2}), state({owned: 1, gems: 0}))))
      .toMatchObject(fp("max-owned"));
  });

  it("6. thiếu gems cho price × quantity: insufficient-gems", () => {
    expect(thrown(() => decidePurchase(input({quantity: 2}), state({gems: 199}))))
      .toMatchObject(fp("insufficient-gems"));
  });

  it("7. qua hết: mua, trừ đúng tổng giá", () => {
    expect(decidePurchase(input({quantity: 2}), state({gems: 200}))).toEqual({
      kind: "buy", price: 100, cost: 200, ownedAfter: 2,
    });
  });

  it("vừa chạm maxOwned vẫn mua được", () => {
    expect(decidePurchase(input(), state({owned: 1}))).toMatchObject({kind: "buy", ownedAfter: 2});
  });
});

describe("extendDoubleGems: bảng 6.2", () => {
  const NOW = Date.UTC(2026, 10, 17, 12);
  const MIN30 = 30 * 60 * 1000;

  it("chưa có buff: bắt đầu từ bây giờ", () => {
    expect(extendDoubleGems(null, NOW)).toEqual({from: NOW, until: NOW + MIN30});
  });

  it("buff đã hết (until <= now): bắt đầu lại", () => {
    expect(extendDoubleGems({from: NOW - 2 * MIN30, until: NOW}, NOW))
      .toEqual({from: NOW, until: NOW + MIN30});
  });

  it("buff đang chạy: giữ from, cộng 30 phút vào until", () => {
    expect(extendDoubleGems({from: NOW - 1000, until: NOW + 1000}, NOW))
      .toEqual({from: NOW - 1000, until: NOW + 1000 + MIN30});
  });
});

describe("decideUse: các dòng của bảng 5.2 theo thứ tự", () => {
  const NOW = Date.UTC(2026, 10, 17, 12);
  const input = (itemId: string) => ({itemId, requestId: RID});
  const state = (over: Partial<UseState> = {}): UseState => ({
    owned: 1,
    ledger: undefined,
    now: NOW,
    today: "2026-11-17",
    streak: {current: 1, longest: 10, lastDay: "2026-11-17"},
    doubleGems: null,
    lostStreak: {value: 10, lostOn: "2026-11-15"},
    ...over,
  });

  it("1. ledger đã có lượt dùng khớp: replay với effect đã lưu, kể cả khi túi đã hết", () => {
    const effect = {kind: "double_gems", until: NOW + 5};
    const ledger = {type: "use_item", itemId: "double_gems", effect};
    expect(decideUse(input("double_gems"), state({ledger, owned: 0})))
      .toEqual({kind: "replay", effect});
  });

  it.each([
    ["khác itemId", {type: "use_item", itemId: "save_streak"}],
    ["khác loại", {type: "purchase", itemId: "double_gems", quantity: 1}],
  ])("2. ledger đã có nhưng %s: invalid-argument, đứng trước not-usable", (_n, ledger) => {
    expect(thrown(() => decideUse(input("double_gems"), state({ledger}))))
      .toMatchObject({code: "invalid-argument"});
  });

  it.each(["streak_freeze", "khong_co"])("3. %s: not-usable, đứng trước not-owned", (itemId) => {
    expect(thrown(() => decideUse(input(itemId), state({owned: 0}))))
      .toMatchObject(fp("not-usable"));
  });

  it("4. túi trống: not-owned, đứng trước no-lost-streak", () => {
    expect(thrown(() => decideUse(input("save_streak"), state({owned: 0, lostStreak: null}))))
      .toMatchObject(fp("not-owned"));
  });

  it("5. Save Streak khi không có lostStreak: no-lost-streak", () => {
    expect(thrown(() => decideUse(input("save_streak"), state({lostStreak: null}))))
      .toMatchObject(fp("no-lost-streak"));
  });

  it("5. Save Streak khi lostStreak quá 7 ngày: no-lost-streak", () => {
    const lostStreak = {value: 10, lostOn: "2026-11-09"};
    expect(thrown(() => decideUse(input("save_streak"), state({lostStreak}))))
      .toMatchObject(fp("no-lost-streak"));
  });

  it("6. Double Gems: ghi buff mới và trả until", () => {
    expect(decideUse(input("double_gems"), state())).toEqual({
      kind: "use",
      effect: {kind: "double_gems", until: NOW + 30 * 60 * 1000},
      changes: {doubleGems: {from: NOW, until: NOW + 30 * 60 * 1000}},
    });
  });

  it("6. Save Streak: cộng value vào current, nâng longest, xoá lostStreak, giữ lastDay", () => {
    expect(decideUse(input("save_streak"), state())).toEqual({
      kind: "use",
      effect: {kind: "save_streak", restored: 10},
      changes: {
        streak: {current: 11, longest: 11, lastDay: "2026-11-17"},
        lostStreak: null,
      },
    });
  });

  it("Save Streak đúng ngày thứ 7: vẫn dùng được", () => {
    const lostStreak = {value: 3, lostOn: "2026-11-10"};
    expect(decideUse(input("save_streak"), state({lostStreak}))).toMatchObject({
      kind: "use", effect: {kind: "save_streak", restored: 3},
    });
  });
});
