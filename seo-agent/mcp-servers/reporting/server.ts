import https from "node:https";
import { getSheetsClient } from "../../../libs/google.js";
import { logger } from "../../utils/logger.js";

type SlackResponse = {
  ok: boolean;
  ts?: string;
  channel?: string;
  error?: string;
};

export async function callSlackApi(
  endpoint: string,
  token: string,
  body: object,
): Promise<SlackResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "slack.com",
        path: `/api/${endpoint}`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (chunk) => (buf += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function getSpreadsheetId() {
  const id = process.env.SHEETS_ID?.trim();
  if (!id) throw new Error("Missing env var SHEETS_ID");
  return id;
}

// ── Tool implementations ──────────────────────────────────────────────

export async function postSlackMessage(
  message: string,
  blocks?: object[],
  channel?: string,
) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("Missing env var SLACK_BOT_TOKEN");
  const ch = channel ?? process.env.SLACK_CHANNEL_ID;
  if (!ch) throw new Error("Missing env var SLACK_CHANNEL_ID");

  logger.info("========== Slack Message **********");
  const body: Record<string, unknown> = { channel: ch, text: message };
  if (blocks) body.blocks = blocks;

  logger.info("========== Calling Slack Post API **********");
  const result = await callSlackApi("chat.postMessage", token, body);
  logger.info(`========== Message Sent ********** ${result.ok}`);
  if (!result.ok)
    throw new Error(`Slack API error: ${result.error ?? "unknown"}`);
  return { ok: true, ts: result.ts, channel: result.channel };
}

// Slack section text is capped at 3000 chars — truncate with a safe margin
function slackTrunc(text: string, max = 2950): string {
  return text.length <= max ? text : text.slice(0, max - 3) + "...";
}

function sectionBlock(text: string) {
  return { type: "section", text: { type: "mrkdwn", text: slackTrunc(text) } };
}

export function createWeeklyDigest(
  siteId: number,
  siteUrl: string,
  data: Record<string, any>,
) {
  logger.info("========== Creating Weekly Digest **********");
  const today = new Date().toISOString().split("T")[0];
  const { rankings, summary, schemaGaps, competitorsAlerts } = data || {};

  // Cap rankings at 15 to stay within block text limits
  const rankLines = rankings.length
    ? `Performance for ${rankings.length} keywords is added to google sheet
Check your sheet here : https://docs.google.com/spreadsheets/d/1iiyTPzblQ17-u54Y_t3TXp1iI7S3ZidQf6VHtH8UQTY/edit?usp=sharing\n
    `
    : "No ranking data available.";
  logger.info("========== Rankings Processed **********");

  // Build schema gaps section
  const gaps = (schemaGaps ?? []).filter((g: any) => g.has_gaps);
  const schemaLines = gaps.length
    ? gaps
        .slice(0, 10)
        .map(
          (g: any) =>
            `• *${g.url}* (${g.page_type})\n    Missing: ${g.missing_types.join(", ")}`,
        )
        .join("\n")
    : "No schema gaps identified this week.";

  // Build competitor alerts section
  const competitors = competitorsAlerts ?? [];
  const competitorsLines = competitors.length
    ? competitors
        .slice(0, 5)
        .map((competitor: any, index: number) => {
          let text = `${index + 1}. ${competitor.competitor_domain}: \n`;

          if (competitor.keywordGaps.length === 0) {
            text += "    No keyword gaps identified.";
          } else {
            competitor.keywordGaps.map((gap: any) => {
              text += `    • *${gap.keyword}* — competitor pos ${gap.competitor_position}, vol ${gap.search_volume.toLocaleString()}\n`;
            });
          }
          return text;
        })
        .join("\n")
    : "No competitor keyword gaps identified this week.";

  // Header blocks
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Weekly SEO Report — ${siteUrl ?? `Site ${siteId}`}`,
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `*Report date:* ${today}` }],
    },
    { type: "divider" },
    sectionBlock(`*Keyword Rankings*\n${rankLines}`),
  ];

  blocks.push(
    { type: "divider" },
    sectionBlock(`*Schema Gaps*\n${schemaLines}`),
    { type: "divider" },
    sectionBlock(`*Competitor Keyword Gaps*\n${competitorsLines}`),
    { type: "divider" },
    sectionBlock(`*Summary & Actions*\n${summary || "No summary available."}`),
  );

  logger.info("========== Weekly Digest Created **********");

  return {
    site_id: siteId,
    date: today,
    blocks,
    fallback_text: `Weekly SEO Report — Site ${siteUrl ?? `Site ${siteId}`} — ${today}`,
    message: "",
  };
}

export function createMonthlyDiscoveryDigest(data: Record<string, any>) {
  const today = new Date().toISOString().split("T")[0];
  const { summary } = data || {};

  // Header blocks
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Monthly City wise Keyword Discovery`,
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `*Report date:* ${today}` }],
    },
    { type: "divider" },
    sectionBlock(
      "Check your sheet here : https://docs.google.com/spreadsheets/d/1iiyTPzblQ17-u54Y_t3TXp1iI7S3ZidQf6VHtH8UQTY/edit?usp=sharing\n",
    ),
    { type: "divider" },
  ];

  blocks.push(...summary.map((item: string) => sectionBlock(item)));

  logger.info("========== Monthly Discovery Digest Created **********");

  return {
    date: today,
    blocks,
    fallback_text: `Monthly City wise Keyword Discovery — ${today}`,
    message: "",
  };
}

