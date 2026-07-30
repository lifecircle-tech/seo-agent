import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import { logger } from "../utils/logger.js";

// Import controllers for database operations
import {
  getNewOpportunities,
  updateStatusToGenerated,
} from "../controllers/opportunities.controller.js";
import { OpportunityJSON } from "../models/opportunities.model.js";
import { createNewPageContent } from "../controllers/page-content.controller.js";
import { getSiteBySiteID } from "../controllers/sites.controller.js";
import { getKeywordsAnalytics } from "../controllers/keywords.controller.js";
import {
  getPaaQuestionsForKeywords,
  markPaaQuestionsAsUsed,
} from "../controllers/paa.controller.js";

// ── Config ────────────────────────────────────────────────────────────
dotenv.config();

// ── Helper ────────────────────────────────────────────────────────────
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

async function writePageContentWithAI(
  opportunity: OpportunityJSON,
  paaQuestions: string[],
) {
  const opp = opportunity.opportunity_details;

  // Generate page content using AI
  logger.info("[monthly.opportunity_content] Generating Page content using AI");

  const client: Anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const faqSection =
    paaQuestions.length > 0
      ? `\nPeople Also Ask (use these as FAQ section — answer them in the content):\n${paaQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n`
      : "";

  const prompt = `
  You are an expert SEO content writer and strategist with deep knowledge of on-page 
SEO, search intent, and readable, high-quality writing. Your job is to turn 
structured content briefs into publish-ready, SEO-optimized articles that rank well 
AND genuinely help the reader.

You will be given:
- Title
- Topic
- Target keywords (primary + secondary)
- Content description / brief

Follow the SEO and writing rules below exactly. Do not skip steps.

Title: ${opp?.title}
Topic: ${opp?.topic}
Primary Keyword: ${opp?.target_keywords[0]}
Secondary Keywords: ${opp?.target_keywords.slice(1)}
Content Description: ${opp?.description}
Target Audience: Professional caregiver, family member
Target Word Count: 1500-2000
Content Type: ${opp?.type}

Using the inputs above, write a complete, SEO-optimized piece of content. Follow 
these rules:

1. TITLE & META
   - Refine the given title if needed (keep it under 60 characters, include the 
     primary keyword near the front).
   - Write a meta description (150-160 characters) that includes the primary 
     keyword and a clear value proposition or CTA.

2. STRUCTURE
   - Use one H1 (the title).
   - Break the body into logical H2/H3 sections based on the content description.
   - Include a short, compelling introduction that states what the reader will 
     learn and includes the primary keyword within the first 100 words.
   - End with a conclusion and a clear next step or CTA.

3. KEYWORD USAGE
   - Use the primary keyword naturally in: title, meta description, intro, at 
     least one H2, and the conclusion.
   - Distribute secondary keywords naturally across subheadings and body text.
   - Do NOT keyword-stuff. Prioritize natural, human-readable language over 
     exact-match repetition. Use variations and related terms (LSI keywords).

4. READABILITY
   - Short paragraphs (2-4 sentences).
   - Use bullet points or numbered lists where helpful.
   - Use active voice and concrete examples.

5. ON-PAGE SEO EXTRAS
   - Suggest 2-3 internal linking opportunities (topics/anchor text, not URLs).
   - Suggest 1-2 external authoritative sources that could be linked.
   - Recommend alt text for any implied images based on section content.
   - Include a suggested URL slug (lowercase, hyphenated, includes primary keyword).

6. FAQ SECTION (if PAA questions are provided)
  ${faqSection}   
   - If People Also Ask questions are listed above, include a dedicated FAQ
     section answering each one concisely (2-4 sentences per answer).
   - Use the question text verbatim as the H3 heading inside the FAQ section.
   - Neglect repeated question, if any present.
   - Include this section near the end of the article, before the conclusion.

7. OUTPUT FORMAT
   Return the response in JSON structure:
    - title,
    - meta_description,
    - url_slug,
    - content : Full article with proper H1/H2/H3 formatting in Markdown,
    - suggestions : object of internal and external links suggestion,
    - images : array of object with image context and alt text
    - page_type : "page" or "post" (for WordPress)

8. CONSTRAINTS
   - Stay within ±10% of the target word count.
   - Do not fabricate statistics, studies, or quotes.
   - Do not use generic filler phrases ("In today's fast-paced world...", 
     "In conclusion, it is clear that...").
   - Match the specified audience throughout.
`;

  const response = await client.beta.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 15000,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    betas: ["mcp-client-2025-04-04"],
  });

  logger.debug(`[step5] Stop reason: ${response.stop_reason}`);
  logger.debug(`[step5] Usage: `, response.usage);

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const parsed = extractJson(text);

  return parsed;
}

export async function opportunityContentGeneration() {
  logger.info(
    `[monthly.opportunity_content] Fetching content opportunities from database...`,
  );

  const { opportunities } = await getNewOpportunities({
    site_id: 1,
    opportunity_type: "content",
  });

  // const opp = opportunities[0];
  for await (let opp of opportunities.slice(0, 10)) {
    const site = await getSiteBySiteID(opp.site_id);

    // Fetch PAA questions for this opportunity's target keywords
    const targetKeywords = opp.opportunity_details?.target_keywords ?? [];
    const keywords = await import("../controllers/keywords.controller.js").then(
      (m) => m.getKeywordsAnalytics(targetKeywords),
    );
    const relevantKeywordIds = keywords
      .filter((k) => targetKeywords.includes(k.keyword.toLowerCase()))
      .map((k) => k.id);

    const temp_paaMap = await getPaaQuestionsForKeywords(relevantKeywordIds);
    const paaMap = [...temp_paaMap.values()].flat().slice(0, 4);
    const paaQuestions = paaMap.map((q) => q.question);
    const paaIds = paaMap.map((q) => q.id);

    const response = await writePageContentWithAI(opp, paaQuestions);

    logger.debug(JSON.stringify(response, null, 2));

    // Get keywords analytics from keywords table
    const temp_keywords = await getKeywordsAnalytics(
      opp.opportunity_details?.target_keywords,
    );
    const keywords_analytics = temp_keywords.map((k) => ({
      keyword: k.keyword,
      cpc: k.cpc,
      competition_level: k.competition_level,
      impressions: k.impressions,
      search_volume: k.search_volume,
    }));

    await createNewPageContent({
      id: randomUUID(),
      site_id: 1,
      page_meta_details: {
        keywords: opp.opportunity_details?.target_keywords,
        page_type: response.page_type,
        page_title: response.title,
        meta_description: response.meta_description,
      },
      content: response.content,
      url: site?.domain + response.url_slug,
      images: response.images,
      links: response.suggestions,
      keywords_analytics: keywords_analytics,
    });
    logger.info("[monthly.opportunity_content] Page content created");

    await updateStatusToGenerated(opp.id);
    logger.info("[monthly.opportunity_content] Opportunity status updated");

    // Mark consumed PAA questions so they aren't re-used in future content runs
    if (paaIds.length > 0) {
      await markPaaQuestionsAsUsed(paaIds);
      logger.info("[monthly.opportunity_content] PAA question marked as used");
    }
  }
}
