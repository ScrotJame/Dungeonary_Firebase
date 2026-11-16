import type {RequestHandler} from "express";
import {AppError} from "./errors";

export type VerifyToken = (token: string) => Promise<{uid: string}>;

/** Xác minh `Authorization: Bearer <ID token>` và gắn uid vào res.locals.uid. */
export function requireAuth(verifyToken: VerifyToken): RequestHandler {
  return async (req, res, next) => {
    const match = /^Bearer (.+)$/.exec(req.get("authorization") ?? "");
    if (!match) throw new AppError("unauthenticated");
    let uid: string;
    try {
      uid = (await verifyToken(match[1])).uid;
    } catch {
      throw new AppError("unauthenticated");
    }
    res.locals.uid = uid;
    next();
  };
}
