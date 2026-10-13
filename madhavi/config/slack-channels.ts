// Slack channel map: which channel each Slack tool posts to, and what the
// agent does when an employee replies in one of its threads.
//
// To add a channel:
//   1. add a purpose + entry below,
//   2. point an MCP tool at it with postToSlackChannel(purpose, ...)
//      (MCPs/services/slack.service.ts),
//   3. add the tool name to SLACK_TOOL_PURPOSE so the orchestrator records
//      the thread against the user.

export type SlackChannelPurpose = "report" | "suggestion";

export interface SlackChannelConfig {
  purpose: SlackChannelPurpose;
  description: string;
  // Slack channel ID (C...). Required for thread tracking; without it the
  // tool posts through the webhook and replies cannot be linked to a user.
  channel_id?: string;
  // Legacy incoming webhook, used only when channel_id / bot token is unset.
  webhook_url?: string;
  // Employee replies in this channel's threads are relayed to the end user.
  // When false, replies are stored as internal context only.
  relay_to_user: boolean;
  // Agent that handles replies. Defaults to the agent that opened the thread.
  handler_agent_key?: string;
}

function channels(): Record<SlackChannelPurpose, SlackChannelConfig> {
  return {
    report: {
      purpose: "report",
      description: "User concerns and emergency reports for the care team",
      channel_id: process.env.MADHAVI_REPORT_CHANNEL_ID,
      webhook_url: process.env.MADHAVI_REPORT,
      relay_to_user: true,
    },
    suggestion: {
      purpose: "suggestion",
      description: "Missing information, suggestions and tool errors",
      channel_id: process.env.MADHAVI_SUGGESTION_CHANNEL_ID,
      webhook_url: process.env.MADHAVI_SUGGESTION,
      relay_to_user: false,
    },
    // Template for a channel handled by a specific agent:
    // outreach: {
    //   purpose: "outreach",
    //   description: "Care team reaching out to the user about a concern",
    //   channel_id: process.env.MADHAVI_OUTREACH_CHANNEL_ID,
    //   relay_to_user: true,
    //   handler_agent_key: "welfare_manager",
    // },
  };
}

// MCP tool name -> channel purpose it posts to.
export const SLACK_TOOL_PURPOSE: Record<string, SlackChannelPurpose> = {
  report_to_slack: "report",
  ask_missing_in_slack: "suggestion",
};

export function getSlackChannel(purpose: string): SlackChannelConfig | null {
  return channels()[purpose as SlackChannelPurpose] ?? null;
}

// Agent channels: every @mention of the bot in these channels runs one
// dedicated agent directly (no user / thread record needed), and the
// agent's answer is posted back in the Slack thread.
export interface SlackAgentChannelConfig {
  key: string;
  description: string;
  channel_id?: string;
  // `agent.key` of the agent that handles every mention in this channel.
  agent_key: string;
  // MCP tools added on top of the agent's tools granted in the database.
  tools?: string[];
}

function agentChannels(): SlackAgentChannelConfig[] {
  return [
    {
      key: "caregiver_search",
      description: "Employees ask to search caregivers",
      channel_id: "GF0UMPNBD",
      agent_key: "Search_placement_manager",
    },
  ];
}

export function getSlackAgentChannel(
  channel_id: string,
): SlackAgentChannelConfig | null {
  return agentChannels().find((c) => c.channel_id === channel_id) ?? null;
}
