import { Router } from "express";
import {
  getLeads, getOneLead, updateLead, getStats,
  logBolnaActivity, updateBolnaActivity, sendWhatsAppFallback,

} from "../controllers/careJobsController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/leads",                           requireAuth, getLeads);
router.get("/leads/:id",                       requireAuth, getOneLead);
router.patch("/leads/:id",                     requireAuth, updateLead);
router.get("/stats",                           requireAuth, getStats);
router.post("/bolna-log",                      requireAuth, logBolnaActivity);
router.patch("/bolna-log/:executionId",        requireAuth, updateBolnaActivity);
router.post("/whatsapp-fallback/:id",          requireAuth, sendWhatsAppFallback);

export default router;
