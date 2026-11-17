import {STREAK_FREEZE} from "../config/shop";
import {utcDay} from "../domain/days";
import {parseSyncInput} from "../domain/events";
import {levelForXp} from "../domain/level";
import {type PlayerSnapshot, toSnapshot} from "../domain/player";
import {applyBatch, placeBatch} from "../domain/rewards";
import {
  advanceStreak,
  needsFreezeCount,
  needsStreakHistory,
  sameLostStreak,
} from "../domain/streak";
import {AppError} from "../http/errors";
import type {HandlerDeps} from "./importGuestProgress";

export interface SyncOutput {
  /** App xoá khỏi hàng đợi mọi sự kiện có seq <= ackSeq. */
  ackSeq: number;
  player: PlayerSnapshot;
}

/** Spec gốc 6.3 và spec shop 6.1 đến 6.3: nhận một lô sự kiện, tính thưởng, trả về trạng thái mới. */
export async function syncProgress(
  uid: string,
  input: unknown,
  deps: HandlerDeps,
): Promise<SyncOutput> {
  const {deviceId, items} = parseSyncInput(input);
  const now = deps.now();

  return deps.store.transaction(async (tx) => {
    const player = await tx.getPlayer(uid);
    if (!player) throw new AppError("failed-precondition", "not-imported");

    const lastSeq = player.devices[deviceId]?.lastSeq ?? 0;
    const batch = placeBatch(items, lastSeq, now);
    if (batch.maxSeq === lastSeq) {
      return {ackSeq: lastSeq, player: toSnapshot(player)};
    }

    // Mọi lượt đọc phải xong trước lượt ghi đầu tiên.
    const days = await tx.getDays(uid, batch.capDays);
    const result = applyBatch(batch.placed, days, {
      feedQuizSinceReward: player.feedQuizSinceReward,
      totalLearned: player.totalLearned,
    }, player.doubleGems);
    const {lastDay} = player.streak;
    const history = lastDay !== null && needsStreakHistory(player.streak, result.newStreakDays) ?
      await tx.getStreakRun(uid, lastDay, new Set(result.newStreakDays)) :
      null;
    const freezes = needsFreezeCount(player.streak, result.newStreakDays) ?
      await tx.getInventory(uid, STREAK_FREEZE) :
      0;

    const outcome = advanceStreak(player.streak, result.newStreakDays, history, {
      freezes,
      lostStreak: player.lostStreak,
      today: utcDay(now),
    });
    const xp = player.xp + result.xp;
    const next: PlayerSnapshot = {
      gems: player.gems + result.gems,
      xp,
      level: levelForXp(xp),
      totalLearned: result.counters.totalLearned,
      streak: outcome.streak,
    };

    tx.updatePlayer(
      uid, next, result.counters.feedQuizSinceReward, player.devices, deviceId, batch.maxSeq,
      sameLostStreak(outcome.lostStreak, player.lostStreak) ? undefined : outcome.lostStreak);

    // Mỗi document days chỉ ghi một lần, kể cả ngày vừa có sự kiện vừa được cứu.
    const frozen = new Set(outcome.frozenDays);
    for (const [day, state] of result.days) {
      tx.setDay(uid, day, frozen.has(day) ? {...state, frozen: true} : state);
    }
    for (const day of outcome.frozenDays) {
      if (!result.days.has(day)) tx.setDay(uid, day, {frozen: true});
    }

    if (result.gems !== 0 || result.xp !== 0) {
      tx.addLedger(uid, {
        type: "sync",
        gems: result.gems,
        xp: result.xp,
        deviceId,
        seqFrom: batch.minSeq,
        seqTo: batch.maxSeq,
      });
    }
    if (outcome.frozenDays.length > 0) {
      tx.setInventory(uid, STREAK_FREEZE, freezes - outcome.frozenDays.length);
      tx.addLedger(uid, {
        type: "use_item",
        gems: 0,
        xp: 0,
        itemId: "streak_freeze",
        quantity: outcome.frozenDays.length,
        days: outcome.frozenDays,
        deviceId,
      });
    }
    return {ackSeq: batch.maxSeq, player: next};
  });
}
