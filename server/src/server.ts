import type {Express} from "express";
import {type App, cert, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore} from "firebase-admin/firestore";
import {createApp} from "./app";
import {PlayerStore} from "./data/playerStore";
import {type HandlerDeps, importGuestProgress} from "./handlers/importGuestProgress";
import {syncProgress} from "./handlers/syncProgress";
import {AppError} from "./http/errors";

export function initFirebase(): App {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    // Với biến emulator, Admin SDK chấp nhận token không chữ ký: cấm dùng chung với khóa thật.
    if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      throw new Error(
        "Emulator variables must not be set together with FIREBASE_SERVICE_ACCOUNT_JSON",
      );
    }
    return initializeApp({credential: cert(JSON.parse(raw))});
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({
      projectId: process.env.GCLOUD_PROJECT ?? "demo-dungeonary",
    });
  }
  throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
}

/**
 * True khi Admin SDK từ chối chính token (hết hạn, sai định dạng...).
 * `auth/internal-error` (không tải được khóa công khai...) không phải lỗi của token.
 */
export function isTokenRejection(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as {code?: unknown}).code;
  return typeof code === "string" &&
    code.startsWith("auth/") &&
    code !== "auth/internal-error";
}

export function buildServer(firebaseApp: App): Express {
  const auth = getAuth(firebaseApp);
  const deps: HandlerDeps = {
    store: new PlayerStore(getFirestore(firebaseApp)),
    now: Date.now,
  };
  return createApp({
    verifyToken: async (token) => {
      try {
        return await auth.verifyIdToken(token);
      } catch (err) {
        if (isTokenRejection(err)) throw err;
        console.error(err);
        throw new AppError("internal");
      }
    },
    handlers: {
      importGuestProgress: (uid, input) => importGuestProgress(uid, input, deps),
      syncProgress: (uid, input) => syncProgress(uid, input, deps),
    },
  });
}
