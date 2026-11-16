export interface Streak {
  current: number;
  longest: number;
  /** yyyy-MM-dd hoặc null khi chưa có ngày streak nào. */
  lastDay: string | null;
}

/** Trạng thái trả về cho app sau mỗi lượt gọi. */
export interface PlayerSnapshot {
  gems: number;
  xp: number;
  level: number;
  totalLearned: number;
  streak: Streak;
}

/** Chép đúng các trường của snapshot, bỏ mọi trường khác của document. */
export function toSnapshot(p: PlayerSnapshot): PlayerSnapshot {
  return {
    gems: p.gems,
    xp: p.xp,
    level: p.level,
    totalLearned: p.totalLearned,
    streak: {
      current: p.streak.current,
      longest: p.streak.longest,
      lastDay: p.streak.lastDay,
    },
  };
}
