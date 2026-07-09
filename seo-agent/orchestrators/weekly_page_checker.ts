import * as dotenv from "dotenv";
import { logger } from "../utils/logger.js";

import { listSitesConfigs } from "../controllers/sites.controller.js";
import {
  getMissingCityPages,
  generateCityPage,
  createCmsDraft,
} from "../mcp-servers/page-generator/server.js";
import { postSlackMessage } from "../mcp-servers/reporting/server.js";
import { saveMissingPagesReport } from "../services/seo-report.service.js";

dotenv.config();

// ── Config ────────────────────────────────────────────────────────────
const DRY_RUN = ["1", "true", "yes"].includes(
  (process.env.DRY_RUN || "false").toLowerCase(),
);

// How many city pages to generate per site per run (avoids hammering Claude/WP)
const PAGES_PER_SITE = Number(process.env.PAGE_BUILDER_BATCH_SIZE ?? 3);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Per-site pipeline ─────────────────────────────────────────────────
async function runPageBuilderForSite(
  siteId: number,
  domain: string,
  service: string,
) {
  logger.info(`[daily_page_builder] site_id=${siteId} (${domain})`);

  // 1. Find cities that have no landing page yet
  const missing = await getMissingCityPages(siteId);

  if (missing.missing_count === 0) {
    logger.info(
      `[daily_page_builder] No missing city pages for site_id=${siteId}. Skipping.`,
    );
    return { site_id: siteId, domain, generated: 0, skipped: 0, errors: [] };
  }

  logger.info(
    `[daily_page_builder] ${missing.missing_count} cities need pages. Processing up to ${PAGES_PER_SITE} today.`,
  );

  // 2. Take today's batch (oldest-first order from DB)
  const batch = missing.missing.slice(0, PAGES_PER_SITE);

  const results: Array<{
    city: string;
    status: "created" | "dry_run" | "error";
    detail: string;
  }> = [];

  for (const cityEntry of batch) {
    // TODO : change keywords logic to missingServices
    const keywords = [`${service} in ${cityEntry.city}`];

    try {
      logger.info(
        `[daily_page_builder] Generating page: ${service} — ${cityEntry.city}`,
      );

      if (DRY_RUN) {
        logger.info(
          `[daily_page_builder] DRY_RUN — would generate "${service} in ${cityEntry.city}" with keywords: ${keywords.slice(0, 3).join(", ")}`,
        );
        results.push({
          city: cityEntry.city,
          status: "dry_run",
          detail: `would generate slug: ${cityEntry.normalized_slug}`,
        });
        continue;
      }

      // Generate full SEO page via Claude
      const page = await generateCityPage(
        siteId,
        cityEntry.city,
        service,
        keywords,
      );

      // Short cooldown between Claude calls to stay under rate limits
      await sleep(1500);

      // Push to WordPress as draft
      const draft = await createCmsDraft(siteId, page);

      logger.info(
        `[daily_page_builder] Draft created: wp_id=${draft.wp_page_id}, link=${draft.link}`,
      );
      results.push({
        city: cityEntry.city,
        status: "created",
        detail: draft.link,
      });

      // Brief pause between WP posts
      await sleep(800);
    } catch (err: any) {
      logger.error(
        `[daily_page_builder] Failed for city=${cityEntry.city}: `,
        err,
      );
      results.push({
        city: cityEntry.city,
        status: "error",
        detail: err.message,
      });
    }
  }

  const created = results.filter((r) => r.status === "created").length;
  const errored = results.filter((r) => r.status === "error").length;
  const remaining = missing.missing_count - batch.length;

  logger.info(
    `[daily_page_builder] site_id=${siteId}: ${created} created, ${errored} errors, ${remaining} still queued`,
  );

  return {
    site_id: siteId,
    domain,
    generated: created,
    skipped: errored,
    errors: results.filter((r) => r.status === "error"),
    remaining,
  };
}

async function runMissingPageChecker(siteId: number, domain: string) {
  logger.info(`[weekly_page_missing] site_id=${siteId}`);

  const missing = await getMissingCityPages(siteId);

  if (missing.missing_count === 0) {
    logger.info(
      `[weekly_page_missing] No missing city pages for site_id=${siteId}. Skipping.`,
    );
    return;
  }

  logger.info(
    `[weekly_page_missing] ${missing.missing_count} cities need pages.`,
  );

  return {
    site_id: siteId,
    domain,
    total_cities: missing.total_cities,
    missing_count: missing.missing_count,
    cities: missing.missing,
  };
}

