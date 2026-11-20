/**
 * MySQL pool for the WhatsApp service. The service owns its own database
 * (WHATSAPP_DATABASE_URL); nothing else should write to these tables.
 */

import mysql from "mysql2/promise";
import { config } from "./config.js";

const wa_pool = mysql.createPool({
  uri: config.databaseUrl,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "Z",
  charset: "utf8mb4",
});

export { wa_pool };
