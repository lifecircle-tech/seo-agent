const INTERAKT_API_URL = "https://api.interakt.ai/v1/public/message/";

export async function sendWhatsAppTemplate(phone, templateName, bodyValues = [], callbackData = null) {
  const apiKey = process.env.INTERAKT_API_KEY;
  if (!apiKey) throw new Error("INTERAKT_API_KEY not set");

  // Normalise phone: strip leading 0, ensure no country code prefix for Interakt
  const cleanPhone = phone.replace(/^\+91/, "").replace(/^0/, "").replace(/\D/g, "");

  const payload = {
    countryCode: "+91",
    phoneNumber: cleanPhone,
    type: "Template",
    template: {
      name: templateName,
      languageCode: "en",
      bodyValues,
    },
  };
  if (callbackData) payload.callbackData = callbackData;

  const response = await fetch(INTERAKT_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${Buffer.from(apiKey).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

// Express handler
export async function send(req, res) {
  const { phone, template_name, body_values = [] } = req.body;
  if (!phone || !template_name) {
    return res.status(400).json({ success: false, error: "phone and template_name required" });
  }
  try {
    const result = await sendWhatsAppTemplate(phone, template_name, body_values);
    return res.json({ success: result.ok, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}
