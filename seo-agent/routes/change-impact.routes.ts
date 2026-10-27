/**
 * Change impact router — before/after Search Console results for published changes.
 *
 * GET /change-impact?source_type=approval&source_ids=a,b,c
 *   Results for specific approvals / page contents / opportunities (max 200 ids).
 * GET /change-impact/summary?site_id=1&days=90
 *   Roll-up for a site over changes made in the last N days.
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { logger } from "../utils/logger.js";
import {
  listImpactBySources,
  summarizeImpact,
} from "../services/change-impact.service.js";
import { ChangeSourceType } from "../models/change-impact.model.js";

const SOURCE_TYPES: ChangeSourceType[] = ["approval", "page_content", "opportunity"];

const router = Router();

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const sourceType = String(req.query.source_type ?? "") as ChangeSourceType;
  const sourceIds = String(req.query.source_ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!SOURCE_TYPES.includes(sourceType)) {
    return res.status(400).json({ success: false, error: `source_type must be one of ${SOURCE_TYPES.join(", ")}` });
  }
  try {
    const items = await listImpactBySources(sourceType, sourceIds);
    res.json({ success: true, items });
  } catch (err) {
    logger.error("[change-impact] list error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

router.get("/summary", requireAuth, async (req: Request, res: Response) => {
  const siteId = Number(req.query.site_id);
  const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 730);
  if (!Number.isInteger(siteId) || siteId <= 0) {
    return res.status(400).json({ success: false, error: "site_id is required" });
  }
  try {
    const summary = await summarizeImpact(siteId, days);
    res.json({ success: true, summary });
  } catch (err) {
    logger.error("[change-impact] summary error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

export { router as changeImpactRouter };
