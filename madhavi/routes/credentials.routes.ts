import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createCredentials,
  getCredentials,
  getCredentialById,
  updateCredentials,
  deleteCredentials,
} from "../controllers/credentials.controller.js";

const router = Router();

// base path - '/madhavi/credentials'

router.post("/", asyncHandler(createCredentials));
router.get("/", asyncHandler(getCredentials));
router.get("/:id", asyncHandler(getCredentialById));
router.put("/:id", asyncHandler(updateCredentials));
router.delete("/:id", asyncHandler(deleteCredentials));

export default router;
