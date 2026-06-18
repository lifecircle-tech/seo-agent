import { Router, Request, Response } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { getDashboardStats } from "../controllers/dashboard.controllers.js";

export const dashboardRouter = Router();

// GET /dashboard/stats
dashboardRouter.get("/stats", requireAuth, async (req: Request, res: Response) => {
  const { site_id } = req.query as Record<string, string>;
  try {
    const stats = await getDashboardStats(site_id ? Number(site_id) : undefined);
    res.json({ success: true, ...stats });
  } catch (err) {
    console.error("[dashboard] stats error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});
