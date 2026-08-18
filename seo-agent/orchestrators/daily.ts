import * as dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";

// Import controllers for database operations
import { listSitesConfigs } from "../controllers/sites.controller.js";
import {
  bulkCreateAlerts,
  getOpenIndexedAlert,
  getResolvedIndexedAlert,
  updateAlertsStatusToClosed,
  updateAlertsStatusToResolved,
} from "../controllers/alerts.controller.js";

import { Alert } from "../models/alert.model.js";

// MCP Server Imports
import {
  runPagespeedAudit,
  checkCrawlErrors,
  checkIndexCoverage,
  getCoreWebVitals,
  requestIndexing,
  checkIndexedStatus,
} from "../mcp-servers/technical-seo/server.js";
import { getFeatureOpportunities } from "../mcp-servers/serp-features/server.js";
import { postSlackMessage } from "../mcp-servers/reporting/server.js";
import { saveDailyIndexingReport } from "../services/seo-report.service.js";

// ── Types ─────────────────────────────────────────────────────────────
type SiteIssue = {
  module: string;
  severity: "critical" | "warning" | "info";
  message: string;
};

type SiteRequest = {
  type: string;
  success_count: number;
  failed_count: number;
  success: string[];
  failed: string[];
};

type Indexed = {
  type: string;
  indexed_count: number;
  indexed_urls: string[];
};

// ── Config ────────────────────────────────────────────────────────────
dotenv.config();

const DRY_RUN = ["1", "true", "yes"].includes(
  (process.env.DRY_RUN || "false").toLowerCase(),
);
const exclude_from_url = ["ads", "apply", "wp-", ".js", ".css"];

// ── Helper ────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Per-site health check ─────────────────────────────────────────────
async function runDailyCheckForSite(
  siteId: number,
  domain: string,
): Promise<SiteIssue[]> {
  const issues: SiteIssue[] = [];

  logger.info(`[daily] site_id=${siteId} (${domain})`);

  // Derive homepage URL from domain
  const homepageUrl = domain.startsWith("http") ? domain : `https://${domain}`;

  // ── PageSpeed audit ─────────────────────────────────────────────
  try {
    logger.info(`[daily:pagespeed] Auditing ${homepageUrl}...`);
    const psi = await runPagespeedAudit(siteId, homepageUrl);
    for (const alert of psi.alerts) {
      issues.push({
        module: "PageSpeed",
        severity: psi.mobile_score < 50 ? "critical" : "warning",
        message: alert,
      });
    }
    logger.info(
      `[daily:pagespeed] mobile=${psi.mobile_score}, desktop=${psi.desktop_score}, alerts=${psi.alerts.length}`,
    );
  } catch (err: any) {
    logger.error(`[daily:pagespeed] ERROR: `, err);
    // PSI failure is non-fatal — skip, don't add issue
  }

  // ── Core Web Vitals ─────────────────────────────────────────────
  try {
    logger.info(`[daily:cwv] Fetching CWV...`);
    const cwv = await getCoreWebVitals(siteId);
    for (const alert of cwv.alerts) {
      issues.push({
        module: "Core Web Vitals",
        severity: "warning",
        message: alert,
      });
    }
    logger.info(
      `[daily:cwv] source=${cwv.source} LCP=${cwv.lcp_ms}ms CLS=${cwv.cls} alerts=${cwv.alerts.length}`,
    );
  } catch (err: any) {
    logger.error(`[daily:cwv] ERROR: `, err);
  }

  // Brief pause between API calls
  await sleep(1000);

  // ── Crawl errors ────────────────────────────────────────────────
  try {
    logger.info(`[daily:crawl] Checking crawl errors...`);
    const crawl = await checkCrawlErrors(siteId);

    const payload: Pick<
      Alert,
      "id" | "site_id" | "module" | "severity" | "title" | "details"
    >[] = crawl.errors
      .map((item) => {
        return item.type == "sitemap_error"
          ? {
              id: randomUUID(),
              site_id: siteId,
              module: "crawl_error" as const,
              severity: "critical" as const,
              title: item.detail,
              details: {
                type: item.type,
                url: item.sitemap,
                info: item.detail || "",
              },
            }
          : item.type == "not_indexed"
            ? {
                id: randomUUID(),
                site_id: siteId,
                module: "index_error" as const,
                severity: "critical" as const,
                title: item.detail,
                details: {
                  type: item.type,
                  url: item.url,
                  info: item.info || "",
                  lastCrawlTime: item.lastCrawlTime || "N/A",
                },
              }
            : null;
      })
      .filter((item): item is Exclude<typeof item, null> => item !== null);

    await bulkCreateAlerts(payload);

    const not_indexed_url = crawl.errors
      .filter((item) => item.type == "not_indexed")
      .map((item) => item.url)
      .filter(
        (url) => url && !exclude_from_url.some((term) => url.includes(term)),
      );

    if (crawl.error_count > 0) {
      issues.push({
        module: "Crawl Errors",
        severity: "critical",
        message: `${crawl.error_count - not_indexed_url.length} crawl error(s) detected in GSC`,
      });
    }
    if (crawl.warning_count > 0) {
      issues.push({
        module: "Crawl Errors",
        severity: "warning",
        message: `${crawl.warning_count} sitemap warning(s) detected`,
      });
    }
    logger.info(
      `[daily:crawl] errors=${crawl.error_count} warnings=${crawl.warning_count}`,
    );
  } catch (err: any) {
    logger.error(`[daily:crawl] ERROR: `, err);
  }

  // ── Index coverage ──────────────────────────────────────────────
  // try {
  //   logger.info(`[daily:index] Checking index coverage...`);
  //   const coverage = await checkIndexCoverage(siteId);
  //   for (const alert of coverage.alerts) {
  //     issues.push({
  //       module: "Index Coverage",
  //       severity: "warning",
  //       message: alert,
  //     });
  //   }
  //   logger.info(
  //     `[daily:index] submitted=${coverage.submitted_count} indexed=${coverage.indexed_count} coverage=${coverage.coverage_pct}%`,
  //   );
  // } catch (err: any) {
  //   logger.error(`[daily:index] ERROR: `, err);
  // }

  // ── SERP feature opportunities ──────────────────────────────────
  // Informational only — add as info-level items, never cause an alert on their own
  // try {
  //   logger.info(`[daily:serp] Checking SERP feature opportunities...`);
  //   const serp = await getFeatureOpportunities(siteId);

  //   // Only flag as issue if competitor owns featured snippet for primary keywords
  //   const featuredSnippetLosses = serp.opportunities.filter(
  //     (o) => o.opportunity_type === "featured_snippet",
  //   );
  //   if (featuredSnippetLosses.length > 0) {
  //     issues.push({
  //       module: "SERP Features",
  //       severity: "info",
  //       message: `${featuredSnippetLosses.length} keyword(s) where competitor owns the featured snippet`,
  //     });
  //   }
  //   logger.info(
  //     `[daily:serp] checked=${serp.keywords_checked} opportunities=${serp.opportunities_count}`,
  //   );
  // } catch (err: any) {
  //   logger.error(`[daily:serp] ERROR: `, err);
  // }

  logger.info(`[daily] site_id=${siteId}: ${issues.length} issue(s) found`);
  return issues;
}

