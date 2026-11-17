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

/** Khoảng thời gian, ms từ epoch: `from` tính, `until` không tính. */
export interface TimeWindow {
  from: number;
  until: number;
}

/** Chuỗi vừa bị đặt lại, chờ Save Streak (spec shop 4.3, 6.3). */
export interface LostStreak {
  value: number;
  /** yyyy-MM-dd: ngày lỡ đầu tiên, tức lastDay + 1 lúc chuỗi bị đặt lại. */
  lostOn: string;
}

/** Thay đổi trên players/{uid} do purchaseItem và useItem ghi. */
export interface PlayerChanges {
  gems?: number;
  streak?: Streak;
  doubleGems?: TimeWindow;
  /** null thì xoá trường lostStreak. */
  lostStreak?: LostStreak | null;
}
