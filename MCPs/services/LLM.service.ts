// text-to-sql-view.ts
// Natural language -> MySQL SELECT over one (or more) denormalized VIEWS. Single file, no other local modules.
//   npm i @anthropic-ai/sdk node-sql-parser     npm i -D typescript tsx @types/node
//   Set ANTHROPIC_API_KEY.
//
// Sections: 1 types  2 cache  3 schema index + pruning  4 SQL guard  5 generator
// Public API: createSqlGenerator, mergeSchemas, InMemoryTtlCache, RedisSqlCache (+ types)
import "dotenv/config";

import Anthropic from "@anthropic-ai/sdk";
import sqlParser from "node-sql-parser";
const { Parser } = sqlParser;
import { createHash } from "node:crypto";
import { logger } from "../../madhavi/utils/logger";
import { lc_pool } from "../../db";
import { RowDataPacket } from "mysql2";
import sample from "../sample/sample";

/* ================================================================== *
 * 1. TYPES
 * ================================================================== */

/**
 * One denormalized VIEW (a wide table that already contains the joins).
 *
 * Column DSL (one string per column):  name[:type][~alias1|alias2][{code=meaning|...}][#note]
 *   "cg_id"                            plain column
 *   "created_on:datetime"              typed column (types: num, str, date, datetime, bool)
 *   "status:num~working|removed"       ~aliases = business words for this column (used for pruning only, never sent)
 *   "status:num{0=created|1=active|2=deleted}"   coded values: SQL must use the CODE
 */
interface ViewSpec {
  /** Grain + business rules, e.g. "one row per CG line; use COUNT(DISTINCT hp_unique_id) to count caregivers". */
  note?: string;
  /** Business words that point to this view (routing only, never sent to the LLM). */
  aliases?: string[];
  /** Columns returned when the question names no specific columns (e.g. "list 10 caregivers"). Replaces SELECT *. */
  defaults?: string[];
  cols: string[];
  /** Columns that are always sent to the LLM (ids, main date column ...). */
  always?: string[];
}

/** view name -> spec. Adding another view later = adding another key (see mergeSchemas). */
type Schema = Record<string, ViewSpec>;

/** Business term -> exact SQL meaning. Sent to the LLM ONLY when the question mentions the term. */
interface GlossaryEntry {
  /** Trigger phrases, e.g. ['active customer'] (all words of one phrase must appear in the question). */
  terms: string[];
  /** Definition in SQL terms, e.g. "status = 1 AND refund_flag = 'N'". */
  means: string;
  /** Force this view into the prompt when triggered. */
  view?: string;
  /** Force these columns into the prompt when triggered. */
  columns?: string[];
}

type SqlResult =
  | {
      valid: true;
      sql: string;
      views: string[];
      columns: string[];
      cached?: boolean;
    }
  | { valid: false; reason: string; cached?: boolean };

/** Combine schemas from different modules/teams; throws on duplicate view names. */
function mergeSchemas(...schemas: Schema[]): Schema {
  const out: Schema = {};
  for (const s of schemas) {
    for (const [name, spec] of Object.entries(s)) {
      if (out[name]) throw new Error(`Duplicate view in schema: ${name}`);
      out[name] = spec;
    }
  }
  return out;
}

/* ================================================================== *
 * 2. CACHE (pluggable, fixed TTL)
 * ================================================================== */

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedEntry {
  result: Omit<SqlResult, "cached">;
  createdAt: number; // epoch ms
}

interface SqlCache {
  get(key: string): Promise<CachedEntry | null>;
  /** Entry must expire after ttlMs (fixed expiry from creation time). */
  set(key: string, value: CachedEntry, ttlMs: number): Promise<void>;
}

/** In-memory cache: fixed TTL, LRU eviction, hourly sweep of expired rows. */
class InMemoryTtlCache implements SqlCache {
  private store = new Map<string, { value: CachedEntry; expiresAt: number }>();
  private timer: NodeJS.Timeout;

