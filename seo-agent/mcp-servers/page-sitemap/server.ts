import * as fs from "node:fs";
import * as path from "node:path";
import { google } from "googleapis";
import { pool } from "../../../db.js";
import { RowDataPacket } from "mysql2/promise";
import { wpFetch } from "../../../libs/wordpress.js";
import { logger } from "../../utils/logger.js";

// ── Env helpers ───────────────────────────────────────────────────────

function getBingKey(): string {
  const key = process.env.BING_WEBMASTER_KEY?.trim();
  if (!key) throw new Error("Missing env var BING_WEBMASTER_KEY");
  return key;
}

async function getSiteDomain(siteId: number): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT domain FROM sites_config WHERE site_id = ? LIMIT 1",
    [siteId],
  );
  if (!rows.length) throw new Error(`No site found for site_id=${siteId}`);
  const domain = rows[0].domain as string;
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

// ── GSC auth (indexing scope) ─────────────────────────────────────────

function getIndexingAuth() {
  const raw = process.env.GSC_OAUTH_SITE;
  if (!raw) throw new Error("Missing env var GSC_OAUTH_SITE");
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/indexing"],
  });
}

function getGscAuth() {
  const raw = process.env.GSC_OAUTH_SITE;
  if (!raw) throw new Error("Missing env var GSC_OAUTH_SITE");
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
}

// ── Pinged-URL file cache ─────────────────────────────────────────────

const CACHE_DIR = "/tmp/cache";

interface PingedEntry {
  url: string;
  pinged_at: string; // ISO date
}

function loadPingedCache(siteId: number): PingedEntry[] {
  const file = path.join(CACHE_DIR, `pinged_site${siteId}.json`);
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, "utf-8");
    const entries: PingedEntry[] = JSON.parse(raw);
    // Prune entries older than 7 days
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return entries.filter((e) => new Date(e.pinged_at).getTime() > cutoff);
  } catch {
    return [];
  }
}

function savePingedCache(siteId: number, entries: PingedEntry[]): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `pinged_site${siteId}.json`);
  fs.writeFileSync(file, JSON.stringify(entries, null, 2), "utf-8");
}

// ── Types ─────────────────────────────────────────────────────────────

export interface SitemapEntry {
  sitemap_url: string;
  submitted: number;
  indexed: number;
  warnings: number;
  errors: number;
  last_submitted?: string;
}

export interface BingSitemapStatus {
  sitemap_url: string;
  is_submitted: boolean;
  last_crawled?: string;
  pages_crawled?: number;
  error?: string;
}

export interface SitemapStatusResult {
  site_id: number;
  site_url: string;
  gsc_sitemaps: SitemapEntry[];
  bing_sitemaps: BingSitemapStatus[];
  total_submitted: number;
  total_indexed: number;
  coverage_pct: number;
  issues: string[];
}

export interface NewPage {
  url: string;
  title: string;
  published_at: string;
}

export interface DetectNewPagesResult {
  site_id: number;
  new_pages: NewPage[];
  count: number;
  already_pinged: number;
}

export interface PingResult {
  url: string;
  gsc_status: "ok" | "error";
  bing_status: "ok" | "error";
  gsc_error?: string;
  bing_error?: string;
}

export interface PingNewPagesResult {
  site_id: number;
  pinged: PingResult[];
  success_count: number;
  error_count: number;
}

// ── get_sitemap_status ────────────────────────────────────────────────

