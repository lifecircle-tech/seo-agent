import { getSearchConsoleClient } from "../../../libs/google.js";
import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../db.js";

// ── Thresholds ────────────────────────────────────────────────────────
const THRESHOLDS = {
  desktop_score: 90,  // alert if desktop score < 90
  mobile_score: 70,  // alert if mobile score < 70
  lcp_ms: 2500,      // alert if LCP > 2.5s
  cls: 0.1,          // alert if CLS > 0.1
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

async function fetchPsi(url: string, strategy: "mobile" | "desktop"): Promise<any> {
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
  console.log(
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
    Math.round((raw.lighthouseResult?.categories?.performance?.score ?? 0) * 100);

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
    alerts.push(
      `CLS is ${cls.toFixed(3)} (threshold: ${THRESHOLDS.cls})`,
    );
  }

  console.log(
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
  console.log(
    `[check_crawl_errors] Checking crawl errors for site_id=${siteId} (${siteUrl})...`,
  );

  const searchConsole = getSearchConsoleClient();
  const errors: CrawlErrorItem[] = [];

  // 1. Check sitemaps for submission errors
  let sitemaps: any[] = [];
  try {
    const sitemapRes = await searchConsole.sitemaps.list({ siteUrl });
    sitemaps = sitemapRes.data.sitemap ?? [];
  } catch (err: any) {
    console.warn(`[check_crawl_errors] Could not list sitemaps: ${err.message}`);
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

  // 2. Cross-reference sitemap URLs vs GSC analytics to find unindexed pages
  let sitemapUrls: string[] = [];
  const primarySitemap = sitemaps[0]?.path;
  if (primarySitemap) {
    try {
      const xmlRes = await fetch(primarySitemap);
      if (xmlRes.ok) {
        const xml = await xmlRes.text();
        // Extract <loc> URLs from sitemap
        const locMatches = [...xml.matchAll(/<loc>(.*?)<\/loc>/gi)];
        sitemapUrls = locMatches
          .map((m) => m[1].trim())
          .filter((u) => !u.endsWith(".xml")); // skip sitemap index entries
      }
    } catch (err: any) {
      console.warn(
        `[check_crawl_errors] Could not fetch sitemap XML: ${err.message}`,
      );
    }
  }

  if (sitemapUrls.length > 0) {
    // Get pages that have appeared in GSC (last 28 days)
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 28);
    const fmtDate = (d: Date) => d.toISOString().split("T")[0];

    try {
      const gscRes = await searchConsole.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: fmtDate(start),
          endDate: fmtDate(end),
          dimensions: ["page"],
          rowLimit: 1000,
        },
      });

      const indexedUrls = new Set(
        (gscRes.data.rows ?? []).map((r) => (r.keys?.[0] ?? "").toLowerCase()),
      );

      // Sitemap URLs not appearing in GSC = potentially not indexed
      const notIndexed = sitemapUrls
        .filter((u) => !indexedUrls.has(u.toLowerCase()))
        .slice(0, 20); // cap at 20 to avoid noise

      for (const url of notIndexed) {
        errors.push({
          type: "not_indexed",
          url,
          detail: "URL is in sitemap but has no GSC impressions in 28 days",
        });
      }
    } catch (err: any) {
      console.warn(
        `[check_crawl_errors] GSC query failed: ${err.message}`,
      );
    }
  }
  
  const errorCount = errors.filter((e) => e.type !== "sitemap_warning").length;
  const warningCount = errors.filter((e) => e.type === "sitemap_warning").length;
  
  console.log("[check_crawl_errors] Errors ", errors);
  console.log(
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
  console.log(
    `[check_index_coverage] Checking index coverage for site_id=${siteId} (${siteUrl})...`,
  );

  const searchConsole = getSearchConsoleClient();

  // 1. Try to get submitted vs indexed counts from GSC sitemaps
  let submittedCount = 0;
  let indexedCount = 0;
  try {
    const sitemapRes = await searchConsole.sitemaps.list({ siteUrl });
    for (const sitemap of sitemapRes.data.sitemap ?? []) {
      for (const content of sitemap.contents ?? []) {
        submittedCount += Number(content.submitted ?? 0);
        indexedCount += Number(content.indexed ?? 0);
      }
    }
  } catch (err: any) {
    console.warn(`[check_index_coverage] Sitemaps API failed: ${err.message}`);
  }

  // 2. If sitemaps didn't give us data, count from GSC analytics
  if (submittedCount === 0) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 28);
    const fmtDate = (d: Date) => d.toISOString().split("T")[0];

    try {
      const gscRes = await searchConsole.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: fmtDate(start),
          endDate: fmtDate(end),
          dimensions: ["page"],
          rowLimit: 1000,
        },
      });
      indexedCount = (gscRes.data.rows ?? []).length;
      submittedCount = indexedCount; // best estimate when sitemap data is unavailable
    } catch (err: any) {
      console.warn(`[check_index_coverage] GSC analytics failed: ${err.message}`);
    }
  }

  // 3. Find specific not-indexed URLs from sitemap cross-reference
  const notIndexedUrls: string[] = [];
  try {
    const sitemapRes = await searchConsole.sitemaps.list({ siteUrl });
    const primarySitemap = sitemapRes.data.sitemap?.[0]?.path;
    if (primarySitemap) {
      const xmlRes = await fetch(primarySitemap);
      if (xmlRes.ok) {
        const xml = await xmlRes.text();
        const locMatches = [...xml.matchAll(/<loc>(.*?)<\/loc>/gi)];
        const sitemapUrls = locMatches
          .map((m) => m[1].trim())
          .filter((u) => !u.endsWith(".xml"));

        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 28);
        const fmtDate = (d: Date) => d.toISOString().split("T")[0];

        const gscRes = await searchConsole.searchanalytics.query({
          siteUrl,
          requestBody: {
            startDate: fmtDate(start),
            endDate: fmtDate(end),
            dimensions: ["page"],
            rowLimit: 1000,
          },
        });
        const indexedSet = new Set(
          (gscRes.data.rows ?? []).map((r) =>
            (r.keys?.[0] ?? "").toLowerCase(),
          ),
        );

        notIndexedUrls.push(
          ...sitemapUrls
            .filter((u) => !indexedSet.has(u.toLowerCase()))
            .slice(0, 50),
        );
      }
    }
  } catch {
    // non-fatal
  }

  const notIndexedCount = submittedCount > 0 ? submittedCount - indexedCount : notIndexedUrls.length;
  const coveragePct =
    submittedCount > 0 ? Math.round((indexedCount / submittedCount) * 100) : 100;

  const alerts: string[] = [];
  if (coveragePct < 80 && submittedCount > 0) {
    alerts.push(
      `Index coverage is ${coveragePct}% — ${notIndexedCount} pages submitted but not indexed`,
    );
  }

  console.log(
    `[check_index_coverage] submitted=${submittedCount}, indexed=${indexedCount}, coverage=${coveragePct}%`,
  );

  return {
    site_id: siteId,
    site_url: siteUrl,
    submitted_count: submittedCount,
    indexed_count: indexedCount,
    not_indexed_count: Math.max(0, notIndexedCount),
    coverage_pct: coveragePct,
    not_indexed_urls: notIndexedUrls,
    alerts,
  };
}

// ── Tool: get_core_web_vitals ─────────────────────────────────────────
export async function getCoreWebVitals(
  siteId: number,
): Promise<CoreWebVitalsResult> {
  const siteUrl = await getSiteDomain(siteId);
  console.log(
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
    finalLcp = Math.round(audits["largest-contentful-paint"]?.numericValue ?? 0);
    finalCls = Number((audits["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(4));
    finalFid = Math.round((audits["total-blocking-time"]?.numericValue ?? 0) * 0.3);
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

  console.log(
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
