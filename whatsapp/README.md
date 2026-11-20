# WhatsApp service

Sends and receives WhatsApp messages through the **WhatsApp Business Platform (Cloud API)**. It replaces the Timelines API.

It runs as its own process, separate from `server.ts`, and has its own MySQL database. Other services (Madhavi, the MCP tools) call it over HTTP, using `whatsapp/client.ts`.

```
WhatsApp ──webhook──▶ POST /webhook ──▶ wa_messages / wa_media (+ files on disk)
                                     └─▶ POST each WHATSAPP_FORWARD_WEBHOOK_URLS (e.g. Madhavi /digital-manager)
Madhavi / MCP ──x-internal-token──▶ /messages, /chats, /media ──▶ Graph API
```

The Cloud API has **no endpoint for reading chat history**. This service stores every message it receives (via the webhook) and every message it sends, and serves the history from that store.

## Setup

1. **Meta app.** Create a Business app at developers.facebook.com and add the WhatsApp product. Then register the business phone number.
2. **Access token.** In Business Settings, create a **system user** and give it the WhatsApp Business Account. Generate a permanent token with `whatsapp_business_messaging` and `whatsapp_business_management`. Don't use the 24-hour test token in production.
3. **Environment.** Set these (see `.env.example`):

   | Variable | Where it comes from |
   |---|---|
   | `WHATSAPP_ACCESS_TOKEN` | Step 2 |
   | `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp → API setup. This is the *Phone number ID*, not the phone number. |
   | `WHATSAPP_APP_SECRET` | App settings → Basic → App secret |
   | `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Any long random string |
   | `INTERNAL_API_TOKEN` | Already used by this repo. Callers send it as `x-internal-token`. |
   | `WHATSAPP_DATABASE_URL` | MySQL database for this service (default `mysql://root:@localhost:3306/whatsapp`) |
   | `WHATSAPP_FORWARD_WEBHOOK_URLS` | Where to POST received messages, comma-separated |
   | `WHATSAPP_WABA_ID` | WhatsApp → API setup → *WhatsApp Business Account ID*. Needed to list templates and send them by name. |
   | `WHATSAPP_PORT`, `WHATSAPP_MEDIA_DIR`, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_ENFORCE_SESSION_WINDOW` | Optional |

   The service refuses to start if any of the first four, or `INTERNAL_API_TOKEN`, is missing.

4. **Database.** Run `migrations/004_whatsapp.sql`. Alternatively, let the service create the tables on startup; set `DB_AUTO_INIT=false` to skip that.
5. **Run.** Use `npm run dev:whatsapp` (from source) or `npm run build && npm run start:whatsapp`.
6. **Webhook.** In WhatsApp → Configuration, set the callback URL to `https://<public host>/webhook` and use the same verify token. Subscribe to the **messages** field. The URL must be public HTTPS; for local testing use a tunnel such as ngrok.

## API

Every endpoint except `/webhook` and `/health` requires the `x-internal-token` header. Responses use the form `{ success: true, data }` or `{ success: false, code, error, details }`.

A `chat_id` is the person's WhatsApp number in digits, e.g. `919876543210`. Any endpoint that takes a `chat_id` also accepts `+919876543210`.

### Send: `POST /messages`

```jsonc
{ "to": "+919876543210", "type": "text", "text": "Hello", "reply_to": "wamid..." }   // reply_to optional
{ "to": "+91...", "type": "document", "media_id": "123", "filename": "offer.pdf", "caption": "Your offer" }
{ "to": "+91...", "type": "image", "link": "https://example.com/a.jpg", "caption": "..." }  // image|video|audio|document|sticker
{ "to": "+91...", "type": "template",
  "template": { "name": "caregiver_check_in", "parameters": { "1": "Ravi ji" } } }   // by parameter key, see Templates
{ "to": "+91...", "type": "template",
  "template": { "name": "care_jobs_app_download", "language": "en",
                "components": [{ "type": "body", "parameters": [{ "type": "text", "text": "Ravi" }] }] } }  // raw components
```

A successful send returns `201 { chat_id, message_id, wamid, status: "accepted" }`. The message's status then moves through `sent`, `delivered` and `read` as WhatsApp reports it (or ends at `failed`).

| Code | Status | Meaning |
|---|---|---|
| `invalid_phone` | 400 | `to` must be `+` followed by the country code and number |
| `invalid_message` | 400 | Bad body |
| `outside_session_window` | 409 | The person hasn't messaged in the last 24 hours. WhatsApp only allows **template** messages then. |
| `template_not_found`, `template_language_required`, `template_not_supported`, `invalid_template_parameters` | 400 | The template by name can't be sent as asked; the error says why, including the parameters it expects |
| `templates_not_configured` | 503 | `WHATSAPP_WABA_ID` isn't set |
| `whatsapp_api_error` | 502 | WhatsApp rejected the message. `details.graph_code` holds the [Cloud API error code](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes). |

Other endpoints:

- `POST /messages/:wamid/read` with body `{ "typing": true }`: shows blue ticks to the person. With `typing`, it also shows "typing…" until the reply is sent (at most 25 s).

### Templates

Outside the 24-hour window, only approved templates can be sent.

`GET /templates` lists every template in the WhatsApp Business Account, with its status. The list is cached for 10 minutes; `?refresh=true` reads it again from WhatsApp. Each template has:

- `name`, `language`, `category`, `status`
- `header`, `body`, `footer`, `buttons`
- `parameters`: the values it needs. Each one has a `key`, the `component` it belongs to (`header`, `body` or `button`), and Meta's `example`.
- `supported`: `false` for templates the service can't fill in (media headers, copy-code, flow or OTP buttons). `unsupported_reason` says why.

