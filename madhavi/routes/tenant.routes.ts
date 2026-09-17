import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createTenant,
  getTenants,
  updateTenant,
  deleteTenant,
  getTenantAgents,
  getTenantBySlug,
} from "../controllers/tenant.controller.js";

const router = Router();

// base path - '/madhavi/tenants'

router.post("/", asyncHandler(createTenant));
router.get("/", asyncHandler(getTenants));
router.get("/:slug", asyncHandler(getTenantBySlug));
router.get("/:id/agents", asyncHandler(getTenantAgents));
router.put("/:slug", asyncHandler(updateTenant));
router.delete("/:id", asyncHandler(deleteTenant));

export default router;
