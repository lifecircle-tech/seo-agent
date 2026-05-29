import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  getAgentsList,
  getAgentDetail,
  createCustomAgent,
  updateCustomAgent,
  deleteCustomAgent,
  runAgentReport,
  savePersonality,
  saveChannelOverride,
  getAgentTypeSchema,
} from "../controllers/agentReportsController.js";

const router = Router();

// Type schemas — what fields each agent type needs (for the create form)
router.get("/types",                       requireAuth, (req, res) => res.json({ success: true, types: getAgentTypeSchema() }));
router.get("/types/:type",                 requireAuth, (req, res) => {
  const schema = getAgentTypeSchema(req.params.type);
  if (!schema) return res.status(404).json({ success: false, error: `Unknown agent type: ${req.params.type}` });
  return res.json({ success: true, type: req.params.type, schema });
});

router.get("/",                            requireAuth, getAgentsList);
router.get("/:key",                        requireAuth, getAgentDetail);
router.post("/",                           requireAuth, createCustomAgent);
router.patch("/:key",                      requireAuth, updateCustomAgent);
router.delete("/:key",                     requireAuth, deleteCustomAgent);
router.post("/:key/run",                   requireAuth, runAgentReport);
router.patch("/:key/personality",          requireAuth, savePersonality);
router.patch("/:key/channel",              requireAuth, saveChannelOverride);

export default router;