// Auto request for not indexed pages
async function requestIndexingForNotIndexedPages(site_id: number) {
  logger.info("[request_indexing] Starting Index Requesting...");
  const opened_indexed_alert = await getOpenIndexedAlert(site_id);

  const not_indexed_url = opened_indexed_alert
    .filter((alert) => alert.module == "index_error")
    .map((alert) => alert.details.url)
    .filter(
      (url) => url && !exclude_from_url.some((term) => url.includes(term)),
    );

  const result = await requestIndexing(site_id, not_indexed_url.slice(0, 20));

  const success_urls = result.submitted
    .filter((item) => item.status == "ok")
    .map((item) => item.url);

  const failed_urls = result.submitted
    .filter((item) => item.status == "error")
    .map((item) => item.url);

  const alert_ids = opened_indexed_alert
    .filter((alert) => success_urls.includes(alert.details.url))
    .map((a) => a.id);

  await updateAlertsStatusToResolved(alert_ids);

  logger.info("[request_indexing] Finished Index Requesting");
  return {
    type: result.type,
    success: success_urls,
    failed: failed_urls,
    success_count: result.success_count,
    failed_count: result.error_count,
  };
}

async function checkIndexedPagesUpdate(
  site_id: number,
  domain: string,
): Promise<Indexed> {
  logger.info("[check_indexing_status] Checking requested indexing status");
  const resolved_alert = await getResolvedIndexedAlert(site_id);
  const not_indexed_url = resolved_alert
    .filter((alert) => alert.module == "index_error")
    .map((alert) => alert.details.url);

  const inspected_results = await checkIndexedStatus(domain, not_indexed_url);

  const alert_ids = resolved_alert
    .filter((alert) =>
      inspected_results.indexed_urls.includes(alert.details.url),
    )
    .map((a) => a.id);

  await updateAlertsStatusToClosed(alert_ids);

  logger.info(
    `[check_indexing_status] Finished indexing check. Indexed count : ${inspected_results.indexed_count}`,
  );

  if (inspected_results.indexed_count) {
    saveDailyIndexingReport(site_id, inspected_results.indexed_urls);
  }

  return {
    type: "Indexed",
    indexed_count: inspected_results.indexed_count,
    indexed_urls: inspected_results.indexed_urls,
  };
}

