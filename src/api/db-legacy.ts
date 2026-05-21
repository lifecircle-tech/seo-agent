import mysql from "mysql2/promise";

const legacyPool = mysql.createPool({
  uri: process.env.LEGACY_DATABASE_URL ?? "mysql://root:@localhost:3306/lifecircle",
  waitForConnections: true,
  connectionLimit: 5,
  timezone: "Z",
});

export default legacyPool;
