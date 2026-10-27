# Deployment notes — SEO agent update (October 2026)

Changes to two codebases:

- **seo-agent** (this repo): security fixes, safety switches, prompt files, keyword fixes, before/after impact tracking, dismiss reasons, and **ranking fixes** (city-first keyword priority, rewrite cooldown, cannibalisation guard, weekly merge suggestions, weekly rank history, live-page check).
- **Template** (Angular ops app, Marketing → SEO screens): UI for the above, plus fixes.

Nothing here has been run against a real database or deployed. It was verified by:

- TypeScript type-check (`npx tsc --noEmit`). The only error is a pre-existing one in `MCPs/services/lc-client.service.ts` (missing types for `sample/sample.js`).
- Angular build.
- Unit checks for prompt rendering, keyword grounding, impact date windows, keyword prioritisation and week calculation.
- Every new SQL query was run read-only against the QA `seo_agent` data (MySQL 5.7).

Please test on QA before production.

---

## 1. Before you deploy — checklist

| # | Action | Why |
|---|---|---|
| 1 | Confirm **`JWT_SECRET`** is set on the server, and that it is the same secret the ops app signs its tokens with. | The hard-coded fallbacks (`"somesecret"`, `"malti_secret"`) were removed. **The server now refuses to start without it.** |
| 2 | Add **`INTERNAL_API_TOKEN`** (a long random string, e.g. `openssl rand -hex 32`). | `POST /approvals` now requires auth. `cms-connector` queues approvals by calling this API and sends the token in `x-internal-token`. **Without it, new approvals silently stop being created.** It also fixes `gbp-manager` and `reputation-manager`, which were already getting 401 from `GET /approvals/:id`. |
| 3 | Optional: **`SEO_AGENT_MODEL`**. | The model for the SEO generators. Defaults to `claude-sonnet-5`, which is the current behaviour. Deliberately separate from `CLAUDE_MODEL`, which Malti uses with a different default. |
| 4 | Production: leave **`CRON_ENABLED`** and **`DB_AUTO_INIT`** unset (or `true`). On **QA / local copies, set both to `false`.** | New switches. `CRON_ENABLED=false` stops the scheduled jobs (Claude, DataForSEO, WordPress publishing). `DB_AUTO_INIT=false` skips `CREATE TABLE` at startup. |
| 5 | Check whether anything other than the ops app calls `/config/*` or `/sites/*` (for example the old Next.js dashboard at `DASHBOARD_URL`). | These routes now require a login token. The ops app already sends one. |
| 6 | Run **`migrations/002_change_impact.sql`** on the seo-agent database (schema `seo_agent`). | Creates the `change_impact` table and backfills past changes (about 840 rows). Safe to re-run. `DB_AUTO_INIT` would also create the table, but not the backfill. |
| 7 | Run **`migrations/003_keyword_rank_history.sql`**. | Creates the `keyword_rank_history` table and seeds this week's positions as the baseline. Safe to re-run. |
| 8 | Optional: **`PAGE_MATCH_MIN`** (default `80`). | The minimum % of suggested content that must be on the live page before "Mark as created/updated" is accepted. |

`.env.example` documents all of these.

## 2. Deploy order

1. **seo-agent:** run `npm ci`, then `npm run build`. The build now also copies `seo-agent/prompts/*.md` into `dist/`. Then restart.
   - If you run from source with `tsx`, nothing extra is needed.
   - On startup, check the log for `[startup] scheduled jobs ENABLED` (prod) and that there are no `[prompts]` errors.
2. Run the SQL (steps 6 and 7 above) if it hasn't been run yet.
3. **Template:** build and deploy as usual. It is backward compatible: until the backend is live, the new "Result" columns show "Not tracked", the rank-history views show "No weekly history yet", and nothing breaks.

## 3. What changed in seo-agent

### Security
- `requireAuth` added to all `/config/*` routes, the `/sites/*` routes and `POST /approvals` (`seo-agent/routes/*.routes.ts`).
- `middleware/auth.middleware.ts` also accepts `x-internal-token` = `INTERNAL_API_TOKEN` for server-to-server calls. The comparison is constant-time, and it is disabled when the variable is unset.
- `JWT_SECRET` fallbacks removed in `middleware/auth.middleware.ts`, `malti/middleware/auth.js` and `malti/controllers/authController.js`.

