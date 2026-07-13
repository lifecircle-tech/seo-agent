import { getDomain } from "../../libs/functions";
import { logger } from "../utils/logger";

const dataForSEO_URL = process.env.DATAFORSEO_BASEURL;
const dataForSEO_USERNAME = process.env.DATAFORSEO_USERNAME;
const dataForSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;

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
  const resp = await fetch(
    `${dataForSEO_URL}/dataforseo_labs/google/domain_intersection/live`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(`${dataForSEO_USERNAME}:${dataForSEO_PASSWORD}`)}`,
      },
      body: JSON.stringify(post_array),
    },
  );

  const data = await resp.json();
  const keywords = data.tasks[0]?.result
    ? data.tasks[0]?.result[0]?.items?.map((item: any) => ({
        keyword: item.keyword_data.keyword,
        search_volume: item.keyword_data.keyword_info.search_volume,
        competitor_position: item.first_domain_serp_element.rank_absolute,
      })) || []
    : [];
  return keywords;
}

export async function getSitesBacklinks(domain: string) {
  const post_array = [
    {
      target: getDomain(domain),
      order_by: ["domain_from_rank,asc", "rank,asc"],
      filters: [["domain_from_rank", ">", 0], "and", ["rank", ">", 0]],
      limit: 5,
    },
  ];
  
  logger.info("[dataForSEO.service] Calling DataForSEO API : Sites Backlinks");
  const resp = await fetch(`${dataForSEO_URL}/backlinks/backlinks/live`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${dataForSEO_USERNAME}:${dataForSEO_PASSWORD}`)}`,
    },
    body: JSON.stringify(post_array),
  });
  const data = await resp.json();
  const results = data.tasks[0]?.result
    ? data.tasks[0]?.result[0]?.items || []
    : [];
  return results;
}

export async function getKeywordsSuggestions(keywords: string) {
  const post_array = [
    {
      keyword: keywords,
      language_name: "English",
      location_name: "India",
      limit: 20,
    },
  ];

  logger.info(
    "[dataForSEO.service] Calling DataForSEO API : Keywords Suggestions",
  );
  const resp = await fetch(
    `${dataForSEO_URL}/dataforseo_labs/google/keyword_suggestions/live`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(`${dataForSEO_USERNAME}:${dataForSEO_PASSWORD}`)}`,
      },
      body: JSON.stringify(post_array),
    },
  );

  const data = await resp.json();
  const suggestions = data.tasks[0]?.result
    ? data.tasks[0]?.result[0]?.items || []
    : [];
  return suggestions;
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

  logger.info("[dataForSEO.service] Calling DataForSEO API : Keywords Overview");
  const resp = await fetch(
    `${dataForSEO_URL}/dataforseo_labs/google/keyword_overview/live`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(`${dataForSEO_USERNAME}:${dataForSEO_PASSWORD}`)}`,
      },
      body: JSON.stringify(post_array),
    },
  );

  const data = await resp.json();
  const overview = data.tasks[0]?.result
    ? data.tasks[0]?.result[0]?.items || []
    : [];
  return overview;
}