  constructor(
    private maxEntries = 5000,
    sweepEveryMs = 60 * 60 * 1000,
  ) {
    this.timer = setInterval(() => this.sweep(), sweepEveryMs);
    this.timer.unref();
  }

  async get(key: string): Promise<CachedEntry | null> {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    this.store.delete(key); // refresh LRU position (expiry is NOT extended)
    this.store.set(key, e);
    return e.value;
  }

  async set(key: string, value: CachedEntry, ttlMs: number): Promise<void> {
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  sweep(): number {
    const now = Date.now();
    let removed = 0;
    for (const [k, e] of this.store) {
      if (e.expiresAt <= now) {
        this.store.delete(k);
        removed++;
      }
    }
    return removed;
  }

  close(): void {
    clearInterval(this.timer);
  }
}

/** Minimal shape of an ioredis-style client. */
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
  ): Promise<unknown>;
}

/** Redis expires keys natively; shared across instances and survives restarts. */
class RedisSqlCache implements SqlCache {
  constructor(
    private client: RedisLike,
    private prefix = "nl2sql-view:",
  ) {}

  async get(key: string): Promise<CachedEntry | null> {
    const raw = await this.client.get(this.prefix + key);
    return raw ? (JSON.parse(raw) as CachedEntry) : null;
  }

  async set(key: string, value: CachedEntry, ttlMs: number): Promise<void> {
    await this.client.set(
      this.prefix + key,
      JSON.stringify(value),
      "EX",
      Math.ceil(ttlMs / 1000),
    );
  }
}

/* ================================================================== *
 * 3. SCHEMA INDEX + PRUNING (no LLM tokens)
 * ================================================================== */

/* ---------- text helpers ---------- */

// crude singularizer; keeps 'status' / 'address' intact and maps 'statuses' -> 'status'
const stem = (w: string): string =>
  w
    .replace(/ies$/, "y")
    .replace(/uses$/, "us")
    .replace(/(?<=(?:ss|sh|ch|x|z))es$/, "")
    .replace(/(?<![su])s$/, "");

const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2)
    .map(stem);

// words that mean "the question is about time" -> pull in date/datetime columns
const TIME_WORDS = new Set(
  (
    "today yesterday tomorrow week month year quarter day date time daily weekly monthly yearly quarterly " +
    "recent ago since until before after between last this next current"
  )
    .split(" ")
    .map(stem),
);
const TIME_TYPES = new Set(["date", "datetime", "timestamp"]);

/* ---------- index ---------- */

