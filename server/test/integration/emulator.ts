import {randomUUID} from "node:crypto";
import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {PlayerStore} from "../../src/data/playerStore";

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
