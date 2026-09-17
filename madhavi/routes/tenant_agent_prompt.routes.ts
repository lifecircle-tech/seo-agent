import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createTenantAgentPrompt,
  getTenantAgentPrompts,
  getTenantAgentPromptById,
  updateTenantAgentPrompt,
  deleteTenantAgentPrompt,
} from "../controllers/tenant_agent_prompt.controller.js";

const router = Router();

// base path - '/madhavi/tenant-agent-prompts'

router.post("/", asyncHandler(createTenantAgentPrompt));
router.get("/", asyncHandler(getTenantAgentPrompts));
router.get("/:id", asyncHandler(getTenantAgentPromptById));
router.put("/:id", asyncHandler(updateTenantAgentPrompt));
router.delete("/:id", asyncHandler(deleteTenantAgentPrompt));

export default router;
