import type {Express} from "express";
import {type App, cert, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore} from "firebase-admin/firestore";
import {createApp} from "./app";
import {PlayerStore} from "./data/playerStore";
import {type HandlerDeps, importGuestProgress} from "./handlers/importGuestProgress";
import {syncProgress} from "./handlers/syncProgress";

export function initFirebase(): App {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    return initializeApp({credential: cert(JSON.parse(raw))});
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({
      projectId: process.env.GCLOUD_PROJECT ?? "demo-dungeonary",
    });
  }
  throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
}

export function buildServer(firebaseApp: App): Express {
  const auth = getAuth(firebaseApp);
  const deps: HandlerDeps = {
    store: new PlayerStore(getFirestore(firebaseApp)),
    now: Date.now,
  };
  return createApp({
    verifyToken: (token) => auth.verifyIdToken(token),
    handlers: {
      importGuestProgress: (uid, input) => importGuestProgress(uid, input, deps),
      syncProgress: (uid, input) => syncProgress(uid, input, deps),
    },
  });
}
