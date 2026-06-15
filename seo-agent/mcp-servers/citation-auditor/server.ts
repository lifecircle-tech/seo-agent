import fs from "node:fs";

// ── Cache (24-hour) ───────────────────────────────────────────────────
const CACHE_DIR = "/tmp/cache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getCachePath(siteId: number, type: string): string {
  return `${CACHE_DIR}/brightlocal_site${siteId}_${type}.json`;
}

function readCache(siteId: number, type: string): unknown | null {
  const path = getCachePath(siteId, type);
  try {
    if (!fs.existsSync(path)) return null;
    const raw = fs.readFileSync(path, "utf-8");
    const cached = JSON.parse(raw);
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null;
    return cached.data;
  } catch {
    return null;
  }
}

function writeCache(siteId: number, type: string, data: unknown): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    getCachePath(siteId, type),
    JSON.stringify({ timestamp: Date.now(), data }),
  );
}

// ── BrightLocal API helper ────────────────────────────────────────────
const BRIGHTLOCAL_BASE = "https://tools.brightlocal.com/seo-tools/api/v4";

function getBrightLocalKey(): string {
  const key = process.env.BRIGHTLOCAL_KEY;
  if (!key) throw new Error("Missing env var BRIGHTLOCAL_KEY");
  return key;
}

function getBrightLocalReportId(siteId: number): string {
  const key = `BRIGHTLOCAL_REPORT_ID_SITE_${siteId}`;
  const id = process.env[key];
  if (!id) throw new Error(`Missing env var ${key}`);
  return id;
}

async function brightLocalFetch(
  endpoint: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  const apiKey = getBrightLocalKey();
  const url = new URL(`${BRIGHTLOCAL_BASE}${endpoint}`);
  url.searchParams.set("api-key", apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`BrightLocal API error ${res.status}: ${msg}`);
  }
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────
export type NapInconsistency = {
  directory: string;
  listing_url: string;
  field: "business_name" | "address" | "phone" | "website";
  expected: string;
  found: string;
};

export type MissingDirectory = {
  name: string;
  domain_authority: number;
  priority: "high" | "medium" | "low";
};

export type IncorrectListing = {
  directory: string;
  listing_url: string;
  issue: string;
  severity: "critical" | "major" | "minor";
};

export type CitationAuditResult = {
  site_id: number;
  report_id: string;
  citations_found: number;
  citations_total_checked: number;
  nap_inconsistencies: NapInconsistency[];
  missing_directories: MissingDirectory[];
  incorrect_listings: IncorrectListing[];
  cached: boolean;
};

export type CitationScore = {
  site_id: number;
  score: number; // 0–100
  grade: "A" | "B" | "C" | "D" | "F";
  citations_found: number;
  nap_accuracy_pct: number;
  coverage_pct: number;
  breakdown: {
    nap_consistency: number;
    directory_coverage: number;
    listing_accuracy: number;
  };
};

export type PriorityFix = {
  rank: number;
  directory: string;
  issue_type: "nap_inconsistency" | "missing_listing" | "incorrect_info";
  description: string;
  impact: "high" | "medium" | "low";
  listing_url?: string;
};

// ── Raw BrightLocal response shape ───────────────────────────────────
type BrightLocalCitation = {
  directory: string;
  status: "found" | "not-found" | "inconsistent";
  listing_url?: string;
  business_name?: string;
  address?: string;
  phone?: string;
  website?: string;
  issues?: Array<{ field: string; expected: string; found: string }>;
};

type BrightLocalReportResponse = {
  success: boolean;
  score?: number;
  citations?: BrightLocalCitation[];
  directories_checked?: number;
  error?: string;
};

// ── Tool: audit_citations ─────────────────────────────────────────────
export async function auditCitations(
  siteId: number,
): Promise<CitationAuditResult> {
  const cached = readCache(siteId, "audit") as CitationAuditResult | null;
  if (cached) {
    console.log(
      `[audit_citations] Returning cached result for site_id=${siteId}`,
    );
    return { ...cached, cached: true };
  }

  const reportId = getBrightLocalReportId(siteId);
  console.log(
    `[audit_citations] Fetching BrightLocal report ${reportId} for site_id=${siteId}...`,
  );

  const raw = (await brightLocalFetch("/citation/search/get-results", {
    "report-id": reportId,
  })) as BrightLocalReportResponse;

  if (!raw.success) {
    throw new Error(
      `BrightLocal report fetch failed: ${raw.error ?? "unknown error"}`,
    );
  }

  const citations = raw.citations ?? [];
  const directoriesChecked = raw.directories_checked ?? citations.length;

  // Build structured lists from raw citations
  const napInconsistencies: NapInconsistency[] = [];
  const missingDirectories: MissingDirectory[] = [];
  const incorrectListings: IncorrectListing[] = [];

  const priorityMap: Record<string, "high" | "medium" | "low"> = {
    Google: "high",
    Yelp: "high",
    Bing: "high",
    Facebook: "high",
    "Apple Maps": "high",
    Foursquare: "medium",
    YellowPages: "medium",
    TripAdvisor: "medium",
  };

  for (const citation of citations) {
    if (citation.status === "not-found") {
      missingDirectories.push({
        name: citation.directory,
        domain_authority: 0, // BrightLocal v4 doesn't surface DA directly
        priority: priorityMap[citation.directory] ?? "low",
      });
    } else if (citation.status === "inconsistent") {
      for (const issue of citation.issues ?? []) {
        napInconsistencies.push({
          directory: citation.directory,
          listing_url: citation.listing_url ?? "",
          field: issue.field as NapInconsistency["field"],
          expected: issue.expected,
          found: issue.found,
        });
      }

      if ((citation.issues ?? []).length > 0) {
        incorrectListings.push({
          directory: citation.directory,
          listing_url: citation.listing_url ?? "",
          issue: `${citation.issues!.length} field(s) inconsistent: ${citation.issues!.map((i) => i.field).join(", ")}`,
          severity:
            (citation.issues ?? []).length >= 2
              ? "critical"
              : (citation.issues ?? []).length === 1
                ? "major"
                : "minor",
        });
      }
    }
  }

  const result: CitationAuditResult = {
    site_id: siteId,
    report_id: reportId,
    citations_found: citations.filter((c) => c.status !== "not-found").length,
    citations_total_checked: directoriesChecked,
    nap_inconsistencies: napInconsistencies,
    missing_directories: missingDirectories,
    incorrect_listings: incorrectListings,
    cached: false,
  };

  writeCache(siteId, "audit", result);
  console.log(
    `[audit_citations] Done: ${napInconsistencies.length} NAP issues, ${missingDirectories.length} missing dirs`,
  );

  return result;
}

