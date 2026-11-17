import {randomUUID} from "node:crypto";
import {Timestamp} from "firebase-admin/firestore";
import {describe, expect, it} from "vitest";
import {purchaseItem} from "../../src/handlers/purchaseItem";
import {syncProgress} from "../../src/handlers/syncProgress";
import {useItem} from "../../src/handlers/useItem";
import {db, newUid, NOW, seedPlayer, store, storeWithCatalog, TODAY} from "./emulator";

const MIN30 = 30 * 60 * 1000;
const at = (now: number) => ({store, now: () => now});
const deps = at(NOW);
const use = (itemId: string, requestId = randomUUID()) => ({itemId, requestId});
const fp = (reason: string) => ({code: "failed-precondition", reason});
const owned = async (uid: string, itemId: string) =>
  (await db.doc(`players/${uid}/inventory/${itemId}`).get()).get("quantity");
const playerDoc = async (uid: string) => (await db.doc(`players/${uid}`).get()).data();
const quests = (startSeq: number) =>
  ["default_active_time", "learn_5", "feed_5"].map((questId, i) => ({
    seq: startSeq + i, type: "quest_completed", at: NOW, day: TODAY, data: {questId},
  }));
const flashcards = (seq: number, eventAt: number) =>
  [{seq, type: "flashcard_session", at: eventAt, day: TODAY, data: {remembered: 10}}];

describe("useItem", () => {
  it("player chưa nhập: not-imported", async () => {
    await expect(useItem(newUid(), use("double_gems"), deps))
      .rejects.toMatchObject(fp("not-imported"));
  });

  it("Double Gems: ghi buff 30 phút, trừ túi, ghi ledger theo requestId", async () => {
    const uid = await seedPlayer({inventory: {double_gems: 1}});
    const req = use("double_gems");
    const out = await useItem(uid, req, deps);

    expect(out.effect).toEqual({kind: "double_gems", until: NOW + MIN30});
    expect(out.item).toEqual({itemId: "double_gems", quantity: 0});
    expect(await owned(uid, "double_gems")).toBe(0);
    const buff = (await playerDoc(uid))?.buffs.doubleGems;
    expect((buff.from as Timestamp).toMillis()).toBe(NOW);
    expect((buff.until as Timestamp).toMillis()).toBe(NOW + MIN30);
    const row = (await db.doc(`players/${uid}/ledger/${req.requestId}`).get()).data();
    expect(row).toMatchObject({
      type: "use_item", gems: 0, xp: 0, itemId: "double_gems", quantity: 1,
      effect: {kind: "double_gems", until: NOW + MIN30},
    });
  });

  it("dùng tiếp khi buff đang chạy: giữ from, cộng thêm 30 phút", async () => {
    const uid = await seedPlayer({inventory: {double_gems: 2}});
    await useItem(uid, use("double_gems"), deps);
    const out = await useItem(uid, use("double_gems"), at(NOW + 10 * 60_000));

    expect(out.effect).toEqual({kind: "double_gems", until: NOW + 2 * MIN30});
    const buff = (await playerDoc(uid))?.buffs.doubleGems;
    expect((buff.from as Timestamp).toMillis()).toBe(NOW);
  });

  it("gửi lại cùng requestId: trả effect đã lưu, không trừ lần hai", async () => {
    const uid = await seedPlayer({inventory: {double_gems: 2}});
    const req = use("double_gems");
    const first = await useItem(uid, req, deps);
    const again = await useItem(uid, req, at(NOW + 60_000));

    expect(again).toEqual(first);
    expect(await owned(uid, "double_gems")).toBe(1);
  });

  it("tiêu chí 7: phiên 10 thẻ trong 30 phút buff được 20 gems và 50 XP; sau khi hết hạn được 10", async () => {
    const inside = await seedPlayer({inventory: {double_gems: 1}});
    await useItem(inside, use("double_gems"), deps);
    const a = await syncProgress(inside, {deviceId: "dev-1", events: flashcards(1, NOW)}, deps);
    expect(a.player.gems).toBe(20);
    expect(a.player.xp).toBe(50);

    const expired = await seedPlayer({inventory: {double_gems: 1}});
    await useItem(expired, use("double_gems"), at(NOW - 40 * 60_000));
    const b = await syncProgress(expired, {deviceId: "dev-1", events: flashcards(1, NOW)}, deps);
    expect(b.player.gems).toBe(10);
  });

  it("tiêu chí 5 và 6: lỡ hai ngày khi có 1 Freeze, rồi Save Streak khôi phục chuỗi", async () => {
    const uid = await seedPlayer({
      fields: {streak: {current: 10, longest: 10, lastDay: "2026-11-14"}},
      inventory: {streak_freeze: 1, save_streak: 1},
    });
    const synced = await syncProgress(uid, {deviceId: "dev-1", events: quests(1)}, deps);
    expect(synced.player.streak).toEqual({current: 1, longest: 10, lastDay: TODAY});
    expect(await owned(uid, "streak_freeze")).toBe(1);
    expect((await playerDoc(uid))?.lostStreak).toEqual({value: 10, lostOn: "2026-11-15"});

    const out = await useItem(uid, use("save_streak"), deps);
    expect(out.effect).toEqual({kind: "save_streak", restored: 10});
    expect(out.player.streak).toEqual({current: 11, longest: 11, lastDay: TODAY});
    expect(out.item).toEqual({itemId: "save_streak", quantity: 0});
    expect((await playerDoc(uid))?.lostStreak).toBeUndefined();
    expect((await playerDoc(uid))?.streak).toEqual({current: 11, longest: 11, lastDay: TODAY});

    await expect(useItem(uid, use("save_streak"), deps)).rejects.toMatchObject(fp("not-owned"));
  });

  it("Save Streak khi không có chuỗi nào để khôi phục: no-lost-streak, túi giữ nguyên", async () => {
    const uid = await seedPlayer({inventory: {save_streak: 1}});
    await expect(useItem(uid, use("save_streak"), deps)).rejects.toMatchObject(fp("no-lost-streak"));
    expect(await owned(uid, "save_streak")).toBe(1);
  });

  it("Save Streak khi lostStreak đã quá 7 ngày: no-lost-streak", async () => {
    const uid = await seedPlayer({
      fields: {lostStreak: {value: 5, lostOn: "2026-11-09"}},
      inventory: {save_streak: 1},
    });
    await expect(useItem(uid, use("save_streak"), deps)).rejects.toMatchObject(fp("no-lost-streak"));
  });

  it("Streak Freeze không dùng chủ động được: not-usable", async () => {
    const uid = await seedPlayer({inventory: {streak_freeze: 1}});
    await expect(useItem(uid, use("streak_freeze"), deps)).rejects.toMatchObject(fp("not-usable"));
  });

  it("tiêu chí 8 (nửa sau): vật phẩm ngừng bán vẫn dùng được", async () => {
    const catalogStore = await storeWithCatalog({double_gems: {active: false}});
    const shopDeps = {store: catalogStore, now: () => NOW};
    const uid = await seedPlayer({fields: {gems: 1000}, inventory: {double_gems: 1}});

    await expect(purchaseItem(uid, {
      itemId: "double_gems", quantity: 1, expectedPrice: 500, requestId: randomUUID(),
    }, shopDeps)).rejects.toMatchObject(fp("item-unavailable"));
    const out = await useItem(uid, use("double_gems"), shopDeps);
    expect(out.effect.kind).toBe("double_gems");
  });
});
