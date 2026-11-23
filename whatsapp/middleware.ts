import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { HttpError } from "./errors.js";
import { logger } from "./logger.js";

// Express 4 doesn't forward a rejected promise from an async handler to error
// middleware on its own — this wrapper catches it and calls next(err) for us.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Services inside LifeCircle (Madhavi, MCP tools) send INTERNAL_API_TOKEN
// in the x-internal-token header.
export function requireInternalToken(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = req.get("x-internal-token");
  if (config.internalToken && token && safeEqual(token, config.internalToken)) {
    next();
    return;
  }

  res.status(401).json({
    success: false,
    code: "unauthorized",
    error: "A valid x-internal-token header is required",
  });
}

// Meta signs each webhook body with the app secret:
// X-Hub-Signature-256: sha256=<hex HMAC of the raw body>.
export function isValidMetaSignature(raw: Buffer, header: string | undefined) {
  if (!config.appSecret || !header?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", config.appSecret).update(raw).digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  // Client closed the connection before the body was received
  if (err?.type === "request.aborted") return;

  if (err instanceof HttpError) {
    res.status(err.status).json({
      success: false,
      code: err.code,
      error: err.message,
      details: err.details,
    });
    return;
  }

  // body-parser errors (invalid JSON, body too large) carry a 4xx status
  if (typeof err?.status === "number" && err.status < 500) {
    res.status(err.status).json({
      success: false,
      code: err.type ?? "bad_request",
      error: err.message,
    });
    return;
  }

  logger.error("[whatsapp] unhandled error", err);
  if (!res.headersSent) {
    res
      .status(500)
      .json({ success: false, code: "internal_error", error: "Internal server error" });
  }
}
