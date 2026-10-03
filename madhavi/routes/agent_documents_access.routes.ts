import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createAgentDocumentsAccess,
  getAgentDocumentsAccessesByAgentId,
  deleteAgentDocumentsAccess,
} from "../controllers/agent_documents_access.controller.js";

const router = Router();

// base path - '/madhavi/agent-documents-access'

router.post("/", asyncHandler(createAgentDocumentsAccess));
router.get("/agent/:agent_id", asyncHandler(getAgentDocumentsAccessesByAgentId));
router.delete("/:id", asyncHandler(deleteAgentDocumentsAccess));

export default router;
