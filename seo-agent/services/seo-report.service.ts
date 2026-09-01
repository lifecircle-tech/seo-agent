import { randomUUID } from "node:crypto";
import { createSeoReport } from "../controllers/seo-report.controller.js";
import type {
  BacklinksPayload,
  SitemapAdsPayload,
  MissingPagesPayload,
  LocationInsightPayload,
} from "../models/seo-report.model.js";

// ── Save backlink report ──────────────────────────────────────────────
// Pass the raw return values from backlinkMonitor() + linkProspects().

export async function saveBacklinkReport(
  siteId: number,
  backlinkData: {
    newLinks: any;
    lostLinks: any;
    toxicLinks: any;
    velocity: any;
  } | null,
  prospectsData: any | null,
) {
  const newLinks = backlinkData?.newLinks;
  const lostLinks = backlinkData?.lostLinks;
  const toxicLinks = backlinkData?.toxicLinks;
  const velocity = backlinkData?.velocity;

  const new_count: number = newLinks?.count ?? 0;
  const lost_count: number = lostLinks?.count ?? 0;
  const toxic_count: number = toxicLinks?.count ?? 0;

  const payload: BacklinksPayload = {
    new_count,
    lost_count,
    toxic_count,
    trend: velocity?.trend ?? "stable",
    avg_weekly_gain: velocity?.avg_weekly_gain ?? 0,
    avg_weekly_loss: velocity?.avg_weekly_loss ?? 0,
    weekly_velocity: velocity?.weekly_velocity ?? [],
    new_backlinks: newLinks?.backlinks ?? [],
    lost_backlinks: lostLinks?.backlinks ?? [],
    toxic_links: toxicLinks?.toxic_links ?? [],
    prospects: prospectsData?.prospects ?? [],
    competitors_checked: prospectsData?.competitors_checked ?? [],
  };

  const summary = `Backlinks: +${new_count} new, -${lost_count} lost, ${toxic_count} toxic. Trend: ${payload.trend}. ${prospectsData?.count ?? 0} prospects found.`;

  return createSeoReport({
    id: randomUUID(),
    site_id: siteId,
    report_type: "backlinks",
    summary,
    payload,
  });
}

// ── Save sitemap & ads report ─────────────────────────────────────────
// Pass the raw return values from step1SitemapPing() + step2AdsInsights().

export async function saveSitemapAdsReport(
  siteId: number,
  sitemapData: {
    status: any;
    detected: any;
    pingResult: any | null;
  } | null,
  adsData: {
    topKeywords: any;
    wastedSpend: any;
    qualityIssues: any;
  } | null,
) {
  const status = sitemapData?.status;
  const detected = sitemapData?.detected;
  const pingResult = sitemapData?.pingResult;
  const topKeywords = adsData?.topKeywords;
  const wastedSpend = adsData?.wastedSpend;
  const qualityIssues = adsData?.qualityIssues;

  const coverage_pct: number = status?.coverage_pct ?? 0;
  const new_pages_count: number = detected?.count ?? 0;
  const ping_success_count: number = pingResult?.success_count ?? 0;
  const total_conversions: number = topKeywords?.total_conversions ?? 0;
  const total_wasted_inr: number = wastedSpend?.total_wasted_inr ?? 0;
  const critical_qs_count: number = qualityIssues?.critical_count ?? 0;

  const payload: SitemapAdsPayload = {
    // sitemap
    // coverage_pct,
    // total_submitted: status?.total_submitted ?? 0,
    // total_indexed: status?.total_indexed ?? 0,
    // issues: status?.issues ?? [],
    // gsc_sitemaps: status?.gsc_sitemaps ?? [],
    // bing_sitemaps: status?.bing_sitemaps ?? [],
    // pings
    // new_pages_count,
    // already_pinged: detected?.already_pinged ?? 0,
    // pinged_count: pingResult?.pinged?.length ?? 0,
    // ping_success_count,
    // ping_error_count: pingResult?.error_count ?? 0,
    // ping_results: pingResult?.pinged ?? [],
    // ads
    total_conversions,
    total_cost_inr: topKeywords?.total_cost_inr ?? 0,
    total_wasted_inr,
    wasted_keyword_count: wastedSpend?.keyword_count ?? 0,
    avg_quality_score: qualityIssues?.avg_quality_score ?? 0,
    critical_qs_count,
    poor_qs_count: qualityIssues?.poor_count ?? 0,
    top_keywords: topKeywords?.keywords ?? [],
    wasted_keywords: wastedSpend?.keywords ?? [],
    quality_issues: qualityIssues?.issues ?? [],
  };

  const summary = `Sitemap coverage ${coverage_pct}%. ${new_pages_count} new pages pinged (${ping_success_count} ok). Ads: ${total_conversions} conversions, ₹${total_wasted_inr} wasted, ${critical_qs_count} critical QS.`;

  return createSeoReport({
    id: randomUUID(),
    site_id: siteId,
    report_type: "sitemap_ads",
    summary,
    payload,
  });
}

// ── Save missing pages report ─────────────────────────────────────────
// Pass the raw return value from getMissingCityPages().

export async function saveMissingPagesReport(
  siteId: number,
  missingData: {
    total_cities: number;
    missing_count: number;
    missing: Array<{
      city: string;
      state: string;
      country: string;
      missingServices: string[];
      normalized_slug: string;
    }>;
  },
) {
  const payload: MissingPagesPayload = {
    total_cities: missingData.total_cities,
    missing_count: missingData.missing_count,
    missing_cities: missingData.missing ?? [],
  };

  const summary = `Missing pages: ${missingData.missing_count} of ${missingData.total_cities} cities have no landing page.`;

  return createSeoReport({
    id: randomUUID(),
    site_id: siteId,
    report_type: "missing_pages",
    summary,
    payload,
  });
}

// ── Save location insight report ─────────────────────────────────────────
export async function saveLocationInsightReport(
  siteId: number,
  locationsInsight: {
    name: string;
    address: string;
    city: string;
    views: number;
    searches: number;
    actions: number;
  }[],
) {
  let most_searched_locations = locationsInsight.sort(
    (a: any, b: any) => b.searches - a.searches,
  )[0];

  let most_viewed_locations = locationsInsight.sort(
    (a: any, b: any) => b.views - a.views,
  )[0];

  let most_actioned_locations = locationsInsight.sort(
    (a: any, b: any) => b.actions - a.actions,
  )[0];

  let total_searches = 0;
  let total_views = 0;
  let total_actions = 0;

  locationsInsight.forEach((location) => {
    total_searches += location.searches;
    total_views += location.views;
    total_actions += location.actions;
  });

  const summary = `Location Insight: Total Search = ${total_searches}, Total Views = ${total_views}, Total Actions = ${total_actions}`;

  const payload: LocationInsightPayload = {
    top_searched: most_searched_locations,
    top_viewed: most_viewed_locations,
    top_actioned: most_actioned_locations,
    locations: locationsInsight,
  };

  return createSeoReport({
    id: randomUUID(),
    site_id: siteId,
    report_type: "location_insight",
    summary,
    payload,
  });
}

export async function saveDailyIndexingReport(
  siteId: number,
  indexedUrl: string[],
) {
  const summary = `Indexing: ${indexedUrl.length} URL(s) are indexed.`;

  return createSeoReport({
    id: randomUUID(),
    site_id: siteId,
    report_type: "indexing",
    summary: summary,
    payload: { indexedUrl },
  });
}
