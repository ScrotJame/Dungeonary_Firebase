import {addDays} from "./days";
import type {Streak} from "./player";

/** Cần đọc lịch sử ngày streak khi có ngày ứng viên đứng trước lastDay. */
export function needsStreakHistory(streak: Streak, candidateDays: string[]): boolean {
  const lastDay = streak.lastDay;
  return lastDay !== null && candidateDays.some((day) => day < lastDay);
}

/** Số ngày liền nhau có trong `days`, đếm lùi từ `end`. */
function runEndingAt(end: string, days: ReadonlySet<string>): number {
  let count = 0;
  for (let day = end; days.has(day); day = addDays(day, -1)) count++;
  return count;
}

/**
 * Cập nhật streak theo spec gốc 6.7 khi các ngày trong `newStreakDays`
 * vừa thành ngày streak. `history` là các ngày streak đã có trong Firestore.
 */
export function advanceStreak(
  streak: Streak,
  newStreakDays: string[],
  history: string[] | null,
): Streak {
  let {current, longest, lastDay} = streak;

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
      current = 1;
      lastDay = day;
    } else {
      if (history === null) {
        throw new Error("advanceStreak needs history for a day before lastDay");
      }
      const known = new Set([...history, ...newStreakDays]);
      current = Math.max(current, runEndingAt(lastDay, known));
    }
    longest = Math.max(longest, current);
  }

  return {current, longest, lastDay};
}
