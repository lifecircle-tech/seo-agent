import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Server as SocketIOServer } from "socket.io";

import {
  createOpportunity,
  listOpportunities,
  getOpportunityById,
  updateOpportunity,
  completeOpportunity,
  ignoreOpportunity,
  deleteOpportunity,
} from "../controllers/opportunities.controller.js";
import { AuthRequest, requireAuth } from "../../middleware/auth.middleware.js";
import { logger } from "../utils/logger.js";

export function opportunitiesRouter(io: SocketIOServer): Router {
  const router = Router();

  // POST /opportunities
  router.post("/", requireAuth, async (req: Request, res: Response) => {
    try {
      const {
        site_id,
        opportunity_type,
        priority,
        reasoning,
        opportunity_details,
      } = req.body;

      if (!site_id || !opportunity_type) {
        return res.status(400).json({
          success: false,
          error: "site_id and opportunity_type are required",
        });
      }

      const record = await createOpportunity({
        id: randomUUID(),
        site_id: Number(site_id),
        opportunity_type: String(opportunity_type),
        priority: priority ?? null,
        reasoning: reasoning ?? null,
        opportunity_details: opportunity_details ?? null,
      });

      io.emit("opportunity:created", record);
      res.status(201).json({ success: true, record });
    } catch (err) {
      logger.error("[opportunities] create error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // GET /opportunities
  router.get("/", requireAuth, async (req: Request, res: Response) => {
    try {
      const { site_id, status, opportunity_type, priority, limit, offset } =
        req.query as Record<string, string>;

      const result = await listOpportunities({
        site_id: site_id ? Number(site_id) : undefined,
        status: status ?? undefined,
        opportunity_type: opportunity_type ?? undefined,
        priority: priority ?? undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      logger.error("[opportunities] list error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // GET /opportunities/:id
  router.get("/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const record = await getOpportunityById(req.params.id);
      if (!record) {
        return res
          .status(404)
          .json({ success: false, error: "Opportunity not found" });
      }
      res.json({ success: true, record });
    } catch (err) {
      logger.error("[opportunities] get error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // PATCH /opportunities/:id
  router.patch("/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const record = await updateOpportunity(req.params.id, req.body);
      if (!record) {
        return res
          .status(404)
          .json({ success: false, error: "Opportunity not found" });
      }
      io.emit("opportunity:updated", record);
      res.json({ success: true, record });
    } catch (err) {
      logger.error("[opportunities] update error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // POST /opportunities/:id/complete
  router.post(
    "/:id/complete",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { userId } = (req as AuthRequest).user!;
        const record = await completeOpportunity(
          req.params.id,
          String(userId) ?? "operator",
        );
        if (!record) {
          return res
            .status(404)
            .json({ success: false, error: "Opportunity not found" });
        }
        io.emit("opportunity:updated", record);
        res.json({ success: true, record });
      } catch (err) {
        logger.error("[opportunities] complete error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  // POST /opportunities/:id/ignore
  router.post(
    "/:id/ignore",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { userId } = (req as AuthRequest).user!;
        const record = await ignoreOpportunity(req.params.id, String(userId));
        if (!record) {
          return res
            .status(404)
            .json({ success: false, error: "Opportunity not found" });
        }
        io.emit("opportunity:updated", record);
        res.json({ success: true, record });
      } catch (err) {
        logger.error("[opportunities] ignore error:", err);
        res.status(500).json({ success: false, error: "Database error" });
      }
    },
  );

  // DELETE /opportunities/:id
  router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const deleted = await deleteOpportunity(req.params.id);
      if (!deleted) {
        return res
          .status(404)
          .json({ success: false, error: "Opportunity not found" });
      }
      io.emit("opportunity:deleted", { id: req.params.id });
      res.json({ success: true, deleted: req.params.id });
    } catch (err) {
      logger.error("[opportunities] delete error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  return router;
}
