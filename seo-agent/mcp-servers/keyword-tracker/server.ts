import { getSearchConsoleClient } from "../../../libs/google.js";

export function validateSiteId(siteId: unknown): number {
  const id = Number(siteId);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(`Invalid site_id: ${siteId}. Must be a positive integer.`);
  }
  return id;
}

// ── Tool implementations ──────────────────────────────────────────────

export async function getRankings(siteId: number, siteUrl: string, keywords: string[]) {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    throw new Error("keywords must be a non-empty array");
  }

  console.log(
    "============= Ranking GSC Auth *************** site_id:",
    siteId,
  );
  const searchConsole = getSearchConsoleClient();

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 28);

  const fmt = (d: Date) => d.toISOString().split("T")[0];

  console.log("============= Ranking GSC Search Query ***************");
  const results = await Promise.all(
    keywords.slice(0, 200).map(async (keyword) => {
      const response = await searchConsole.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: fmt(startDate),
          endDate: fmt(endDate),
          dimensions: ["query"],
          dimensionFilterGroups: [
            {
              filters: [
                { dimension: "query", operator: "equals", expression: keyword },
              ],
            },
          ],
          rowLimit: 1,
        },
      });

      const row = response.data.rows?.[0];
      return {
        keyword,
        position: row?.position ?? null,
        clicks: row?.clicks ?? 0,
        impressions: row?.impressions ?? 0,
        ctr: row?.ctr ?? 0,
      };
    }),
  );

  console.log(
    "============= GSC Search Query Results ***************",
    results.length,
  );
  return { site_id: siteId, site_url: siteUrl, rankings: results };
}

export async function getRankingHistory(
  siteId: number,
  siteUrl: string,
  keyword: string,
  days: number,
) {
  if (!keyword || typeof keyword !== "string") {
    throw new Error("keyword must be a non-empty string");
  }
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("days must be an integer between 1 and 365");
  }

  console.log(
    "============= Ranking History GSC Auth *************** site_id:",
    siteId,
  );
  const searchConsole = getSearchConsoleClient();

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);

  const fmt = (d: Date) => d.toISOString().split("T")[0];

  console.log(
    "============= Ranking History GSC Search Query *************** site_id:",
    siteId,
  );
  const response = await searchConsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ["query", "date"],
      dimensionFilterGroups: [
        {
          filters: [
            { dimension: "query", operator: "equals", expression: keyword },
          ],
        },
      ],
      rowLimit: days,
    },
  });

  const history = (response.data.rows ?? []).map((row) => ({
    date: row.keys?.[1] ?? "",
    position: row.position ?? null,
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
  }));

  // Sort ascending by date
  history.sort((a, b) => a.date.localeCompare(b.date));
  console.log(
    "============= Ranking History GSC Results ***************",
    history.length,
  );

  return { site_id: siteId, site_url: siteUrl, keyword, days, history };
}

export async function getTopMovers(
  siteId: number,
  siteUrl: string,
  threshold: number,
  direction: "up" | "down" | "both",
) {
  if (typeof threshold !== "number" || threshold <= 0) {
    throw new Error("threshold must be a positive number");
  }
  if (!["up", "down", "both"].includes(direction)) {
    throw new Error('direction must be "up", "down", or "both"');
  }

  console.log("============= Top GSC Auth *************** site_id:", siteId);
  const searchConsole = getSearchConsoleClient();

  const fmt = (d: Date) => d.toISOString().split("T")[0];

  // Current period: last 7 days
  const endCurrent = new Date();
  const startCurrent = new Date();
  startCurrent.setDate(endCurrent.getDate() - 7);

  // Previous period: 8–14 days ago
  const endPrev = new Date();
  endPrev.setDate(endPrev.getDate() - 8);
  const startPrev = new Date();
  startPrev.setDate(endPrev.getDate() - 6);

  console.log("============ Top GSC Search Query ***************");
  const [currentRes, prevRes] = await Promise.all([
    searchConsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: fmt(startCurrent),
        endDate: fmt(endCurrent),
        dimensions: ["query"],
        rowLimit: 500,
      },
    }),
    searchConsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: fmt(startPrev),
        endDate: fmt(endPrev),
        dimensions: ["query"],
        rowLimit: 500,
      },
    }),
  ]);

  const currentMap = new Map();
  for (const row of currentRes.data.rows ?? []) {
    const kw = row.keys?.[0];
    if (kw && row.position != null) currentMap.set(kw, row.position);
  }

  const prevMap = new Map();
  for (const row of prevRes.data.rows ?? []) {
    const kw = row.keys?.[0];
    if (kw && row.position != null) prevMap.set(kw, row.position);
  }

  const movers = [];

  for (const [kw, currentPos] of currentMap) {
    const prevPos = prevMap.get(kw);
    if (prevPos == null) continue;

    // Positive change = moved up (lower position number = better rank)
    const change = prevPos - currentPos;
    const dir = change > 0 ? "up" : "down";

    if (Math.abs(change) >= threshold) {
      if (direction === "both" || direction === dir) {
        movers.push({
          keyword: kw,
          previous_position: Math.round(prevPos * 10) / 10,
          current_position: Math.round(currentPos * 10) / 10,
          change: Math.round(change * 10) / 10,
          direction: dir,
        });
      }
    }
  }

  movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  console.log("============ Top Movers ***************", movers.length);

  return {
    site_id: siteId,
    site_url: siteUrl,
    threshold,
    direction,
    movers,
  };
}

export async function getRankVelocity(
  siteId: number,
  siteUrl: string,
  keyword: string,
  windowDays: number,
) {
  if (!keyword || typeof keyword !== "string") {
    throw new Error("keyword must be a non-empty string");
  }
  if (!Number.isInteger(windowDays) || windowDays < 2 || windowDays > 90) {
    throw new Error("window_days must be an integer between 2 and 90");
  }

  const history = await getRankingHistory(siteId, siteUrl, keyword, windowDays);
  const points = history.history.filter((h) => h.position !== null);

  if (points.length < 2) {
    return {
      site_id: siteId,
      keyword,
      window_days: windowDays,
      velocity: null,
      trend: "insufficient_data",
      data_points: points.length,
      message: "Not enough data points to calculate velocity",
    };
  }

  // Simple linear regression over position values
  const n = points.length;
  const positions = points.map((p) => p.position as number);

  // Use index as x-axis (0 = oldest, n-1 = newest)
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY = positions.reduce((a, b) => a + b, 0);
  const sumXY = positions.reduce((acc, pos, i) => acc + i * pos, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  // Negative slope = improving (position number going down = better rank)
  const velocity = Math.round(slope * 100) / 100;

  let trend;
  if (Math.abs(velocity) < 0.1) trend = "stable";
  else if (velocity < 0) trend = "improving";
  else trend = "declining";

  console.log("============= Velocity ***************", velocity, trend);

  return {
    site_id: siteId,
    site_url: history.site_url,
    keyword,
    window_days: windowDays,
    velocity,
    trend,
    data_points: n,
    interpretation: `Position changing by ${Math.abs(velocity)} places/day (${trend})`,
  };
}

const getKeywordRankings = async (site_id: number, site_url: string, keywords: string[]) => {
  const siteId = validateSiteId(site_id);

  if (!Array.isArray(keywords)) throw new Error("keywords must be an array");

  console.log("========== GET RANKINGS ==========");
  return await getRankings(siteId, site_url, keywords);
};

export { getKeywordRankings };
