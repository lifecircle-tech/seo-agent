import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getActiveMcpTools } from "../controllers/mcp_tools.controller.js";

const router = Router();

// base path - '/madhavi/mcp-tools'

router.get("/active", asyncHandler(getActiveMcpTools));

export default router;
