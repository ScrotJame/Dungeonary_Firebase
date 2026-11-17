import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import {addDays} from "../domain/days";
import type {LostStreak, PlayerChanges, PlayerSnapshot, TimeWindow} from "../domain/player";
import {type DayState, EMPTY_DAY} from "../domain/rewards";
import type {StreakRun} from "../domain/streak";

/** Số ngày đọc ở lượt đầu khi dò chuỗi streak; đủ cho khoảng bù ngày cũ (LOOKBACK_DAYS + 1). */
const STREAK_RUN_FIRST_READ = 8;

export interface DeviceState {
  lastSeq: number;
  lastSyncAt: unknown;
}

/** Các trường của players/{uid} mà server đọc. */
export interface StoredPlayer extends PlayerSnapshot {
  feedQuizSinceReward: number;
  devices: Record<string, DeviceState>;
  /** buffs.doubleGems, đổi sang ms. */
  doubleGems: TimeWindow | null;
  lostStreak: LostStreak | null;
}

export type LedgerEntry =
  | {type: "import"; gems: number; xp: number; deviceId: string}
  | {type: "sync"; gems: number; xp: number; deviceId: string; seqFrom: number; seqTo: number}
  | {
    type: "use_item";
    gems: 0;
    xp: 0;
    itemId: "streak_freeze";
    quantity: number;
    days: string[];
    deviceId: string;
  }
  | {type: "purchase"; gems: number; xp: 0; itemId: string; quantity: number; price: number};

/** Ghi một phần document days; `frozen` đánh dấu ngày được Streak Freeze cứu. */
export type DayWrite = Partial<DayState> & {frozen?: boolean};

function toTimeWindow(v: unknown): TimeWindow | null {
  if (typeof v !== "object" || v === null) return null;
  const {from, until} = v as {from?: unknown; until?: unknown};
  if (!(from instanceof Timestamp) || !(until instanceof Timestamp)) return null;
  return {from: from.toMillis(), until: until.toMillis()};
}

