export type ErrorCode =
  | "unauthenticated"
  | "invalid-argument"
  | "failed-precondition"
  | "not-found"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  "unauthenticated": 401,
  "invalid-argument": 400,
  "failed-precondition": 409,
  "not-found": 404,
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

/** Lỗi do express.json() ném khi JSON hỏng hoặc thân quá lớn. */
function isBodyParserError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const type = (err as {type?: unknown}).type;
  return type === "entity.parse.failed" || type === "entity.too.large";
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
