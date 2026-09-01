/**
 * Sites router — /sites endpoints.
 * Ported from the Next.js dashboard API route:
 *   /api/sites/[site_id]/overview
 *
 * GET /sites/:site_id/overview
 *   Returns avg_position + traffic_sparkline (GSC) + open_alerts count.
 */

import { Router, Request, Response } from "express";
import { pool } from "../../db.js";
import { RowDataPacket } from "mysql2/promise";
import { logger } from "../utils/logger.js";
import { getCitiesBySiteId } from "../controllers/cities.controller.js";
import { getSiteBySiteID } from "../controllers/sites.controller.js";
import {
  getCityPerformanceMetrics,
  getSitePerformanceMetrics,
} from "../services/google.service.js";

const router = Router();

function fmt(d: Date): string {
  return d.toISOString().split("T")[0];
}

// GET /sites/:site_id/overview
router.get("/:site_id/overview", async (req: Request, res: Response) => {
  const { site_id } = req.params;
  const { site_url, start_date, end_date } = req.query as {
    site_url?: string;
    start_date?: string;
    end_date?: string;
  };

  // Open alerts count — direct DB query instead of internal fetch
  let open_alerts = 0;
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM alerts WHERE status = 'open' AND site_id = ?",
      [Number(site_id)],
    );
    open_alerts = Number(rows[0].count);
  } catch (err) {
    logger.error("[overview] alerts query failed:", err);
  }

  // GSC: avg position + 28-day click sparkline
  let avg_position: number | null = null;
  let traffic_sparkline: Array<{ date: string; clicks: number }> = [];
  let position_sparkline: Array<{ date: string; position: number }> = [];

  try {
    const siteUrl = site_url;
    if (!siteUrl) throw new Error(`Unknown site_id=${site_id}`);

    const end = end_date ? new Date(end_date) : new Date();
    const start = start_date ? new Date(start_date) : new Date(end);
    if (!start_date) start.setDate(end.getDate() - 28);

    const dayCount = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1,
    );

    const overview = await getSitePerformanceMetrics(
      siteUrl,
      { start: fmt(start), end: fmt(end) },
      dayCount,
    );

    avg_position = overview.avg_position ?? null;
    traffic_sparkline = overview.traffic_sparkline;
    position_sparkline = overview.position_sparkline;
  } catch (err) {
    logger.error("[overview] GSC error:", err);
  }

  res.json({
    site_id: Number(site_id),
    avg_position,
    gbp_pack: null,
    avg_rating: null,
    open_alerts,
    traffic_sparkline,
    position_sparkline,
    last_updated: new Date().toISOString(),
  });
});

// GET /sites/:site_id/cities/overview
router.get("/:site_id/cities/overview", async (req: Request, res: Response) => {
  const { site_id } = req.params;
  const { start_date, end_date } = req.query as {
    start_date?: string;
    end_date?: string;
  };

  const end = end_date ? new Date(end_date) : new Date();
  const start = start_date ? new Date(start_date) : new Date(end);
  if (!start_date) start.setDate(end.getDate() - 28);

  const dayCount = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1,
  );

  const site = await getSiteBySiteID(Number(site_id));
  const cities = (await getCitiesBySiteId(Number(site_id))).map(
    (city) => city.city,
  );

  const city_overview = await Promise.all(
    cities.map(async (city) => {
      const {
        avg_position,
        avg_impressions,
        traffic_sparkline,
        position_sparkline,
      } = await getCityPerformanceMetrics(
        site?.domain as string,
        city.toLowerCase(),
        {
          start: fmt(start),
          end: fmt(end),
        },
        dayCount,
      );

      return {
        site_id: site?.site_id,
        site_name: site?.brand_name,
        city: city,
        avg_position,
        avg_impressions,
        traffic_sparkline,
        position_sparkline,
      };
    }),
  );

  res.json(city_overview);
});

export { router as sitesRouter };
