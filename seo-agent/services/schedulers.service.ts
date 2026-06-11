import { pool } from "../../db.js";
import { PageContent } from "../models/page-content.model.js";
import { updateUpdatedPageDetails } from "../controllers/page-content.controller.js";
import { verifyPageUpdate } from "./page-content.service.js";

export async function checkPageContents(): Promise<void> {
  // Compute today's date in IST (UTC+05:30)
  const nowIST = new Date(Date.now() + (5.5 * 60 * 60 * 1000));
  const todayIST = nowIST.toISOString().slice(0, 10);

  const [rows] = await pool.query<PageContent[]>(
    `SELECT * FROM page_content
     WHERE DATE(CONVERT_TZ(acknowledged_at, '+00:00', '+05:30')) = ?`,
    [todayIST],
  );

  console.log(
    `[schedulers] checkPageContents: ${rows.length} record(s) acknowledged on ${todayIST}`,
  );

  for (const row of rows) {
    try {
      const result = await verifyPageUpdate(row.id);
      await updateUpdatedPageDetails(row.id, {
        matchPercentage: result.matchPercentage,
        checkedAt: new Date().toISOString(),
      });
      console.log(
        `[schedulers] ${row.id} — match: ${result.matchPercentage}%`,
      );
    } catch (err) {
      console.error(`[schedulers] failed for ${row.id}:`, err);
    }
  }
}
