import {randomUUID} from "node:crypto";
import {afterEach, describe, expect, it, vi} from "vitest";
import {purchaseItem} from "../../src/handlers/purchaseItem";
import {db, newUid, NOW, seedPlayer, storeWithCatalog} from "./emulator";

const buy = (itemId: string, quantity: number, expectedPrice: number, requestId = randomUUID()) =>
  ({itemId, quantity, expectedPrice, requestId});

async function setup(gems: number, overrides: Parameters<typeof storeWithCatalog>[0] = {}) {
  const store = await storeWithCatalog(overrides);
  const uid = await seedPlayer({fields: {gems}});
  return {uid, deps: {store, now: () => NOW}};
}
const owned = async (uid: string, itemId: string) =>
  (await db.doc(`players/${uid}/inventory/${itemId}`).get()).get("quantity");
const gemsOf = async (uid: string) => (await db.doc(`players/${uid}`).get()).get("gems");
const purchases = async (uid: string) =>
  (await db.collection(`players/${uid}/ledger`).where("type", "==", "purchase").get()).size;
const fp = (reason: string) => ({code: "failed-precondition", reason});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("purchaseItem", () => {
  it("player chưa nhập: not-imported", async () => {
    const {deps} = await setup(0);
    await expect(purchaseItem(newUid(), buy("streak_freeze", 1, 100), deps))
      .rejects.toMatchObject(fp("not-imported"));
  });

  it("tiêu chí 1: 250 gems mua 2 Freeze còn 50; mua cái thứ ba thì max-owned", async () => {
    const {uid, deps} = await setup(250);
    const req = buy("streak_freeze", 2, 100);
    const out = await purchaseItem(uid, req, deps);

    expect(out.player.gems).toBe(50);
    expect(out.item).toEqual({itemId: "streak_freeze", quantity: 2});
    expect(await gemsOf(uid)).toBe(50);
    expect(await owned(uid, "streak_freeze")).toBe(2);
    const row = (await db.doc(`players/${uid}/ledger/${req.requestId}`).get()).data();
    expect(row).toMatchObject({
      type: "purchase", gems: -200, xp: 0, itemId: "streak_freeze", quantity: 2, price: 100,
    });

    await expect(purchaseItem(uid, buy("streak_freeze", 1, 100), deps))
      .rejects.toMatchObject(fp("max-owned"));
    expect(await gemsOf(uid)).toBe(50);
  });

  it("tiêu chí 2: gửi lại đúng lượt mua thì không trừ lần hai và trả 200", async () => {
    const {uid, deps} = await setup(250);
    const req = buy("streak_freeze", 2, 100);
    const first = await purchaseItem(uid, req, deps);
    const again = await purchaseItem(uid, req, deps);

    expect(again).toEqual(first);
    expect(await gemsOf(uid)).toBe(50);
    expect(await owned(uid, "streak_freeze")).toBe(2);
    expect(await purchases(uid)).toBe(1);
  });

  it("cùng requestId nhưng khác quantity: invalid-argument", async () => {
    const {uid, deps} = await setup(250);
    const req = buy("streak_freeze", 1, 100);
    await purchaseItem(uid, req, deps);
    await expect(purchaseItem(uid, {...req, quantity: 2}, deps))
      .rejects.toMatchObject({code: "invalid-argument"});
  });

  it("tiêu chí 3: 400 gems mua Double Gems thì insufficient-gems", async () => {
    const {uid, deps} = await setup(400);
    await expect(purchaseItem(uid, buy("double_gems", 1, 500), deps))
      .rejects.toMatchObject(fp("insufficient-gems"));
    expect(await gemsOf(uid)).toBe(400);
    expect((await db.doc(`players/${uid}/inventory/double_gems`).get()).exists).toBe(false);
  });

  it("giá app hiển thị đã cũ: price-changed", async () => {
    const {uid, deps} = await setup(1000, {streak_freeze: {price: 120}});
    await expect(purchaseItem(uid, buy("streak_freeze", 1, 100), deps))
      .rejects.toMatchObject(fp("price-changed"));
  });

  it("tiêu chí 8 (nửa đầu): active false thì item-unavailable", async () => {
    const {uid, deps} = await setup(1000, {double_gems: {active: false}});
    await expect(purchaseItem(uid, buy("double_gems", 1, 500), deps))
      .rejects.toMatchObject(fp("item-unavailable"));
  });

  it("document danh mục hỏng: item-unavailable và ghi một dòng log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const {uid, deps} = await setup(1000, {streak_freeze: {price: "abc"}});
    await expect(purchaseItem(uid, buy("streak_freeze", 1, 100), deps))
      .rejects.toMatchObject(fp("item-unavailable"));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("vật phẩm code không biết: item-unavailable", async () => {
    const {uid, deps} = await setup(1000);
    await expect(purchaseItem(uid, buy("khong_co", 1, 100), deps))
      .rejects.toMatchObject(fp("item-unavailable"));
  });

  it("hai lượt mua song song khi chỉ đủ gems cho một: đúng một lượt thành công", async () => {
    const {uid, deps} = await setup(100);
    const results = await Promise.allSettled([
      purchaseItem(uid, buy("streak_freeze", 1, 100), deps),
      purchaseItem(uid, buy("streak_freeze", 1, 100), deps),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject(fp("insufficient-gems"));
    expect(await gemsOf(uid)).toBe(0);
    expect(await owned(uid, "streak_freeze")).toBe(1);
  });
});
