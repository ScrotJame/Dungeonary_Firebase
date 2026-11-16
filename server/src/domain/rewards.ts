import {
  DAILY_TOTAL_CAP,
  FEED_QUIZ_PER_CARD,
  FUTURE_TOLERANCE_MS,
  LATE_QUESTS_PER_DAY,
  LOOKBACK_DAYS,
  MAX_DEFAULT_QUESTS_PER_DAY,
  MAX_POOL_QUESTS_PER_DAY,
  QUESTS,
  REWARD_CARD_MAX,
  SOURCE_CAPS,
  TEST_LEVEL_UP_GEMS,
  TEST_LEVEL_UP_XP,
} from "../config/rewards";
import {dayDiff, utcDay} from "./days";
import type {BatchItem, GameEvent} from "./events";

/** Nội dung document players/{uid}/days/{yyyy-MM-dd}. */
export interface DayState {
  /** Nguồn thưởng sang số đơn vị đã được tính trong ngày. */
  counts: Record<string, number>;
  gemsEarned: number;
  xpEarned: number;
  /** Id các quest đã xong trong ngày. */
  quests: string[];
  streakDay: boolean;
}

export const EMPTY_DAY: DayState = {
  counts: {},
  gemsEarned: 0,
  xpEarned: 0,
  quests: [],
  streakDay: false,
};

/** Bộ đếm nằm trên document player, không theo ngày. */
export interface Counters {
  feedQuizSinceReward: number;
  totalLearned: number;
}

export interface Placement {
  /** Ngày mà sự kiện tính vào trần. */
  capDay: string;
  streakEligible: boolean;
}

export interface Placed extends Placement {
  event: GameEvent;
}

/** Kiểm tra thời gian theo spec gốc 6.4. Trả null khi sự kiện bị bỏ. */
export function placeEvent(event: {at: number; day: string}, now: number): Placement | null {
  if (event.at > now + FUTURE_TOLERANCE_MS) return null;
  if (Math.abs(dayDiff(event.day, utcDay(event.at))) > 1) return null;
  const today = utcDay(now);
  const age = dayDiff(today, event.day);
  if (age < -1) return null;
  if (age > LOOKBACK_DAYS) return {capDay: today, streakEligible: false};
  return {capDay: event.day, streakEligible: true};
}

export interface EventOutcome {
  gems: number;
  xp: number;
  day: DayState;
  counters: Counters;
}

/** Tính thưởng một sự kiện theo spec gốc 6.5. Không sửa tham số đầu vào. */
export function applyEvent(
  event: GameEvent,
  day: DayState,
  counters: Counters,
  streakEligible: boolean,
): EventOutcome {
  const counts = {...day.counts};
  let quests = day.quests;
  let {feedQuizSinceReward, totalLearned} = counters;
  let gems = 0;
  let xp = 0;

  /** Lấy tối đa `want` đơn vị còn trong trần `cap` của nguồn `key`. */
  const take = (key: string, want: number, cap: number): number => {
    const used = counts[key] ?? 0;
    const granted = Math.max(0, Math.min(want, cap - used));
    if (granted > 0) counts[key] = used + granted;
    return granted;
  };

  switch (event.type) {
    case "feed_quiz_correct": {
      feedQuizSinceReward = Math.min(FEED_QUIZ_PER_CARD, feedQuizSinceReward + 1);
      if (take(event.type, 1, SOURCE_CAPS.feed_quiz_correct) === 1) {
        xp = Math.round(10 * event.multiplier) + (event.combo ? 3 : 0);
        gems = event.eventActive ? 3 : 1;
      }
      break;
    }
    case "feed_reward_card": {
      if (feedQuizSinceReward < FEED_QUIZ_PER_CARD) break;
      feedQuizSinceReward = 0;
      if (take(event.type, 1, SOURCE_CAPS.feed_reward_card) === 1) {
        xp = Math.min(event.xp, REWARD_CARD_MAX.xp);
        gems = Math.min(event.gems, REWARD_CARD_MAX.gems);
      }
      break;
    }
    case "flashcard_session": {
      const units = take(event.type, event.remembered, SOURCE_CAPS.flashcard_session);
      xp = 5 * units;
      gems = units;
      break;
    }
    case "test_level_up": {
      if (take(event.type, 1, SOURCE_CAPS.test_level_up) === 1) {
        const index = Math.min(event.level, TEST_LEVEL_UP_XP.length - 1);
        xp = TEST_LEVEL_UP_XP[index];
        gems = TEST_LEVEL_UP_GEMS[index];
      }
      break;
    }
    case "matching_session": {
      const units = take(event.type, event.pairs, SOURCE_CAPS.matching_session);
      xp = 20 * units;
      gems = 5 * units;
      break;
    }
    case "quest_completed": {
      const quest = QUESTS[event.questId];
      if (!streakEligible) {
        if (take("quest_late", 1, LATE_QUESTS_PER_DAY) === 1) gems = quest.gems;
        break;
      }
      if (quests.includes(event.questId)) break;
      const sameKind = quests.filter((id) => QUESTS[id]?.isDefault === quest.isDefault).length;
      const limit = quest.isDefault ? MAX_DEFAULT_QUESTS_PER_DAY : MAX_POOL_QUESTS_PER_DAY;
      if (sameKind >= limit) break;
      quests = [...quests, event.questId];
      gems = quest.gems;
      break;
    }
    case "word_mastered":
      totalLearned += 1;
      break;
    case "word_unmastered":
      totalLearned = Math.max(0, totalLearned - 1);
      break;
  }

  gems = Math.min(gems, Math.max(0, DAILY_TOTAL_CAP.gems - day.gemsEarned));
  xp = Math.min(xp, Math.max(0, DAILY_TOTAL_CAP.xp - day.xpEarned));

  const questsPerStreakDay = MAX_DEFAULT_QUESTS_PER_DAY + MAX_POOL_QUESTS_PER_DAY;
  return {
    gems,
    xp,
    day: {
      counts,
      gemsEarned: day.gemsEarned + gems,
      xpEarned: day.xpEarned + xp,
      quests,
      streakDay: day.streakDay || quests.length >= questsPerStreakDay,
    },
    counters: {feedQuizSinceReward, totalLearned},
  };
}

