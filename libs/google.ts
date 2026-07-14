import { google } from "googleapis";
import { logger } from "../seo-agent/utils/logger";

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

////////////////////////////////////////////////////////////////////////

interface GbpCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  access_token: string;
}

function getGbpCredentials(): GbpCredentials {
  const raw = process.env.GBP_OAUTH_SITE;
  const id = process.env.GBP_CLIENT_ID;
  const secret = process.env.GBP_CLIENT_SECRET;
  if (!raw) throw new Error("Missing env var GBP_OAUTH_SITE");
  return {
    ...JSON.parse(raw),
    client_id: id,
    client_secret: secret,
  } as GbpCredentials;
}

export function generateOAuthURL() {
  const gbp_auth = getGbpCredentials();

  const oauth2Client = new google.auth.OAuth2(
    gbp_auth.client_id,
    gbp_auth.client_secret,
    "http://localhost:3000",
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/adwords",
      "https://www.googleapis.com/auth/business.manage",
      "https://www.googleapis.com/auth/userinfo.profile",
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
  });

  console.log("OAuth URL ", url);
}

export function getGbpOAuth() {
  const gbp_auth = getGbpCredentials();

  const oauth2Client = new google.auth.OAuth2(
    gbp_auth.client_id,
    gbp_auth.client_secret,
    "http://localhost:3000",
  );

  oauth2Client.setCredentials({
    refresh_token: gbp_auth.refresh_token,
  });

  return oauth2Client;
}

export function getGbpAccountsClient() {
  logger.info(`============= GBP Fetching ***************`);
  const oauth2Client = getGbpOAuth();

  logger.info("============= GBP Getting Account Name ***************");
  return google.mybusinessaccountmanagement({
    version: "v1",
    auth: oauth2Client,
  });
}

export function getGbpLocationsClient() {
  logger.info(`============= GBP Location Fetching ***************`);
  const oauth2Client = getGbpOAuth();

  logger.info("============= GBP Getting Location ***************");
  return google.mybusinessbusinessinformation({
    version: "v1",
    auth: oauth2Client,
  });
}

export async function getGbpPerformaceClient() {
  logger.info(`============= GBP Metrics Fetching ***************`);
  const oauth2Client = getGbpOAuth();

  logger.info("============= GBP Getting Location Metrics ***************");
  return google.businessprofileperformance({
    version: "v1",
    auth: oauth2Client,
  });
}

export async function getGbpReviewsClient(
  accountId: string,
  locationId: string,
) {
  logger.info(`============= GBP Reviews Fetching ***************`);
  const oauth2Client = getGbpOAuth();

  logger.info("============= GBP Getting Review ***************", {
    accountId,
    locationId,
  });
  const response = await oauth2Client.request({
    url: `https://mybusiness.googleapis.com/v4/${accountId}/${locationId}/reviews`,
    method: "GET",
    params: {
      pageSize: 10,
      orderBy: "updateTime desc", // Optional: brings freshest reviews first
    },
  });

  logger.info("Reviews : ", response.data);
  return response.data;
}
