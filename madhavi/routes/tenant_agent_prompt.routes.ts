import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createTenantAgentPrompt,
  updateTenantAgentPrompt,
  deleteTenantAgentPrompt,
} from "../controllers/tenant_agent_prompt.controller.js";

const router = Router();

// base path - '/madhavi/tenant-agent-prompt'

router.post("/", asyncHandler(createTenantAgentPrompt));
router.put("/:id", asyncHandler(updateTenantAgentPrompt));
router.delete("/:id", asyncHandler(deleteTenantAgentPrompt));

export default router;
