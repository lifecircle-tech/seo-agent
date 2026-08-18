import { logger } from "../utils/logger.js";

import {
  getSiteAndCitiesBySiteID,
  listSitesConfigs,
} from "../controllers/sites.controller.js";
import {
  getResolvedIndexedAlert,
  updateAlertsStatusToClosed,
} from "../controllers/alerts.controller.js";
import { checkIndexedStatus } from "../mcp-servers/technical-seo/server.js";
import { discoverSiteKeywords } from "../mcp-servers/keyword-researcher/server.js";
import { upsertKeywords } from "../controllers/keywords.controller.js";
import { randomUUID } from "crypto";

export async function checkIndexingRequestUpdate() {
  const { sites } = await listSitesConfigs({});
  const inspectedResults: Record<string, any> = {
    count: 0,
    urls: [],
  };

  for (const site of sites) {
    const requested_index = await getResolvedIndexedAlert(site.site_id);

    try {
      const requested_urls = requested_index.map((item) => item.details.url);
      const inspected_results = await checkIndexedStatus(
        site.domain,
        requested_urls,
      );

      inspectedResults.count += inspected_results.indexed_count;
      inspectedResults.urls.push(...inspected_results.indexed_urls);
    } catch (error) {
      logger.error(
        `Error checking indexing for site ID ${site.site_id}:`,
        error,
      );
    }

    try {
      const alert_ids = requested_index
        .filter((alert) => inspectedResults.urls.includes(alert.details.url))
        .map((a) => a.id);

      await updateAlertsStatusToClosed(alert_ids);
    } catch (err: any) {
      logger.error(`Error updating indexed urls ${err.message}`, err);
    }
  }

  return inspectedResults;
}

export async function discoverNewKeywordsForSite(siteId: number) {
  if (!siteId) {
    throw new Error("Site ID is required to discover new keywords.");
  }

  let site = await getSiteAndCitiesBySiteID(siteId);
  site = { ...site, cities: site.cities.split(",") };

  console.log("SITES ", site);
  const rawKeywords = await discoverSiteKeywords(site.domain);

  const pages = new Map();

  rawKeywords.map((item) => {
    if (pages.has(item.keyword)) {
      if (item.page) {
        pages.set(item.keyword, [...pages.get(item.keyword), item.page]);
      }
    } else {
      if (item.page) {
        pages.set(item.keyword, [item.page]);
      }
    }
  });

  logger.debug("PAGES ", [...pages]);

  if (rawKeywords.length > 0) {
    try {
      await upsertKeywords(
        rawKeywords.map((k) => ({
          id: randomUUID(),
          site_id: site.site_id,
          keyword: k.keyword,
          is_new: pages.get(k.keyword) ? false : true,
          search_volume: k.volume ?? null,
          difficulty: k.difficulty ?? null,
          position: k.current_position ?? null,
          clicks: k.clicks,
          impressions: k.impressions,
          ctr: k.ctr,
          cpc: k.cpc,
          competition: k.competition ?? null,
          competition_level: k.competition_level ?? null,
          monthly_searches: k.monthly_searches || null,
        })),
      );
      logger.info(`[city] Persisted ${rawKeywords.length} keywords to DB`);
    } catch (err) {
      logger.error(`[city] Failed to persist keywords:`, err);
    }
  }
}
