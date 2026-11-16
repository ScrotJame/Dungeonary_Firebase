import {
  FEED_MULTIPLIERS,
  MAX_DEVICE_ID_LENGTH,
  MAX_EVENTS_PER_SYNC,
  QUESTS,
} from "../config/rewards";
import {AppError} from "../http/errors";
import {isValidDay} from "./days";

interface EventBase {
  /** Số thứ tự theo máy, tăng dần, không dùng lại. */
  seq: number;
  /** Thời điểm xảy ra, ms từ epoch. */
  at: number;
  /** yyyy-MM-dd theo giờ máy lúc xảy ra. */
  day: string;
}

export type GameEvent = EventBase & (
  | {type: "feed_quiz_correct"; multiplier: number; eventActive: boolean; combo: boolean}
  | {type: "feed_reward_card"; xp: number; gems: number}
  | {type: "flashcard_session"; remembered: number}
  | {type: "test_level_up"; level: number}
  | {type: "matching_session"; pairs: number}
  | {type: "quest_completed"; questId: string}
  | {type: "word_mastered"}
  | {type: "word_unmastered"}
);

/** `event` là null khi sự kiện hỏng: bỏ qua nhưng vẫn xác nhận `seq`. */
export interface BatchItem {
  seq: number;
  event: GameEvent | null;
}

export interface GuestProfile {
  gems: number;
  experience: number;
  totalLearned: number;
  currentStreak: number;
  longestStreak: number;
  lastActiveDay: string | null;
}

/** Giá trị `at` lớn nhất mà `new Date()` còn biểu diễn được. */
const MAX_DATE_MS = 8.64e15;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v);
}

function isIntBetween(v: unknown, min: number, max: number): v is number {
  return isInt(v) && v >= min && v <= max;
}

function parseDeviceId(v: unknown): string {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_DEVICE_ID_LENGTH) {
    throw new AppError("invalid-argument");
  }
  return v;
}

function parseEvent(raw: Record<string, unknown>, seq: number): GameEvent | null {
  const {at, day, type} = raw;
  if (typeof at !== "number" || !Number.isFinite(at) || at < 0 || at > MAX_DATE_MS) {
    return null;
  }
  if (!isValidDay(day)) return null;
  const base = {seq, at, day};
  const data = isRecord(raw.data) ? raw.data : {};

  switch (type) {
    case "feed_quiz_correct": {
      const {multiplier, eventActive, combo} = data;
      if (typeof multiplier !== "number" || !FEED_MULTIPLIERS.includes(multiplier)) {
        return null;
      }
      if (typeof eventActive !== "boolean" || typeof combo !== "boolean") return null;
      return {...base, type, multiplier, eventActive, combo};
    }
    case "feed_reward_card": {
      const {xp, gems} = data;
      if (!isInt(xp) || xp < 0 || !isInt(gems) || gems < 0) return null;
      return {...base, type, xp, gems};
    }
    case "flashcard_session": {
      const {remembered} = data;
      if (!isIntBetween(remembered, 1, 200)) return null;
      return {...base, type, remembered};
    }
    case "test_level_up": {
      const {level} = data;
      if (!isInt(level) || level < 0) return null;
      return {...base, type, level};
    }
    case "matching_session": {
      const {pairs} = data;
      if (!isIntBetween(pairs, 1, 50)) return null;
      return {...base, type, pairs};
    }
    case "quest_completed": {
      const {questId} = data;
      if (typeof questId !== "string" || !Object.hasOwn(QUESTS, questId)) return null;
      return {...base, type, questId};
    }
    case "word_mastered":
    case "word_unmastered":
      return {...base, type};
    default:
      return null;
  }
}

export function parseSyncInput(body: unknown): {deviceId: string; items: BatchItem[]} {
  if (!isRecord(body)) throw new AppError("invalid-argument");
  const deviceId = parseDeviceId(body.deviceId);
  const events = body.events;
  if (!Array.isArray(events) || events.length > MAX_EVENTS_PER_SYNC) {
    throw new AppError("invalid-argument");
  }
  const items: BatchItem[] = [];
  for (const raw of events) {
    if (!isRecord(raw)) continue;
    const seq = raw.seq;
    if (!isInt(seq) || seq < 1) continue;
    items.push({seq, event: parseEvent(raw, seq)});
  }
  return {deviceId, items};
}

export function parseImportInput(body: unknown): {deviceId: string; profile: GuestProfile} {
  if (!isRecord(body)) throw new AppError("invalid-argument");
  const deviceId = parseDeviceId(body.deviceId);
  const p = body.profile;
  if (!isRecord(p)) throw new AppError("invalid-argument");

  const num = (v: unknown): number => {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new AppError("invalid-argument");
    }
    return v;
  };

  return {
    deviceId,
    profile: {
      gems: num(p.gems),
      experience: num(p.experience),
      totalLearned: num(p.totalLearned),
      currentStreak: num(p.currentStreak),
      longestStreak: num(p.longestStreak),
      lastActiveDay: isValidDay(p.lastActiveDay) ? p.lastActiveDay : null,
    },
  };
}
