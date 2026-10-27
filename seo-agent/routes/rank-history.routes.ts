/**
 * Rank history router — weekly keyword positions.
 *
 * GET /rank-history/keyword/:keyword_id?weeks=26   weekly positions for one keyword
 * GET /rank-history/trend?site_id=1&weeks=12&scope=city|all
 *   Position bands per week. scope=city (default) limits to keywords naming a city in Config.
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { logger } from "../utils/logger.js";
import { getKeywordHistory, getSiteRankTrend } from "../services/rank-history.service.js";
import { getCitiesBySiteId } from "../controllers/cities.controller.js";

const router = Router();

router.get("/keyword/:keyword_id", requireAuth, async (req: Request, res: Response) => {
  const weeks = Math.min(Math.max(Number(req.query.weeks) || 26, 1), 104);
  try {
    res.json({ success: true, history: await getKeywordHistory(req.params.keyword_id, weeks) });
  } catch (err) {
    logger.error("[rank-history] keyword error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

router.get("/trend", requireAuth, async (req: Request, res: Response) => {
  const siteId = Number(req.query.site_id);
  const weeks = Math.min(Math.max(Number(req.query.weeks) || 12, 1), 104);
  const scope = req.query.scope === "all" ? "all" : "city";
  if (!Number.isInteger(siteId) || siteId <= 0) {
    return res.status(400).json({ success: false, error: "site_id is required" });
  }
  try {
    let cities: string[] = [];
    if (scope === "city") {
      const rows: any[] = (await getCitiesBySiteId(siteId)) ?? [];
      cities = [...new Set(rows.map((c) => String(c.city ?? "").trim()).filter(Boolean))];
    }
    res.json({ success: true, scope, trend: await getSiteRankTrend(siteId, weeks, cities) });
  } catch (err) {
    logger.error("[rank-history] trend error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

export { router as rankHistoryRouter };
