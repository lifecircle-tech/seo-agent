import {
  getSearchConsoleClient,
  getIndexingClient,
} from "../../../libs/google.js";
import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../db.js";
import { logger } from "../../utils/logger.js";

// ── Thresholds ────────────────────────────────────────────────────────
const THRESHOLDS = {
  desktop_score: 90, // alert if desktop score < 90
  mobile_score: 70, // alert if mobile score < 70
  lcp_ms: 2500, // alert if LCP > 2.5s
  cls: 0.1, // alert if CLS > 0.1
};

// ── PageSpeed Insights helper ─────────────────────────────────────────
const PSI_BASE = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

// Audits that directly affect user experience
const IMPACT_AUDITS = new Set([
  "render-blocking-resources",
  "unused-css-rules",
  "unused-javascript",
  "uses-optimized-images",
  "uses-text-compression",
  "server-response-time",
  "time-to-first-byte",
  "largest-contentful-paint",
  "cumulative-layout-shift",
  "total-blocking-time",
  "uses-responsive-images",
  "efficiently-animate-contents",
]);

async function fetchPsi(
  url: string,
  strategy: "mobile" | "desktop",
): Promise<any> {
  const apiUrl = new URL(PSI_BASE);
  apiUrl.searchParams.set("url", url);
  apiUrl.searchParams.set("strategy", strategy);
  apiUrl.searchParams.set("category", "performance");
  const key = process.env.GOOGLE_API_KEY?.trim();
  if (key) apiUrl.searchParams.set("key", key);

  const res = await fetch(apiUrl.toString());
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(
      `PageSpeed Insights error ${res.status}: ${msg.substring(0, 200)}`,
    );
  }
  return res.json();
}

// ── URL Inspection state maps ─────────────────────────────────────────
// States to silently ignore (intentional by site owner)
const SKIP_COVERAGE_STATES = new Set([
  "Page with redirect",
  "Blocked by robots.txt",
]);

// States confirming a page is indexed
const INDEXED_STATES = new Set([
  "Submitted and indexed",
  "Indexed, not submitted in sitemap",
]);

// States indicating a hard crawl/server error → sitemap_error
const ERROR_STATES = new Set([
  "Not found (404)",
  "Soft 404",
  "Server error (5xx)",
  "Blocked due to unauthorized request (401)",
  "Blocked due to access forbidden (403)",
  "Blocked due to page execution issue",
  "Redirect error",
]);

// States indicating a content/canonicalisation issue → sitemap_warning
const WARNING_STATES = new Set([
  "Excluded by 'noindex' tag",
  "Alternate page with proper canonical tag",
  "Duplicate without user-selected canonical",
  "Duplicate, Google chose different canonical than user",
]);

// States where Google simply hasn't indexed the page yet → not_indexed
const PENDING_STATES = new Set([
  "Discovered - currently not indexed",
  "Crawled - currently not indexed",
  "URL is unknown to Google",
]);

type UrlInspectionResult = {
  url: string;
  coverageState: string;
  lastCrawlTime?: string | null;
};

// Collects all page URLs from every submitted sitemap, including one level of sub-sitemaps
async function fetchAllSitemapUrls(sitemaps: any[]): Promise<string[]> {
  const allUrls: string[] = [];
  for (const sitemap of sitemaps) {
    const path = sitemap.path;
    if (!path) continue;
    try {
      const xmlRes = await fetch(path);
      if (!xmlRes.ok) continue;
      const xml = await xmlRes.text();
      const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/gi)].map((m) =>
        m[1].trim(),
      );
      const subSitemaps = locs.filter((u) => u.endsWith(".xml"));
      allUrls.push(...locs.filter((u) => !u.endsWith(".xml")));
      for (const subPath of subSitemaps) {
        try {
          const subRes = await fetch(subPath);
          if (!subRes.ok) continue;
          const subXml = await subRes.text();
          allUrls.push(
            ...[...subXml.matchAll(/<loc>(.*?)<\/loc>/gi)]
              .map((m) => m[1].trim())
              .filter((u) => !u.endsWith(".xml")),
          );
        } catch {
          // non-fatal
        }
      }
    } catch (err: any) {
      logger.error(`[fetchAllSitemapUrls] Could not fetch ${path}: `, err);
    }
  }
  return [...new Set(allUrls)];
}

