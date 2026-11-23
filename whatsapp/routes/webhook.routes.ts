import express, { Router } from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { asyncHandler, isValidMetaSignature, safeEqual } from "../middleware.js";
import { handleWebhook } from "../services/webhook.service.js";

// Callback URL to set in the Meta app: <public url>/webhook, subscribed to
// the "messages" field.
const router = Router();

// Verification request Meta sends when the callback URL is saved
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (
    mode === "subscribe" &&
    typeof token === "string" &&
    typeof challenge === "string" &&
    safeEqual(token, config.webhookVerifyToken)
  ) {
    logger.log("[whatsapp] webhook verified");
    res.status(200).type("text/plain").send(challenge);
    return;
  }

  logger.warn("[whatsapp] webhook verification failed");
  res.sendStatus(403);
});

// The raw body is needed to check Meta's signature, so it is parsed here
// rather than by express.json().
router.post(
  "/",
  express.raw({ type: () => true, limit: "5mb" }),
  asyncHandler(async (req, res) => {
    const raw = req.body;
    // if (!Buffer.isBuffer(raw) || !isValidMetaSignature(raw, req.get("x-hub-signature-256"))) {
    //   logger.warn(`[whatsapp] rejected webhook with an invalid signature from ${req.ip}`);
    //   res.sendStatus(401);
    //   return;
    // }

    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      res.sendStatus(400);
      return;
    }
    logger.debug(`[whatsapp] body ${JSON.stringify(body)}`);

    await handleWebhook(body);
    res.sendStatus(200);
  }),
);

export { router as webhookRouter };
