import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../db.js";

// ── SerpAPI helper ────────────────────────────────────────────────────
function getSerpKey(): string {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("Missing env var SERPAPI_KEY");
  return key;
}

async function serpFetch(keyword: string, location = "India"): Promise<any> {
  const apiKey = getSerpKey();
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(keyword)}&api_key=${apiKey}&location=${encodeURIComponent(location)}&gl=in&hl=en`;

  console.log(`[serp_fetch] Querying SerpAPI: "${keyword}"`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`SerpAPI error ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

async function getSiteDomain(siteId: number): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT domain FROM sites_config WHERE site_id = ? LIMIT 1",
    [siteId],
  );
  if (!rows.length) throw new Error(`No site found for site_id=${siteId}`);
  const domain = rows[0].domain as string;
  return domain.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
}

// ── Types ─────────────────────────────────────────────────────────────
export type SerpFeatureResult = {
  site_id: number;
  keyword: string;
  has_featured_snippet: boolean;
  featured_snippet_owner: string | null;
  we_own_featured_snippet: boolean;
  has_local_pack: boolean;
  we_are_in_local_pack: boolean;
  has_paa: boolean;
  paa_questions: string[];
  has_knowledge_panel: boolean;
  has_image_pack: boolean;
  our_organic_position: number | null;
};

export type FeatureOpportunity = {
  keyword: string;
  opportunity_type: "featured_snippet" | "local_pack" | "paa";
  competitor_owner: string | null;
  our_position: number | null;
  description: string;
};

// ── Tool: check_serp_features ─────────────────────────────────────────
export async function checkSerpFeatures(
  siteId: number,
  keyword: string,
): Promise<SerpFeatureResult> {
  const ourDomain = await getSiteDomain(siteId);
  const data = await serpFetch(keyword);

  // ── Featured snippet ──────────────────────────────────────────────
  const fs = data.featured_snippet;
  const hasFeaturedSnippet = Boolean(fs);
  const fsLink: string = fs?.link ?? fs?.source?.link ?? "";
  const featuredSnippetOwner = hasFeaturedSnippet
    ? fsLink.replace(/^https?:\/\//, "").split("/")[0].toLowerCase()
    : null;
  const weOwnFeaturedSnippet = featuredSnippetOwner
    ? featuredSnippetOwner.includes(ourDomain)
    : false;

  // ── Local pack ────────────────────────────────────────────────────
  const localResults = data.local_results?.places ?? data.local_results ?? [];
  const hasLocalPack = localResults.length > 0;
  const weAreInLocalPack = hasLocalPack
    ? localResults.some((r: any) => {
        const website: string = (r.website ?? "").toLowerCase();
        return website.includes(ourDomain);
      })
    : false;

  // ── PAA (People Also Ask) ─────────────────────────────────────────
  const relatedQuestions: Array<{ question?: string }> =
    data.related_questions ?? [];
  const hasPaa = relatedQuestions.length > 0;
  const paaQuestions = relatedQuestions.map((q) => q.question ?? "").filter(Boolean);

  // ── Knowledge panel ───────────────────────────────────────────────
  const hasKnowledgePanel = Boolean(data.knowledge_graph);

  // ── Image pack ────────────────────────────────────────────────────
  const hasImagePack =
    Boolean(data.images_results) ||
    (data.inline_images ?? []).length > 0;

  // ── Our organic position ──────────────────────────────────────────
  const organicResults: Array<{ link?: string; position?: number }> =
    data.organic_results ?? [];
  const ourResult = organicResults.find((r) =>
    (r.link ?? "").toLowerCase().includes(ourDomain),
  );
  const ourOrganicPosition = ourResult?.position ?? null;

  console.log(
    `[check_serp_features] keyword="${keyword}" fs=${hasFeaturedSnippet} lp=${hasLocalPack} paa=${hasPaa} our_pos=${ourOrganicPosition}`,
  );

  return {
    site_id: siteId,
    keyword,
    has_featured_snippet: hasFeaturedSnippet,
    featured_snippet_owner: featuredSnippetOwner,
    we_own_featured_snippet: weOwnFeaturedSnippet,
    has_local_pack: hasLocalPack,
    we_are_in_local_pack: weAreInLocalPack,
    has_paa: hasPaa,
    paa_questions: paaQuestions.slice(0, 5),
    has_knowledge_panel: hasKnowledgePanel,
    has_image_pack: hasImagePack,
    our_organic_position: ourOrganicPosition,
  };
}

// ── Tool: get_feature_opportunities ──────────────────────────────────
export async function getFeatureOpportunities(
  siteId: number,
): Promise<{
  site_id: number;
  keywords_checked: number;
  opportunities_count: number;
  opportunities: FeatureOpportunity[];
}> {
  console.log(
    `[get_feature_opportunities] Scanning SERP features for site_id=${siteId}...`,
  );

  // Fetch target keywords from DB (limit to top 10 to stay within SerpAPI quota)
  const [kwRows] = await pool.query<RowDataPacket[]>(
    "SELECT target_keywords FROM keywords_config WHERE site_id = ? LIMIT 1",
    [siteId],
  );

  if (!kwRows.length) {
    console.log(
      `[get_feature_opportunities] No keywords configured for site_id=${siteId}`,
    );
    return {
      site_id: siteId,
      keywords_checked: 0,
      opportunities_count: 0,
      opportunities: [],
    };
  }

  const allKeywords: string[] =
    typeof kwRows[0].target_keywords === "string"
      ? JSON.parse(kwRows[0].target_keywords)
      : (kwRows[0].target_keywords ?? []);

  // Check top 10 keywords only — SerpAPI costs credits per call
  const keywords = allKeywords.slice(0, 10);
  const opportunities: FeatureOpportunity[] = [];
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  for (const keyword of keywords) {
    try {
      const result = await checkSerpFeatures(siteId, keyword);

      // Opportunity: featured snippet exists, but not ours
      if (result.has_featured_snippet && !result.we_own_featured_snippet) {
        opportunities.push({
          keyword,
          opportunity_type: "featured_snippet",
          competitor_owner: result.featured_snippet_owner,
          our_position: result.our_organic_position,
          description: `"${result.featured_snippet_owner}" owns the featured snippet. We rank #${result.our_organic_position ?? "?"} organically.`,
        });
      }

      // Opportunity: local pack exists, but we're not in it
      if (result.has_local_pack && !result.we_are_in_local_pack) {
        opportunities.push({
          keyword,
          opportunity_type: "local_pack",
          competitor_owner: null,
          our_position: result.our_organic_position,
          description: `Local pack is present but our listing is not shown. Optimise Google Business Profile for "${keyword}".`,
        });
      }

      // Opportunity: PAA box present — rich content to target
      if (result.has_paa && result.paa_questions.length > 0) {
        opportunities.push({
          keyword,
          opportunity_type: "paa",
          competitor_owner: null,
          our_position: result.our_organic_position,
          description: `PAA box with ${result.paa_questions.length} question(s). Add FAQ content targeting: ${result.paa_questions.slice(0, 2).join("; ")}`,
        });
      }

      // Rate-limit: 1 call/sec to stay within SerpAPI limits
      await sleep(1100);
    } catch (err: any) {
      console.warn(
        `[get_feature_opportunities] Failed for keyword="${keyword}": ${err.message}`,
      );
    }
  }

  console.log(
    `[get_feature_opportunities] ${keywords.length} keywords checked, ${opportunities.length} opportunities found`,
  );

  return {
    site_id: siteId,
    keywords_checked: keywords.length,
    opportunities_count: opportunities.length,
    opportunities,
  };
}
