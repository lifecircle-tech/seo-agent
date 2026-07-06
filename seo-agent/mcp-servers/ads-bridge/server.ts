// ── READ-ONLY guard ───────────────────────────────────────────────────
// This module ONLY reads Google Ads data via GAQL.
// It must NEVER mutate campaigns, ad groups, ads, bids, budgets, or any
// Google Ads entity. All functions are SELECT-only queries.
// ─────────────────────────────────────────────────────────────────────

import { google } from "googleapis";

// ── OAuth2 client (GBP credentials + auto token refresh) ─────────────

function getOAuth2Client() {
  const raw = process.env.GBP_OAUTH_SITE;
  const clientId = process.env.GBP_CLIENT_ID?.trim();
  const clientSecret = process.env.GBP_CLIENT_SECRET?.trim();

  if (!raw) throw new Error("Missing env var GBP_OAUTH_SITE");
  if (!clientId) throw new Error("Missing env var GBP_CLIENT_ID");
  if (!clientSecret) throw new Error("Missing env var GBP_CLIENT_SECRET");

  const { access_token, refresh_token } = JSON.parse(raw) as {
    access_token: string;
    refresh_token: string;
  };

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token });
  return oauth2;
}

async function getAccessToken(): Promise<string> {
  const client = getOAuth2Client();
  const res = await client.getAccessToken();
  if (!res.token) throw new Error("Failed to obtain Google Ads access token");
  return res.token;
}

function getDeveloperToken(): string {
  const token = process.env.GOOGLE_ADS_TOKEN?.trim();
  if (!token) throw new Error("Missing env var GOOGLE_ADS_TOKEN");
  return token;
}

function getCustomerId(): string {
  const raw =
    process.env[`ADS_ACCOUNT_SITE`]?.trim() ??
    process.env.ADS_ACCOUNT_SITE?.trim();
  if (!raw) {
    throw new Error(`Missing env var ADS_ACCOUNT_SITE (or ADS_ACCOUNT_SITE)`);
  }
  return raw.replace(/-/g, "");
}

// ── GAQL query runner (READ-ONLY) ─────────────────────────────────────

interface GaqlRow {
  [key: string]: any;
}

async function runGaql(query: string): Promise<GaqlRow[]> {
  const [accessToken, developerToken, customerId] = await Promise.all([
    getAccessToken(),
    Promise.resolve(getDeveloperToken()),
    Promise.resolve(getCustomerId()),
  ]);

  const managerCustomerId =
    process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID?.trim().replace(/-/g, "");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  if (managerCustomerId) {
    headers["login-customer-id"] = managerCustomerId;
  }

  const url = `https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:search`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(
      `Google Ads API error ${res.status}: ${errBody}`,
    );
  }

  const data = (await res.json()) as {
    results?: GaqlRow[];
    nextPageToken?: string;
  };
  let rows = data.results ?? [];

  // Paginate
  let nextPageToken = data.nextPageToken;
  while (nextPageToken) {
    const pageRes = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, pageToken: nextPageToken }),
    });
    if (!pageRes.ok) break;
    const pageData = (await pageRes.json()) as {
      results?: GaqlRow[];
      nextPageToken?: string;
    };
    rows = rows.concat(pageData.results ?? []);
    nextPageToken = pageData.nextPageToken;
  }

  return rows;
}

// ── Types ─────────────────────────────────────────────────────────────

export interface ConvertingKeyword {
  keyword: string;
  conversions: number;
  cost_inr: number;
  cpa_inr: number;
  clicks: number;
  impressions: number;
  ctr_pct: number;
}

export interface TopConvertingKeywordsResult {
  site_id: number;
  keywords: ConvertingKeyword[];
  total_conversions: number;
  total_cost_inr: number;
}

export interface WastedSpendKeyword {
  keyword: string;
  cost_inr: number;
  clicks: number;
  impressions: number;
  ctr_pct: number;
}

export interface WastedSpendResult {
  site_id: number;
  keywords: WastedSpendKeyword[];
  total_wasted_inr: number;
  keyword_count: number;
}

export interface QualityScoreIssue {
  keyword: string;
  quality_score: number;
  creative_quality: string;
  landing_page_quality: string;
  expected_ctr: string;
  impressions: number;
}

export interface QualityScoreResult {
  site_id: number;
  issues: QualityScoreIssue[];
  avg_quality_score: number;
  critical_count: number; // QS <= 3
  poor_count: number; // QS 4–5
}

// ── get_top_converting_keywords ───────────────────────────────────────

