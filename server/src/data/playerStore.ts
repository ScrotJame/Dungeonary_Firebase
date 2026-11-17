import {
  FieldValue,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import {addDays} from "../domain/days";
import type {PlayerSnapshot} from "../domain/player";
import {type DayState, EMPTY_DAY} from "../domain/rewards";

/** Số ngày đọc ở lượt đầu khi dò chuỗi streak; đủ cho khoảng bù ngày cũ (LOOKBACK_DAYS + 1). */
const STREAK_RUN_FIRST_READ = 8;

export interface DeviceState {
  lastSeq: number;
  lastSyncAt: unknown;
}

/** Các trường của players/{uid} mà phần 1 đọc. */
export interface StoredPlayer extends PlayerSnapshot {
  feedQuizSinceReward: number;
  devices: Record<string, DeviceState>;
}

export type LedgerEntry =
  | {type: "import"; gems: number; xp: number; deviceId: string}
  | {type: "sync"; gems: number; xp: number; deviceId: string; seqFrom: number; seqTo: number};

function toDayState(data: DocumentData | undefined): DayState {
  if (!data) return EMPTY_DAY;
  return {
    counts: data.counts ?? {},
    gemsEarned: data.gemsEarned ?? 0,
    xpEarned: data.xpEarned ?? 0,
    quests: data.quests ?? [],
    streakDay: data.streakDay ?? false,
  };
}

/** Các thao tác đọc và ghi trong một transaction. Mọi lượt đọc phải đứng trước lượt ghi. */
export class PlayerTx {
  constructor(
    private readonly db: Firestore,
    private readonly tx: Transaction,
  ) {}

  private player(uid: string): DocumentReference {
    return this.db.collection("players").doc(uid);
  }

  async getPlayer(uid: string): Promise<StoredPlayer | null> {
    const snap = await this.tx.get(this.player(uid));
    return snap.exists ? (snap.data() as StoredPlayer) : null;
  }

  async getDays(uid: string, days: string[]): Promise<Map<string, DayState>> {
    const result = new Map<string, DayState>();
    if (days.length === 0) return result;
    const refs = days.map((day) => this.player(uid).collection("days").doc(day));
    const snaps = await this.tx.getAll(...refs);
    for (const snap of snaps) result.set(snap.id, toDayState(snap.data()));
    return result;
  }

  /**
   * Chuỗi ngày streak liền nhau, dò lùi từ `end`. `assumed` là các ngày vừa thành
   * ngày streak trong lô đang xử lý, chưa được ghi. Đọc document theo id, mỗi lượt
   * gấp đôi lượt trước, nên số lượt đọc tỉ lệ với độ dài chuỗi chứ không theo tổng
   * số ngày streak từng có.
   */
  async getStreakRun(uid: string, end: string, assumed: ReadonlySet<string>): Promise<string[]> {
    const run: string[] = [];
    let from = end;
    for (let size = STREAK_RUN_FIRST_READ; ; size *= 2) {
      const chunk = Array.from({length: size}, (_, i) => addDays(from, -i));
      const stored = new Set<string>();
      const refs = chunk
        .filter((day) => !assumed.has(day))
        .map((day) => this.player(uid).collection("days").doc(day));
      if (refs.length > 0) {
        const snaps = await this.tx.getAll(...refs, {fieldMask: ["streakDay"]});
        for (const snap of snaps) {
          if (snap.get("streakDay") === true) stored.add(snap.id);
        }
      }
      for (const day of chunk) {
        if (!assumed.has(day) && !stored.has(day)) return run;
        run.push(day);
      }
      from = addDays(from, -size);
    }
  }

  createPlayer(uid: string, player: PlayerSnapshot, deviceId: string): void {
    const now = FieldValue.serverTimestamp();
    this.tx.create(this.player(uid), {
      ...player,
      feedQuizSinceReward: 0,
      devices: {[deviceId]: {lastSeq: 0, lastSyncAt: now}},
      importedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  updatePlayer(
    uid: string,
    player: PlayerSnapshot,
    feedQuizSinceReward: number,
    devices: Record<string, DeviceState>,
    deviceId: string,
    lastSeq: number,
  ): void {
    const now = FieldValue.serverTimestamp();
    this.tx.update(this.player(uid), {
      ...player,
      feedQuizSinceReward,
      devices: {...devices, [deviceId]: {lastSeq, lastSyncAt: now}},
      updatedAt: now,
    });
  }

  setDay(uid: string, day: string, state: DayState): void {
    this.tx.set(this.player(uid).collection("days").doc(day), state, {merge: true});
  }

  addLedger(uid: string, entry: LedgerEntry): void {
    this.tx.create(this.player(uid).collection("ledger").doc(), {
      ...entry,
      at: FieldValue.serverTimestamp(),
    });
  }
}

export class PlayerStore {
  constructor(private readonly db: Firestore) {}

  transaction<T>(fn: (tx: PlayerTx) => Promise<T>): Promise<T> {
    return this.db.runTransaction((tx) => fn(new PlayerTx(this.db, tx)));
  }
}
