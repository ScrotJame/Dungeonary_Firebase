/** Ba vật phẩm có tác dụng trong code (spec shop 4.1). */
export const ITEM_IDS = ["streak_freeze", "double_gems", "save_streak"] as const;
export type ItemId = (typeof ITEM_IDS)[number];
export const STREAK_FREEZE: ItemId = "streak_freeze";

/** Vật phẩm dùng chủ động qua useItem. Streak Freeze do server tự dùng. */
export const USABLE_ITEM_IDS = ["double_gems", "save_streak"] as const satisfies readonly ItemId[];
export type UsableItemId = (typeof USABLE_ITEM_IDS)[number];

/** Nội dung document shop_items/{itemId}. */
export interface CatalogItem {
  /** Giá một đơn vị, tính bằng gems. */
  price: number;
  /** Số tối đa một người được giữ cùng lúc. */
  maxOwned: number;
  /** false thì không mua được; vật phẩm đã có vẫn dùng được. */
  active: boolean;
  sortOrder: number;
  /** Khoá l10n; chuỗi hiển thị nằm trong .arb của app. */
  titleKey: string;
  descriptionKey: string;
  /** Tên icon phía app. */
  iconKey: string;
}

/**
 * Danh mục để script seed:catalog đưa lên Firestore. Lúc mua, server đọc giá
 * từ Firestore chứ không đọc từ đây.
 */
export const CATALOG: Readonly<Record<ItemId, CatalogItem>> = {
  streak_freeze: {
    price: 100,
    maxOwned: 2,
    active: true,
    sortOrder: 1,
    titleKey: "shopStreakFreezeTitle",
    descriptionKey: "shopStreakFreezeDescription",
    iconKey: "IC_FREEZE",
  },
  double_gems: {
    price: 500,
    maxOwned: 3,
    active: true,
    sortOrder: 2,
    titleKey: "shopDoubleGemsTitle",
    descriptionKey: "shopDoubleGemsDescription",
    iconKey: "IC_GET_GEMS",
  },
  save_streak: {
    price: 1000,
    maxOwned: 1,
    active: true,
    sortOrder: 3,
    titleKey: "shopSaveStreakTitle",
    descriptionKey: "shopSaveStreakDescription",
    iconKey: "SAVE_STREAK",
  },
};

export const PRICE_MAX = 1_000_000;
export const MAX_OWNED_MAX = 99;
/** quantity của một lượt mua: 1 đến số này. */
export const MAX_PURCHASE_QUANTITY = 10;
/** Mỗi lần dùng Double Gems thêm khoảng này. */
export const DOUBLE_GEMS_DURATION_MS = 30 * 60 * 1000;
/** Save Streak dùng được khi hôm nay trừ lostOn không quá số ngày này. */
export const LOST_STREAK_WINDOW_DAYS = 7;

export function isItemId(v: string): v is ItemId {
  return (ITEM_IDS as readonly string[]).includes(v);
}

export function isUsableItemId(v: string): v is UsableItemId {
  return (USABLE_ITEM_IDS as readonly string[]).includes(v);
}
