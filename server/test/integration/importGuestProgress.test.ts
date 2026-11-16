import {describe, expect, it} from "vitest";
import {importGuestProgress} from "../../src/handlers/importGuestProgress";
import {AppError} from "../../src/http/errors";
import {db, newUid, NOW, store, TODAY} from "./emulator";

const deps = {store, now: () => NOW};
const input = {
  deviceId: "dev-1",
  profile: {
    gems: 5000,
    experience: 105,
    totalLearned: 12,
    currentStreak: 3,
    longestStreak: 9,
    lastActiveDay: TODAY,
  },
};

describe("importGuestProgress", () => {
  it("tạo player với giá trị đã kẹp và một dòng ledger kiểu import", async () => {
    const uid = newUid();
    const out = await importGuestProgress(uid, input, deps);

    expect(out).toEqual({
      imported: true,
      player: {
        gems: 2000,
        xp: 105,
        level: 3,
        totalLearned: 12,
        streak: {current: 3, longest: 9, lastDay: TODAY},
      },
    });

    const doc = (await db.doc(`players/${uid}`).get()).data();
    expect(doc).toMatchObject({
      gems: 2000,
      xp: 105,
      level: 3,
      feedQuizSinceReward: 0,
      devices: {"dev-1": {lastSeq: 0}},
    });
    expect(doc?.importedAt).toBeDefined();
    expect(doc?.createdAt).toBeDefined();

    const ledger = await db.collection(`players/${uid}/ledger`).get();
    expect(ledger.size).toBe(1);
    expect(ledger.docs[0].data()).toMatchObject({
      type: "import", gems: 2000, xp: 105, deviceId: "dev-1",
    });
  });

  it("lần gọi thứ hai không đổi gì và trả imported false", async () => {
    const uid = newUid();
    await importGuestProgress(uid, input, deps);
    const again = await importGuestProgress(
      uid, {...input, profile: {...input.profile, gems: 1}}, deps);

    expect(again.imported).toBe(false);
    expect(again.player.gems).toBe(2000);
    const ledger = await db.collection(`players/${uid}/ledger`).get();
    expect(ledger.size).toBe(1);
  });

  it("dữ liệu vào sai thì ném invalid-argument và không tạo player", async () => {
    const uid = newUid();
    await expect(importGuestProgress(uid, {deviceId: "dev-1"}, deps))
      .rejects.toMatchObject({code: "invalid-argument"});
    await expect(importGuestProgress(uid, {deviceId: "dev-1"}, deps))
      .rejects.toBeInstanceOf(AppError);
    expect((await db.doc(`players/${uid}`).get()).exists).toBe(false);
  });
});
