import { pool } from "../../../db.js";
import { RowDataPacket } from "mysql2/promise";
import { getDomain } from "../../../libs/functions.js";
import { logger } from "../../utils/logger.js";
import { getSitesBacklinks } from "../../services/dataForSEO.service.js";

// ── DataForSEO helpers ────────────────────────────────────────────────

function dfsAuth(): string {
  const user = process.env.DATAFORSEO_USERNAME;
  const pass = process.env.DATAFORSEO_PASSWORD;
  if (!user || !pass)
    throw new Error("Missing DATAFORSEO_USERNAME or DATAFORSEO_PASSWORD");
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

function dfsBase(): string {
  return (
    process.env.DATAFORSEO_BASEURL ?? "https://api.dataforseo.com/v3"
  ).replace(/\/$/, "");
}

async function dfsPost<T = any>(endpoint: string, body: object[]): Promise<T> {
  const res = await fetch(`${dfsBase()}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: dfsAuth(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`DataForSEO ${endpoint} error ${res.status}: ${msg}`);
  }
  return res.json() as Promise<T>;
}

// ── Domain helper ─────────────────────────────────────────────────────
async function getSiteDomain(siteId: number): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT domain FROM sites_config WHERE site_id = ? LIMIT 1",
    [siteId],
  );
  if (!rows.length) throw new Error(`No site found for site_id=${siteId}`);
  return getDomain(rows[0].domain) as string;
}

// ── Types ─────────────────────────────────────────────────────────────

export interface BacklinkItem {
  url_from: string;
  domain_from: string;
  url_to: string;
  anchor: string;
  domain_rank: number;
  first_seen: string | null;
  last_seen: string | null;
  is_dofollow: boolean;
  spam_score: number;
  domain_from_rank: number;
  is_new: boolean;
  is_lost: boolean;
  is_broken: boolean;
  anchor_details: Record<string, any>;
}

export interface NewBacklinksResult {
  site_id: number;
  domain: string;
  days: number;
  backlinks: BacklinkItem[];
  count: number;
}

export interface LostBacklinksResult {
  site_id: number;
  domain: string;
  days: number;
  backlinks: BacklinkItem[];
  count: number;
}

export interface ToxicLinksResult {
  site_id: number;
  domain: string;
  toxic_links: BacklinkItem[];
  count: number;
  spam_threshold: number;
}

export interface WeeklyVelocity {
  date: string;
  new_referring_domains: number;
  lost_referring_domains: number;
  net_change: number;
}

export interface LinkVelocityResult {
  site_id: number;
  domain: string;
  weekly_velocity: WeeklyVelocity[];
  avg_weekly_gain: number;
  avg_weekly_loss: number;
  trend: "growing" | "declining" | "stable";
}

// ── Shared backlink mapper ────────────────────────────────────────────

function mapBacklink(item: any): BacklinkItem {
  return {
    url_from: item.url_from ?? "",
    domain_from: item.domain_from ?? "",
    url_to: item.url_to ?? "",
    anchor: item.anchor ?? "",
    domain_rank: item.domain_from_rank ?? item.rank ?? 0,
    first_seen: new Date(item.first_seen).toISOString() || null,
    last_seen: new Date(item.last_seen).toISOString() || null,
    is_dofollow: item.dofollow ?? !(item.nofollow ?? false),
    spam_score: item.backlink_spam_score ?? 0,
    domain_from_rank: item.domain_from_rank || null,
    is_new: item.is_new,
    is_lost: item.is_lost,
    is_broken: item.is_broken,
    anchor_details: {
      type: item.item_type,
      text: item.anchor || "",
      image: item.image_url || "",
    },
  };
}

// ── get_new_backlinks ─────────────────────────────────────────────────

export async function getNewBacklinks(
  siteId: number,
  days: number = 7,
): Promise<NewBacklinksResult | void> {
  const domain = await getSiteDomain(siteId);
  if (!domain) {
    logger.error(`[backlink-monitor:new] Invalid domain for site_id=${siteId}`);
    return;
  }
  const dateFrom =
    new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0] + " 00:00:00 +00:00";

  logger.info(
    `[backlink-monitor:new] site_id=${siteId} domain=${domain} days=${days} from=${dateFrom}`,
  );

  const data = await getSitesBacklinks({
    target: domain,
    limit: 50,
    order_by: ["domain_from_rank,asc"],
    filters: [["first_seen", ">=", dateFrom], "and", ["is_lost", "=", false]],
  });

  const items: BacklinkItem[] = (data ?? []).map(mapBacklink);

  return {
    site_id: siteId,
    domain,
    days,
    backlinks: items,
    count: items.length,
  };
}

// ── get_lost_backlinks ────────────────────────────────────────────────

export async function getLostBacklinks(
  siteId: number,
  days: number = 7,
): Promise<LostBacklinksResult | void> {
  const domain = await getSiteDomain(siteId);
  const dateFrom =
    new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0] + " 00:00:00 +00:00";

  logger.info(
    `[backlink-monitor:lost] site_id=${siteId} domain=${domain} days=${days} from=${dateFrom}`,
  );

  const data = await getSitesBacklinks({
    target: domain,
    limit: 50,
    order_by: ["domain_from_rank,desc"],
    backlinks_status_type: "lost",
    filters: [["is_lost", "=", true], "and", ["last_seen", ">=", dateFrom]],
  });

  const items: BacklinkItem[] = (data ?? []).map(mapBacklink);

  return {
    site_id: siteId,
    domain,
    days,
    backlinks: items,
    count: items.length,
  };
}

// ── get_toxic_links ───────────────────────────────────────────────────

const SPAM_THRESHOLD = 60;

export async function getToxicLinks(
  siteId: number,
): Promise<ToxicLinksResult | void> {
  const domain = await getSiteDomain(siteId);

  logger.info(
    `[backlink-monitor:toxic] site_id=${siteId} domain=${domain} spam_threshold=${SPAM_THRESHOLD}`,
  );

  const data = await getSitesBacklinks({
    target: domain,
    limit: 100,
    order_by: ["backlink_spam_score,desc"],
    filters: [
      ["backlink_spam_score", ">", SPAM_THRESHOLD],
      "and",
      ["is_lost", "=", false],
    ],
  });

  const items: BacklinkItem[] = (data ?? []).map(mapBacklink);

  return {
    site_id: siteId,
    domain,
    toxic_links: items,
    count: items.length,
    spam_threshold: SPAM_THRESHOLD,
  };
}

// ── get_link_velocity ─────────────────────────────────────────────────

export async function getLinkVelocity(
  siteId: number,
  days: number = 7,
): Promise<LinkVelocityResult | void> {
  const domain = await getSiteDomain(siteId);
  // 7 days of history
  const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const dateTo = new Date().toISOString().split("T")[0];

  logger.info(`[backlink-monitor:velocity] site_id=${siteId} domain=${domain}`);

  try {
    const data = await dfsPost("/backlinks/timeseries_new_lost_summary/live", [
      {
        target: domain,
        date_from: dateFrom,
        date_to: dateTo,
        group_range: "day",
      },
    ]);

    const rawItems: any[] = data?.tasks?.[0]?.result?.[0]?.items ?? [];

    const weeklyVelocity: WeeklyVelocity[] = rawItems.map((item: any) => ({
      date: item.date ?? "",
      new_referring_domains: item.new_referring_domains ?? 0,
      lost_referring_domains: item.lost_referring_domains ?? 0,
      net_change:
        (item.new_referring_domains ?? 0) - (item.lost_referring_domains ?? 0),
    }));

    const gains = weeklyVelocity.map((w) => w.new_referring_domains);
    const losses = weeklyVelocity.map((w) => w.lost_referring_domains);
    const avgGain =
      gains.length > 0
        ? Math.round(gains.reduce((a, b) => a + b, 0) / gains.length)
        : 0;
    const avgLoss =
      losses.length > 0
        ? Math.round(losses.reduce((a, b) => a + b, 0) / losses.length)
        : 0;

    // Trend: compare first half vs second half net change
    let trend: "growing" | "declining" | "stable" = "stable";
    if (weeklyVelocity.length >= 4) {
      const mid = Math.floor(weeklyVelocity.length / 2);
      const firstHalfNet = weeklyVelocity
        .slice(0, mid)
        .reduce((s, w) => s + w.net_change, 0);
      const secondHalfNet = weeklyVelocity
        .slice(mid)
        .reduce((s, w) => s + w.net_change, 0);
      if (secondHalfNet > firstHalfNet + 2) trend = "growing";
      else if (secondHalfNet < firstHalfNet - 2) trend = "declining";
    }

    return {
      site_id: siteId,
      domain,
      weekly_velocity: weeklyVelocity,
      avg_weekly_gain: avgGain,
      avg_weekly_loss: avgLoss,
      trend,
    };
  } catch (err) {
    logger.error("[backlink-monitor:velocity] Error : ", err);
    return;
  }
}
