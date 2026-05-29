/**
 * Alerts router — /alerts endpoints.
 * Requires `io` (Socket.io server) injected via factory function.
 */

import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Server as SocketIOServer } from "socket.io";

import {
  createAlert,
  listAlerts,
  acknowledgeAlert,
  resolveAlert,
} from "../controllers/alerts.controller.js";

import type { Alert } from "../models/alert.model.js";
import { requireAuth } from "../../middleware/auth.middleware.js";

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
      console.error("[alerts] create error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // GET /alerts
  router.get("/", requireAuth, async (req: Request, res: Response) => {
    const { status, severity, site_id } = req.query as Record<string, string>;
    try {
      const result = await listAlerts({
        status,
        severity,
        site_id: site_id ? Number(site_id) : undefined,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      console.error("[alerts] list error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // POST /alerts/:id/acknowledge
  router.post("/:id/acknowledge", requireAuth, async (req: Request, res: Response) => {
    try {
      const alert = await acknowledgeAlert(req.params.id);
      if (!alert) {
        res.status(404).json({ success: false, error: "Alert not found" });
        return;
      }
      io.emit("alert:updated", alert);
      res.json({ success: true, ...alert });
    } catch (err) {
      console.error("[alerts] acknowledge error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // POST /alerts/:id/resolve
  router.post("/:id/resolve", requireAuth, async (req: Request, res: Response) => {
    try {
      const alert = await resolveAlert(req.params.id);
      if (!alert) {
        res.status(404).json({ success: false, error: "Alert not found" });
        return;
      }
      io.emit("alert:updated", alert);
      res.json({ success: true, ...alert });
    } catch (err) {
      console.error("[alerts] resolve error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  return router;
}