// Inspects each URL via GSC URL Inspection API (sequential to respect quota limits)
export async function inspectUrls(
  sitePropertyUrl: string,
  urls: string[],
): Promise<UrlInspectionResult[]> {
  const searchConsole = getSearchConsoleClient();

  const results: UrlInspectionResult[] = [];
  // for (const [index, url] of urls.entries()) {
  await Promise.all(
    urls.map(async (url, index) => {
      console.log("Inspecting page ", index + 1);

      try {
        const res = await searchConsole.urlInspection.index.inspect({
          requestBody: { inspectionUrl: url, siteUrl: sitePropertyUrl },
        });
        const coverageState =
          res.data.inspectionResult?.indexStatusResult?.coverageState ??
          "Unknown";
        const lastCrawlTime =
          res.data.inspectionResult?.indexStatusResult?.lastCrawlTime;
        results.push({ url, coverageState, lastCrawlTime });
      } catch (err: any) {
        logger.error(`[inspectUrls] Failed to inspect ${url}: `, err);
      }
    }),
  );

  // }
  logger.debug(`[inspectUrls] Inspected ${results.length} urls`);
  return results;
}

async function getSiteDomain(siteId: number): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT domain FROM sites_config WHERE site_id = ? LIMIT 1",
    [siteId],
  );
  if (!rows.length) throw new Error(`No site found for site_id=${siteId}`);
  const domain = rows[0].domain as string;
  // Ensure protocol is present for API calls
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

// ── Types ─────────────────────────────────────────────────────────────
export type PageSpeedIssue = {
  audit: string;
  title: string;
  description: string;
  score: number;
};

export type PageSpeedResult = {
  site_id: number;
  url: string;
  mobile_score: number;
  desktop_score: number;
  lcp_ms: number;
  cls: number;
  fid_ms: number;
  fcp_ms: number;
  tbt_ms: number;
  issues: PageSpeedIssue[];
  alerts: string[];
};

export type CrawlErrorItem = {
  type: "sitemap_error" | "not_indexed" | "sitemap_warning";
  url?: string;
  sitemap?: string;
  detail: string;
  info?: string;
  lastCrawlTime?: string;
};

export type CrawlErrorResult = {
  site_id: number;
  site_url: string;
  error_count: number;
  warning_count: number;
  errors: CrawlErrorItem[];
};

export type IndexCoverageResult = {
  site_id: number;
  site_url: string;
  submitted_count: number;
  indexed_count: number;
  not_indexed_count: number;
  coverage_pct: number;
  not_indexed_urls: string[];
  alerts: string[];
};

export type IndexingSubmitItem = {
  url: string;
  status: "ok" | "error";
  error?: string;
};

export type IndexingSubmitResult = {
  site_id: number;
  site_url: string;
  type: "URL_UPDATED" | "URL_DELETED";
  submitted: IndexingSubmitItem[];
  success_count: number;
  error_count: number;
};

export type CoreWebVitalsResult = {
  site_id: number;
  site_url: string;
  source: "field" | "lab";
  lcp_ms: number;
  cls: number;
  fid_ms: number;
  inp_ms: number;
  fcp_ms: number;
  lcp_category: string;
  cls_category: string;
  fid_category: string;
  alerts: string[];
};

