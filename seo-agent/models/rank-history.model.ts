import { pool } from "../../db.js";

/**
 * Weekly snapshot of each tracked keyword's Search Console position, so ranking
 * movement can be seen over time (the `keywords` table only holds the latest values).
 * Same DDL as migrations/003_keyword_rank_history.sql.
 */
export async function createKeywordRankHistoryTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS keyword_rank_history (
        keyword_id     VARCHAR(36)   NOT NULL,
        week_start     DATE          NOT NULL,
        site_id        INT           NOT NULL,
        keyword        VARCHAR(255)  NOT NULL,
        position       DOUBLE        NULL,
        impressions    BIGINT        NULL,
        clicks         BIGINT        NULL,
        ctr            DOUBLE        NULL,
        search_volume  BIGINT        NULL,
        created_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (keyword_id, week_start),
        INDEX idx_rank_history_site_week (site_id, week_start)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (err) {
    console.error("[keyword_rank_history] Error creating table:", err);
    throw err;
  }
}
