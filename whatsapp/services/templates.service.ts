/**
 * Message templates: listed from the WhatsApp Business Account, cached, and
 * filled in by parameter key for sending. Free-form messages can only be
 * sent within 24 hours of the person's last message; outside that window
 * only an approved template can be sent.
 *
 * Template reference:
 * https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
 */

import { config } from "../config.js";
import { HttpError } from "../errors.js";
import * as graph from "../graph-api.js";
import { GraphApiError, type GraphTemplate } from "../graph-api.js";
import { logger } from "../logger.js";
import type { TemplateParameter, WhatsappTemplate } from "../types.js";

const CACHE_TTL_MS = 10 * 60 * 1000;

// Buttons that need no value when sending (a URL button may need one)
const SIMPLE_BUTTONS = new Set(["QUICK_REPLY", "URL", "PHONE_NUMBER"]);

type TemplateVariable = TemplateParameter & {
  // Variable name in the template text: "1", "2"... or a named variable
  name: string;
  // Button index, for URL button variables
  index?: number;
};

type TemplateEntry = {
  info: WhatsappTemplate;
  variables: TemplateVariable[];
  named: boolean;
};

let cache: { entries: TemplateEntry[]; fetched_at: number } | null = null;
let loading: Promise<TemplateEntry[]> | null = null;

// Variables in a template text, in the order they are sent: numeric order
// for {{1}}, {{2}}..., order of appearance for named ones.
function variablesIn(text: string | undefined, named: boolean) {
  const names = [...(text ?? "").matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map(
    (m) => m[1],
  );
  const unique = [...new Set(names)];
  return named ? unique : unique.sort((a, b) => Number(a) - Number(b));
}

function toEntry(t: GraphTemplate): TemplateEntry {
  const header = t.components.find((c) => c.type === "HEADER");
  const body = t.components.find((c) => c.type === "BODY");
  const footer = t.components.find((c) => c.type === "FOOTER");
  const buttons = t.components.find((c) => c.type === "BUTTONS")?.buttons ?? [];
  const named = t.parameter_format === "NAMED";

  const variables: TemplateVariable[] = [];
  let unsupported_reason: string | null = null;

  if (header?.format && header.format !== "TEXT") {
    unsupported_reason = `has a ${header.format.toLowerCase()} header`;
  } else if (header) {
    variablesIn(header.text, named).forEach((name, i) => {
      variables.push({
        key: "header",
        component: "header",
        name,
        example: named
          ? (header.example?.header_text_named_params?.find((p) => p.param_name === name)
              ?.example ?? null)
          : (header.example?.header_text?.[i] ?? null),
      });
    });
  }

  variablesIn(body?.text, named).forEach((name, i) => {
    variables.push({
      key: name,
      component: "body",
      name,
      example: named
        ? (body?.example?.body_text_named_params?.find((p) => p.param_name === name)
            ?.example ?? null)
        : (body?.example?.body_text?.[0]?.[i] ?? null),
    });
  });

  buttons.forEach((button, index) => {
    if (!SIMPLE_BUTTONS.has(button.type)) {
      unsupported_reason ??= `has a ${button.type.toLowerCase()} button`;
    } else if (button.type === "URL" && variablesIn(button.url, false).length) {
      variables.push({
        key: `button_${index}`,
        component: "button",
        name: "1",
        index,
        example: button.example?.[0] ?? null,
      });
    }
  });

  return {
    info: {
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      header: header ? (header.format === "TEXT" ? (header.text ?? "") : `[${header.format}]`) : null,
      body: body?.text ?? "",
      footer: footer?.text ?? null,
      buttons: buttons.map((b) => ({ type: b.type, text: b.text })),
      parameters: variables.map(({ key, component, example }) => ({ key, component, example })),
      supported: !unsupported_reason,
      unsupported_reason,
    },
    variables,
    named,
  };
}

async function loadEntries(refresh: boolean): Promise<TemplateEntry[]> {
  if (!config.businessAccountId) {
    throw new HttpError(
      503,
      "templates_not_configured",
      "Set WHATSAPP_WABA_ID to list and send templates by name",
    );
  }
  if (!refresh && cache && Date.now() - cache.fetched_at < CACHE_TTL_MS) {
    return cache.entries;
  }

  loading ??= graph
    .listTemplates(config.businessAccountId)
    .then((templates) => {
      const entries = templates.map(toEntry);
      cache = { entries, fetched_at: Date.now() };
      logger.log(`[whatsapp] loaded ${entries.length} message templates`);
      return entries;
    })
    .catch((err) => {
      if (!(err instanceof GraphApiError)) throw err;
      throw new HttpError(502, "whatsapp_api_error", `Could not list templates: ${err.message}`, {
        graph_code: err.code ?? null,
      });
    })
    .finally(() => {
      loading = null;
    });

  return loading;
}

async function listTemplates(options: { refresh?: boolean } = {}) {
  return (await loadEntries(!!options.refresh)).map((e) => e.info);
}

// An approved template by name, and language when it exists in several.
// Looks again at WhatsApp once, in case it was approved since the cache
// was filled.
async function findApprovedTemplate(name: string, language?: string) {
  const matching = (entries: TemplateEntry[]) =>
    entries.filter(
      (e) =>
        e.info.name === name &&
        e.info.status === "APPROVED" &&
        (!language || e.info.language === language),
    );

  let found = matching(await loadEntries(false));
  if (!found.length) found = matching(await loadEntries(true));

  if (!found.length) {
    throw new HttpError(
      400,
      "template_not_found",
      `No approved template '${name}'${language ? ` in language '${language}'` : ""}`,
    );
  }
  if (found.length > 1) {
    throw new HttpError(
      400,
      "template_language_required",
      `Template '${name}' exists in several languages (${found.map((e) => e.info.language).join(", ")}): pass the language`,
    );
  }

  return found[0];
}

// WhatsApp rejects template values with line breaks, tabs or more than four
// spaces in a row.
function toParameterText(value: unknown) {
  return String(value ?? "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\t/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim();
}

function fill(text: string, values: Map<string, string>) {
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name) => values.get(name) ?? match);
}

