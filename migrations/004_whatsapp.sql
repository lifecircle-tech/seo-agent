-- 004_whatsapp.sql
-- Tables for the WhatsApp service (whatsapp/). Run against its own database
-- (WHATSAPP_DATABASE_URL, schema `whatsapp`). Safe to re-run. The service also
-- creates these on startup unless DB_AUTO_INIT=false; keep in sync with
-- whatsapp/models/schema.ts.

CREATE DATABASE IF NOT EXISTS whatsapp DEFAULT CHARACTER SET utf8mb4;
USE whatsapp;

-- One row per person we exchange messages with
CREATE TABLE IF NOT EXISTS wa_chats (
  chat_id          VARCHAR(16)  NOT NULL,      -- the person's WhatsApp id (wa_id): phone digits with country code
  phone            VARCHAR(20)  NOT NULL,      -- E.164, with '+'
  profile_name     VARCHAR(255) NULL,          -- WhatsApp profile name, from their messages
  phone_number_id  VARCHAR(32)  NOT NULL,      -- our business number
  last_inbound_at  DATETIME(3)  NULL,          -- opens the 24h customer service window
  last_message_at  DATETIME(3)  NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (chat_id),
  KEY idx_wa_chats_last_message (last_message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Files received or sent; the files themselves are under WHATSAPP_MEDIA_DIR
CREATE TABLE IF NOT EXISTS wa_media (
  media_id    VARCHAR(64)  NOT NULL,           -- WhatsApp media id
  direction   VARCHAR(8)   NOT NULL,           -- inbound | outbound
  mime_type   VARCHAR(128) NULL,
  filename    VARCHAR(255) NULL,               -- documents only
  sha256      VARCHAR(128) NULL,
  file_size   BIGINT       NULL,
  file_path   VARCHAR(512) NULL,               -- relative to WHATSAPP_MEDIA_DIR
  status      VARCHAR(16)  NOT NULL DEFAULT 'pending', -- pending | stored | failed
  error       VARCHAR(512) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (media_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Every message received or sent: the chat history
CREATE TABLE IF NOT EXISTS wa_messages (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wamid          VARCHAR(128) NULL,            -- WhatsApp message id; NULL when the send failed
  chat_id        VARCHAR(16)  NOT NULL,
  direction      VARCHAR(8)   NOT NULL,        -- inbound | outbound
  type           VARCHAR(32)  NOT NULL,        -- text, image, document, template, ...
  text           TEXT         NULL,            -- text, or a description of a non-text message
  media_id       VARCHAR(64)  NULL,
  context_wamid  VARCHAR(128) NULL,            -- the message this one replies to
  status         VARCHAR(16)  NOT NULL,        -- received | accepted | sent | delivered | read | failed
  error_code     INT          NULL,
  error_message  VARCHAR(512) NULL,
  payload        JSON         NULL,
  message_at     DATETIME(3)  NOT NULL,
  status_at      DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_wa_messages_wamid (wamid),
  KEY idx_wa_messages_chat (chat_id, message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
