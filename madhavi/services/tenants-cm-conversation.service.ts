import { getChatMessages } from "./timelines.service.js";
import {
  upsertTenantsCmConversation,
  findTenantsCmConversationByCaregiverId,
  findTenantsCmConversationByChatId,
  deleteTenantsCmConversationByCaregiverId,
} from "../models/tenants_cm_conversation.model.js";

async function upsertTenantsCMChat({
  caregiver_id,
  chat_id,
}: {
  caregiver_id: number;
  chat_id: string;
}) {
  try {
    await upsertTenantsCmConversation({ caregiver_id, chat_id });

    return true;
  } catch (err) {
    console.log("[upsertTenantsCMChat]", err);
    return false;
  }
}

async function getTenantsCMChatByCaregiverId(caregiver_id: number) {
  try {
    const cm_chat = await findTenantsCmConversationByCaregiverId(caregiver_id);

    return cm_chat ?? null;
  } catch (err) {
    console.log("[getTenantsCMChatByCaregiverId]", err);
    return null;
  }
}

async function getTenantsCMChatByChatId(chat_id: string) {
  try {
    const cm_chat = await findTenantsCmConversationByChatId(chat_id);

    return cm_chat ?? null;
  } catch (err) {
    console.log("[getTenantsCMChatByChatId]", err);
    return null;
  }
}

async function getTenantsCMChatHistory(caregiver_id: number) {
  const record = await getTenantsCMChatByCaregiverId(caregiver_id);

  if (!record) {
    return [];
  }

  const chat_history = await getChatMessages(record.chat_id as string);

  return chat_history.slice(0, 20);
}

async function deleteTenantsCMChat(caregiver_id: number) {
  try {
    return await deleteTenantsCmConversationByCaregiverId(caregiver_id);
  } catch (err) {
    console.log("[deleteTenantsCMChat]", err);
    return false;
  }
}

export {
  upsertTenantsCMChat,
  getTenantsCMChatByCaregiverId,
  getTenantsCMChatByChatId,
  getTenantsCMChatHistory,
  deleteTenantsCMChat,
};