// ── Tool: run_pagespeed_audit ─────────────────────────────────────────
export async function runPagespeedAudit(
  siteId: number,
  url: string,
): Promise<PageSpeedResult> {
  logger.info(
    `[run_pagespeed_audit] Running PSI for site_id=${siteId}, url=${url}...`,
  );

  // Run mobile and desktop in parallel
  // const [mobileRaw] = await Promise.all([
  //   fetchPsi(url, "mobile"),
  // ]);
  const [mobileRaw, desktopRaw] = await Promise.all([
    fetchPsi(url, "mobile"),
    fetchPsi(url, "desktop"),
  ]);

  const parseScore = (raw: any): number =>
    Math.round(
      (raw.lighthouseResult?.categories?.performance?.score ?? 0) * 100,
    );

  const parseAuditValue = (raw: any, auditId: string): number =>
    raw.lighthouseResult?.audits?.[auditId]?.numericValue ?? 0;

  const mobileScore = parseScore(mobileRaw);
  const desktopScore = parseScore(desktopRaw);
  const lcp = parseAuditValue(mobileRaw, "largest-contentful-paint");
  const cls = parseAuditValue(mobileRaw, "cumulative-layout-shift");
  const tbt = parseAuditValue(mobileRaw, "total-blocking-time");
  const fcp = parseAuditValue(mobileRaw, "first-contentful-paint");

  // FID is approximated via TBT; PSI v5 doesn't expose FID directly in lab
  const fidEstimate = tbt > 0 ? Math.round(tbt * 0.3) : 0;

  // Collect actionable issues (score < 0.5 on impact audits)
  const audits = mobileRaw.lighthouseResult?.audits ?? {};
  const issues: PageSpeedIssue[] = [];
  for (const [id, audit] of Object.entries(audits) as [string, any][]) {
    if (!IMPACT_AUDITS.has(id)) continue;
    const score = audit.score ?? 1;
    if (score !== null && score < 0.5) {
      issues.push({
        audit: id,
        title: audit.title ?? id,
        description: audit.description ?? "",
        score: Math.round(score * 100),
      });
    }
  }
  issues.sort((a, b) => a.score - b.score);

  // Threshold alerts
  const alerts: string[] = [];
  if (mobileScore < THRESHOLDS.mobile_score) {
    alerts.push(
      `Mobile performance score is ${mobileScore}/100 (threshold: ${THRESHOLDS.mobile_score})`,
    );
  }
  if (lcp > THRESHOLDS.lcp_ms) {
    alerts.push(
      `LCP is ${(lcp / 1000).toFixed(2)}s (threshold: ${THRESHOLDS.lcp_ms / 1000}s)`,
    );
  }
  if (cls > THRESHOLDS.cls) {
    alerts.push(`CLS is ${cls.toFixed(3)} (threshold: ${THRESHOLDS.cls})`);
  }

  logger.info(
    `[run_pagespeed_audit] mobile=${mobileScore}, desktop=${desktopScore}, LCP=${lcp}ms, CLS=${cls.toFixed(3)}, alerts=${alerts.length}`,
  );

  return {
    site_id: siteId,
    url,
    mobile_score: mobileScore,
    desktop_score: desktopScore,
    lcp_ms: Math.round(lcp),
    cls: Number(cls.toFixed(4)),
    fid_ms: fidEstimate,
    fcp_ms: Math.round(fcp),
    tbt_ms: Math.round(tbt),
    issues,
    alerts,
  };
}

// ── Tool: check_crawl_errors ──────────────────────────────────────────
export async function checkCrawlErrors(
  siteId: number,
): Promise<CrawlErrorResult> {
  const siteUrl = await getSiteDomain(siteId);
  logger.info(
    `[check_crawl_errors] Checking crawl errors for site_id=${siteId} (${siteUrl})...`,
  );

  const searchConsole = getSearchConsoleClient();
  const errors: CrawlErrorItem[] = [];
  const sitePropertyUrl = siteUrl.endsWith("/") ? siteUrl : siteUrl + "/";

  // 1. Check sitemaps for submission-level errors
  let sitemaps: any[] = [];
  try {
    const sitemapRes = await searchConsole.sitemaps.list({ siteUrl });
    sitemaps = sitemapRes.data.sitemap ?? [];
  } catch (err: any) {
    logger.error(`[check_crawl_errors] Could not list sitemaps: `, err);
  }

  for (const sitemap of sitemaps) {
    const errCount = Number(sitemap.errors ?? 0);
    const warnCount = Number(sitemap.warnings ?? 0);
    if (errCount > 0) {
      errors.push({
        type: "sitemap_error",
        sitemap: sitemap.path ?? "",
        detail: `Sitemap has ${errCount} error(s)`,
      });
    }
    if (warnCount > 0) {
      errors.push({
        type: "sitemap_warning",
        sitemap: sitemap.path ?? "",
        detail: `Sitemap has ${warnCount} warning(s)`,
      });
    }
  }

  // 2. Collect all page URLs from every sitemap (including sub-sitemaps)
  const sitemapUrls = await fetchAllSitemapUrls(sitemaps);
  logger.info(
    `[check_crawl_errors] Inspecting ${sitemapUrls.length} URLs via URL Inspection API...`,
  );

  // 3. Inspect each URL and classify by coverage state
  const inspectionResults = await inspectUrls(
    sitePropertyUrl,
    sitemapUrls.slice(0, 100),
  );

  for (const { url, coverageState, lastCrawlTime } of inspectionResults) {
    if (SKIP_COVERAGE_STATES.has(coverageState)) continue;

    if (ERROR_STATES.has(coverageState)) {
      errors.push({
        type: "sitemap_error",
        url,
        detail: coverageState,
        info: `Crawl error on ${url}: ${coverageState}`,
        lastCrawlTime: lastCrawlTime as string,
      });
    } else if (WARNING_STATES.has(coverageState)) {
      errors.push({
        type: "sitemap_warning",
        url,
        detail: coverageState,
        info: `Content/canonical issue on ${url}: ${coverageState}`,
        lastCrawlTime: lastCrawlTime as string,
      });
    } else if (PENDING_STATES.has(coverageState)) {
      errors.push({
        type: "not_indexed",
        url,
        detail: coverageState,
        info: `Not yet indexed; Last Crawlled by google : ${lastCrawlTime?.split("T")[0]}`,
        lastCrawlTime: lastCrawlTime as string,
      });
    }
  }

  const errorCount = errors.filter((e) => e.type !== "sitemap_warning").length;
  const warningCount = errors.filter(
    (e) => e.type === "sitemap_warning",
  ).length;

  logger.info(
    `[check_crawl_errors] ${errorCount} errors, ${warningCount} warnings`,
  );

  return {
    site_id: siteId,
    site_url: siteUrl,
    error_count: errorCount,
    warning_count: warningCount,
    errors,
  };
}

