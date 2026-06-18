/**
 * Sites router — /sites endpoints.
 * Ported from the Next.js dashboard API route:
 *   /api/sites/[site_id]/overview
 *
 * GET /sites/:site_id/overview
 *   Returns avg_position + traffic_sparkline (GSC) + open_alerts count.
 */

import { Router, Request, Response } from "express";
import { google } from "googleapis";
import { pool } from "../../db.js";
import { RowDataPacket } from "mysql2/promise";

const router = Router();

function getGscAuth() {
  const raw = process.env[`GSC_OAUTH_SITE`];
  if (!raw) throw new Error(`Missing GSC_OAUTH_SITE env var`);
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(raw) as object,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
}

function fmt(d: Date): string {
  return d.toISOString().split("T")[0];
}

// GET /sites/:site_id/overview
router.get("/:site_id/overview", async (req: Request, res: Response) => {
  const { site_id } = req.params;
  const { site_url } = req.query as { site_url?: string   };

  // Open alerts count — direct DB query instead of internal fetch
  let open_alerts = 0;
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM alerts WHERE status = 'open' AND site_id = ?",
      [Number(site_id)],
    );
    open_alerts = Number(rows[0].count);
  } catch (err) {
    console.error("[overview] alerts query failed:", err);
  }

  // GSC: avg position + 28-day click sparkline
  let avg_position: number | null = null;
  const traffic_sparkline: Array<{ date: string; clicks: number }> = [];

  try {
    const siteUrl = site_url;
    if (!siteUrl) throw new Error(`Unknown site_id=${site_id}`);

    const sc = google.searchconsole({ version: "v1", auth: getGscAuth() });

    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 28);

    const [posRes, clickRes] = await Promise.all([
      sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: fmt(start),
          endDate:   fmt(end),
          dimensions: [],
          rowLimit: 1,
        },
      }),
      sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: fmt(start),
          endDate:   fmt(end),
          dimensions: ["date"],
          dataState: 'all',
          rowLimit: 28,
        },
      }),
    ]);

    avg_position = posRes.data.rows?.[0]?.position ?? null;

    for (const row of clickRes.data.rows ?? []) {
      traffic_sparkline.push({
        date:   row.keys?.[0] ?? "",
        clicks: row.clicks ?? 0,
      });
    }
  } catch (err) {
    console.error("[overview] GSC error:", err);
  }

  res.json({
    site_id:          Number(site_id),
    avg_position,
    gbp_pack:         null,
    avg_rating:       null,
    open_alerts,
    traffic_sparkline,
    last_updated:     new Date().toISOString(),
  });
});

export { router as sitesRouter };