// ── Slack alert (only called when there ARE issues) ───────────────────
async function postDailyAlert(
  domain: string,
  issues: SiteIssue[],
  request: SiteRequest,
  indexed: Indexed,
): Promise<void> {
  const critical = issues.filter((i) => i.severity === "critical");
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");

  const emoji = critical.length > 0 ? "🚨" : warnings.length > 0 ? "⚠️" : "ℹ️";

  const formatGroup = (label: string, items: SiteIssue[]): string =>
    items.length === 0
      ? ""
      : `*${label}*\n${items.map((i) => `• [${i.module}] ${i.message}`).join("\n")}`;

  const bodyParts = [
    formatGroup("Critical", critical),
    formatGroup("Warnings", warnings),
    formatGroup("Info", infos),
  ].filter(Boolean);

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${emoji} Daily Technical SEO Alert — ${domain}`,
      },
    },
  ] as any;

  if (request.success?.length) {
    const indexingRequest = [
      `*Page Indexing*\n${request.success_count} pages are requested for indexing.`,
      `Pages requested\n${request.success.map((u) => `• ${u}`).join("\n")}`,
    ];

    blocks.push(
      ...[
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: indexingRequest.join("\n"),
          },
        },
        { type: "divider" },
      ],
    );
  }

  if (indexed.indexed_urls?.length) {
    const completedIndex = [
      `*Page Indexed*\n${indexed.indexed_count} pages are indexed.`,
      `${indexed.indexed_urls.map((u) => `• ${u}`).join("\n")}`,
    ];
    blocks.push(
      ...[
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: completedIndex.join("\n"),
          },
        },
        { type: "divider" },
      ],
    );
  }

  if (issues.length) {
    blocks.push(
      ...[
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: bodyParts.join("\n\n"),
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `${critical.length} critical · ${warnings.length} warnings · ${infos.length} info`,
            },
          ],
        },
      ],
    );
  }

  const summary = `${emoji} ${domain}: ${issues.length} technical SEO issue(s) — ${critical.length} critical, ${warnings.length} warnings`;
  await postSlackMessage(summary, blocks);
}

// ── Main export ───────────────────────────────────────────────────────
export async function dailyTechnicalAudit() {
  const startTime = Date.now();

  logger.info(`[daily] ══════════════════════════════════════════`);
  logger.info(`[daily] Starting daily technical SEO audit`);
  logger.info(`[daily] ══════════════════════════════════════════`);

  const { sites } = await listSitesConfigs({ limit: 1000 });
  let sitesWithIssues = 0;

  const site = sites[0];
  // for (const site of sites) {
  try {
    const issues = [] as any;
    const requested = { success_count: 0 } as any;
    // 1. Checked updates for requested indexing
    const indexed = await checkIndexedPagesUpdate(site.site_id, site.domain);

    // 2. Checking all issues
    // const issues = await runDailyCheckForSite(site.site_id, site.domain);

    // 3. Request for not indexed pages
    // const requested = await requestIndexingForNotIndexedPages(site.site_id);

    if (
      issues.length === 0 &&
      requested.success_count === 0 &&
      indexed.indexed_count === 0
    ) {
      // ── SILENT on healthy days ──────────────────────────────
      logger.info(
        `[daily] site_id=${site.site_id} (${site.domain}) is HEALTHY — no Slack message sent`,
      );
      return;
      // continue;
    }

    if (issues.length) sitesWithIssues++;

    if (DRY_RUN) {
      logger.info(
        `[daily] DRY_RUN — would post ${issues.length} issue(s) to Slack for ${site.domain}`,
      );
    } else {
      // await postDailyAlert(site.domain, issues, requested, indexed);
      logger.info(
        `[daily] Slack alert posted for ${site.domain} (${issues.length} issues)`,
      );
    }
  } catch (err: any) {
    logger.error(
      `[daily] Unhandled error for site_id=${site.site_id}: ${err.message}`,
      err,
    );
  }
  // }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  logger.info(
    `[daily] Done in ${elapsed}s — ${sitesWithIssues}/${sites.length} site(s) had issues`,
  );
  if (sitesWithIssues === 0) {
    logger.info(`[daily] All sites healthy — no Slack messages sent`);
  }
  logger.info(`[daily] ══════════════════════════════════════════`);
}
