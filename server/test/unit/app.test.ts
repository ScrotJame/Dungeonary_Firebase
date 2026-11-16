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
