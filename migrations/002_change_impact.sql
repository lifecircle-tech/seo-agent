-- 002_change_impact.sql
-- Before/after Search Console tracking for published SEO changes.
-- Run against the seo-agent database (schema `seo_agent`). Safe to re-run:
-- CREATE TABLE IF NOT EXISTS + INSERT IGNORE on (source_type, source_id, url_hash).
--
-- Windows use IST dates (DB server is UTC), change day excluded:
--   before = [d-28, d-1]   after = [d+1, d+28]
-- The daily "Measure Change Impact" job fills the numbers once after_end + 3 days has passed.

-- ── 1. Table (same DDL as seo-agent/models/change-impact.model.ts) ─────────────
CREATE TABLE IF NOT EXISTS change_impact (
  id                  VARCHAR(36)    NOT NULL PRIMARY KEY,
  site_id             INT            NOT NULL,
  source_type         VARCHAR(20)    NOT NULL,
  source_id           VARCHAR(64)    NOT NULL,
  change_type         VARCHAR(48)    NOT NULL,
  url                 VARCHAR(1000)  NOT NULL,
  url_hash            CHAR(64)       NOT NULL,
  changed_at          DATETIME(3)    NOT NULL,
  before_start        DATE           NOT NULL,
  before_end          DATE           NOT NULL,
  after_start         DATE           NOT NULL,
  after_end           DATE           NOT NULL,
  before_clicks       INT            NULL,
  before_impressions  INT            NULL,
  before_ctr          DOUBLE         NULL,
  before_position     DOUBLE         NULL,
  after_clicks        INT            NULL,
  after_impressions   INT            NULL,
  after_ctr           DOUBLE         NULL,
  after_position      DOUBLE         NULL,
  status              VARCHAR(16)    NOT NULL DEFAULT 'waiting',
  attempts            INT            NOT NULL DEFAULT 0,
  error               TEXT           NULL,
  measured_at         DATETIME(3)    NULL,
  created_at          DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_change_impact_source_url (source_type, source_id, url_hash),
  INDEX idx_change_impact_due   (status, after_end),
  INDEX idx_change_impact_site  (site_id, changed_at),
  INDEX idx_change_impact_source (source_type, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2. Backfill past changes ──────────────────────────────────────────────────
-- Each SELECT yields (site_id, source_type, source_id, change_type, url, changed_at);
-- the outer INSERT derives the hash and windows.

INSERT IGNORE INTO change_impact
  (id, site_id, source_type, source_id, change_type, url, url_hash, changed_at,
   before_start, before_end, after_start, after_end)
SELECT
  UUID(), c.site_id, c.source_type, c.source_id, c.change_type, LEFT(c.url, 1000), SHA2(c.url, 256), c.changed_at,
  DATE(CONVERT_TZ(c.changed_at, '+00:00', '+05:30')) - INTERVAL 28 DAY,
  DATE(CONVERT_TZ(c.changed_at, '+00:00', '+05:30')) - INTERVAL 1 DAY,
  DATE(CONVERT_TZ(c.changed_at, '+00:00', '+05:30')) + INTERVAL 1 DAY,
  DATE(CONVERT_TZ(c.changed_at, '+00:00', '+05:30')) + INTERVAL 28 DAY
FROM (
  -- 2a. Approved meta rewrites (published to WordPress on approval)
  SELECT a.site_id, 'approval' AS source_type, a.id AS source_id, 'meta_rewrite' AS change_type,
         JSON_UNQUOTE(JSON_EXTRACT(a.original_content, '$.url')) AS url, a.actioned_at AS changed_at
  FROM approvals a
  WHERE a.type = 'meta_rewrite' AND a.status = 'approved' AND a.actioned_at IS NOT NULL

  UNION ALL
  -- 2b. Approved canonicals: the primary URL and the first 10 competing URLs
  SELECT a.site_id, 'approval', a.id, 'canonical',
         JSON_UNQUOTE(JSON_EXTRACT(a.updated_content, '$.recommended_primary_url')), a.actioned_at
  FROM approvals a
  WHERE a.type = 'canonical' AND a.status = 'approved' AND a.actioned_at IS NOT NULL
  UNION ALL
  SELECT a.site_id, 'approval', a.id, 'canonical',
         JSON_UNQUOTE(JSON_EXTRACT(a.updated_content, CONCAT('$.competing_urls[', n.i, ']'))), a.actioned_at
  FROM approvals a
  JOIN (SELECT 0 i UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
        UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) n
    ON n.i < JSON_LENGTH(a.updated_content, '$.competing_urls')
  WHERE a.type = 'canonical' AND a.status = 'approved' AND a.actioned_at IS NOT NULL

  UNION ALL
  -- 2c. Page content marked Created (21) / Updated (22)
  SELECT p.site_id, 'page_content', p.id,
         IF(p.status = 21, 'page_created', 'page_updated'),
         p.url, p.acknowledged_at
  FROM page_content p
  WHERE p.status IN (21, 22) AND p.acknowledged_at IS NOT NULL

  UNION ALL
  -- 2d. Opportunities completed by a person (not by the agent) that carry a URL
  SELECT o.site_id, 'opportunity', o.id, CONCAT('opportunity:', o.opportunity_type),
         JSON_UNQUOTE(JSON_EXTRACT(o.opportunity_details, '$.url')), o.actioned_at
  FROM opportunities o
  WHERE o.status = 'completed' AND o.actioned_at IS NOT NULL
    AND o.actioned_by IS NOT NULL AND o.actioned_by <> 'agent'
) c
WHERE c.url LIKE 'http%';

-- ── 3. Check ──────────────────────────────────────────────────────────────────
SELECT change_type, COUNT(*) AS tracked,
       SUM(after_end <= CURDATE() - INTERVAL 3 DAY) AS measurable_now
FROM change_impact GROUP BY change_type;
