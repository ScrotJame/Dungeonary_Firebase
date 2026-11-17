import {randomUUID} from "node:crypto";
import {describe, expect, it} from "vitest";
import {CATALOG, ITEM_IDS} from "../../src/config/shop";
import {seedCatalog} from "../../src/data/catalogSeed";
import {db} from "./emulator";

const quiet = () => {};

describe("seedCatalog", () => {
  it("không --apply thì không ghi gì; có --apply thì khớp file; chạy lần hai không đổi gì", async () => {
    const collection = `shop_items_seed_${randomUUID()}`;
    await db.doc(`${collection}/khac`).set({price: 1});

    const dry = await seedCatalog(db, {apply: false, collection, log: quiet});
    expect(dry.map((d) => d.itemId)).toEqual([...ITEM_IDS]);
    expect((await db.collection(collection).get()).size).toBe(1);

    await seedCatalog(db, {apply: true, collection, log: quiet});
    for (const id of ITEM_IDS) {
      expect((await db.doc(`${collection}/${id}`).get()).data()).toEqual(CATALOG[id]);
    }
    const before = (await db.doc(`${collection}/streak_freeze`).get()).updateTime;

    const again = await seedCatalog(db, {apply: true, collection, log: quiet});
    expect(again).toEqual([]);
    const after = (await db.doc(`${collection}/streak_freeze`).get()).updateTime;
    expect(after?.isEqual(before!)).toBe(true);
    expect((await db.doc(`${collection}/khac`).get()).data()).toEqual({price: 1});
  });

  it("ghi đè nguyên document: trường thừa bị bỏ, giá về như file", async () => {
    const collection = `shop_items_seed_${randomUUID()}`;
    await db.doc(`${collection}/streak_freeze`).set({...CATALOG.streak_freeze, price: 5, kind: "x"});

    const lines: string[] = [];
    await seedCatalog(db, {apply: true, collection, log: (line) => lines.push(line)});

    expect((await db.doc(`${collection}/streak_freeze`).get()).data()).toEqual(CATALOG.streak_freeze);
    expect(lines).toContain(`${collection}/streak_freeze: price: 5 -> 100`);
  });
});
