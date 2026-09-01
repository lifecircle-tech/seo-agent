import { getSearchConsoleClient } from "../../libs/google";
import { logger } from "../utils/logger";

const fmt = (d: Date) => d.toISOString().split("T")[0];

async function getKeywordPerformance(
  siteUrl: string,
  keyword: string,
  days: number = 28,
) {
  logger.debug("Getting Keyword Performance ".padEnd(50, "="));
  const searchConsole = getSearchConsoleClient();

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);

  const results = await searchConsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ["query"],
      dimensionFilterGroups: [
        {
          filters: [
            { dimension: "query", operator: "equals", expression: keyword },
            { dimension: "country", expression: "ind" },
          ],
        },
      ],
      rowLimit: 10,
    },
  });

  const rows = results.data.rows;

  const keyword_metrics = rows?.map((item) => ({
    keyword: item.keys?.[0],
    clicks: item.clicks,
    impressions: item.impressions,
    ctr: item.ctr,
    position: item.position,
  }));

  return keyword_metrics;
}

async function getPagePerformance(
  siteUrl: string,
  pageUrl: string,
  days: number = 28,
) {
  const searchConsole = getSearchConsoleClient();

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);

  const results = await searchConsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ["page"],
      dimensionFilterGroups: [
        {
          filters: [
            {
              dimension: "page",
              operator: "equals",
              expression: pageUrl,
            },
          ],
        },
      ],
      rowLimit: 10,
    },
  });

  const rows = results.data.rows;
  const page_metrics = rows?.map((item) => ({
    url: item.keys?.[0],
    clicks: item.clicks,
    impressions: item.impressions,
    ctr: item.ctr,
    position: item.position,
  }));

  return page_metrics;
}

async function getSitePerformanceMetrics(
  site_url: string,
  date: { start: string; end: string },
  row_count: number,
) {
  const searchConsole = getSearchConsoleClient();

  const [avgMetrics, dailyMetrics] = await Promise.all([
    searchConsole.searchanalytics.query({
      siteUrl: site_url,
      requestBody: {
        startDate: date.start,
        endDate: date.end,
        dimensions: [],
        dimensionFilterGroups: [
          {
            filters: [
              {
                dimension: "country",
                expression: "ind",
              },
            ],
          },
        ],
        rowLimit: 1,
      },
    }),
    searchConsole.searchanalytics.query({
      siteUrl: site_url,
      requestBody: {
        startDate: date.start,
        endDate: date.end,
        dimensions: ["date"],
        dimensionFilterGroups: [
          {
            filters: [
              {
                dimension: "country",
                expression: "ind",
              },
            ],
          },
        ],
        dataState: "all",
        rowLimit: row_count,
      },
    }),
  ]);

  const avg_position = avgMetrics.data.rows?.[0]?.position ?? null;
  const avg_impressions = avgMetrics.data.rows?.[0]?.impressions ?? null;

  const traffic_sparkline: Array<{ date: string; clicks: number }> = [];
  const position_sparkline: Array<{ date: string; position: number }> = [];

  for (let row of dailyMetrics.data.rows ?? []) {
    traffic_sparkline.push({
      date: row.keys?.[0] ?? "",
      clicks: row.clicks ?? 0,
    });

    position_sparkline.push({
      date: row.keys?.[0] ?? "",
      position: Number(row.position?.toFixed(2)) ?? 0,
    });
  }

  return {
    avg_position,
    avg_impressions,
    traffic_sparkline,
    position_sparkline,
  };
}

async function getCityPerformanceMetrics(
  site_url: string,
  city: string,
  date: { start: string; end: string },
  row_count: number,
) {
  const searchConsole = getSearchConsoleClient();

  const [avgMetrics, dailyMetrics] = await Promise.all([
    searchConsole.searchanalytics.query({
      siteUrl: site_url,
      requestBody: {
        startDate: date.start,
        endDate: date.end,
        dimensions: [],
        dimensionFilterGroups: [
          {
            groupType: "AND",
            filters: [
              {
                dimension: "country",
                expression: "ind",
              },
              {
                dimension: "query",
                operator: "contains",
                expression: city,
              },
            ],
          },
        ],
        rowLimit: 1,
      },
    }),
    searchConsole.searchanalytics.query({
      siteUrl: site_url,
      requestBody: {
        startDate: date.start,
        endDate: date.end,
        dimensions: ["date"],
        dimensionFilterGroups: [
          {
            groupType: "AND",
            filters: [
              {
                dimension: "country",
                expression: "ind",
              },
              {
                dimension: "query",
                operator: "contains",
                expression: city,
              },
            ],
          },
        ],
        dataState: "all",
        rowLimit: row_count,
      },
    }),
  ]);

  const avg_position = avgMetrics.data.rows?.[0]?.position ?? null;
  const avg_impressions = avgMetrics.data.rows?.[0]?.impressions ?? null;

  const traffic_sparkline: Array<{ date: string; clicks: number }> = [];
  const position_sparkline: Array<{ date: string; position: number }> = [];

  for (let row of dailyMetrics.data.rows ?? []) {
    traffic_sparkline.push({
      date: row.keys?.[0] ?? "",
      clicks: row.clicks ?? 0,
    });

    position_sparkline.push({
      date: row.keys?.[0] ?? "",
      position: Number(row.position?.toFixed(2)) ?? 0,
    });
  }

  return {
    avg_position,
    avg_impressions,
    traffic_sparkline,
    position_sparkline,
  };
}

export {
  getKeywordPerformance,
  getPagePerformance,
  getSitePerformanceMetrics,
  getCityPerformanceMetrics,
};
