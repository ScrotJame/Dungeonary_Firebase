import {describe, expect, it} from "vitest";
import type {GuestProfile} from "../../src/domain/events";
import {clampGuestProfile} from "../../src/domain/importProfile";

const TODAY = "2026-11-17";
const profile = (over: Partial<GuestProfile> = {}): GuestProfile => ({
  gems: 100,
  experience: 105,
  totalLearned: 12,
  currentStreak: 3,
  longestStreak: 9,
  lastActiveDay: TODAY,
  ...over,
});

describe("clampGuestProfile", () => {
  it("nhận nguyên giá trị trong giới hạn và tính lại level từ xp", () => {
    expect(clampGuestProfile(profile(), TODAY)).toEqual({
      gems: 100,
      xp: 105,
      level: 3,
      totalLearned: 12,
      streak: {current: 3, longest: 9, lastDay: TODAY},
    });
  });

  it("kẹp gems 2000, xp 1 000 000, totalLearned 100 000, longest 3650", () => {
    const out = clampGuestProfile(
      profile({gems: 99_999, experience: 5_000_000, totalLearned: 999_999, longestStreak: 9000}),
      TODAY);
    expect(out.gems).toBe(2000);
    expect(out.xp).toBe(1_000_000);
    expect(out.totalLearned).toBe(100_000);
    expect(out.streak.longest).toBe(3650);
  });

  it("số âm thành 0 và số lẻ bị làm tròn xuống", () => {
    const out = clampGuestProfile(
      profile({gems: -5, experience: 10.9, totalLearned: -1, longestStreak: -3, currentStreak: -2}),
      TODAY);
    expect(out.gems).toBe(0);
    expect(out.xp).toBe(10);
    expect(out.totalLearned).toBe(0);
    expect(out.streak).toEqual({current: 0, longest: 0, lastDay: null});
  });

  it.each(["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"])(
    "giữ streak hiện tại khi lastActiveDay là %s", (lastActiveDay) => {
      const out = clampGuestProfile(profile({lastActiveDay}), TODAY);
      expect(out.streak).toEqual({current: 3, longest: 9, lastDay: lastActiveDay});
    });

  it.each(["2026-11-14", "2026-11-19", null])(
    "bỏ streak hiện tại khi lastActiveDay là %s", (lastActiveDay) => {
      const out = clampGuestProfile(profile({lastActiveDay}), TODAY);
      expect(out.streak).toEqual({current: 0, longest: 9, lastDay: null});
    });

  it("current không vượt longest", () => {
    const out = clampGuestProfile(profile({currentStreak: 20, longestStreak: 9}), TODAY);
    expect(out.streak.current).toBe(9);
  });
});
