import { setTimeout } from "node:timers/promises";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { WhatsappEvent } from "../types.js";

const RETRY_DELAYS_MS = [0, 2_000, 10_000, 60_000];

async function deliver(url: string, body: string) {
  let lastError = "";

  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await setTimeout(delay);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": config.internalToken,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return;

      lastError = `${res.status} ${res.statusText}`;
      // A client error will not succeed on retry
      if (res.status < 500 && res.status !== 429) break;
    } catch (err: any) {
      lastError = String(err?.message ?? err);
    }
  }

  logger.error(`[whatsapp] could not deliver event to ${url}: ${lastError}`);
}

// Posts the event to every WHATSAPP_FORWARD_WEBHOOK_URLS endpoint, in the
// background with retries, so a slow consumer never delays the 200 that
// WhatsApp waits for.
export function forwardEvent(event: WhatsappEvent) {
  const body = JSON.stringify(event);
  for (const url of config.forwardUrls) {
    void deliver(url, body);
  }
}