// ── Tool: get_citation_score ──────────────────────────────────────────
export async function getCitationScore(siteId: number): Promise<CitationScore> {
  const audit = await auditCitations(siteId);

  const total = audit.citations_total_checked || 1;
  const found = audit.citations_found;
  const napIssues = audit.nap_inconsistencies.length;
  const missing = audit.missing_directories.length;

  // Coverage: % of directories where a listing was found
  const coveragePct = Math.round((found / total) * 100);

  // NAP accuracy: % of found listings with no NAP issues
  const napAccuracyPct =
    found === 0
      ? 100
      : Math.round(
          ((found - new Set(audit.nap_inconsistencies.map((n) => n.directory)).size) /
            found) *
            100,
        );

  // Listing accuracy: penalise incorrect listings
  const incorrectCount = audit.incorrect_listings.filter(
    (l) => l.severity === "critical" || l.severity === "major",
  ).length;
  const listingAccuracyPct =
    found === 0
      ? 100
      : Math.round(((found - incorrectCount) / found) * 100);

  // Weighted composite score
  const score = Math.round(
    coveragePct * 0.35 + napAccuracyPct * 0.4 + listingAccuracyPct * 0.25,
  );

  const grade =
    score >= 90
      ? ("A" as const)
      : score >= 75
        ? ("B" as const)
        : score >= 60
          ? ("C" as const)
          : score >= 45
            ? ("D" as const)
            : ("F" as const);

  return {
    site_id: siteId,
    score,
    grade,
    citations_found: found,
    nap_accuracy_pct: napAccuracyPct,
    coverage_pct: coveragePct,
    breakdown: {
      nap_consistency: napAccuracyPct,
      directory_coverage: coveragePct,
      listing_accuracy: listingAccuracyPct,
    },
  };
}

// ── Tool: get_priority_fixes ──────────────────────────────────────────
export async function getPriorityFixes(
  siteId: number,
): Promise<{ site_id: number; total_fixes: number; fixes: PriorityFix[] }> {
  const audit = await auditCitations(siteId);

  const fixes: Array<Omit<PriorityFix, "rank">> = [];

  // Critical: NAP inconsistencies on high-DA directories
  const highPriorityDirs = new Set(["Google", "Yelp", "Bing", "Facebook", "Apple Maps"]);
  for (const nap of audit.nap_inconsistencies) {
    fixes.push({
      directory: nap.directory,
      issue_type: "nap_inconsistency",
      description: `${nap.field} mismatch — expected "${nap.expected}", found "${nap.found}"`,
      impact: highPriorityDirs.has(nap.directory) ? "high" : "medium",
      listing_url: nap.listing_url,
    });
  }

  // High: Missing high-priority directories
  for (const dir of audit.missing_directories.filter(
    (d) => d.priority === "high",
  )) {
    fixes.push({
      directory: dir.name,
      issue_type: "missing_listing",
      description: `No listing found on ${dir.name} — create one`,
      impact: "high",
    });
  }

  // Medium: Other missing directories
  for (const dir of audit.missing_directories.filter(
    (d) => d.priority === "medium",
  )) {
    fixes.push({
      directory: dir.name,
      issue_type: "missing_listing",
      description: `No listing found on ${dir.name} — create one`,
      impact: "medium",
    });
  }

  // Medium/Low: Incorrect info not already captured in NAP inconsistencies
  for (const listing of audit.incorrect_listings) {
    const alreadyCovered = fixes.some(
      (f) => f.directory === listing.directory && f.issue_type === "nap_inconsistency",
    );
    if (!alreadyCovered) {
      fixes.push({
        directory: listing.directory,
        issue_type: "incorrect_info",
        description: listing.issue,
        impact: listing.severity === "critical" ? "high" : "medium",
        listing_url: listing.listing_url,
      });
    }
  }

  // Sort: high → medium → low, then limit to top 10
  const impactOrder = { high: 0, medium: 1, low: 2 };
  const top10 = fixes
    .sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact])
    .slice(0, 10)
    .map((fix, i) => ({ rank: i + 1, ...fix }));

  return {
    site_id: siteId,
    total_fixes: fixes.length,
    fixes: top10,
  };
}
