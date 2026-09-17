import { getChatMessages } from "./timelines.service";
import {
  getDigitalCMChatByChatId,
  getDigitalCMChatByHpUniqueId,
  insertDigitalCMChat,
} from "../models/lc-cm-conversation.model";

async function upsertCMChat({
  cg_id,
  chat_id,
}: {
  cg_id: number;
  chat_id: string;
}) {
  try {
    await insertDigitalCMChat({ cg_id, chat_id });

    return true;
  } catch (err) {
    console.log("[upsertCMChat]", err);
    return false;
  }
}

async function getCMChatByHpUniqueId(cg_id: number) {
  try {
    const cm_chat = await getDigitalCMChatByHpUniqueId(cg_id);

    return cm_chat ?? null;
  } catch (err) {
    console.log("[getCMChatByHpUniqueId]", err);
    return null;
  }
}

async function getCMChatByChatId(chat_id: string) {
  try {
    const cm_chat = await getDigitalCMChatByChatId(chat_id);

    return cm_chat ?? null;
  } catch (err) {
    console.log("[getCMChatByChatId]", err);
    return null;
  }
}

async function getCMChatHistory(cg_id: number) {
  const record = await getCMChatByHpUniqueId(cg_id);

  if (!record) {
    return [];
  }

  const chat_history = await getChatMessages(record.chat_id as string);

  return chat_history.slice(0, 20);
}

export {
  upsertCMChat,
  getCMChatByHpUniqueId,
  getCMChatByChatId,
  getCMChatHistory,
};
