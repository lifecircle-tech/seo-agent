import { ensureCampaignTables } from "./models/CampaignModel.js";
import { ensureContactTables }  from "./models/ContactModel.js";
import { ensureAgentTables }    from "./models/AgentModel.js";
import router                   from "./routes/index.js";

export { router as maltiRouter };

export async function initMalti() {
  await Promise.all([
    ensureCampaignTables(),
    ensureContactTables(),
    ensureAgentTables(),
  ]);
  console.log("[malti] tables ready");
}
