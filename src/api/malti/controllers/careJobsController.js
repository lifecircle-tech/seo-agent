import * as CareJobs from "../models/CareJobsModel.js";
import { sendWhatsAppTemplate } from "./whatsappController.js";

export async function getLeads(req, res) {
  const { limit = 10 } = req.query;
  try {
    const leads = await CareJobs.getPendingLeads(Number(limit));
    return res.json({ success: true, leads });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getOneLead(req, res) {
  try {
    const lead = await CareJobs.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, error: "Lead not found" });
    return res.json({ success: true, lead });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function updateLead(req, res) {
  try {
    await CareJobs.updateLeadCallStatus(req.params.id, req.body);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function getStats(req, res) {
  try {
    const stats = await CareJobs.getLeadStats();
    return res.json({ success: true, stats });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function logBolnaActivity(req, res) {
  try {
    const id = await CareJobs.logBolnaActivity(req.body);
    return res.status(201).json({ success: true, id });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function updateBolnaActivity(req, res) {
  try {
    await CareJobs.updateBolnaActivity(req.params.executionId, req.body);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function sendWhatsAppFallback(req, res) {
  try {
    const lead = await CareJobs.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, error: "Lead not found" });

    const template = process.env.CARE_JOBS_WHATSAPP_TEMPLATE ?? "care_jobs_app_download";
    const result = await sendWhatsAppTemplate(lead.phone, template, [lead.name ?? "there"]);
    await CareJobs.updateLeadCallStatus(req.params.id, { whatsapp_sent: 1 });
    return res.json({ success: result.ok, whatsapp_result: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}
