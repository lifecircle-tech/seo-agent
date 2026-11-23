-- 005_madhavi_wa_chat_id.sql
-- Adds the WhatsApp chat id to Madhavi's caregiver conversations. Run against the
-- Madhavi database (MADHAVI_DATABASE_URL) BEFORE deploying the code that uses it.
-- Safe to re-run.
--
--   chat_id     the Timelines chat id. Kept as it was; no longer written.
--   wa_chat_id  the WhatsApp chat id: the caregiver's WhatsApp number in digits with
--               country code (e.g. 919876543210). Used for all operations.
--
-- Existing rows get wa_chat_id from the caregiver's phone when Madhavi starts
-- (migrateCMChatsToWhatsapp in madhavi/services/lc-cm-conversation.service.ts); the
-- phones are in the LifeCircle database, so it is not done here.

SET @has_wa_chat_id := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'life_digital_cm_conversation'
    AND COLUMN_NAME = 'wa_chat_id'
);

SET @sql := IF(
  @has_wa_chat_id = 0,
  'ALTER TABLE life_digital_cm_conversation
     ADD COLUMN wa_chat_id VARCHAR(16) NULL AFTER chat_id,
     ADD KEY idx_wa_chat_id (wa_chat_id)',
  'SELECT ''wa_chat_id already exists'' AS note'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) AS conversations,
       SUM(wa_chat_id IS NULL) AS without_wa_chat_id
FROM life_digital_cm_conversation;