### Safety switches (`server.ts`)
- `CRON_ENABLED`: all `cron.schedule(...)` calls now go through `scheduleJob(...)`.
- `DB_AUTO_INIT`: the startup table creation is skipped when this is `false`.

### Bug fixes
- **Edit & Approve published the unedited AI text.** `approveApproval` saved the edited content but sent `approval.updated_content`, which was read before the update, to WordPress. It now publishes the approved (edited) content, for both meta rewrites and canonicals. (`controllers/approvals.controller.ts`)
- **Primary Rank Math keyword was dropped.** `daily_wp_pages_analyser.ts` read `page.primary_keyword`, but `getWPPageDetails` returns `primary_keywords`. Fixed with a `rankMathKeywords()` helper.
- **`getAcknowledgedPageByUrl`** had `WHERE url = ? AND status = 21 OR status = 22`, which matched any updated page. Changed to `status IN (21, 22)`.
- **`optimize_content` and `content_gap` opportunities** were created but never processed. `daily_opportunity_tasks.ts` now handles them with the same handler as `refresh_content`.
  - **Expect a one-off backlog:** up to 5 of each type per site per day until it clears.
- **Meta-title prompt contradicted itself** (60–90 vs 50–60 characters). The writing rules now say title 50–60 and description 150–160.

### Keyword grounding (`seo-agent/utils/grounding.ts`)
- Monthly discovery and the weekly performance check now keep only those `target_keywords` that appear in the data sent to Claude.
- Keywords Claude makes up are dropped and logged (`dropped N keyword(s) not present in the input data`).
- An opportunity left with no keywords is skipped. Expect slightly fewer opportunities.

### Prompts moved to files (`seo-agent/prompts/`)
- The 12 main generator prompts are now `.md` files, rendered with `renderPrompt(name, vars)` using `{{placeholder}}`.
- They were extracted automatically and verified to render **byte-identical** to the old template strings.
- To change a prompt, edit the `.md` file and keep the placeholders.
- Not moved yet: the prompts in `weekly.ts`, `monthly_audit.ts`, link-optimiser, page-generator and reputation-manager.

### Before/after impact tracking
- **New table:** `change_impact` (`models/change-impact.model.ts`, `migrations/002_change_impact.sql`).
- **Recording:** a change is recorded (one row per URL) when:
  - a `meta_rewrite` or `canonical` approval is approved
  - page content is marked created or updated
  - a person completes an opportunity that has a URL
- **Measuring:** a new daily job, **"Measure Change Impact" at 06:30 IST**, fills in Search Console clicks, impressions, CTR and position for the 28 days before and the 28 days after each change. It runs once the after-window plus a 3-day lag has passed, 300 rows per run, retrying up to 5 times.
  - The backfilled rows are all already due, so they fill in over about 3 days. That's about 600 Search Console queries a day.
- **API:**
  - `GET /seo-agent/change-impact?source_type=approval|page_content|opportunity&source_ids=a,b`
  - `GET /seo-agent/change-impact/summary?site_id=1&days=180`
- **Recording failures never fail** the approval or status change that triggered them; they are only logged.

### Opportunities
- `POST /opportunities/:id/ignore` accepts an optional `{ reason }`, stored as `opportunity_details.dismiss_reason`. No schema change.

### Ranking fixes (why rankings weren't moving)
Background: QA data showed 327 keywords with 3+ of our pages competing for them, the same
pages' titles rewritten up to 21 times in 3 months, and keyword selection dominated by
national search volume.

- **Keyword prioritisation rewritten** (`mcp-servers/keyword-researcher/server.ts` → `prioritiseKeywords`).
  - The old score was `volume × 0.4 + …`, so 301k-volume national terms always won. It also gave more points the worse we ranked.
  - The new score favours striking distance (positions 4–20), existing impressions, keywords naming a configured city, then log-scaled volume and ease.
  - Monthly discovery passes the site's cities.
- **Meta rewrite cooldown** (`services/seo-guards.service.ts`). A URL is not rewritten again when:
  - a rewrite is pending,
  - it was rewritten in the last 90 days, or
  - its last rewrite measurably improved clicks (180 days).
  - Applied in `daily_wp_pages_analyser.ts` (pages are filtered) and `daily_opportunity_tasks.ts` (the opportunity is dismissed with the reason).
  - As of the September data, about 325 URLs would have been held back.
