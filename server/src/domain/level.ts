/** XP cần để đi từ `level` lên level kế tiếp. Bản sao LevelHelper của app. */
export function xpRequired(level: number): number {
  return Math.round(30 * 1.5 * (level - 1) + 30);
}

/** Level suy ra từ tổng XP tích luỹ, bắt đầu từ 1. */
export function levelForXp(xp: number): number {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpRequired(level)) {
    remaining -= xpRequired(level);
    level++;
  }
  return level;
}
