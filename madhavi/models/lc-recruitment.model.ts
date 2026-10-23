import type {
  Connection,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { madhavi_pool } from "../../db";

// Recruitment of caregivers for a booking. The agent tools that contact,
// place and release caregivers live in MCPs (lc-recruitment.service); here
// is only what the orchestrator and the server need.

export type RecruitmentStatus =
  | "contacted"
  | "on_hold"
  | "no_response"
  | "placed"
  | "released";

// Caregivers still in the running for a booking.
export const ACTIVE_STATUSES: RecruitmentStatus[] = [
  "contacted",
  "on_hold",
  "no_response",
];

export interface RecruitmentCandidate extends RowDataPacket {
  id: number;
  booking_id: number;
  hp_unique_id: number;
  status: RecruitmentStatus;
  note: string | null;
  contacted_at: Date;
  response_due_at: Date;
  responded_at: Date | null;
}

export type RecruitmentEvent = {
  candidate_id: number;
  from_status: RecruitmentStatus | null;
  to_status: RecruitmentStatus;
  reason: string | null;
  note: string | null;
  source: "agent" | "system";
};

const CANDIDATE_SELECT = `
  SELECT
    c.id, l.booking_id, c.hp_unique_id, c.status, c.note, c.contacted_at,
    c.response_due_at, c.responded_at
  FROM life_digital_recruitment_candidate c
  JOIN life_digital_recruitment_lead l ON l.id = c.lead_id
`;

async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>) {
  const conn = await madhavi_pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getCandidatesByHpUniqueId(
  hp_unique_id: number,
  statuses: RecruitmentStatus[],
) {
  const [rows] = await madhavi_pool.query<RecruitmentCandidate[]>(
    `${CANDIDATE_SELECT}
      WHERE c.hp_unique_id = ? AND c.status IN (?)
      ORDER BY c.contacted_at DESC;`,
    [hp_unique_id, statuses],
  );

  return rows;
}

// Candidates waiting on the caregiver's first reply.
async function getUnansweredCandidates(conn: Connection, hp_unique_id: number) {
  const [rows] = await conn.query<RecruitmentCandidate[]>(
    `${CANDIDATE_SELECT}
      WHERE c.hp_unique_id = ? AND c.status IN ('contacted', 'no_response')
        AND c.responded_at IS NULL
      FOR UPDATE;`,
    [hp_unique_id],
  );

  return rows;
}

async function getOverdueCandidates(conn: Connection) {
  const [rows] = await conn.query<RecruitmentCandidate[]>(
    `${CANDIDATE_SELECT}
      WHERE c.status = 'contacted' AND c.responded_at IS NULL
        AND c.response_due_at <= CURRENT_TIMESTAMP
      FOR UPDATE;`,
  );

  return rows;
}

async function updateCandidatesResponded(conn: Connection, ids: number[]) {
  if (ids.length === 0) return;

  await conn.query<ResultSetHeader>(
    `
      UPDATE life_digital_recruitment_candidate
      SET responded_at = CURRENT_TIMESTAMP
      WHERE id IN (?);
    `,
    [ids],
  );
}

async function updateCandidateStatus(
  conn: Connection,
  ids: number[],
  status: RecruitmentStatus,
) {
  if (ids.length === 0) return;

  await conn.query<ResultSetHeader>(
    `
      UPDATE life_digital_recruitment_candidate
      SET status = ?, status_changed_at = CURRENT_TIMESTAMP
      WHERE id IN (?);
    `,
    [status, ids],
  );
}

async function insertEvents(conn: Connection, events: RecruitmentEvent[]) {
  if (events.length === 0) return;

  await conn.query<ResultSetHeader>(
    `
      INSERT INTO life_digital_recruitment_event
        (candidate_id, from_status, to_status, reason, note, source)
      VALUES ?;
    `,
    [
      events.map((e) => [
        e.candidate_id,
        e.from_status,
        e.to_status,
        e.reason,
        e.note,
        e.source,
      ]),
    ],
  );
}

// ---------------------------------------------------------------------------
// Reads for the recruitment API
// ---------------------------------------------------------------------------

export type LeadStatus = "open" | "filled" | "closed";
// IST wall-clock time, 'YYYY-MM-DD HH:MM:SS'
export type IstDateTime = string;

// Timestamps are stored in the DB server's time zone (CURRENT_TIMESTAMP)
// and the pool reads them as UTC, so they are converted to UTC in SQL, and
// IST range bounds are converted to the server's time zone.
const utc = (column: string) =>
  `CONVERT_TZ(${column}, @@session.time_zone, '+00:00')`;
const IST = "CONVERT_TZ(?, '+05:30', @@session.time_zone)";

export interface RecruitmentLeadRow extends RowDataPacket {
  lead_id: number;
  booking_id: number;
  status: LeadStatus;
  close_reason: string | null;
  opened_at: Date;
  closed_at: Date | null;
  last_activity_at: Date | null;
  total: number | string;
  contacted: number | string;
  on_hold: number | string;
  no_response: number | string;
  placed: number | string;
  released: number | string;
  placed_hp_unique_id: number | null;
  placed_caregiver_name: string | null;
}

export interface RecruitmentCandidateRow extends RowDataPacket {
  id: number;
  booking_id: number;
  lead_status: LeadStatus;
  hp_unique_id: number;
  caregiver_name: string | null;
  caregiver_phone: string | null;
  status: RecruitmentStatus;
  release_reason: string | null;
  note: string | null;
  contacted_at: Date;
  response_due_at: Date;
  responded_at: Date | null;
  status_changed_at: Date;
}

export interface RecruitmentEventRow extends RowDataPacket {
  candidate_id: number;
  from_status: RecruitmentStatus | null;
  to_status: RecruitmentStatus;
  reason: string | null;
  note: string | null;
  source: "agent" | "system";
  created_at: Date;
}

// Leads with their candidates counted per status. Candidates are
// aggregated in a derived table so the outer query needs no GROUP BY.
const LEAD_SELECT = `
  SELECT
    l.id AS lead_id, l.booking_id, l.status, l.close_reason,
    ${utc("l.opened_at")} AS opened_at,
    ${utc("l.closed_at")} AS closed_at,
    ${utc("s.last_activity_at")} AS last_activity_at,
    COALESCE(s.total, 0) AS total,
    COALESCE(s.contacted, 0) AS contacted,
    COALESCE(s.on_hold, 0) AS on_hold,
    COALESCE(s.no_response, 0) AS no_response,
    COALESCE(s.placed, 0) AS placed,
    COALESCE(s.released, 0) AS released,
    s.placed_hp_unique_id, s.placed_caregiver_name
  FROM life_digital_recruitment_lead l
  LEFT JOIN (
    SELECT
      lead_id,
      COUNT(*) AS total,
      SUM(status = 'contacted') AS contacted,
      SUM(status = 'on_hold') AS on_hold,
      SUM(status = 'no_response') AS no_response,
      SUM(status = 'placed') AS placed,
      SUM(status = 'released') AS released,
      MAX(status_changed_at) AS last_activity_at,
      MAX(IF(status = 'placed', hp_unique_id, NULL)) AS placed_hp_unique_id,
      MAX(IF(status = 'placed', caregiver_name, NULL)) AS placed_caregiver_name
    FROM life_digital_recruitment_candidate
    GROUP BY lead_id
  ) s ON s.lead_id = l.id
`;

const CANDIDATE_ROW_SELECT = `
  SELECT
    c.id, l.booking_id, l.status AS lead_status, c.hp_unique_id,
    c.caregiver_name, c.caregiver_phone, c.status, c.release_reason, c.note,
    ${utc("c.contacted_at")} AS contacted_at,
    ${utc("c.response_due_at")} AS response_due_at,
    ${utc("c.responded_at")} AS responded_at,
    ${utc("c.status_changed_at")} AS status_changed_at
  FROM life_digital_recruitment_candidate c
  JOIN life_digital_recruitment_lead l ON l.id = c.lead_id
`;

function leadFilters({
  status,
  booking_id,
  from,
  to,
}: {
  status?: LeadStatus;
  booking_id?: number;
  from?: IstDateTime;
  to?: IstDateTime;
}) {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (status) {
    conditions.push("l.status = ?");
    values.push(status);
  }
  if (booking_id) {
    conditions.push("l.booking_id = ?");
    values.push(booking_id);
  }
  if (from) {
    conditions.push(`l.opened_at >= ${IST}`);
    values.push(from);
  }
  if (to) {
    conditions.push(`l.opened_at < ${IST}`);
    values.push(to);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    values,
  };
}

// Most recently active first.
async function findRecruitmentLeads(filters: {
  status?: LeadStatus;
  booking_id?: number;
  from?: IstDateTime;
  to?: IstDateTime;
  limit: number;
  offset: number;
}) {
  const { where, values } = leadFilters(filters);

  const [rows] = await madhavi_pool.query<RecruitmentLeadRow[]>(
    `${LEAD_SELECT} ${where}
      ORDER BY COALESCE(s.last_activity_at, l.opened_at) DESC, l.id DESC
      LIMIT ? OFFSET ?;`,
    [...values, filters.limit, filters.offset],
  );
  const [[count]] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM life_digital_recruitment_lead l ${where};`,
    values,
  );

  return { rows, total: Number(count.total) };
}

async function findRecruitmentLeadByBookingId(booking_id: number) {
  const [rows] = await madhavi_pool.query<RecruitmentLeadRow[]>(
    `${LEAD_SELECT} WHERE l.booking_id = ?;`,
    [booking_id],
  );

  return rows[0];
}

// First contacted first.
async function findCandidatesByLeadId(lead_id: number) {
  const [rows] = await madhavi_pool.query<RecruitmentCandidateRow[]>(
    `${CANDIDATE_ROW_SELECT}
      WHERE c.lead_id = ?
      ORDER BY c.contacted_at ASC, c.id ASC;`,
    [lead_id],
  );

  return rows;
}

async function findEventsByCandidateIds(candidate_ids: number[]) {
  if (candidate_ids.length === 0) return [];

  const [rows] = await madhavi_pool.query<RecruitmentEventRow[]>(
    `
      SELECT candidate_id, from_status, to_status, reason, note, source,
        ${utc("created_at")} AS created_at
      FROM life_digital_recruitment_event
      WHERE candidate_id IN (?)
      ORDER BY id ASC;
    `,
    [candidate_ids],
  );

  return rows;
}

// Every booking a caregiver was approached for, newest first.
async function findCandidatesOfCaregiver({
  hp_unique_id,
  limit,
  offset,
}: {
  hp_unique_id: number;
  limit: number;
  offset: number;
}) {
  const [rows] = await madhavi_pool.query<RecruitmentCandidateRow[]>(
    `${CANDIDATE_ROW_SELECT}
      WHERE c.hp_unique_id = ?
      ORDER BY c.contacted_at DESC, c.id DESC
      LIMIT ? OFFSET ?;`,
    [hp_unique_id, limit, offset],
  );
  const [[count]] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM life_digital_recruitment_candidate WHERE hp_unique_id = ?;`,
    [hp_unique_id],
  );

  return { rows, total: Number(count.total) };
}

