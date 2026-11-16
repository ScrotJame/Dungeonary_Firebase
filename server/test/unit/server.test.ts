import {describe, expect, it} from "vitest";
import {isTokenRejection} from "../../src/server";

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
