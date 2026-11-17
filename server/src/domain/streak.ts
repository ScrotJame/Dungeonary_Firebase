import {LOST_STREAK_WINDOW_DAYS} from "../config/shop";
import {addDays, dayDiff} from "./days";
import type {LostStreak, Streak} from "./player";

/** Chuỗi dò lùi từ lastDay: ngày streak (kể cả vừa thành trong lô) và ngày chỉ có frozen. */
export interface StreakRun {
  streakDays: string[];
  frozenDays: string[];
}

export interface StreakContext {
  /** Số Freeze đang có. Đọc túi đồ khi needsFreezeCount trả true, không thì truyền 0. */
  freezes: number;
  lostStreak: LostStreak | null;
  /** Ngày UTC của server. */
  today: string;
}

export interface StreakOutcome {
  streak: Streak;
  /** Ngày được Freeze cứu trong lượt này; số Freeze đã dùng bằng độ dài mảng. */
  frozenDays: string[];
  lostStreak: LostStreak | null;
}

/** Save Streak còn dùng được: hôm nay trừ lostOn không quá 7 ngày. */
export function isLostStreakAlive(lost: LostStreak, today: string): boolean {
  return dayDiff(today, lost.lostOn) <= LOST_STREAK_WINDOW_DAYS;
}

/** Cần đọc lịch sử ngày streak khi có ngày streak mới đứng trước lastDay. */
export function needsStreakHistory(streak: Streak, newStreakDays: string[]): boolean {
  const lastDay = streak.lastDay;
  return lastDay !== null && newStreakDays.some((day) => day < lastDay);
}

/**
 * Cần đọc số Freeze khi có ngày streak mới nằm sau lastDay hơn một ngày.
 * lastDay chỉ tăng trong một lô, nên kiểm tra với lastDay ban đầu là đủ.
 */
export function needsFreezeCount(streak: Streak, newStreakDays: string[]): boolean {
  const lastDay = streak.lastDay;
  return lastDay !== null && newStreakDays.some((day) => day > addDays(lastDay, 1));
}

/** Bảng ghi lostStreak ở spec shop 6.3. */
export function nextLostStreak(
  existing: LostStreak | null,
  value: number,
  lostOn: string,
  today: string,
): LostStreak | null {
  if (value < 1 || dayDiff(today, lostOn) > LOST_STREAK_WINDOW_DAYS) return existing;
  if (existing === null || !isLostStreakAlive(existing, today) || value > existing.value) {
    return {value, lostOn};
  }
  return existing;
}

export function sameLostStreak(a: LostStreak | null, b: LostStreak | null): boolean {
  return a?.value === b?.value && a?.lostOn === b?.lostOn;
}

/**
 * Dò lùi từ `end`: đếm ngày streak, đi qua ngày frozen mà không đếm, dừng ở
 * ngày không phải cả hai. `earliest` là ngày sớm nhất còn nằm trong chuỗi.
 */
function walkBack(
  end: string,
  streakDays: ReadonlySet<string>,
  frozenDays: ReadonlySet<string>,
): {count: number; earliest: string} {
  let count = 0;
  let earliest = end;
  for (let day = end; ; day = addDays(day, -1)) {
    if (streakDays.has(day)) count++;
    else if (!frozenDays.has(day)) return {count, earliest};
    earliest = day;
  }
}

/**
 * Cập nhật streak theo spec gốc 6.7 và spec shop 6.1, 6.3 khi các ngày trong
 * `newStreakDays` vừa thành ngày streak. `history` chỉ cần khi
 * `needsStreakHistory` trả true.
 */
export function advanceStreak(
  streak: Streak,
  newStreakDays: string[],
  history: StreakRun | null,
  ctx: StreakContext,
): StreakOutcome {
  let {current, longest, lastDay} = streak;
  let freezes = ctx.freezes;
  let lostStreak = ctx.lostStreak;
  const frozenDays: string[] = [];

  for (const day of [...newStreakDays].sort()) {
    if (lastDay === null) {
      current = 1;
      lastDay = day;
    } else if (day === lastDay) {
      // Ngày này đã được tính.
    } else if (day === addDays(lastDay, 1)) {
      current += 1;
      lastDay = day;
    } else if (day > lastDay) {
      const missed = dayDiff(day, lastDay) - 1;
      if (missed <= freezes) {
        // Freeze chỉ bị trừ khi cứu được cả khoảng trống; ngày được cứu không cộng vào chuỗi.
        for (let i = 1; i <= missed; i++) frozenDays.push(addDays(lastDay, i));
        freezes -= missed;
        current += 1;
      } else {
        lostStreak = nextLostStreak(lostStreak, current, addDays(lastDay, 1), ctx.today);
        current = 1;
      }
      lastDay = day;
    } else {
      if (history === null) {
        throw new Error("advanceStreak needs history for a day before lastDay");
      }
      const walk = walkBack(
        lastDay,
        new Set([...history.streakDays, ...newStreakDays]),
        new Set(history.frozenDays));
      current = Math.max(current, walk.count);
      // Đếm lại đi tới ngày cuối của chuỗi đã mất: chuỗi cũ đã tự nối lại.
      if (lostStreak !== null && walk.earliest <= addDays(lostStreak.lostOn, -1)) {
        lostStreak = null;
      }
    }
    longest = Math.max(longest, current);
  }

  return {streak: {current, longest, lastDay}, frozenDays, lostStreak};
}
