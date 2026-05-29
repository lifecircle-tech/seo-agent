/**
 * Approval Queue API — Express + Socket.io entry point.
 * Routes  → src/api/routes/
 * DB logic → src/api/controllers/
 */

import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import cron from "node-cron";

import { approvalsRouter } from "./seo-agent/routes/approvals.routes.js";
import { alertsRouter } from "./seo-agent/routes/alerts.routes.js";
import { configRouter } from "./seo-agent/routes/config.routes.js";
import { sitesRouter } from "./seo-agent/routes/sites.routes.js";
import { initSEOModels } from "./seo-agent/models/index.js";
import { pool } from "./db.js";
import { maltiRouter, initMalti } from "./malti/index.js";

import { weeklyTasks } from "./seo-agent/orchestrators/weekly.js";
import { monthlyDiscovery } from "./seo-agent/orchestrators/monthly-discovery.js";

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
  "0 7 1 * *",
  () => {
    monthlyDiscovery();
  },
  {
    timezone: "IST",
    name: "Monthly Discovery",
  },
);

// ── CORS — allow DASHBOARD_URL explicitly; in dev allow any localhost port
//    so Next.js hot-reload port changes never break the dashboard
const DASHBOARD_ORIGIN = process.env.DASHBOARD_URL ?? "http://localhost:3001";

const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // server-to-server calls have no Origin header
  if (origin === DASHBOARD_ORIGIN) return true;
  if (EXTRA_ORIGINS.includes(origin)) return true;
  if (
    process.env.NODE_ENV !== "production" &&
    /^http:\/\/localhost:\d+$/.test(origin)
  )
    return true;
  return false;
}

const corsOptions = {
  origin: (
    origin: string | undefined,
    cb: (err: Error | null, allow?: boolean) => void,
  ) => cb(null, isAllowedOrigin(origin)),
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

// ── App + Socket.io ───────────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: { ...corsOptions, methods: ["GET", "POST"] },
});

app.use(cors(corsOptions));
app.use(express.json());

app.use((req, _res, next) => {
  console.log(
    `[${req.method}] ${req.originalUrl}, ${JSON.stringify(req.query)}`,
  );
  next();
});

// ── Routes ────────────────────────────────────────────────────────────
app.use("/approvals", approvalsRouter(io));
app.use("/alerts", alertsRouter(io));
app.use("/config", configRouter);
app.use("/sites", sitesRouter);
app.use("/malti", maltiRouter);

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

// ── Global error handler ──────────────────────────────────────────────
// body-parser / raw-body throws "BadRequestError: request aborted" when the
// browser drops the connection before the body is fully received (tab close,
// navigate-away, React StrictMode double-fetch cleanup, etc.).
// Without this middleware Express logs a full stack trace for every one.
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === "request.aborted" || err?.message === "request aborted") {
    // Client closed the connection — nothing to respond to, just swallow it.
    return;
  }
  console.error("[express error]", err?.message ?? err);
  if (!res.headersSent) {
    res
      .status(err?.status ?? 500)
      .json({ success: false, error: err?.message ?? "Internal server error" });
  }
});

// ── Start ─────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3002);
console.log(
  `[startup] CORS: DASHBOARD_URL=${DASHBOARD_ORIGIN}, dev-localhost wildcard=${process.env.NODE_ENV !== "production"}`,
);

if (process.env.NODE_ENV !== "test") {
  // Run each table init separately so we can log exactly which step fails
  const initSteps: Array<[string, () => Promise<void>]> = [
    ["seo-agent table", initSEOModels],
    ["malti tables", initMalti],
  ];

  (async () => {
    // Startup DB reachability check — log before any table work
    try {
      await pool.query("SELECT 1");
      console.log(
        `[startup] ✓ DB connected → ${process.env.DATABASE_URL?.replace(/:[^@]+@/, ":***@") ?? "mysql://localhost/seo_agent"}`,
      );
    } catch (err) {
      console.error(
        "[startup] ✗ DB connection FAILED:",
        (err as Error).message,
      );
      console.error("[startup]   → Check DATABASE_URL env var");
      process.exit(1);
    }

    for (const [label, fn] of initSteps) {
      try {
        await fn();
        console.log(`[startup] ✓ ${label} ready`);
      } catch (err) {
        console.error(
          `[startup] ✗ ${label} init FAILED:`,
          (err as Error).message,
        );
        process.exit(1);
      }
    }

    console.log("[db] tables ready");
    httpServer.listen(PORT, () =>
      console.log(`[approvals-api] listening on port ${PORT}`),
    );
  })();
}

export { app, httpServer, io };
