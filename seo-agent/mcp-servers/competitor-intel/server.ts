import fs from "node:fs";
import { getSearchConsoleClient } from "../../../libs/google.js";

// ── Rate-limit delay ──────────────────────────────────────────────────
const AHREFS_DELAY_MS = Number(process.env.AHREFS_DELAY_MS ?? 1500);

export async function ahrefsDelay() {
  if (AHREFS_DELAY_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, AHREFS_DELAY_MS));
  }
}

// ── 24-hour JSON cache ────────────────────────────────────────────────
const CACHE_DIR = "/tmp/cache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getCachePath(domain: string, type: string): string {
  const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `${CACHE_DIR}/${safeDomain}_${type}.json`;
}

export function readCache(domain: string, type: string): unknown | null {
  const path = getCachePath(domain, type);
  try {
    if (!fs.existsSync(path)) return null;
    const raw = fs.readFileSync(path, "utf-8");
    const cached = JSON.parse(raw);
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null;
    return cached.data;
  } catch {
    return null;
  }
}

export function writeCache(domain: string, type: string, data: unknown): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const path = getCachePath(domain, type);
  fs.writeFileSync(path, JSON.stringify({ timestamp: Date.now(), data }));
}

// ── Ahrefs API helper ─────────────────────────────────────────────────
function getAhrefsKey() {
  const key = process.env.AHREFS_KEY;
  if (!key) throw new Error("Missing env var AHREFS_KEY");
  return key;
}

export async function ahrefsFetch(
  endpoint: string,
  params: Record<string, string>,
): Promise<unknown> {
  const key = getAhrefsKey();
  const url = new URL(`https://api.ahrefs.com/v3${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Ahrefs API error ${res.status}: ${msg}`);
  }
  return res.json();
}

// ── Tool: get_competitor_keywords ────────────────────────────────────
export type AhrefsKeyword = {
  keyword: string;
  position: number;
  volume: number;
  traffic: number;
};

export async function getCompetitorKeywords(
  siteId: number,
  competitorDomain: string,
): Promise<{
  site_id: number;
  competitor_domain: string;
  keywords_count: number;
  keywords: AhrefsKeyword[];
  cached: boolean;
}> {
  const cached = readCache(competitorDomain, "keywords");
  if (cached) {
    const data = cached as AhrefsKeyword[];
    return {
      site_id: siteId,
      competitor_domain: competitorDomain,
      keywords_count: data.length,
      keywords: data,
      cached: true,
    };
  }

  await ahrefsDelay();

  console.log("========== Calling Ahrefs API **********");
  const raw = (await ahrefsFetch("/site-explorer/organic-keywords", {
    target: competitorDomain,
    limit: "10",
    mode: "domain",
    output: "json",
    date: new Date().toISOString().split("T")[0], // Use current date for freshest data
    select: "keyword,best_position,sum_traffic,volume",
  })) as {
    keywords?: Array<{
      keyword: string;
      best_position?: number;
      volume?: number;
      sum_traffic?: number;
    }>;
  };

  const keywords = (raw.keywords ?? []).map((k) => ({
    keyword: k.keyword,
    position: k.best_position ?? 0,
    volume: k.volume ?? 0,
    traffic: k.sum_traffic ?? 0,
  }));
  console.log("========== Ahrefs Keywords Retrieved **********");

  writeCache(competitorDomain, "keywords", keywords);

  return {
    site_id: siteId,
    competitor_domain: competitorDomain,
    keywords_count: keywords.length,
    keywords,
    cached: false,
  };
}

// ── Tool: get_keyword_gaps ────────────────────────────────────────────
export type KeywordGap = {
  keyword: string;
  competitor_position: number;
  competitor_volume: number;
};

export async function getKeywordGaps(
  siteId: number,
  siteUrl: string,
  competitorDomain: string,
): Promise<{
  site_id: number;
  competitor_domain: string;
  site_keywords_count: number;
  competitor_keywords_count: number;
  gap_count: number;
  gaps: KeywordGap[];
}> {
  // Fetch site's own keywords via GSC
  console.log("========== Keywords Gap GSC Auth **********");
  const searchConsole = getSearchConsoleClient();
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 28);
  const fmtDate = (d: Date) => d.toISOString().split("T")[0];

  console.log("========== Keywords Gap GSC Search Console **********");
  const gscResponse = await searchConsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: fmtDate(start),
      endDate: fmtDate(end),
      dimensions: ["query"],
      rowLimit: 1000,
    },
  });

  const siteKeywords = new Set<string>(
    (gscResponse.data.rows ?? []).map((r) => (r.keys?.[0] ?? "").toLowerCase()),
  );

  console.log("========== Keywords Gap Competitor Keywords **********");
  // Fetch competitor keywords (with cache)
  const compResult = await getCompetitorKeywords(siteId, competitorDomain);
  const competitorKeywords = compResult.keywords;

  // Find gaps: keywords competitor ranks for that site does NOT rank for
  const gaps = competitorKeywords
    .filter((k) => !siteKeywords.has(k.keyword.toLowerCase()))
    .map((k) => ({
      keyword: k.keyword,
      competitor_position: k.position,
      competitor_volume: k.volume,
    }))
    .sort((a, b) => b.competitor_volume - a.competitor_volume);

  return {
    site_id: siteId,
    competitor_domain: competitorDomain,
    site_keywords_count: siteKeywords.size,
    competitor_keywords_count: competitorKeywords.length,
    gap_count: gaps.length,
    gaps,
  };
}