export async function getSitemapStatus(
  siteId: number,
): Promise<SitemapStatusResult> {
  const siteUrl = await getSiteDomain(siteId);
  const issues: string[] = [];

  // ── GSC sitemaps ──────────────────────────────────────────────────
  const gscSitemaps: SitemapEntry[] = [];
  try {
    const auth = getGscAuth();
    const sc = google.searchconsole({ version: "v1", auth });
    const res = await sc.sitemaps.list({ siteUrl });
    const sitemaps = res.data.sitemap ?? [];
    for (const sm of sitemaps) {
      const submitted = sm.contents?.[0]?.submitted
        ? Number(sm.contents[0].submitted)
        : 0;
      const indexed = sm.contents?.[0]?.indexed
        ? Number(sm.contents[0].indexed)
        : 0;
      const warnings = Number(sm.warnings ?? 0);
      const errors = Number(sm.errors ?? 0);
      gscSitemaps.push({
        sitemap_url: sm.path ?? "",
        submitted,
        indexed,
        warnings,
        errors,
        last_submitted: sm.lastSubmitted ?? undefined,
      });
      if (errors > 0) {
        issues.push(`GSC sitemap ${sm.path} has ${errors} error(s)`);
      }
      if (submitted > 0 && indexed / submitted < 0.8) {
        issues.push(
          `GSC sitemap ${sm.path}: only ${indexed}/${submitted} pages indexed (${Math.round((indexed / submitted) * 100)}%)`,
        );
      }
    }
  } catch (err: any) {
    issues.push(`GSC sitemap check failed: ${err.message}`);
  }

  // ── Bing Webmaster sitemaps ───────────────────────────────────────
  const bingSitemaps: BingSitemapStatus[] = [];
  try {
    const bingKey = getBingKey();
    // Try standard sitemap paths
    const candidateUrls = [
      `${siteUrl}/sitemap.xml`,
      `${siteUrl}/sitemap_index.xml`,
    ];
    for (const sitemapUrl of candidateUrls) {
      try {
        const res = await fetch(
          `https://ssl.bing.com/webmaster/api.svc/json/GetSitemap?apikey=${bingKey}&siteUrl=${encodeURIComponent(siteUrl)}&sitemapUrl=${encodeURIComponent(sitemapUrl)}`,
          { headers: { Accept: "application/json" } },
        );
        if (res.ok) {
          const data = (await res.json()) as any;
          bingSitemaps.push({
            sitemap_url: sitemapUrl,
            is_submitted: true,
            last_crawled: data.d?.LastCrawled ?? undefined,
            pages_crawled: data.d?.TotalCount ?? undefined,
          });
        } else {
          bingSitemaps.push({
            sitemap_url: sitemapUrl,
            is_submitted: false,
            error: `HTTP ${res.status}`,
          });
        }
      } catch (err: any) {
        bingSitemaps.push({
          sitemap_url: sitemapUrl,
          is_submitted: false,
          error: err.message,
        });
      }
    }
  } catch (err: any) {
    issues.push(`Bing sitemap check failed: ${err.message}`);
  }

  const totalSubmitted = gscSitemaps.reduce((s, e) => s + e.submitted, 0);
  const totalIndexed = gscSitemaps.reduce((s, e) => s + e.indexed, 0);
  const coveragePct =
    totalSubmitted > 0
      ? Math.round((totalIndexed / totalSubmitted) * 100)
      : 100;

  return {
    site_id: siteId,
    site_url: siteUrl,
    gsc_sitemaps: gscSitemaps,
    bing_sitemaps: bingSitemaps,
    total_submitted: totalSubmitted,
    total_indexed: totalIndexed,
    coverage_pct: coveragePct,
    issues,
  };
}

// ── detect_new_pages ──────────────────────────────────────────────────

