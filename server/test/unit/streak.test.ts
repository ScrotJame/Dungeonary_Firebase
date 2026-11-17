import {describe, expect, it} from "vitest";
import {
  advanceStreak,
  isLostStreakAlive,
  needsFreezeCount,
  needsStreakHistory,
  nextLostStreak,
  sameLostStreak,
  type StreakContext,
  type StreakRun,
} from "../../src/domain/streak";

const TODAY = "2026-11-17";
const none = {current: 0, longest: 0, lastDay: null};
const ctx = (over: Partial<StreakContext> = {}): StreakContext => ({
  freezes: 0, lostStreak: null, today: TODAY, ...over,
});
const run = (streakDays: string[], frozenDays: string[] = []): StreakRun => ({streakDays, frozenDays});
/** Các ngày liền nhau từ `from` đến `to`, tính cả hai đầu. */
function range(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`); ms += 86_400_000) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

describe("advanceStreak: từng dòng của bảng 6.7 (không có Freeze)", () => {
  it("lastDay là null: bắt đầu chuỗi 1", () => {
    expect(advanceStreak(none, [TODAY], null, ctx()).streak).toEqual({
      current: 1, longest: 1, lastDay: TODAY,
    });
  });

  it("D bằng lastDay: không đổi", () => {
    const s = {current: 4, longest: 9, lastDay: TODAY};
    expect(advanceStreak(s, [TODAY], null, ctx()).streak).toEqual(s);
  });

  it("D là ngày liền sau lastDay: cộng một", () => {
    const out = advanceStreak({current: 4, longest: 4, lastDay: "2026-11-16"}, [TODAY], null, ctx());
    expect(out.streak).toEqual({current: 5, longest: 5, lastDay: TODAY});
    expect(out.frozenDays).toEqual([]);
  });

  it("D sau lastDay hơn một ngày, không có Freeze: về 1, longest giữ, ghi lostStreak", () => {
    const out = advanceStreak({current: 4, longest: 9, lastDay: "2026-11-14"}, [TODAY], null, ctx());
    expect(out.streak).toEqual({current: 1, longest: 9, lastDay: TODAY});
    expect(out.lostStreak).toEqual({value: 4, lostOn: "2026-11-15"});
  });

  it("D trước lastDay và lấp chỗ trống: đếm lại chuỗi kết thúc ở lastDay", () => {
    const s = {current: 2, longest: 2, lastDay: TODAY};
    const history = run(["2026-11-17", "2026-11-16", "2026-11-15", "2026-11-14", "2026-11-13"]);
    expect(advanceStreak(s, ["2026-11-15"], history, ctx()).streak).toEqual({
      current: 5, longest: 5, lastDay: TODAY,
    });
  });
});

describe("advanceStreak: Streak Freeze (spec shop 6.1)", () => {
  it("đủ Freeze: trừ Freeze, đánh dấu ngày lỡ, current chỉ tăng cho D", () => {
    const out = advanceStreak(
      {current: 10, longest: 10, lastDay: "2026-11-15"}, [TODAY], null, ctx({freezes: 1}));
    expect(out.streak).toEqual({current: 11, longest: 11, lastDay: TODAY});
    expect(out.frozenDays).toEqual(["2026-11-16"]);
    expect(out.lostStreak).toBeNull();
  });

  it("đủ Freeze cho hai ngày lỡ liền nhau", () => {
    const out = advanceStreak(
      {current: 10, longest: 10, lastDay: "2026-11-14"}, [TODAY], null, ctx({freezes: 2}));
    expect(out.streak.current).toBe(11);
    expect(out.frozenDays).toEqual(["2026-11-15", "2026-11-16"]);
  });

  it("thiếu một Freeze: không trừ cái nào, chuỗi về 1, ghi lostStreak", () => {
    const out = advanceStreak(
      {current: 10, longest: 10, lastDay: "2026-11-14"}, [TODAY], null, ctx({freezes: 1}));
    expect(out.streak).toEqual({current: 1, longest: 10, lastDay: TODAY});
    expect(out.frozenDays).toEqual([]);
    expect(out.lostStreak).toEqual({value: 10, lostOn: "2026-11-15"});
  });

  it("hai khoảng trống trong một lô: xử lý theo ngày tăng dần", () => {
    const out = advanceStreak(
      {current: 5, longest: 5, lastDay: "2026-11-10"},
      ["2026-11-14", "2026-11-12"],
      null,
      ctx({freezes: 2}));
    expect(out.streak).toEqual({current: 7, longest: 7, lastDay: "2026-11-14"});
    expect(out.frozenDays).toEqual(["2026-11-11", "2026-11-13"]);
  });

  it("số Freeze giảm dần qua từng khoảng trống", () => {
    const out = advanceStreak(
      {current: 5, longest: 5, lastDay: "2026-11-10"},
      ["2026-11-12", "2026-11-15"],
      null,
      ctx({freezes: 1}));
    expect(out.frozenDays).toEqual(["2026-11-11"]);
    expect(out.streak).toEqual({current: 1, longest: 6, lastDay: "2026-11-15"});
    expect(out.lostStreak).toEqual({value: 6, lostOn: "2026-11-13"});
  });

  it("đếm lại đi qua ngày frozen mà không đếm nó", () => {
    const s = {current: 1, longest: 5, lastDay: TODAY};
    const history = run(
      ["2026-11-17", "2026-11-15", "2026-11-14", "2026-11-13"],
      ["2026-11-16"]);
    expect(advanceStreak(s, ["2026-11-13"], history, ctx()).streak.current).toBe(4);
  });

  it("ngày frozen được bù đủ quest thì được đếm", () => {
    const s = {current: 3, longest: 3, lastDay: TODAY};
    const history = run(["2026-11-17", "2026-11-16", "2026-11-15"]);
    expect(advanceStreak(s, ["2026-11-16"], history, ctx()).streak.current).toBe(3);
    const longer = run(["2026-11-17", "2026-11-16", "2026-11-15", "2026-11-14"]);
    expect(advanceStreak(s, ["2026-11-16"], longer, ctx()).streak.current).toBe(4);
  });
});

describe("advanceStreak: lostStreak (spec shop 6.3)", () => {
  it("lostOn cũ hơn 7 ngày: không ghi", () => {
    const out = advanceStreak({current: 5, longest: 5, lastDay: "2026-11-01"}, [TODAY], null, ctx());
    expect(out.lostStreak).toBeNull();
  });

  it("bù ngày cũ và đếm lại đi tới lostOn − 1: chuỗi cũ tự nối lại, xoá lostStreak", () => {
    // Chuỗi 10 ngày 11-05..11-14, lỡ 11-15 và 11-16, hôm nay 11-17 về 1.
    const s = {current: 1, longest: 10, lastDay: TODAY};
    const lostStreak = {value: 10, lostOn: "2026-11-15"};
    const history = run(range("2026-11-05", TODAY).reverse());
    const out = advanceStreak(s, ["2026-11-15", "2026-11-16"], history, ctx({lostStreak}));
    expect(out.streak).toEqual({current: 13, longest: 13, lastDay: TODAY});
    expect(out.lostStreak).toBeNull();
  });

  it("đếm lại chưa tới lostOn − 1: giữ lostStreak", () => {
    const s = {current: 1, longest: 10, lastDay: TODAY};
    const lostStreak = {value: 10, lostOn: "2026-11-15"};
    const history = run(["2026-11-17", "2026-11-16"]);
    const out = advanceStreak(s, ["2026-11-16"], history, ctx({lostStreak}));
    expect(out.streak.current).toBe(2);
    expect(out.lostStreak).toEqual(lostStreak);
  });

  it("khôi phục trước rồi bù ngày sau không cộng trùng", () => {
    // Sau Save Streak: current 11. Bù hai ngày lỡ: đếm được 13, lấy max.
    const s = {current: 11, longest: 11, lastDay: TODAY};
    const history = run(range("2026-11-05", TODAY).reverse());
    expect(advanceStreak(s, ["2026-11-15", "2026-11-16"], history, ctx()).streak.current).toBe(13);
  });
});

describe("advanceStreak: trường hợp khác", () => {
  it("không có ngày mới thì trả nguyên trạng", () => {
    const s = {current: 4, longest: 9, lastDay: TODAY};
    const lostStreak = {value: 3, lostOn: "2026-11-12"};
    expect(advanceStreak(s, [], null, ctx({lostStreak}))).toEqual({
      streak: s, frozenDays: [], lostStreak,
    });
  });

  it("nhiều ngày mới liền nhau trong một lô", () => {
    expect(advanceStreak(none, ["2026-11-17", "2026-11-15", "2026-11-16"], null, ctx()).streak)
      .toEqual({current: 3, longest: 3, lastDay: TODAY});
  });

  it("ngày cũ không làm ngắn chuỗi đã nhập từ dữ liệu khách", () => {
    const imported = {current: 50, longest: 50, lastDay: TODAY};
    expect(advanceStreak(imported, ["2026-11-16"], run([TODAY, "2026-11-16"]), ctx()).streak)
      .toEqual(imported);
  });

  it("ném lỗi khi cần lịch sử mà không được cung cấp", () => {
    const s = {current: 2, longest: 2, lastDay: TODAY};
    expect(() => advanceStreak(s, ["2026-11-15"], null, ctx())).toThrow();
  });
});

describe("nextLostStreak: bảng ghi lostStreak ở 6.3", () => {
  const alive = {value: 30, lostOn: "2026-11-14"};

  it("value nhỏ hơn 1: không ghi", () => {
    expect(nextLostStreak(null, 0, "2026-11-16", TODAY)).toBeNull();
  });

  it("lostOn quá 7 ngày: không ghi, giữ bản đang có", () => {
    expect(nextLostStreak(alive, 50, "2026-11-09", TODAY)).toEqual(alive);
  });

  it("chưa có: ghi", () => {
    expect(nextLostStreak(null, 3, "2026-11-16", TODAY)).toEqual({value: 3, lostOn: "2026-11-16"});
  });

  it("bản đang có đã quá hạn: ghi đè", () => {
    const expired = {value: 99, lostOn: "2026-11-01"};
    expect(nextLostStreak(expired, 1, "2026-11-16", TODAY)).toEqual({value: 1, lostOn: "2026-11-16"});
  });

  it("value lớn hơn bản đang có: ghi đè", () => {
    expect(nextLostStreak(alive, 31, "2026-11-16", TODAY)).toEqual({value: 31, lostOn: "2026-11-16"});
  });

  it("bản đang có còn hạn và lớn hơn hoặc bằng: giữ", () => {
    expect(nextLostStreak(alive, 1, "2026-11-16", TODAY)).toEqual(alive);
    expect(nextLostStreak(alive, 30, "2026-11-16", TODAY)).toEqual(alive);
  });
});

describe("hàm phụ", () => {
  it("needsStreakHistory chỉ đúng khi có ngày streak mới đứng trước lastDay", () => {
    const s = {current: 2, longest: 2, lastDay: TODAY};
    expect(needsStreakHistory(s, ["2026-11-16"])).toBe(true);
    expect(needsStreakHistory(s, ["2026-11-17", "2026-11-18"])).toBe(false);
    expect(needsStreakHistory(s, [])).toBe(false);
    expect(needsStreakHistory(none, ["2026-11-01"])).toBe(false);
  });

  it("needsFreezeCount chỉ đúng khi có ngày streak mới sau lastDay hơn một ngày", () => {
    const s = {current: 2, longest: 2, lastDay: "2026-11-15"};
    expect(needsFreezeCount(s, [TODAY])).toBe(true);
    expect(needsFreezeCount(s, ["2026-11-16"])).toBe(false);
    expect(needsFreezeCount(s, ["2026-11-14"])).toBe(false);
    expect(needsFreezeCount(none, [TODAY])).toBe(false);
  });

  it("isLostStreakAlive: còn hạn khi hôm nay trừ lostOn không quá 7 ngày", () => {
    expect(isLostStreakAlive({value: 5, lostOn: "2026-11-10"}, TODAY)).toBe(true);
    expect(isLostStreakAlive({value: 5, lostOn: "2026-11-09"}, TODAY)).toBe(false);
  });

  it("sameLostStreak so theo giá trị", () => {
    expect(sameLostStreak(null, null)).toBe(true);
    expect(sameLostStreak({value: 1, lostOn: TODAY}, {value: 1, lostOn: TODAY})).toBe(true);
    expect(sameLostStreak({value: 1, lostOn: TODAY}, null)).toBe(false);
    expect(sameLostStreak({value: 1, lostOn: TODAY}, {value: 2, lostOn: TODAY})).toBe(false);
  });
});
