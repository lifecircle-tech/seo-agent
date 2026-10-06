import type Anthropic from "@anthropic-ai/sdk";
import { findAgentToolAccesses } from "../models/agent_tool_access.model";
import { findTenantsAgents } from "../models/tenant.model";
import { findAgentDocumentsAccessesWithContent } from "../models/agent_documents_access.model";
import { findAgentSkillsAccessesWithContent } from "../models/agent_skills_access.model";

// Document/skill tools aren't registered on the MCP server - each entry
// below carries its own `content` right alongside the Anthropic tool
// definition, so a caller can build an exact name -> content lookup for
// this request instead of having to re-derive it from the tool name later
// (doc/skill names aren't unique and don't follow any fixed naming scheme).
interface AgentCallableToolDefinition {
  tool: Anthropic.Tool;
  content: string | null;
}

async function getTenantsAccessedAgent({ tenant_id }: { tenant_id: number }) {
  const agents_list = await findTenantsAgents(String(tenant_id));

  const agents = agents_list.map((agent) => ({
    name: agent.name,
    key: agent.key,
    description: agent.description,
  }));

  return agents;
}

async function getAgentTools({ agent_id }: { agent_id: number }) {
  const tool_list = await findAgentToolAccesses({ agent_id });
  const tools = tool_list.map((t) => t.name);

  return tools;
}

async function getAgentDocuments({ agent_id }: { agent_id: number | string }) {
  const docs = await findAgentDocumentsAccessesWithContent(agent_id);

  return docs
    .filter((doc) => doc.active)
    .map((doc) => ({
      doc_id: doc.doc_id as number,
      name: doc.doc_name as string,
      description: doc.description as string | null,
      content: doc.content as string | null,
    }));
}

async function getAgentSkills({ agent_id }: { agent_id: number | string }) {
  const skills = await findAgentSkillsAccessesWithContent(agent_id);

  return skills
    .filter((skill) => skill.active)
    .map((skill) => ({
      skill_id: skill.skill_id as number,
      name: skill.skill_name as string,
      description: skill.description as string | null,
      content: skill.content as string | null,
    }));
}

// Builds synthetic Anthropic tool definitions for the documents an agent
// has access to, pairing each with its content so the caller can build its
// own name -> content lookup without having to parse the tool name.
async function getAgentDocumentTools({
  agent_id,
}: {
  agent_id: number | string;
}): Promise<AgentCallableToolDefinition[]> {
  const documents = await getAgentDocuments({ agent_id });

  return documents.map((doc) => ({
    tool: {
      name: `document_tool_${doc.doc_id}`,
      description: `Reference document: "${doc.name}".${
        doc.description ? ` ${doc.description}` : ""
      } Call this tool only when the conversation needs information from this specific document.`,
      input_schema: { type: "object", properties: {} },
    },
    content: doc.content,
  }));
}

// Same as getAgentDocumentTools, for the skills an agent has access to.
async function getAgentSkillTools({
  agent_id,
}: {
  agent_id: number | string;
}): Promise<AgentCallableToolDefinition[]> {
  const skills = await getAgentSkills({ agent_id });

  return skills.map((skill) => ({
    tool: {
      name: `skill_tool_${skill.skill_id}`,
      description: `Skill guide: "${skill.name}".${
        skill.description ? ` ${skill.description}` : ""
      } Call this tool only when the conversation needs to follow this specific skill's instructions.`,
      input_schema: { type: "object", properties: {} },
    },
    content: skill.content,
  }));
}

export {
  getTenantsAccessedAgent,
  getAgentTools,
  getAgentDocuments,
  getAgentSkills,
  getAgentDocumentTools,
  getAgentSkillTools,
};
