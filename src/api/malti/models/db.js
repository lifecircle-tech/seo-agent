import mysql from "mysql2/promise";

// seo_agent DB — malti operational tables (db_write_requests, run_history, training)
export const pool = mysql.createPool({
  uri: process.env.DATABASE_URL ?? "mysql://root:@localhost:3306/lifecirclefamily",
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "Z",
});

// lifecircle_pulse DB — campaigns, contacts, contact_registry
export const pulsePool = mysql.createPool({
  uri: process.env.PULSE_DATABASE_URL ?? "mysql://root:@localhost:3306/lifecircle_pulse",
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "Z",
});

// Legacy LifeCircle DB — auth (life_emp_details), care_jobs (n_care_jobs_leads, n_bolna_activity_log)
export const legacyPool = mysql.createPool({
  uri: process.env.LEGACY_DATABASE_URL ?? "mysql://root:@localhost:3306/lifecirclefamily",
  waitForConnections: true,
  connectionLimit: 5,
  timezone: "Z",
});
