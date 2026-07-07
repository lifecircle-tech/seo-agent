import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db.js";

// ── Report types ──────────────────────────────────────────────────────

export type ReportType = "backlinks" | "sitemap_ads" | "missing_pages";

// ── Backlinks payload ─────────────────────────────────────────────────

export interface BacklinkEntry {
  url_from: string;
  domain_from: string;
  url_to: string;
  anchor: string;
  domain_rank: number;
  spam_score: number;
  is_dofollow: boolean;
  first_seen: string | null;
  last_seen: string | null;
}

export interface WeeklyVelocityEntry {
  date: string;
  new_referring_domains: number;
  lost_referring_domains: number;
  net_change: number;
}

export interface BacklinksPayload {
  new_count: number;
  lost_count: number;
  toxic_count: number;
  trend: string;
  avg_weekly_gain: number;
  avg_weekly_loss: number;
  weekly_velocity: WeeklyVelocityEntry[];
  new_backlinks: BacklinkEntry[];
  lost_backlinks: BacklinkEntry[];
  toxic_links: BacklinkEntry[];
  prospects: string[];
  competitors_checked: string[];
}

// ── Sitemap & Ads payload ─────────────────────────────────────────────

export interface SitemapEntry {
  sitemap_url: string;
  submitted: number;
  indexed: number;
  warnings: number;
  errors: number;
  last_submitted?: string;
}

export interface BingSitemapEntry {
  sitemap_url: string;
  is_submitted: boolean;
  last_crawled?: string;
  pages_crawled?: number;
  error?: string;
}

export interface PingResultEntry {
  url: string;
  gsc_status: string;
  bing_status: string;
  gsc_error?: string;
  bing_error?: string;
}

export interface ConvertingKeyword {
  keyword: string;
  conversions: number;
  cost_inr: number;
  cpa_inr: number;
  clicks: number;
  impressions: number;
  ctr_pct: number;
}

export interface WastedKeyword {
  keyword: string;
  cost_inr: number;
  clicks: number;
  impressions: number;
  ctr_pct: number;
}

export interface QualityIssue {
  keyword: string;
  quality_score: number;
  creative_quality: string;
  landing_page_quality: string;
  expected_ctr: string;
  impressions: number;
}

export interface SitemapAdsPayload {
  // sitemap
  coverage_pct: number;
  total_submitted: number;
  total_indexed: number;
  issues: string[];
  gsc_sitemaps: SitemapEntry[];
  bing_sitemaps: BingSitemapEntry[];
  // indexing pings
  new_pages_count: number;
  already_pinged: number;
  pinged_count: number;
  ping_success_count: number;
  ping_error_count: number;
  ping_results: PingResultEntry[];
  // ads
  total_conversions: number;
  total_cost_inr: number;
  total_wasted_inr: number;
  wasted_keyword_count: number;
  avg_quality_score: number;
  critical_qs_count: number;
  poor_qs_count: number;
  top_keywords: ConvertingKeyword[];
  wasted_keywords: WastedKeyword[];
  quality_issues: QualityIssue[];
}

// ── Missing pages payload ─────────────────────────────────────────────

export interface MissingCityEntry {
  city: string;
  state: string;
  country: string;
  missingServices: string[];
  normalized_slug: string;
}

export interface MissingPagesPayload {
  total_cities: number;
  missing_count: number;
  missing_cities: MissingCityEntry[];
}

// ── Discriminated union ───────────────────────────────────────────────

export type ReportPayload =
  | BacklinksPayload
  | SitemapAdsPayload
  | MissingPagesPayload;

// ── DB Row types ──────────────────────────────────────────────────────

export interface SeoReport extends RowDataPacket {
  id: string;
  site_id: number;
  report_type: ReportType;
  summary: string;
  data: ReportPayload | string;
  created_at: Date;
}

export interface SeoReportJSON {
  id: string;
  site_id: number;
  report_type: ReportType;
  summary: string;
  data: ReportPayload;
  created_at: string;
}

// ── Table creation ────────────────────────────────────────────────────

export async function createSeoReportsTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS seo_reports (
        id           VARCHAR(36)  NOT NULL PRIMARY KEY,
        site_id      INT          NOT NULL,
        report_type  VARCHAR(32)  NOT NULL,
        summary      VARCHAR(512) NOT NULL DEFAULT '',
        data         JSON         NOT NULL,
        created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX idx_seo_reports_site_type       (site_id, report_type),
        INDEX idx_seo_reports_site_created_at (site_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (err) {
    console.error("[seo_reports] Error creating table:", err);
    throw err;
  }
}
