/**
 * Config router — /config endpoints.
 * Ported from the Next.js dashboard API routes.
 *
 * /config                GET read config.json  |  PUT write config.json
 * /config/google-sheet   GET batch fetch all 4 sheets
 * /config/sites          GET/POST/DELETE  "Sites Config" sheet
 * /config/cities         GET/POST/DELETE  "Cities Config" sheet
 * /config/keywords       GET/POST/DELETE  "Keywords" sheet
 * /config/competitors    GET/POST/DELETE  "Competitors Config" sheet
 */

import { Router, Request, Response } from "express";
import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";

const router = Router();

// ── Shared Google Sheets helpers ──────────────────────────────────────
function getAuth() {
  const raw = process.env.GSC_OAUTH_SITE_1;
  if (!raw) throw new Error("Missing GSC_OAUTH_SITE_1 env var");
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(raw) as object,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSpreadsheetId(siteId: number): string {
  const id = process.env[`SHEETS_ID_${siteId}`] ?? process.env.SHEETS_ID;
  if (!id) throw new Error(`Missing SHEETS_ID_${siteId} (or SHEETS_ID) env var`);
  return id.trim();
}

async function getSheetGid(spreadsheetId: string, tabName: string): Promise<number> {
  const sheets = google.sheets({ version: "v4", auth: getAuth() });
  const { data } = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = data.sheets?.find((s) => s.properties?.title === tabName);
  if (sheet?.properties?.sheetId == null) throw new Error(`Tab "${tabName}" not found`);
  return sheet.properties.sheetId;
}

// ── Local config.json ─────────────────────────────────────────────────
const CONFIG_FILE = path.join(process.cwd(), "data", "config.json");

function readConfig(): Record<string, unknown> {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// GET /config
router.get("/", (_req: Request, res: Response) => {
  res.json(readConfig());
});

// PUT /config
router.put("/", (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(body, null, 2));
    res.json({ ok: true });
  } catch (err) {
    console.error("[config PUT]", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Google Sheet — batch fetch all ranges ─────────────────────────────
// GET /config/google-sheet
router.get("/google-sheet", async (_req: Request, res: Response) => {
  try {
    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    const { data } = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: getSpreadsheetId(1),
      ranges: [
        "Sites Config!A:E",
        "Cities Config!A:E",
        "Keywords Config!A:C",
        "Competitors Config!A:C",
      ],
    });
    res.json(data.valueRanges);
  } catch (err) {
    console.error("[google-sheet GET]", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Sites Config ──────────────────────────────────────────────────────
const SITES_TAB = "Sites Config";

// GET /config/sites
router.get("/sites", async (req: Request, res: Response) => {
  try {
    const siteId = Number(req.query.siteIds ?? 1);
    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(siteId),
      range: `'${SITES_TAB}'!A:E`,
    });

    const rows = data.values ?? [];
    const sites = rows.slice(1).map((row, i) => ({
      rowIndex: i + 2,
      site_id:    row[0] ?? "",
      domain:     row[1] ?? "",
      brand_name: row[2] ?? "",
      industry:   row[3] ?? "",
      cities:     row[4] ?? "",
    }));
    res.json(sites);
  } catch (err) {
    console.error("[sites GET]", err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /config/sites  (create or update)
router.post("/sites", async (req: Request, res: Response) => {
  try {
    const { rowIndex, site_id, domain = "", brand_name = "", industry = "", cities = "" } =
      req.body as {
        rowIndex?: number;
        site_id: number;
        domain?: string;
        brand_name?: string;
        industry?: string;
        cities?: string;
      };

    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    const spreadsheetId = getSpreadsheetId(1);
    const values = [[Number(site_id), domain, brand_name, industry, cities]];

    if (rowIndex) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SITES_TAB}'!A${rowIndex}:E${rowIndex}`,
        valueInputOption: "RAW",
        requestBody: { values },
      });
      return res.json({ ok: true, updated: rowIndex });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${SITES_TAB}'!A:E`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
    res.status(201).json({ ok: true, appended: true });
  } catch (err) {
    console.error("[sites POST]", err);
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /config/sites
router.delete("/sites", async (req: Request, res: Response) => {
  try {
    const { rowIndex } = req.body as { rowIndex: number };
    if (!rowIndex) return res.status(400).json({ error: "rowIndex is required" });

    const spreadsheetId = getSpreadsheetId(1);
    const sheetId = await getSheetGid(spreadsheetId, SITES_TAB);
    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: rowIndex - 1, endIndex: rowIndex },
          },
        }],
      },
    });
    res.json({ ok: true, deleted: rowIndex });
  } catch (err) {
    console.error("[sites DELETE]", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Cities Config ─────────────────────────────────────────────────────
const CITIES_TAB = "Cities Config";

// GET /config/cities
router.get("/cities", async (req: Request, res: Response) => {
  try {
    const siteId = Number(req.query.siteIds ?? 1);
    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(siteId),
      range: `'${CITIES_TAB}'!A:E`,
    });

    const rows = data.values ?? [];
    const cities = rows.slice(1).map((row, i) => ({
      rowIndex: i + 2,
      site_id:        row[0] ?? "",
      city:           row[1] ?? "",
      state:          row[2] ?? "",
      country:        row[3] ?? "",
      target_keyword: row[4] ?? "",
    }));
    res.json(cities);
  } catch (err) {
    console.error("[cities GET]", err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /config/cities
router.post("/cities", async (req: Request, res: Response) => {
  try {
    const {
      rowIndex, site_id,
      city = "", state = "", country = "", target_keyword = "",
    } = req.body as {
      rowIndex?: number;
      site_id: number;
      city?: string;
      state?: string;
      country?: string;
      target_keyword?: string;
    };

    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    const spreadsheetId = getSpreadsheetId(1);
    const values = [[Number(site_id), city, state, country, target_keyword]];

    if (rowIndex) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${CITIES_TAB}'!A${rowIndex}:E${rowIndex}`,
        valueInputOption: "RAW",
        requestBody: { values },
      });
      return res.json({ ok: true, updated: rowIndex });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${CITIES_TAB}'!A:E`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
    res.status(201).json({ ok: true, appended: true });
  } catch (err) {
    console.error("[cities POST]", err);
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /config/cities
router.delete("/cities", async (req: Request, res: Response) => {
  try {
    const { rowIndex } = req.body as { rowIndex: number };
    if (!rowIndex) return res.status(400).json({ error: "rowIndex is required" });

    const spreadsheetId = getSpreadsheetId(1);
    const sheetId = await getSheetGid(spreadsheetId, CITIES_TAB);
    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: rowIndex - 1, endIndex: rowIndex },
          },
        }],
      },
    });
    res.json({ ok: true, deleted: rowIndex });
  } catch (err) {
    console.error("[cities DELETE]", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Keywords ──────────────────────────────────────────────────────────
const KEYWORDS_TAB = "Keywords";

// GET /config/keywords
router.get("/keywords", async (req: Request, res: Response) => {
  try {
    const siteId = Number(req.query.siteIds ?? 1);
    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(siteId),
      range: `'${KEYWORDS_TAB}'!A:C`,
    });

    const rows = data.values ?? [];
    const keywords = rows.slice(1).map((row, i) => ({
      rowIndex: i + 2,
      site_id:         row[0] ?? "",
      domain:          row[1] ?? "",
      target_keywords: row[2] ?? "",
    }));
    res.json(keywords);
  } catch (err) {
    console.error("[keywords GET]", err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /config/keywords
router.post("/keywords", async (req: Request, res: Response) => {
  try {
    const { rowIndex, site_id, domain = "", target_keywords = "" } = req.body as {
      rowIndex?: number;
      site_id: number;
      domain?: string;
      target_keywords?: string;
    };

    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    const spreadsheetId = getSpreadsheetId(1);
    const values = [[Number(site_id), domain, target_keywords]];

    if (rowIndex) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${KEYWORDS_TAB}'!A${rowIndex}:C${rowIndex}`,
        valueInputOption: "RAW",
        requestBody: { values },
      });
      return res.json({ ok: true, updated: rowIndex });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${KEYWORDS_TAB}'!A:C`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
    res.status(201).json({ ok: true, appended: true });
  } catch (err) {
    console.error("[keywords POST]", err);
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /config/keywords
router.delete("/keywords", async (req: Request, res: Response) => {
  try {
    const { rowIndex } = req.body as { rowIndex: number };
    if (!rowIndex) return res.status(400).json({ error: "rowIndex is required" });

    const spreadsheetId = getSpreadsheetId(1);
    const sheetId = await getSheetGid(spreadsheetId, KEYWORDS_TAB);
    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: rowIndex - 1, endIndex: rowIndex },
          },
        }],
      },
    });
    res.json({ ok: true, deleted: rowIndex });
  } catch (err) {
    console.error("[keywords DELETE]", err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Competitors Config ────────────────────────────────────────────────
const COMPETITORS_TAB = "Competitors Config";

// GET /config/competitors
router.get("/competitors", async (req: Request, res: Response) => {
  try {
    const siteId = Number(req.query.siteIds ?? 1);
    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(siteId),
      range: `'${COMPETITORS_TAB}'!A:C`,
    });

    const rows = data.values ?? [];
    const competitors = rows.slice(1).map((row, i) => ({
      rowIndex: i + 2,
      site_id:            row[0] ?? "",
      domain:             row[1] ?? "",
      competitors_domain: row[2] ?? "",
    }));
    res.json(competitors);
  } catch (err) {
    console.error("[competitors GET]", err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /config/competitors
router.post("/competitors", async (req: Request, res: Response) => {
  try {
    const { rowIndex, site_id, domain = "", competitors_domain = "" } = req.body as {
      rowIndex?: number;
      site_id: number;
      domain?: string;
      competitors_domain?: string;
    };

    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    const spreadsheetId = getSpreadsheetId(1);
    const values = [[Number(site_id), domain, competitors_domain]];

    if (rowIndex) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${COMPETITORS_TAB}'!A${rowIndex}:C${rowIndex}`,
        valueInputOption: "RAW",
        requestBody: { values },
      });
      return res.json({ ok: true, updated: rowIndex });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${COMPETITORS_TAB}'!A:C`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
    res.status(201).json({ ok: true, appended: true });
  } catch (err) {
    console.error("[competitors POST]", err);
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /config/competitors
router.delete("/competitors", async (req: Request, res: Response) => {
  try {
    const { rowIndex } = req.body as { rowIndex: number };
    if (!rowIndex) return res.status(400).json({ error: "rowIndex is required" });

    const spreadsheetId = getSpreadsheetId(1);
    const sheetId = await getSheetGid(spreadsheetId, COMPETITORS_TAB);
    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: rowIndex - 1, endIndex: rowIndex },
          },
        }],
      },
    });
    res.json({ ok: true, deleted: rowIndex });
  } catch (err) {
    console.error("[competitors DELETE]", err);
    res.status(500).json({ error: String(err) });
  }
});

export { router as configRouter };