The parameter keys are:

| Key | Variable |
|---|---|
| `"1"`, `"2"`, … | Body `{{1}}`, `{{2}}`, … |
| The variable's name, e.g. `"first_name"` | A body variable in a template with named parameters |
| `"header"` | The header's variable |
| `"button_<index>"` | The variable in a URL button |

**Sending by name** (`template.parameters`):
- The service checks the values against the template. It reports missing or unknown keys, together with the keys the template expects.
- It builds the Cloud API components for you.
- Values are flattened to one line, since WhatsApp rejects line breaks in template values.
- The history stores the filled-in text, e.g. `[template: caregiver_check_in]` followed by the message. Agents therefore see what was actually sent.

### History

- `GET /chats?limit=50&offset=0`: chats, most recently active first.
- `GET /chats/:chat_id`: one chat, including `session_open` and `session_expires_at` (the 24-hour window).
- `GET /chats/:chat_id/messages?limit=20&before=<next_cursor>`: messages, **newest first**.
  - Each message has `direction`, `from_me`, `type`, `status`, `timestamp`, `media` and `raw` (the original WhatsApp object).
  - It also has `text`, which for non-text messages is a short description such as `[document: aadhaar.pdf] my ID`, `[voice message]` or `[location: …]`.

### Files

- **Received files are downloaded automatically.** When a message with media arrives, the file is saved under `WHATSAPP_MEDIA_DIR`. WhatsApp's download links expire after 5 minutes.
- `GET /media/:media_id` returns the file. If the background download hasn't finished or failed, the file is fetched on demand.
- `POST /media?filename=offer.pdf` uploads a file to send. The body is the raw file, with `Content-Type` set to its MIME type. It returns `{ media_id }`, which you pass to `POST /messages`. A copy is kept so the history can serve it.

### Events sent to `WHATSAPP_FORWARD_WEBHOOK_URLS`

Events are POSTed with the `x-internal-token` header. Failed deliveries are retried for about a minute.

```jsonc
{ "event_type": "message:received:new",
  "chat": { "chat_id": "919876543210", "phone": "+919876543210", "name": "Ravi", "is_group": false },
  "message": { /* same shape as in /chats/:chat_id/messages */ } }

{ "event_type": "message:status:updated",
  "chat": { ... },
  "status": { "wamid": "...", "status": "delivered", "timestamp": "...", "error": null } }
```

`message:received:new` keeps the field names Timelines used (`event_type`, `chat.chat_id`, `chat.phone`, `chat.is_group`). Madhavi's `/digital-manager` handler can therefore receive it unchanged.

WhatsApp retries webhooks until it gets a 200, so the service stores messages by `wamid` and forwards each one only once.

## Client

```ts
import { whatsapp, WhatsappServiceError } from "../whatsapp/client";

await whatsapp.sendText("+919876543210", "Hello");
await whatsapp.sendTemplate("+919876543210", "care_jobs_app_download", "en", components);
const { media_id } = await whatsapp.uploadMedia(pdfBuffer, "application/pdf", "offer.pdf");
await whatsapp.sendDocument("+919876543210", { media_id, filename: "offer.pdf" });
const { messages } = await whatsapp.getChatMessages("919876543210", { limit: 20 });
const { data } = await whatsapp.downloadMedia(messages[0].media!.media_id);
```

Set `WHATSAPP_SERVICE_URL` (default `http://localhost:3003`) and `INTERNAL_API_TOKEN` in the caller's environment.

## Madhavi

Madhavi and the MCP tools use the service through `MCPs/services/whatsapp.service.ts`, which replaced `timelines.service.ts`. It keeps the Timelines function shapes:
- `getChatMessages(chat_id)` returns history newest first, as `{ timestamp, sender: "madhavi" | "caregiver", message }`.
- `sendMessage(phone, text)` returns `{ status, message, chat_id, message_id }`.

How it behaves:

- **The 24-hour window: the agent picks a template.**
  - When the window is closed, `send_whatsapp_message` tells the agent to use a template.
  - The agent calls `list_whatsapp_templates`, which returns the approved templates, their text and the parameters each needs.
  - It then sends the one that fits with `send_whatsapp_template`, filling the parameters from facts it has.
  - The recruitment tools `contact_caregiver_for_booking` and `message_booking_caregiver` take a `template` instead of `message` for the same case.
  - Instructions for this are in code: `WHATSAPP_TEMPLATE_PROMPT` in `lc-orchestrator.ts`, plus the recruitment prompt in `lc-slack-agent.ts`.
  - Weekly check-ins go straight to a template, since the window is almost always closed by then.
  - Any agent that has `send_whatsapp_message` gets both template tools automatically.
  - Pending care-team replies from Slack stay pending after a template, because a template's fixed text doesn't carry them.
- **Received messages** reach `/digital-manager`, which only accepts events carrying the `x-internal-token` the service sends.
- **Chat ids.** `life_digital_cm_conversation.wa_chat_id` holds the WhatsApp chat id (the caregiver's WhatsApp number) and is used for every operation. `chat_id` keeps the old Timelines id. See `migrations/005_madhavi_wa_chat_id.sql`.
- **History from before the switch** stays in Timelines and isn't copied here. Agents only see messages from the switch onwards.
- **Undelivered messages** (status `failed`) are left out of the history the agents see.
- **Moving the number.** If `+919154241774` is used in the WhatsApp Business app or with another provider, it has to be migrated to the Cloud API, or onboarded in coexistence mode, before it can be used here.
