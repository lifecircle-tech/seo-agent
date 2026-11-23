import { Router } from "express";
import { runRegistrationManager } from "../orchestrators/lc-orchestrator";
import { logger } from "../utils/logger";
import { config } from "../config/config";

const router = Router();

// base path - '/madhavi/agents'

router.post("/registration", async (req, res) => {
  const body = req.body;
  logger.debug("[registration]", body);
  const resp = await runRegistrationManager(body.hp_unique_id, body.trigger);

  res.status(200).json(resp);
});

router.get("/whatsapp/webhook", async (req, res) => {
  logger.debug("[whatsapp webhook verification]", req.query);
  const challenge = req.query["hub.challenge"];
  res.status(200).type("text/plain").send(challenge);
})

router.post("/whatsapp/webhook", async (req, res) => {
  logger.debug("[whatsapp webhook]", req.body);

  // The global express.json() has already parsed the body, so re-serialize it.
  const payload: string = Buffer.isBuffer(req.body)
    ? req.body.toString("utf8")
    : typeof req.body === "string"
      ? req.body
      : JSON.stringify(req.body ?? {});

  const headers: Record<string, string> = {
    "Content-Type": req.get("content-type") ?? "application/json",
    "x-internal-token": config.internalToken,
  };
  const signature = req.get("x-hub-signature-256");
  if (signature) headers["x-hub-signature-256"] = signature;

  try {
    const upstream = await fetch(config.forwardUrl, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });

    // Relay the upstream response back to the caller as-is.
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.type(contentType);
    res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    logger.error("[whatsapp webhook] forward failed", err);
    res.sendStatus(timedOut ? 504 : 502);
  }
});

export default router;
