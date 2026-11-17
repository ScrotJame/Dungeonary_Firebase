import {describe, expect, it} from "vitest";
import {CATALOG} from "../../src/config/shop";
import {diffCatalog} from "../../src/data/catalogSeed";

const all = (over: Record<string, Record<string, unknown> | undefined> = {}) =>
  new Map<string, Record<string, unknown> | undefined>([
    ["streak_freeze", {...CATALOG.streak_freeze}],
    ["double_gems", {...CATALOG.double_gems}],
    ["save_streak", {...CATALOG.save_streak}],
    ...Object.entries(over),
  ]);

describe("diffCatalog", () => {
  it("Firestore khớp file: không có khác biệt", () => {
    expect(diffCatalog(all())).toEqual([]);
  });

  it("thiếu document: tạo mới", () => {
    expect(diffCatalog(all({save_streak: undefined}))).toEqual([
      {itemId: "save_streak", changes: ["(tạo mới)"]},
    ]);
  });

  it("khác giá và có trường thừa: liệt kê từng trường", () => {
    const diffs = diffCatalog(all({
      streak_freeze: {...CATALOG.streak_freeze, price: 120, kind: "streak_freeze"},
    }));
    expect(diffs).toEqual([{
      itemId: "streak_freeze",
      changes: ['kind: "streak_freeze" -> (không có)', "price: 120 -> 100"],
    }]);
  });
});