// ── Tool: check_index_coverage ────────────────────────────────────────
export async function checkIndexCoverage(
  siteId: number,
): Promise<IndexCoverageResult> {
  const siteUrl = await getSiteDomain(siteId);
  logger.info(
    `[check_index_coverage] Checking index coverage for site_id=${siteId} (${siteUrl})...`,
  );

  const searchConsole = getSearchConsoleClient();
  const sitePropertyUrl = siteUrl.endsWith("/") ? siteUrl : siteUrl + "/";

  // 1. Collect all page URLs from every submitted sitemap (including sub-sitemaps)
  let sitemaps: any[] = [];
  try {
    const sitemapRes = await searchConsole.sitemaps.list({ siteUrl });
    sitemaps = sitemapRes.data.sitemap ?? [];
  } catch (err: any) {
    logger.error(`[check_index_coverage] Sitemaps API failed: `, err);
  }

  const sitemapUrls = await fetchAllSitemapUrls(sitemaps);
  const submittedCount = sitemapUrls.length;

  logger.debug(
    `[check_index_coverage] ${submittedCount} URLs found across all sitemaps`,
  );

  // 2. Inspect each URL via URL Inspection API to get real indexing status
  let indexedCount = 0;
  const notIndexedUrls: string[] = [];

  if (submittedCount > 0) {
    logger.info(
      `[check_index_coverage] Inspecting ${submittedCount} URLs via URL Inspection API...`,
    );
    const inspectionResults = await inspectUrls(sitePropertyUrl, sitemapUrls);

    for (const { url, coverageState } of inspectionResults) {
      if (SKIP_COVERAGE_STATES.has(coverageState)) continue;

      if (INDEXED_STATES.has(coverageState)) {
        indexedCount++;
      } else {
        // ERROR_STATES, WARNING_STATES, PENDING_STATES all count as not indexed
        notIndexedUrls.push(url);
      }
    }
  }

  const notIndexedCount = notIndexedUrls.length;
  const coveragePct =
    submittedCount > 0
      ? Math.round((indexedCount / submittedCount) * 100)
      : 100;

  const alerts: string[] = [];
  if (coveragePct < 80 && submittedCount > 0) {
    alerts.push(
      `Index coverage is ${coveragePct}% — ${notIndexedCount} pages submitted but not indexed`,
    );
  }

  logger.info(
    `[check_index_coverage] submitted=${submittedCount}, indexed=${indexedCount}, coverage=${coveragePct}%`,
  );

  return {
    site_id: siteId,
    site_url: siteUrl,
    submitted_count: submittedCount,
    indexed_count: indexedCount,
    not_indexed_count: notIndexedCount,
    coverage_pct: coveragePct,
    not_indexed_urls: notIndexedUrls,
    alerts,
  };
}

export async function checkIndexedStatus(domain: string, urls: string[]) {
  const sitePropertyUrl = domain.endsWith("/") ? domain : domain + "/";
  const inspectionResults = await inspectUrls(sitePropertyUrl, urls);

  const indexed_urls = [];

  for (const { url, coverageState } of inspectionResults) {
    if (INDEXED_STATES.has(coverageState)) {
      indexed_urls.push(url);
    }
  }

  return {
    indexed_count: indexed_urls.length,
    indexed_urls,
  };
}

