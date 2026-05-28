/**
 * MySQL connection pool — single shared instance for the entire process.
 * Import `pool` from here; never create a new pool elsewhere.
 */

import mysql from "mysql2/promise";

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL ?? "mysql://root:@localhost:3306/seo_agent",
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "Z",
});

const lc_pool = mysql.createPool({
  uri: process.env.LC_DATABASE_URL ?? "mysql://root:@localhost:3306/seo_agent",
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "Z",
});

export { pool, lc_pool };
