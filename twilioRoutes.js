const express = require("express");
const router = express.Router();
const twilio = require("twilio");

const accountSid = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

router.post("/sms", async (req, res) => {
  try {
    const { to, message, fullName, userId } = req.body;

    if (!to) {
      return res.status(400).json({
        error: "to is required",
        hint: 'Send JSON with { "to": "+13322097232" }',
        received: req.body,
      });
    }

    const msg = await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER, // your Twilio number
      to,
      body:
        message ||
        `🎉 Hey ${fullName || "User"}! You are eligible for benefits. Visit: https://mybenefitsai.org/claim/${userId}`,
    });

    res.json({ success: true, sid: msg.sid });
  } catch (err) {
    console.error("Twilio send error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
