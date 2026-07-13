import * as dotenv from "dotenv";
import { logger } from "../utils/logger.js";

// Import controllers for database operations
import { listSitesConfigs } from "../controllers/sites.controller.js";
import { listCompetitorConfigs } from "../controllers/competitor.controller.js";

import { saveBacklinkReport } from "../services/seo-report.service.js";

// MCP Server Imports
import {
  getNewBacklinks,
  getLostBacklinks,
  getToxicLinks,
  getLinkVelocity,
} from "../mcp-servers/backlink-monitor/server.js";
import { findLinkProspects } from "../mcp-servers/backlink-engine/server.js";
import { postBacklinkDigestToSlack } from "../mcp-servers/reporting/server.js";

// ── Types ─────────────────────────────────────────────────────────────

interface SitesConfig {
  site_id: number;
  domain: string;
  brand_name: string;
  industry: string;
  cities: string[];
}

interface CompetitorsConfig {
  site_id: number;
  domain: string;
  competitors_domain: string[];
}

interface StepError {
  step1: string;
  step2: string;
}

// ── Config ────────────────────────────────────────────────────────────
dotenv.config();

const DRY_RUN = ["1", "true", "yes"].includes(
  (process.env.DRY_RUN || "false").toLowerCase(),
);

let sitesConfig: SitesConfig[] = [];
let sitesCompetitorsConfig: Record<string | number, CompetitorsConfig> = {};

// ── Step 1: Backlink monitor ──────────────────────────────────────────
async function backlinkMonitor(siteId: number) {
  logger.info(`[step1] Backlink health check for site_id=${siteId}...`);
  const [newLinks, lostLinks, toxicLinks, velocity] = await Promise.all([
    getNewBacklinks(siteId, 7),
    getLostBacklinks(siteId, 7),
    getToxicLinks(siteId),
    getLinkVelocity(siteId),
  ]);

  logger.info(
    `[step1] new=${newLinks?.count} lost=${lostLinks?.count} toxic=${toxicLinks?.count} trend=${velocity?.trend}`,
  );
  logger.info(`[step1] Done`);
  return { newLinks, lostLinks, toxicLinks, velocity };
}

// ── Step 2: Backlink engine — link prospects ──────────────────────────
async function linkProspects(siteId: number) {
  logger.info(`[step2] Finding link prospects for site_id=${siteId}...`);

  const site = sitesCompetitorsConfig[siteId];

  const prospects = await findLinkProspects(
    siteId,
    site?.domain as string,
    site?.competitors_domain.slice(0, 5) as string[],
  );

  logger.info(
    `[step2] ${prospects.count} prospect(s) found across ${prospects.competitors_checked.length} competitor(s)`,
  );
  logger.info(`[step2] Done`);
  return prospects;
}

// ── Summary Printer ───────────────────────────────────────────────────
function printSummary(errors: StepError, elapsed: number) {
  logger.info(
    `[weekly_backlink_monitor] Pipeline complete in ${elapsed.toFixed(1)}s`,
  );
  if (Object.keys(errors).length > 0) {
    for (const [step, msg] of Object.entries(errors)) {
      logger.error(`[weekly_backlink_monitor] ${step} failed`, msg);
    }
  } else {
    logger.info(`[weekly_backlink_monitor] All steps succeeded`);
  }
}

// ── Task methods ──────────────────────────────────────────────────────
async function runBacklinksTasks(siteId: number) {
  const startTime = Date.now();
  const errors = {} as StepError;

  logger.info(
    `[weekly_backlink_monitor] ══════════════════════════════════════════`,
  );
  logger.info(
    `[weekly_backlink_monitor] Starting weekly backlinks monitor pipeline — site_id=${siteId}`,
  );
  logger.info(
    `[weekly_backlink_monitor] ══════════════════════════════════════════`,
  );

  // ── Step 1: Backlink monitor ──────────────────────────────────────
  let backlinkData: any = null;
  try {
    backlinkData = await backlinkMonitor(siteId);
  } catch (exc: any) {
    errors.step1 = exc.message;
    logger.error(`[step1] ERROR: `, exc);
  }

  // ── Step 2: Link prospects ────────────────────────────────────────
  let prospectsData: any = null;
  try {
    prospectsData = await linkProspects(siteId);
  } catch (exc: any) {
    errors.step2 = exc.message;
    logger.error(`[step2] ERROR: `, exc);
  }

  // ── Step 3: Persist report to DB ─────────────────────────────────
  try {
    await saveBacklinkReport(siteId, backlinkData, prospectsData);
    logger.info(`[step3] Report saved to DB`);
  } catch (exc: any) {
    logger.error(`[step3] DB save ERROR: `, exc);
  }

  // ── Step 4: Backlink digest → Slack ───────────────────────────────
  if (!DRY_RUN) {
    logger.info(`[step4] Posting backlink digest for site_id=${siteId}...`);
    try {
      const site = sitesConfig.find((s) => s.site_id === siteId);
      await postBacklinkDigestToSlack(
        siteId,
        site?.domain ?? "",
        backlinkData,
        prospectsData,
      );
      logger.info(`[step4] Done`);
    } catch (exc: any) {
      logger.error(`[step4] ERROR: `, exc);
    }
  }
  let elapsedSeconds = (Date.now() - startTime) / 1000;

  elapsedSeconds = (Date.now() - startTime) / 1000;
  printSummary(errors, elapsedSeconds);
  logger.info(
    `[weekly_backlink_monitor] ══════════════════════════════════════════`,
  );
}

// ── Parent method ───────────────────────────────────────────────────
export async function weeklyBacklinksMonitorTasks() {
  logger.info(
    `[weekly_backlink_monitor] Fetching configuration from database...`,
  );

  // Fetch all configuration data from MySQL via controllers
  // Using a large limit to ensure all configs are loaded for the pipeline
  const [sitesRes, competitorsRes] = await Promise.all([
    listSitesConfigs({ limit: 1000 }),
    listCompetitorConfigs({ limit: 1000 }),
  ]);

  // 1. Populate Sites Configuration
  sitesConfig = sitesRes.sites;

  // 2. Populate Competitors Configuration (Mapped to site_id)
  sitesCompetitorsConfig = {};
  competitorsRes.competitors.forEach((config) => {
    sitesCompetitorsConfig[config.site_id] = {
      site_id: config.site_id,
      domain: config.domain || "", // Ensure domain exists if needed by the interface
      competitors_domain: config.competitor_domain,
    };
  });

  logger.info(
    `[weekly_backlink_monitor] Loaded ${sitesConfig.length} sites. Starting processing...`,
  );

  // Run pipeline for each configured site
  // for (const site of sitesConfig) {
  await runBacklinksTasks(1);
  // }
}
