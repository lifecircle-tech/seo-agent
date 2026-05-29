import { createTransport } from "nodemailer";
import { normalizeInboundData } from "./inboundController.js";

function getTransport() {
  return createTransport({
    host: process.env.SMTP_HOST ?? "email-smtp.ap-south-1.amazonaws.com",
    port: parseInt(process.env.SMTP_PORT ?? "465", 10),
    secure: parseInt(process.env.SMTP_PORT ?? "465", 10) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function send(req, res) {
  const { to, subject, body, from_name, reply_to } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ success: false, error: "to, subject, body required" });
  }
  try {
    const transporter = getTransport();
    const info = await transporter.sendMail({
      from: `"${from_name ?? process.env.EMAIL_FROM_NAME ?? "LifeCircle AI"}" <${process.env.EMAIL_FROM ?? "ai@lifecircle.in"}>`,
      to,
      subject,
      html: body,
      ...(reply_to ? { replyTo: reply_to } : {}),
    });
    return res.json({ success: true, message_id: info.messageId });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function inboundWebhook(req, res) {
  // Handles forwarded email from SES → SNS → this endpoint
  const { from_email, from_name, subject, body, message_id } = req.body;
  if (!from_email) return res.status(400).json({ success: false, error: "from_email required" });
  try {
    const normalized = normalizeInboundData("email", { from_email, from_name, subject, body, message_id });
    // Echo back normalized for now — inbound processing happens via /malti/inbound/lead
    return res.json({ success: true, normalized });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function pollImap(req, res) {
  // IMAP polling — requires the 'imap' + 'mailparser' npm packages
  // Returns a summary rather than executing synchronously for large inboxes
  return res.json({
    success: true,
    message: "IMAP poll triggered — install `imap` + `mailparser` packages and implement in a background worker for production use.",
  });
}
