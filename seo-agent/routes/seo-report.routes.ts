import { Router, Request, Response } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import {
  getSeoReportById,
  getLatestSeoReport,
  getLatestReportsForSite,
  listSeoReports,
  getAllLatestSeoReport,
} from "../controllers/seo-report.controller.js";
import type { ReportType } from "../models/seo-report.model.js";
import { logger } from "../utils/logger.js";

const VALID_TYPES: ReportType[] = ["backlinks", "sitemap_ads", "missing_pages"];

const router = Router();

router.get("/weekly", async (req: Request, res: Response) => {
  try {
    const reports = await getAllLatestSeoReport();
    res.json({ success: true, reports });
  } catch (err) {
    logger.error("[seo-report] site latest error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// GET /report/site/:siteId — latest of all report types for a site (dashboard)
router.get(
  "/site/:siteId",
  requireAuth,
  async (req: Request, res: Response) => {
    const siteId = Number(req.params.siteId);
    if (!siteId) {
      res.status(400).json({ success: false, error: "Invalid site_id" });
      return;
    }
    try {
      const reports = await getLatestReportsForSite(siteId);
      res.json({ success: true, reports });
    } catch (err) {
      logger.error("[seo-report] site latest error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  },
);

// GET /report/site/:siteId/latest?report_type=backlinks
router.get(
  "/site/:siteId/latest",
  requireAuth,
  async (req: Request, res: Response) => {
    const siteId = Number(req.params.siteId);
    const reportType = req.query.report_type as ReportType;

    if (!siteId) {
      res.status(400).json({ success: false, error: "Invalid site_id" });
      return;
    }
    if (!reportType || !VALID_TYPES.includes(reportType)) {
      res.status(400).json({
        success: false,
        error: `report_type must be one of: ${VALID_TYPES.join(", ")}`,
      });
      return;
    }
    try {
      const report = await getLatestSeoReport(siteId, reportType);
      if (!report) {
        res.status(404).json({ success: false, error: "No report found" });
        return;
      }
      res.json({ success: true, report });
    } catch (err) {
      logger.error("[seo-report] latest error:", err);
      res.status(500).json({ success: false, error: "Database error" });
    }
  },
);

// GET /report?site_id=1&report_type=backlinks&limit=20&offset=0
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const { site_id, report_type, limit, offset } = req.query as Record<
    string,
    string
  >;

  if (report_type && !VALID_TYPES.includes(report_type as ReportType)) {
    res.status(400).json({
      success: false,
      error: `report_type must be one of: ${VALID_TYPES.join(", ")}`,
    });
    return;
  }
  try {
    const result = await listSeoReports({
      site_id: site_id ? Number(site_id) : undefined,
      report_type: report_type as ReportType | undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error("[seo-report] list error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// GET /report/:id
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const report = await getSeoReportById(req.params.id);
    if (!report) {
      res.status(404).json({ success: false, error: "Report not found" });
      return;
    }
    res.json({ success: true, report });
  } catch (err) {
    logger.error("[seo-report] get error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

export { router as seoReportRouter };
