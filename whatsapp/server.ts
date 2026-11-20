/**
 * WhatsApp service — sends and receives WhatsApp messages through the
 * WhatsApp Business Platform (Cloud API). Runs as its own process:
 *
 *   npm run dev:whatsapp      (tsx, from source)
 *   npm run start:whatsapp    (after npm run build)
 *
 * GET/POST /webhook    Meta's webhook (signature-checked, no token)
 * everything else      internal API, requires x-internal-token
 *
 * See whatsapp/README.md.
 */

import express from "express";
import { mkdir } from "node:fs/promises";
import { assertConfig, config } from "./config.js";
import { wa_pool } from "./db.js";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware.js";
import { initSchema } from "./models/schema.js";
import { apiRouter } from "./routes/api.routes.js";
import { webhookRouter } from "./routes/webhook.routes.js";

assertConfig();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

app.use((req, _res, next) => {
  // Path only: the webhook verification query carries the verify token
  console.log(`[${new Date().toLocaleString()}] [whatsapp] [${req.method}] ${req.path}`);
  next();
});

app.get("/health", async (_req, res) => {
  try {
    await wa_pool.query("SELECT 1");
    res.json({ success: true, status: "ok", service: "whatsapp", uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ success: false, status: "error", db: String(err) });
  }
});

app.use("/webhook", webhookRouter);
app.use("/", apiRouter);
app.use(errorHandler);

(async () => {
  try {
    await wa_pool.query("SELECT 1");
    logger.log(
      `[whatsapp] ✓ DB connected → ${config.databaseUrl.replace(/:[^:@/]+@/, ":***@")}`,
    );
  } catch (err) {
    logger.error("[whatsapp] ✗ DB connection FAILED — check WHATSAPP_DATABASE_URL", err);
    process.exit(1);
  }

  if (config.dbAutoInit) {
    await initSchema();
    logger.log("[whatsapp] ✓ tables ready");
  } else {
    logger.log("[whatsapp] table init skipped (DB_AUTO_INIT=false)");
  }

  await mkdir(config.mediaDir, { recursive: true });

  if (!config.forwardUrls.length) {
    logger.warn("[whatsapp] WHATSAPP_FORWARD_WEBHOOK_URLS is empty: received messages are stored but not forwarded");
  }

  app.listen(config.port, () => {
    logger.log(`[whatsapp] listening on port ${config.port}`);
  });
})().catch((err) => {
  logger.error("[whatsapp] startup failed", err);
  process.exit(1);
});

export { app };
