import { logger } from "../../madhavi/utils/logger.js";
import {
  getSlackChannel,
  type SlackChannelPurpose,
} from "../../madhavi/config/slack-channels.js";

const api_base_url = process.env.MADHAVI_WEBHOOK || "";

async function notifyCareManager(cm_id: number, message: string) {
  //   const response = await fetch(api_base_url as string, {
  //     method: "POST",
  //     headers: {
  //       "Content-Type": "application/json",
  //     },
  //     body: JSON.stringify({ cm_id, message }),
  //   });

  const response = await fetch(api_base_url, {
    method: "POST",
    body: JSON.stringify({ text: message }),
  });

  if (!response.ok) {
    return {
      status: "error",
      message: `Failed to notify care manager: ${response.status} ${response.statusText}`,
    };
  }

  return {
    status: "ok",
    message: "Care manager notified",
  };
}

const slack_api_url = "https://slack.com/api";

type SlackPostResult = {
  status: "ok" | "error";
  message: string;
  purpose?: SlackChannelPurpose;
  channel_id?: string;
  thread_ts?: string;
};

async function callSlackApi(
  method: string,
  init: { body?: Record<string, unknown>; query?: Record<string, string> },
) {
  const token = process.env.SLACK_BOT_TOKEN_MADHAVI;
  if (!token) throw new Error("Missing env var SLACK_BOT_TOKEN_MADHAVI");

  const url = new URL(`${slack_api_url}/${method}`);
  Object.entries(init.query ?? {}).forEach(([k, v]) =>
    url.searchParams.set(k, v),
  );

  const response = await fetch(url, {
    method: init.body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Slack ${method} failed: ${data.error ?? response.status}`);
  }
  return data;
}

// Posts to the purpose's channel through the Slack Web API so the message
// ts is returned and the thread can be linked to the user. Falls back to
// the incoming webhook (no thread tracking) when the bot token or channel
// id is not configured.
async function postToSlackChannel(
  purpose: SlackChannelPurpose,
  text: string,
  success_message: string,
): Promise<SlackPostResult> {
  const channel = getSlackChannel(purpose);

  if (channel?.channel_id && process.env.SLACK_BOT_TOKEN_MADHAVI) {
    try {
      const data = await callSlackApi("chat.postMessage", {
        body: { channel: channel.channel_id, text },
      });
      return {
        status: "ok",
        message: success_message,
        purpose,
        channel_id: data.channel,
        thread_ts: data.ts,
      };
    } catch (err: any) {
      logger.error("[postToSlackChannel]", err);
      return { status: "error", message: `Failed to message: ${err.message}` };
    }
  }

  const response = await fetch(channel?.webhook_url || api_base_url, {
    method: "POST",
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    return {
      status: "error",
      message: `Failed to message: ${response.status} ${response.statusText}`,
    };
  }

  return { status: "ok", message: success_message, purpose };
}

async function notifyMadhaviReport(message: string) {
  return postToSlackChannel("report", message, "Message sent");
}

async function notifyMissingInformation(message: string) {
  return postToSlackChannel(
    "suggestion",
    message,
    "Improvement or suggestion sent",
  );
}

// Posts a reply inside an existing Slack thread.
async function postSlackThreadReply(
  channel_id: string,
  thread_ts: string,
  text: string,
): Promise<SlackPostResult> {
  try {
    await callSlackApi("chat.postMessage", {
      body: { channel: channel_id, thread_ts, text },
    });
    return { status: "ok", message: "Posted in Slack thread" };
  } catch (err: any) {
    logger.error("[postSlackThreadReply]", err);
    return { status: "error", message: `Failed to message: ${err.message}` };
  }
}

// Reads every message of a Slack thread (paginated), oldest first.
async function readSlackThread(channel_id: string, thread_ts: string) {
  const messages: {
    from: "agent" | "care_team";
    user?: string;
    text: string;
    ts: string;
  }[] = [];
  let cursor: string | undefined;

  do {
    const data = await callSlackApi("conversations.replies", {
      query: {
        channel: channel_id,
        ts: thread_ts,
        limit: "200",
        ...(cursor ? { cursor } : {}),
      },
    });

    for (const m of data.messages ?? []) {
      messages.push({
        from: m.bot_id ? "agent" : "care_team",
        user: m.user,
        text: m.text ?? "",
        ts: m.ts,
      });
    }
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return messages;
}

export {
  notifyCareManager,
  notifyMadhaviReport,
  notifyMissingInformation,
  postToSlackChannel,
  postSlackThreadReply,
  readSlackThread,
};
