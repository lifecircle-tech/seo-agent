import { getDomain } from "../../../libs/functions.js";
import {
  getCompetitorBacklinksDomain,
  getSpamScoreOfDomains,
} from "../../services/dataForSEO.service.js";
import { logger } from "../../utils/logger.js";

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
  prospects: { domain_from: string; url_from: string; spam_score: number }[];
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
    logger.info(
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

  logger.info(
    `[backlink-engine:prospects] site_id=${siteId} our=${ourDomain} competitors=${competitorDomains.join(", ")}`,
  );

  let rawItems = [] as any[];
  const result = await getCompetitorBacklinksDomain(
    ourDomain,
    competitorDomains,
  );
  
  if (result) {
    rawItems = result;
  }

  logger.debug(`[prospects] Backlinks Count ${rawItems.length}`);
  // Group items by referring domain to count how many competitors each links to
  const domainMap = new Map<
    string,
    { rank: number; competitors: Set<string> }
  >();

  const prospects = new Map();
  const referring_domain: string[] = [];

  rawItems.forEach((item) => {
    const intersections = item.domain_intersection
      ? (Object.values(item.domain_intersection) as Record<string, any>[])
      : [];

    if (!prospects.has(getDomain(intersections[0].target))) {
      prospects.set(getDomain(intersections[0].target), {
        domain_from: getDomain(intersections[0].target),
        url_from: getDomain(intersections[0].target),
      });

      referring_domain.push(intersections[0].target);
    }
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

  const spam_scores = await getSpamScoreOfDomains(referring_domain);
  const temp_prospect = Array.from(prospects.keys()).map((key) => {
    const score = spam_scores.find((ss: any) => ss.target == key);

    return {
      ...prospects.get(key),
      spam_score: score.spam_score,
    };
  });

  return {
    site_id: siteId,
    our_domain: ourDomain,
    competitors_checked: competitorDomains,
    prospects: temp_prospect,
    count: prospects.size,
  };
}
