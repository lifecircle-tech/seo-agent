-- =========================================================
-- Core schema: tenant/employee/caregiver/credentials
--              + agent/agent_prompt/tenant_agent_prompt
--              + tenant_agent_access
--              + mcp_tools/agent_tool_access/tenant_agent_tool_access
--              + tenant_agent_tokens_usage
--              + agent_document_tools/agent_documents_access
--              + agent_skill_tools/agent_skills_access
--
-- Every table has an auto-increment `id` as its primary key.
-- Foreign keys reference that `id`, not the public UUID column.
-- The UUID column (tenant_id, employee_id, ...) stays as the
-- externally-facing identifier used by the API.
-- =========================================================

-- ---------------------------------------------------------
-- 1. tenant
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant (
    tenant_id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
    slug          VARCHAR(255) NOT NULL,
    company_name  VARCHAR(255) NOT NULL,
    industry      VARCHAR(100),
    address       VARCHAR(255),
    contact_email VARCHAR(255),
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id),
    UNIQUE KEY uq_tenant_slug (slug),
    UNIQUE KEY uq_tenant_contact_email (contact_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 2. employee
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee (
    employee_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tenant_id   INT UNSIGNED NOT NULL,
    name        VARCHAR(100) NOT NULL,
    email       VARCHAR(255) NOT NULL,
    phone       VARCHAR(16)  NOT NULL,
    PRIMARY KEY (employee_id),
    UNIQUE KEY uq_employee_email (email),
    INDEX idx_employee_tenant_id (tenant_id),
    INDEX idx_employee_email (email),
    CONSTRAINT fk_employee_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 3. caregiver
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS caregiver (
    caregiver_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tenant_id      INT UNSIGNED NOT NULL,
    supervisor_id  INT UNSIGNED NOT NULL,
    name           VARCHAR(100) NOT NULL,
    dob            DATE         NOT NULL,
    gender         VARCHAR(20)  NOT NULL,
    languages      JSON,
    email          VARCHAR(255) NOT NULL,
    phone          VARCHAR(16)  NOT NULL,
    start_date     DATE,
    end_date       DATE,
    status         VARCHAR(50)  NOT NULL DEFAULT 'active',
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (caregiver_id),
    UNIQUE KEY uq_caregiver_phone (phone),
    INDEX idx_caregiver_tenant_id (tenant_id),
    INDEX idx_caregiver_supervisor_id (supervisor_id),
    CONSTRAINT fk_caregiver_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_caregiver_supervisor
        FOREIGN KEY (supervisor_id) REFERENCES employee (employee_id)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 4. credentials
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS credentials (
    credential_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    employee_id   INT UNSIGNED NOT NULL,
    username      VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    last_login    TIMESTAMP    NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (credential_id),
    UNIQUE KEY uq_credentials_username (username),
    UNIQUE KEY uq_credentials_employee (employee_id),
    CONSTRAINT fk_credentials_employee
        FOREIGN KEY (employee_id) REFERENCES employee (employee_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 5. agent
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent (
    agent_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name        VARCHAR(150) NOT NULL,
    `key`       VARCHAR(150) NOT NULL,
    description TEXT,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (agent_id),
    UNIQUE KEY uq_agent_name (name),
    UNIQUE KEY uq_agent_key (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 6. agent_prompt
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_prompt (
    prompt_id  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    agent_id   INT UNSIGNED NOT NULL,
    section    VARCHAR(50) NOT NULL, -- e.g. responsibility, role, tone
    content    TEXT        NOT NULL,
    version    INT         NOT NULL DEFAULT 1,
    updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (prompt_id),
    UNIQUE KEY uq_agent_prompt_agent (agent_id),
    CONSTRAINT fk_agent_prompt_agent
        FOREIGN KEY (agent_id) REFERENCES agent (agent_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 7. tenant_agent_prompt
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_agent_prompt (
    tenant_prompt_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tenant_id        INT UNSIGNED NOT NULL,
    agent_id         INT UNSIGNED NOT NULL,
    access_id        INT UNSIGNED NULL, -- soft link to tenant_agent_access.access_id (no FK)
    section          VARCHAR(50) NOT NULL, -- e.g. restriction, rules
    content          TEXT        NOT NULL,
    updated_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_prompt_id),
    UNIQUE KEY uq_tenant_agent_prompt_section (tenant_id, agent_id, section),
    UNIQUE KEY uq_tenant_agent_prompt_access (access_id),
    CONSTRAINT fk_tap_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_tap_agent
        FOREIGN KEY (agent_id) REFERENCES agent (agent_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 8. tenant_agent_access
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_agent_access (
    access_id  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tenant_id  INT UNSIGNED NOT NULL,
    agent_id   INT UNSIGNED NOT NULL,
    status     VARCHAR(50) NOT NULL DEFAULT 'active', -- active, revoked, pending
    granted_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (access_id),
    UNIQUE KEY uq_tenant_agent_access (tenant_id, agent_id),
    CONSTRAINT fk_taa_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_taa_agent
        FOREIGN KEY (agent_id) REFERENCES agent (agent_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 9. mcp_tools
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_tools (
    tool_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name         VARCHAR(150) NOT NULL,
    title        TEXT,
    description  TEXT,
    endpoint_url VARCHAR(500),
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    PRIMARY KEY (tool_id),
    UNIQUE KEY uq_mcp_tools_name (name),
    INDEX idx_mcp_tool_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 10. agent_tool_access
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_tool_access (
    access_id  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    agent_id   INT UNSIGNED NOT NULL,
    tool_id    INT UNSIGNED NOT NULL,
    status     VARCHAR(50) NOT NULL DEFAULT 'active', -- active, revoked, pending
    granted_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (access_id),
    UNIQUE KEY uq_agent_tool (agent_id, tool_id),
    CONSTRAINT fk_ata_agent
        FOREIGN KEY (agent_id) REFERENCES agent (agent_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_ata_tool
        FOREIGN KEY (tool_id) REFERENCES mcp_tools (tool_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 11. tenant_agent_tool_access
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_agent_tool_access (
    access_id  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tenant_id  INT UNSIGNED NOT NULL,
    agent_id   INT UNSIGNED NOT NULL,
    tool_id    INT UNSIGNED NOT NULL,
    status     VARCHAR(50) NOT NULL DEFAULT 'active', -- active, revoked, pending
    granted_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (access_id),
    UNIQUE KEY uq_tenant_agent_tool (tenant_id, agent_id, tool_id),
    CONSTRAINT fk_tato_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_tato_agent
        FOREIGN KEY (agent_id) REFERENCES agent (agent_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_tato_tool
        FOREIGN KEY (tool_id) REFERENCES mcp_tools (tool_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 12. tenant_agent_tokens_usage
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_agent_tokens_usage (
    usage_id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    tenant_id             INT UNSIGNED  NOT NULL,
    agent_id              INT UNSIGNED  NOT NULL,
    input_tokens          INT UNSIGNED  NOT NULL DEFAULT 0,
    output_tokens         INT UNSIGNED  NOT NULL DEFAULT 0,
    total_tokens          INT UNSIGNED  GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
    request_started_at    TIMESTAMP     NOT NULL,
    request_completed_at  TIMESTAMP     NULL,
    created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (usage_id),
    INDEX idx_tatu_tenant_created (tenant_id, created_at), -- fast billing lookups per tenant/period
    INDEX idx_tatu_agent_id (agent_id),
    CONSTRAINT fk_tatu_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_tatu_agent
        FOREIGN KEY (agent_id) REFERENCES agent (agent_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 13. tenants_cm_conversation
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants_cm_conversation (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    caregiver_id            INT UNSIGNED    NOT NULL,
    chat_id                 VARCHAR(16)     NULL,
    last_message_timestamp  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at_timestamp    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_caregiver_id (caregiver_id),
    INDEX idx_id (id),
    INDEX idx_caregiver_id (caregiver_id),
    CONSTRAINT fk_tcc_caregiver
        FOREIGN KEY (caregiver_id) REFERENCES caregiver (caregiver_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 14. life_digital_cm_conversation
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS life_digital_cm_conversation (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    hp_unique_id BIGINT NOT NULL,
    chat_id VARCHAR(16) NULL,
    last_message_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_hp_unique_id (hp_unique_id),
    KEY idx_id (id),
    KEY idx_hp_unique_id (hp_unique_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 15. agent_document_tools
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_document_tools (
    doc_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    doc_name    VARCHAR(255) NOT NULL,
    description TEXT,
    content     TEXT,
    active      BOOLEAN      NOT NULL DEFAULT FALSE,
    PRIMARY KEY (doc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 16. agent_skill_tools
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_skill_tools (
    skill_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
    skill_name  VARCHAR(255) NOT NULL,
    description TEXT,
    content     TEXT,
    active      BOOLEAN      NOT NULL DEFAULT FALSE,
    PRIMARY KEY (skill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 17. agent_documents_access
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_documents_access (
    access_id  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    agent_id   INT UNSIGNED NOT NULL,
    doc_id     INT UNSIGNED NOT NULL,
    granted_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (access_id),
    UNIQUE KEY uq_agent_documents_access (agent_id, doc_id),
    CONSTRAINT fk_ada_agent
        FOREIGN KEY (agent_id) REFERENCES agent (agent_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_ada_doc
        FOREIGN KEY (doc_id) REFERENCES agent_document_tools (doc_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 18. agent_skills_access
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_skills_access (
    access_id  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    agent_id   INT UNSIGNED NOT NULL,
    skill_id   INT UNSIGNED NOT NULL,
    granted_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (access_id),
    UNIQUE KEY uq_agent_skills_access (agent_id, skill_id),
    CONSTRAINT fk_asa_agent
        FOREIGN KEY (agent_id) REFERENCES agent (agent_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_asa_skill
        FOREIGN KEY (skill_id) REFERENCES agent_skill_tools (skill_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 19. life_digital_slack_conversation
--     One row per Slack thread the agent opened about a user
--     (1-to-n with life_digital_cm_conversation.hp_unique_id).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS life_digital_slack_conversation (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    hp_unique_id BIGINT          NOT NULL,
    chat_id      VARCHAR(16)     NULL,
    agent_key    VARCHAR(150)    NULL,     -- agent that opened the thread
    purpose      VARCHAR(50)     NOT NULL, -- slack channel purpose: report, suggestion
    channel_id   VARCHAR(32)     NOT NULL,
    thread_ts    VARCHAR(32)     NOT NULL,
    message      TEXT            NOT NULL, -- agent's original Slack message
    status       VARCHAR(20)     NOT NULL DEFAULT 'open', -- open, resolved
    created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    -- one Slack thread can be about several users (e.g. a search request
    -- whose results were all messaged)
    UNIQUE KEY uq_slack_thread_user (channel_id, thread_ts, hp_unique_id),
    KEY idx_ldsc_hp_unique_id (hp_unique_id),
    KEY idx_ldsc_chat_id (chat_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration for databases created before uq_slack_thread_user:
-- ALTER TABLE life_digital_slack_conversation
--     ADD UNIQUE KEY uq_slack_thread_user (channel_id, thread_ts, hp_unique_id),
--     DROP INDEX uq_slack_thread;

-- ---------------------------------------------------------
-- 20. life_digital_slack_reply
--     Employee replies posted in a tracked Slack thread.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS life_digital_slack_reply (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    slack_conversation_id BIGINT UNSIGNED NOT NULL,
    slack_user_id         VARCHAR(32)     NULL,
    slack_user_name       VARCHAR(150)    NULL,
    message               TEXT            NOT NULL,
    message_ts            VARCHAR(32)     NOT NULL,
    relay_status          VARCHAR(20)     NOT NULL DEFAULT 'pending', -- pending, relayed, internal
    relayed_at            DATETIME        NULL,
    created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_slack_reply (slack_conversation_id, message_ts),
    KEY idx_ldsr_relay_status (relay_status),
    CONSTRAINT fk_ldsr_conversation
        FOREIGN KEY (slack_conversation_id)
        REFERENCES life_digital_slack_conversation (id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 21. life_digital_agent_run
--     Audit of every agent run on a caregiver conversation: why it
--     ran, what it replied, and how the conversation was classified.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS life_digital_agent_run (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    hp_unique_id            BIGINT          NULL,
    caregiver_name          VARCHAR(150)    NULL, -- snapshot, caregivers live in the LC database
    caregiver_phone         VARCHAR(20)     NULL,
    chat_id                 VARCHAR(16)     NULL,
    agent_key               VARCHAR(150)    NOT NULL,
    trigger_source          VARCHAR(30)     NOT NULL, -- caregiver_message, slack_reply, scheduled_outreach
    status                  VARCHAR(20)     NOT NULL DEFAULT 'running', -- running, completed, failed
    last_caregiver_message  TEXT            NULL,
    reply_message           TEXT            NULL, -- last WhatsApp message the agent sent
    topic                   VARCHAR(50)     NULL,
    summary                 TEXT            NULL,
    severity                VARCHAR(20)     NULL, -- low, medium, high, critical
    severity_reason         TEXT            NULL,
    escalated               BOOLEAN         NOT NULL DEFAULT FALSE,
    error                   TEXT            NULL,
    input_tokens            INT UNSIGNED    NOT NULL DEFAULT 0,
    output_tokens           INT UNSIGNED    NOT NULL DEFAULT 0,
    started_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at            DATETIME        NULL,
    PRIMARY KEY (id),
    KEY idx_ldar_hp_started (hp_unique_id, started_at),
    KEY idx_ldar_started (started_at),
    KEY idx_ldar_severity_started (severity, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 22. life_digital_agent_action
--     Every tool the agent called during a run.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS life_digital_agent_action (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    run_id       BIGINT UNSIGNED NOT NULL,
    tool_name    VARCHAR(150)    NOT NULL,
    action_type  VARCHAR(30)     NOT NULL, -- whatsapp_message, escalation, suggestion, slack_thread_update, support_ticket, reference, lookup
    input        JSON            NULL,
    output       TEXT            NULL,
    is_error     BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_ldaa_run_id (run_id),
    KEY idx_ldaa_type_created (action_type, created_at),
    CONSTRAINT fk_ldaa_run
        FOREIGN KEY (run_id) REFERENCES life_digital_agent_run (id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- 23. life_digital_daily_report
--     End-of-day report, one row per day (IST).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS life_digital_daily_report (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    report_date       DATE            NOT NULL,
    metrics           JSON            NOT NULL,
    narrative         TEXT            NULL,
    slack_channel_id  VARCHAR(32)     NULL,
    slack_ts          VARCHAR(32)     NULL,
    generated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_lddr_report_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
