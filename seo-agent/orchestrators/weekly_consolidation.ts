/**
 * Weekly: turn keyword cannibalisation into merge suggestions.
 *
 * When 3+ of our pages get impressions for the same keyword, Google splits ranking
 * signals between them and none ranks well. Instead of generating more pages, create a
 * "consolidate_pages" opportunity for a person (the digital marketing executive):
 * keep the strongest page, merge the useful content of the others into it and 301 them.
 *
 * These opportunities are NOT executed by the agent — they need human judgement and a
 * redirect on WordPress. They appear in Marketing → SEO → Opportunities.
 */

import { randomUUID } from "node:crypto";
import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";
import { logger } from "../utils/logger.js";
import { listSitesConfigs } from "../controllers/sites.controller.js";
import { createOpportunity } from "../controllers/opportunities.controller.js";
import { findCannibalisedKeywords } from "../services/seo-guards.service.js";

const MIN_COMPETING_PAGES = 3;
const KEYWORDS_PER_RUN = 10;
/** Don't suggest the same keyword again within this window (any status). */
const DEDUPE_DAYS = 90;

async function alreadySuggested(siteId: number, keyword: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM opportunities
     WHERE site_id = ? AND opportunity_type = 'consolidate_pages'
       AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(opportunity_details, '$.keyword'))) = ?
       AND created_at >= NOW() - INTERVAL ? DAY
     LIMIT 1`,
    [siteId, keyword.toLowerCase(), DEDUPE_DAYS],
  );
  return rows.length > 0;
}

export async function weeklyConsolidationSuggestions(): Promise<void> {
  const { sites } = await listSitesConfigs({ limit: 1000 });

  for (const site of sites) {
    try {
      const candidates = await findCannibalisedKeywords(site.site_id, MIN_COMPETING_PAGES, KEYWORDS_PER_RUN * 3);
      let created = 0;

      for (const c of candidates) {
        if (created >= KEYWORDS_PER_RUN) break;
        if (await alreadySuggested(site.site_id, c.keyword)) continue;

        const [primary, ...others] = c.pages; // strongest first (most impressions)
        const totalImpressions = c.pages.reduce((s, p) => s + p.impressions, 0);

        await createOpportunity({
          id: randomUUID(),
          site_id: site.site_id,
          opportunity_type: "consolidate_pages",
          priority: totalImpressions >= 300 ? "1" : "2",
          topic: `Merge ${c.pages.length} pages competing for "${c.keyword}"`,
          description:
            `${c.pages.length} of our pages compete for "${c.keyword}". Keep ${primary.url} ` +
            `(most impressions). For each other page: move any unique, useful content into the kept page, ` +
            `then 301-redirect it there and update internal links. If a page serves a genuinely different ` +
            `service or locality, retarget it to that instead of redirecting.`,
          reasoning:
            `Split signals: impressions for this keyword are spread across ${c.pages.length} pages ` +
            `(${totalImpressions} in total over 28 days), so none of them ranks as well as one strong page would.`,
          opportunity_details: {
            keyword: c.keyword,
            target_keywords: [c.keyword],
            search_volume: c.search_volume,
            recommended_primary_url: primary.url,
            competing_urls: others.map((p) => p.url),
            pages: c.pages,
          },
        } as any);
        created++;
      }

      logger.info(`[weekly_consolidation] site ${site.site_id}: ${created} merge suggestion(s) created`);
    } catch (err: any) {
      logger.error(`[weekly_consolidation] site ${site.site_id} failed: ${err.message}`, err);
    }
  }
}
