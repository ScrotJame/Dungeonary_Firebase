import type {RequestHandler} from "express";
import {AppError} from "./errors";

export interface RateLimitOptions {
  /** Số request tối đa của một uid trong một cửa sổ. */
  limit: number;
  windowMs: number;
  /** Đồng hồ, ms từ epoch. Tách ra để test đặt được giờ. */
  now?: () => number;
}

/** Spec shop 8.1: 60 request mỗi phút cho mỗi tài khoản. */
export const DEFAULT_RATE_LIMIT: RateLimitOptions = {limit: 60, windowMs: 60_000};

/** Khi bảng đếm có từng này uid thì dọn các cửa sổ đã hết hạn. */
const SWEEP_AT = 10_000;

/**
 * Trần số lượt gọi theo uid, đếm trong bộ nhớ (mất khi server ngủ hoặc khởi
 * động lại). Phải đứng sau requireAuth vì đọc res.locals.uid. Request bị chặn
 * dừng ở đây, không tới handler nên không tốn lượt đọc Firestore nào.
 */
export function rateLimit({limit, windowMs, now = Date.now}: RateLimitOptions): RequestHandler {
  const windows = new Map<string, {start: number; count: number}>();
  return (_req, res, next) => {
    const uid = res.locals.uid as string;
    const t = now();
    if (windows.size >= SWEEP_AT) {
      for (const [key, w] of windows) {
        if (t - w.start >= windowMs) windows.delete(key);
      }
    }
    let w = windows.get(uid);
    if (!w || t - w.start >= windowMs) {
      w = {start: t, count: 0};
      windows.set(uid, w);
    }
    w.count += 1;
    if (w.count > limit) throw new AppError("resource-exhausted");
    next();
  };
}
