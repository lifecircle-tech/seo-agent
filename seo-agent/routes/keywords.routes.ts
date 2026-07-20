import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Server as SocketIOServer } from "socket.io";

import {
  createKeyword,
  listKeywords,
  getKeywordById,
  updateKeyword,
  deleteKeyword,
  upsertKeywords,
} from "../controllers/keywords.controller.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { logger } from "../utils/logger.js";

export function keywordsRouter(io: SocketIOServer): Router {
  const router = Router();

  // POST /keywords
  router.post("/", requireAuth, async (req: Request, res: Response) => {
    try {
      const {
        site_id,
        keyword,
        is_new,
        clicks,
        impressions,
        search_volume,
        difficulty,
        position,
        cpc,
        ctr,
        competition,
        competition_level,
        monthly_searches,
        pages_used
      } = req.body;

      if (!site_id || !keyword) {
        return res
          .status(400)
          .json({ success: false, error: "site_id and keyword are required" });
      }

      const record = await createKeyword({
        id: randomUUID(),
        site_id: Number(site_id),
        keyword: String(keyword),
        is_new: is_new ?? false,
        clicks: clicks ?? null,
        impressions: impressions ?? null,
        search_volume: search_volume ?? null,
        difficulty: difficulty ?? null,
        position: position ?? null,
        cpc: cpc ?? null,
        ctr: ctr ?? null,
        competition: competition ?? null,
        competition_level: competition_level ?? null,
        monthly_searches: monthly_searches ?? null,
        pages_used: pages_used ?? null
      });

      io.emit("keyword:created", record);
      res.status(201).json({ success: true, record });
    } catch (err) {
      logger.error("[keywords] create error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // POST /keywords/bulk
  router.post("/bulk", requireAuth, async (req: Request, res: Response) => {
    try {
      const { records } = req.body as { records?: unknown[] };

      if (!Array.isArray(records) || records.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: "records array is required" });
      }

      const affected = await upsertKeywords(
        records.map((r: any) => ({
          id: r.id ?? randomUUID(),
          site_id: Number(r.site_id),
          keyword: String(r.keyword),
          is_new: r.is_new ?? false,
          clicks: r.clicks ?? null,
          impressions: r.impressions ?? null,
          search_volume: r.search_volume ?? null,
          difficulty: r.difficulty ?? null,
          position: r.position ?? null,
          cpc: r.cpc ?? null,
          ctr: r.ctr ?? null,
          competition: r.competition ?? null,
          competition_level: r.competition_level ?? null,
          monthly_searches: r.monthly_searches ?? null,
          pages_used: r.pages_used ?? null
        })),
      );

      res.status(200).json({ success: true, affected });
    } catch (err) {
      logger.error("[keywords] bulk upsert error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // GET /keywords
  router.get("/", requireAuth, async (req: Request, res: Response) => {
    try {
      const { site_id, is_new, keyword, limit, offset } = req.query as Record<
        string,
        string
      >;

      const result = await listKeywords({
        site_id: site_id ? Number(site_id) : undefined,
        is_new: is_new !== undefined ? is_new === "true" : undefined,
        keyword: keyword ?? undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      logger.error("[keywords] list error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // GET /keywords/:id
  router.get("/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const record = await getKeywordById(req.params.id);
      if (!record) {
        return res
          .status(404)
          .json({ success: false, error: "Keyword not found" });
      }
      res.json({ success: true, record });
    } catch (err) {
      logger.error("[keywords] get error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // PATCH /keywords/:id
  router.patch("/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const record = await updateKeyword(req.params.id, req.body);
      if (!record) {
        return res
          .status(404)
          .json({ success: false, error: "Keyword not found" });
      }
      io.emit("keyword:updated", record);
      res.json({ success: true, record });
    } catch (err) {
      logger.error("[keywords] update error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  // DELETE /keywords/:id
  router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const deleted = await deleteKeyword(req.params.id);
      if (!deleted) {
        return res
          .status(404)
          .json({ success: false, error: "Keyword not found" });
      }
      io.emit("keyword:deleted", { id: req.params.id });
      res.json({ success: true, deleted: req.params.id });
    } catch (err) {
      logger.error("[keywords] delete error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  });

  return router;
}
