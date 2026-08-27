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

export { getKeywordPerformance, getPagePerformance };
