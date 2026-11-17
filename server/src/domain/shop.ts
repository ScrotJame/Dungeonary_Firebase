import {
  type CatalogItem,
  isItemId,
  MAX_OWNED_MAX,
  MAX_PURCHASE_QUANTITY,
  PRICE_MAX,
} from "../config/shop";
import {AppError} from "../http/errors";
import {isInt, isIntBetween, isRecord} from "./events";

export interface PurchaseInput {
  itemId: string;
  quantity: number;
  /** Giá một đơn vị mà app đang hiển thị. */
  expectedPrice: number;
  requestId: string;
}

export interface UseInput {
  itemId: string;
  requestId: string;
}

/** UUID dạng chuẩn 36 ký tự. Id tự sinh của Firestore dài 20 nên không trùng. */
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** itemId dùng làm id document: cấm "/", chuỗi rỗng và dạng __x__. */
const ITEM_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;

function parseItemId(v: unknown): string {
  if (typeof v !== "string" || !ITEM_ID_RE.test(v)) throw new AppError("invalid-argument");
  return v;
}

function parseRequestId(v: unknown): string {
  if (typeof v !== "string" || !REQUEST_ID_RE.test(v)) throw new AppError("invalid-argument");
  return v;
}

export function parsePurchaseInput(body: unknown): PurchaseInput {
  if (!isRecord(body)) throw new AppError("invalid-argument");
  const {quantity, expectedPrice} = body;
  if (!isIntBetween(quantity, 1, MAX_PURCHASE_QUANTITY)) throw new AppError("invalid-argument");
  if (!isIntBetween(expectedPrice, 0, PRICE_MAX)) throw new AppError("invalid-argument");
  return {
    itemId: parseItemId(body.itemId),
    quantity,
    expectedPrice,
    requestId: parseRequestId(body.requestId),
  };
}

export function parseUseInput(body: unknown): UseInput {
  if (!isRecord(body)) throw new AppError("invalid-argument");
  return {itemId: parseItemId(body.itemId), requestId: parseRequestId(body.requestId)};
}

/**
 * Đọc document shop_items/{itemId}. Trả null khi thiếu trường, sai kiểu, hoặc
 * code không biết tác dụng của itemId: khi đó vật phẩm coi như không bán.
 */
export function parseCatalogItem(itemId: string, data: Record<string, unknown>): CatalogItem | null {
  if (!isItemId(itemId)) return null;
  const {price, maxOwned, active, sortOrder, titleKey, descriptionKey, iconKey} = data;
  if (!isIntBetween(price, 0, PRICE_MAX)) return null;
  if (!isIntBetween(maxOwned, 1, MAX_OWNED_MAX)) return null;
  if (typeof active !== "boolean") return null;
  if (!isInt(sortOrder)) return null;
  if (typeof titleKey !== "string" || typeof descriptionKey !== "string") return null;
  if (typeof iconKey !== "string") return null;
  return {price, maxOwned, active, sortOrder, titleKey, descriptionKey, iconKey};
}

export interface PurchaseState {
  /** Số dư trên server. */
  gems: number;
  /** null khi không có document, document hỏng, hoặc code không biết itemId. */
  item: CatalogItem | null;
  /** Số đang giữ. */
  owned: number;
  /** Document ledger/{requestId}, nếu đã có. */
  ledger: Record<string, unknown> | undefined;
}

export type PurchaseDecision =
  | {kind: "replay"}
  | {kind: "buy"; price: number; cost: number; ownedAfter: number};

/** Bảng 5.1 của spec shop, kiểm tra đúng thứ tự. */
export function decidePurchase(input: PurchaseInput, s: PurchaseState): PurchaseDecision {
  if (s.ledger !== undefined) {
    const same = s.ledger.type === "purchase" &&
      s.ledger.itemId === input.itemId &&
      s.ledger.quantity === input.quantity;
    if (same) return {kind: "replay"};
    throw new AppError("invalid-argument");
  }
  if (s.item === null || !s.item.active) {
    throw new AppError("failed-precondition", "item-unavailable");
  }
  if (input.expectedPrice !== s.item.price) {
    throw new AppError("failed-precondition", "price-changed");
  }
  if (s.owned + input.quantity > s.item.maxOwned) {
    throw new AppError("failed-precondition", "max-owned");
  }
  const cost = s.item.price * input.quantity;
  if (s.gems < cost) throw new AppError("failed-precondition", "insufficient-gems");
  return {kind: "buy", price: s.item.price, cost, ownedAfter: s.owned + input.quantity};
}
