-- 003_keyword_rank_history.sql
-- Weekly keyword ranking history. Run against the seo-agent database (schema `seo_agent`).
-- Safe to re-run. The "Weekly Keyword Rank Snapshot" job (Mondays 12:00 IST) adds one row
-- per keyword per week; step 2 seeds a first row now so trends have a starting point.

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

-- 2. Baseline: today's positions as this week's row (week_start = Monday, IST)
INSERT INTO keyword_rank_history
  (keyword_id, week_start, site_id, keyword, position, impressions, clicks, ctr, search_volume)
SELECT id,
       DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))
         - INTERVAL WEEKDAY(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')) DAY,
       site_id, LEFT(keyword, 255), NULLIF(position, 0), impressions, clicks, ctr, search_volume
FROM keywords
ON DUPLICATE KEY UPDATE
  position = VALUES(position), impressions = VALUES(impressions), clicks = VALUES(clicks),
  ctr = VALUES(ctr), search_volume = VALUES(search_volume);

SELECT site_id, week_start, COUNT(*) AS keywords FROM keyword_rank_history GROUP BY site_id, week_start;
