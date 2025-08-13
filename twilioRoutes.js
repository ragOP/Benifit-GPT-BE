// twilioRoutes.js
const express = require("express");

const router = express.Router();

// --- Basic input validation ---
function isE164(num) {
  // +1234567890 ... 8 to 15 digits
  return typeof num === "string" && /^\+?\d{8,15}$/.test(num);
}

// Twilio client (uses server-side secrets)
function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error("Twilio credentials missing. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env");
  }
  return require("twilio")(sid, token);
}

/**
 * POST /api/notify/sms
 * Body: { "to": "+1XXXXXXXXXX", "message": "Hi hello how are you" }
 * Returns: { ok: true, sid: "<twilio-message-sid>" }
 */
router.post("/sms", async (req, res) => {
  try {
    const { to, message } = req.body || {};
    if (!to) return res.status(400).json({ ok: false, error: "`to` is required" });
    if (!isE164(to)) return res.status(400).json({ ok: false, error: "Invalid `to` phone number format" });

    const body = message && String(message).trim().length > 0
      ? String(message).trim()
      : "Hi hello how are you"; // default text

    const from = process.env.TWILIO_FROM;
    if (!from) return res.status(500).json({ ok: false, error: "TWILIO_FROM not configured on server" });

    const twilioClient = getTwilioClient();
    const msg = await twilioClient.messages.create({ to, from, body });

    return res.status(200).json({ ok: true, sid: msg.sid });
  } catch (err) {
    console.error("Twilio SMS error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "sms_failed", detail: err?.message || String(err) });
  }
});

module.exports = router;
