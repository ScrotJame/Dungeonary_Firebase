import {randomUUID} from "node:crypto";
import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {PlayerStore} from "../../src/data/playerStore";
import {importGuestProgress} from "../../src/handlers/importGuestProgress";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Integration tests need the emulator: run `npm run test:emulators`");
}

export const firebaseApp = getApps()[0] ?? initializeApp({
  projectId: process.env.GCLOUD_PROJECT ?? "demo-dungeonary",
});
export const db = getFirestore(firebaseApp);
export const store = new PlayerStore(db);

/** Mỗi test dùng một uid mới nên không cần xoá dữ liệu giữa các test. */
export const newUid = (): string => `u-${randomUUID()}`;

/** Đồng hồ cố định cho handler: 12:00 UTC ngày 2026-11-17. */
export const NOW = Date.UTC(2026, 10, 17, 12);
export const TODAY = "2026-11-17";

/**
 * Tạo players/{uid} qua importGuestProgress (máy "dev-1", mọi số bằng 0), rồi
 * ghi đè `fields` (nhận cả khoá dạng "buffs.doubleGems") và đặt túi đồ.
 */
export async function seedPlayer(opts: {
  fields?: Record<string, unknown>;
  inventory?: Record<string, number>;
} = {}): Promise<string> {
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
    },
  }, {store, now: () => NOW});
  if (opts.fields) await db.doc(`players/${uid}`).update(opts.fields);
  for (const [itemId, quantity] of Object.entries(opts.inventory ?? {})) {
    await db.doc(`players/${uid}/inventory/${itemId}`).set({quantity});
  }
  return uid;
}
