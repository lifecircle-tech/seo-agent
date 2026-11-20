import { getChatMessages } from "../../MCPs/services/whatsapp.service";
import { logger } from "../utils/logger";
import {
  getCaregiverHpUniqueIdByPhone,
  getCaregiverPhoneByHpUniqueId,
} from "../models/lc-caregivers.model";
import {
  getDigitalCMChatByHpUniqueId,
  getDigitalCMChatByWaChatId,
  getDigitalCMChatsWithoutWaChatId,
  insertDigitalCMChat,
  setDigitalCMWaChatId,
} from "../models/lc-cm-conversation.model";

// A caregiver's WhatsApp chat id is their WhatsApp number in digits with
// country code. Phones are stored with or without the country code.
function toWaChatId(phone: string | null | undefined) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const wa_chat_id = digits.length === 10 ? `91${digits}` : digits;
  return /^\d{11,15}$/.test(wa_chat_id) ? wa_chat_id : null;
}

// Records that the agent messaged the caregiver on this WhatsApp chat.
async function upsertCMChat({
  cg_id,
  wa_chat_id,
}: {
  cg_id: number;
  wa_chat_id: string;
}) {
  try {
    await insertDigitalCMChat({ cg_id, wa_chat_id });

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

async function getCMChatByWaChatId(wa_chat_id: string) {
  try {
    const cm_chat = await getDigitalCMChatByWaChatId(wa_chat_id);

    return cm_chat ?? null;
  } catch (err) {
    console.log("[getCMChatByWaChatId]", err);
    return null;
  }
}

// The conversation for a message received on a WhatsApp chat. A
// conversation without this WhatsApp chat id yet (started on Timelines, or
// the caregiver's number changed) is found by the caregiver's phone and
// given it. Throws on a database error.
async function findCMChatForWhatsappMessage(wa_chat_id: string, phone: string) {
  const cm_chat = await getDigitalCMChatByWaChatId(wa_chat_id);
  if (cm_chat) return cm_chat;

  const hp_unique_id = await getCaregiverHpUniqueIdByPhone(phone);
  const by_caregiver = hp_unique_id
    ? await getDigitalCMChatByHpUniqueId(hp_unique_id)
    : undefined;
  if (!by_caregiver) return null;

  await setDigitalCMWaChatId({ cg_id: by_caregiver.hp_unique_id, wa_chat_id });
  logger.log(
    `[cm-conversation] hp ${by_caregiver.hp_unique_id}: wa_chat_id ${by_caregiver.wa_chat_id ?? "-"} → ${wa_chat_id} (Timelines chat ${by_caregiver.chat_id ?? "-"})`,
  );

  return { ...by_caregiver, wa_chat_id };
}

// Gives every conversation without a WhatsApp chat id one, from the
// caregiver's phone. The Timelines chat_id is left as it is. Runs when
// Madhavi starts; a no-op once all conversations have one.
async function migrateCMChatsToWhatsapp() {
  const pending = await getDigitalCMChatsWithoutWaChatId();
  if (pending.length === 0) return;

  let migrated = 0;
  const no_phone: number[] = [];

  for (const cm_chat of pending) {
    try {
      const phone = await getCaregiverPhoneByHpUniqueId(cm_chat.hp_unique_id);
      const wa_chat_id = toWaChatId(phone);
      if (!wa_chat_id) {
        no_phone.push(cm_chat.hp_unique_id);
        continue;
      }

      await setDigitalCMWaChatId({ cg_id: cm_chat.hp_unique_id, wa_chat_id });
      migrated++;
    } catch (err) {
      logger.error(`[cm-conversation] hp ${cm_chat.hp_unique_id} not migrated`, err);
    }
  }

  logger.log(
    `[cm-conversation] WhatsApp chat id set for ${migrated} of ${pending.length} conversations`,
  );
  if (no_phone.length) {
    logger.warn(
      `[cm-conversation] no valid phone, left without WhatsApp chat id: hp ${no_phone.join(", ")}`,
    );
  }
}

async function getCMChatHistory(cg_id: number) {
  const record = await getCMChatByHpUniqueId(cg_id);

  if (!record?.wa_chat_id) {
    return [];
  }

  const chat_history = await getChatMessages(record.wa_chat_id);

  return chat_history.slice(0, 20);
}

export {
  upsertCMChat,
  getCMChatByHpUniqueId,
  getCMChatByWaChatId,
  findCMChatForWhatsappMessage,
  migrateCMChatsToWhatsapp,
  getCMChatHistory,
};
