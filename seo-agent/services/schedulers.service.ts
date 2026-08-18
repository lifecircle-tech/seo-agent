import { pool } from "../../db.js";
import { PageContent } from "../models/page-content.model.js";
import { updateUpdatedPageDetails } from "../controllers/page-content.controller.js";
import { verifyPageUpdate } from "./page-content.service.js";
import { logger } from "../utils/logger.js";
import { ResultSetHeader } from "mysql2";

export async function checkPageContents(): Promise<void> {
  try {
    const [rows] = await pool.query<PageContent[]>(
      `SELECT * FROM page_content
     WHERE acknowledged_at >= NOW() - INTERVAL 24 HOUR
     AND status = 21 OR status = 22
     `,
    );

    logger.info(
      `[schedulers.page-content] checkPageContents: ${rows.length} record(s) acknowledged in the last 24 hours`,
    );

    for (const row of rows) {
      try {
        const result = await verifyPageUpdate(row.id);
        await updateUpdatedPageDetails(row.id, {
          matchPercentage: result.matchPercentage,
          checkedAt: new Date().toISOString(),
        });
        logger.info(
          `[schedulers.page-content] ${row.id} — match: ${result.matchPercentage}%`,
        );
      } catch (err) {
        logger.error(`[schedulers.page-content] failed for ${row.id}:`, err);
      }
    }
  } catch (err: any) {
    logger.error(`[schedulers.page-content] ERROR : ${err.message}`, err);
  }
}

export async function updateNewKeywordsToFalse() {
  try {
    const [results] = await pool.query<ResultSetHeader>(
      `UPDATE keywords SET is_new = false WHERE is_new = true`,
    );

    logger.info(`[schedulers.keywords] ${results.affectedRows} Updated`);
  } catch (err: any) {
    logger.error(`[schedulers.keywords] ERROR : ${err.message}`, err);
  }
}

export async function contentGenerationFromNewKeywords () {
  try {

  } catch(err: any) {
    logger.error(`[schedulers.keywords] ERROR : ${err.message}`, err);
  }
}