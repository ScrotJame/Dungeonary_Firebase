import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";
import {requireAuth, type VerifyToken} from "./http/auth";
import {AppError, toHttp} from "./http/errors";

export type Handler = (uid: string, input: unknown) => Promise<unknown>;

export interface AppDeps {
  verifyToken: VerifyToken;
  /** Mỗi khoá `name` thành route `POST /v1/<name>`. */
  handlers: Record<string, Handler>;
}

const requireJson: RequestHandler = (req, _res, next) => {
  if (req.method === "POST" && !req.is("application/json")) {
    throw new AppError("invalid-argument");
  }
  next();
};

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const {status, body} = toHttp(err);
  if (status === 500) console.error(err);
  res.status(status).json(body);
};

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/healthz", (_req, res) => {
    res.json({ok: true});
  });

  const api = express.Router();
  api.use(requireAuth(deps.verifyToken));
  api.use(requireJson);
  api.use(express.json({limit: "256kb"}));
  for (const [name, handler] of Object.entries(deps.handlers)) {
    api.post(`/${name}`, async (req, res) => {
      res.json(await handler(res.locals.uid as string, req.body));
    });
  }
  app.use("/v1", api);

  app.use((_req, _res, next) => {
    next(new AppError("not-found"));
  });
  app.use(errorHandler);
  return app;
}
