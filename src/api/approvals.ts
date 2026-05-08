/**
 * Approval Queue API — Express + Socket.io entry point.
 * Routes  → src/api/routes/
 * DB logic → src/api/controllers/
 */

import "dotenv/config";
import express, { Request, Response } from "express";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import cron from "node-cron";

import { approvalsRouter } from "./routes/approvals.routes.js";
import { alertsRouter } from "./routes/alerts.routes.js";
import { usersRouter } from "./routes/users.routes.js";
import { requireAuth } from "./middleware/auth.middleware.js";
import { createApprovalsTable } from "./controllers/approvals.controller.js";
import { createAlertsTable } from "./controllers/alerts.controller.js";
import { createUsersTable } from "./controllers/users.controller.js";
import pool from "./db.js";

import { weeklyTasks } from "./orchestrators/weekly.js";
import { monthlyDiscovery } from "./orchestrators/monthly-discovery.js";

cron.schedule(
  "0 8 * * 1",
  () => {
    weeklyTasks();
  },
  {
    timezone: "IST",
    name: "Weekly Tasks",
  },
);

cron.schedule(
  "0 7 11 * *",
  () => {
    monthlyDiscovery();
  },
  {
    timezone: "IST",
    name: "Monthly Discovery",
  },
);

// ── App + Socket.io ───────────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: [
      process.env.DASHBOARD_URL ?? "http://localhost:3001",
      "http://localhost:3001",
    ],
    methods: ["GET", "POST"],
  },
});

app.use(
  cors({
    origin: [
      process.env.DASHBOARD_URL ?? "http://localhost:3001",
      "http://localhost:3001",
    ],
  }),
);
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────
app.use("/approvals", approvalsRouter(io));
app.use("/alerts", requireAuth, alertsRouter(io));
app.use("/users", usersRouter);

// ── Health ────────────────────────────────────────────────────────────
app.get("/health", async (_req: Request, res: Response) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      success: true,
      status: "ok",
      service: "approvals-api",
      db: "mysql",
      clients: io.engine.clientsCount,
      uptime: process.uptime(),
    });
  } catch (err) {
    res.status(503).json({ success: false, status: "error", db: String(err) });
  }
});

// ── POST /emit — called by MCP servers / orchestrators ────────────────
app.post("/emit", (req: Request, res: Response) => {
  const { event, data } = req.body as { event?: string; data?: unknown };
  if (!event) {
    res.status(400).json({ success: false, error: "event is required" });
    return;
  }
  io.emit(event, data ?? {});
  res.json({ success: true, ok: true, event, clients: io.engine.clientsCount });
});

// ── Socket.io ─────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[socket] connected: ${socket.id}`);
  socket.on("disconnect", () =>
    console.log(`[socket] disconnected: ${socket.id}`),
  );
});

// ── Start ─────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3002);

if (process.env.NODE_ENV !== "test") {
  Promise.all([createApprovalsTable(), createAlertsTable(), createUsersTable()])
    .then(() => {
      console.log("[db] tables ready");
      httpServer.listen(PORT, () =>
        console.log(`[approvals-api] listening on port ${PORT}`),
      );
    })
    .catch((err) => {
      console.error("[db] failed to initialise:", err);
      process.exit(1);
    });
}

export { app, httpServer, io };