// Counts for a period (IST bounds, both optional): leads opened in it by
// current status, caregivers contacted in it by current status, and the
// placements made in it.
async function getRecruitmentCounts({
  from,
  to,
}: {
  from?: IstDateTime;
  to?: IstDateTime;
}) {
  const range = (column: string) => {
    const conditions = ["1 = 1"];
    const values: unknown[] = [];
    if (from) {
      conditions.push(`${column} >= ${IST}`);
      values.push(from);
    }
    if (to) {
      conditions.push(`${column} < ${IST}`);
      values.push(to);
    }
    return { where: conditions.join(" AND "), values };
  };

  const leads = range("opened_at");
  const [lead_rows] = await madhavi_pool.query<RowDataPacket[]>(
    `
      SELECT status, COUNT(*) AS count
      FROM life_digital_recruitment_lead
      WHERE ${leads.where}
      GROUP BY status;
    `,
    leads.values,
  );

  const candidates = range("contacted_at");
  const [candidate_rows] = await madhavi_pool.query<RowDataPacket[]>(
    `
      SELECT status, COUNT(*) AS count, SUM(responded_at IS NOT NULL) AS responded
      FROM life_digital_recruitment_candidate
      WHERE ${candidates.where}
      GROUP BY status;
    `,
    candidates.values,
  );

  const placements = range("e.created_at");
  const [[placement]] = await madhavi_pool.query<RowDataPacket[]>(
    `
      SELECT
        COUNT(*) AS count,
        AVG(TIMESTAMPDIFF(MINUTE, l.opened_at, e.created_at)) AS avg_minutes_to_place
      FROM life_digital_recruitment_event e
      JOIN life_digital_recruitment_candidate c ON c.id = e.candidate_id
      JOIN life_digital_recruitment_lead l ON l.id = c.lead_id
      WHERE e.to_status = 'placed' AND ${placements.where};
    `,
    placements.values,
  );

  return { lead_rows, candidate_rows, placement };
}

export {
  withTransaction,
  getCandidatesByHpUniqueId,
  getUnansweredCandidates,
  getOverdueCandidates,
  updateCandidatesResponded,
  updateCandidateStatus,
  insertEvents,
  findRecruitmentLeads,
  findRecruitmentLeadByBookingId,
  findCandidatesByLeadId,
  findEventsByCandidateIds,
  findCandidatesOfCaregiver,
  getRecruitmentCounts,
};