const COL_RE = /^(\w+)(?::(\w+))?(?:~([^{#]+))?(?:\{(.+?)\})?(?:#(.+))?$/;

interface ColumnIndex {
  name: string;
  type?: string;
  /** what the LLM sees, e.g. "status:num{0=New|1=Paid}#note" */
  line: string;
  nameTerms: Set<string>; // column name + aliases
  valueTerms: Set<string>; // code meanings + notes
  isTime: boolean;
}

interface ViewIndex {
  name: string;
  note?: string;
  nameTerms: Set<string>; // view name + aliases
  columns: ColumnIndex[];
  byName: Map<string, ColumnIndex>; // key = lowercase column name
  always: string[];
}

interface SchemaIndex {
  names: string[];
  views: Record<string, ViewIndex>;
}

function buildIndex(schema: Schema): SchemaIndex {
  const views: Record<string, ViewIndex> = {};

  for (const [name, spec] of Object.entries(schema)) {
    const columns: ColumnIndex[] = [];
    const byName = new Map<string, ColumnIndex>();

    for (const raw of spec.cols) {
      const m = raw.match(COL_RE);
      if (!m) throw new Error(`Bad column spec: ${name}.${raw}`);
      const [, col, type, aliases, enums, note] = m;
      if (byName.has(col.toLowerCase()))
        throw new Error(`Duplicate column: ${name}.${col}`);

      const nameTerms = new Set<string>([
        ...tokens(col),
        ...(aliases ? aliases.split("|").flatMap(tokens) : []),
      ]);
      const valueTerms = new Set<string>();
      enums
        ?.split("|")
        .forEach((v) => tokens(v).forEach((x) => valueTerms.add(x)));
      if (note) tokens(note).forEach((x) => valueTerms.add(x));

      const c: ColumnIndex = {
        name: col,
        type,
        line: `${col}${type ? `:${type}` : ""}${enums ? `{${enums}}` : ""}${note ? `#${note}` : ""}`,
        nameTerms,
        valueTerms,
        isTime: !!type && TIME_TYPES.has(type.toLowerCase()),
      };
      columns.push(c);
      byName.set(col.toLowerCase(), c);
    }

    const always = (spec.always ?? []).map((a) => {
      const c = byName.get(a.toLowerCase());
      if (!c) throw new Error(`"always" column not found: ${name}.${a}`);
      return c.name;
    });

    views[name] = {
      name,
      note: spec.note,
      nameTerms: new Set([
        ...tokens(name),
        ...(spec.aliases ?? []).flatMap(tokens),
        ...(spec.note ? [] : []),
      ]),
      columns,
      byName,
      always,
    };
  }
  return { names: Object.keys(views), views };
}

/* ---------- pruning ---------- */

const scoreColumn = (c: ColumnIndex, q: Set<string>): number => {
  let s = 0;
  for (const w of q) {
    if (c.nameTerms.has(w)) s += 3;
    else if (c.valueTerms.has(w)) s += 1;
  }
  return s;
};

/**
 * Picks the view(s) for a question. One registered view -> always that view (no scoring, no LLM).
 * Returns null when nothing matches (caller may fall back to a cheap LLM router).
 */
function pickViews(
  index: SchemaIndex,
  question: string,
  candidates: number,
  forced: string[] = [],
): string[] | null {
  const picked = new Set<string>(forced.filter((v) => index.views[v]));
  if (index.names.length === 1) return [...index.names];

  const q = new Set(tokens(question));
  const scored = index.names
    .map((n): [string, number] => {
      const v = index.views[n];
      let s = 0;
      for (const w of q) {
        if (v.nameTerms.has(w)) s += 3;
        else if (v.columns.some((c) => c.nameTerms.has(w))) s += 2;
        else if (v.columns.some((c) => c.valueTerms.has(w))) s += 1;
      }
      return [n, s];
    })
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);

  if (scored.length) {
    const top = scored[0][1];
    for (const [n, s] of scored) {
      if (picked.size >= Math.max(candidates, forced.length)) break;
      if (s >= top * 0.6) picked.add(n);
    }
  }
  return picked.size ? [...picked] : null;
}

/**
 * Picks the columns of one view for a question.
 * - view has <= fullSendLimit columns -> send all (pruning would save little and could hurt accuracy)
 * - otherwise: matched columns + always + forced + date columns if the question is about time
 * Returns null when fewer than minMatched columns matched (caller may fall back to the column router).
 */
function pickColumns(
  view: ViewIndex,
  question: string,
  forced: string[],
  fullSendLimit: number,
  minMatched: number,
): string[] | null {
  if (view.columns.length <= fullSendLimit)
    return view.columns.map((c) => c.name);

  const q = new Set(tokens(question));
  const wantsTime = [...q].some((w) => TIME_WORDS.has(w));
  const chosen = new Set<string>(view.always);
  for (const f of forced) {
    const c = view.byName.get(f.toLowerCase());
    if (c) chosen.add(c.name);
  }

  let matched = 0;
  for (const c of view.columns) {
    if (scoreColumn(c, q) > 0) {
      chosen.add(c.name);
      matched++;
    } else if (wantsTime && c.isTime) chosen.add(c.name);
  }
  if (matched < minMatched) return null;
  return view.columns.filter((c) => chosen.has(c.name)).map((c) => c.name); // keep schema order
}

/** "vw_orders(order_id,status:num{0=New|1=Paid}) -- note" */
function renderView(view: ViewIndex, columns: string[]): string {
  const lines = columns
    .map((n) => view.byName.get(n.toLowerCase())?.line)
    .filter(Boolean);
  return `${view.name}(${lines.join(",")})${view.note ? ` -- ${view.note}` : ""}`;
}

/* ================================================================== *
 * 4. SQL GUARD (validates LLM output)
 * ================================================================== */

const parser = new Parser();

// functions / clauses that are never needed for reporting queries
const DENY =
  /\b(sleep|benchmark|load_file|get_lock|release_lock|master_pos_wait)\s*\(|\binto\s+(outfile|dumpfile)\b|\bfor\s+update\b|\block\s+in\s+share\s+mode\b/i;

// bare keywords the parser may report as columns
const KEYWORDS = new Set([
  "current_date",
  "current_time",
  "current_timestamp",
  "current_user",
  "localtime",
  "localtimestamp",
  "true",
  "false",
  "null",
]);

/** Returns an error string (fed back to the LLM for one retry) or null when the SQL is acceptable. */
function validateSql(
  sql: string,
  index: SchemaIndex,
  maxViewsPerQuery = 1,
): string | null {
  if (DENY.test(sql)) return "Forbidden function or clause";

  let ast;
  try {
    ast = parser.astify(sql, { database: "MySQL" });
  } catch (e) {
    return `Syntax error: ${(e as Error).message.slice(0, 120)}`;
  }
  const stmts = Array.isArray(ast) ? ast : [ast];
  if (stmts.length !== 1) return "Multiple statements not allowed";
  if (stmts[0].type !== "select") return "Only SELECT allowed";

  // names defined inside the query itself (CTEs, aliases)
  const local = new Set<string>();
  const withs = (stmts[0] as any).with;
  if (Array.isArray(withs)) {
    for (const w of withs) {
      const n = w?.name?.value ?? w?.name;
      if (typeof n === "string") local.add(n.toLowerCase());
    }
  }
  for (const m of sql.matchAll(/\bas\s+[`"']?(\w+)[`"']?/gi))
    local.add(m[1].toLowerCase());

  // ---- views
  const viewByLower = new Map(index.names.map((n) => [n.toLowerCase(), n]));
  const used = new Set<string>();
  for (const t of parser.tableList(sql, { database: "MySQL" })) {
    const name = t.split("::")[2]?.toLowerCase();
    if (!name || local.has(name)) continue;
    if (!viewByLower.has(name)) return `Unknown view: ${name}`;
    used.add(viewByLower.get(name)!);
  }
  if (used.size === 0) return "No view referenced";
  if (used.size > maxViewsPerQuery)
    return `Query ${maxViewsPerQuery} view(s) only, got: ${[...used].join(",")}`;

  // ---- columns (no joins -> every column must belong to the view)
  const allCols = new Set<string>();
  for (const n of index.names)
    index.views[n].columns.forEach((c) => allCols.add(c.name.toLowerCase()));

  for (const entry of parser.columnList(sql, { database: "MySQL" })) {
    const [, tbl, colRaw] = entry.split("::");
    const col = colRaw?.toLowerCase();
    if (!col || col === "(.*)" || KEYWORDS.has(col) || local.has(col)) continue;
    const owner =
      tbl && tbl !== "null" ? viewByLower.get(tbl.toLowerCase()) : undefined;
    const ok = owner ? index.views[owner].byName.has(col) : allCols.has(col);
    if (!ok) return `Unknown column: ${colRaw}`;
  }
  return null;
}

/* ================================================================== *
 * 5. GENERATOR
 * ================================================================== */

const SYSTEM =
  "MySQL 8 text-to-SQL over denormalized VIEWS (each row is already fully joined). " +
  "Output ONE SELECT query only: no prose, no markdown, no comments. " +
  "Query exactly ONE view, never JOIN. Use only the columns listed. " +
  "Output single line of query without line break." +
  "Format: view(col:type{code=meaning|...}#note) -- view note. " +
  "In SQL always use the stored CODE, never the meaning text. Follow #notes, view notes and Rules exactly. " +
  "Do filtering, grouping, aggregation, sorting and expressions directly on columns. " +
  "Never use SELECT *. If the request names no specific columns (e.g. 'list 10 caregiver'), select only the view\'s [default: ...] columns; " +
  "if it names columns or metrics, select those instead. Use * only when the user asks for all columns/details. " +
  "Add LIMIT 10 unless the query aggregates to a single row. " +
  "If the request cannot be answered from the listed columns, is not a read query, or needs a coded value not listed in {...}, " +
  "output exactly: INVALID: <reason, max 10 words>";

const textOf = (res: Anthropic.Message): string =>
  res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ??
  "";

const cleanSql = (t: string): string =>
  t
    .trim()
    .replace(/^```(?:sql)?/i, "")
    .replace(/```$/, "")
    .trim()
    .replace(/;+\s*$/, "");

interface GeneratorOptions {
  cache?: SqlCache; // default: InMemoryTtlCache
  ttlMs?: number; // default: 7 days
  model?: string;
  glossary?: GlossaryEntry[]; // part of the cache key
  /** Max views sent to the LLM when several views match (default 2; only close-scoring views are added). */
  candidateViews?: number;
  /** Max views one generated query may use (default 1 = no cross-view joins). */
  maxViewsPerQuery?: number;
  /** Views with at most this many columns are sent whole (default 40). */
  fullSendLimit?: number;
  /** Wide views: if fewer columns than this match locally, ask a cheap LLM router (default 1). */
  minMatchedColumns?: number;
  maxRetries?: number;
  maxOutputTokens?: number;
  client?: Anthropic;
  debug?: boolean;
}

interface CallOptions {
  /** Skip the cache read and force a fresh LLM call (the new result overwrites the cached one). */
  refresh?: boolean;
}

type SqlGenerator = (
  question: string,
  options?: CallOptions,
) => Promise<SqlResult>;

function createSqlGenerator(
  schema: Schema,
  opts: GeneratorOptions = {},
): SqlGenerator {
  const {
    cache = new InMemoryTtlCache(),
    ttlMs = ONE_WEEK_MS,
    model = "claude-haiku-4-5",
    glossary = [],
    candidateViews = 2,
    maxViewsPerQuery = 1,
    fullSendLimit = 40,
    minMatchedColumns = 1,
    maxRetries = 1,
    maxOutputTokens = 400,
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 30 * 1000,
      maxRetries: 1,
    }),
    debug = false,
  } = opts;

  const index = buildIndex(schema);
  // Schema + glossary fingerprint in every cache key => editing either invalidates old cached SQL.
  const schemaHash = createHash("sha256")
    .update(JSON.stringify({ schema, glossary }))
    .digest("hex")
    .slice(0, 12);
  const inflight = new Map<string, Promise<SqlResult>>();

  const glossaryIdx = glossary.map((g) => ({
    g,
    phrases: g.terms.map(tokens).filter((a) => a.length),
  }));
  const matchGlossary = (q: string): GlossaryEntry[] => {
    const qt = new Set(tokens(q));
    return glossaryIdx
      .filter(({ phrases }) => phrases.some((ph) => ph.every((w) => qt.has(w))))
      .map(({ g }) => g);
  };

  /* ---- cheap fallback routers (names only) ---- */
  const route = async (system: string, user: string): Promise<string[]> => {
    const res = await client.messages.create({
      model,
      max_tokens: 300,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
    });
    const out = textOf(res).trim();
    logger.debug("Stop Reason", res.stop_reason);
    logger.debug("USAGE", res.usage);

    return /^none/i.test(out)
      ? []
      : out
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
  };

  const routeView = async (q: string): Promise<string[]> => {
    const list = index.names
      .map((n) => `${n}: ${(index.views[n].note ?? "").slice(0, 100)}`)
      .join("\n");
    const names = await route(
      "Pick the view needed for the request. Reply ONLY one view name from the list, or NONE.",
      `Views:\n${list}\nRequest: ${q}`,
    );
    const hit = index.names.find(
      (n) => n.toLowerCase() === names[0]?.toLowerCase(),
    );
    return hit ? [hit] : [];
  };

  const routeColumns = async (q: string, v: ViewIndex): Promise<string[]> => {
    const list = v.columns
      .map((c) => c.name + (c.type ? `:${c.type}` : ""))
      .join(",");
    const names = await route(
      "Pick the columns needed for the request. Reply ONLY comma-separated column names from the list, or NONE.",
      `Columns: ${list}\nRequest: ${q}`,
    );
    return names
      .map((n) => v.byName.get(n.split(":")[0].toLowerCase())?.name)
      .filter((n): n is string => !!n);
  };

  /** Calls the LLM. `cacheable` is false for transient failures so they are retried next time. */
  const callLLM = async (
    question: string,
  ): Promise<{ result: SqlResult; cacheable: boolean }> => {
    const rules = matchGlossary(question);

    // 1) which view(s)
    let viewNames = pickViews(
      index,
      question,
      candidateViews,
      rules.map((r) => r.view).filter((v): v is string => !!v),
    );
    if (!viewNames) viewNames = await routeView(question);
    if (!viewNames.length)
      return {
        result: { valid: false, reason: "No relevant view found" },
        cacheable: true,
      };

    // 2) which columns of each view
    const lines: string[] = [];
    const sentColumns: string[] = [];
    for (const vn of viewNames) {
      const v = index.views[vn];
      const forced = rules
        .filter((r) => !r.view || r.view === vn)
        .flatMap((r) => r.columns ?? []);
      let cols = pickColumns(
        v,
        question,
        forced,
        fullSendLimit,
        minMatchedColumns,
      );
      if (!cols) {
        const routed = await routeColumns(question, v);
        cols = routed.length
          ? v.columns
              .filter(
                (c) =>
                  routed.includes(c.name) ||
                  v.always.includes(c.name) ||
                  forced.some((f) => f.toLowerCase() === c.name.toLowerCase()),
              )
              .map((c) => c.name)
          : [];
      }
      if (!cols.length) continue;

      lines.push(renderView(v, cols));
      sentColumns.push(...cols);
    }
    if (!lines.length)
      return {
        result: { valid: false, reason: "No relevant columns found" },
        cacheable: true,
      };

    const schemaText =
      lines.join("\n") +
      (rules.length
        ? `\nRules:\n${rules.map((r) => `${r.terms[0]} = ${r.means}`).join("\n")}`
        : "");
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: question },
    ];
    let lastErr: string | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await client.messages.create({
        model,
        max_tokens: maxOutputTokens,
        temperature: 0,
        system: [
          { type: "text", text: SYSTEM },
          // Small schema sent whole every time? add cache_control: { type: 'ephemeral' } to this block.
          { type: "text", text: schemaText },
        ],
        messages,
      });

      const text = cleanSql(textOf(res));
      logger.debug("Stop Reason", res.stop_reason);
      logger.debug("USAGE", res.usage);

      if (/^INVALID/i.test(text)) {
        const reason =
          text.replace(/^INVALID:?\s*/i, "") || "Request not possible";
        return { result: { valid: false, reason }, cacheable: true };
      }

      lastErr = validateSql(text, index, maxViewsPerQuery);
      if (!lastErr)
        return {
          result: {
            valid: true,
            sql: text,
            views: viewNames,
            columns: sentColumns,
          },
          cacheable: true,
        };

      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content: `Error: ${lastErr}. Fix. Same output rules.`,
      });
    }

    return {
      result: {
        valid: false,
        reason: `Could not produce a valid SELECT (${lastErr})`,
      },
      cacheable: false,
    };
  };

  return async function generateSql(
    question: string,
    options: CallOptions = {},
  ): Promise<SqlResult> {
    const normalized = question.trim().toLowerCase().replace(/\s+/g, " ");
    const key = `${schemaHash}:${createHash("sha256").update(normalized).digest("hex")}`;

    // 1) cache hit -> no LLM call
    const hit = options.refresh ? null : await cache.get(key);
    if (hit && Date.now() - hit.createdAt < ttlMs) {
      return { ...hit.result, cached: true } as SqlResult;
    }

    // 2) same question already being generated -> share the promise
    const pending = inflight.get(key);
    if (pending) return pending;

    // 3) call LLM, then store
    const p = (async (): Promise<SqlResult> => {
      const { result, cacheable } = await callLLM(question);
      if (cacheable)
        await cache.set(key, { result, createdAt: Date.now() }, ttlMs);
      return result;
    })().finally(() => inflight.delete(key));

    inflight.set(key, p);
    return p;
  };
}

