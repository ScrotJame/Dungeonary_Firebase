import {utcDay} from "../domain/days";
import {type PlayerSnapshot, toSnapshot} from "../domain/player";
import {decideUse, parseUseInput, type UseEffect} from "../domain/shop";
import {AppError} from "../http/errors";
import type {HandlerDeps} from "./importGuestProgress";

export interface UseOutput {
  player: PlayerSnapshot;
  /** Số còn lại. */
  item: {itemId: string; quantity: number};
  effect: UseEffect;
}

/** Spec shop 5.2: dùng Double Gems hoặc Save Streak. Không đọc shop_items. */
export async function useItem(
  uid: string,
  input: unknown,
  deps: HandlerDeps,
): Promise<UseOutput> {
  const req = parseUseInput(input);
  const now = deps.now();

  return deps.store.transaction(async (tx) => {
    const player = await tx.getPlayer(uid);
    if (!player) throw new AppError("failed-precondition", "not-imported");
    const ledger = await tx.getLedger(uid, req.requestId);
    const owned = await tx.getInventory(uid, req.itemId);

    const decision = decideUse(req, {
      owned,
      ledger,
      now,
      today: utcDay(now),
      streak: player.streak,
      doubleGems: player.doubleGems,
      lostStreak: player.lostStreak,
    });
    if (decision.kind === "replay") {
      return {
        player: toSnapshot(player),
        item: {itemId: req.itemId, quantity: owned},
        effect: decision.effect,
      };
    }

    tx.updatePlayerFields(uid, decision.changes);
    tx.setInventory(uid, req.itemId, owned - 1);
    tx.addLedger(uid, {
      type: "use_item",
      gems: 0,
      xp: 0,
      itemId: req.itemId,
      quantity: 1,
      effect: decision.effect,
    }, req.requestId);
    return {
      player: {...toSnapshot(player), streak: decision.changes.streak ?? player.streak},
      item: {itemId: req.itemId, quantity: owned - 1},
      effect: decision.effect,
    };
  });
}
