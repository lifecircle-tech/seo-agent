# API Reference

## MCP Servers

All MCP servers expose tools via SSE transport on port 3000.

## Common Parameters

- `site_id` (required): Integer identifying the target site (e.g., `1` for https://lifecircle.in)

## Servers

### keyword-tracker

Tracks keyword rankings via Google Search Console API.
Credentials: env var `GSC_OAUTH_SITE_{site_id}` (service account JSON).

---

#### `get_rankings`

Returns current ranking data for a list of keywords over the last 28 days.

**Parameters**

| Name       | Type       | Required | Description                              |
|------------|------------|----------|------------------------------------------|
| `site_id`  | `number`   | yes      | Site ID from config (e.g. `1`)           |
| `keywords` | `string[]` | yes      | Array of keywords to look up             |

**Returns**

```json
{
  "site_id": 1,
  "site_url": "https://lifecircle.in",
  "rankings": [
    {
      "keyword": "seo tools",
      "position": 4.2,
      "clicks": 312,
      "impressions": 5400,
      "ctr": 0.0578
    },
    {
      "keyword": "rank tracker",
      "position": null,
      "clicks": 0,
      "impressions": 0,
      "ctr": 0
    }
  ]
}
```

> `position` is `null` when GSC has no data for the keyword in the date range.

---

#### `get_ranking_history`

Returns daily position trend for a single keyword over N days.

**Parameters**

| Name      | Type     | Required | Description                                  |
|-----------|----------|----------|----------------------------------------------|
| `site_id` | `number` | yes      | Site ID from config                          |
| `keyword` | `string` | yes      | Keyword to retrieve history for              |
| `days`    | `number` | yes      | Number of days of history (1–365)            |

**Returns**

```json
{
  "site_id": 1,
  "site_url": "https://lifecircle.in",
  "keyword": "seo tools",
  "days": 7,
  "history": [
    { "date": "2026-03-18", "position": 6.1, "clicks": 40, "impressions": 820 },
    { "date": "2026-03-19", "position": 5.8, "clicks": 45, "impressions": 870 }
  ]
}
```

> Results are sorted ascending by date. Days with no data are omitted.

---

#### `get_top_movers`

Returns keywords that moved significantly in position, comparing the last 7 days
against the prior 7-day period.

**Parameters**

| Name        | Type     | Required | Description                                                    |
|-------------|----------|----------|----------------------------------------------------------------|
| `site_id`   | `number` | yes      | Site ID from config                                            |
| `threshold` | `number` | yes      | Minimum position change to include (e.g. `3` = moved 3+ spots)|
| `direction` | `string` | yes      | `"up"` (improved), `"down"` (declined), or `"both"`           |

**Returns**

```json
{
  "site_id": 1,
  "site_url": "https://lifecircle.in",
  "threshold": 3,
  "direction": "both",
  "movers": [
    {
      "keyword": "seo tools",
      "previous_position": 8.7,
      "current_position": 4.2,
      "change": 4.5,
      "direction": "up"
    }
  ]
}
```

> `change` is positive for improvements (lower position number = better rank).
> Results are sorted by `|change|` descending.

---

#### `get_rank_velocity`

Calculates the rate of position change (velocity) for a keyword over a rolling
time window using linear regression.

**Parameters**

| Name          | Type     | Required | Description                                         |
|---------------|----------|----------|-----------------------------------------------------|
| `site_id`     | `number` | yes      | Site ID from config                                 |
| `keyword`     | `string` | yes      | Keyword to analyse                                  |
| `window_days` | `number` | yes      | Rolling window in days for velocity calculation (2–90) |

**Returns**

```json
{
  "site_id": 1,
  "site_url": "https://lifecircle.in",
  "keyword": "seo tools",
  "window_days": 14,
  "velocity": -0.3,
  "trend": "improving",
  "data_points": 14,
  "interpretation": "Position changing by 0.3 places/day (improving)"
}
```

**Trend values**

| Value                | Meaning                                  |
|----------------------|------------------------------------------|
| `"improving"`        | Position number decreasing (moving up)   |
| `"declining"`        | Position number increasing (moving down) |
| `"stable"`           | Change < 0.1 positions/day               |
| `"insufficient_data"`| Fewer than 2 data points available       |

> A negative `velocity` means rank is improving (position number getting smaller).
> Returns `velocity: null` when there are insufficient data points.

---

### cms-connector

Connects to WordPress via REST API and Google Search Console.
Credentials:
- `CMS_API_URL_SITE_{site_id}` — WordPress site base URL (e.g. `https://lifecircle.in`)
- `CMS_API_KEY_SITE_{site_id}` — WordPress application password in `username:app_password` format
- `GSC_OAUTH_SITE_{site_id}` — GSC service account JSON (same as keyword-tracker)

---

#### `get_page`

Fetch a WordPress page's title, Rank Math meta description, and last modified date.

**Parameters**

| Name      | Type     | Required | Description            |
|-----------|----------|----------|------------------------|
| `site_id` | `number` | yes      | Site ID from config    |
| `url`     | `string` | yes      | Full URL of the page   |

**Returns**

```json
{
  "id": 42,
  "url": "https://lifecircle.in/home-care/",
  "title": "Home Care Services",
  "meta_description": "Trusted home care services in your area.",
  "last_modified": "2026-03-01T10:00:00"
}
```

> `meta_description` is read from Rank Math (`rank_math_meta.description`) when available, then `meta.meta_description`, then `null`.
> Searches WordPress `pages` first, then `posts` if not found.

---

#### `list_pages`

Return a paginated list of published WordPress pages enriched with GSC impressions, clicks, CTR, and average position.

**Parameters**

| Name      | Type     | Required | Description                                    |
|-----------|----------|----------|------------------------------------------------|
| `site_id` | `number` | yes      | Site ID from config                            |
| `limit`   | `number` | no       | Max pages to return (1–100, default `20`)      |
| `offset`  | `number` | no       | Pagination offset (default `0`)                |

**Returns**

```json
{
  "site_id": 1,
  "total": 2,
  "offset": 0,
  "pages": [
    {
      "id": 1,
      "url": "https://lifecircle.in/",
      "title": "Home",
      "modified": "2026-03-01T00:00:00",
      "impressions": 5000,
      "clicks": 200,
      "ctr": 0.04,
      "position": 3.2
    }
  ]
}
```

> GSC metrics are fetched in a single query (last 28 days, `page` dimension) and matched by URL.
> Pages with no GSC data have `impressions: 0`, `clicks: 0`, `ctr: 0`, `position: null`.

---

#### `get_page_metrics`

Return GSC impressions, clicks, CTR, and average position for a specific page URL over the last 28 days.

**Parameters**

| Name      | Type     | Required | Description            |
|-----------|----------|----------|------------------------|
| `site_id` | `number` | yes      | Site ID from config    |
| `url`     | `string` | yes      | Full URL of the page   |

**Returns**

```json
{
  "site_id": 1,
  "url": "https://lifecircle.in/home-care/",
  "impressions": 1200,
  "clicks": 45,
  "ctr": 0.0375,
  "position": 5.2,
  "date_range": { "startDate": "2026-03-02", "endDate": "2026-03-30" }
}
```

---

#### `update_page_meta`

Update a WordPress page's title and Rank Math meta description via the REST API.

> **PUBLISH GUARD** — This tool never sets `post_status` to `"publish"`. The guard is enforced at both the MCP handler level and inside the function. Any attempt to inject `status: "publish"` will throw an error.

**Parameters**

| Name          | Type     | Required | Description                    |
|---------------|----------|----------|--------------------------------|
| `site_id`     | `number` | yes      | Site ID from config            |
| `url`         | `string` | yes      | Full URL of the page to update |
| `title`       | `string` | yes      | New page title                 |
| `description` | `string` | yes      | New meta description           |

**Returns**

```json
{
  "ok": true,
  "id": 42,
  "url": "https://lifecircle.in/home-care/",
  "title": "Updated Home Care Services"
}
```

> Rank Math meta keys written: `rank_math_description` (description) and `rank_math_title` (SEO title override, via the WordPress plugin endpoint).
> The native WP post title is also updated so they stay in sync.

---

#### `get_impressions_vs_ctr`

Return pages where impressions > 100 but CTR < 3%, sorted by impressions descending. These are content improvement opportunities — pages Google is already showing but users aren't clicking.

**Parameters**

| Name      | Type     | Required | Description                           |
|-----------|----------|----------|---------------------------------------|
| `site_id` | `number` | yes      | Site ID from config                   |
| `days`    | `number` | yes      | Lookback window in days (1–90)        |

**Returns**

```json
{
  "site_id": 1,
  "days": 28,
  "threshold": { "min_impressions": 100, "max_ctr": 0.03 },
  "opportunities": [
    {
      "url": "https://lifecircle.in/home-care/",
      "impressions": 2000,
      "clicks": 20,
      "ctr": 0.01,
      "position": 6.0
    }
  ]
}
```

> Results sorted by `impressions` descending (highest missed-click potential first).

---

### schema-manager

Extracts and improves JSON-LD schema markup on WordPress pages. Fetches PAA questions from SerpAPI.
Credentials: `CMS_API_URL_SITE_{site_id}`, `CMS_API_KEY_SITE_{site_id}` (WordPress REST API), `SERPAPI_KEY`.

---

#### `get_current_schema`

Fetches a page by URL and extracts all `<script type="application/ld+json">` blocks.

**Parameters**

| Name      | Type     | Required | Description             |
|-----------|----------|----------|-------------------------|
| `site_id` | `number` | yes      | Site ID                 |
| `url`     | `string` | yes      | Full URL of the page    |

**Returns**

```json
{
  "site_id": 1,
  "url": "https://lifecircle.in/home-care/",
  "schema_count": 2,
  "schemas": [
    { "@context": "https://schema.org", "@type": "LocalBusiness", "name": "LifeCircle" },
    { "@context": "https://schema.org", "@type": "WebSite", "url": "https://lifecircle.in" }
  ]
}
```

---

#### `get_paa_questions`

Calls SerpAPI to retrieve People Also Ask (PAA) questions for a keyword.

**Parameters**

| Name      | Type     | Required | Description                          |
|-----------|----------|----------|--------------------------------------|
| `site_id` | `number` | yes      | Site ID                              |
| `keyword` | `string` | yes      | Keyword to look up PAA questions for |

**Returns**

```json
{
  "site_id": 1,
  "keyword": "home care services",
  "questions_count": 3,
  "questions": [
    { "question": "What is home care?", "snippet": "Home care is..." },
    { "question": "How much does home care cost?", "snippet": "It varies." }
  ]
}
```

---

#### `suggest_schema_improvements`

Detects page type (home/service/faq/blog/contact/default) from URL and compares existing schema types against best-practice recommendations.

**Parameters**

| Name      | Type     | Required | Description           |
|-----------|----------|----------|-----------------------|
| `site_id` | `number` | yes      | Site ID               |
| `url`     | `string` | yes      | Full URL of the page  |

**Returns**

```json
{
  "site_id": 1,
  "url": "https://lifecircle.in/home-care/",
  "page_type": "service",
  "existing_types": ["LocalBusiness"],
  "recommended_types": ["Service", "LocalBusiness"],
  "missing_types": ["Service"],
  "extra_types": [],
  "has_gaps": true,
  "suggestions": [
    { "action": "add", "schema_type": "Service", "reason": "Service schema is recommended for service pages but is missing" }
  ]
}
```

---

#### `push_schema_to_page`

Writes a JSON-LD schema object to a WordPress page via the REST API. Stores it in the `_seo_agent_schema` post meta field. **Never publishes** — only updates meta.

**Parameters**

| Name          | Type     | Required | Description                          |
|---------------|----------|----------|--------------------------------------|
| `site_id`     | `number` | yes      | Site ID                              |
| `url`         | `string` | yes      | Full URL of the target page          |
| `schema_json` | `object` | yes      | Schema.org JSON-LD object to store   |

**Returns**

```json
{
  "ok": true,
  "id": 42,
  "url": "https://lifecircle.in/home-care/",
  "schema_stored": true
}
```

---

### competitor-intel

Analyses competitor keyword and backlink profiles via DataforSEO API. Compares against the site's own GSC keywords to identify gaps. Results are cached for 24 hours per domain in `/tmp/cache/`.
Credentials: `DATAFORSEO_USERNAME`, `DATAFORSEO_PASSWORD`, `GSC_OAUTH_SITE_{site_id}`.

---

#### `get_competitor_keywords`

Fetches the top 50 organic keywords a competitor domain ranks for via DataForSEO API.

**Parameters**

| Name                | Type     | Required | Description                           |
|---------------------|----------|----------|---------------------------------------|
| `site_id`           | `number` | yes      | Site ID                               |
| `competitor_domain` | `string` | yes      | Competitor domain (e.g. `example.com`) |

**Returns**

```json
{
  "site_id": 1,
  "competitor_domain": "competitor.com",
  "keywords_count": 50,
  "keywords": [
    { "keyword": "elder care services", "position": 3, "volume": 5000, "traffic": 200 }
  ],
  "cached": false
}
```

---

#### `get_keyword_gaps`

Compares the site's GSC keywords (last 28 days) against a competitor's keywords. Returns keywords the competitor ranks for that the site does not.

**Parameters**

| Name                | Type     | Required | Description             |
|---------------------|----------|----------|-------------------------|
| `site_id`           | `number` | yes      | Site ID                 |
| `competitor_domain` | `string` | yes      | Competitor domain       |

**Returns**

```json
{
  "site_id": 1,
  "competitor_domain": "competitor.com",
  "site_keywords_count": 120,
  "competitor_keywords_count": 50,
  "gap_count": 37,
  "gaps": [
    { "keyword": "home health aide", "competitor_position": 8, "competitor_volume": 2000 }
  ]
}
```

> Gaps are sorted by `competitor_volume` descending (highest opportunity first).

---

#### `get_competitor_backlinks`

Fetches the top 50 backlinks pointing to a competitor domain via DataForSEO API.

**Parameters**

| Name                | Type     | Required | Description             |
|---------------------|----------|----------|-------------------------|
| `site_id`           | `number` | yes      | Site ID                 |
| `competitor_domain` | `string` | yes      | Competitor domain       |

**Returns**

```json
{
  "site_id": 1,
  "competitor_domain": "competitor.com",
  "backlinks_count": 50,
  "backlinks": [
    { "url_from": "https://health.com/article", "url_to": "https://competitor.com/", "domain_rating": 72, "anchor": "elder care" }
  ],
  "cached": true
}
```

---

#### `get_content_gaps`

Clusters keyword gaps into topic groups to identify content areas the competitor covers that the site does not.

**Parameters**

| Name                | Type     | Required | Description             |
|---------------------|----------|----------|-------------------------|
| `site_id`           | `number` | yes      | Site ID                 |
| `competitor_domain` | `string` | yes      | Competitor domain       |

**Returns**

```json
{
  "site_id": 1,
  "competitor_domain": "competitor.com",
  "topic_groups_count": 5,
  "topic_groups": [
    { "topic": "elder", "keywords": ["elder care services", "elder home care"], "keyword_count": 2, "avg_volume": 3500 }
  ]
}
```

> Groups are sorted by `avg_volume` descending.

---

### ads-bridge

Audits Google Ads performance — spend efficiency, quality scores, and top converters.
Credentials:
- `GBP_OAUTH_SITE_{site_id}` — Google OAuth2 JSON (access/refresh tokens)
- `GBP_CLIENT_ID` — Google OAuth2 client ID
- `GBP_CLIENT_SECRET` — Google OAuth2 client secret
- `GOOGLE_ADS_TOKEN` — Google Ads developer token
- `ADS_ACCOUNT_SITE_{site_id}` — Google Ads customer ID (hyphens removed)
- `GOOGLE_ADS_MANAGER_CUSTOMER_ID` (optional) — manager account ID for multi-account access

Data window: last 30 days.

---

#### `getTopConvertingKeywords`

Retrieves the top 20 keywords by conversions from Google Ads.

**Parameters**

| Name     | Type     | Required | Description         |
|----------|----------|----------|---------------------|
| `siteId` | `number` | yes      | Site ID from config |

**Returns**

```json
{
  "site_id": 1,
  "keywords": [
    {
      "keyword": "home care services",
      "conversions": 18,
      "cost_inr": 4200,
      "cpa_inr": 233.3,
      "clicks": 95,
      "impressions": 1800,
      "ctr_pct": 5.3
    }
  ],
  "total_conversions": 18,
  "total_cost_inr": 4200
}
```

---

#### `getWastedSpend`

Identifies keywords that incurred cost but generated zero conversions over the last 30 days.

**Parameters**

| Name     | Type     | Required | Description         |
|----------|----------|----------|---------------------|
| `siteId` | `number` | yes      | Site ID from config |

**Returns**

```json
{
  "site_id": 1,
  "keywords": [
    {
      "keyword": "generic term",
      "cost_inr": 850,
      "clicks": 40,
      "impressions": 600,
      "ctr_pct": 6.7
    }
  ],
  "total_wasted_inr": 850,
  "keyword_count": 1
}
```

---

#### `getQualityScoreIssues`

Finds keywords with a quality score below 6.

**Parameters**

| Name     | Type     | Required | Description         |
|----------|----------|----------|---------------------|
| `siteId` | `number` | yes      | Site ID from config |

**Returns**

```json
{
  "site_id": 1,
  "issues": [
    {
      "keyword": "elder care",
      "quality_score": 4,
      "creative_quality": "BELOW_AVERAGE",
      "landing_page_quality": "AVERAGE",
      "expected_ctr": "BELOW_AVERAGE",
      "impressions": 320
    }
  ],
  "avg_quality_score": 4.0,
  "critical_count": 1,
  "poor_count": 0
}
```

> `critical_count` = quality score ≤ 3; `poor_count` = quality score 4–5.

---

### backlink-engine

Finds referring domains that link to competitors but not to the site (link prospects).
Credentials: `DATAFORSEO_USERNAME`, `DATAFORSEO_PASSWORD`, `DATAFORSEO_BASEURL` (optional, default `https://api.dataforseo.com/v3`).

---

#### `findLinkProspects`

Queries DataForSEO for referring domains across a list of competitor domains and returns domains that link to competitors but not to the target site.

**Parameters**

| Name                | Type       | Required | Description                                   |
|---------------------|------------|----------|-----------------------------------------------|
| `siteId`            | `number`   | yes      | Site ID from config                           |
| `domain`            | `string`   | yes      | The site's own domain (e.g. `lifecircle.in`)  |
| `competitorDomains` | `string[]` | yes      | List of competitor domains to analyse         |

**Returns**

```json
{
  "site_id": 1,
  "our_domain": "lifecircle.in",
  "competitors_checked": 3,
  "prospects": [
    "healthblog.com",
    "seniorcare.org"
  ],
  "count": 2
}
```

> Returns up to 10 prospects. Domains with `domain_from_rank = 0` are excluded.

---

### backlink-monitor

Tracks new, lost, and toxic backlinks and measures referring-domain velocity.
Credentials: `DATAFORSEO_USERNAME`, `DATAFORSEO_PASSWORD`, `DATAFORSEO_BASEURL` (optional).
Requires database access to `sites_config` table for domain lookup.

---

#### `getNewBacklinks`

Gets backlinks acquired in the last N days.

**Parameters**

| Name     | Type     | Required | Description                          |
|----------|----------|----------|--------------------------------------|
| `siteId` | `number` | yes      | Site ID from config                  |
| `days`   | `number` | no       | Lookback window in days (default `7`)|

**Returns**

```json
{
  "site_id": 1,
  "domain": "lifecircle.in",
  "days": 7,
  "backlinks": [
    {
      "url_from": "https://healthblog.com/post",
      "domain_from": "healthblog.com",
      "url_to": "https://lifecircle.in/home-care/",
      "anchor": "home care",
      "domain_rank": 45,
      "first_seen": "2026-07-08",
      "last_seen": "2026-07-12",
      "is_dofollow": true,
      "spam_score": 5
    }
  ],
  "count": 1
}
```

---

#### `getLostBacklinks`

Gets backlinks lost in the last N days.

**Parameters**

| Name     | Type     | Required | Description                          |
|----------|----------|----------|--------------------------------------|
| `siteId` | `number` | yes      | Site ID from config                  |
| `days`   | `number` | no       | Lookback window in days (default `7`)|

**Returns**

Same shape as `getNewBacklinks`.

---

#### `getToxicLinks`

Identifies backlinks with a spam score above 60.

**Parameters**

| Name     | Type     | Required | Description         |
|----------|----------|----------|---------------------|
| `siteId` | `number` | yes      | Site ID from config |

**Returns**

```json
{
  "site_id": 1,
  "domain": "lifecircle.in",
  "toxic_links": [
    {
      "url_from": "https://spamsite.xyz/page",
      "domain_from": "spamsite.xyz",
      "url_to": "https://lifecircle.in/",
      "anchor": "click here",
      "domain_rank": 2,
      "spam_score": 85,
      "is_dofollow": true
    }
  ],
  "count": 1,
  "spam_threshold": 60
}
```

---

#### `getLinkVelocity`

Tracks weekly new/lost referring domain counts and calculates a trend direction.

**Parameters**

| Name     | Type     | Required | Description                           |
|----------|----------|----------|---------------------------------------|
| `siteId` | `number` | yes      | Site ID from config                   |
| `days`   | `number` | no       | Lookback window in days (default `7`) |

**Returns**

```json
{
  "site_id": 1,
  "domain": "lifecircle.in",
  "weekly_velocity": [
    { "date": "2026-07-07", "new_referring_domains": 5, "lost_referring_domains": 2, "net_change": 3 }
  ],
  "avg_weekly_gain": 5.0,
  "avg_weekly_loss": 2.0,
  "trend": "growing"
}
```

**Trend values:** `"growing"` | `"declining"` | `"stable"`

---

### citation-auditor

Pulls citation data from BrightLocal, scores NAP consistency, and ranks fix priorities.
Credentials: `BRIGHTLOCAL_KEY`, `BRIGHTLOCAL_REPORT_ID_SITE_{site_id}`.
Caching: 24 hours per site in `/tmp/cache/brightlocal_site{site_id}_{type}.json`.

---

#### `auditCitations`

Pulls citation data from a BrightLocal report for the site.

**Parameters**

| Name     | Type     | Required | Description         |
|----------|----------|----------|---------------------|
| `siteId` | `number` | yes      | Site ID from config |

**Returns**

```json
{
  "site_id": 1,
  "report_id": "abc123",
  "citations_found": 48,
  "citations_total_checked": 60,
  "nap_inconsistencies": [
    {
      "directory": "Yelp",
      "listing_url": "https://yelp.com/biz/lifecircle",
      "field": "phone",
      "expected": "+91-9876543210",
      "found": "9876543210"
    }
  ],
  "missing_directories": [
    { "name": "Justdial", "domain_authority": 68, "priority": "high" }
  ],
  "incorrect_listings": [
    {
      "directory": "IndiaMART",
      "listing_url": "https://indiamart.com/lifecircle",
      "issue": "Wrong address",
      "severity": "critical"
    }
  ],
  "cached": false
}
```

---

#### `getCitationScore`

Calculates a weighted citation health score (0–100) with a letter grade.

**Parameters**

| Name     | Type     | Required | Description         |
|----------|----------|----------|---------------------|
| `siteId` | `number` | yes      | Site ID from config |

**Returns**

```json
{
  "site_id": 1,
  "score": 74,
  "grade": "C",
  "citations_found": 48,
  "nap_accuracy_pct": 79.2,
  "coverage_pct": 80.0,
  "breakdown": {
    "nap_consistency": 65,
    "directory_coverage": 80,
    "listing_accuracy": 75
  }
}
```

**Grade thresholds:** A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 45, F < 45.

---

#### `getPriorityFixes`

Ranks the top 10 citation issues by impact score.

**Parameters**

| Name     | Type     | Required | Description         |
|----------|----------|----------|---------------------|
| `siteId` | `number` | yes      | Site ID from config |

**Returns**

```json
{
  "site_id": 1,
  "total_fixes": 10,
  "fixes": [
    {
      "rank": 1,
      "directory": "Yelp",
      "issue_type": "nap_inconsistency",
      "description": "Phone number mismatch",
      "impact": "high",
      "listing_url": "https://yelp.com/biz/lifecircle"
    }
  ]
}
```

**`issue_type` values:** `"nap_inconsistency"` | `"missing_listing"` | `"incorrect_info"`
**`impact` values:** `"high"` | `"medium"` | `"low"`

---

### link-optimiser

Scans pages for internal linking opportunities, detects orphan pages, and generates a hub-and-spoke structure using Claude.
Credentials: `ANTHROPIC_API_KEY`.
Requires database access to `keywords_config` table and WordPress REST API.
Model: `claude-sonnet-4-6` with 3-attempt exponential backoff (2 s, 5 s, 10 s).

---

#### `findInternalLinkOpportunities`

Scans a list of WordPress pages for unlinked keyword mentions that could be turned into internal links.

**Parameters**

| Name     | Type        | Required | Description                        |
|----------|-------------|----------|------------------------------------|
| `siteId` | `number`    | yes      | Site ID from config                |
| `pages`  | `WpPage[]`  | yes      | Array of WordPress page objects    |

**Returns**

```json
{
  "site_id": 1,
  "pages_scanned": 25,
  "opportunities_count": 8,
  "opportunities": [
    {
      "source_url": "https://lifecircle.in/about/",
      "source_title": "About Us",
      "mention_text": "home care",
      "suggested_target_url": "https://lifecircle.in/home-care/",
      "suggested_target_title": "Home Care Services",
      "context_snippet": "...we provide home care and elder care..."
    }
  ]
}
```

---

#### `getOrphanPages`

Identifies pages that have zero inbound internal links from other site pages.

**Parameters**

| Name     | Type       | Required | Description                     |
|----------|------------|----------|---------------------------------|
| `siteId` | `number`   | yes      | Site ID from config             |
| `pages`  | `WpPage[]` | yes      | Array of WordPress page objects |

**Returns**

```json
{
  "site_id": 1,
  "total_pages": 40,
  "orphan_count": 5,
  "orphans": [
    {
      "url": "https://lifecircle.in/bangalore/elderly-care/",
      "title": "Elderly Care in Bangalore",
      "slug": "bangalore/elderly-care",
      "inbound_link_count": 0
    }
  ]
}
```

---

#### `suggestLinkStructure`

Generates an AI-powered hub-and-spoke internal linking plan for the site.

**Parameters**

| Name     | Type     | Required | Description         |
|----------|----------|----------|---------------------|
| `siteId` | `number` | yes      | Site ID from config |

**Returns**

```json
{
  "site_id": 1,
  "hub_pages": [
    {
      "url": "https://lifecircle.in/home-care/",
      "title": "Home Care Services",
      "type": "service",
      "spoke_pages": [
        "https://lifecircle.in/bangalore/home-care/",
        "https://lifecircle.in/mumbai/home-care/"
      ]
    }
  ],
  "priority_actions": [
    {
      "action": "add_link",
      "from_url": "https://lifecircle.in/about/",
      "to_url": "https://lifecircle.in/home-care/",
      "anchor_text": "home care services",
      "rationale": "About page mentions home care but does not link to the service hub"
    }
  ],
  "summary": "Site has 3 service hubs with 12 city spoke pages. 5 orphan pages identified."
}
```

**Hub `type` values:** `"service"` | `"city"` | `"blog"` | `"other"`

---

### page-generator

AI-generates SEO-optimised local service landing pages and creates WordPress drafts.
Credentials: `ANTHROPIC_API_KEY`.
Requires database access to `cities_config` table and WordPress REST API.
Model: `claude-sonnet-4-6`.
**All pages are created as drafts and never auto-published.**

---

#### `generateCityPage`

Generates an SEO-optimised local service landing page for a city + service combination.

**Parameters**

| Name       | Type       | Required | Description                              |
|------------|------------|----------|------------------------------------------|
| `siteId`   | `number`   | yes      | Site ID from config                      |
| `city`     | `string`   | yes      | Target city name (e.g. `"Bangalore"`)    |
| `service`  | `string`   | yes      | Service name (e.g. `"home care"`)        |
| `keywords` | `string[]` | yes      | Target keywords to optimise for          |

**Returns**

```json
{
  "site_id": 1,
  "city": "Bangalore",
  "service": "home care",
  "slug": "bangalore/home-care",
  "title": "Home Care Services in Bangalore",
  "meta_description": "Trusted home care services in Bangalore. 24/7 support.",
  "html_content": "<h1>...</h1><h2>...</h2>...",
  "faq_schema": {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": []
  }
}
```

> HTML content uses only safe tags: `h1`, `h2`, `h3`, `p`, `ul`, `li`.

---

#### `createCmsDraft`

Creates a WordPress draft page from a generated page object.

**Parameters**

| Name          | Type            | Required | Description                                          |
|---------------|-----------------|----------|------------------------------------------------------|
| `siteId`      | `number`        | yes      | Site ID from config                                  |
| `pageContent` | `GeneratedPage` | yes      | Output from `generateCityPage` (with optional keyword fields) |

**Returns**

```json
{
  "site_id": 1,
  "wp_page_id": 156,
  "status": "draft",
  "title": "Home Care Services in Bangalore",
  "link": "https://lifecircle.in/?page_id=156"
}
```

---

#### `getMissingCityPages`

Identifies city + service combinations that do not yet have a published WordPress page.

**Parameters**

| Name     | Type     | Required | Description         |
|----------|----------|----------|---------------------|
| `siteId` | `number` | yes      | Site ID from config |

**Returns**

```json
{
  "site_id": 1,
  "total_cities": 10,
  "missing_count": 6,
  "missing": [
    {
      "city": "Pune",
      "state": "Maharashtra",
      "country": "India",
      "missingServices": ["home care", "elder care"],
      "normalized_slug": "pune"
    }
  ]
}
```

---

### page-sitemap

Checks sitemap submission status across Google and Bing, detects newly published pages, and pings them for indexing.
Credentials:
- `GSC_OAUTH_SITE_{site_id}` — Google OAuth2 JSON
- `BING_WEBMASTER_KEY` — Bing Webmaster Tools API key
- `GOOGLE_API_KEY` (optional)

Requires database access to `sites_config` and WordPress REST API.
Ping cache: 7-day deduplication in `/tmp/cache/pinged_site{site_id}.json`.

---

#### `getSitemapStatus`

Checks GSC and Bing for submitted sitemaps and reports indexing coverage.

**Parameters**

| Name     | Type     | Required | Description         |
|----------|----------|----------|---------------------|
| `siteId` | `number` | yes      | Site ID from config |

**Returns**

```json
{
  "site_id": 1,
  "site_url": "https://lifecircle.in",
  "gsc_sitemaps": [
    {
      "sitemap_url": "https://lifecircle.in/sitemap.xml",
      "submitted": true,
      "indexed": 85,
      "warnings": 0,
      "errors": 0,
      "last_submitted": "2026-07-01"
    }
  ],
  "bing_sitemaps": [
    {
      "sitemap_url": "https://lifecircle.in/sitemap.xml",
      "is_submitted": true,
      "last_crawled": "2026-07-10",
      "pages_crawled": 82
    }
  ],
  "total_submitted": 90,
  "total_indexed": 85,
  "coverage_pct": 94.4,
  "issues": []
}
```

---

#### `detectNewPages`

Finds WordPress pages published in the last 24 hours that have not yet been pinged.

**Parameters**

| Name     | Type     | Required | Description         |
|----------|----------|----------|---------------------|
| `siteId` | `number` | yes      | Site ID from config |

**Returns**

```json
{
  "site_id": 1,
  "new_pages": [
    {
      "url": "https://lifecircle.in/bangalore/home-care/",
      "title": "Home Care in Bangalore",
      "published_at": "2026-07-13T08:30:00"
    }
  ],
  "count": 1,
  "already_pinged": 0
}
```

---

#### `pingNewPages`

Submits a list of URLs to the Google Indexing API and Bing URL Submission API.

**Parameters**

| Name     | Type       | Required | Description                   |
|----------|------------|----------|-------------------------------|
| `siteId` | `number`   | yes      | Site ID from config           |
| `urls`   | `string[]` | yes      | Array of fully-qualified URLs |

**Returns**

```json
{
  "site_id": 1,
  "pinged": [
    {
      "url": "https://lifecircle.in/bangalore/home-care/",
      "gsc_status": "ok",
      "bing_status": "ok"
    }
  ],
  "success_count": 1,
  "error_count": 0
}
```

---

### serp-features

Checks SERP feature presence (featured snippets, local packs, PAA) for site keywords via SerpAPI.
Credentials: `SERPAPI_KEY`.
Requires database access to `keywords_config` table.
Default location: India (`gl=in`, `hl=en`). Rate limiting: 1.1 s between calls.

---

#### `checkSerpFeatures`

Analyses which SERP features are active for a keyword and whether the site owns any of them.

**Parameters**

| Name      | Type     | Required | Description                |
|-----------|----------|----------|----------------------------|
| `siteId`  | `number` | yes      | Site ID from config        |
| `keyword` | `string` | yes      | Keyword to analyse         |

**Returns**

```json
{
  "site_id": 1,
  "keyword": "home care services bangalore",
  "has_featured_snippet": true,
  "featured_snippet_owner": "competitor.com",
  "we_own_featured_snippet": false,
  "has_local_pack": true,
  "we_are_in_local_pack": true,
  "has_paa": true,
  "paa_questions": [
    "What is home care?",
    "How much does home care cost in Bangalore?"
  ],
  "has_knowledge_panel": false,
  "has_image_pack": false,
  "our_organic_position": 4
}
```

---

#### `getFeatureOpportunities`

Scans the top 10 target keywords for quick-win SERP feature opportunities.

**Parameters**

| Name     | Type     | Required | Description         |
|----------|----------|----------|---------------------|
| `siteId` | `number` | yes      | Site ID from config |

**Returns**

```json
{
  "site_id": 1,
  "keywords_checked": 10,
  "opportunities_count": 3,
  "opportunities": [
    {
      "keyword": "home care services bangalore",
      "opportunity_type": "featured_snippet",
      "competitor_owner": "competitor.com",
      "our_position": 4,
      "description": "We rank #4 — optimising for snippet format could capture position 0"
    }
  ]
}
```

**`opportunity_type` values:** `"featured_snippet"` | `"local_pack"` | `"paa"`

---

### technical-seo

Runs PageSpeed audits, checks GSC crawl errors, and reports index coverage and Core Web Vitals.
Credentials: `GOOGLE_API_KEY` (PageSpeed Insights), `GSC_OAUTH_SITE_{site_id}`.
Requires database access to `sites_config` table.

**Alert thresholds:**

| Metric        | Threshold  |
|---------------|------------|
| Desktop score | < 90       |
| Mobile score  | < 70       |
| LCP           | > 2,500 ms |
| CLS           | > 0.1      |

---

#### `runPagespeedAudit`

Runs PageSpeed Insights for both mobile and desktop and lists failing audits.

**Parameters**

| Name     | Type     | Required | Description              |
|----------|----------|----------|--------------------------|
| `siteId` | `number` | yes      | Site ID from config      |
| `url`    | `string` | yes      | Full URL of the page     |

**Returns**

```json
{
  "site_id": 1,
  "url": "https://lifecircle.in/",
  "mobile_score": 62,
  "desktop_score": 91,
  "lcp_ms": 3200,
  "cls": 0.08,
  "fid_ms": 45,
  "fcp_ms": 1800,
  "tbt_ms": 210,
  "issues": [
    {
      "audit": "render-blocking-resources",
      "title": "Eliminate render-blocking resources",
      "description": "Resources are blocking the first paint of your page.",
      "score": 0.3
    }
  ],
  "alerts": ["Mobile LCP 3200ms exceeds 2500ms threshold"]
}
```

---

#### `checkCrawlErrors`

Scans GSC for crawl and indexing errors.

**Parameters**

| Name     | Type     | Required | Description         |
|----------|----------|----------|---------------------|
| `siteId` | `number` | yes      | Site ID from config |

**Returns**

```json
{
  "site_id": 1,
  "site_url": "https://lifecircle.in",
  "error_count": 2,
  "warning_count": 1,
  "errors": [
    {
      "type": "not_indexed",
      "url": "https://lifecircle.in/draft-page/",
      "detail": "Page is not indexed"
    },
    {
      "type": "sitemap_error",
      "sitemap": "https://lifecircle.in/sitemap.xml",
      "detail": "Sitemap could not be read"
    }
  ]
}
```

**`type` values:** `"sitemap_error"` | `"not_indexed"` | `"sitemap_warning"`

---

#### `checkIndexCoverage`

Calculates what percentage of submitted sitemap URLs are indexed by Google.

**Parameters**

| Name     | Type     | Required | Description         |
|----------|----------|----------|---------------------|
| `siteId` | `number` | yes      | Site ID from config |

**Returns**

```json
{
  "site_id": 1,
  "site_url": "https://lifecircle.in",
  "submitted_count": 90,
  "indexed_count": 85,
  "not_indexed_count": 5,
  "coverage_pct": 94.4,
  "not_indexed_urls": [
    "https://lifecircle.in/old-page/"
  ],
  "alerts": []
}
```

---

#### `getCoreWebVitals`

Fetches Chrome User Experience (CrUX) field data from PageSpeed Insights, with lab data as a fallback.

**Parameters**

| Name     | Type     | Required | Description         |
|----------|----------|----------|---------------------|
| `siteId` | `number` | yes      | Site ID from config |

**Returns**

```json
{
  "site_id": 1,
  "site_url": "https://lifecircle.in",
  "source": "field",
  "lcp_ms": 2100,
  "cls": 0.05,
  "fid_ms": 30,
  "inp_ms": 120,
  "fcp_ms": 1400,
  "lcp_category": "FAST",
  "cls_category": "FAST",
  "fid_category": "FAST",
  "alerts": []
}
```

**`source` values:** `"field"` (CrUX) | `"lab"` (PSI simulation fallback)
**Category values:** `"FAST"` | `"AVERAGE"` | `"SLOW"`

---

### reporting

Utility module for formatting and dispatching SEO digests to Slack and Google Sheets. Not an MCP server with exposed tools — called directly from orchestrators.
Credentials: `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` (optional), `SHEETS_ID`.

---

#### `postSlackMessage`

Posts a formatted message to a Slack channel.

**Parameters**

| Name      | Type       | Required | Description                                      |
|-----------|------------|----------|--------------------------------------------------|
| `message` | `string`   | yes      | Plain-text message fallback                      |
| `blocks`  | `object[]` | no       | Slack Block Kit blocks for rich formatting       |
| `channel` | `string`   | no       | Channel ID (falls back to `SLACK_CHANNEL_ID` env)|

**Returns**

```json
{ "ok": true, "ts": "1720864800.000100", "channel": "C0123456789" }
```

---

#### `writeToSheet`

Appends rows to a named tab in the configured Google Sheet.

**Parameters**

| Name      | Type            | Required | Description                              |
|-----------|-----------------|----------|------------------------------------------|
| `siteId`  | `number`        | yes      | Site ID from config                      |
| `tabName` | `string`        | yes      | Sheet tab name (created if not present)  |
| `rows`    | `unknown[][]`   | yes      | 2-D array of row data to append          |

**Returns**

```json
{ "ok": true, "tab": "Rankings", "updated_rows": 5 }
```

---

#### `logRecommendation`

Logs the outcome of an agent recommendation to the Sheets audit trail.

**Parameters**

| Name             | Type     | Required | Description                                                |
|------------------|----------|----------|------------------------------------------------------------|
| `siteId`         | `number` | yes      | Site ID from config                                        |
| `module`         | `string` | yes      | Originating module (e.g. `"weekly"`, `"monthly-discovery"`)|
| `recommendation` | `string` | yes      | Human-readable recommendation text                         |
| `outcome`        | `string` | yes      | `"pending"` \| `"accepted"` \| `"rejected"` \| `"successful"` |

---

### keyword-researcher

Discovers keyword opportunities for city + service combinations using DataForSEO, cross-references GSC rankings, and writes results to Google Sheets.
Credentials: `SHEETS_ID`, GSC OAuth (via shared `getSearchConsoleClient()`).
Not a standalone MCP server — called directly from orchestrators.

---

#### `discoverCityKeywords`

Queries DataForSEO for related keywords for a city + service seed, then cross-references GSC to identify ranking gaps.

**Parameters**

| Name      | Type     | Required | Description                              |
|-----------|----------|----------|------------------------------------------|
| `siteId`  | `number` | yes      | Site ID from config                      |
| `siteUrl` | `string` | yes      | Site URL for GSC lookup                  |
| `city`    | `string` | yes      | Target city (e.g. `"Bangalore"`)         |
| `service` | `string` | yes      | Service name (e.g. `"home care"`)        |

**Returns**

Array of up to 50 `KeywordOpportunity` objects:

```json
[
  {
    "keyword": "home care services in bangalore",
    "volume": 1900,
    "difficulty": 42,
    "current_position": 11
  }
]
```

> `current_position` is `null` when the site has no GSC impression data for the keyword.

---

#### `getKeywordClusters`

Groups a list of keywords into topic clusters by extracting the dominant non-stop word from each keyword.

**Parameters**

| Name       | Type                   | Required | Description                    |
|------------|------------------------|----------|--------------------------------|
| `keywords` | `KeywordOpportunity[]` | yes      | Output from `discoverCityKeywords` |

**Returns**

Same array with a `cluster` field added to each item (e.g. `"care"`, `"nurse"`, `"bangalore"`).

---

#### `prioritiseKeywords`

Sorts keywords by a composite opportunity score.

**Parameters**

| Name       | Type                   | Required | Description                    |
|------------|------------------------|----------|--------------------------------|
| `keywords` | `KeywordOpportunity[]` | yes      | Keywords with volume/difficulty |

**Returns**

Keywords sorted descending by `opportunity_score`. Score formula:

```
opportunity_score = (volume × 0.4) + ((100 − difficulty) × 0.4) + (position_gap × 0.2)
```

`position_gap` = `current_position` if ranked, else `100`.

---

#### `writeKeywordMatrix`

Appends a batch of keywords for a city to the `"Keywords"` tab in the configured Google Sheet.

**Parameters**

| Name       | Type                   | Required | Description                     |
|------------|------------------------|----------|---------------------------------|
| `siteId`   | `number`               | yes      | Site ID from config             |
| `city`     | `string`               | yes      | City label for the row          |
| `keywords` | `KeywordOpportunity[]` | yes      | Keywords to write               |

**Returns**

```json
{ "success": true, "rows_written": 50 }
```
