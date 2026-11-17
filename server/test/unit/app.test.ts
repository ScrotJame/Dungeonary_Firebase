import request from "supertest";
import {afterEach, describe, expect, it, vi} from "vitest";
import {createApp} from "../../src/app";
import {AppError} from "../../src/http/errors";

const AUTH = {Authorization: "Bearer good-token"};

function makeApp(handler: (uid: string, input: unknown) => Promise<unknown>) {
  return createApp({
    verifyToken: async (token) => {
      if (token !== "good-token") throw new Error("bad token");
      return {uid: "user-1"};
    },
    handlers: {echo: handler},
  });
}

const echo = async (uid: string, input: unknown) => ({uid, input});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /healthz", () => {
  it("trả 200 mà không cần token", async () => {
    const res = await request(makeApp(echo)).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ok: true});
  });
});

describe("xác thực", () => {
  it("thiếu header Authorization thì 401", async () => {
    const res = await request(makeApp(echo)).post("/v1/echo").send({a: 1});
    expect(res.status).toBe(401);
    expect(res.body).toEqual({error: {code: "unauthenticated"}});
  });

  it("token bị từ chối thì 401", async () => {
    const res = await request(makeApp(echo))
      .post("/v1/echo")
      .set("Authorization", "Bearer wrong")
      .send({a: 1});
    expect(res.status).toBe(401);
    expect(res.body).toEqual({error: {code: "unauthenticated"}});
  });

  it("uid lấy từ token, không lấy từ thân request", async () => {
    const res = await request(makeApp(echo))
      .post("/v1/echo")
      .set(AUTH)
      .send({uid: "attacker", a: 1});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({uid: "user-1", input: {uid: "attacker", a: 1}});
  });
});

describe("xác minh token thất bại không do token", () => {
  it("verifyToken ném AppError internal thì 500, không phải 401", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp({
      verifyToken: async () => {
        throw new AppError("internal");
      },
      handlers: {echo},
    });
    const res = await request(app).post("/v1/echo").set(AUTH).send({});
    expect(res.status).toBe(500);
    expect(res.body).toEqual({error: {code: "internal"}});
    expect(log).toHaveBeenCalled();
  });
});

describe("thân request", () => {
  it("Content-Type không phải JSON thì 400", async () => {
    const res = await request(makeApp(echo))
      .post("/v1/echo")
      .set(AUTH)
      .set("Content-Type", "text/plain")
      .send("hello");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({error: {code: "invalid-argument"}});
  });

  it("JSON hỏng thì 400", async () => {
    const res = await request(makeApp(echo))
      .post("/v1/echo")
      .set(AUTH)
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({error: {code: "invalid-argument"}});
  });

  it("charset không hỗ trợ thì 400, không phải 500", async () => {
    const res = await request(makeApp(echo))
      .post("/v1/echo")
      .set(AUTH)
      .set("Content-Type", "application/json; charset=latin1")
      .send('{"a":1}');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({error: {code: "invalid-argument"}});
  });

  it("thân lớn hơn 256 KB thì 400", async () => {
    const res = await request(makeApp(echo))
      .post("/v1/echo")
      .set(AUTH)
      .send({blob: "x".repeat(300 * 1024)});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({error: {code: "invalid-argument"}});
  });
});

describe("lỗi từ handler", () => {
  it("AppError nghiệp vụ thành 409 kèm reason", async () => {
    const app = makeApp(async () => {
      throw new AppError("failed-precondition", "not-imported");
    });
    const res = await request(app).post("/v1/echo").set(AUTH).send({});
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {code: "failed-precondition", reason: "not-imported"},
    });
  });

  it("lỗi lạ thành 500 và không lộ chi tiết", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = makeApp(async () => {
      throw new Error("database password is hunter2");
    });
    const res = await request(app).post("/v1/echo").set(AUTH).send({});
    expect(res.status).toBe(500);
    expect(res.body).toEqual({error: {code: "internal"}});
    expect(log).toHaveBeenCalled();
  });
});

describe("route lạ", () => {
  it("trả 404 theo dạng lỗi chung", async () => {
    const res = await request(makeApp(echo)).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({error: {code: "not-found"}});
  });
});

describe("trần số lượt gọi", () => {
  /** Token chính là uid, để thử nhiều tài khoản. */
  function limitedApp(
    handler: (uid: string, input: unknown) => Promise<unknown>,
    now: () => number,
  ) {
    return createApp({
      verifyToken: async (token) => ({uid: token}),
      handlers: {echo: handler},
      rateLimit: {limit: 3, windowMs: 60_000, now},
    });
  }
  const call = (app: ReturnType<typeof createApp>, uid: string) =>
    request(app).post("/v1/echo").set("Authorization", `Bearer ${uid}`).send({});

  it("vượt trần thì 429 resource-exhausted và không tới handler", async () => {
    const handler = vi.fn(echo);
    const app = limitedApp(handler, () => 0);
    for (let i = 0; i < 3; i++) expect((await call(app, "user-1")).status).toBe(200);

    const blocked = await call(app, "user-1");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({error: {code: "resource-exhausted"}});
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("mỗi uid có bộ đếm riêng", async () => {
    const app = limitedApp(echo, () => 0);
    for (let i = 0; i < 4; i++) await call(app, "user-1");
    expect((await call(app, "user-2")).status).toBe(200);
  });

  it("hết cửa sổ thì đếm lại từ đầu", async () => {
    let t = 0;
    const app = limitedApp(echo, () => t);
    for (let i = 0; i < 3; i++) await call(app, "user-1");
    expect((await call(app, "user-1")).status).toBe(429);
    t = 60_000;
    expect((await call(app, "user-1")).status).toBe(200);
  });

  it("mặc định cho 60 request mỗi phút, request thứ 61 bị chặn", async () => {
    const handler = vi.fn(echo);
    const app = makeApp(handler);
    for (let i = 0; i < 60; i++) {
      expect((await request(app).post("/v1/echo").set(AUTH).send({})).status).toBe(200);
    }
    const blocked = await request(app).post("/v1/echo").set(AUTH).send({});
    expect(blocked.status).toBe(429);
    expect(handler).toHaveBeenCalledTimes(60);
  });
});
