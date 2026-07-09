import {
  getSearchConsoleClient,
  getSheetsClient,
  getSpreadsheetId,
} from "../../../libs/google.js";
import { getKeywordsSuggestions } from "../../services/dataForSEO.service.js";
import { logger } from "../../utils/logger.js";

export interface KeywordOpportunity {
  keyword: string;
  volume: number;
  difficulty: number;
  current_position: number | null;
  opportunity_score?: number;
  cluster?: string;
}

/**
 * Helper to extract a topic/cluster from a keyword string
 */
function extractTopic(keyword: string): string {
  const stopWords = new Set([
    "in",
    "near",
    "me",
    "best",
    "services",
    "company",
    "top",
    "at",
    "for",
  ]);
  const words = keyword.toLowerCase().split(/\s+/);
  for (const word of words) {
    if (!stopWords.has(word) && word.length > 3) return word;
  }
  return words[0] || "general";
}

/**
 * Tool: discover_city_keywords
 * Queries Ahrefs for related keywords and cross-references GSC for current rankings.
 */
export async function discoverCityKeywords(
  siteId: number,
  siteUrl: string,
  city: string,
  service: string,
): Promise<KeywordOpportunity[]> {
  const seedKeyword = `${service} ${city}`;
  logger.info(`[keyword-researcher] Discovering keywords for: ${seedKeyword}`);

  // 1. Fetch related keywords
  const suggestions = (await getKeywordsSuggestions(seedKeyword)) as [];

  const discovered = suggestions.map((item: any) => ({
    keyword: item.keyword,
    volume: item.keyword_info.search_volume,
    difficulty: item.keyword_properties.keyword_difficulty,
  }));

  // 2. Query SerpAPI for PAA/Related (Conceptual implementation)
  // Note: SerpAPI implementation would go here to expand the list

  // 3. Check current rankings in GSC to identify position gaps
  const searchConsole = getSearchConsoleClient();

  const gscResponse = await searchConsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      endDate: new Date().toISOString().split("T")[0],
      dimensions: ["query"],
      rowLimit: 5000,
    },
  });

  const rankingMap = new Map<string, number>();
  (gscResponse.data.rows ?? []).forEach((row) => {
    if (row.keys?.[0])
      rankingMap.set(row.keys[0].toLowerCase(), row.position ?? 100);
  });

  // 4. Merge data
  const opportunities: KeywordOpportunity[] = discovered.map((opp) => ({
    ...opp,
    current_position: rankingMap.get(opp.keyword.toLowerCase()) ?? null,
  }));

  return opportunities.slice(0, 50);
}

/**
 * Tool: get_keyword_clusters
 * Groups keywords by topic cluster based on semantic similarity/common words.
 */
export function getKeywordClusters(
  keywords: KeywordOpportunity[],
): KeywordOpportunity[] {
  logger.info(`[keyword-researcher] Clustering keywords...`);
  return keywords.map((k) => ({
    ...k,
    cluster: extractTopic(k.keyword),
  }));
}

/**
 * Tool: prioritise_keywords
 * Formula: (volume * 0.4) + ((100 - difficulty) * 0.4) + (position_gap * 0.2)
 */
export function prioritiseKeywords(
  keywords: KeywordOpportunity[],
): KeywordOpportunity[] {
  logger.info(`[keyword-researcher] Sorting Keywords by Opportunity...`);
  return keywords
    .map((k) => {
      const volScore = k.volume * 0.4;
      const diffScore = (100 - k.difficulty) * 0.4;

      // If not ranking, we treat gap as 100 (high opportunity to acquire)
      // If ranking, the gap is the position itself (higher position = more room to grow)
      const positionGap = k.current_position ?? 100;
      const posScore = positionGap * 0.2;

      return {
        ...k,
        opportunity_score: parseFloat(
          (volScore + diffScore + posScore).toFixed(2),
        ),
      };
    })
    .sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0));
}

export async function writeToSheet(
  siteId: number,
  tabName: string,
  rows: unknown[][],
) {
  logger.info(`============= Sheets GSC Auth *************** site_id: ${siteId}`);
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  logger.info("========== Appending to Sheet **********");
  const result = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });

  logger.info("========== Sheet Updated **********");
  return {
    ok: true,
    tab: tabName,
    updated_rows: result.data.updates?.updatedRows ?? 0,
  };
}

/**
 * Tool: write_keyword_matrix
 * Writes the processed keyword data to the "Keywords" tab in Google Sheets.
 */
export async function writeKeywordMatrix(
  siteId: number,
  city: string,
  keywords: KeywordOpportunity[],
): Promise<{ success: boolean; rows_written: number }> {
  logger.info(`[city] Writing keywords to Sheets... ${keywords.length}`);
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Format data for Sheets: [Keyword, Volume, Difficulty, Position, Score, Cluster, City, Timestamp]
  const timestamp = new Date().toISOString();
  const rows = keywords.map((k) => [
    k.keyword,
    k.volume,
    k.difficulty,
    k.current_position || "N/A",
    k.opportunity_score || 0,
    k.cluster || "un-clustered",
    city,
    timestamp,
  ]);

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Keywords!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: rows,
      },
    });

    return { success: true, rows_written: rows.length };
  } catch (error) {
    logger.error("[keyword-researcher] Error writing to sheets:", error);
    throw error;
  }
}
