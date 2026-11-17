import {describe, expect, it} from "vitest";
import type {GameEvent} from "../../src/domain/events";
import {
  applyBatch,
  applyEvent,
  type Counters,
  type DayState,
  EMPTY_DAY,
  placeBatch,
  placeEvent,
} from "../../src/domain/rewards";

const NOW = Date.UTC(2026, 10, 17, 12);
const TODAY = "2026-11-17";
const DAY_MS = 86_400_000;
const base = {seq: 1, at: NOW, day: TODAY};
const zero: Counters = {feedQuizSinceReward: 0, totalLearned: 0};

const quiz = (over: object = {}): GameEvent => ({
  ...base, type: "feed_quiz_correct", multiplier: 1, eventActive: false, combo: false, ...over,
});
const quest = (questId: string): GameEvent => ({...base, type: "quest_completed", questId});
const day = (over: Partial<DayState> = {}): DayState => ({...EMPTY_DAY, ...over});

describe("placeEvent", () => {
  it("bỏ sự kiện có at muộn hơn giờ server quá 5 phút", () => {
    expect(placeEvent({at: NOW + 5 * 60_000 + 1, day: TODAY}, NOW)).toBeNull();
    expect(placeEvent({at: NOW + 5 * 60_000, day: TODAY}, NOW)).toEqual({
      capDay: TODAY, streakEligible: true,
    });
  });

  it("bỏ sự kiện có day lệch quá một ngày so với ngày UTC của at", () => {
    expect(placeEvent({at: NOW, day: "2026-11-19"}, NOW)).toBeNull();
    expect(placeEvent({at: NOW, day: "2026-11-15"}, NOW)).toBeNull();
    expect(placeEvent({at: NOW, day: "2026-11-18"}, NOW)).toEqual({
      capDay: "2026-11-18", streakEligible: true,
    });
  });

  it("ngày trong 7 ngày gần đây tính vào trần của chính ngày đó", () => {
    expect(placeEvent({at: NOW - 7 * DAY_MS, day: "2026-11-10"}, NOW)).toEqual({
      capDay: "2026-11-10", streakEligible: true,
    });
  });

  it("ngày cũ hơn 7 ngày tính vào trần hôm nay và không tính streak", () => {
    expect(placeEvent({at: NOW - 8 * DAY_MS, day: "2026-11-09"}, NOW)).toEqual({
      capDay: TODAY, streakEligible: false,
    });
  });
});

describe("applyEvent: feed_quiz_correct", () => {
  it("tính XP theo multiplier, combo và gems theo eventActive", () => {
    const out = applyEvent(quiz({multiplier: 1.25, combo: true, eventActive: true}), day(), zero, true);
    expect(out.xp).toBe(16);
    expect(out.gems).toBe(3);
    expect(out.day.counts.feed_quiz_correct).toBe(1);
    expect(out.counters.feedQuizSinceReward).toBe(1);
  });

  it("vượt trần 200 câu thì không thưởng nhưng bộ đếm thẻ vẫn tăng, tối đa 3", () => {
    const full = day({counts: {feed_quiz_correct: 200}});
    const out = applyEvent(quiz(), full, {...zero, feedQuizSinceReward: 2}, true);
    expect(out.xp).toBe(0);
    expect(out.gems).toBe(0);
    expect(out.day.counts.feed_quiz_correct).toBe(200);
    expect(out.counters.feedQuizSinceReward).toBe(3);
    const again = applyEvent(quiz(), full, out.counters, true);
    expect(again.counters.feedQuizSinceReward).toBe(3);
  });
});

describe("applyEvent: feed_reward_card", () => {
  const card: GameEvent = {...base, type: "feed_reward_card", xp: 100, gems: 100};

  it("không trả khi chưa đủ 3 câu quiz, và không đụng bộ đếm", () => {
    const out = applyEvent(card, day(), {...zero, feedQuizSinceReward: 2}, true);
    expect(out.xp).toBe(0);
    expect(out.gems).toBe(0);
    expect(out.counters.feedQuizSinceReward).toBe(2);
    expect(out.day).toEqual(EMPTY_DAY);
  });

  it("trả tối đa 39 XP và 19 gems rồi đưa bộ đếm về 0", () => {
    const out = applyEvent(card, day(), {...zero, feedQuizSinceReward: 3}, true);
    expect(out.xp).toBe(39);
    expect(out.gems).toBe(19);
    expect(out.counters.feedQuizSinceReward).toBe(0);
    expect(out.day.counts.feed_reward_card).toBe(1);
  });
});

