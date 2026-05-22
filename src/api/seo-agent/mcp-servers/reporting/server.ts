import https from "node:https";
import { getSheetsClient } from "../../../libs/google.js";

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
  console.log(ch, process.env.SLACK_CHANNEL_ID);

  if (!ch) throw new Error("Missing env var SLACK_CHANNEL_ID");

  console.log("========== Slack Message **********");
  const body: Record<string, unknown> = { channel: ch, text: message };
  if (blocks) body.blocks = blocks;

  console.log("========== Calling Slack Post API **********");
  const result = await callSlackApi("chat.postMessage", token, body);
  console.log("========== Message Sent **********", result.ok);
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
  const today = new Date().toISOString().split("T")[0];
  const { rankings, summary, cmsOpportunities, schemaGaps, competitorsAlerts } =
    data || {};

  // Cap rankings at 15 to stay within block text limits
  const rankLines = rankings.length
    ? `Performance for ${rankings.length} keywords is added to google sheet
Check your sheet here : https://docs.google.com/spreadsheets/d/1iiyTPzblQ17-u54Y_t3TXp1iI7S3ZidQf6VHtH8UQTY/edit?usp=sharing\n
    `
    : "No ranking data available.";
  console.log("========== Rankings Processed **********");

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
              text += `    • *${gap.keyword}* — competitor pos ${gap.competitor_position}, vol ${gap.competitor_volume.toLocaleString()}\n`;
            });
          }
          return text;
        })
        .join("\n")
    : "No competitor keyword gaps identified this week.";

  console.log(competitorsLines);

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
    { type: "divider" },
    sectionBlock(`*Meta Suggestions (Low-CTR Pages)*`),
  ];

  // One block per CMS opportunity to avoid 3000-char limit
  const opportunities = (cmsOpportunities ?? []).slice(0, 5);
  if (opportunities.length === 0) {
    blocks.push(sectionBlock("No low-CTR opportunities identified this week."));
  } else {
    const text = `Meta suggestion for top ${opportunities.length} pages with lowest CTR in added in approval queue. Open you dashboard to review the suggestion.\n`;
    blocks.push(sectionBlock(text));
  }
  console.log("========== CMS Opportunities Processed **********");

  blocks.push(
    { type: "divider" },
    sectionBlock(`*Schema Gaps*\n${schemaLines}`),
    { type: "divider" },
    sectionBlock(`*Competitor Keyword Gaps*\n${competitorsLines}`),
    { type: "divider" },
    sectionBlock(`*Summary & Actions*\n${summary || "No summary available."}`),
  );

  console.log("========== Weekly Digest Created **********");

  return {
    site_id: siteId,
    date: today,
    blocks,
    fallback_text: `Weekly SEO Report — Site ${siteUrl ?? `Site ${siteId}`} — ${today}`,
    message: "",
  };
}

export function createMonthlyDiscoveryDigest(
  data: Record<string, any>,
) {
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

  console.log("========== Monthly Discovery Digest Created **********");

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
  console.log("============= Sheets GSC Auth *************** site_id:", siteId);
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  console.log("========== Appending to Sheet **********");
  const result = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });

  console.log("========== Sheet Updated **********");
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
  const messageData = createWeeklyDigest(site_id, site_url, data);

  const { message = "", blocks = [], fallback_text } = messageData;

  return await postSlackMessage(message, blocks);
};

const postMonthlyDiscoveryToSlack = async (
  data: Record<string, any>,
) => {
  const messageData = createMonthlyDiscoveryDigest(data);

  const { message = "", blocks = [], fallback_text } = messageData;

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

export {
  postWeeklyMessageToSlack,
  postMonthlyDiscoveryToSlack,
  writeKeywordRankingsToSheet,
  writeRecommendationsToSheet,
};