/* ---------- 1) ONE denormalized view that already contains all joins ---------- */
const caregivers: Schema = {
  caregiver_details: {
    // note: "one row per order line; order-level columns repeat on every line, so use COUNT(DISTINCT order_id) to count orders",
    aliases: ["caregivers", "caregiver", "cg", "cgs", "nurse"],
    always: ["hp_unique_id", "user_id", "name", "phone_number"],
    defaults: [
      "hp_unique_id",
      "name",
      "phone_number",
      "branch",
      "profile_status",
      "working_status",
      "created_on",
    ],
    cols: [
      "hp_unique_id:num",
      "user_id:num",
      "name:str",
      "phone_number:str",
      "dob:date",
      "gender:str{Male|Female|Other}",
      "branch_city:str~branch city|branch",
      "livein_pay:num~daily wages|daily pay|perday#daily wages for live-in shift",
      "liveout_pay:num~daily wages|daily pay|perday#daily wages for live-out shift",
      "skill_type:str~skill|skills|service{'Caregiving'|'Therapy'|'Nursing'|'Physiotherapy'}",
      "languages:str#comma-separated list of languages",
      "shift_preferences:str~shift|shifts{Live-In|Live-Out|Live-Out-Day|Live-Out-Night}#comma-separated list of shift preferences",
      "current_address:str~address|city#current address with city, state, pincode",
      "profile_status:str~profile|status{completed|incomplete|under background verification|rejected}",
      "working_status:str~working|booking{working|bench|on leave}",
      "leave_from:date~leave|from#leave start date in ISO format (YYYY-MM-DD)",
      "expected_leave_end:date~leave|to#expected leave end date in ISO format (YYYY-MM-DD)",
      "missing_details:str~missing|details#comma-separated list of missing details in profile",
      "created_on:datetime~registered|created",
    ],
  },
};

