import type {PlayerStore} from "../data/playerStore";
import {utcDay} from "../domain/days";
import {parseImportInput} from "../domain/events";
import {clampGuestProfile} from "../domain/importProfile";
import {type PlayerSnapshot, toSnapshot} from "../domain/player";

export interface HandlerDeps {
  store: PlayerStore;
  /** Giờ server, ms từ epoch. Tách ra để test đặt được đồng hồ. */
  now: () => number;
}

export interface ImportOutput {
  imported: boolean;
  player: PlayerSnapshot;
}

/** Spec gốc 6.2: tạo players/{uid} từ dữ liệu trên máy, chỉ lần đầu có tác dụng. */
export async function importGuestProgress(
  uid: string,
  input: unknown,
  deps: HandlerDeps,
): Promise<ImportOutput> {
  const {deviceId, profile} = parseImportInput(input);
  const today = utcDay(deps.now());

  return deps.store.transaction(async (tx) => {
    const existing = await tx.getPlayer(uid);
    if (existing) return {imported: false, player: toSnapshot(existing)};

    const player = clampGuestProfile(profile, today);
    tx.createPlayer(uid, player, deviceId);
    tx.addLedger(uid, {type: "import", gems: player.gems, xp: player.xp, deviceId});
    return {imported: true, player};
  });
}
