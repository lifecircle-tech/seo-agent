import "dotenv/config";
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { timingSafeEqual } from "node:crypto";

export interface AuthRequest extends Request {
  user?: { userId: number; companyId: number };
  /** true when the caller authenticated with INTERNAL_API_TOKEN (server-to-server) */
  internal?: boolean;
}

// No fallback: a guessable default would let anyone mint valid tokens.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("[auth] JWT_SECRET is not set — refusing to start");
}

/**
 * Header this service's own MCP servers send when calling its HTTP API
 * (cms-connector, gbp-manager, reputation-manager). Disabled unless
 * INTERNAL_API_TOKEN is set.
 */
const INTERNAL_TOKEN_HEADER = "x-internal-token";

function isValidInternalToken(value: string | string[] | undefined): boolean {
  const expected = process.env.INTERNAL_API_TOKEN;
  if (!expected || typeof value !== "string") return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  // Server-to-server calls from this process (e.g. cms-connector queuing approvals)
  if (isValidInternalToken(req.headers[INTERNAL_TOKEN_HEADER])) {
    req.internal = true;
    next();
    return;
  }

  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      logout: true,
      error: "Authentication required. Please log in.",
    });
    return;
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, JWT_SECRET as string) as {
      user_id: number;
      company_id: number;
    };
    req.user = { userId: payload.user_id, companyId: payload.company_id };
    next();
  } catch (err) {
    const isExpired = err instanceof jwt.TokenExpiredError;
    res.status(401).json({
      success: false,
      logout: true,
      error: isExpired
        ? "Session expired. Please log in again."
        : "Invalid token. Please log in.",
    });
  }
}