const glossary: GlossaryEntry[] = [
  {
    terms: ["revenue", "sales"],
    means: "SUM(line_total) WHERE status IN (1,2) AND refund_flag='N'",
    columns: ["line_total", "status", "refund_flag"],
  },
];

/* ---------- 2) a second view added later: just another schema object ---------- */
const inventory: Schema = {
  vw_stock_levels: {
    note: "one row per product per warehouse (latest snapshot)",
    aliases: ["inventory", "stock", "warehouse"],
    cols: [
      "product_name:str~product",
      "warehouse:str",
      "on_hand:num~stock|quantity",
      "reorder_level:num",
      "last_counted_at:datetime",
    ],
  },
};

async function searchCaregiver(query: string) {
  const [rows] = await lc_pool.query<RowDataPacket[]>(query);
  return rows;
}

// Created once at module load so the cache (and inflight map) persist across calls.
const caregiverSqlGenerator = createSqlGenerator(caregivers);

export async function searchCaregiverLLM(question: string) {
  try {
    // return sample.SAMPLE_CG_DATA.slice(0, 10).map((sample) => ({
    //   cg_id: sample.cg_id,
    //   name: sample.name,
    //   phone: sample.phone,
    // }));

    const query = await caregiverSqlGenerator(question);
    if (query.valid) {
      logger.log("query ", query.sql);

      const result = await searchCaregiver(query.sql);
      return result;
    } else {
      throw new Error(query.reason);
    }
  } catch (err: any) {
    logger.error("searchCaregiverLLM", err);
    return err.message;
  }
}
