import { pool } from "../../db.js";
import { PageContent } from "../models/page-content.model.js";
import { updateUpdatedPageDetails } from "../controllers/page-content.controller.js";
import { verifyPageUpdate } from "./page-content.service.js";
import { logger } from "../utils/logger.js";

export async function checkPageContents(): Promise<void> {
  const [rows] = await pool.query<PageContent[]>(
    `SELECT * FROM page_content
     WHERE acknowledged_at >= NOW() - INTERVAL 24 HOUR`,
  );

  logger.info(
    `[schedulers] checkPageContents: ${rows.length} record(s) acknowledged in the last 24 hours`,
  );

  for (const row of rows) {
    try {
      const result = await verifyPageUpdate(row.id);
      await updateUpdatedPageDetails(row.id, {
        matchPercentage: result.matchPercentage,
        checkedAt: new Date().toISOString(),
      });
      logger.info(
        `[schedulers] ${row.id} — match: ${result.matchPercentage}%`,
      );
    } catch (err) {
      logger.error(`[schedulers] failed for ${row.id}:`, err);
    }
  }
}
