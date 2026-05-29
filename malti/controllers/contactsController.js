import * as Contact from "../models/ContactModel.js";
import { randomUUID } from "node:crypto";

export async function register(req, res) {
  const { contact_id, name, phone, email, city, contact_type, preferred_language, meta } = req.body;
  const id = contact_id ?? randomUUID();
  try {
    const contact = await Contact.upsertContact(id, { name, phone, email, city, contact_type, preferred_language, meta });
    return res.status(201).json({ success: true, contact });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function list(req, res) {
  const { owner, status, limit = 50 } = req.query;
  try {
    const contacts = await Contact.listContacts({ owner, status, limit: Number(limit) });
    return res.json({ success: true, contacts });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getOne(req, res) {
  try {
    const contact = await Contact.getContactById(req.params.contactId);
    if (!contact) return res.status(404).json({ success: false, error: "Contact not found" });
    return res.json({ success: true, contact });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function manageOwnership(req, res) {
  const { contactId } = req.params;
  const { action, owner, owner_type } = req.body;
  try {
    if (action === "assign") {
      if (!owner || !owner_type) return res.status(400).json({ success: false, error: "owner and owner_type required" });
      const lockCheck = await Contact.checkOwnershipLock(contactId, owner);
      if (!lockCheck.allowed) {
        return res.status(409).json({ success: false, error: `Locked by ${lockCheck.current_owner}` });
      }
      await Contact.assignOwnership(contactId, owner, owner_type);
    } else if (action === "release") {
      await Contact.releaseOwnership(contactId);
    } else {
      return res.status(400).json({ success: false, error: "action must be assign or release" });
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function requestHandoff(req, res) {
  const { contactId } = req.params;
  const { to_owner, to_type = "human", reason } = req.body;
  if (!to_owner) return res.status(400).json({ success: false, error: "to_owner required" });
  try {
    const contact = await Contact.getContactById(contactId);
    if (!contact) return res.status(404).json({ success: false, error: "Contact not found" });
    const handoffId = await Contact.requestHandoff(contactId, contact.current_owner, to_owner, to_type, reason);
    return res.status(201).json({ success: true, handoff_id: handoffId });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function completeHandoff(req, res) {
  const { contactId } = req.params;
  const { handoff_id, accepted } = req.body;
  if (handoff_id === undefined || accepted === undefined) {
    return res.status(400).json({ success: false, error: "handoff_id and accepted required" });
  }
  try {
    const result = await Contact.completeHandoff(handoff_id, !!accepted);
    if (!result) return res.status(404).json({ success: false, error: "Handoff not found" });
    return res.json({ success: true, result });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getPendingHandoffs(req, res) {
  const { for_owner } = req.query;
  try {
    const handoffs = await Contact.getPendingHandoffs(for_owner ?? null);
    return res.json({ success: true, handoffs });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getTimeline(req, res) {
  const { contactId } = req.params;
  const { limit = 50 } = req.query;
  try {
    const timeline = await Contact.getContactTimeline(contactId, Number(limit));
    return res.json({ success: true, timeline });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function addTimelineEvent(req, res) {
  const { contactId } = req.params;
  const { actor, actor_type, direction = "outbound", channel = "system", message_type = "message", text, extra } = req.body;
  if (!actor || !text) return res.status(400).json({ success: false, error: "actor and text required" });
  try {
    await Contact.addToTimeline(contactId, actor, actor_type ?? "system", direction, channel, message_type, text, extra);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}
