import {IMPORT_LIMITS} from "../config/rewards";
import {dayDiff} from "./days";
import type {GuestProfile} from "./events";
import {levelForXp} from "./level";
import type {PlayerSnapshot} from "./player";

function clampInt(value: number, max: number): number {
  return Math.min(Math.max(0, Math.floor(value)), max);
}

/**
 * Kẹp dữ liệu trên máy của khách theo spec gốc 6.2.
 * `today` là ngày UTC của server.
 */
export function clampGuestProfile(profile: GuestProfile, today: string): PlayerSnapshot {
  const xp = clampInt(profile.experience, IMPORT_LIMITS.xp);
  const longest = clampInt(profile.longestStreak, IMPORT_LIMITS.longestStreak);

  // Máy tính ngày theo giờ địa phương, lệch tối đa một ngày so với UTC.
  // "Hôm nay hoặc hôm qua" của máy vì thế nằm trong khoảng today - 2 đến today + 1.
  const lastActiveDay = profile.lastActiveDay;
  const diff = lastActiveDay === null ? null : dayDiff(lastActiveDay, today);
  const recent = diff !== null && diff >= -2 && diff <= 1;
  const current = recent ? Math.min(clampInt(profile.currentStreak, longest), longest) : 0;

  return {
    gems: clampInt(profile.gems, IMPORT_LIMITS.gems),
    xp,
    level: levelForXp(xp),
    totalLearned: clampInt(profile.totalLearned, IMPORT_LIMITS.totalLearned),
    streak: {
      current,
      longest,
      lastDay: current > 0 ? lastActiveDay : null,
    },
  };
}
