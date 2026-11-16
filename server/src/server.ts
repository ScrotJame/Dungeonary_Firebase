import type {Express} from "express";
import {type App, cert, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {createApp} from "./app";

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
  return createApp({
    verifyToken: (token) => auth.verifyIdToken(token),
    handlers: {},
  });
}
