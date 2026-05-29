-- ── Run against: seo_agent DB ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS malti_db_write_requests (
  id              VARCHAR(50)  NOT NULL PRIMARY KEY,
  agent_key       VARCHAR(50)  NOT NULL,
  operation       VARCHAR(10)  NOT NULL,
  target_table    VARCHAR(100) NOT NULL,
  data_json       JSON         NOT NULL,
  where_clause    VARCHAR(500) NULL,
  sql_preview     TEXT         NOT NULL,
  reason          TEXT         NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
  proposed_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actioned_at     DATETIME(3)  NULL,
  actioned_by     VARCHAR(100) NULL,
  result_json     JSON         NULL,
  INDEX idx_status (status),
  INDEX idx_agent (agent_key),
  INDEX idx_proposed (proposed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS malti_agent_run_history (
  id              INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  agent_key       VARCHAR(50)   NOT NULL,
  status          VARCHAR(20)   NOT NULL,
  duration_s      FLOAT         NOT NULL DEFAULT 0,
  msg_count       INT           NOT NULL DEFAULT 0,
  channel         VARCHAR(50)   NULL,
  error           TEXT          NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_agent_key (agent_key),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS malti_agent_training (
  agent_key       VARCHAR(50)   NOT NULL PRIMARY KEY,
  training_json   LONGTEXT      NOT NULL,
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── lifecircle_pulse DB tables (created programmatically on startup) ────────
-- campaigns, campaign_stages, campaign_tasks, campaign_metrics_daily,
-- contact_registry, contact_timeline, contact_handoffs
-- See: controllers/malti/campaigns.controller.ts → ensureMaltiTablesExist()
