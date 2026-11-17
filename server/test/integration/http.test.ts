import {randomUUID} from "node:crypto";
import request from "supertest";
import {describe, expect, it} from "vitest";
import {CATALOG} from "../../src/config/shop";
import {buildServer} from "../../src/server";
import {db, firebaseApp} from "./emulator";

const app = buildServer(firebaseApp);

async function signUp(): Promise<{uid: string; token: string}> {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        email: `${randomUUID()}@example.com`,
        password: "password-123",
        returnSecureToken: true,
      }),
    });
  const json = (await res.json()) as {localId: string; idToken: string};
  return {uid: json.localId, token: json.idToken};
}

const profile = {
  gems: 0,
  experience: 0,
  totalLearned: 0,
  currentStreak: 0,
  longestStreak: 0,
  lastActiveDay: null,
};

describe("server qua HTTP", () => {
  it("GET /healthz không cần token", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ok: true});
  });

  it("thiếu token hoặc token giả thì 401", async () => {
    const missing = await request(app).post("/v1/syncProgress").send({});
    expect(missing.status).toBe(401);

    const forged = await request(app)
      .post("/v1/syncProgress")
      .set("Authorization", "Bearer not-a-real-token")
      .send({});
    expect(forged.status).toBe(401);
    expect(forged.body).toEqual({error: {code: "unauthenticated"}});
  });

  it("syncProgress trước khi nhập trả 409 not-imported", async () => {
    const {token} = await signUp();
    const res = await request(app)
      .post("/v1/syncProgress")
      .set("Authorization", `Bearer ${token}`)
      .send({deviceId: "dev-1", events: []});
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {code: "failed-precondition", reason: "not-imported"},
    });
  });

  it("dữ liệu vào sai trả 400 invalid-argument", async () => {
    const {token} = await signUp();
    const res = await request(app)
      .post("/v1/importGuestProgress")
      .set("Authorization", `Bearer ${token}`)
      .send({deviceId: "dev-1"});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({error: {code: "invalid-argument"}});
  });

  it("nhập rồi đồng bộ, ghi vào player của đúng uid trong token", async () => {
    const {uid, token} = await signUp();
    const auth = {Authorization: `Bearer ${token}`};

    const imported = await request(app)
      .post("/v1/importGuestProgress")
      .set(auth)
      .send({deviceId: "dev-1", profile});
    expect(imported.status).toBe(200);
    expect(imported.body.imported).toBe(true);

    const now = Date.now();
    const synced = await request(app)
      .post("/v1/syncProgress")
      .set(auth)
      .send({
        deviceId: "dev-1",
        events: [{
          seq: 1,
          type: "flashcard_session",
          at: now,
          day: new Date(now).toISOString().slice(0, 10),
          data: {remembered: 10},
        }],
      });
    expect(synced.status).toBe(200);
    expect(synced.body).toMatchObject({ackSeq: 1, player: {gems: 10, xp: 50, level: 2}});

    const doc = (await db.doc(`players/${uid}`).get()).data();
    expect(doc?.gems).toBe(10);
  });

  it("mua rồi dùng Double Gems qua HTTP", async () => {
    await db.doc("shop_items/double_gems").set(CATALOG.double_gems);
    const {uid, token} = await signUp();
    const auth = {Authorization: `Bearer ${token}`};
    await request(app)
      .post("/v1/importGuestProgress")
      .set(auth)
      .send({deviceId: "dev-1", profile: {...profile, gems: 600}});

    const bought = await request(app)
      .post("/v1/purchaseItem")
      .set(auth)
      .send({itemId: "double_gems", quantity: 1, expectedPrice: 500, requestId: randomUUID()});
    expect(bought.status).toBe(200);
    expect(bought.body).toMatchObject({
      player: {gems: 100},
      item: {itemId: "double_gems", quantity: 1},
    });

    const used = await request(app)
      .post("/v1/useItem")
      .set(auth)
      .send({itemId: "double_gems", requestId: randomUUID()});
    expect(used.status).toBe(200);
    expect(used.body.effect.kind).toBe("double_gems");
    expect(used.body.item).toEqual({itemId: "double_gems", quantity: 0});

    const doc = (await db.doc(`players/${uid}`).get()).data();
    expect(doc?.buffs?.doubleGems).toBeDefined();
  });

  it("useItem khi túi trống trả 409 not-owned; requestId sai dạng trả 400", async () => {
    const {token} = await signUp();
    const auth = {Authorization: `Bearer ${token}`};
    await request(app).post("/v1/importGuestProgress").set(auth).send({deviceId: "dev-1", profile});

    const empty = await request(app)
      .post("/v1/useItem")
      .set(auth)
      .send({itemId: "double_gems", requestId: randomUUID()});
    expect(empty.status).toBe(409);
    expect(empty.body).toEqual({error: {code: "failed-precondition", reason: "not-owned"}});

    const bad = await request(app)
      .post("/v1/purchaseItem")
      .set(auth)
      .send({itemId: "double_gems", quantity: 1, expectedPrice: 500, requestId: "1"});
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({error: {code: "invalid-argument"}});
  });

  it("request thứ 61 trong một phút trả 429 resource-exhausted", async () => {
    const {token} = await signUp();
    const auth = {Authorization: `Bearer ${token}`};
    for (let i = 0; i < 60; i++) {
      const res = await request(app)
        .post("/v1/syncProgress")
        .set(auth)
        .send({deviceId: "dev-1", events: []});
      expect(res.status).toBe(409);
    }
    const blocked = await request(app)
      .post("/v1/syncProgress")
      .set(auth)
      .send({deviceId: "dev-1", events: []});
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({error: {code: "resource-exhausted"}});
  });
});
