import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createTenantAgentAccess,
  getTenantAgentAccessByAgentKey,
  deleteTenantAgentAccess,
} from "../controllers/tenant_agent_access.controller.js";

const router = Router();

// base path - '/madhavi/tenant-agent-access'

router.post("/", asyncHandler(createTenantAgentAccess));
router.get(
  "/tenant/:tenant_id/agent/:key",
  asyncHandler(getTenantAgentAccessByAgentKey),
);
router.delete("/:id", asyncHandler(deleteTenantAgentAccess));

export default router;
