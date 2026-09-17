import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createTenantAgentToolAccess,
  getTenantAgentToolAccesses,
  getTenantAgentToolAccessById,
  updateTenantAgentToolAccess,
  deleteTenantAgentToolAccess,
} from "../controllers/tenant_agent_tool_access.controller.js";

const router = Router();

// base path - '/madhavi/tenant-agent-tool-access'

router.post("/", asyncHandler(createTenantAgentToolAccess));
router.get("/", asyncHandler(getTenantAgentToolAccesses));
router.get("/:id", asyncHandler(getTenantAgentToolAccessById));
router.put("/:id", asyncHandler(updateTenantAgentToolAccess));
router.delete("/:id", asyncHandler(deleteTenantAgentToolAccess));

export default router;
