const express = require("express");
const axios = require("axios");
const app = express();
const Stripe = require("stripe");
require("dotenv").config();

const PORT = process.env.PORT || 9005;
const cors = require("cors");

const UserResponse = require("./userResponse");
const ChatbotResponse = require("./ChatbotResponse");
const { connectToDatabase } = require("./db");
const Email = require("./email");
const Response = require("./response");
const Response2 = require("./response2");
const Response3 = require("./response3");
const TrustedFormCert = require("./trustedFormCert");

// NEW: persist tab progress
const ProgressState = require("./progressState");
const SmsLog = require("./smsLog");

// ---------- Twilio (for /notify/sms in this file) ----------
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN  || "";
const TWILIO_FROM        = process.env.TWILIO_FROM        || ""; // e.g. +12345551234
const twilioEnabled = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM;

let twilioClient = null;
if (twilioEnabled) {
  const twilio = require("twilio");
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

/* -------------------- ORDER OF MIDDLEWARE MATTERS -------------------- */
// Stripe webhook must read raw body
app.use("/webhook", express.raw({ type: "application/json" }));

// JSON/body & CORS for everything else (MUST be before routes)
app.use(express.json());
app.use(cors());

// Mount external Twilio router under /api/notify (this one expects JSON too)
const twilioRoutes = require("./twilioRoutes");
app.use("/api/notify", twilioRoutes);
/* -------------------------------------------------------------------- */

(async () => {
  await connectToDatabase();
})();

/* ---------------------- helpers for /notify/sms ---------------------- */
function parseJsonBody(req) {
  if (req && typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}

function pickToField(body) {
  return body.to || body.phone || body.number || body.mobile || null;
}

function normalizeUS(to) {
  if (!to) return null;
  let s = String(to).trim();
  if (s.startsWith("+")) return s;
  s = s.replace(/\D+/g, "");
  if (s.length === 11 && s.startsWith("1")) return "+" + s;
  if (s.length === 10) return "+1" + s;
  if (/^\d+$/.test(s)) return "+" + s;
  return null;
}

async function sendSms({ to, body }) {
  if (!twilioEnabled) throw new Error("Twilio not configured (TWILIO_* envs missing).");
  const msg = await twilioClient.messages.create({ to, from: TWILIO_FROM, body });
  return { sid: msg.sid };
}

function makeDefaultMessage({ fullName = "Friend", userId = "unknown" }) {
  return (
    `🎉 Hey ${fullName}! You're eligible for benefits we found for you. ` +
    `Start here: https://mybenefitsai.org/claim/${encodeURIComponent(userId)}\n` +
    `Reply STOP to opt out.`
  );
}
/* -------------------------------------------------------------------- */

// Avoid spamming: do not send if a message was sent in the last X minutes
const SMS_COOLDOWN_MINUTES = 60;

// ✅ This route is NOW after express.json(), so req.body will be parsed.
app.post("/notify/sms", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const rawTo = pickToField(body);
    const to = normalizeUS(rawTo);

    console.log("[/notify/sms] headers:", req.headers);
    console.log("[/notify/sms] body:", body);
    console.log("[/notify/sms] rawTo:", rawTo, "normalized:", to);

    if (!to) {
      return res.status(400).json({
        error: "to is required",
        hint:
          'Send JSON with { "to": "+13322097232" } (or phone/number). Use Content-Type: application/json.',
        received: rawTo ?? null,
      });
    }

    const userId = body.userId || null;
    const fullName = body.fullName || "Friend";
    const msgBody =
      typeof body.message === "string" && body.message.trim().length > 0
        ? body.message.trim()
        : makeDefaultMessage({ fullName, userId });

    // Optional cooldown by userId
    if (userId && SmsLog) {
      const since = new Date(Date.now() - SMS_COOLDOWN_MINUTES * 60 * 1000);
      const recent = await SmsLog.findOne({ userId, createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .lean()
        .catch(() => null);
      if (recent) {
        return res.status(200).json({
          ok: true,
          message: "skipped due to cooldown",
          cooldownMinutes: SMS_COOLDOWN_MINUTES,
          last: { id: recent._id, at: recent.createdAt },
        });
      }
    }

    // Log queued
    let queuedId = null;
    if (SmsLog) {
      const queued = await SmsLog.create({
        userId: userId || null,
        to,
        body: msgBody,
        status: "queued",
        meta: body.meta || {},
      }).catch(() => null);
      queuedId = queued?._id || null;
    }

    try {
      const { sid } = await sendSms({ to, body: msgBody });
      if (queuedId && SmsLog) {
        await SmsLog.findByIdAndUpdate(queuedId, { sid, status: "sent" });
      }
      return res.status(201).json({ ok: true, sid, to, body: msgBody });
    } catch (err) {
      if (queuedId && SmsLog) {
        await SmsLog.findByIdAndUpdate(queuedId, { status: "failed", error: err?.message || "send failed" });
      }
      return res.status(500).json({ error: "twilio send failed", detail: err?.message || String(err) });
    }
  } catch (e) {
    console.error("/notify/sms fatal error:", e);
    return res.status(500).json({ error: "server error" });
  }
});

// Optional: quickly check last SMS for a userId
app.get("/notify/sms/last", async (req, res) => {
  try {
    const { userId } = req.query || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const last = await SmsLog.findOne({ userId }).sort({ createdAt: -1 }).lean();
    if (!last) return res.json({ ok: true, last: null });
    return res.json({
      ok: true,
      last: {
        id: last._id,
        to: last.to,
        status: last.status,
        at: last.createdAt,
        sid: last.sid || null,
        error: last.error || null,
      },
    });
  } catch (e) {
    console.error("/notify/sms/last error:", e);
    return res.status(500).json({ error: "server error" });
  }
});

// (kept) Stripe init; added apiVersion for stability
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

/* ===================== YOUR EXISTING ROUTES (unchanged) ===================== */
app.post("/api/messages", async (req, res) => {
  const { userId, replies, qualifiedFor } = req.body;

  console.log("Request body:", req.body);
  console.log("Qualified For:", qualifiedFor);
  console.log("Qualified For keys:", Object.keys(qualifiedFor || {}));
  console.log("User ID:", userId);

  let isQualified = false;
  if (qualifiedFor && Object.keys(qualifiedFor).length > 0) {
    isQualified = true;
  }

  if (!Array.isArray(replies)) {
    return res.status(400).json({ error: "messages must be an array" });
  }

  const responses = await UserResponse.create({
    userId: userId,
    responses: replies,
    qualifiedFor: qualifiedFor || {},
    isQualified: isQualified,
  });
  if (!responses) {
    return res.status(500).json({ error: "Failed to save responses" });
  }
  return res
    .status(200)
    .json({ data: responses, message: "Responses saved successfully" });
});

app.get("/api/messages", async (_req, res) => {
  try {
    const allResponses = await UserResponse.find({});
    return res.status(200).json({ data: allResponses });
  } catch (error) {
    console.error("Error fetching all responses:", error);
    return res.status(500).json({ error: "Failed to fetch responses" });
  }
});

app.post("/api/chatbot", async (req, res) => {
  try {
    const newEntry = new ChatbotResponse(req.body);
    await newEntry.save();
    res.status(200).json({ message: "Chatbot response saved ✅" });
  } catch (err) {
    console.error("Error saving chatbot response:", err);
    res.status(500).json({ error: "Server error ❌" });
  }
});

app.get("/api/chatbot", async (_req, res) => {
  try {
    const responses = await ChatbotResponse.find().sort({ createdAt: -1 });
    res.status(200).json(responses);
  } catch (err) {
    console.error("Error fetching chatbot responses:", err);
    res.status(500).json({ error: "Failed to fetch chatbot responses" });
  }
});

app.get("/chatbotmessages", async (_req, res) => {
  try {
    const responses = await ChatbotResponse.find().sort({ createdAt: -1 });
    res.status(200).json(responses);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch chatbot responses" });
  }
});

app.get("/api/messages/:userId", async (req, res) => {
  const { userId } = req.params;
  console.log("User ID:", userId);

  const responses = await UserResponse.findOne({ userId: userId });
  console.log(responses);
  if (!responses) {
    return res.status(404).json({ error: "No responses found" });
  }
  return res.status(200).json({ data: responses });
});

app.post("/email", async (req, res) => {
  const { email } = req.body;
  const response = await Email.create({ email });
  return res.status(200).json({ data: response });
});

app.get("/email", async (_req, res) => {
  const emails = await Email.find({});
  return res.status(200).json({ data: emails });
});

// -------------------------------------------------- BENEFIT GPT ROUTES --------------------------------------------------
const TAGS = {
  is_md: "Medicare",
  is_ssdi: "SSDI",
  is_auto: "Auto",
  is_mva: "MVA",
  is_debt: "Debt",
  is_rvm: "Reverse Mortgage",
};

app.post("/response/create", async (req, res) => {
  const { fullName, email, age, user_id, zipcode, tags, origin, sendMessageOn, number } = req.body;
  const tagsArray = (tags || []).map((tag) => TAGS[tag]).filter(Boolean);
  let transformedEmail = "";
  if (email && email.length > 0) {
    transformedEmail = email.toLowerCase();
  }
  const response = await Response.create({
    fullName,
    email: transformedEmail,
    age,
    userId: user_id,
    zipCode: zipcode,
    tags: tagsArray,
    origin,
    sendMessageOn,
    number
  });
  return res.status(200).json({ data: response });
});

app.post("/api/update-record", async (req, res) => {
  const { userId, isPaymentSuccess } = req.body;
  try {
    const updatedResponse = await Response.findOneAndUpdate(
      { userId },
      { isPaymentSuccess },
      { new: true }
    );
    if (!updatedResponse) {
      return res.status(404).json({ error: "Response not found" });
    }
    return res.status(200).json({ data: updatedResponse });
  } catch (error) {
    console.error("Error updating response:", error);
    return res.status(500).json({ error: "Failed to update response" });
  }
});

app.get("/response/all", async (_req, res) => {
  const response = await Response.find({}).sort({ createdAt: -1 });
  return res.status(200).json({ data: response });
});

app.get("/check/offer", async (req, res) => {
  try {
    const { name } = req.query;
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name is required in query" });
    }

    const value = String(name).trim();
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    let doc = await Response.findOne({ userId: value });

    if (!doc) {
      doc = await Response.findOne({
        fullName: new RegExp("^" + escapeRegex(value) + "\\s*$", "i"),
      });
    }

    if (!doc) {
      return res.status(404).json({ error: "No offer found for provided name/userId" });
    }
    return res.status(200).json({ data: doc });
  } catch (e) {
    console.error("/check/offer error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/email/submit", async (req, res) => {
  const { email, name, userId } = req.body;
  try {
    const response = await axios.post(
      "https://api.brevo.com/v3/contacts",
      {
        email,
        attributes: { FIRSTNAME: name, LASTNAME: email, USER_ID: userId },
        listIds: [5],
        updateEnabled: true,
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
    res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data });
  }
});

app.get("/check/model", async (req, res) => {
  const { fullName } = req.query;
  if (!fullName) {
    return res.status(400).json({ error: "fullName is required in query" });
  }
  try {
    const results = [];
    const r1 = await Response.findOne({ fullName });
    if (r1) results.push("Response");
    const r2 = await Response2.findOne({ fullName });
    if (r2) results.push("Response2");
    const r3 = await ChatbotResponse.findOne({ fullName });
    if (r3) results.push("ChatbotResponse");
    if (results.length === 0) {
      return res.status(404).json({ message: "Not found in any model" });
    }
    return res.status(200).json({ foundIn: results });
  } catch (err) {
    console.error("Error in /check/model:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/create-checkout", async (req, res) => {
  const { variantId } = req.body
  try {
    const resp = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`,
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            custom_price: 10,
            checkout_options: { embed: true },
            product_options: { redirect_url: process.env.AFTER_PAY_REDIRECT },
          },
          relationships: {
            store: { data: { type: 'stores', id: process.env.STORE_ID?.toString() } },
            variant: { data: { type: 'variants', id: variantId?.toString() } },
          },
        },
      }),
    })
    const json = await resp.json()
    if (!json?.data?.attributes?.url) {
      console.error('Invalid Lemon API response:', json);
      return res.status(500).json({ error: 'Invalid Lemon API response' });
    }
    return res.json({ url: json.data.attributes.url });
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'checkout creation failed' })
  }
})

app.post("/api/create-checkout-session", async (req, res) => {
  console.log("🎯 Stripe route hit");
  const { email, name, userId, amount } = req.body;
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: "Your Benefits Report", description: `For ${name}` },
          unit_amount: parseInt(amount) || 10,
        },
        quantity: 1,
      }],
      success_url: "https://mybenefitsai.org/success",
      cancel_url: "https://mybenefitsai.org/cancel",
      metadata: { userId, name },
    });
    console.log("✅ Stripe session created:", session.id);
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe Error:", err.message);
    return res.status(500).json({ error: "Unable to create Stripe session", message: err.message });
  }
});

// ------------------------ NEW: RAG $1.00 USD PaymentIntent endpoints ------------------------
let RAG_LAST_PI = null;

app.get("/rag/health", (_req, res) => res.json({ ok: true }));

app.post("/rag/oneusd/create", async (_req, res) => {
  try {
    const intent = await stripe.paymentIntents.create({
      amount: 100, currency: "usd",
      automatic_payment_methods: { enabled: true }
    });
    RAG_LAST_PI = intent.id;
    return res.json({ id: intent.id, clientSecret: intent.client_secret });
  } catch (err) {
    console.error("rag:oneusd:create error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
});

app.get("/rag/intent/status", async (req, res) => {
  try {
    const { id } = req.query;
    const piId = id || RAG_LAST_PI;
    if (!piId) return res.json({ status: "unknown" });
    const pi = await stripe.paymentIntents.retrieve(piId);
    return res.json({ id: pi.id, status: pi.status });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Server error" });
  }
});

// Stripe webhook handler (already has raw body above)
app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("❌ Webhook Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { customer_email: email, metadata } = session;
    const { userId, name } = metadata;

    console.log("✅ Payment success for:", email);

    try {
      await axios.post("https://benifit-gpt-be.onrender.com/api/update-record", {
        userId, isPaymentSuccess: true,
      });
    } catch (e) { console.error("❌ Failed to update record:", e.message); }

    try {
      await axios.post("https://benifit-gpt-be.onrender.com/email/submit", {
        email, name, userId,
      });
    } catch (e) { console.error("❌ Failed to send email:", e.message); }
  }

  return res.status(200).json({ received: true });
});

// Analytics (unchanged)
const AnalyticsEvent = require("./analyticsEvent");
app.set("trust proxy", true);
function getIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

app.post("/analytics/event", async (req, res) => {
  try {
    const { type, page, buttonId, userId, sessionId, meta } = req.body || {};
    if (!type) return res.status(400).json({ error: "type is required" });

    const doc = await AnalyticsEvent.create({
      type, page: page || null, buttonId: buttonId || null,
      userId: userId || null, sessionId: sessionId || null, meta: meta || {},
      ip: getIp(req), ua: req.headers["user-agent"] || null,
      referrer: req.headers["referer"] || req.headers["referrer"] || null,
    });

    return res.status(201).json({ ok: true, id: doc._id });
  } catch (e) {
    console.error("analytics/event error:", e);
    return res.status(500).json({ error: "failed to create event" });
  }
});

app.post("/analytics/pageview", async (req, res) => {
  try {
    const { page = "/", userId = null, sessionId = null, meta = {} } = req.body || {};
    const doc = await AnalyticsEvent.create({
      type: "page_view", page, userId, sessionId, meta,
      ip: getIp(req), ua: req.headers["user-agent"] || null,
      referrer: req.headers["referer"] || req.headers["referrer"] || null,
    });
    return res.status(201).json({ ok: true, id: doc._id });
  } catch (e) {
    console.error("analytics/pageview error:", e);
    return res.status(500).json({ error: "failed to log pageview" });
  }
});

app.post("/analytics/button", async (req, res) => {
  try {
    const { page = "/", buttonId, userId = null, sessionId = null, meta = {} } = req.body || {};
    if (!buttonId) return res.status(400).json({ error: "buttonId is required" });

    const doc = await AnalyticsEvent.create({
      type: "button_click", page, buttonId, userId, sessionId, meta,
      ip: getIp(req), ua: req.headers["user-agent"] || null,
      referrer: req.headers["referer"] || req.headers["referrer"] || null,
    });
    return res.status(201).json({ ok: true, id: doc._id });
  } catch (e) {
    console.error("analytics/button error:", e);
    return res.status(500).json({ error: "failed to log button click" });
  }
});

app.get("/analytics/summary", async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = {};
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }

    const [pages, buttons, totals] = await Promise.all([
      AnalyticsEvent.aggregate([
        { $match: match },
        { $group: { _id: { type: "$type", page: "$page" }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      AnalyticsEvent.aggregate([
        { $match: { ...match, type: "button_click" } },
        { $group: { _id: { page: "$page", buttonId: "$buttonId" }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      AnalyticsEvent.aggregate([
        { $match: match },
        { $group: { _id: "$type", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    res.json({ totals, pages, buttons });
  } catch (e) {
    console.error("analytics/summary error:", e);
    res.status(500).json({ error: "failed to get summary" });
  }
});

// Progress API (unchanged)
function normalizeBoolArray(arr) { if (!Array.isArray(arr)) return []; return arr.map((v) => !!v); }

app.get("/progress", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ error: "userId is required" });
    }

    const doc = await ProgressState.findOne({ userId }).lean();
    if (!doc) {
      return res.json({ userId, completed: [], unlockedCount: 1, activeIndex: 0, benefits: [] });
    }

    return res.json({
      userId: doc.userId,
      completed: doc.completed || [],
      unlockedCount: typeof doc.unlockedCount === "number" ? doc.unlockedCount : 1,
      activeIndex: typeof doc.activeIndex === "number" ? doc.activeIndex : 0,
      benefits: doc.benefits || [],
      updatedAt: doc.updatedAt,
    });
  } catch (e) {
    console.error("/progress GET error:", e);
    return res.status(500).json({ error: "server error" });
  }
});

app.post("/progress", async (req, res) => {
  try {
    let { userId, completed, unlockedCount, activeIndex, benefits } = req.body || {};
    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ error: "userId is required" });
    }

    completed = normalizeBoolArray(completed);
    unlockedCount = Number.isFinite(+unlockedCount) ? Math.max(0, +unlockedCount) : 1;
    activeIndex = Number.isFinite(+activeIndex) ? Math.max(0, +activeIndex) : 0;
    benefits = Array.isArray(benefits) ? benefits.map(String) : [];

    const doc = await ProgressState.findOneAndUpdate(
      { userId },
      { $set: { completed, unlockedCount, activeIndex, benefits } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return res.status(200).json({
      ok: true,
      data: {
        userId: doc.userId,
        completed: doc.completed,
        unlockedCount: doc.unlockedCount,
        activeIndex: doc.activeIndex,
        benefits: doc.benefits,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (e) {
    console.error("/progress POST error:", e);
    return res.status(500).json({ error: "server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
