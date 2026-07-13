import Anthropic from "@anthropic-ai/sdk";
import {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta.js";
import { logger } from "../utils/logger.js";

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
): Promise<BetaMessage> {
  let lastExc: Error = new Error("No attempts made");

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await client.beta.messages.create(params);
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

export async function analyseWithAI(
  content: string,
  details: Record<string, any> = {},
) {
  try {
    const client: Anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    logger.info("[page-content] Details", details);

    const prompt = `You are a content writer assistant.
  Here are some context about the content you will analyze:
  ${JSON.stringify(details, null, 2)}

  Rules to follow when rewriting the content:
  - primary keyword should be present in h1 heading tag (if present in content)
  - secondary keywords should me present in subheading (if present in content)
  - primary and secondary keywords should be present in contents
  - primary keyword should be present in the first 10% of the content
  - minimum content should be 1500 words
  - maximum content should be 2000 words
  - relate the content with the title and description

  Analyze the following content(in markdown format) and rewrite the content for better readability and SEO that matches the context above.:
  ${content}

  Include 3-4 FAQs at the end of the content with answers. The FAQs should be relevant to the content and should be in markdown format.
  Exclude Customer Reviews, Related Blogs, Recent Blogs and Testimonials from the rewritten content.
  
  Return the JSON object with keys:
  - content: Markdown format, preserving the structure and any important details,
  - reason: reason for any changes, provide detailed reason and its impact.
  `;

    const response = await callWithRetry(client, "step2", {
      model: "claude-sonnet-4-6",
      max_tokens: 10000,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      betas: ["mcp-client-2025-04-04"],
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
  details: Record<string, any> = {},
) {
  try {
    const client: Anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    logger.info("[page-content.faq] Details", details);

    let prompt = `You are a content writer assistant.
  Here are some context about the content you will analyze:
  ${JSON.stringify(details, null, 2)}
  `;

    if (content.length) {
      prompt =
        prompt +
        `\nBelow are the FAQs in markdown format, analyze and rewrite the FAQs for SEO optimization`;
    } else {
      prompt = prompt + `\nConsidering the context above, write 3-4 FAQs`;
    }

    prompt =
      prompt +
      `\nFAQs should be in markdown format.
    
  Return the JSON object with keys:
  - content: Markdown format, preserving the structure and any important details,
  - reason: reason for any changes.
  `;

    const response = await callWithRetry(client, "step2", {
      model: "claude-sonnet-4-6",
      max_tokens: 10000,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      betas: ["mcp-client-2025-04-04"],
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