// ── Tool: request_indexing ────────────────────────────────────────────
export async function requestIndexing(
  siteId: number,
  urls: string[],
  type: "URL_UPDATED" | "URL_DELETED" = "URL_UPDATED",
): Promise<IndexingSubmitResult> {
  const siteUrl = await getSiteDomain(siteId);
  logger.info(
    `[request_indexing] Submitting ${urls.length} URLs for indexing (type=${type}, site_id=${siteId})...`,
  );

  const indexing = getIndexingClient();
  const submitted: IndexingSubmitItem[] = [];

  for (const url of urls) {
    logger.info(`[request_indexing] Requesting Indexing for: ${url}`);
    try {
      await indexing.urlNotifications.publish({
        requestBody: { url, type },
      });
      logger.info(`[request_indexing] OK: ${url}`);
      submitted.push({ url, status: "ok" });
    } catch (err: any) {
      const msg =
        err?.response?.data?.error?.message ?? err?.message ?? "Unknown error";
      logger.error(`[request_indexing] FAILED: ${url} — ${msg}`, err);
      submitted.push({ url, status: "error", error: msg });
    }
  }

  const successCount = submitted.filter((r) => r.status === "ok").length;
  const errorCount = submitted.filter((r) => r.status === "error").length;

  logger.info(
    `[request_indexing] Done. success=${successCount}, errors=${errorCount}`,
  );

  return {
    site_id: siteId,
    site_url: siteUrl,
    type,
    submitted,
    success_count: successCount,
    error_count: errorCount,
  };
}

// ── Tool: get_core_web_vitals ─────────────────────────────────────────
export async function getCoreWebVitals(
  siteId: number,
): Promise<CoreWebVitalsResult> {
  const siteUrl = await getSiteDomain(siteId);
  logger.info(
    `[get_core_web_vitals] Fetching CWV for site_id=${siteId} (${siteUrl})...`,
  );

  // Use PSI field data (CrUX real-user data) for the site origin
  const raw = await fetchPsi(siteUrl, "mobile");

  const fieldMetrics = raw.loadingExperience?.metrics ?? {};

  // CrUX metric extraction helpers
  const fieldMs = (key: string): number =>
    Number(fieldMetrics[key]?.percentile ?? 0);
  const fieldCategory = (key: string): string =>
    (fieldMetrics[key]?.category ?? "UNKNOWN") as string;

  const lcpMs = fieldMs("LARGEST_CONTENTFUL_PAINT_MS");
  // CLS percentile from CrUX is stored × 100 (centiseconds-style), divide to get actual
  const clsRaw = fieldMs("CUMULATIVE_LAYOUT_SHIFT_SCORE");
  const cls = clsRaw > 1 ? clsRaw / 100 : clsRaw;
  const fidMs = fieldMs("FIRST_INPUT_DELAY_MS");
  const inpMs = fieldMs("INTERACTION_TO_NEXT_PAINT");
  const fcpMs = fieldMs("FIRST_CONTENTFUL_PAINT_MS");

  // Fall back to lab data if no field data available
  const hasFieldData = lcpMs > 0 || cls > 0;
  let source: "field" | "lab" = hasFieldData ? "field" : "lab";

  let finalLcp = lcpMs;
  let finalCls = cls;
  let finalFid = fidMs;
  let finalInp = inpMs;
  let finalFcp = fcpMs;

  if (!hasFieldData) {
    const audits = raw.lighthouseResult?.audits ?? {};
    finalLcp = Math.round(
      audits["largest-contentful-paint"]?.numericValue ?? 0,
    );
    finalCls = Number(
      (audits["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(4),
    );
    finalFid = Math.round(
      (audits["total-blocking-time"]?.numericValue ?? 0) * 0.3,
    );
    finalFcp = Math.round(audits["first-contentful-paint"]?.numericValue ?? 0);
  }

  // Threshold alerts
  const alerts: string[] = [];
  if (finalLcp > THRESHOLDS.lcp_ms) {
    alerts.push(
      `LCP is ${(finalLcp / 1000).toFixed(2)}s — exceeds threshold of ${THRESHOLDS.lcp_ms / 1000}s`,
    );
  }
  if (finalCls > THRESHOLDS.cls) {
    alerts.push(
      `CLS is ${finalCls.toFixed(3)} — exceeds threshold of ${THRESHOLDS.cls}`,
    );
  }

  logger.info(
    `[get_core_web_vitals] source=${source} LCP=${finalLcp}ms, CLS=${finalCls.toFixed(3)}, FID=${finalFid}ms, alerts=${alerts.length}`,
  );

  return {
    site_id: siteId,
    site_url: siteUrl,
    source,
    lcp_ms: finalLcp,
    cls: Number(finalCls.toFixed(4)),
    fid_ms: finalFid,
    inp_ms: finalInp,
    fcp_ms: finalFcp,
    lcp_category: fieldCategory("LARGEST_CONTENTFUL_PAINT_MS"),
    cls_category: fieldCategory("CUMULATIVE_LAYOUT_SHIFT_SCORE"),
    fid_category: fieldCategory("FIRST_INPUT_DELAY_MS"),
    alerts,
  };
}