export async function detectNewPages(
  siteId: number,
): Promise<DetectNewPagesResult> {
  const pingedCache = loadPingedCache(siteId);
  const pingedUrls = new Set(pingedCache.map((e) => e.url));

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const newPages: NewPage[] = [];

  // Fetch WP pages published in last 24h
  let page = 1;
  let alreadyPinged = 0;
  while (true) {
    const data = (await wpFetch(
      siteId,
      "GET",
      `/pages?status=publish&after=${encodeURIComponent(since)}&per_page=100&page=${page}&_fields=id,link,title,date`,
    )) as any[];
    if (!Array.isArray(data) || data.length === 0) break;

    for (const p of data) {
      const url: string = p.link ?? "";
      const title: string =
        typeof p.title === "object"
          ? (p.title.rendered ?? "")
          : String(p.title ?? "");
      if (!url) continue;
      if (pingedUrls.has(url)) {
        alreadyPinged++;
        continue;
      }
      newPages.push({ url, title, published_at: p.date });
    }

    if (data.length < 100) break;
    page++;
  }

  // Also check posts
  page = 1;
  while (true) {
    const data = (await wpFetch(
      siteId,
      "GET",
      `/posts?status=publish&after=${encodeURIComponent(since)}&per_page=100&page=${page}&_fields=id,link,title,date`,
    )) as any[];
    if (!Array.isArray(data) || data.length === 0) break;

    for (const p of data) {
      const url: string = p.link ?? "";
      const title: string =
        typeof p.title === "object"
          ? (p.title.rendered ?? "")
          : String(p.title ?? "");
      if (!url) continue;
      if (pingedUrls.has(url)) {
        alreadyPinged++;
        continue;
      }
      newPages.push({ url, title, published_at: p.date });
    }

    if (data.length < 100) break;
    page++;
  }

  return {
    site_id: siteId,
    new_pages: newPages,
    count: newPages.length,
    already_pinged: alreadyPinged,
  };
}

// ── ping_new_pages ────────────────────────────────────────────────────

export async function pingNewPages(
  siteId: number,
  urls: string[],
): Promise<PingNewPagesResult> {
  if (urls.length === 0) {
    return { site_id: siteId, pinged: [], success_count: 0, error_count: 0 };
  }

  const siteUrl = await getSiteDomain(siteId);
  const bingKey = process.env.BING_WEBMASTER_KEY?.trim();

  // GSC Indexing API auth
  let indexingToken: string | null = null;
  try {
    const auth = getIndexingAuth();
    const client = await auth.getClient();
    const tokenRes = await (client as any).getAccessToken();
    indexingToken = tokenRes.token ?? null;
  } catch (err: any) {
    logger.error(`[page-sitemap] Could not get Indexing API token: `, err);
  }

  const results: PingResult[] = [];
  const pingedCache = loadPingedCache(siteId);

  for (const url of urls) {
    const result: PingResult = {
      url,
      gsc_status: "error",
      bing_status: "error",
    };

    // ── GSC Indexing API ────────────────────────────────────────────
    if (indexingToken) {
      try {
        const gscRes = await fetch(
          "https://indexing.googleapis.com/v3/urlNotifications:publish",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${indexingToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ url, type: "URL_UPDATED" }),
          },
        );
        if (gscRes.ok) {
          result.gsc_status = "ok";
        } else {
          const errBody = await gscRes.text();
          result.gsc_error = `HTTP ${gscRes.status}: ${errBody.slice(0, 200)}`;
        }
      } catch (err: any) {
        result.gsc_error = err.message;
      }
    } else {
      result.gsc_error = "No Indexing API token available";
    }

    // ── Bing URL Submission ─────────────────────────────────────────
    if (bingKey) {
      try {
        const bingRes = await fetch(
          `https://ssl.bing.com/webmaster/api.svc/json/SubmitUrl?apikey=${bingKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ siteUrl, url }),
          },
        );
        if (bingRes.ok) {
          result.bing_status = "ok";
        } else {
          const errBody = await bingRes.text();
          result.bing_error = `HTTP ${bingRes.status}: ${errBody.slice(0, 200)}`;
        }
      } catch (err: any) {
        result.bing_error = err.message;
      }
    } else {
      result.bing_error = "BING_WEBMASTER_KEY not set";
    }

    results.push(result);

    // Record as pinged regardless of partial success (avoids retry spam)
    pingedCache.push({ url, pinged_at: new Date().toISOString() });
  }

  savePingedCache(siteId, pingedCache);

  const successCount = results.filter(
    (r) => r.gsc_status === "ok" || r.bing_status === "ok",
  ).length;

  return {
    site_id: siteId,
    pinged: results,
    success_count: successCount,
    error_count: results.length - successCount,
  };
}