// ── Tool: get_competitor_backlinks ────────────────────────────────────
export type AhrefsBacklink = {
  url_from: string;
  url_to: string;
  domain_rating_source: number;
  domain_rating_target: number;
  anchor: string;
};

export async function getCompetitorBacklinks(
  siteId: number,
  competitorDomain: string,
): Promise<{
  site_id: number;
  competitor_domain: string;
  backlinks_count: number;
  backlinks: AhrefsBacklink[];
  cached: boolean;
}> {
  const cached = readCache(competitorDomain, "backlinks");
  if (cached) {
    const data = cached as AhrefsBacklink[];
    return {
      site_id: siteId,
      competitor_domain: competitorDomain,
      backlinks_count: data.length,
      backlinks: data,
      cached: true,
    };
  }

  await ahrefsDelay();

  const raw = (await ahrefsFetch("/site-explorer/all-backlinks", {
    target: competitorDomain,
    limit: "10",
    mode: "domain",
    output: "json",
    select: "anchor,url_from,url_to,domain_rating_source,domain_rating_target",
  })) as {
    backlinks?: Array<{
      url_from?: string;
      url_to?: string;
      anchor?: string;
      domain_rating_source?: number;
      domain_rating_target?: number;
    }>;
  };

  const backlinks = (raw.backlinks ?? []).map((b) => ({
    url_from: b.url_from ?? "",
    url_to: b.url_to ?? "",
    domain_rating_source: b.domain_rating_source ?? 0,
    domain_rating_target: b.domain_rating_target ?? 0,
    anchor: b.anchor ?? "",
  }));

  writeCache(competitorDomain, "backlinks", backlinks);

  return {
    site_id: siteId,
    competitor_domain: competitorDomain,
    backlinks_count: backlinks.length,
    backlinks,
    cached: false,
  };
}

// ── Tool: get_content_gaps ────────────────────────────────────────────

// Common words to skip when detecting topic from keyword
const STOP_WORDS = new Set([
  "how",
  "what",
  "why",
  "when",
  "where",
  "who",
  "which",
  "best",
  "top",
  "a",
  "an",
  "the",
  "to",
  "for",
  "in",
  "of",
  "is",
  "are",
]);

function extractTopic(keyword: string): string {
  const words = keyword.toLowerCase().split(/\s+/);
  for (const word of words) {
    if (!STOP_WORDS.has(word) && word.length > 2) return word;
  }
  return words[0] ?? keyword;
}

export async function getContentGaps(
  siteId: number,
  siteUrl: string,
  competitorDomain: string,
): Promise<{
  site_id: number;
  competitor_domain: string;
  topic_groups_count: number;
  topic_groups: Array<{
    topic: string;
    keywords: string[];
    keyword_count: number;
    avg_volume: number;
  }>;
}> {
  const gapResult = await getKeywordGaps(siteId, siteUrl, competitorDomain);
  const gaps = gapResult.gaps;

  // Cluster by first meaningful word
  const groupMap = new Map();
  for (const gap of gaps) {
    const topic = extractTopic(gap.keyword);
    if (!groupMap.has(topic)) {
      groupMap.set(topic, { keywords: [], total_volume: 0 });
    }
    const group = groupMap.get(topic);
    group.keywords.push(gap.keyword);
    group.total_volume += gap.competitor_volume;
  }

  const topic_groups = [...groupMap.entries()]
    .map(([topic, { keywords, total_volume }]) => ({
      topic,
      keywords,
      keyword_count: keywords.length,
      avg_volume:
        keywords.length > 0 ? Math.round(total_volume / keywords.length) : 0,
    }))
    .sort((a, b) => b.avg_volume - a.avg_volume);

  return {
    site_id: siteId,
    competitor_domain: competitorDomain,
    topic_groups_count: topic_groups.length,
    topic_groups,
  };
}

const getKeywordsGapForCompetitorDomain = async (
  siteId: number,
  siteUrl: string,
  competitorDomains: string[],
) => {
  const keywordGaps = [] as any[];
  for (let domain in competitorDomains) {
    const res = await getKeywordGaps(siteId, siteUrl, domain);
    keywordGaps.push(res);
  }
  return keywordGaps;
};

const getContentsGapForCompetitorDomain = async (
  siteId: number,
  siteUrl: string,
  competitorDomains: string[],
) => {
  const contentGaps = [] as any[];
  for (let domain in competitorDomains){
    const res = await getContentGaps(siteId, siteUrl, domain);
    contentGaps.push(res);
  }
  return contentGaps;
};

const getBacklinksForCompetitorDomain = async (
  siteId: number,
  competitorDomains: string[],
) => {
  const backlinks = [] as any[];
  for (let domain in competitorDomains) {
    const res = await getCompetitorBacklinks(siteId, domain);
    backlinks.push(res);
  }
  return backlinks;
};

export {
  getKeywordsGapForCompetitorDomain,
  getContentsGapForCompetitorDomain,
  getBacklinksForCompetitorDomain,
};
