import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createAgentToolAccess,
  getAgentToolAccessesByAgentId,
  deleteAgentToolAccess,
} from "../controllers/agent_tool_access.controller.js";

const router = Router();

// base path - '/madhavi/agent-tool-access'

router.post("/", asyncHandler(createAgentToolAccess));
router.get("/agent/:agent_id", asyncHandler(getAgentToolAccessesByAgentId));
router.delete("/:id", asyncHandler(deleteAgentToolAccess));

export default router;
