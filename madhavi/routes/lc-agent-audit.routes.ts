import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getAgentRuns,
  getAgentRun,
  getCaregiverAudit,
  getDailyReports,
  getDailyReport,
  generateDailyReportNow,
} from "../controllers/lc-agent-audit.controller.js";

const router = Router();

// base path - '/madhavi/agent-audit'

router.get("/runs", asyncHandler(getAgentRuns));
router.get("/runs/:id", asyncHandler(getAgentRun));
router.get("/caregivers/:hp_unique_id", asyncHandler(getCaregiverAudit));
router.get("/reports/daily", asyncHandler(getDailyReports));
router.get("/reports/daily/:date", asyncHandler(getDailyReport));
router.post(
  "/reports/daily/:date/generate",
  asyncHandler(generateDailyReportNow),
);

export default router;
