import { Router } from "express";
import { handleWebhook } from "../controllers/ozonetelController.js";

const router = Router();

// PUBLIC — called by Ozonetel platform
router.post("/webhook", handleWebhook);
router.get("/webhook",  handleWebhook); // Ozonetel sometimes uses GET

export default router;
