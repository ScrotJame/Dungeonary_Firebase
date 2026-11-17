import {parseSyncInput} from "../domain/events";
import {levelForXp} from "../domain/level";
import {type PlayerSnapshot, toSnapshot} from "../domain/player";
import {applyBatch, placeBatch} from "../domain/rewards";
import {advanceStreak, needsStreakHistory} from "../domain/streak";
import {AppError} from "../http/errors";
import type {HandlerDeps} from "./importGuestProgress";

export interface SyncOutput {
  /** App xoá khỏi hàng đợi mọi sự kiện có seq <= ackSeq. */
  ackSeq: number;
  player: PlayerSnapshot;
}

/** Spec gốc 6.3: nhận một lô sự kiện, tính thưởng, trả về trạng thái mới. */
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
    });
    const {lastDay} = player.streak;
    const history = lastDay !== null && needsStreakHistory(player.streak, result.newStreakDays) ?
      await tx.getStreakRun(uid, lastDay, new Set(result.newStreakDays)) :
      null;

    const xp = player.xp + result.xp;
    const next: PlayerSnapshot = {
      gems: player.gems + result.gems,
      xp,
      level: levelForXp(xp),
      totalLearned: result.counters.totalLearned,
      streak: advanceStreak(player.streak, result.newStreakDays, history),
    };

    tx.updatePlayer(
      uid, next, result.counters.feedQuizSinceReward, player.devices, deviceId, batch.maxSeq);
    for (const [day, state] of result.days) tx.setDay(uid, day, state);
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
    return {ackSeq: batch.maxSeq, player: next};
  });
}
