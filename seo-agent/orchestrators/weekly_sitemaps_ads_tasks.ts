import * as dotenv from "dotenv";
import { logger } from "../utils/logger.js";

// Import controllers for database operations
import { listSitesConfigs } from "../controllers/sites.controller.js";

import { postSitemapAdsDigestToSlack } from "../mcp-servers/reporting/server.js";
import { saveSitemapAdsReport } from "../services/seo-report.service.js";
import {
  getSitemapStatus,
  detectNewPages,
  pingNewPages,
} from "../mcp-servers/page-sitemap/server.js";
import {
  getTopConvertingKeywords,
  getWastedSpend,
  getQualityScoreIssues,
} from "../mcp-servers/ads-bridge/server.js";

dotenv.config();

interface SitesConfig {
  site_id: number;
  domain: string;
  brand_name: string;
  industry: string;
  cities: string[];
}

interface StepError {
  step1: string;
  step2: string;
}

let sitesConfig: SitesConfig[] = [];

// ── Config ────────────────────────────────────────────────────────────
const DRY_RUN = ["1", "true", "yes"].includes(
  (process.env.DRY_RUN || "false").toLowerCase(),
);

// ── 1: Sitemap ping ──────────────────────────────────────────────
async function step1SitemapPing(siteId: number) {
  logger.info(
    `[step1] Sitemap status + new-page ping for site_id=${siteId}...`,
  );

  const status = await getSitemapStatus(siteId);
  logger.info(
    `[step1] GSC sitemaps=${status.gsc_sitemaps.length} coverage=${status.coverage_pct}% issues=${status.issues.length}`,
  );

  const detected = await detectNewPages(siteId);
  logger.info(
    `[step1] New pages in last 24h: ${detected.count} (${detected.already_pinged} already pinged)`,
  );

  let pingResult = null;
  if (detected.new_pages.length > 0) {
    const urls = detected.new_pages.map((p) => p.url);
    pingResult = await pingNewPages(siteId, urls);
    logger.info(
      `[step1] Pinged ${pingResult.success_count}/${pingResult.pinged.length} URL(s) to GSC+Bing`,
    );
  } else {
    logger.info(`[step1] No new pages to ping`);
  }

  logger.info(`[step1] Done`);
  return { status, detected, pingResult };
}

// ── Step 2: Ads insights (READ-ONLY) ─────────────────────────────────
async function step2AdsInsights(siteId: number) {
  logger.info(`[step2] Fetching Google Ads insights for site_id=${siteId}...`);

  const [topKeywords, wastedSpend, qualityIssues] = await Promise.all([
    getTopConvertingKeywords(siteId),
    getWastedSpend(siteId),
    getQualityScoreIssues(siteId),
  ]);

  logger.info(
    `[step2] Top converting keywords: ${topKeywords.keywords.length}, total conversions: ${topKeywords.total_conversions}`,
  );
  logger.info(
    `[step2] Wasted spend keywords: ${wastedSpend.keyword_count}, total wasted: ₹${wastedSpend.total_wasted_inr}`,
  );
  logger.info(
    `[step2] Quality score issues: ${qualityIssues.issues.length} (${qualityIssues.critical_count} critical, avg QS ${qualityIssues.avg_quality_score})`,
  );

  logger.info(`[step2] Done`);
  return { topKeywords, wastedSpend, qualityIssues };
}

// ── Summary Printer ───────────────────────────────────────────────────
function printSummary(errors: StepError, elapsed: number) {
  logger.info(`[weekly_site_ads] Pipeline complete in ${elapsed.toFixed(1)}s`);
  if (Object.keys(errors).length > 0) {
    for (const [step, msg] of Object.entries(errors)) {
      logger.error(`[weekly_site_ads] ${step} failed`, { message: msg });
    }
  } else {
    logger.info(`[weekly_site_ads] All steps succeeded`);
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────
async function runWeeklySitemapAdsTasks(siteId: number) {
  const startTime = Date.now();
  const errors = {} as StepError;

  logger.info(`[weekly_site_ads] ══════════════════════════════════════════`);
  logger.info(`[weekly_site_ads] Starting weekly Sitemaps-Ads pipeline — site_id=${siteId}`);
  logger.info(`[weekly_site_ads] ══════════════════════════════════════════`);

  // ── Step 1: Sitemap ping ──────────────────────────────────────────
  let sitemapData: any = null;
  try {
    sitemapData = await step1SitemapPing(siteId);
  } catch (exc: any) {
    errors.step1 = exc.message;
    logger.error(`[step1] ERROR: `, exc);
  }

  // ── Step 2: Ads insights (READ-ONLY) ─────────────────────────────
  let adsData: any = null;
  try {
    adsData = await step2AdsInsights(siteId);
  } catch (exc: any) {
    errors.step2 = exc.message;
    logger.error(`[step2] ERROR: `, exc);
  }

  // ── Step 3: Persist report to DB ─────────────────────────────────
  try {
    await saveSitemapAdsReport(siteId, sitemapData, adsData);
    logger.info(`[step3] Report saved to DB`);
  } catch (exc: any) {
    logger.error(`[step3] DB save ERROR: `, exc);
  }

  // ── Step 4: Sitemap & ads digest → Slack ──────────────────────────
  if (!DRY_RUN) {
    logger.info(`[step4] Posting sitemap & ads digest for site_id=${siteId}...`);
    try {
      const site = sitesConfig.find((s) => s.site_id === siteId);
      await postSitemapAdsDigestToSlack(
        siteId,
        site?.domain ?? "",
        sitemapData,
        adsData,
      );
      logger.info(`[step4] Done`);
    } catch (exc: any) {
      logger.error(`[step4] ERROR: `, exc);
    }
  }

  // ── Timeout check ─────────────────────────────────────────────────
  let elapsedSeconds = (Date.now() - startTime) / 1000;
  printSummary(errors, elapsedSeconds);
}

// ── Parent Method ─────────────────────────────────────────────────────
export async function weeklySitemapAdsTasks() {
  logger.info(`[weekly_site_ads] Fetching configuration from database...`);

  // Fetch all configuration data from MySQL via controllers
  // Using a large limit to ensure all configs are loaded for the pipeline
  const [sitesRes] = await Promise.all([
    listSitesConfigs({ limit: 1000 }),
  ]);

  // 1. Populate Sites Configuration
  sitesConfig = sitesRes.sites;

  logger.info(
    `[weekly_site_ads] Loaded ${sitesConfig.length} sites. Starting processing...`,
  );

  // Run pipeline for each configured site
  // for (const site of sitesConfig) {
  await runWeeklySitemapAdsTasks(1);
  // }
}
