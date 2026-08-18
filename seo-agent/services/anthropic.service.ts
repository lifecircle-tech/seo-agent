import Anthropic from "@anthropic-ai/sdk";
import {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources";

import * as dotenv from "dotenv";
import { logger } from "../utils/logger.js";

// ── Config ────────────────────────────────────────────────────────────
dotenv.config();

export async function getAIResponse(
  label: string,
  params: MessageCreateParamsNonStreaming,
): Promise<Message> {
  logger.debug(`Running prompt for ${label}`);
  
  const client: Anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  try {
    return await client.messages.create(params);
  } catch (exc: any) {
    throw new Error(`[${label}] ${exc.message}`);
  }
}
