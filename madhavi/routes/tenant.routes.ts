import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createTenant,
  getTenants,
  updateTenant,
  deleteTenant,
  getTenantBySlug,
} from "../controllers/tenant.controller.js";

const router = Router();

// base path - '/madhavi/tenant'

router.post("/", asyncHandler(createTenant));
router.get("/", asyncHandler(getTenants));
router.get("/:slug", asyncHandler(getTenantBySlug));
router.put("/:slug", asyncHandler(updateTenant));
router.delete("/:id", asyncHandler(deleteTenant));

export default router;
