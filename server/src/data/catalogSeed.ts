import type {Firestore} from "firebase-admin/firestore";
import {CATALOG, ITEM_IDS, type ItemId} from "../config/shop";

export interface CatalogDiff {
  itemId: ItemId;
  changes: string[];
}

const show = (v: unknown): string => (v === undefined ? "(không có)" : JSON.stringify(v));

/** Khác biệt giữa Firestore và CATALOG; chỉ trả mục có khác biệt. */
export function diffCatalog(
  current: ReadonlyMap<string, Record<string, unknown> | undefined>,
): CatalogDiff[] {
  const diffs: CatalogDiff[] = [];
  for (const itemId of ITEM_IDS) {
    const have = current.get(itemId);
    if (have === undefined) {
      diffs.push({itemId, changes: ["(tạo mới)"]});
      continue;
    }
    const want = CATALOG[itemId] as unknown as Record<string, unknown>;
    const changes: string[] = [];
    for (const key of [...new Set([...Object.keys(have), ...Object.keys(want)])].sort()) {
      if (have[key] !== want[key]) changes.push(`${key}: ${show(have[key])} -> ${show(want[key])}`);
    }
    if (changes.length > 0) diffs.push({itemId, changes});
  }
  return diffs;
}

export interface SeedOptions {
  /** false thì chỉ in khác biệt. */
  apply: boolean;
  collection?: string;
  log?: (line: string) => void;
}

/**
 * Spec shop 9: đưa CATALOG lên Firestore. Ghi đè nguyên các document có khác
 * biệt, không xoá document nào khác trong collection.
 */
export async function seedCatalog(
  db: Firestore,
  {apply, collection = "shop_items", log = console.log}: SeedOptions,
): Promise<CatalogDiff[]> {
  const snaps = await db.getAll(...ITEM_IDS.map((id) => db.collection(collection).doc(id)));
  const diffs = diffCatalog(new Map(snaps.map((snap) => [snap.id, snap.data()])));

  if (diffs.length === 0) {
    log("Firestore đã khớp file, không có gì để ghi.");
    return diffs;
  }
  for (const {itemId, changes} of diffs) {
    for (const change of changes) log(`${collection}/${itemId}: ${change}`);
  }
  if (!apply) {
    log("Chưa ghi gì. Chạy lại với --apply để ghi.");
    return diffs;
  }
  const batch = db.batch();
  for (const {itemId} of diffs) batch.set(db.collection(collection).doc(itemId), CATALOG[itemId]);
  await batch.commit();
  log(`Đã ghi ${diffs.length} document.`);
  return diffs;
}
