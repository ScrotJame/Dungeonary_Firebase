import {describe, expect, it} from "vitest";
import {addDays, dayDiff, isValidDay, utcDay} from "../../src/domain/days";

describe("isValidDay", () => {
  it("nhận ngày có thật dạng yyyy-MM-dd", () => {
    expect(isValidDay("2026-11-17")).toBe(true);
    expect(isValidDay("2024-02-29")).toBe(true);
  });

  it("từ chối chuỗi sai dạng, ngày không có thật và giá trị không phải chuỗi", () => {
    expect(isValidDay("2026-2-3")).toBe(false);
    expect(isValidDay("2026-02-30")).toBe(false);
    expect(isValidDay("2026-13-01")).toBe(false);
    expect(isValidDay("17/11/2026")).toBe(false);
    expect(isValidDay(20261117)).toBe(false);
    expect(isValidDay(null)).toBe(false);
  });
});

describe("utcDay", () => {
  it("lấy ngày theo UTC, không theo giờ máy", () => {
    expect(utcDay(Date.UTC(2026, 10, 17, 0, 0, 0))).toBe("2026-11-17");
    expect(utcDay(Date.UTC(2026, 10, 17, 23, 59, 59))).toBe("2026-11-17");
  });
});

describe("dayDiff và addDays", () => {
  it("dayDiff là a trừ b, tính bằng ngày", () => {
    expect(dayDiff("2026-11-17", "2026-11-17")).toBe(0);
    expect(dayDiff("2026-11-18", "2026-11-17")).toBe(1);
    expect(dayDiff("2026-11-10", "2026-11-17")).toBe(-7);
    expect(dayDiff("2026-03-01", "2026-02-28")).toBe(1);
  });

  it("addDays đi qua ranh giới tháng và năm", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});
