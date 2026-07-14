import {
  getGbpAccountsClient,
  getGbpLocationsClient,
  getGbpPerformaceClient,
} from "../../../libs/google.js";
import { logger } from "../../utils/logger.js";
import { createApprovalQueue } from "../cms-connector/server.js";

const GBP_BASE = "https://mybusiness.googleapis.com/v4";

const SiteId: Record<number, string> = {
  1: "Life Circle",
  3: "CareVidya",
};

// ── Auth ──────────────────────────────────────────────────────────────

interface GbpCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

interface TokenState {
  access_token: string;
  expires_at: number; // ms epoch
}

let _token: TokenState | null = null;

function getGbpCredentials(): GbpCredentials {
  const raw = process.env.GBP_OAUTH_SITE;
  if (!raw) throw new Error("Missing env var GBP_OAUTH_SITE");
  return JSON.parse(raw) as GbpCredentials;
}

export async function getGbpAccessToken(): Promise<string> {
  const now = Date.now();
  // Reuse cached token if it expires more than 60s from now
  if (_token && _token.expires_at > now + 60_000) {
    return _token.access_token;
  }

  const creds = getGbpCredentials();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GBP token refresh failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  _token = {
    access_token: data.access_token,
    expires_at: now + data.expires_in * 1000,
  };
  return _token.access_token;
}

// ── Shared fetch helper ───────────────────────────────────────────────

