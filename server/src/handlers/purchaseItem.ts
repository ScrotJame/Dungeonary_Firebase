import {type PlayerSnapshot, toSnapshot} from "../domain/player";
import {decidePurchase, parseCatalogItem, parsePurchaseInput} from "../domain/shop";
import {AppError} from "../http/errors";
import type {HandlerDeps} from "./importGuestProgress";

export interface PurchaseOutput {
  player: PlayerSnapshot;
  /** Số đang giữ sau khi mua. */
  item: {itemId: string; quantity: number};
}

/** Spec shop 5.1: mua vật phẩm bằng gems, cùng requestId chỉ trừ một lần. */
export async function purchaseItem(
  uid: string,
  input: unknown,
  deps: HandlerDeps,
): Promise<PurchaseOutput> {
  const req = parsePurchaseInput(input);

  return deps.store.transaction(async (tx) => {
    const player = await tx.getPlayer(uid);
    if (!player) throw new AppError("failed-precondition", "not-imported");
    const ledger = await tx.getLedger(uid, req.requestId);
    const catalogDoc = await tx.getCatalogItem(req.itemId);
    const owned = await tx.getInventory(uid, req.itemId);

    const item = catalogDoc === undefined ? null : parseCatalogItem(req.itemId, catalogDoc);
    if (catalogDoc !== undefined && item === null) {
      console.warn(`shop_items/${req.itemId} is malformed or has no effect in code; not for sale`);
    }

    const decision = decidePurchase(req, {gems: player.gems, item, owned, ledger});
    if (decision.kind === "replay") {
      return {player: toSnapshot(player), item: {itemId: req.itemId, quantity: owned}};
    }

    const gems = player.gems - decision.cost;
    tx.updatePlayerFields(uid, {gems});
    tx.setInventory(uid, req.itemId, decision.ownedAfter);
    tx.addLedger(uid, {
      type: "purchase",
      gems: -decision.cost,
      xp: 0,
      itemId: req.itemId,
      quantity: req.quantity,
      price: decision.price,
    }, req.requestId);
    return {
      player: {...toSnapshot(player), gems},
      item: {itemId: req.itemId, quantity: decision.ownedAfter},
    };
  });
}
