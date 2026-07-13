import fs from "node:fs";
import {
  getCompetitorsKeywords,
  getSitesBacklinks,
} from "../../services/dataForSEO.service.js";
import { logger } from "../../utils/logger.js";

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

// ── Tool: get_competitor_backlinks ────────────────────────────────────
export type CompetitorsBacklink = {
  url_from: string;
  url_to: string;
  domain_from_rank: number;
  domain_to_rank: number;
  anchor: string;
};

export async function getCompetitorBacklinks(
  siteId: number,
  competitorDomain: string,
): Promise<{
  site_id: number;
  competitor_domain: string;
  backlinks_count: number;
  backlinks: CompetitorsBacklink[];
  cached: boolean;
}> {
  const cached = readCache(competitorDomain, "backlinks");
  if (cached) {
    const data = cached as CompetitorsBacklink[];
    return {
      site_id: siteId,
      competitor_domain: competitorDomain,
      backlinks_count: data.length,
      backlinks: data,
      cached: true,
    };
  }

  const results = await getSitesBacklinks(competitorDomain);

  const backlinks = results.map((item: any) => ({
    url_from: item.url_from,
    url_to: item.url_to,
    anchor: item.anchor,
    domain_from_rank: item.domain_from_rank,
    domain_to_rank: item.rank,
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
  const gaps = await getCompetitorsKeywords(siteUrl, competitorDomain);

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

  logger.info("========== Keywords Gap Competitor Domain **********");
  for (let domain of competitorDomains) {
    const res = await getCompetitorsKeywords(siteUrl, domain);
    keywordGaps.push({ site_id: siteId, competitor_domain: domain, gaps: res });
  }
  logger.info(
    `========== Keywords Gap Competitor Domain ********** ${keywordGaps.length}`,
  );
  return keywordGaps;
};

const getContentsGapForCompetitorDomain = async (
  siteId: number,
  siteUrl: string,
  competitorDomains: string[],
) => {
  const contentGaps = [] as any[];

  logger.info("========== Contents Gap Competitor Domain **********");
  for (let domain of competitorDomains) {
    const res = await getContentGaps(siteId, siteUrl, domain);
    contentGaps.push(res);
  }
  logger.info(
    `========== Contents Gap Competitor Domain ********** ${contentGaps.length}`,
  );
  return contentGaps;
};

const getBacklinksForCompetitorDomain = async (
  siteId: number,
  competitorDomains: string[],
) => {
  const backlinks = [] as any[];
  logger.info("========== Backlinks Competitor Domain **********");
  for (let domain of competitorDomains) {
    const res = await getCompetitorBacklinks(siteId, domain);
    backlinks.push(res);
  }
  logger.info(
    `========== Backlinks Competitor Domain ********** ${backlinks.length}`,
  );
  return backlinks;
};

export {
  getKeywordsGapForCompetitorDomain,
  getContentsGapForCompetitorDomain,
  getBacklinksForCompetitorDomain,
};
