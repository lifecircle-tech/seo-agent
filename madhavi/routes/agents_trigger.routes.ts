import { Router } from "express";
import { runRegistrationManager } from "../orchestrators/lc-orchestrator";
import { logger } from "../utils/logger";

const router = Router();

// base path - '/madhavi/agents'

router.post("/registration", async (req, res) => {
  const body = req.body;
  logger.debug("[registration]", body);
  const resp = await runRegistrationManager(body.hp_unique_id, body.trigger);

  res.status(200).json(resp);
});

export default router;
