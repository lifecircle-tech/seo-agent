import { Router } from "express";
import { Server as SocketIOServer } from "socket.io";

import { approvalsRouter } from "./approvals.routes.js";
import { alertsRouter } from "./alerts.routes.js";
import { configRouter } from "./config.routes.js";
import { sitesRouter } from "./sites.routes.js";
import { pageContentRouter } from "./page-content.routes.js";
import { dashboardRouter } from "./dashboard.routes.js";

export function seoAgentRouter (io: SocketIOServer): Router {
    const router = Router();
    router.use("/approvals", approvalsRouter(io));
    router.use("/alerts", alertsRouter(io));
    router.use("/contents", pageContentRouter(io));
    router.use("/config", configRouter);
    router.use("/sites", sitesRouter);
    router.use("/dashboard", dashboardRouter);

    return router;
}