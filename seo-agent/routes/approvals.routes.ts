/**
 * Approvals router — /approvals endpoints.
 * Requires `io` (Socket.io server) injected via factory function.
 */

import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Server as SocketIOServer } from "socket.io";

import {
  createApproval,
  listApprovals,
  getApprovalById,
  approveApproval,
  rejectApproval,
  deferApproval,
} from "../controllers/approvals.controller.js";
import { AuthRequest, requireAuth } from "../../middleware/auth.middleware.js";
import { logger } from "../utils/logger.js";

interface CreateApprovalBody {
  site_id?: number;
  module?: string;
  type?: string;
  priority?: number;
  title?: string;
  original_content?: Record<string, unknown>;
  suggested_content?: Record<string, unknown>;
  preview_url?: string;
}

export function approvalsRouter(io: SocketIOServer): Router {
  const router = Router();

  // POST /approvals
  router.post("/", async (req: Request, res: Response) => {
    const {
      site_id,
      module,
      type,
      priority = 3,
      title,
      original_content,
      suggested_content,
      preview_url,
    } = req.body as CreateApprovalBody;

    if (!site_id || !module || !type || !title || !suggested_content) {
      res.status(400).json({
        success: false,
        error: "Missing required fields: site_id, module, type, title, content",
      });
      return;
    }

    try {
      const approval = await createApproval({
        id: randomUUID(),
        site_id: Number(site_id),
        module: String(module),
        type: String(type),
        priority: Number(priority),
        title: String(title),
        original_content: original_content as Record<string, unknown>,
        updated_content: suggested_content as Record<string, unknown>,
        preview_url: preview_url ? String(preview_url) : null,
      });
      io.emit("approval:created", approval);
      res.status(201).json({ success: true, ...approval });
    } catch (err) {
      logger.error("[approvals] create error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // GET /approvals
  router.get("/", requireAuth, async (req: Request, res: Response) => {
    const { status, sort, site_id, limit, offset } = req.query as Record<
      string,
      string
    >;
    try {
      const result = await listApprovals({
        status,
        site_id: site_id ? Number(site_id) : undefined,
        sort,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      logger.error("[approvals] list error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // GET /approvals/:id
  router.get("/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const approval = await getApprovalById(req.params.id);
      if (!approval) {
        res.status(404).json({ success: false, error: "Approval not found" });
        return;
      }
      res.json({ success: true, ...approval });
    } catch (err) {
      logger.error("[approvals] get error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // POST /approvals/:id/approve
  router.post(
    "/:id/approve",
    requireAuth,
    async (req: Request, res: Response) => {
      const { content } = req.body as { content?: Record<string, unknown> };
      const { userId } = (req as AuthRequest).user!;
      try {
        const approval = await approveApproval(
          req.params.id,
          String(userId) ?? "operator",
          content,
        );
        if (!approval) {
          res.status(404).json({ success: false, error: "Approval not found" });
          return;
        }
        io.emit("approval:updated", approval);
        res.json({ success: true, ...approval });
      } catch (err) {
        logger.error("[approvals] approve error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  // POST /approvals/:id/reject
  router.post(
    "/:id/reject",
    requireAuth,
    async (req: Request, res: Response) => {
      const { reason, remark } = req.body as { reason?: string, remark?: string };
      const { userId } = (req as AuthRequest).user!;
      if (!reason) {
        res
          .status(400)
          .json({ success: false, error: "Reject reason is required" });
        return;
      }
      try {
        const approval = await rejectApproval(
          req.params.id,
          String(userId) ?? "operator",
          reason,
          remark,
        );
        if (!approval) {
          res.status(404).json({ success: false, error: "Approval not found" });
          return;
        }
        io.emit("approval:updated", approval);
        res.json({ success: true, ...approval });
      } catch (err) {
        logger.error("[approvals] reject error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  // POST /approvals/:id/defer
  router.post(
    "/:id/defer",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { userId } = (req as AuthRequest).user!;
        const approval = await deferApproval(
          req.params.id,
          String(userId) ?? "operator",
        );
        if (!approval) {
          res.status(404).json({ success: false, error: "Approval not found" });
          return;
        }
        io.emit("approval:updated", approval);
        res.json({ success: true, ...approval });
      } catch (err) {
        logger.error("[approvals] defer error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  return router;
}