export async function getTopConvertingKeywords(
  siteId: number,
): Promise<TopConvertingKeywordsResult> {
  const query = `
    SELECT
      ad_group_criterion.keyword.text,
      metrics.conversions,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions
    FROM keyword_view
    WHERE segments.date DURING LAST_30_DAYS
      AND metrics.conversions > 0
      AND ad_group_criterion.status = 'ENABLED'
      AND ad_group.status = 'ENABLED'
      AND campaign.status = 'ENABLED'
    ORDER BY metrics.conversions DESC
    LIMIT 20
  `.trim();

  const rows = await runGaql(query);

  const keywords: ConvertingKeyword[] = rows.map((row) => {
    const costMicros = Number(row.metrics?.costMicros ?? 0);
    const conversions = Number(row.metrics?.conversions ?? 0);
    const clicks = Number(row.metrics?.clicks ?? 0);
    const impressions = Number(row.metrics?.impressions ?? 0);
    const costInr = costMicros / 1_000_000;
    return {
      keyword: row.adGroupCriterion?.keyword?.text ?? "",
      conversions,
      cost_inr: Math.round(costInr * 100) / 100,
      cpa_inr:
        conversions > 0 ? Math.round((costInr / conversions) * 100) / 100 : 0,
      clicks,
      impressions,
      ctr_pct:
        impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
    };
  });

  return {
    site_id: siteId,
    keywords,
    total_conversions: keywords.reduce((s, k) => s + k.conversions, 0),
    total_cost_inr:
      Math.round(keywords.reduce((s, k) => s + k.cost_inr, 0) * 100) / 100,
  };
}

// ── get_wasted_spend ──────────────────────────────────────────────────

export async function getWastedSpend(
  siteId: number,
): Promise<WastedSpendResult> {
  const query = `
    SELECT
      ad_group_criterion.keyword.text,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions
    FROM keyword_view
    WHERE segments.date DURING LAST_30_DAYS
      AND metrics.cost_micros > 0
      AND metrics.conversions = 0
      AND ad_group_criterion.status = 'ENABLED'
      AND ad_group.status = 'ENABLED'
      AND campaign.status = 'ENABLED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 20
  `.trim();

  const rows = await runGaql(query);

  const keywords: WastedSpendKeyword[] = rows.map((row) => {
    const costMicros = Number(row.metrics?.costMicros ?? 0);
    const clicks = Number(row.metrics?.clicks ?? 0);
    const impressions = Number(row.metrics?.impressions ?? 0);
    const costInr = costMicros / 1_000_000;
    return {
      keyword: row.adGroupCriterion?.keyword?.text ?? "",
      cost_inr: Math.round(costInr * 100) / 100,
      clicks,
      impressions,
      ctr_pct:
        impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
    };
  });

  return {
    site_id: siteId,
    keywords,
    total_wasted_inr:
      Math.round(keywords.reduce((s, k) => s + k.cost_inr, 0) * 100) / 100,
    keyword_count: keywords.length,
  };
}

// ── get_quality_score_issues ──────────────────────────────────────────

export async function getQualityScoreIssues(
  siteId: number,
): Promise<QualityScoreResult> {
  const query = `
    SELECT
      ad_group_criterion.keyword.text,
      ad_group_criterion.quality_info.quality_score,
      ad_group_criterion.quality_info.creative_quality_score,
      ad_group_criterion.quality_info.post_click_quality_score,
      ad_group_criterion.quality_info.search_predicted_ctr,
      metrics.impressions
    FROM keyword_view
    WHERE segments.date DURING LAST_30_DAYS
      AND ad_group_criterion.quality_info.quality_score < 6
      AND ad_group_criterion.quality_info.quality_score > 0
      AND ad_group_criterion.status = 'ENABLED'
      AND ad_group.status = 'ENABLED'
      AND campaign.status = 'ENABLED'
    ORDER BY ad_group_criterion.quality_info.quality_score ASC
    LIMIT 50
  `.trim();

  const rows = await runGaql(query);

  const issues: QualityScoreIssue[] = rows.map((row) => ({
    keyword: row.adGroupCriterion?.keyword?.text ?? "",
    quality_score: Number(row.adGroupCriterion?.qualityInfo?.qualityScore ?? 0),
    creative_quality:
      row.adGroupCriterion?.qualityInfo?.creativeQualityScore ?? "UNKNOWN",
    landing_page_quality:
      row.adGroupCriterion?.qualityInfo?.postClickQualityScore ?? "UNKNOWN",
    expected_ctr:
      row.adGroupCriterion?.qualityInfo?.searchPredictedCtr ?? "UNKNOWN",
    impressions: Number(row.metrics?.impressions ?? 0),
  }));

  const avgQs =
    issues.length > 0
      ? Math.round(
          (issues.reduce((s, i) => s + i.quality_score, 0) / issues.length) *
            10,
        ) / 10
      : 0;

  return {
    site_id: siteId,
    issues,
    avg_quality_score: avgQs,
    critical_count: issues.filter((i) => i.quality_score <= 3).length,
    poor_count: issues.filter(
      (i) => i.quality_score >= 4 && i.quality_score <= 5,
    ).length,
  };
}