describe("applyEvent: các nguồn tính theo đơn vị", () => {
  it("flashcard_session trả 5 XP và 1 gem mỗi thẻ", () => {
    const out = applyEvent({...base, type: "flashcard_session", remembered: 10}, day(), zero, true);
    expect(out.xp).toBe(50);
    expect(out.gems).toBe(10);
  });

  it("flashcard_session chỉ trả phần còn trong trần 200 thẻ", () => {
    const out = applyEvent(
      {...base, type: "flashcard_session", remembered: 10},
      day({counts: {flashcard_session: 195}}), zero, true);
    expect(out.xp).toBe(25);
    expect(out.gems).toBe(5);
    expect(out.day.counts.flashcard_session).toBe(200);
  });

  it("matching_session trả 20 XP và 5 gems mỗi cặp, trần 100 cặp", () => {
    const out = applyEvent({...base, type: "matching_session", pairs: 3}, day(), zero, true);
    expect(out.xp).toBe(60);
    expect(out.gems).toBe(15);
    const capped = applyEvent(
      {...base, type: "matching_session", pairs: 3},
      day({counts: {matching_session: 100}}), zero, true);
    expect(capped.xp).toBe(0);
    expect(capped.gems).toBe(0);
  });

  it.each([
    [0, 5, 5],
    [1, 5, 10],
    [2, 10, 20],
    [3, 15, 35],
    [4, 25, 50],
    [5, 40, 75],
    [9, 40, 75],
  ])("test_level_up level %i trả %i XP và %i gems", (level, xp, gems) => {
    const out = applyEvent({...base, type: "test_level_up", level}, day(), zero, true);
    expect(out.xp).toBe(xp);
    expect(out.gems).toBe(gems);
  });
});

describe("applyEvent: quest_completed", () => {
  it("trả gems theo bảng quest và ghi questId vào ngày", () => {
    const out = applyEvent(quest("learn_5"), day(), zero, true);
    expect(out.gems).toBe(10);
    expect(out.xp).toBe(0);
    expect(out.day.quests).toEqual(["learn_5"]);
    expect(out.day.streakDay).toBe(false);
  });

  it("cùng questId trong một ngày chỉ trả một lần", () => {
    const out = applyEvent(quest("learn_5"), day({quests: ["learn_5"]}), zero, true);
    expect(out.gems).toBe(0);
    expect(out.day.quests).toEqual(["learn_5"]);
  });

  it("mỗi ngày tối đa hai quest của pool", () => {
    const out = applyEvent(quest("quiz_1"), day({quests: ["learn_5", "feed_5"]}), zero, true);
    expect(out.gems).toBe(0);
    expect(out.day.quests).toEqual(["learn_5", "feed_5"]);
  });

  it("đủ một quest mặc định và hai quest pool thì thành ngày streak", () => {
    const out = applyEvent(
      quest("default_active_time"), day({quests: ["learn_5", "feed_5"]}), zero, true);
    expect(out.gems).toBe(5);
    expect(out.day.streakDay).toBe(true);
  });

  it("quest của ngày quá cũ được trả gems nhưng không vào danh sách quests", () => {
    const out = applyEvent(quest("learn_5"), day(), zero, false);
    expect(out.gems).toBe(10);
    expect(out.day.quests).toEqual([]);
    expect(out.day.streakDay).toBe(false);
    expect(out.day.counts.quest_late).toBe(1);
  });

  it("quest của ngày quá cũ có trần 3 mỗi ngày", () => {
    const out = applyEvent(quest("learn_5"), day({counts: {quest_late: 3}}), zero, false);
    expect(out.gems).toBe(0);
  });

  it("cùng questId của ngày quá cũ chỉ trả một lần mỗi ngày", () => {
    const first = applyEvent(quest("learn_10"), day(), zero, false);
    expect(first.gems).toBe(15);
    const again = applyEvent(quest("learn_10"), first.day, zero, false);
    expect(again.gems).toBe(0);
    expect(again.day.counts.quest_late).toBe(1);
  });

  it("quest của ngày quá cũ cũng tối đa hai quest của pool", () => {
    let state = day();
    let gems = 0;
    for (const id of ["learn_10", "quiz_1", "feed_10", "default_active_time"]) {
      const out = applyEvent(quest(id), state, zero, false);
      state = out.day;
      gems += out.gems;
    }
    // learn_10 (15) + quiz_1 (15) + default_active_time (5); feed_10 là quest pool thứ ba.
    expect(gems).toBe(35);
    expect(state.counts.quest_late).toBe(3);
    expect(state.quests).toEqual([]);
  });

  it("quest của ngày quá cũ không chiếm chỗ quest của hôm nay", () => {
    const late = applyEvent(quest("learn_5"), day(), zero, false);
    const onTime = applyEvent(quest("learn_5"), late.day, zero, true);
    expect(onTime.gems).toBe(10);
    expect(onTime.day.quests).toEqual(["learn_5"]);
  });
});

