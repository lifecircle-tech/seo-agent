import { createAlertsTable } from "./alert.model.js";
import { createApprovalsTable } from "./approval.model.js";
import { createCitiesConfigTable } from "./cities-config.model.js";
import { createCompetitorConfigTable } from "./competitor-config.model.js";
import { createKeywordsConfigTable } from "./keywords-config.model.js";
import { createSitesConfigTable } from "./sites-config.model.js";

export async function initSEOModels() {
  await Promise.all([
    createApprovalsTable(),
    createAlertsTable(),
    createSitesConfigTable(),
    createKeywordsConfigTable(),
    createCitiesConfigTable(),
    createCompetitorConfigTable(),
  ]);
  console.log("[seo-agent] tables ready");
}
