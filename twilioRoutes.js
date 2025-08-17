// twilioRoutes.js
const express = require("express");
const router = express.Router();
const twilio = require("twilio");

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

const client = twilio(accountSid, authToken);

router.post("/sms", async (req, res) => {
  try {
    const { to, message } = req.body;

    if (!to) {
      return res.status(400).json({
        error: "to is required",
        hint: 'Send JSON with { "to": "+13322097232", "message": "hello" }',
        received: req.body || null,
      });
    }

    const sms = await client.messages.create({
      to,
      body: message || "Hello from Benefits Bot 🎉",
      messagingServiceSid,
    });

    res.json({
      success: true,
      sid: sms.sid,
      to,
      message: sms.body,
    });
  } catch (err) {
    console.error("Twilio SMS error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