export interface PlacedBatch {
  /** Sự kiện hợp lệ, chưa xử lý, theo thứ tự seq. */
  placed: Placed[];
  /** seq mới nhỏ nhất và lớn nhất trong lô, kể cả sự kiện bị bỏ qua. */
  minSeq: number;
  maxSeq: number;
  /** Các ngày cần đọc document days. */
  capDays: string[];
  /** Các ngày có thể vừa thành ngày streak trong lô này. */
  streakCandidates: string[];
}

export function placeBatch(items: BatchItem[], lastSeq: number, now: number): PlacedBatch {
  const fresh = new Map<number, BatchItem>();
  for (const item of items) {
    if (item.seq > lastSeq && !fresh.has(item.seq)) fresh.set(item.seq, item);
  }
  const ordered = [...fresh.values()].sort((a, b) => a.seq - b.seq);

  const placed: Placed[] = [];
  for (const {event} of ordered) {
    if (!event) continue;
    const placement = placeEvent(event, now);
    if (placement) placed.push({event, ...placement});
  }

  const candidates = placed
    .filter((p) => p.streakEligible && p.event.type === "quest_completed")
    .map((p) => p.capDay);
  return {
    placed,
    minSeq: ordered[0]?.seq ?? lastSeq,
    maxSeq: ordered.at(-1)?.seq ?? lastSeq,
    capDays: [...new Set(placed.map((p) => p.capDay))],
    streakCandidates: [...new Set(candidates)],
  };
}

export interface BatchResult {
  gems: number;
  xp: number;
  /** Chỉ các ngày có thay đổi. */
  days: Map<string, DayState>;
  counters: Counters;
  /** Các ngày vừa chuyển thành ngày streak trong lô này. */
  newStreakDays: string[];
}

export function applyBatch(
  placed: Placed[],
  days: ReadonlyMap<string, DayState>,
  counters: Counters,
): BatchResult {
  const working = new Map(days);
  let current = counters;
  let gems = 0;
  let xp = 0;

  for (const {event, capDay, streakEligible} of placed) {
    const out = applyEvent(event, working.get(capDay) ?? EMPTY_DAY, current, streakEligible);
    working.set(capDay, out.day);
    current = out.counters;
    gems += out.gems;
    xp += out.xp;
  }

  const changed = new Map<string, DayState>();
  const newStreakDays: string[] = [];
  for (const [day, state] of working) {
    const before = days.get(day) ?? EMPTY_DAY;
    if (JSON.stringify(before) !== JSON.stringify(state)) changed.set(day, state);
    if (state.streakDay && !before.streakDay) newStreakDays.push(day);
  }
  return {gems, xp, days: changed, counters: current, newStreakDays};
}
