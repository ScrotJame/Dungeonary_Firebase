import {afterEach, describe, expect, it, vi} from "vitest";
import {initFirebase, isTokenRejection, shutdownHandler} from "../../src/server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isTokenRejection", () => {
  it("true khi token bị từ chối", () => {
    expect(isTokenRejection({code: "auth/id-token-expired"})).toBe(true);
    expect(isTokenRejection({code: "auth/argument-error"})).toBe(true);
  });

  it("false khi lỗi không do token", () => {
    expect(isTokenRejection({code: "auth/internal-error"})).toBe(false);
    expect(isTokenRejection(new Error("network"))).toBe(false);
    expect(isTokenRejection({code: 5})).toBe(false);
    expect(isTokenRejection(null)).toBe(false);
  });
});

describe("shutdownHandler", () => {
  it("chờ server đóng xong rồi thoát với mã 0, chỉ một lần", () => {
    const exit = vi.fn();
    let closed: (() => void) | undefined;
    const close = vi.fn((cb: () => void) => {
      closed = cb;
    });
    const onSignal = shutdownHandler({close}, exit, 1000);

    onSignal();
    onSignal();
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    closed?.();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("thoát với mã 1 khi request đang chạy không xong trong thời gian chờ", () => {
    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      const onSignal = shutdownHandler({close: () => undefined}, exit, 1000);
      onSignal();
      vi.advanceTimersByTime(999);
      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("initFirebase", () => {
  const MESSAGE =
    "Emulator variables must not be set together with FIREBASE_SERVICE_ACCOUNT_JSON";

  it("từ chối khi có service account cùng FIREBASE_AUTH_EMULATOR_HOST", () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "{}");
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099");
    expect(() => initFirebase()).toThrow(MESSAGE);
  });

  it("từ chối khi có service account cùng FIRESTORE_EMULATOR_HOST", () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "{}");
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8085");
    expect(() => initFirebase()).toThrow(MESSAGE);
  });
});
