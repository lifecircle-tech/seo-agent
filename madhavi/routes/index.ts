import { Router } from "express";
import tenantRoutes from "./tenant.routes.js";
import employeeRoutes from "./employee.routes.js";
import caregiverRoutes from "./caregiver.routes.js";
import credentialsRoutes from "./credentials.routes.js";
import agentRoutes from "./agent.routes.js";
import agentPromptRoutes from "./agent_prompt.routes.js";
import tenantAgentPromptRoutes from "./tenant_agent_prompt.routes.js";
import tenantAgentToolAccessRoutes from "./tenant_agent_tool_access.routes.js";
import tenantAgentTokensUsageRoutes from "./tenant_agent_tokens_usage.routes.js";
import mcpToolsRoutes from "./mcp_tools.routes.js";

// Note: only the active-tools list is exposed for mcp_tools by design.
const router = Router();

router.use("/tenants", tenantRoutes);
router.use("/employees", employeeRoutes);
router.use("/caregivers", caregiverRoutes);
router.use("/credentials", credentialsRoutes);
router.use("/agents", agentRoutes);
router.use("/agent-prompts", agentPromptRoutes);
router.use("/tenant-agent-prompts", tenantAgentPromptRoutes);
router.use("/tenant-agent-tool-access", tenantAgentToolAccessRoutes);
router.use("/tenant-agent-tokens-usage", tenantAgentTokensUsageRoutes);
router.use("/mcp-tools", mcpToolsRoutes);

export default router;
