/** Giới hạn khi nhập dữ liệu khách (spec gốc 6.2). */
export const IMPORT_LIMITS = {
  gems: 2000,
  xp: 1_000_000,
  totalLearned: 100_000,
  longestStreak: 3650,
} as const;

/** Trần tổng mỗi ngày cho mọi nguồn cộng lại (spec gốc 6.5). */
export const DAILY_TOTAL_CAP = {gems: 2000, xp: 5000} as const;

/** Trần mỗi ngày theo nguồn, tính bằng đơn vị của nguồn đó. */
export const SOURCE_CAPS = {
  feed_quiz_correct: 200,
  feed_reward_card: 30,
  flashcard_session: 200,
  test_level_up: 100,
  matching_session: 100,
} as const;

export const FEED_MULTIPLIERS: readonly number[] = [1, 1.25, 1.5, 2];
/** Số câu quiz feed đúng cần có trước mỗi thẻ thưởng. */
export const FEED_QUIZ_PER_CARD = 3;
export const REWARD_CARD_MAX = {xp: 39, gems: 19} as const;

/** Chỉ số là level từ vừa đạt; level từ 5 trở lên dùng phần tử cuối. */
export const TEST_LEVEL_UP_XP: readonly number[] = [5, 5, 10, 15, 25, 40];
export const TEST_LEVEL_UP_GEMS: readonly number[] = [5, 10, 20, 35, 50, 75];

/** Bản sao MissionPool của app. */
export const QUESTS: Readonly<Record<string, {gems: number; isDefault: boolean}>> = {
  default_active_time: {gems: 5, isDefault: true},
  learn_5: {gems: 10, isDefault: false},
  learn_10: {gems: 15, isDefault: false},
  quiz_1: {gems: 15, isDefault: false},
  feed_5: {gems: 10, isDefault: false},
  feed_10: {gems: 15, isDefault: false},
};
export const MAX_DEFAULT_QUESTS_PER_DAY = 1;
export const MAX_POOL_QUESTS_PER_DAY = 2;
/** Quest của ngày cũ hơn LOOKBACK_DAYS, trả vào trần hôm nay. */
export const LATE_QUESTS_PER_DAY = 3;

/** Sự kiện có `at` muộn hơn giờ server quá mức này bị bỏ (spec gốc 6.4). */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
/** Ngày cũ hơn số này tính vào trần hôm nay và không tính streak. */
export const LOOKBACK_DAYS = 7;

export const MAX_EVENTS_PER_SYNC = 200;
export const MAX_DEVICE_ID_LENGTH = 128;
