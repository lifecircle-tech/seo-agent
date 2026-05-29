import mysql from "mysql2/promise";

const pulsePool = mysql.createPool({
  uri: process.env.PULSE_DATABASE_URL ?? "mysql://root:@localhost:3306/lifecirclefamily",
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "Z",
});

export default pulsePool;
