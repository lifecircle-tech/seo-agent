/**
 * Keyword grounding for LLM-generated opportunities.
 *
 * The opportunity prompts say "do not fabricate keywords", but nothing enforced
 * it. This keeps only target keywords that appear in the data actually sent to
 * the model, and drops (with a log line) any it made up.
 */

import { logger } from "./logger.js";

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Build the haystack once from the same values that were JSON.stringify'd into the prompt. */
export function buildGroundingText(...inputs: unknown[]): string {
  return normalise(inputs.map((i) => JSON.stringify(i ?? "")).join(" "));
}

/**
 * Filters `opportunity_details.target_keywords` on each opportunity to keywords
 * present in `groundingText`. Opportunities left with no keywords are removed,
 * because every downstream generator (meta rewrite, page content, canonical)
 * is driven by them.
 */
export function groundOpportunityKeywords<T>(
  opportunities: T[],
  groundingText: string,
  label: string,
): T[] {
  if (!Array.isArray(opportunities)) return opportunities;

  const kept: T[] = [];
  for (const opp of opportunities) {
    const details = (opp as any)?.opportunity_details;
    const keywords: unknown = details?.target_keywords;

    if (!Array.isArray(keywords) || keywords.length === 0) {
      kept.push(opp);
      continue;
    }

    const grounded = keywords.filter(
      (k): k is string =>
        typeof k === "string" && !!k.trim() && groundingText.includes(normalise(k)),
    );
    const dropped = keywords.filter((k) => !grounded.includes(k as string));

    if (dropped.length) {
      logger.warn(
        `[${label}] dropped ${dropped.length} keyword(s) not present in the input data: ${JSON.stringify(dropped)} (topic: ${(opp as any)?.topic ?? "?"})`,
      );
    }

    if (grounded.length === 0) {
      logger.warn(
        `[${label}] skipped opportunity — none of its target keywords were in the input data (topic: ${(opp as any)?.topic ?? "?"})`,
      );
      continue;
    }

    details.target_keywords = grounded.map((k) => k.replace(/\s+/g, " ").trim());
    kept.push(opp);
  }
  return kept;
}
