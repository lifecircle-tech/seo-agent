import { createAlertsTable } from "./alert.model.js";
import { createApprovalsTable } from "./approval.model.js";

export async function initSEOModels() {
  await Promise.all([createApprovalsTable(), createAlertsTable()]);
  console.log("[seo-agent] tables ready");
}
