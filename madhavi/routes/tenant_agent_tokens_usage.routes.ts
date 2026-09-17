import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createTenantAgentTokensUsage,
  getTenantAgentTokensUsages,
  getTenantAgentTokensUsageById,
  updateTenantAgentTokensUsage,
  deleteTenantAgentTokensUsage,
  getTenantTokenUsageSummaryReport,
  getTenantTokenUsageAnalyticsReport,
} from "../controllers/tenant_agent_tokens_usage.controller.js";

const router = Router();

// base path - '/madhavi/tenant-agent-tokens-usage'

router.post("/", asyncHandler(createTenantAgentTokensUsage));
router.get("/", asyncHandler(getTenantAgentTokensUsages));
router.get(
  "/tenant/:slug/summary",
  asyncHandler(getTenantTokenUsageSummaryReport),
);
router.get(
  "/tenant/:slug/analytics",
  asyncHandler(getTenantTokenUsageAnalyticsReport),
);
router.get("/:id", asyncHandler(getTenantAgentTokensUsageById));
router.put("/:id", asyncHandler(updateTenantAgentTokensUsage));
router.delete("/:id", asyncHandler(deleteTenantAgentTokensUsage));

export default router;
