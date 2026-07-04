import { getDomain } from "../../../libs/functions.js";

// ── DataForSEO helpers ────────────────────────────────────────────────

function dfsAuth(): string {
  const user = process.env.DATAFORSEO_USERNAME;
  const pass = process.env.DATAFORSEO_PASSWORD;
  if (!user || !pass)
    throw new Error("Missing DATAFORSEO_USERNAME or DATAFORSEO_PASSWORD");
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

function dfsBase(): string {
  return (
    process.env.DATAFORSEO_BASEURL ?? "https://api.dataforseo.com/v3"
  ).replace(/\/$/, "");
}

async function dfsPost<T = any>(endpoint: string, body: object[]): Promise<T> {
  const res = await fetch(`${dfsBase()}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: dfsAuth(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(
      `DataForSEO ${endpoint} error ${res.status}: ${msg.slice(0, 300)}`,
    );
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────

export interface LinkProspect {
  referring_domain: string;
  backlinks_to_competitors: number;
  linked_competitors: string[];
  contact_hint: string;
}

export interface FindLinkProspectsResult {
  site_id: number;
  our_domain: string;
  competitors_checked: string[];
  prospects: string[];
  count: number;
}

// ── find_link_prospects ───────────────────────────────────────────────
//
// Strategy: DataForSEO /backlinks/domain_intersection/live
// Returns referring domains that link to any competitor but NOT to us.
// We then enrich each prospect with which competitors it links to
// and a domain_rank signal for prioritisation.

export async function findLinkProspects(
  siteId: number,
  domain: string,
  competitorDomains: string[],
): Promise<FindLinkProspectsResult> {
  const ourDomain = getDomain(domain);
  competitorDomains = competitorDomains
    .map(getDomain)
    .filter((d) => d && d !== ourDomain);

  if (competitorDomains.length === 0) {
    console.log(
      `[backlink-engine] No competitors configured for site_id=${siteId}`,
    );
    return {
      site_id: siteId,
      our_domain: ourDomain,
      competitors_checked: [],
      prospects: [],
      count: 0,
    };
  }

  console.log(
    `[backlink-engine:prospects] site_id=${siteId} our=${ourDomain} competitors=${competitorDomains.join(", ")}`,
  );

  const targetDomains = competitorDomains.reduce((acc: any, cur, idx) => {
    acc[idx + 1] = cur;
    return acc;
  }, {});

  // Build targets: all competitor domains.
  // exclude_targets: our domain — DataForSEO filters out referring domains
  // that already link to us.
  const data = await dfsPost("/backlinks/domain_intersection/live", [
    {
      targets: targetDomains,
      exclude_targets: [ourDomain],
      backlinks_filters: [["domain_from_rank", ">", 0]],
      limit: 10,
    },
  ]);

  const rawItems: any[] = data?.tasks?.[0]?.result?.[0]?.items ?? [];

  // Group items by referring domain to count how many competitors each links to
  const domainMap = new Map<
    string,
    { rank: number; competitors: Set<string> }
  >();

  const prospects: string[] = rawItems.map((item) => {
    const intersections = item.domain_intersection
      ? (Object.values(item.domain_intersection) as Record<string, any>[])
      : [];
    return getDomain(intersections[0].target);
  });

  //   for (const item of rawItems) {
  //     const refDomain: string = getDomain(
  //       item.domain_from ?? item.referring_domain ?? "",
  //     );
  //     if (!refDomain) continue;
  //     const target: string = getDomain(item.target ?? "");

  //     if (!domainMap.has(refDomain)) {
  //       domainMap.set(refDomain, {
  //         rank: item.domain_from_rank ?? 0,
  //         competitors: new Set(),
  //       });
  //     }
  //     if (target) domainMap.get(refDomain)!.competitors.add(target);
  //   }

  // Sort by (competitors linked count DESC, domain_rank DESC)
  //   const prospects: LinkProspect[] = Array.from(domainMap.entries())
  //     .map(([domain, meta]) => ({
  //       referring_domain: domain,
  //       domain_rank: meta.rank,
  //       backlinks_to_competitors: meta.competitors.size,
  //       linked_competitors: Array.from(meta.competitors),
  //       contact_hint: `https://${domain}`,
  //     }))
  //     .sort(
  //       (a, b) =>
  //         b.backlinks_to_competitors - a.backlinks_to_competitors ||
  //         b.domain_rank - a.domain_rank,
  //     )
  //     .slice(0, 30);

  return {
    site_id: siteId,
    our_domain: ourDomain,
    competitors_checked: competitorDomains,
    prospects,
    count: prospects.length,
  };
}
