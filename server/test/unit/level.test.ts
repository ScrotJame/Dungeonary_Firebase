import {describe, expect, it} from "vitest";
import {levelForXp, xpRequired} from "../../src/domain/level";

describe("xpRequired", () => {
  it("khớp công thức của app", () => {
    expect(xpRequired(1)).toBe(30);
    expect(xpRequired(2)).toBe(75);
    expect(xpRequired(3)).toBe(120);
    expect(xpRequired(10)).toBe(435);
  });
});

describe("levelForXp", () => {
  it.each([
    [0, 1],
    [29, 1],
    [30, 2],
    [104, 2],
    [105, 3],
    [224, 3],
    [225, 4],
  ])("xp %i là level %i", (xp, level) => {
    expect(levelForXp(xp)).toBe(level);
  });

  it("chạy được với trần nhập 1 000 000 XP", () => {
    expect(levelForXp(1_000_000)).toBe(211);
  });
});
