import {describe, expect, it} from "vitest";
import {importGuestProgress} from "../../src/handlers/importGuestProgress";
import {syncProgress} from "../../src/handlers/syncProgress";
import {db, newUid, NOW, store, TODAY} from "./emulator";

const deps = {store, now: () => NOW};
const DAY_MS = 86_400_000;

async function newPlayer(profile: Record<string, unknown> = {}): Promise<string> {
  const uid = newUid();
  await importGuestProgress(uid, {
    deviceId: "dev-1",
    profile: {
      gems: 0,
      experience: 0,
      totalLearned: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDay: null,
      ...profile,
    },
  }, deps);
  return uid;
}

const ev = (seq: number, type: string, data?: object, over: object = {}) => ({
  seq, type, at: NOW, day: TODAY, data, ...over,
});
const sync = (uid: string, events: unknown[], deviceId = "dev-1") =>
  syncProgress(uid, {deviceId, events}, deps);
const ledgerSize = async (uid: string) =>
  (await db.collection(`players/${uid}/ledger`).get()).size;

describe("syncProgress", () => {
  it("player chưa nhập thì ném failed-precondition với reason not-imported", async () => {
    await expect(sync(newUid(), [])).rejects.toMatchObject({
      code: "failed-precondition",
      reason: "not-imported",
    });
  });

  it("mảng rỗng trả trạng thái hiện có và không ghi gì", async () => {
    const uid = await newPlayer({gems: 40});
    const out = await sync(uid, []);
    expect(out.ackSeq).toBe(0);
    expect(out.player.gems).toBe(40);
    expect(await ledgerSize(uid)).toBe(1);
  });

  it("tính thưởng, cập nhật level, ghi days và một dòng ledger", async () => {
    const uid = await newPlayer();
    const out = await sync(uid, [
      ev(1, "flashcard_session", {remembered: 10}),
      ev(2, "word_mastered"),
    ]);

    expect(out).toEqual({
      ackSeq: 2,
      player: {
        gems: 10,
        xp: 50,
        level: 2,
        totalLearned: 1,
        streak: {current: 0, longest: 0, lastDay: null},
      },
    });

    const day = (await db.doc(`players/${uid}/days/${TODAY}`).get()).data();
    expect(day).toMatchObject({
      counts: {flashcard_session: 10}, gemsEarned: 10, xpEarned: 50, streakDay: false,
    });

    const player = (await db.doc(`players/${uid}`).get()).data();
    expect(player?.devices["dev-1"].lastSeq).toBe(2);

    const ledger = await db.collection(`players/${uid}/ledger`).where("type", "==", "sync").get();
    expect(ledger.size).toBe(1);
    expect(ledger.docs[0].data()).toMatchObject({
      gems: 10, xp: 50, deviceId: "dev-1", seqFrom: 1, seqTo: 2,
    });
  });

  it("gửi lại cùng một lô không cộng hai lần", async () => {
    const uid = await newPlayer();
    const events = [ev(1, "flashcard_session", {remembered: 10})];
    await sync(uid, events);
    const again = await sync(uid, events);

    expect(again.ackSeq).toBe(1);
    expect(again.player.gems).toBe(10);
    expect(again.player.xp).toBe(50);
    expect(await ledgerSize(uid)).toBe(2);
  });

  it("sự kiện hỏng bị bỏ qua nhưng vẫn được xác nhận", async () => {
    const uid = await newPlayer();
    const out = await sync(uid, [
      ev(1, "flashcard_session", {remembered: 5}),
      ev(2, "khong_co_that"),
      ev(3, "matching_session", {pairs: 999}),
    ]);
    expect(out.ackSeq).toBe(3);
    expect(out.player.gems).toBe(5);
  });

  it("lô chỉ có sự kiện hỏng vẫn tăng lastSeq mà không ghi ledger", async () => {
    const uid = await newPlayer();
    const out = await sync(uid, [ev(4, "khong_co_that")]);
    expect(out.ackSeq).toBe(4);
    expect(await ledgerSize(uid)).toBe(1);
    const player = (await db.doc(`players/${uid}`).get()).data();
    expect(player?.devices["dev-1"].lastSeq).toBe(4);
  });

  it("hai máy cùng tài khoản có số thứ tự riêng", async () => {
    const uid = await newPlayer();
    await sync(uid, [ev(1, "flashcard_session", {remembered: 10})], "dev-1");
    const out = await sync(uid, [ev(1, "flashcard_session", {remembered: 10})], "dev-2");

    expect(out.ackSeq).toBe(1);
    expect(out.player.gems).toBe(20);
    const player = (await db.doc(`players/${uid}`).get()).data();
    expect(player?.devices["dev-1"].lastSeq).toBe(1);
    expect(player?.devices["dev-2"].lastSeq).toBe(1);
  });

  it("áp trần theo nguồn qua nhiều lượt đồng bộ trong một ngày", async () => {
    const uid = await newPlayer();
    await sync(uid, [ev(1, "flashcard_session", {remembered: 200})]);
    const out = await sync(uid, [ev(2, "flashcard_session", {remembered: 50})]);
    expect(out.player.gems).toBe(200);
    expect(out.player.xp).toBe(1000);
  });

  it("đủ ba quest trong ngày thì bắt đầu streak", async () => {
    const uid = await newPlayer();
    const out = await sync(uid, [
      ev(1, "quest_completed", {questId: "default_active_time"}),
      ev(2, "quest_completed", {questId: "learn_5"}),
      ev(3, "quest_completed", {questId: "feed_5"}),
    ]);
    expect(out.player.gems).toBe(25);
    expect(out.player.streak).toEqual({current: 1, longest: 1, lastDay: TODAY});
    const day = (await db.doc(`players/${uid}/days/${TODAY}`).get()).data();
    expect(day?.streakDay).toBe(true);
  });

  it("ngày cũ được bù sau nối lại chuỗi", async () => {
    const uid = await newPlayer();
    const quests = (startSeq: number, day: string, at: number) =>
      ["default_active_time", "learn_5", "feed_5"].map((questId, i) =>
        ev(startSeq + i, "quest_completed", {questId}, {day, at}));

    await sync(uid, quests(1, "2026-11-15", NOW - 2 * DAY_MS));
    await sync(uid, quests(4, TODAY, NOW));
    const out = await sync(uid, quests(7, "2026-11-16", NOW - DAY_MS));

    expect(out.player.streak).toEqual({current: 3, longest: 3, lastDay: TODAY});
  });

  it("bù ngày cũ nối với chuỗi dài đứng trước, bỏ qua chuỗi đã đứt từ lâu", async () => {
    const uid = await newPlayer();
    const quests = (startSeq: number, day: string, at: number) =>
      ["default_active_time", "learn_5", "feed_5"].map((questId, i) =>
        ev(startSeq + i, "quest_completed", {questId}, {day, at}));
    const seedStreakDays = async (from: string, count: number) => {
      const batch = db.batch();
      for (let i = 0; i < count; i++) {
        const day = new Date(Date.parse(`${from}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10);
        batch.set(db.doc(`players/${uid}/days/${day}`), {streakDay: true});
      }
      await batch.commit();
    };

    // Chuỗi 20 ngày từ 2026-10-27 đến 2026-11-15, và một chuỗi cũ đã đứt.
    await seedStreakDays("2026-10-27", 20);
    await seedStreakDays("2026-10-20", 3);
    await db.doc(`players/${uid}`).update({
      streak: {current: 20, longest: 20, lastDay: "2026-11-15"},
    });

    const skipped = await sync(uid, quests(1, TODAY, NOW));
    expect(skipped.player.streak).toEqual({current: 1, longest: 20, lastDay: TODAY});

    const out = await sync(uid, quests(4, "2026-11-16", NOW - DAY_MS));
    expect(out.player.streak).toEqual({current: 22, longest: 22, lastDay: TODAY});
  });

  it("lô sự kiện cũ hơn 7 ngày tính vào trần hôm nay và không tính streak", async () => {
    const uid = await newPlayer();
    const old = {day: "2026-11-07", at: NOW - 10 * DAY_MS};
    const first = await sync(uid, [
      ev(1, "flashcard_session", {remembered: 10}, old),
      ev(2, "quest_completed", {questId: "learn_5"}, old),
    ]);
    expect(first.ackSeq).toBe(2);
    expect(first.player.gems).toBe(20);
    expect(first.player.xp).toBe(50);

    // Cùng quest của một ngày cũ khác không được trả lần hai trong hôm nay.
    const older = {day: "2026-11-06", at: NOW - 11 * DAY_MS};
    const out = await sync(uid, [
      ev(3, "quest_completed", {questId: "learn_5"}, older),
      ev(4, "quest_completed", {questId: "default_active_time"}, older),
      ev(5, "quest_completed", {questId: "feed_5"}, older),
    ]);
    expect(out.ackSeq).toBe(5);
    expect(out.player.gems).toBe(35);
    expect(out.player.streak).toEqual({current: 0, longest: 0, lastDay: null});

    const today = (await db.doc(`players/${uid}/days/${TODAY}`).get()).data();
    expect(today).toMatchObject({
      counts: {flashcard_session: 10, quest_late: 3},
      gemsEarned: 35,
      xpEarned: 50,
      quests: [],
      streakDay: false,
    });
    expect((await db.doc(`players/${uid}/days/2026-11-07`).get()).exists).toBe(false);
    expect((await db.doc(`players/${uid}/days/2026-11-06`).get()).exists).toBe(false);
  });
});