export async function writeToSheet(
  siteId: number,
  tabName: string,
  rows: unknown[][],
) {
  logger.info(
    `============= Sheets GSC Auth *************** site_id: ${siteId}`,
  );
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  logger.info(`========== Appending to Sheet ********** ${rows.length}`);
  const result = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A3`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });

  logger.info("========== Sheet Updated **********");
  return {
    ok: true,
    tab: tabName,
    updated_rows: result.data.updates?.updatedRows ?? 0,
  };
}

export async function logRecommendation(
  siteId: number,
  module: string,
  recommendation: string,
  outcome: string,
) {
  const VALID_OUTCOMES = ["pending", "accepted", "rejected", "successful"];
  if (!VALID_OUTCOMES.includes(outcome)) {
    throw new Error(`outcome must be one of: ${VALID_OUTCOMES.join(", ")}`);
  }
  const date = new Date().toISOString();
  const rows = [[date, siteId, module, recommendation, outcome]];
  return writeToSheet(siteId, "Recommendation Outcomes", rows);
}

const postWeeklyMessageToSlack = async (
  site_id: number,
  site_url: string,
  data: Record<string, any>,
) => {
  logger.info("========== Posting Weekly Message to Slack **********");
  const messageData = createWeeklyDigest(site_id, site_url, data);

  const { message = "", blocks = [] } = messageData;

  return await postSlackMessage(message, blocks);
};

const postMonthlyDiscoveryToSlack = async (data: Record<string, any>) => {
  const messageData = createMonthlyDiscoveryDigest(data);

  const { message = "", blocks = [] } = messageData;

  return await postSlackMessage(message, blocks);
};

const writeKeywordRankingsToSheet = async (
  site_id: number,
  rankings: Array<Record<string, any>>,
) => {
  const rows = [
    ["", "", "", "", "", ""],
    ...rankings.map((item) => [
      new Date(),
      item.keyword,
      item.position,
      item.clicks,
      item.impressions,
      item.ctr,
    ]),
  ];

  return await writeToSheet(site_id, "Rankings", rows);
};

const writeRecommendationsToSheet = async (
  site_id: number,
  recommendations: Array<Record<string, any>>,
) => {
  const rows = [
    ["", "", "", "", ""],
    ...recommendations.map((item) => [
      new Date(),
      site_id,
      item.module,
      item.recommendation_text,
      "pending",
    ]),
  ];

  return await writeToSheet(site_id, "Recommendation Outcomes", rows);
};

export function createBacklinkDigest(
  siteId: number,
  siteUrl: string,
  backlinkData: Record<string, any>,
  prospectsData: Record<string, any> | null,
) {
  const today = new Date().toISOString().split("T")[0];
  const { newLinks, lostLinks, toxicLinks, velocity } = backlinkData ?? {};

  const newCount: number = newLinks?.count ?? 0;
  const lostCount: number = lostLinks?.count ?? 0;
  const toxicCount: number = toxicLinks?.count ?? 0;
  const trend: string = velocity?.trend ?? "unknown";
  const avgGain: number = velocity?.avg_weekly_gain ?? 0;
  const avgLoss: number = velocity?.avg_weekly_loss ?? 0;

  const topNew: any[] = (newLinks?.backlinks ?? []).slice(0, 5);
  const topLost: any[] = (lostLinks?.backlinks ?? []).slice(0, 5);
  const topToxic: any[] = (toxicLinks?.toxic_links ?? []).slice(0, 5);
  const prospects: string[] = prospectsData?.prospects ?? [];

  const newLines = topNew.length
    ? topNew
        .map(
          (b: any) =>
            `• *${b.domain_from}* (rank ${b.domain_rank}) → ${b.url_to}`,
        )
        .join("\n")
    : "None";

  const lostLines = topLost.length
    ? topLost
        .map(
          (b: any) =>
            `• *${b.domain_from}* (rank ${b.domain_rank}) → ${b.url_to}`,
        )
        .join("\n")
    : "None";

  const toxicLines = topToxic.length
    ? topToxic
        .map((b: any) => `• *${b.domain_from}* — spam score ${b.spam_score}`)
        .join("\n")
    : "None";

  const prospectLines = prospects.length
    ? prospects.map((d: string) => `• ${d}`).join("\n")
    : "No prospects found.";

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Backlink Report — ${siteUrl ?? `Site ${siteId}`}`,
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `*Report date:* ${today}` }],
    },
    { type: "divider" },
    // sectionBlock(
    //   `*Link Velocity*\nTrend: *${trend}* | Avg gain/day: +${avgGain} | Avg loss/day: -${avgLoss}`,
    // ),
    // { type: "divider" },
    sectionBlock(
      `*New Backlinks (last 7 days)* — ${newCount} total\n${newLines}`,
    ),
    { type: "divider" },
    sectionBlock(
      `*Lost Backlinks (last 7 days)* — ${lostCount} total\n${lostLines}`,
    ),
    { type: "divider" },
    sectionBlock(
      `*Toxic Links* — ${toxicCount} flagged (spam score > 60)\n${toxicLines}`,
    ),
    { type: "divider" },
    sectionBlock(
      `*Link Prospects* — domains linking to competitors, not us\n${prospectLines}`,
    ),
  ];

  return {
    site_id: siteId,
    date: today,
    blocks,
    fallback_text: `Backlink Report — ${siteUrl ?? `Site ${siteId}`} — ${today}`,
  };
}

