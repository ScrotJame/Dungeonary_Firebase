import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {doc, getDoc, setDoc} from "firebase/firestore";
import {afterAll, beforeAll, describe, it} from "vitest";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT ?? "demo-dungeonary",
    firestore: {
      // Test chạy với thư mục làm việc là server/.
      rules: readFileSync(resolve(process.cwd(), "../firestore.rules"), "utf8"),
    },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    await setDoc(doc(admin, "players/alice"), {gems: 10});
    await setDoc(doc(admin, "players/alice/days/2026-11-17"), {gemsEarned: 1});
    await setDoc(doc(admin, "players/alice/ledger/entry-1"), {type: "import"});
    await setDoc(doc(admin, "shop_items/rules_test_item"), {price: 100});
    await setDoc(doc(admin, "players/alice/inventory/streak_freeze"), {quantity: 1});
    await setDoc(doc(admin, "achievement_definitions/first_word"), {metric: "totalLearned"});
    await setDoc(doc(admin, "companion_definitions/pet_golden_cat"), {unlockUserLevel: 1});
  });
});

afterAll(async () => {
  await env.cleanup();
});

const alice = () => env.authenticatedContext("alice").firestore();
const bob = () => env.authenticatedContext("bob").firestore();
const guest = () => env.unauthenticatedContext().firestore();

describe("players/{uid}", () => {
  it("chủ tài khoản đọc được document và collection con của mình", async () => {
    await assertSucceeds(getDoc(doc(alice(), "players/alice")));
    await assertSucceeds(getDoc(doc(alice(), "players/alice/days/2026-11-17")));
    await assertSucceeds(getDoc(doc(alice(), "players/alice/ledger/entry-1")));
  });

  it("chủ tài khoản không ghi được", async () => {
    await assertFails(setDoc(doc(alice(), "players/alice"), {gems: 999999}));
    await assertFails(setDoc(doc(alice(), "players/alice"), {gems: 11}, {merge: true}));
    await assertFails(setDoc(doc(alice(), "players/alice/days/2026-11-17"), {gemsEarned: 0}));
    await assertFails(setDoc(doc(alice(), "players/alice/inventory/streak_freeze"), {quantity: 9}));
  });

  it("người khác và khách không đọc được", async () => {
    await assertFails(getDoc(doc(bob(), "players/alice")));
    await assertFails(getDoc(doc(bob(), "players/alice/days/2026-11-17")));
    await assertFails(getDoc(doc(guest(), "players/alice")));
  });

  it("túi đồ: chủ tài khoản đọc được, không ghi được; người khác không đọc được", async () => {
    await assertSucceeds(getDoc(doc(alice(), "players/alice/inventory/streak_freeze")));
    await assertFails(setDoc(doc(alice(), "players/alice/inventory/streak_freeze"), {quantity: 2}));
    await assertFails(getDoc(doc(bob(), "players/alice/inventory/streak_freeze")));
  });

  it("không ai tự tạo được player cho mình", async () => {
    await assertFails(setDoc(doc(bob(), "players/bob"), {gems: 2000}));
  });
});

describe("danh mục", () => {
  it.each([
    "shop_items/rules_test_item",
    "achievement_definitions/first_word",
    "companion_definitions/pet_golden_cat",
  ])("%s: người đã đăng nhập đọc được, không ghi được; khách không đọc được", async (path) => {
    await assertSucceeds(getDoc(doc(alice(), path)));
    await assertFails(setDoc(doc(alice(), path), {price: 0}));
    await assertFails(getDoc(doc(guest(), path)));
  });
});

describe("collection có sẵn", () => {
  it("users_profile vẫn chỉ chủ tài khoản đọc và ghi được", async () => {
    await assertSucceeds(setDoc(doc(alice(), "users_profile/alice"), {name: "Alice"}));
    await assertSucceeds(getDoc(doc(alice(), "users_profile/alice")));
    await assertFails(getDoc(doc(bob(), "users_profile/alice")));
  });

  it("collection không khai báo vẫn bị chặn", async () => {
    await assertFails(getDoc(doc(alice(), "anything/else")));
  });
});
