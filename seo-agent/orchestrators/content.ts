import Anthropic from "@anthropic-ai/sdk";
import {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources";
import { logger } from "../utils/logger.js";
import { renderPrompt, seoAgentModel } from "../prompts/index.js";

const MAX_RETRIES = 3;
const RETRY_BACKOFF = [2000, 5000, 10000]; // milliseconds between retries

// ── Helper ────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractJson(text: string) {
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (e) {
    // Claude might return explanation text alongside JSON — extract the JSON block
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (innerErr) {
        // Fallthrough to return null on secondary failure
      }
    }
    return null;
  }
}

async function callWithRetry(
  client: Anthropic,
  label: string,
  params: MessageCreateParamsNonStreaming,
): Promise<Message> {
  let lastExc: Error = new Error("No attempts made");

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (exc: any) {
      lastExc = exc as Error;
      if (attempt < MAX_RETRIES - 1) {
        const waitMs = RETRY_BACKOFF[attempt];
        logger.warn(
          `[${label}] attempt ${attempt + 1} failed: ${exc.message}. Retrying in ${waitMs / 1000}s...`,
        );
        await sleep(waitMs);
      } else {
        logger.error(`[${label}] all ${MAX_RETRIES} attempts failed.`);
      }
    }
  }
  throw lastExc;
}

// TODO: Add sitemap pages with canonical and redirection
export async function analyseWithAI(
  content: string,
  page_details: Record<string, any> = {},
  page_performance: any[] = [],
  keyword_performance: any[] = [],
  paa: any[] = [],
  site_pages: any[],
) {
  try {
    const client: Anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    logger.info("[page-content] Details", page_details);

    const prompt = renderPrompt("page_content_post", {
    current_content: content,
    page_details: JSON.stringify(page_details),
    page_performance: JSON.stringify(page_performance),
    keyword_performance: JSON.stringify(keyword_performance),
    paa_questions: JSON.stringify(paa.map((q) => q.question)),
    site_pages: JSON.stringify(site_pages),
  });

    const response = await callWithRetry(client, "step2", {
      model: seoAgentModel(),
      max_tokens: 10000,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    logger.debug(`[page-content] Stop reason: ${response.stop_reason}`);
    logger.debug(`[page-content] Usage: `, response.usage);

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    const structruredResponse = JSON.parse(text.replace(/```json|```/g, ""));

    return {
      content: JSON.stringify(structruredResponse.content),
      reason: structruredResponse.reason,
    };
  } catch (err) {
    logger.error("[page-content]", err);
    throw err;
  }
}

export async function analyseFAQwithAI(
  content: string,
  page_details: Record<string, any> = {},
  page_performance: any[] = [],
  keyword_performance: any[] = [],
  paa: any[] = [],
) {
  try {
    const client: Anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    logger.info("[page-content.faq] Details", page_details);

    let prompt = renderPrompt("page_content_faq", {
    current_content: content,
    page_details: JSON.stringify(page_details),
    page_performance: JSON.stringify(page_performance),
    keyword_performance: JSON.stringify(keyword_performance),
    paa_questions: JSON.stringify(paa.map((q) => q.question)),
  });

    const response = await callWithRetry(client, "step2", {
      model: seoAgentModel(),
      max_tokens: 10000,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    logger.debug(`[page-content] Stop reason: ${response.stop_reason}`);
    logger.debug(`[page-content] Usage: `, response.usage);

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    const structruredResponse = extractJson(text);

    return {
      content: JSON.stringify(structruredResponse.content),
      reason: structruredResponse.reason,
    };
  } catch (err) {
    logger.error("[page-content.faq]", err);
    throw err;
  }
}