const postBacklinkDigestToSlack = async (
  siteId: number,
  siteUrl: string,
  backlinkData: Record<string, any>,
  prospectsData: Record<string, any> | null,
) => {
  logger.info("========== Posting Backlink Digest to Slack **********");
  const messageData = createBacklinkDigest(
    siteId,
    siteUrl,
    backlinkData,
    prospectsData,
  );
  const { blocks, fallback_text } = messageData;
  return await postSlackMessage(fallback_text, blocks);
};

export function createSitemapAdsDigest(
  siteId: number,
  siteUrl: string,
  sitemapData: Record<string, any> | null,
  adsData: Record<string, any> | null,
) {
  const today = new Date().toISOString().split("T")[0];

  // ── Sitemap section ───────────────────────────────────────────────────
  const status = sitemapData?.status;
  const detected = sitemapData?.detected;
  const pingResult = sitemapData?.pingResult;

  const coverageLine = status
    ? `Coverage: *${status.coverage_pct ?? "?"}%* | GSC sitemaps: ${status.gsc_sitemaps?.length ?? 0}`
    : "Sitemap data unavailable.";

  const issueLines = status?.issues?.length
    ? status.issues
        .slice(0, 5)
        .map((i: string) => `• ${i}`)
        .join("\n")
    : "No sitemap issues.";

  const newPageCount: number = detected?.count ?? 0;
  const alreadyPinged: number = detected?.already_pinged ?? 0;
  const pingedOk: number = pingResult?.success_count ?? 0;
  const pingedTotal: number = pingResult?.pinged?.length ?? 0;

  const pingSummary =
    newPageCount === 0
      ? "No new pages detected in the last 24 h."
      : `${newPageCount} new page(s) detected (${alreadyPinged} already pinged). Pinged: ${pingedOk}/${pingedTotal} to GSC + Bing.`;

  // ── Ads section ───────────────────────────────────────────────────────
  const topKeywords = adsData?.topKeywords;
  const wastedSpend = adsData?.wastedSpend;
  const qualityIssues = adsData?.qualityIssues;

  const topKwLines = topKeywords?.keywords?.length
    ? topKeywords.keywords
        .slice(0, 5)
        .map((k: any) => {
          const cost = (k.cost_inr ?? 0).toFixed(2);
          return `• *${k.keyword}* — ${k.conversions} conv, ₹${cost} spend`;
        })
        .join("\n")
    : "No converting keywords found.";

  const wastedLine = wastedSpend
    ? `${wastedSpend.keyword_count ?? 0} keyword(s) with zero conversions — total wasted: *₹${wastedSpend.total_wasted_inr ?? 0}*`
    : "No wasted spend data.";
  const wastedKeywords = wastedSpend.keywords
    .map((k: any) => {
      const cost = (k.cost_inr ?? 0).toFixed(2);
      return `• *${k.keyword}* — ₹${cost} spend, ${k.clicks} Click(s), ${k.impressions} impression(s)`;
    })
    .join("\n");

  const qsLine = qualityIssues
    ? `${qualityIssues.issues?.length ?? 0} issue(s) (${qualityIssues.critical_count ?? 0} critical) | Avg QS: *${qualityIssues.avg_quality_score ?? "?"}*`
    : "No quality score data.";
  const criticalQuality = qualityIssues
    ? qualityIssues.issues.length
      ? qualityIssues.issues
          .filter((i: any) => i.quality_score <= 3)
          .map((i: any) => {
            return `• *${i.keyword}* — ${i.impressions} impression(s), Score: ${i.quality_score}, Quality: ${i.landing_page_quality}`;
          })
          .join("\n")
      : ""
    : "";

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Sitemap & Ads Report — ${siteUrl ?? `Site ${siteId}`}`,
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `*Report date:* ${today}` }],
    },
    { type: "divider" },
    sectionBlock(`*Sitemap Status*\n${coverageLine}\n${issueLines}`),
    sectionBlock(`*Page Indexing*\n${pingSummary}`),
    { type: "divider" },
    sectionBlock(`*Top Converting Keywords (Last 30 Days)*\n${topKwLines}`),
    { type: "divider" },
    sectionBlock(`*Wasted Ad Spend (Last 30 Days)*\n${wastedLine}`),
    sectionBlock(wastedKeywords),
    { type: "divider" },
    sectionBlock(`*Quality Score Issues (Last 30 Days)*\n${qsLine}`),
    sectionBlock("*Critical Issue(s)*"),
    sectionBlock(criticalQuality),
  ];

  return {
    site_id: siteId,
    date: today,
    blocks,
    fallback_text: `Sitemap & Ads Report — ${siteUrl ?? `Site ${siteId}`} — ${today}`,
  };
}

const postSitemapAdsDigestToSlack = async (
  siteId: number,
  siteUrl: string,
  sitemapData: Record<string, any> | null,
  adsData: Record<string, any> | null,
) => {
  logger.info("========== Posting Sitemap & Ads Digest to Slack **********");
  const messageData = createSitemapAdsDigest(
    siteId,
    siteUrl,
    sitemapData,
    adsData,
  );
  return await postSlackMessage(messageData.fallback_text, messageData.blocks);
};

export {
  postWeeklyMessageToSlack,
  postMonthlyDiscoveryToSlack,
  postBacklinkDigestToSlack,
  postSitemapAdsDigestToSlack,
  writeKeywordRankingsToSheet,
  writeRecommendationsToSheet,
};
