import { NextRequest, NextResponse } from "next/server";

const { google } = require("googleapis");

function getAuth() {
  const raw = process.env.GSC_OAUTH_SITE_1;
  if (!raw) throw new Error("Missing GSC_OAUTH_SITE_1");
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(raw) as object,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSpreadsheetId(site_id: number) {
  const key = `SHEETS_ID_${site_id}`;
  const id = process.env[key];
  if (!id) throw new Error(`Missing ${key}`);
  return id;
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;

    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    const { data } = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: getSpreadsheetId(1),
      ranges: ["Sites Config!A:E", "Cities Config!A:E", "Keywords Config!A:C", "Competitors Config!A:C"]
    });

    return NextResponse.json(data.valueRanges);
  } catch (err) {
    console.error("[cities GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