// The components to send for a template, and its text with the values
// filled in (for the chat history).
async function buildTemplateMessage(
  name: string,
  language: string | undefined,
  parameters: Record<string, string> = {},
) {
  const entry = await findApprovedTemplate(name, language);
  const { info, variables, named } = entry;

  if (!info.supported) {
    throw new HttpError(
      400,
      "template_not_supported",
      `Template '${name}' ${info.unsupported_reason}, which this service cannot fill in`,
    );
  }

  const keys = new Set(variables.map((v) => v.key));
  const unknown = Object.keys(parameters).filter((k) => !keys.has(k));
  const values = new Map(variables.map((v) => [v.key, toParameterText(parameters[v.key])]));
  const missing = variables.filter((v) => !values.get(v.key));

  if (missing.length || unknown.length) {
    const expected = variables
      .map((v) => `'${v.key}'${v.example ? ` (e.g. ${v.example})` : ""}`)
      .join(", ");
    throw new HttpError(
      400,
      "invalid_template_parameters",
      [
        missing.length ? `Missing: ${missing.map((v) => `'${v.key}'`).join(", ")}.` : "",
        unknown.length ? `Not in the template: ${unknown.map((k) => `'${k}'`).join(", ")}.` : "",
        `Template '${name}' takes ${expected || "no parameters"}.`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  const textParameter = (v: TemplateVariable) => ({
    type: "text",
    text: values.get(v.key) as string,
    ...(named && v.component !== "button" ? { parameter_name: v.name } : {}),
  });

  const components: unknown[] = [];
  const header = variables.filter((v) => v.component === "header");
  const body = variables.filter((v) => v.component === "body");
  if (header.length) components.push({ type: "header", parameters: header.map(textParameter) });
  if (body.length) components.push({ type: "body", parameters: body.map(textParameter) });
  for (const v of variables.filter((v) => v.component === "button")) {
    components.push({
      type: "button",
      sub_type: "url",
      index: String(v.index),
      parameters: [{ type: "text", text: values.get(v.key) }],
    });
  }

  // The header and the body each number their own {{1}}
  const header_values = new Map(header.map((v) => [v.name, values.get(v.key) as string]));
  const body_values = new Map(body.map((v) => [v.name, values.get(v.key) as string]));
  const quick_replies = info.buttons.filter((b) => b.type === "QUICK_REPLY").map((b) => b.text);
  const text = [
    info.header && !info.header.startsWith("[") ? fill(info.header, header_values) : null,
    fill(info.body, body_values),
    quick_replies.length ? `[buttons: ${quick_replies.join(" | ")}]` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return { language: info.language, components, text };
}

export { listTemplates, buildTemplateMessage };