// ── Slack report ──────────────────────────────────────────────────────
async function postWeeklyReport(
  summaries: Array<{
    site_id: number;
    domain: string;
    generated: number;
    skipped: number;
    remaining?: number;
    errors: Array<{ city: string; detail: string }>;
  }>,
) {
  const totalGenerated = summaries.reduce((n, s) => n + s.generated, 0);
  const totalErrors = summaries.reduce((n, s) => n + s.skipped, 0);

  if (totalGenerated === 0 && totalErrors === 0) {
    logger.info("[daily_page_builder] Nothing to report — no pages generated.");
    return;
  }

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🏙️ Daily City Page Builder",
      },
    },
    ...summaries
      .filter((s) => s.generated > 0 || s.skipped > 0)
      .map((s) => ({
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Site*\n${s.domain}` },
          { type: "mrkdwn", text: `*Drafts Created*\n${s.generated}` },
          { type: "mrkdwn", text: `*Errors*\n${s.skipped}` },
          {
            type: "mrkdwn",
            text: `*Still Queued*\n${s.remaining ?? 0}`,
          },
        ],
      })),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Total today: *${totalGenerated}* drafts created across ${summaries.length} site(s). All pages created as *draft* — review before publishing.`,
        },
      ],
    },
  ];

  const summary = `Daily page builder: ${totalGenerated} city page draft(s) created, ${totalErrors} error(s).`;
  await postSlackMessage(summary, blocks);
}

async function postWeeklyPageMissingReport(
  cities: Array<{
    site_id: number;
    domain: string;
    cities: Array<{
      city: string;
      state: string;
      country: string;
      missingServices: string[];
    }>;
  }>,
) {
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🏙️ Weekly City Page missing report",
      },
    },
    {
      type: "divider",
    },
    ...cities.flatMap((s) => [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${s.domain} - Following city has missing pages : `,
        },
      },
      ...s.cities.flatMap((st) => [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${st.city}*`,
          },
        },
        {
          type: "section",
          fields: [
            st.missingServices && {
              type: "mrkdwn",
              text: `*Services*\n${st.missingServices.join("\n")}`,
            },
          ],
        },
        {
          type: "divider",
        },
      ]),
      {
        type: "divider",
      },
    ]),
  ];

  const summary = `Weekly Page Missing Report: ${cities.length} city page(s) missing.`;
  await postSlackMessage(summary, blocks);
}

// ── Main export ───────────────────────────────────────────────────────
export async function weeklyPageChecker() {
  const startTime = Date.now();

  logger.info(
    `[daily_page_builder] ══════════════════════════════════════════`,
  );
  logger.info(`[daily_page_builder] Starting daily city page builder run`);
  logger.info(
    `[daily_page_builder] ══════════════════════════════════════════`,
  );

  const { sites } = await listSitesConfigs({ limit: 1000 });

  const summaries = [];

  const site = sites[0];

  // for (const site of sites) {
  try {
    // Use the site's industry as the service category (e.g. "elder care", "physiotherapy")
    // const service = site.industry ?? "services";
    // const result = await runPageBuilderForSite(
    //   site.site_id,
    //   site.domain,
    //   service,
    // );
    const result = await runMissingPageChecker(site.site_id, site.domain);
    if (result) {
      summaries.push(result);
      await saveMissingPagesReport(site.site_id, {
        total_cities: result.total_cities,
        missing_count: result.missing_count,
        missing: result.cities,
      });
    }
  } catch (err: any) {
    logger.error(
      `[daily_page_builder] Unhandled error for site_id=${site.site_id}:`,
      err,
    );
    summaries.push();
  }
  // }

  if (!DRY_RUN) {
    try {
      await postWeeklyPageMissingReport(summaries);
      // await postWeeklyReport(summaries);
    } catch (err: any) {
      logger.error(`[daily_page_builder] Slack report failed: `, err);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info(`[daily_page_builder] Done in ${elapsed}s`);
  logger.info(
    `[daily_page_builder] ══════════════════════════════════════════`,
  );
}
