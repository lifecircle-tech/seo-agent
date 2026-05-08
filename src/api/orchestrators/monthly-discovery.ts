import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import { getSheetsClient, getSpreadsheetId } from "../libs/google.js";
import {
  discoverCityKeywords,
  getKeywordClusters,
  prioritiseKeywords,
  writeKeywordMatrix,
  KeywordOpportunity,
} from "../mcp-servers/keyword-researcher/server.js";
import { postMonthlyDiscoveryToSlack } from "../mcp-servers/reporting/server.js";

dotenv.config();

interface SiteDiscoveryConfig {
  siteId: number;
  domain: string;
  brandName: string;
  industry: string;
  cities: string[];
}

interface ContentOpportunity {
  title: string;
  topic: string;
  target_keywords: string[];
  reasoning: string;
  priority: "High" | "Medium" | "Low";
}

// ── Config & Helpers ──────────────────────────────────────────────────
const DRY_RUN = ["1", "true", "yes"].includes(
  (process.env.DRY_RUN || "false").toLowerCase(),
);

function extractJson(text: string) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

/**
 * Appends content opportunities to the "Content Calendar" tab
 */
async function writeToContentCalendar(
  siteId: number,
  city: string,
  opportunities: ContentOpportunity[],
) {
  console.log(`  [city] Writing contents to Sheets...`);
  const sheets = getSheetsClient(siteId);
  const spreadsheetId = getSpreadsheetId();
  const timestamp = new Date().toISOString().split("T")[0];

  const rows = opportunities.map((opp) => [
    timestamp,
    siteId,
    city,
    opp.title,
    opp.topic,
    opp.target_keywords.join(", "),
    opp.priority,
    opp.reasoning,
    "Planned", // Status
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Content Calendar!A:I",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });
}

/**
 * Uses Claude to identify content strategies based on keyword data
 */
async function analyzeWithClaude(
  client: Anthropic,
  site: SiteDiscoveryConfig,
  city: string,
  keywords: KeywordOpportunity[],
) {
  const prompt = `You are a world-class SEO strategist.
Analyze these prioritized keywords for ${site.brandName} (${site.industry}) in ${city}.

Data:
${JSON.stringify(keywords.slice(0, 30), null, 2)}

Task:
Identify the top 10 content opportunities (blog posts, landing pages, or local guides).
Return ONLY a JSON object with an "opportunities" array.
Each object MUST have: "title", "topic", "target_keywords" (array), "reasoning", "priority" ("High"|"Medium"|"Low").
`;

  const response = await client.messages.create({
    // model: "claude-3-5-sonnet-20241022",
    model: "claude-sonnet-4-5",
    max_tokens: 5000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = extractJson(text);
  if (!parsed) {
    console.error(
      `[city] Warning: could not parse JSON from response. Raw: ${text.substring(0, 200)}`,
    );
    return [];
  }

  console.log(`[city] Claude analysis complete`);
  return parsed || [];
}

/**
 * Main Discovery Pipeline
 */
async function runMonthlyDiscovery() {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const startTime = Date.now();

  const sheets = getSheetsClient(1);
  const spreadsheetId = getSpreadsheetId();
  
  console.log(`[monthly-discovery] ══════════════════════════════════════════`);
  console.log(`[monthly-discovery] Starting Monthly Discovery...`);
  console.log(`[monthly-discovery] DRY_RUN=${DRY_RUN}`);
  console.log(`[monthly-discovery] ══════════════════════════════════════════`);

  // 1. Fetch Config
  const configRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Sites Config'!A:E",
  });

  // Get row from Google sheet and structure it
  const rows = configRes.data.values?.slice(1) || [];
  const sites: SiteDiscoveryConfig[] = rows.map((r) => ({
    siteId: Number(r[0]),
    domain: r[1],
    brandName: r[2],
    industry: r[3],
    cities: r[4]?.split(",").map((c: string) => c.trim()) || [],
  }));

  const overallSummary: string[] = [];

  // 2. Loop Sites and Cities
  const site = sites[0];
  for (const site of sites) {
    console.log(`\n[site] ${site.domain} (${site.brandName})`);
    let siteKeywordsTotal = 0;
    let siteOpportunitiesTotal = 0;

    const cities = site.cities;
    for (const city of cities) {
      try {
        console.log(`  [city] Researching: ${city}...`);

        // Call keyword-researcher MCP logic
        const rawKeywords = await discoverCityKeywords(
          site.siteId,
          city,
          site.industry,
        );
        const clustered = getKeywordClusters(rawKeywords);
        const prioritised = prioritiseKeywords(clustered);

        siteKeywordsTotal += prioritised.length;

        if (!DRY_RUN) {
          // Write to Keywords Matrix
          await writeKeywordMatrix(site.siteId, city, prioritised);

          // AI Analysis
          const { opportunities } = await analyzeWithClaude(
            anthropic,
            site,
            city,
            prioritised,
          );
          siteOpportunitiesTotal += opportunities.length;

          if (opportunities.length > 0) {
            await writeToContentCalendar(site.siteId, city, opportunities);
          }
        }
      } catch (err: any) {
        console.error(`  [error] Failed discovery for ${city}: ${err.message}`);
      }
    }

    const siteReport = `${site.brandName}: Discovered ${siteKeywordsTotal} keywords across ${site.cities.length} cities. Created ${siteOpportunitiesTotal} content ideas.`;
    overallSummary.push(siteReport);
    console.log(
      `[monthly-discovery] All Cities for site_id ${site.siteId} Finished`,
    );
  }

  // 3. Post to Slack
  if (!DRY_RUN) {
    console.log("Summary ", overallSummary);

    await postMonthlyDiscoveryToSlack(site.siteId, {
      summary: overallSummary,
    });
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`[monthly-discovery] ══════════════════════════════════════════`);
  console.log(`[monthly-discovery] Finished in ${elapsed.toFixed(1)}s`);
  console.log(`[monthly-discovery] All Sites Finished`);
  console.log(`[monthly-discovery] ══════════════════════════════════════════`);
}

export async function monthlyDiscovery() {
  runMonthlyDiscovery().catch(console.error);
}

// Execute
// if (import.meta.url === `file://${process.argv[1]}`) {
//   runMonthlyDiscovery().catch(console.error);
// }
