import { getDomain } from "../../libs/functions";
import { logger } from "../utils/logger";

/**
 * DataForSEO APIs
 */

function dfsAuth(): string {
  const user = process.env.DATAFORSEO_USERNAME;
  const pass = process.env.DATAFORSEO_PASSWORD;
  if (!user || !pass)
    throw new Error("Missing DATAFORSEO_USERNAME or DATAFORSEO_PASSWORD");
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

function dfsBase(): string {
  return (
    process.env.DATAFORSEO_BASEURL ?? "https://api.dataforseo.com/v3"
  ).replace(/\/$/, "");
}

async function dfsPost<T = any>(endpoint: string, body: object[]): Promise<T> {
  const res = await fetch(`${dfsBase()}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: dfsAuth(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(
      `DataForSEO ${endpoint} error ${res.status}: ${msg.slice(0, 300)}`,
    );
  }
  return res.json() as Promise<T>;
}

export async function getCompetitorsKeywords(
  target_domain: string,
  competitor_domain: string,
) {
  const domain = getDomain(target_domain);
  const competitor = getDomain(competitor_domain);
  const competitor_initial = competitor.split(".")[0];

  const post_array = [
    {
      target1: competitor,
      target2: domain,
      language_name: "English",
      location_name: "India",
      intersection: false,
      order_by: ["first_domain_serp_element.rank_absolute,asc"],
      filters: [["keyword_data.keyword", "not_regex", competitor_initial]],
      limit: 5,
    },
  ];

  logger.info(
    "[dataForSEO.service] Calling DataForSEO API : Competitors keywords",
  );
  const response = await dfsPost(
    `/dataforseo_labs/google/domain_intersection/live`,
    post_array,
  );

  const keywords = response.tasks[0]?.result
    ? response.tasks[0]?.result[0]?.items?.map((item: any) => ({
        keyword: item.keyword_data.keyword,
        search_volume: item.keyword_data.keyword_info.search_volume,
        competitor_position: item.first_domain_serp_element.rank_absolute,
      })) || []
    : [];
  return keywords;
}

export async function getSitesBacklinks(post_body: Record<string, any>) {
  const post_array = [post_body];

  logger.info("[dataForSEO.service] Calling DataForSEO API : Sites Backlinks");
  const response = await dfsPost(`/backlinks/backlinks/live`, post_array);

  const results = response.tasks[0]?.result
    ? response.tasks[0]?.result[0]?.items || []
    : [];
  return results;
}

export async function getKeywordsSuggestions(
  domain: string,
  keywords?: string,
) {
  const post_array = [
    {
      target: domain,
      language_name: "English",
      location_name: "India",
      include_subdomains: false,
      //   order_by: ["keyword_info.search_volume,desc"],
      limit: 100,
    },
  ];

  logger.info(
    "[dataForSEO.service] Calling DataForSEO API : Keywords Suggestions",
  );
  const response = await dfsPost(
    "/dataforseo_labs/google/keywords_for_site/live",
    post_array,
  );

  const suggestions = response.tasks[0]?.result
    ? response.tasks[0]?.result[0]?.items || []
    : [];
  return suggestions;
}

// ── PAA via SERP organic live/advanced ───────────────────────────────
// Returns PAA questions (and answer snippet when available) for a keyword.

export interface PaaResult {
  question: string;
  answer: string | null;
  source_url: string | null;
}

export async function getPaaQuestions(keyword: string): Promise<PaaResult[]> {
  const post_array = [
    {
      keyword,
      language_name: "English",
      location_name: "India",
      device: "desktop",
      os: "windows",
      depth: 10,
    },
  ];

  logger.info(
    `[dataForSEO.service] Calling DataForSEO API : PAA for "${keyword}"`,
  );

  const response = await dfsPost(
    "/serp/google/organic/live/advanced",
    post_array,
  );

  const items: any[] = response.tasks?.[0]?.result?.[0]?.items ?? [];

  // DataForSEO groups PAA as a single item with type "people_also_ask"
  // whose own .items[] are the individual question elements.
  const paaBlock = items.find((item: any) => item.type === "people_also_ask");
  if (!paaBlock?.items?.length) return [];

  return (paaBlock.items as any[])
    .map((el: any) => {
      // Answer snippet lives inside expanded_element[0]
      const expanded = el.expanded_element?.[0];
      return {
        question: el.title ?? el.question ?? "",
        answer: expanded?.description ?? expanded?.text ?? null,
        source_url: expanded?.url ?? null,
      };
    })
    .filter((r: PaaResult) => !!r.question);
}

export async function getKeywordsOverview(keywords: string[]) {
  const post_array = [
    {
      language_name: "English",
      location_name: "India",
      include_serp_info: true,
      keywords,
    },
  ];

  logger.info(
    "[dataForSEO.service] Calling DataForSEO API : Keywords Overview",
  );
  const response = await dfsPost(
    "/dataforseo_labs/google/keyword_overview/live",
    post_array,
  );

  const overview = response.tasks[0]?.result
    ? response.tasks[0]?.result[0]?.items || []
    : [];
  return overview;
}

export async function getBacklinkOverview(url: string) {
  const post_array = [
    {
      target: getDomain(url),
      internal_list_limit: 10,
      include_subdomains: true,
      backlinks_status_type: "live",
    },
  ];

  const response = await dfsPost("/backlinks/summary/live", post_array);

  const result = response.data.tasks[0].result[0];

  return {
    total_backlinks: result.backlinks,
    broken_backlinks: result.broken_backlinks,
    referring_domains: result.referring_domains,
  };
}

export async function getCompetitorBacklinksDomain(
  myURL: string,
  competitorsURL: string[],
) {
  const excludeTargets = getDomain(myURL);
  const targets = competitorsURL.reduce((acc: any, cur, idx) => {
    acc[idx + 1] = getDomain(cur);
    return acc;
  }, {});

  const response = await dfsPost("/backlinks/domain_intersection/live", [
    {
      targets,
      exclude_targets: [excludeTargets],
      intersection_mode: "partial",
      backlinks_filters: [
        ["domain_from_rank", ">", 0],
        "and",
        ["backlink_spam_score", "<", 50],
      ],
      limit: 20,
    },
  ]);

  const items: any[] = response?.tasks?.[0]?.result?.[0]?.items ?? null;

  return items;
}

export async function getBacklinksTimeSeries(
  domain: string,
  dateRange: { dateFrom: string; dateTo: string },
) {
  const response = await dfsPost(
    "/backlinks/timeseries_new_lost_summary/live",
    [
      {
        target: domain,
        date_from: dateRange.dateFrom,
        date_to: dateRange.dateTo,
        group_range: "day",
      },
    ],
  );

  const items = response?.tasks?.[0]?.result?.[0]?.items ?? null;
  return items;
}

export async function getSpamScoreOfDomains(domains: string[]) {
  const response = await dfsPost("/backlinks/bulk_spam_score/live", [
    {
      targets: domains,
    },
  ]);

  const items = response?.tasks?.[0]?.result?.[0]?.items ?? null;
  return items;
}
