import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getTenantTokenUsageSummaryReport,
  getTenantTokenUsageAnalyticsReport,
} from "../controllers/tenant_agent_tokens_usage.controller.js";

const router = Router();

// base path - '/madhavi/tenant-agent-tokens-usage'

router.get(
  "/tenant/:slug/summary",
  asyncHandler(getTenantTokenUsageSummaryReport),
);
router.get(
  "/tenant/:slug/analytics",
  asyncHandler(getTenantTokenUsageAnalyticsReport),
);

export default router;