export async function gbpFetch(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const token = await getGbpAccessToken();
  const url = path.startsWith("http") ? path : `${GBP_BASE}${path}`;
  logger.info(`============= GBP Fetching ${url} ***************`);

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });

  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const text = await res.text();
    throw new Error(`GBP non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const errMsg =
      ((data.error as Record<string, unknown>)?.message as string) ??
      res.statusText;
    throw new Error(`GBP API ${res.status}: ${errMsg}`);
  }

  return data;
}

// ── Account helper ────────────────────────────────────────────────────

async function getGbpAccountName(): Promise<any[]> {
  logger.info("============= GBP Getting Account Name ***************");
  const businessAccount = getGbpAccountsClient();

  const data = (await businessAccount.accounts.list()).data as {
    accounts?: Array<{ name: string; type?: string }>;
  };
  const accounts = data.accounts ?? [];
  logger.info("============= Fetched GBP Accounts ***************");
  if (!accounts.length) throw new Error("No GBP accounts found");
  // Prefer business/location group accounts over personal
  return accounts ?? [];
}

// ── Tool: list_locations ──────────────────────────────────────────────

export async function listLocations(
  siteId: number,
  siteName?: string,
): Promise<{
  locations: Array<{
    accountName: string;
    location_id: string;
    name: string;
    address: string;
    city: string;
  }>;
}> {
  logger.info(`[gbp] listLocations site_id=${siteId}`);
  const account = await getGbpAccountName();
  logger.info(`[gbp] account = ${account.length}`);

  const businessInfo = getGbpLocationsClient();

  const data = { locations: [] } as {
    locations?: Array<{
      accountName: string;
      locationName: string;
      name: string;
      title: string;
      storefrontAddress: Record<string, any>;
    }>;
  };

  for await (let acc of account) {
    const response = (
      await businessInfo.accounts.locations.list({
        pageSize: 50,
        parent: acc.name, // Expected format: 'accounts/{account_id}'
        readMask: "name,title,storefrontAddress", // Restricts return object to your fields
      })
    ).data as {
      locations?: Array<{
        locationName: string;
        name: string;
        title: string;
        storefrontAddress: Record<string, any>;
      }>;
    };
    data.locations?.push(
      ...(response.locations ?? []).map((loc) => ({
        accountName: acc.name,
        ...loc,
      })),
    );
  }

  const locations = (data.locations ?? [])
    .filter((loc) => loc.title.includes(SiteId[siteId]))
    .map((loc) => ({
      accountName: loc.accountName,
      location_id: loc.name, // full resource name: "accounts/123/locations/456"
      name: loc.title ?? loc.locationName ?? loc.name,
      address: loc.storefrontAddress?.addressLines?.join(", ") ?? "",
      city: loc.storefrontAddress?.locality ?? "",
    }));

  logger.info(`[gbp] listLocations found ${locations.length} locations`);

  return { locations };
}

// ── Tool: create_post ─────────────────────────────────────────────────
// NEVER publishes directly — always queues for dashboard approval first.

export async function createPost(
  siteId: number,
  locationId: string,
  content: string,
  mediaUrl?: string,
): Promise<{
  site_id: number;
  location_id: string;
  queued: number;
  approval_id?: string;
}> {
  logger.info(`[gbp] createPost site_id=${siteId} location=${locationId}`);

  const postBody: Record<string, unknown> = {
    languageCode: "en",
    summary: content,
    topicType: "STANDARD",
  };
  if (mediaUrl) {
    postBody.media = [{ mediaFormat: "PHOTO", sourceUrl: mediaUrl }];
  }

  const result = await createApprovalQueue([
    {
      site_id: siteId,
      module: "gbp-manager",
      type: "gbp_post",
      priority: 2,
      title: `GBP Post — ${content.slice(0, 60)}`,
      original_content: { location_id: locationId },
      suggested_content: { location_id: locationId, post_body: postBody },
    },
  ]);

  const approvalId = (result.results[0] as Record<string, unknown>)?.id as
    | string
    | undefined;
  logger.info(`[gbp] createPost queued approval_id=${approvalId}`);
  return {
    site_id: siteId,
    location_id: locationId,
    queued: result.queued,
    approval_id: approvalId,
  };
}

// ── Tool: get_insights ────────────────────────────────────────────────

export async function getInsights(
  siteId: number,
  locationId: string,
  days: number,
): Promise<{
  location_id: string;
  days: number;
  views: number;
  searches: number;
  actions: number;
}> {
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error("days must be an integer between 1 and 90");
  }
  const VIEWS_METRICS = [
    "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
    "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
    "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
    "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  ];
  const ACTIONS_METRICS = [
    "WEBSITE_CLICKS",
    "CALL_CLICKS",
    "BUSINESS_DIRECTION_REQUESTS",
    "BUSINESS_CONVERSATIONS",
  ];

  logger.info(
    `[gbp] getInsights site_id=${siteId} location=${locationId} days=${days}`,
  );

  const endTime = new Date();
  const startTime = new Date();
  startTime.setDate(endTime.getDate() - days);

  let viewsCount = 0;
  let actionsCount = 0;
  let searchCount = 0;

  const gbpPerformanceClient = await getGbpPerformaceClient();

  try {
    const metricsResponse =
      await gbpPerformanceClient.locations.fetchMultiDailyMetricsTimeSeries({
        location: locationId,
        dailyMetrics: [...VIEWS_METRICS, ...ACTIONS_METRICS],
        "dailyRange.startDate.year": startTime.getFullYear(),
        "dailyRange.startDate.month": startTime.getMonth() + 1,
        "dailyRange.startDate.day": startTime.getDate(),
        "dailyRange.endDate.year": endTime.getFullYear(),
        "dailyRange.endDate.month": endTime.getMonth() + 1,
        "dailyRange.endDate.day": endTime.getDate(),
      });

    const metricsData =
      metricsResponse.data.multiDailyMetricTimeSeries?.[0]
        .dailyMetricTimeSeries ?? [];

    metricsData?.forEach((metric) => {
      if (VIEWS_METRICS.includes(metric.dailyMetric as string)) {
        viewsCount +=
          metric.timeSeries?.datedValues?.reduce(
            (sum, m) => sum + (Number(m.value) || 0),
            0,
          ) ?? 0;
      } else if (ACTIONS_METRICS.includes(metric.dailyMetric as string)) {
        actionsCount +=
          metric.timeSeries?.datedValues?.reduce(
            (sum, m) => sum + (Number(m.value) || 0),
            0,
          ) ?? 0;
      }
    });

    const searchResponse =
      await gbpPerformanceClient.locations.searchkeywords.impressions.monthly.list(
        {
          parent: locationId,
          "monthlyRange.startMonth.year": startTime.getFullYear(),
          "monthlyRange.startMonth.month": startTime.getMonth() + 1,
          "monthlyRange.startMonth.day": startTime.getDate(),
          "monthlyRange.endMonth.year": endTime.getFullYear(),
          "monthlyRange.endMonth.month": endTime.getMonth() + 1,
          "monthlyRange.endMonth.day": endTime.getDate(),
        },
      );

    const searchData = searchResponse.data.searchKeywordsCounts;
    searchCount = searchData
      ? searchData.reduce(
          (sum, search) => sum + (Number(search.insightsValue?.value) || 0),
          0,
        )
      : 0;
  } catch (err: any) {
    logger.error(`Insight Error ${err.message}`, err);
  }

  return {
    location_id: locationId,
    days,
    views: viewsCount,
    searches: searchCount,
    actions: actionsCount,
  };
}

// ── Tool: publish_post ────────────────────────────────────────────────
// Only executes after the approval has been marked 'approved' in the dashboard.

export async function publishPost(approvalId: string): Promise<{
  ok: boolean;
  approval_id: string;
  post_name?: string;
}> {
  logger.info(`[gbp] publishPost approval_id=${approvalId}`);

  const apiUrl = process.env.BACKEND_API_URL ?? "http://localhost:3002";
  const res = await fetch(`${apiUrl}/approvals/${approvalId}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok)
    throw new Error(`Approval ${approvalId} not found (${res.status})`);

  const approval = (await res.json()) as {
    status: string;
    type: string;
    updated_content?: Record<string, unknown>;
  };

  if (approval.status !== "approved") {
    throw new Error(
      `Approval ${approvalId} is not approved (status: ${approval.status})`,
    );
  }
  if (approval.type !== "gbp_post") {
    throw new Error(`Approval ${approvalId} type is not gbp_post`);
  }

  const locationId = approval.updated_content?.location_id as
    | string
    | undefined;
  const postBody = approval.updated_content?.post_body as
    | Record<string, unknown>
    | undefined;
  if (!locationId || !postBody) {
    throw new Error(`Approval ${approvalId} missing location_id or post_body`);
  }

  const data = (await gbpFetch(`/${locationId}/localPosts`, {
    method: "POST",
    body: JSON.stringify(postBody),
  })) as { name?: string };

  logger.info(`[gbp] publishPost published post_name=${data.name}`);
  return { ok: true, approval_id: approvalId, post_name: data.name };
}
