export default async function handler(req, res) {
  const setupKey = String(req.query?.key || "");
  if (setupKey !== "ANP_SETUP_7f4c91b2e6a84d3d") {
    return res.status(404).json({ ok: false });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) {
    return res.status(500).json({ ok: false, error: "TELEGRAM_BOT_TOKEN missing" });
  }

  const webhookUrl = "https://project-akmpg.vercel.app/api/telegram-webhook";

  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ["message"],
      drop_pending_updates: true
    })
  });

  const data = await response.json();
  return res.status(response.ok ? 200 : 502).json({
    ok: Boolean(data.ok),
    description: data.description || null,
    webhook: webhookUrl
  });
}
