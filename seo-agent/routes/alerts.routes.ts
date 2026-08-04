/**
 * Alerts router — /alerts endpoints.
 * Requires `io` (Socket.io server) injected via factory function.
 */

import { Router, Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { Server as SocketIOServer } from "socket.io";

import {
  createAlert,
  listAlerts,
  acknowledgeAlert,
  resolveAlert,
  closeAlert,
} from "../controllers/alerts.controller.js";

import type { Alert } from "../models/alert.model.js";
import { AuthRequest, requireAuth } from "../../middleware/auth.middleware.js";
import { logger } from "../utils/logger.js";

import { checkIndexingRequestUpdate } from "../services/dashboard.service.js";

// Rate limiter: max 5 requests per IP per 5 hours for /check-indexing
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 60 * 1000;
const RATE_LIMIT_MAX = 1;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkIndexingRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / (1000 * 60)); // Convert ms to min
    res.setHeader("Retry-After", retryAfterSec);
    return res.status(429).json({
      success: false,
      error: `Try again in ${retryAfterSec}m.`,
    });
  }

  entry.count++;
  next();
}

// Request body shape for POST /alerts (all strings from JSON body)
interface CreateAlertBody {
  site_id?: number;
  module?: string;
  severity?: Alert["severity"];
  title?: string;
  detail?: string;
}

export function alertsRouter(io: SocketIOServer): Router {
  const router = Router();

  // POST /alerts
  router.post("/", requireAuth, async (req: Request, res: Response) => {
    const { site_id, module, severity, title, detail } =
      req.body as CreateAlertBody;

    if (!site_id || !module || !severity || !title || !detail) {
      res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
      return;
    }

    try {
      const alert = await createAlert({
        id: randomUUID(),
        site_id: Number(site_id),
        module: String(module),
        severity,
        title: String(title),
        detail: String(detail),
      });
      io.emit("alert:created", alert);
      res.status(201).json({ success: true, ...alert });
    } catch (err) {
      logger.error("[alerts] create error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // GET /alerts
  router.get("/", requireAuth, async (req: Request, res: Response) => {
    const { status, severity, module, site_id, limit, offset } =
      req.query as Record<string, string>;
    try {
      const result = await listAlerts({
        status,
        severity,
        module,
        site_id: site_id ? Number(site_id) : undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      logger.error("[alerts] list error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // POST /alerts/:id/acknowledge
  router.post(
    "/:id/acknowledge",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { userId } = (req as AuthRequest).user!;
        const alert = await acknowledgeAlert(
          req.params.id,
          String(userId) ?? "operator",
        );
        if (!alert) {
          res.status(404).json({ success: false, error: "Alert not found" });
          return;
        }
        io.emit("alert:updated", alert);
        res.json({ success: true, ...alert });
      } catch (err) {
        logger.error("[alerts] acknowledge error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  // POST /alerts/:id/resolve
  router.post(
    "/:id/resolve",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { userId } = (req as AuthRequest).user!;
        const alert = await resolveAlert(
          req.params.id,
          String(userId) ?? "operator",
        );
        if (!alert) {
          res.status(404).json({ success: false, error: "Alert not found" });
          return;
        }
        io.emit("alert:updated", alert);
        res.json({ success: true, ...alert });
      } catch (err) {
        logger.error("[alerts] resolve error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  // POST /alerts/:id/close
  router.post(
    "/:id/close",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { userId } = (req as AuthRequest).user!;
        const alert = await closeAlert(
          req.params.id,
          String(userId) ?? "operator",
        );
        if (!alert) {
          res.status(404).json({ success: false, error: "Alert not found" });
          return;
        }
        io.emit("alert:updated", alert);
        res.json({ success: true, ...alert });
      } catch (err) {
        logger.error("[alerts] close error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  router.get(
    "/check-indexing",
    checkIndexingRateLimiter,
    requireAuth,
    async (req: Request, res: Response) => {
      const user = (req as AuthRequest).user!;
      logger.info("[dashboard] Checking indexing status. Requested by ", user);

      try {
        const results = await checkIndexingRequestUpdate();
        res.json({
          success: true,
          report: `${results.count} URL(s) are indexed`,
        });
      } catch (err) {
        logger.error("[dashboard] check-indexing error:", err);
        res
          .status(500)
          .json({ success: false, error: "Error checking indexing status" });
      }
    },
  );

  return router;
}
