import * as dotenv from "dotenv";

// Import controllers for database operations
import { listSitesConfigs } from "../controllers/sites.controller.js";
import { listCompetitorConfigs } from "../controllers/competitor.controller.js";

import {
  getNewBacklinks,
  getLostBacklinks,
  getToxicLinks,
  getLinkVelocity,
} from "../mcp-servers/backlink-monitor/server.js";
import { findLinkProspects } from "../mcp-servers/backlink-engine/server.js";
import { postBacklinkDigestToSlack } from "../mcp-servers/reporting/server.js";
import { saveBacklinkReport } from "../services/seo-report.service.js";

dotenv.config();

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

// ── Global Variables ──────────────────────────────────────────────────

let sitesConfig: SitesConfig[] = [];
let sitesCompetitorsConfig: Record<string | number, CompetitorsConfig> = {};
const DRY_RUN = ["1", "true", "yes"].includes(
  (process.env.DRY_RUN || "false").toLowerCase(),
);

// ── Step 1: Backlink monitor ──────────────────────────────────────────
async function backlinkMonitor(siteId: number) {
  console.log(`\n[step1] Backlink health check for site_id=${siteId}...`);
  const [newLinks, lostLinks, toxicLinks, velocity] = await Promise.all([
    getNewBacklinks(siteId, 7),
    getLostBacklinks(siteId, 7),
    getToxicLinks(siteId),
    getLinkVelocity(siteId),
  ]);

  // console.log(
  //   `[step1] new=${newLinks.count} lost=${lostLinks.count} toxic=${toxicLinks.count} trend=${velocity.trend}`,
  // );
  console.log(`[step1] Done`);
  return { newLinks, lostLinks, toxicLinks, velocity };
}

// ── Step 2: Backlink engine — link prospects ──────────────────────────
async function linkProspects(siteId: number) {
  console.log(`\n[step2] Finding link prospects for site_id=${siteId}...`);

  const site = sitesCompetitorsConfig[siteId];

  const prospects = await findLinkProspects(
    siteId,
    site?.domain as string,
    site?.competitors_domain.slice(0,5) as string[],
  );

  console.log(
    `[step2] ${prospects.count} prospect(s) found across ${prospects.competitors_checked.length} competitor(s)`,
  );
  console.log(`[step2] Done`);
  return prospects;
}


// ── Summary Printer ───────────────────────────────────────────────────
function printSummary(errors: StepError, elapsed: number) {
  console.log(`\n[weekly_backlink_monitor] ══════════════════════════════════════════`);
  console.log(`[weekly_backlink_monitor] Pipeline complete in ${elapsed.toFixed(1)}s`);
  if (Object.keys(errors).length > 0) {
    console.log(`[weekly_backlink_monitor] Errors encountered:`);
    for (const [step, msg] of Object.entries(errors)) {
      console.log(`  ${step}: ${msg}`);
    }
  } else {
    console.log(`[weekly_backlink_monitor] All steps succeeded ✓`);
  }
  console.log(`[weekly_backlink_monitor] ══════════════════════════════════════════`);
}

// ── Task methods ──────────────────────────────────────────────────────
async function runBacklinksTasks(siteId: number) {
  const startTime = Date.now();
  const errors = {} as StepError;

  console.log(`[weekly_backlink_monitor] ══════════════════════════════════════════`);
  console.log(
    `[weekly_backlink_monitor] Starting weekly backlinks monitor pipeline — site_id=${siteId}`,
  );
  console.log(`[weekly_backlink_monitor] DRY_RUN=${DRY_RUN}`);
  console.log(`[weekly_backlink_monitor] ══════════════════════════════════════════`);

  // ── Step 1: Backlink monitor ──────────────────────────────────────
  let backlinkData: any = null;
  try {
    backlinkData = await backlinkMonitor(siteId);
  } catch (exc: any) {
    errors.step1 = exc.message;
    console.log(`[step1] ERROR: ${exc.message}`);
  }

  // ── Step 2: Link prospects ────────────────────────────────────────
  let prospectsData: any = null;
  try {
    prospectsData = await linkProspects(siteId);
  } catch (exc: any) {
    errors.step2 = exc.message;
    console.log(`[step2] ERROR: ${exc.message}`);
  }

  // ── Step 3: Persist report to DB ─────────────────────────────────
  try {
    await saveBacklinkReport(siteId, backlinkData, prospectsData);
    console.log(`[step3] Report saved to DB`);
  } catch (exc: any) {
    console.log(`[step3] DB save ERROR: ${(exc as Error).message}`);
  }

  // ── Step 4: Backlink digest → Slack ───────────────────────────────
  if (!DRY_RUN) {
    console.log(`\n[step4] Posting backlink digest for site_id=${siteId}...`);
    try {
      const site = sitesConfig.find((s) => s.site_id === siteId);
      await postBacklinkDigestToSlack(
        siteId,
        site?.domain ?? "",
        backlinkData,
        prospectsData,
      );
      console.log(`[step4] Done`);
    } catch (exc: any) {
      console.log(`[step4] ERROR: ${(exc as Error).message}`);
    }
  }
  let elapsedSeconds = (Date.now() - startTime) / 1000;

  elapsedSeconds = (Date.now() - startTime) / 1000;
  printSummary(errors, elapsedSeconds);
}

// ── Parent method ───────────────────────────────────────────────────
export async function weeklyBacklinksMonitorTasks() {
  console.log(`[weekly_backlink_monitor] Fetching configuration from database...`);

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

  console.log(
    `[weekly_backlink_monitor] Loaded ${sitesConfig.length} sites. Starting processing...`,
  );

  // Run pipeline for each configured site
  // for (const site of sitesConfig) {
  await runBacklinksTasks(1);
  // }
}
