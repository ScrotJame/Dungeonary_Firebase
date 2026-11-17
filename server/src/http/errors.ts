export type ErrorCode =
  | "unauthenticated"
  | "invalid-argument"
  | "failed-precondition"
  | "not-found"
  | "resource-exhausted"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  "unauthenticated": 401,
  "invalid-argument": 400,
  "failed-precondition": 409,
  "not-found": 404,
  "resource-exhausted": 429,
  "internal": 500,
};

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly reason?: string,
  ) {
    super(reason ? `${code}: ${reason}` : code);
    this.name = "AppError";
  }
}

export interface HttpError {
  status: number;
  body: {error: {code: ErrorCode; reason?: string}};
}

/** Lỗi 4xx do express.json() ném: JSON hỏng, thân quá lớn, charset/encoding lạ... */
function isBodyParserError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const {type, status, statusCode} = err as {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  if (typeof type !== "string") return false;
  const code = typeof status === "number" ? status : statusCode;
  return typeof code === "number" && code >= 400 && code <= 499;
}

export function toHttp(err: unknown): HttpError {
  if (err instanceof AppError) {
    const error = err.reason ?
      {code: err.code, reason: err.reason} :
      {code: err.code};
    return {status: STATUS[err.code], body: {error}};
  }
  if (isBodyParserError(err)) {
    return {status: 400, body: {error: {code: "invalid-argument"}}};
  }
  return {status: 500, body: {error: {code: "internal"}}};
}
