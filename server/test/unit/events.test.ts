import {describe, expect, it} from "vitest";
import {parseImportInput, parseSyncInput} from "../../src/domain/events";
import {AppError} from "../../src/http/errors";

const AT = Date.UTC(2026, 10, 17, 12);
const DAY = "2026-11-17";

function one(event: Record<string, unknown>) {
  const {items} = parseSyncInput({
    deviceId: "dev-1",
    events: [{seq: 1, at: AT, day: DAY, ...event}],
  });
  return items[0];
}

function expectInvalid(fn: () => unknown) {
  expect(fn).toThrow(AppError);
  try {
    fn();
  } catch (err) {
    expect((err as AppError).code).toBe("invalid-argument");
  }
}

describe("parseSyncInput: vỏ request", () => {
  it("nhận mảng rỗng", () => {
    expect(parseSyncInput({deviceId: "dev-1", events: []})).toEqual({
      deviceId: "dev-1",
      items: [],
    });
  });

  it("từ chối thân không phải object, deviceId sai, events không phải mảng", () => {
    expectInvalid(() => parseSyncInput(null));
    expectInvalid(() => parseSyncInput([]));
    expectInvalid(() => parseSyncInput({deviceId: "", events: []}));
    expectInvalid(() => parseSyncInput({deviceId: 5, events: []}));
    expectInvalid(() => parseSyncInput({deviceId: "x".repeat(129), events: []}));
    expectInvalid(() => parseSyncInput({deviceId: "dev-1"}));
    expectInvalid(() => parseSyncInput({deviceId: "dev-1", events: {}}));
  });

  it("từ chối lô quá 200 sự kiện", () => {
    const events = Array.from({length: 201}, (_, i) => ({seq: i + 1}));
    expectInvalid(() => parseSyncInput({deviceId: "dev-1", events}));
  });

  it("bỏ hẳn phần tử không có seq nguyên dương", () => {
    const {items} = parseSyncInput({
      deviceId: "dev-1",
      events: [
        "junk",
        {type: "word_mastered", at: AT, day: DAY},
        {seq: 0, type: "word_mastered", at: AT, day: DAY},
        {seq: 1.5, type: "word_mastered", at: AT, day: DAY},
        {seq: 7, type: "word_mastered", at: AT, day: DAY},
      ],
    });
    expect(items.map((i) => i.seq)).toEqual([7]);
  });
});

describe("parseSyncInput: từng sự kiện", () => {
  it("sự kiện hỏng giữ seq nhưng event là null", () => {
    expect(one({type: "khong_co_that"})).toEqual({seq: 1, event: null});
    expect(one({type: "word_mastered", at: "hôm nay"})).toEqual({seq: 1, event: null});
    expect(one({type: "word_mastered", day: "2026-02-30"})).toEqual({seq: 1, event: null});
    expect(one({type: "word_mastered", at: -1})).toEqual({seq: 1, event: null});
  });

  it("feed_quiz_correct", () => {
    const data = {multiplier: 1.25, eventActive: true, combo: false};
    expect(one({type: "feed_quiz_correct", data})).toEqual({
      seq: 1,
      event: {seq: 1, at: AT, day: DAY, type: "feed_quiz_correct", ...data},
    });
    expect(one({type: "feed_quiz_correct", data: {...data, multiplier: 3}}).event).toBeNull();
    expect(one({type: "feed_quiz_correct", data: {...data, combo: "yes"}}).event).toBeNull();
    expect(one({type: "feed_quiz_correct"}).event).toBeNull();
  });

  it("feed_reward_card", () => {
    expect(one({type: "feed_reward_card", data: {xp: 20, gems: 5}}).event).toMatchObject({
      type: "feed_reward_card",
      xp: 20,
      gems: 5,
    });
    expect(one({type: "feed_reward_card", data: {xp: -1, gems: 5}}).event).toBeNull();
    expect(one({type: "feed_reward_card", data: {xp: 2.5, gems: 5}}).event).toBeNull();
  });

  it("flashcard_session: remembered từ 1 đến 200", () => {
    expect(one({type: "flashcard_session", data: {remembered: 200}}).event).toMatchObject({
      remembered: 200,
    });
    expect(one({type: "flashcard_session", data: {remembered: 0}}).event).toBeNull();
    expect(one({type: "flashcard_session", data: {remembered: 201}}).event).toBeNull();
  });

  it("test_level_up: level không âm", () => {
    expect(one({type: "test_level_up", data: {level: 0}}).event).toMatchObject({level: 0});
    expect(one({type: "test_level_up", data: {level: -1}}).event).toBeNull();
  });

  it("matching_session: pairs từ 1 đến 50", () => {
    expect(one({type: "matching_session", data: {pairs: 50}}).event).toMatchObject({pairs: 50});
    expect(one({type: "matching_session", data: {pairs: 0}}).event).toBeNull();
    expect(one({type: "matching_session", data: {pairs: 51}}).event).toBeNull();
  });

  it("quest_completed: questId phải có trong bảng quest", () => {
    expect(one({type: "quest_completed", data: {questId: "learn_5"}}).event).toMatchObject({
      questId: "learn_5",
    });
    expect(one({type: "quest_completed", data: {questId: "free_gems"}}).event).toBeNull();
    expect(one({type: "quest_completed", data: {questId: "toString"}}).event).toBeNull();
  });

  it("word_mastered và word_unmastered không cần data", () => {
    expect(one({type: "word_mastered"}).event).toEqual({
      seq: 1, at: AT, day: DAY, type: "word_mastered",
    });
    expect(one({type: "word_unmastered"}).event).toEqual({
      seq: 1, at: AT, day: DAY, type: "word_unmastered",
    });
  });
});

describe("parseImportInput", () => {
  const profile = {
    gems: 100,
    experience: 250,
    totalLearned: 12,
    currentStreak: 3,
    longestStreak: 9,
    lastActiveDay: "2026-11-17",
  };

  it("nhận hồ sơ hợp lệ", () => {
    expect(parseImportInput({deviceId: "dev-1", profile})).toEqual({
      deviceId: "dev-1",
      profile,
    });
  });

  it("lastActiveDay sai dạng thành null", () => {
    const out = parseImportInput({
      deviceId: "dev-1",
      profile: {...profile, lastActiveDay: "hôm qua"},
    });
    expect(out.profile.lastActiveDay).toBeNull();
  });

  it("từ chối khi thiếu profile hoặc một trường số không phải số hữu hạn", () => {
    expectInvalid(() => parseImportInput({deviceId: "dev-1"}));
    expectInvalid(() => parseImportInput({deviceId: "", profile}));
    expectInvalid(() =>
      parseImportInput({deviceId: "dev-1", profile: {...profile, gems: "100"}}));
    expectInvalid(() =>
      parseImportInput({deviceId: "dev-1", profile: {...profile, experience: Infinity}}));
  });
});
