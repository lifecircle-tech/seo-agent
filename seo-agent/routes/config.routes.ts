/**
 * Config router — /config endpoints.
 * Ported from the Next.js dashboard API routes.
 */

import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";

// Import controllers
import {
  createSiteConfig,
  listSitesConfigs,
  updateSiteConfig,
  deleteSiteConfig,
} from "../controllers/sites.controller.js";
import {
  createCityConfig,
  listCitiesConfigs,
  updateCityConfig,
  deleteCityConfig,
} from "../controllers/cities.controller.js";
import {
  createKeywordConfig,
  listKeywordsConfigs,
  updateKeywordConfig,
  deleteKeywordConfig,
} from "../controllers/keywords-config.controller.js";
import {
  createCompetitorConfig,
  listCompetitorConfigs,
  updateCompetitorConfig,
  deleteCompetitorConfig,
} from "../controllers/competitor.controller.js";
import { logger } from "../utils/logger.js";

const router = Router();

// ── Sites Config ──────────────────────────────────────────────────────

// GET /config/sites
router.get("/sites", async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;

    const {
      sites,
      total,
      limit: actualLimit,
      offset: actualOffset,
    } = await listSitesConfigs({
      limit,
      offset,
    });

    res.json(sites);
  } catch (err) {
    logger.error("[sites GET]", err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /config/sites (create or update)
router.post("/sites", async (req: Request, res: Response) => {
  try {
    const { id, site_id, domain, brand_name, industry, cities } = req.body as {
      id?: string;
      site_id: number;
      domain: string;
      brand_name: string;
      industry: string;
      cities: string[];
    };

    if (!site_id || !domain || !brand_name || !industry || !cities) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (typeof cities !== "object") {
      return res.status(400).json({ error: "Cities must be an array" });
    }

    let config;
    if (id) {
      // Attempt to update
      config = await updateSiteConfig(id, {
        domain,
        brand_name,
        industry,
        cities,
      });
      if (!config) {
        return res
          .status(404)
          .json({ error: "Site config not found for update" });
      }
      res.json({ ok: true, updated: config });
    } else {
      // Create new
      const newId = randomUUID();
      config = await createSiteConfig({
        id: newId,
        site_id,
        domain,
        brand_name,
        industry,
        cities,
      });
      res.status(201).json({ ok: true, created: config });
    }
  } catch (err: any) {
    if (err?.message?.includes("already exists")) {
      return res.status(409).json({ error: err.message });
    }
    logger.error("[sites POST]", err);
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /config/sites
router.delete("/sites", async (req: Request, res: Response) => {
  try {
    const { id } = req.body as { id: string };
    if (!id) return res.status(400).json({ error: "id is required" });

    const deleted = await deleteSiteConfig(id);
    if (!deleted) {
      return res
        .status(404)
        .json({ error: "Site config not found for deletion" });
    }
    res.json({ ok: true, deleted: id });
  } catch (err) {
    logger.error("[sites DELETE]", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Cities Config ─────────────────────────────────────────────────────

// GET /config/cities
router.get("/cities", async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;

    const {
      cities,
      total,
      limit: actualLimit,
      offset: actualOffset,
    } = await listCitiesConfigs({
      limit,
      offset,
    });
    res.json(cities);
  } catch (err) {
    logger.error("[cities GET]", err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /config/cities (create or update)
router.post("/cities", async (req: Request, res: Response) => {
  try {
    const { id, site_id, city, state, country, target_keywords, services } =
      req.body as {
        id?: string;
        site_id: number;
        city: string;
        state: string;
        country: string;
        target_keywords: string[];
        services?: string[] | null;
      };

    if (!site_id || !city || !state || !country || !target_keywords) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (typeof target_keywords !== "object") {
      return res
        .status(400)
        .json({ error: "Target keywords must be an array" });
    }

    if (services !== undefined && services !== null && typeof services !== "object") {
      return res.status(400).json({ error: "Services must be an array or null" });
    }

    let config;
    if (id) {
      // Attempt to update
      config = await updateCityConfig(id, {
        city,
        state,
        country,
        target_keywords,
        ...(services !== undefined ? { services } : {}),
      });
      if (!config) {
        return res
          .status(404)
          .json({ error: "City config not found for update" });
      }
      res.json({ ok: true, updated: config });
    } else {
      // Create new
      const newId = randomUUID();
      config = await createCityConfig({
        id: newId,
        site_id,
        city,
        state,
        country,
        target_keywords,
        services: services ?? null,
      });
      res.status(201).json({ ok: true, created: config });
    }
  } catch (err: any) {
    if (err?.message?.includes("already exists")) {
      return res.status(409).json({ error: err.message });
    }
    logger.error("[cities POST]", err);
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /config/cities
router.delete("/cities", async (req: Request, res: Response) => {
  try {
    const { id } = req.body as { id: string };
    if (!id) return res.status(400).json({ error: "id is required" });

    const deleted = await deleteCityConfig(id);
    if (!deleted) {
      return res
        .status(404)
        .json({ error: "City config not found for deletion" });
    }
    res.json({ ok: true, deleted: id });
  } catch (err) {
    logger.error("[cities DELETE]", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Keywords Config ───────────────────────────────────────────────────

// GET /config/keywords
router.get("/keywords", async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;

    const {
      keywords,
      total,
      limit: actualLimit,
      offset: actualOffset,
    } = await listKeywordsConfigs({
      limit,
      offset,
    });
    res.json(keywords);
  } catch (err) {
    logger.error("[keywords GET]", err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /config/keywords (create or update)
router.post("/keywords", async (req: Request, res: Response) => {
  try {
    const { id, site_id, domain, target_keywords } = req.body as {
      id?: string;
      site_id: number;
      domain: string;
      target_keywords: string[];
    };

    if (!site_id || !domain || !target_keywords) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (typeof target_keywords !== "object") {
      return res
        .status(400)
        .json({ error: "Target keywords must be an array" });
    }

    let config;
    if (id) {
      // Attempt to update
      config = await updateKeywordConfig(id, { domain, target_keywords });
      if (!config) {
        return res
          .status(404)
          .json({ error: "Keyword config not found for update" });
      }
      res.json({ ok: true, updated: config });
    } else {
      // Create new
      const newId = randomUUID();
      config = await createKeywordConfig({
        id: newId,
        site_id,
        domain,
        target_keywords,
      });
      res.status(201).json({ ok: true, created: config });
    }
  } catch (err: any) {
    if (err?.message?.includes("already exists")) {
      return res.status(409).json({ error: err.message });
    }
    logger.error("[keywords POST]", err);
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /config/keywords
router.delete("/keywords", async (req: Request, res: Response) => {
  try {
    const { id } = req.body as { id: string };
    if (!id) return res.status(400).json({ error: "id is required" });

    const deleted = await deleteKeywordConfig(id);
    if (!deleted) {
      return res
        .status(404)
        .json({ error: "Keyword config not found for deletion" });
    }
    res.json({ ok: true, deleted: id });
  } catch (err) {
    logger.error("[keywords DELETE]", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Competitors Config ────────────────────────────────────────────────

// GET /config/competitors
router.get("/competitors", async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;

    const {
      competitors,
      total,
      limit: actualLimit,
      offset: actualOffset,
    } = await listCompetitorConfigs({
      limit,
      offset,
    });

    res.json(competitors);
  } catch (err) {
    logger.error("[competitors GET]", err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /config/competitors (create or update)
router.post("/competitors", async (req: Request, res: Response) => {
  try {
    const { id, site_id, domain, competitor_domain } = req.body as {
      id?: string;
      site_id: number;
      domain: string;
      competitor_domain: string[];
    };

    if (!site_id || !competitor_domain) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (typeof competitor_domain !== "object") {
      return res.status(400).json({ error: "Competitors must be an array" });
    }

    let config;
    if (id) {
      // Attempt to update
      config = await updateCompetitorConfig(id, { competitor_domain });
      if (!config) {
        return res
          .status(404)
          .json({ error: "Competitor config not found for update" });
      }
      res.json({ ok: true, updated: config });
    } else {
      // Create new
      const newId = randomUUID();
      config = await createCompetitorConfig({
        id: newId,
        site_id,
        domain,
        competitor_domain,
      });
      res.status(201).json({ ok: true, created: config });
    }
  } catch (err: any) {
    if (err?.message?.includes("already exists")) {
      return res.status(409).json({ error: err.message });
    }
    logger.error("[competitors POST]", err);
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /config/competitors
router.delete("/competitors", async (req: Request, res: Response) => {
  try {
    const { id } = req.body as { id: string };
    if (!id) return res.status(400).json({ error: "id is required" });

    const deleted = await deleteCompetitorConfig(id);
    if (!deleted) {
      return res
        .status(404)
        .json({ error: "Competitor config not found for deletion" });
    }
    res.json({ ok: true, deleted: id });
  } catch (err) {
    logger.error("[competitors DELETE]", err);
    res.status(500).json({ error: String(err) });
  }
});

export { router as configRouter };
