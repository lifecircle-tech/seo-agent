import { pulsePool } from "./db.js";

export async function ensureContactTables() {
  const conn = await pulsePool.getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS contact_registry (
      id              INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
      contact_id      VARCHAR(36)   NOT NULL UNIQUE,
      contact_type    VARCHAR(30)   NOT NULL DEFAULT 'lead',
      name            VARCHAR(255)  NULL,
      phone           VARCHAR(30)   NULL,
      email           VARCHAR(255)  NULL,
      city            VARCHAR(100)  NULL,
      current_owner   VARCHAR(100)  NOT NULL DEFAULT 'unassigned',
      owner_type      VARCHAR(20)   NOT NULL DEFAULT 'unassigned',
      ownership_status VARCHAR(30)  NOT NULL DEFAULT 'idle',
      owned_since     DATETIME(3)   NULL,
      preferred_language VARCHAR(10) NOT NULL DEFAULT 'en',
      contact_meta    JSON          NULL,
      created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX idx_phone (phone),
      INDEX idx_email (email),
      INDEX idx_owner (current_owner),
      INDEX idx_status (ownership_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await conn.query(`CREATE TABLE IF NOT EXISTS contact_timeline (
      id              INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
      contact_id      VARCHAR(36)   NOT NULL,
      actor           VARCHAR(100)  NOT NULL,
      actor_type      VARCHAR(20)   NOT NULL,
      direction       VARCHAR(10)   NOT NULL DEFAULT 'outbound',
      channel         VARCHAR(30)   NOT NULL DEFAULT 'whatsapp',
      message_type    VARCHAR(30)   NOT NULL DEFAULT 'message',
      text            TEXT          NULL,
      extra           JSON          NULL,
      created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_contact (contact_id),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await conn.query(`CREATE TABLE IF NOT EXISTS contact_handoffs (
      id              INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
      contact_id      VARCHAR(36)   NOT NULL,
      from_owner      VARCHAR(100)  NOT NULL,
      to_owner        VARCHAR(100)  NOT NULL,
      to_type         VARCHAR(20)   NOT NULL DEFAULT 'human',
      reason          TEXT          NULL,
      status          VARCHAR(20)   NOT NULL DEFAULT 'pending',
      summary         TEXT          NULL,
      requested_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      completed_at    DATETIME(3)   NULL,
      INDEX idx_contact (contact_id),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  } finally {
    conn.release();
  }
}

export async function upsertContact(contactId, data) {
  await pulsePool.query(
    `INSERT INTO contact_registry
       (contact_id, contact_type, name, phone, email, city, preferred_language, contact_meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = COALESCE(VALUES(name), name),
       phone = COALESCE(VALUES(phone), phone),
       email = COALESCE(VALUES(email), email),
       city = COALESCE(VALUES(city), city),
       contact_meta = COALESCE(VALUES(contact_meta), contact_meta),
       updated_at = CURRENT_TIMESTAMP(3)`,
    [contactId, data.contact_type ?? "lead", data.name ?? null, data.phone ?? null,
     data.email ?? null, data.city ?? null, data.preferred_language ?? "en",
     data.meta ? JSON.stringify(data.meta) : null]
  );
  return getContactById(contactId);
}

export async function getContactById(contactId) {
  const [rows] = await pulsePool.query("SELECT * FROM contact_registry WHERE contact_id = ?", [contactId]);
  return rows[0] ?? null;
}

export async function findContactByPhone(phone) {
  const [rows] = await pulsePool.query("SELECT * FROM contact_registry WHERE phone = ? LIMIT 1", [phone]);
  return rows[0] ?? null;
}

export async function findContactByEmail(email) {
  const [rows] = await pulsePool.query("SELECT * FROM contact_registry WHERE email = ? LIMIT 1", [email]);
  return rows[0] ?? null;
}

export async function listContacts({ owner = null, workspace = null, status = null, limit = 50 } = {}) {
  let q = "SELECT * FROM contact_registry WHERE 1=1";
  const params = [];
  if (owner) { q += " AND current_owner = ?"; params.push(owner); }
  if (status) { q += " AND ownership_status = ?"; params.push(status); }
  q += " ORDER BY updated_at DESC LIMIT ?";
  params.push(limit);
  const [rows] = await pulsePool.query(q, params);
  return rows;
}

export async function checkOwnershipLock(contactId, sender) {
  const contact = await getContactById(contactId);
  if (!contact) return { allowed: true, reason: "new_contact" };

  if (contact.ownership_status === "idle" || contact.current_owner === "unassigned") {
    return { allowed: true, reason: "idle" };
  }

  // Check 72h idle expiry
  if (contact.owned_since) {
    const hoursElapsed = (Date.now() - new Date(contact.owned_since).getTime()) / 3600000;
    if (hoursElapsed > 72) {
      await pulsePool.query(
        "UPDATE contact_registry SET ownership_status = 'idle', current_owner = 'unassigned', owner_type = 'unassigned' WHERE contact_id = ?",
        [contactId]
      );
      return { allowed: true, reason: "expired_idle" };
    }
  }

  if (contact.current_owner === sender) return { allowed: true, reason: "same_owner" };
  return { allowed: false, reason: "locked", current_owner: contact.current_owner };
}

export async function assignOwnership(contactId, owner, ownerType) {
  await pulsePool.query(
    "UPDATE contact_registry SET current_owner = ?, owner_type = ?, ownership_status = 'active', owned_since = NOW() WHERE contact_id = ?",
    [owner, ownerType, contactId]
  );
}

export async function releaseOwnership(contactId) {
  await pulsePool.query(
    "UPDATE contact_registry SET current_owner = 'unassigned', owner_type = 'unassigned', ownership_status = 'idle', owned_since = NULL WHERE contact_id = ?",
    [contactId]
  );
}

export async function requestHandoff(contactId, fromOwner, toOwner, toType, reason = null) {
  await pulsePool.query(
    "UPDATE contact_registry SET ownership_status = 'handoff_pending' WHERE contact_id = ?",
    [contactId]
  );
  const [result] = await pulsePool.query(
    "INSERT INTO contact_handoffs (contact_id, from_owner, to_owner, to_type, reason, status) VALUES (?, ?, ?, ?, ?, 'pending')",
    [contactId, fromOwner, toOwner, toType, reason]
  );
  return result.insertId;
}

export async function completeHandoff(handoffId, accepted) {
  const [rows] = await pulsePool.query("SELECT * FROM contact_handoffs WHERE id = ?", [handoffId]);
  if (!rows.length) return null;
  const handoff = rows[0];

  await pulsePool.query(
    "UPDATE contact_handoffs SET status = ?, completed_at = NOW() WHERE id = ?",
    [accepted ? "completed" : "rejected", handoffId]
  );

  if (accepted) {
    await assignOwnership(handoff.contact_id, handoff.to_owner, handoff.to_type);
  } else {
    await pulsePool.query(
      "UPDATE contact_registry SET ownership_status = 'active' WHERE contact_id = ?",
      [handoff.contact_id]
    );
  }
  return handoff;
}

export async function getPendingHandoffs(forOwner = null) {
  if (forOwner) {
    const [rows] = await pulsePool.query(
      "SELECT * FROM contact_handoffs WHERE status = 'pending' AND to_owner = ? ORDER BY requested_at DESC",
      [forOwner]
    );
    return rows;
  }
  const [rows] = await pulsePool.query("SELECT * FROM contact_handoffs WHERE status = 'pending' ORDER BY requested_at DESC");
  return rows;
}

export async function addToTimeline(contactId, actor, actorType, direction, channel, messageType, text, extra = null) {
  await pulsePool.query(
    "INSERT INTO contact_timeline (contact_id, actor, actor_type, direction, channel, message_type, text, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [contactId, actor, actorType, direction, channel, messageType, text ?? null, extra ? JSON.stringify(extra) : null]
  );
}

export async function getContactTimeline(contactId, limit = 50) {
  const [rows] = await pulsePool.query(
    "SELECT * FROM contact_timeline WHERE contact_id = ? ORDER BY created_at DESC LIMIT ?",
    [contactId, limit]
  );
  return rows;
}
