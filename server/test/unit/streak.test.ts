import {describe, expect, it} from "vitest";
import {advanceStreak, isLostStreakAlive, needsStreakHistory} from "../../src/domain/streak";

const none = {current: 0, longest: 0, lastDay: null};

describe("advanceStreak: từng dòng của bảng 6.7", () => {
  it("lastDay là null: bắt đầu chuỗi 1", () => {
    expect(advanceStreak(none, ["2026-11-17"], null)).toEqual({
      current: 1, longest: 1, lastDay: "2026-11-17",
    });
  });

  it("D bằng lastDay: không đổi", () => {
    const s = {current: 4, longest: 9, lastDay: "2026-11-17"};
    expect(advanceStreak(s, ["2026-11-17"], null)).toEqual(s);
  });

  it("D là ngày liền sau lastDay: cộng một", () => {
    expect(advanceStreak({current: 4, longest: 4, lastDay: "2026-11-16"}, ["2026-11-17"], null))
      .toEqual({current: 5, longest: 5, lastDay: "2026-11-17"});
  });

  it("D sau lastDay hơn một ngày: về 1, longest giữ nguyên", () => {
    expect(advanceStreak({current: 4, longest: 9, lastDay: "2026-11-14"}, ["2026-11-17"], null))
      .toEqual({current: 1, longest: 9, lastDay: "2026-11-17"});
  });

  it("D trước lastDay và lấp chỗ trống: đếm lại chuỗi kết thúc ở lastDay", () => {
    const s = {current: 2, longest: 2, lastDay: "2026-11-17"};
    const history = ["2026-11-13", "2026-11-14", "2026-11-16", "2026-11-17"];
    expect(advanceStreak(s, ["2026-11-15"], history)).toEqual({
      current: 5, longest: 5, lastDay: "2026-11-17",
    });
  });
});

describe("advanceStreak: trường hợp khác", () => {
  it("không có ngày mới thì trả nguyên trạng", () => {
    const s = {current: 4, longest: 9, lastDay: "2026-11-17"};
    expect(advanceStreak(s, [], null)).toEqual(s);
  });

  it("nhiều ngày mới trong một lô được xử lý theo thứ tự tăng dần", () => {
    expect(advanceStreak(none, ["2026-11-17", "2026-11-15", "2026-11-16"], null)).toEqual({
      current: 3, longest: 3, lastDay: "2026-11-17",
    });
  });

  it("ngày cũ không làm ngắn chuỗi đã nhập từ dữ liệu khách", () => {
    const imported = {current: 50, longest: 50, lastDay: "2026-11-17"};
    expect(advanceStreak(imported, ["2026-11-16"], [])).toEqual(imported);
  });

  it("ném lỗi khi cần lịch sử mà không được cung cấp", () => {
    const s = {current: 2, longest: 2, lastDay: "2026-11-17"};
    expect(() => advanceStreak(s, ["2026-11-15"], null)).toThrow();
  });
});

describe("needsStreakHistory", () => {
  it("chỉ đúng khi có ngày streak mới đứng trước lastDay", () => {
    const s = {current: 2, longest: 2, lastDay: "2026-11-17"};
    expect(needsStreakHistory(s, ["2026-11-16"])).toBe(true);
    expect(needsStreakHistory(s, ["2026-11-17", "2026-11-18"])).toBe(false);
    expect(needsStreakHistory(s, [])).toBe(false);
    expect(needsStreakHistory(none, ["2026-11-01"])).toBe(false);
  });
});

describe("isLostStreakAlive", () => {
  it("còn hạn khi hôm nay trừ lostOn không quá 7 ngày", () => {
    expect(isLostStreakAlive({value: 5, lostOn: "2026-11-10"}, "2026-11-17")).toBe(true);
    expect(isLostStreakAlive({value: 5, lostOn: "2026-11-09"}, "2026-11-17")).toBe(false);
  });
});
