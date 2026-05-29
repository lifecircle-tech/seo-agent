import { google } from "googleapis";

function getGSCAuth() {
  const envKey = `GSC_OAUTH_SITE`;
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`Missing env var ${envKey}`);
  }
  return raw;
}

// ── GSC helpers ──────────────────────────────────────────────────────
export function getGscAuth() {
  const raw = getGSCAuth();
  const credentials = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  return auth;
}

export function getSearchConsoleClient() {
  const auth = getGscAuth();
  return google.searchconsole({ version: "v1", auth });
}

// ── Sheets helpers ─────────────────────────────────────────────────────
export function getSheetsClient() {
  const raw = getGSCAuth();
  const credentials = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

export function getSpreadsheetId() {
  const id = process.env.SHEETS_ID?.trim();
  if (!id) throw new Error("Missing env var SHEETS_ID");
  return id;
}