- **Cannibalisation guard for new pages** (`daily_opportunity_tasks.ts` → `processNewContentOpportunity`).
  - If an existing page already ranks for the primary keyword (10+ impressions or top 30), the new-page opportunity is converted into a `refresh_content` opportunity for that page instead.
  - "Page already exists" opportunities are now dismissed instead of being retried every day.
- **Weekly merge suggestions** (`orchestrators/weekly_consolidation.ts`, added to the Monday 09:00 job).
  - Up to 10 keywords per site where 3+ pages compete become `consolidate_pages` opportunities: keep the strongest page, merge the others and 301 them.
  - These are for a person; the agent never executes them. They are de-duplicated for 90 days.
- **Weekly rank history** (`services/rank-history.service.ts`). A new **"Weekly Keyword Rank Snapshot" job runs Mondays at 12:00 IST**, after the 08:30 weekly job refreshes positions.
  - `GET /seo-agent/rank-history/keyword/:keyword_id`
  - `GET /seo-agent/rank-history/trend?site_id=1&weeks=12&scope=city|all`
- **"Mark as created/updated" now checks the live page.** `POST /contents/:id/created|updated` returns **409** with the match % when the live page contains less than `PAGE_MATCH_MIN`% of the suggested content.
  - If WordPress can't be reached, the action is allowed and logged.
- `consolidate_pages` opportunities use priority `"1"`/`"2"`. The UI now shows numeric priorities as High/Medium/Low.

## 4. What changed in Template (Marketing → SEO)

- **Approvals History** and **Page Contents (Published tab):** new Result column (click change vs the 28 days before) and a before/after table in the expanded row.
- **Site Overview:** new "Results of SEO changes" card per site (last 180 days).
- **Opportunities:** a Dismiss button with a reason; "Merge competing pages" suggestions; numeric priorities shown as High/Medium/Low.
- **Site Keywords:** a weekly position chart in each keyword's detail panel.
- **Site Overview:** a "City keyword rankings by week" table (top 3 / 4–10 / 11–20 / 20+, and the week-on-week change in top-10 count).
- **Fixes:**
  - The pending approvals queue now really sorts by priority (it sends `sort_by=priority&sort_dir=asc`; the old `sort=priority` was ignored).
  - The Backlinks "Removed" button calls `POST /backlinks/:id/removed` instead of `DELETE`, so history is kept.
  - Live updates are filtered to the site being viewed.

## 5. How to check it worked (after deploy)

1. Log in to the ops app and open Marketing → SEO → Config. The lists load, which confirms the token is accepted on `/config`.
2. Wait for the next `cms-connector` run, or check the logs: new approvals still appear, with no 401 in the logs for `POST /approvals`.
3. Edit & Approve a meta rewrite **on a test page**. WordPress shows the **edited** title. A `change_impact` row appears with `status='waiting'`.
4. The day after the SQL is run: `SELECT status, COUNT(*) FROM change_impact GROUP BY status;` shows `measured` rows. Approvals History shows Result values.
5. After the next weekly and monthly runs, search the log for `dropped` to see how often keywords were being invented.
6. **Cooldown:** on the next quarterly or daily meta-rewrite run, the log shows `[step1] N/M pages eligible for a meta rewrite` and `skip … cooldown until …` lines.
7. **Merge suggestions:** after the first Monday 09:00 run, Opportunities shows "Merge competing pages" items (`SELECT COUNT(*) FROM opportunities WHERE opportunity_type='consolidate_pages';`).
8. **Rank history:** `SELECT week_start, COUNT(*) FROM keyword_rank_history GROUP BY week_start;` shows the baseline week from the SQL, and a new week after each Monday 12:00 run. Site Overview → "City keyword rankings by week" fills in.
9. **Live-page check:** mark a page as updated **before** publishing it. It is refused with "The live page matches only N%…". After publishing, it is accepted.

## 6. Rollback

- **Code:** redeploy the previous build. The new tables, the `dismiss_reason` JSON key and the `consolidate_pages` opportunity type are all harmless to the old code.
- **Data:** `change_impact` and `keyword_rank_history` are only written by this update. If needed, `DROP TABLE change_impact; DROP TABLE keyword_rank_history;` removes them completely.
- **Partial rollback:** each ranking fix is self-contained. The cooldown is `getMetaRewriteBlocks`, the new-page guard is the block at the top of `processNewContentOpportunity`, merge suggestions are one line in the Monday 09:00 job in `server.ts`, and the priority formula is `prioritiseKeywords`.