function toLostStreak(v: unknown): LostStreak | null {
  if (typeof v !== "object" || v === null) return null;
  const {value, lostOn} = v as {value?: unknown; lostOn?: unknown};
  return typeof value === "number" && typeof lostOn === "string" ? {value, lostOn} : null;
}

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
    private readonly catalogCollection: string,
  ) {}

  private player(uid: string): DocumentReference {
    return this.db.collection("players").doc(uid);
  }

  async getPlayer(uid: string): Promise<StoredPlayer | null> {
    const snap = await this.tx.get(this.player(uid));
    if (!snap.exists) return null;
    const data = snap.data() as DocumentData;
    return {
      ...data,
      doubleGems: toTimeWindow(data.buffs?.doubleGems),
      lostStreak: toLostStreak(data.lostStreak),
    } as StoredPlayer;
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
   * Chuỗi dò lùi từ `end` (spec shop 6.1): ngày streak được đếm, ngày chỉ có
   * frozen được đi qua, dừng ở ngày không phải cả hai. `assumed` là các ngày vừa
   * thành ngày streak trong lô đang xử lý, chưa được ghi. Đọc document theo id,
   * mỗi lượt gấp đôi lượt trước, nên số lượt đọc tỉ lệ với độ dài chuỗi.
   */
  async getStreakRun(uid: string, end: string, assumed: ReadonlySet<string>): Promise<StreakRun> {
    const streakDays: string[] = [];
    const frozenDays: string[] = [];
    let from = end;
    for (let size = STREAK_RUN_FIRST_READ; ; size *= 2) {
      const chunk = Array.from({length: size}, (_, i) => addDays(from, -i));
      const stored = new Set<string>();
      const frozen = new Set<string>();
      const refs = chunk
        .filter((day) => !assumed.has(day))
        .map((day) => this.player(uid).collection("days").doc(day));
      if (refs.length > 0) {
        const snaps = await this.tx.getAll(...refs, {fieldMask: ["streakDay", "frozen"]});
        for (const snap of snaps) {
          if (snap.get("streakDay") === true) stored.add(snap.id);
          else if (snap.get("frozen") === true) frozen.add(snap.id);
        }
      }
      for (const day of chunk) {
        if (assumed.has(day) || stored.has(day)) streakDays.push(day);
        else if (frozen.has(day)) frozenDays.push(day);
        else return {streakDays, frozenDays};
      }
      from = addDays(from, -size);
    }
  }

  /** Số đang giữ trong players/{uid}/inventory/{itemId}; 0 khi chưa có. */
  async getInventory(uid: string, itemId: string): Promise<number> {
    const snap = await this.tx.get(this.player(uid).collection("inventory").doc(itemId));
    const quantity = snap.get("quantity");
    return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0;
  }

  /** Document shop_items/{itemId} (hoặc collection danh mục đã cấu hình), chưa kiểm tra. */
  async getCatalogItem(itemId: string): Promise<Record<string, unknown> | undefined> {
    const snap = await this.tx.get(this.db.collection(this.catalogCollection).doc(itemId));
    return snap.data();
  }

  async getLedger(uid: string, id: string): Promise<Record<string, unknown> | undefined> {
    const snap = await this.tx.get(this.player(uid).collection("ledger").doc(id));
    return snap.data();
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

  /** `lostStreak`: undefined thì không đụng trường, null thì xoá. */
  updatePlayer(
    uid: string,
    player: PlayerSnapshot,
    feedQuizSinceReward: number,
    devices: Record<string, DeviceState>,
    deviceId: string,
    lastSeq: number,
    lostStreak?: LostStreak | null,
  ): void {
    const now = FieldValue.serverTimestamp();
    this.tx.update(this.player(uid), {
      ...player,
      feedQuizSinceReward,
      devices: {...devices, [deviceId]: {lastSeq, lastSyncAt: now}},
      ...(lostStreak === undefined ? {} : {lostStreak: lostStreak ?? FieldValue.delete()}),
      updatedAt: now,
    });
  }

  /** Ghi các thay đổi của purchaseItem và useItem lên players/{uid}. */
  updatePlayerFields(uid: string, changes: PlayerChanges): void {
    const data: Record<string, unknown> = {updatedAt: FieldValue.serverTimestamp()};
    if (changes.gems !== undefined) data.gems = changes.gems;
    if (changes.streak !== undefined) data.streak = changes.streak;
    if (changes.doubleGems !== undefined) {
      data["buffs.doubleGems"] = {
        from: Timestamp.fromMillis(changes.doubleGems.from),
        until: Timestamp.fromMillis(changes.doubleGems.until),
      };
    }
    if (changes.lostStreak !== undefined) {
      data.lostStreak = changes.lostStreak ?? FieldValue.delete();
    }
    this.tx.update(this.player(uid), data);
  }

  setDay(uid: string, day: string, data: DayWrite): void {
    this.tx.set(this.player(uid).collection("days").doc(day), data, {merge: true});
  }

  setInventory(uid: string, itemId: string, quantity: number): void {
    this.tx.set(this.player(uid).collection("inventory").doc(itemId), {
      quantity,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  /** `id` là requestId của purchaseItem và useItem; thiếu thì Firestore tự sinh id 20 ký tự. */
  addLedger(uid: string, entry: LedgerEntry, id?: string): void {
    const ledger = this.player(uid).collection("ledger");
    this.tx.create(id === undefined ? ledger.doc() : ledger.doc(id), {
      ...entry,
      at: FieldValue.serverTimestamp(),
    });
  }
}

export interface StoreOptions {
  /** Collection danh mục; test dùng tên riêng để không giẫm lên nhau. */
  catalogCollection?: string;
}

export class PlayerStore {
  private readonly catalogCollection: string;

  constructor(
    private readonly db: Firestore,
    options: StoreOptions = {},
  ) {
    this.catalogCollection = options.catalogCollection ?? "shop_items";
  }

  transaction<T>(fn: (tx: PlayerTx) => Promise<T>): Promise<T> {
    return this.db.runTransaction((tx) => fn(new PlayerTx(this.db, tx, this.catalogCollection)));
  }
}
