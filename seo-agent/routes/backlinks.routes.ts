import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Server as SocketIOServer } from "socket.io";

import {
  createBacklink,
  listBacklinks,
  getBacklinkById,
  updateBacklink,
  deleteBacklink,
  upsertBacklinks,
} from "../controllers/backlinks.controller.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { logger } from "../utils/logger.js";

export function backlinksRouter(io: SocketIOServer): Router {
  const router = Router();

  // POST /backlinks
  router.post("/", requireAuth, async (req: Request, res: Response) => {
    try {
      const {
        site_id,
        url_from,
        url_to,
        owner_type,
        domain_from_rank,
        anchor_details,
        is_new,
        is_lost,
        is_broken,
        first_seen,
        last_seen,
        spam_score,
      } = req.body;

      if (!site_id || !url_from || !url_to) {
        return res.status(400).json({
          success: false,
          error: "site_id, url_from and url_to are required",
        });
      }

      const record = await createBacklink({
        id: randomUUID(),
        site_id: Number(site_id),
        url_from: String(url_from),
        url_to: String(url_to),
        owner_type: owner_type ?? null,
        domain_from_rank: domain_from_rank ?? null,
        anchor_details: anchor_details ?? null,
        is_new: is_new ?? false,
        is_lost: is_lost ?? false,
        is_broken: is_broken ?? false,
        first_seen: first_seen ?? null,
        last_seen: last_seen ?? null,
        spam_score: spam_score ?? null,
      });

      io.emit("backlink:created", record);
      res.status(201).json({ success: true, record });
    } catch (err) {
      logger.error("[backlinks] create error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // POST /backlinks/bulk
  router.post("/bulk", requireAuth, async (req: Request, res: Response) => {
    try {
      const { records } = req.body as { records?: unknown[] };

      if (!Array.isArray(records) || records.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: "records array is required" });
      }

      const affected = await upsertBacklinks(
        records.map((r: any) => ({
          id: r.id ?? randomUUID(),
          site_id: Number(r.site_id),
          url_from: String(r.url_from),
          url_to: String(r.url_to),
          owner_type: r.owner_type ?? null,
          domain_from_rank: r.domain_from_rank ?? null,
          anchor_details: r.anchor_details ?? null,
          is_new: r.is_new ?? false,
          is_lost: r.is_lost ?? false,
          is_broken: r.is_broken ?? false,
          first_seen: r.first_seen ?? null,
          last_seen: r.last_seen ?? null,
          spam_score: r.spam_score ?? null,
        })),
      );

      res.status(200).json({ success: true, affected });
    } catch (err) {
      logger.error("[backlinks] bulk upsert error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // GET /backlinks
  router.get("/", requireAuth, async (req: Request, res: Response) => {
    try {
      const { site_id, is_new, is_lost, is_broken, owner_type, limit, offset } =
        req.query as Record<string, string>;

      const result = await listBacklinks({
        site_id: site_id ? Number(site_id) : undefined,
        is_new: is_new !== undefined ? is_new === "true" : undefined,
        is_lost: is_lost !== undefined ? is_lost === "true" : undefined,
        is_broken: is_broken !== undefined ? is_broken === "true" : undefined,
        owner_type: owner_type ?? undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      logger.error("[backlinks] list error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // GET /backlinks/:id
  router.get("/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const record = await getBacklinkById(req.params.id);
      if (!record) {
        return res
          .status(404)
          .json({ success: false, error: "Backlink not found" });
      }
      res.json({ success: true, record });
    } catch (err) {
      logger.error("[backlinks] get error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // PATCH /backlinks/:id
  router.patch("/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const record = await updateBacklink(req.params.id, req.body);
      if (!record) {
        return res
          .status(404)
          .json({ success: false, error: "Backlink not found" });
      }
      io.emit("backlink:updated", record);
      res.json({ success: true, record });
    } catch (err) {
      logger.error("[backlinks] update error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // DELETE /backlinks/:id
  router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const deleted = await deleteBacklink(req.params.id);
      if (!deleted) {
        return res
          .status(404)
          .json({ success: false, error: "Backlink not found" });
      }
      io.emit("backlink:deleted", { id: req.params.id });
      res.json({ success: true, deleted: req.params.id });
    } catch (err) {
      logger.error("[backlinks] delete error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  return router;
}
