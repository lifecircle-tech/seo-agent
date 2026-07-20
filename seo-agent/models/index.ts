import { createAlertsTable } from "./alert.model.js";
import { createApprovalsTable } from "./approval.model.js";
import { createCitiesConfigTable } from "./cities-config.model.js";
import { createCompetitorConfigTable } from "./competitor-config.model.js";
import { createKeywordsConfigTable } from "./keywords-config.model.js";
import { createSitesConfigTable } from "./sites-config.model.js";
import { createPageContentTable } from "./page-content.model.js";
import { createSeoReportsTable } from "./seo-report.model.js";
import { createKeywordsTable } from "./keywords.model.js";
import { createOpportunitiesTable } from "./opportunities.model.js";
import { createBacklinksTable } from "./backlinks.model.js";

export async function initSEOModels() {
  await Promise.all([
    createApprovalsTable(),
    createAlertsTable(),
    createSitesConfigTable(),
    createKeywordsConfigTable(),
    createCitiesConfigTable(),
    createCompetitorConfigTable(),
    createPageContentTable(),
    createSeoReportsTable(),
    createKeywordsTable(),
    createOpportunitiesTable(),
    createBacklinksTable(),
  ]);
  console.log("[seo-agent] tables ready");
}
