import Anthropic from "@anthropic-ai/sdk";
import {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources";
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

    const prompt = `You are an SEO content strategist.
  
  Analyze the WordPress page below along with its search performance and keyword
  performance data, then suggest an improved title tag and meta description to
  increase CTR and rankings.

  CURRENT PAGE CONTENT (Markdown):
  ${content}
  
  PAGE DETAILS:
  ${JSON.stringify(page_details)}

  PAGE PERFORMANCE (last 28 days):
  ${JSON.stringify(page_performance)}

  KEYWORD PERFORMANCE (last 28 days):
  ${JSON.stringify(keyword_performance)}

  PEOPLE ALSO ASK:
  ${JSON.stringify(paa.map((q) => q.question))}

  SITE PAGES (Internal link opportunities):
  ${JSON.stringify(site_pages)};

  This is a blog post. Rewrite/refresh the FULL page content in Markdown to
  improve ranking — keep what already works, strengthen weak or outdated sections,
  add depth around the target keywords, and weave in the "People Also Ask"
  questions as a dedicated FAQ section near the end.

  RULES:
  - primary keyword should be present in h1 heading tag
  - secondary keywords should me present in subheading
  - primary and secondary keywords should be present in contents
  - primary keyword should be present in the first 10% of the content
  - minimum content should be 1500 words
  - maximum content should be 2000 words
  - relate the content with the title and description

  Do not fabricate statistics, studies, or metrics not present in the data above.
  If page is city specific, omit the PAA questions that contains different city

  Return Only a JSON object with keys:
  - content: Markdown format, preserving the structure and any important details
  - reason: simple and brief about what changed and the expected SEO impact
  - source: list source about any information added from outside like testimonial, pricing
  `;

    const response = await callWithRetry(client, "step2", {
      model: "claude-sonnet-5",
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

    let prompt = `You are an SEO content strategist.
  
    Analyze the WordPress page below along with its search performance and keyword
    performance data, then suggest an improved title tag and meta description to
    increase CTR and rankings.

    CURRENT PAGE CONTENT (Markdown):
    ${content}
    
    PAGE DETAILS:
    ${JSON.stringify(page_details)}

    PAGE PERFORMANCE (last 28 days):
    ${JSON.stringify(page_performance)}

    KEYWORD PERFORMANCE (last 28 days):
    ${JSON.stringify(keyword_performance)}

    PEOPLE ALSO ASK:
    ${JSON.stringify(paa.map((q) => q.question))}

    This is a static page (not a blog post). Do NOT rewrite the full page —
    only produce an improved/expanded FAQ section in Markdown (use "## Question"
    headings) that answers the target keywords' intent, incorporating the "People
    Also Ask" questions where relevant.

    Do not fabricate statistics, studies, or metrics not present in the data above.
    If page is city specific, omit the PAA questions that contains different city

    Return Only a JSON object with keys:
    - content: Markdown format, preserving the structure and any important details
    - reason: simple and brief about what changed and the expected SEO impact
    - source: list source about any information added from outside like testimonial, pricing
    `;

    const response = await callWithRetry(client, "step2", {
      model: "claude-sonnet-5",
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