describe("applyEvent: trần tổng mỗi ngày và số từ", () => {
  it("cắt phần gems vượt 2000 và XP vượt 5000", () => {
    const out = applyEvent(
      {...base, type: "matching_session", pairs: 3},
      day({gemsEarned: 1995, xpEarned: 5000}), zero, true);
    expect(out.gems).toBe(5);
    expect(out.xp).toBe(0);
    expect(out.day.gemsEarned).toBe(2000);
    expect(out.day.xpEarned).toBe(5000);
  });

  it("word_mastered cộng một, word_unmastered trừ một và không xuống dưới 0", () => {
    const up = applyEvent({...base, type: "word_mastered"}, day(), {...zero, totalLearned: 4}, true);
    expect(up.counters.totalLearned).toBe(5);
    const down = applyEvent({...base, type: "word_unmastered"}, day(), zero, true);
    expect(down.counters.totalLearned).toBe(0);
    expect(down.day).toEqual(EMPTY_DAY);
  });
});

describe("placeBatch", () => {
  const mastered = (seq: number): GameEvent => ({...base, seq, type: "word_mastered"});

  it("bỏ seq đã xử lý, sắp theo seq, và tính cả seq của sự kiện hỏng vào maxSeq", () => {
    const out = placeBatch(
      [
        {seq: 6, event: mastered(6)},
        {seq: 3, event: mastered(3)},
        {seq: 5, event: mastered(5)},
        {seq: 9, event: null},
      ],
      4, NOW);
    expect(out.placed.map((p) => p.event.seq)).toEqual([5, 6]);
    expect(out.minSeq).toBe(5);
    expect(out.maxSeq).toBe(9);
    expect(out.capDays).toEqual([TODAY]);
  });

  it("lô không có seq mới thì maxSeq bằng lastSeq", () => {
    const out = placeBatch([{seq: 2, event: mastered(2)}], 4, NOW);
    expect(out.placed).toEqual([]);
    expect(out.maxSeq).toBe(4);
  });

  it("seq trùng trong một lô chỉ giữ phần tử đầu", () => {
    const out = placeBatch(
      [{seq: 5, event: mastered(5)}, {seq: 5, event: mastered(5)}], 0, NOW);
    expect(out.placed).toHaveLength(1);
  });

  it("quest của ngày quá cũ được xếp vào hôm nay và không tính streak", () => {
    const old: GameEvent = {
      seq: 2, at: NOW - 8 * DAY_MS, day: "2026-11-09", type: "quest_completed", questId: "feed_5",
    };
    const out = placeBatch(
      [{seq: 1, event: quest("learn_5")}, {seq: 2, event: old}, {seq: 3, event: mastered(3)}],
      0, NOW);
    expect(out.placed.map((p) => [p.capDay, p.streakEligible])).toEqual([
      [TODAY, true], [TODAY, false], [TODAY, true],
    ]);
    expect(out.capDays).toEqual([TODAY]);
  });
});

describe("applyBatch", () => {
  it("cộng dồn thưởng, chỉ trả về ngày có thay đổi, và báo ngày vừa thành ngày streak", () => {
    const placed = placeBatch(
      [
        {seq: 1, event: {...quest("learn_5"), seq: 1}},
        {seq: 2, event: {...quest("feed_5"), seq: 2}},
        {seq: 3, event: {...quest("default_active_time"), seq: 3}},
        {seq: 4, event: {...base, seq: 4, type: "word_mastered"}},
      ],
      0, NOW).placed;
    const out = applyBatch(placed, new Map(), zero);
    expect(out.gems).toBe(25);
    expect(out.xp).toBe(0);
    expect(out.counters.totalLearned).toBe(1);
    expect([...out.days.keys()]).toEqual([TODAY]);
    expect(out.days.get(TODAY)?.streakDay).toBe(true);
    expect(out.newStreakDays).toEqual([TODAY]);
  });

  it("ngày không đổi thì không nằm trong kết quả", () => {
    const placed = placeBatch(
      [{seq: 1, event: {...base, seq: 1, type: "word_mastered"}}], 0, NOW).placed;
    const out = applyBatch(placed, new Map(), zero);
    expect(out.days.size).toBe(0);
    expect(out.newStreakDays).toEqual([]);
  });
});
