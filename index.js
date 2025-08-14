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

// (kept) Stripe init; added apiVersion for stability
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const twilioRoutes = require("./twilioRoutes");
// Webhook must get raw body
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(cors());
app.use("/api/notify", twilioRoutes);

(async () => {
  await connectToDatabase();
})();

app.post("/api/messages", async (req, res) => {
  const { userId, replies, qualifiedFor } = req.body;

  console.log("Request body:", req.body);
  console.log("Qualified For:", qualifiedFor);
  console.log("Qualified For keys:", Object.keys(qualifiedFor));
  console.log("User ID:", userId);

  let isQualified = false;
  if (Object.keys(qualifiedFor).length > 0) {
    isQualified = true;
  }

  if (!Array.isArray(replies)) {
    return res.status(400).json({ error: "messages must be an array" });
  }

  const responses = await UserResponse.create({
    userId: userId,
    responses: replies,
    qualifiedFor: qualifiedFor,
    isQualified: isQualified,
  });
  if (!responses) {
    return res.status(500).json({ error: "Failed to save responses" });
  }
  return res
    .status(200)
    .json({ data: responses, message: "Responses saved successfully" });
});

app.get("/api/messages", async (req, res) => {
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

app.get("/api/chatbot", async (req, res) => {
  try {
    const responses = await ChatbotResponse.find().sort({ createdAt: -1 });
    res.status(200).json(responses);
  } catch (err) {
    console.error("Error fetching chatbot responses:", err);
    res.status(500).json({ error: "Failed to fetch chatbot responses" });
  }
});

app.get("/chatbotmessages", async (req, res) => {
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

app.get("/email", async (req, res) => {
  const emails = await Email.find({});
  return res.status(200).json({ data: emails });
});

// -------------------------------------------------- BENIFIT GPT ROUTES --------------------------------------------------
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
  const tagsArray = tags.map((tag) => TAGS[tag]);
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

app.get("/response/all", async (req, res) => {
  const response = await Response.find({}).sort({ createdAt: -1 });
  return res.status(200).json({ data: response });
});

app.get("/check/offer", async (req, res) => {
  try {
    const { name, userId } = req.query;

    if (!name && !userId) {
      return res.status(400).json({ error: "Provide either name or userId in query" });
    }

    const query = userId
      ? { userId: String(userId) }
      : { fullName: new RegExp(`^${String(name).trim()}\\s*$`, "i") };

    const response = await Response.findOne(query);
    return res.status(200).json({ data: response });
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
        attributes: {
          FIRSTNAME: name,
          LASTNAME: email,
          USER_ID: userId,
        },
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

app.post('/api/create-checkout', async (req, res) => {
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
            custom_price: 10, // note: Lemon uses cents; 100 would be $1.00
            checkout_options: { embed: true },
            product_options: {
              redirect_url: process.env.AFTER_PAY_REDIRECT,
            },
          },
          relationships: {
            store: { data: { type: 'stores', id: process.env.STORE_ID.toString() } },
            variant: { data: { type: 'variants', id: variantId.toString() } },
          },
        },
      }),
    })
    const json = await resp.json()
    if (!json || !json.data || !json.data.attributes || !json.data.attributes.url) {
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
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Your Benefits Report",
              description: `For ${name}`,
            },
            unit_amount: parseInt(amount) || 10,
          },
          quantity: 1,
        },
      ],
      // customer_email: email,
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

// Health (simple)
app.get("/rag/health", (_req, res) => res.json({ ok: true }));

// Create a fixed $1 PaymentIntent (USD)
app.post("/rag/oneusd/create", async (_req, res) => {
  try {
    const intent = await stripe.paymentIntents.create({
      amount: 100,                  // $1.00
      currency: "usd",
      automatic_payment_methods: { enabled: true }
    });
    RAG_LAST_PI = intent.id;
    return res.json({ id: intent.id, clientSecret: intent.client_secret });
  } catch (err) {
    console.error("rag:oneusd:create error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
});

// Check PI status: uses ?id= to check any PI, or falls back to last created
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
// --------------------------------------------------------------------------------------------

// Stripe webhook (raw body)
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
        userId,
        isPaymentSuccess: true,
      });
    } catch (e) {
      console.error("❌ Failed to update record:", e.message);
    }

    try {
      await axios.post("https://benifit-gpt-be.onrender.com/email/submit", {
        email,
        name,
        userId,
      });
    } catch (e) {
      console.error("❌ Failed to send email:", e.message);
    }
  }

  return res.status(200).json({ received: true });
});
// ___ missing u farish noob 
// --- ADD THIS NEAR YOUR OTHER REQUIRES ---
const AnalyticsEvent = require("./analyticsEvent");

// --- helper to get IP (works behind proxies if trust proxy is set) ---
app.set('trust proxy', true);
function getIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

// ----------- ANALYTICS ROUTES -----------

// Generic event endpoint (you can use this for everything)
app.post("/analytics/event", async (req, res) => {
  try {
    const { type, page, buttonId, userId, sessionId, meta } = req.body || {};
    if (!type) return res.status(400).json({ error: "type is required" });

    const doc = await AnalyticsEvent.create({
      type,
      page: page || null,
      buttonId: buttonId || null,
      userId: userId || null,
      sessionId: sessionId || null,
      meta: meta || {},
      ip: getIp(req),
      ua: req.headers["user-agent"] || null,
      referrer: req.headers["referer"] || req.headers["referrer"] || null,
    });

    return res.status(201).json({ ok: true, id: doc._id });
  } catch (e) {
    console.error("analytics/event error:", e);
    return res.status(500).json({ error: "failed to create event" });
  }
});

// Quick helpers (optional sugar):
app.post("/analytics/pageview", async (req, res) => {
  try {
    const { page = "/", userId = null, sessionId = null, meta = {} } = req.body || {};
    const doc = await AnalyticsEvent.create({
      type: "page_view",
      page,
      userId,
      sessionId,
      meta,
      ip: getIp(req),
      ua: req.headers["user-agent"] || null,
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
      type: "button_click",
      page,
      buttonId,
      userId,
      sessionId,
      meta,
      ip: getIp(req),
      ua: req.headers["user-agent"] || null,
      referrer: req.headers["referer"] || req.headers["referrer"] || null,
    });
    return res.status(201).json({ ok: true, id: doc._id });
  } catch (e) {
    console.error("analytics/button error:", e);
    return res.status(500).json({ error: "failed to log button click" });
  }
});

// Congrats page visit
app.post("/analytics/congrats", async (req, res) => {
  try {
    const { userId = null, sessionId = null, meta = {} } = req.body || {};
    const doc = await AnalyticsEvent.create({
      type: "page_visit",
      page: "/congratulations",
      userId,
      sessionId,
      meta,
      ip: getIp(req),
      ua: req.headers["user-agent"] || null,
      referrer: req.headers["referer"] || req.headers["referrer"] || null,
    });
    return res.status(201).json({ ok: true, id: doc._id });
  } catch (e) {
    console.error("analytics/congrats error:", e);
    return res.status(500).json({ error: "failed to log congrats visit" });
  }
});

// Simple summary (counts per page and per button, optional time filter)
app.get("/analytics/summary", async (req, res) => {
  try {
    const { from, to } = req.query; // ISO strings optional
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


// ========================= TrustedForm: BACKEND INTEGRATION =========================
// .env must contain: TRUSTEDFORM_API_KEY=YOUR_KEY   (server-side only)

// Validate cert URL is a TF certificate URL
function isValidTfCertUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "cert.trustedform.com";
  } catch {
    return false;
  }
}

// Build Basic auth header: username "API", password = API key
function tfAuthHeader() {
  const key = process.env.TRUSTEDFORM_API_KEY;
  if (!key) return null;
  return "Basic " + Buffer.from(`API:${key}`).toString("base64");
}

// quick health
app.get("/tf/health", (_req, res) => {
  res.json({ ok: !!process.env.TRUSTEDFORM_API_KEY });
});

// Claim/retain the certificate + LOG it in Mongo
app.post("/tf/claim", async (req, res) => {
  try {
    const {
      cert_url,
      email,
      phone,
      reference,
      vendor,
      required_scan_terms,
      forbidden_scan_terms,
    } = req.body || {};

    if (!cert_url || !isValidTfCertUrl(cert_url)) {
      return res.status(400).json({ success: false, error: "Invalid cert_url" });
    }

    const auth = tfAuthHeader();
    if (!auth) {
      return res.status(500).json({ success: false, error: "Missing TRUSTEDFORM_API_KEY" });
    }

    // Prepare optional body for TF
    const body = {
      email_1: email || undefined,
      phone_1: phone || undefined,
      reference: reference || undefined,
      vendor: vendor || undefined,
      required_scan_terms: required_scan_terms || undefined,
      forbidden_scan_terms: forbidden_scan_terms || undefined,
    };

    // POST to the certificate URL to claim
    const tfResp = await axios.post(cert_url, body, {
      headers: {
        Authorization: auth,
        Accept: "application/json",
        "Content-Type": "application/json",
        // "Api-Version": "4.0", // uncomment if your account requires it
      },
      timeout: 10000,
      validateStatus: () => true,
    });

    // Upsert a log of this certificate in Mongo
    const payloadForDb = {
      cert_url,
      reference: reference || null,
      vendor: vendor || null,
      email: email || null,
      phone: phone || null,
      claimed: tfResp.status >= 200 && tfResp.status < 300,
      statusCode: tfResp.status,
      tf_response: tfResp.data || null,
      error: tfResp.status >= 200 && tfResp.status < 300 ? null :
             (typeof tfResp.data === "string"
               ? tfResp.data
               : (tfResp.data?.error || tfResp.data?.message || "Claim failed")),
    };

    await TrustedFormCert.findOneAndUpdate(
      { cert_url },
      payloadForDb,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(tfResp.status).json({
      success: payloadForDb.claimed,
      data: tfResp.data,
    });
  } catch (err) {
    console.error("TF claim error:", err?.response?.data || err?.message || err);
    try {
      // best-effort log even when request threw
      const { cert_url, email, phone, reference, vendor } = req.body || {};
      if (cert_url) {
        await TrustedFormCert.findOneAndUpdate(
          { cert_url },
          {
            cert_url,
            reference: reference || null,
            vendor: vendor || null,
            email: email || null,
            phone: phone || null,
            claimed: false,
            statusCode: null,
            tf_response: null,
            error: err?.message || "Server error",
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
    } catch (_) {}
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// List certificates we have seen/claimed
// Query params (all optional):
//   q=<string> (search in cert_url/reference/phone/email)
//   claimed=true|false
//   limit=50 (default 50, max 200)
//   page=1
//   sort=-createdAt  (default newest first)
app.get("/tf/certs", async (req, res) => {
  try {
    const {
      q = "",
      claimed,
      limit = 50,
      page = 1,
      sort = "-createdAt",
    } = req.query;

    const lim = Math.min(parseInt(limit) || 50, 200);
    const skip = Math.max(((parseInt(page) || 1) - 1) * lim, 0);

    const match = {};
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      match.$or = [
        { cert_url: rx },
        { reference: rx },
        { phone: rx },
        { email: rx },
        { vendor: rx },
      ];
    }
    if (claimed === "true") match.claimed = true;
    if (claimed === "false") match.claimed = false;

    const [items, total] = await Promise.all([
      TrustedFormCert.find(match)
        .sort(sort)
        .skip(skip)
        .limit(lim)
        .lean(),
      TrustedFormCert.countDocuments(match),
    ]);

    return res.json({
      total,
      page: parseInt(page) || 1,
      perPage: lim,
      items,
    });
  } catch (e) {
    console.error("/tf/certs error:", e);
    return res.status(500).json({ error: "failed to list certificates" });
  }
});

// Optional: fetch single by _id
app.get("/tf/certs/:id", async (req, res) => {
  try {
    const item = await TrustedFormCert.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: "not found" });
    return res.json(item);
  } catch (e) {
    return res.status(500).json({ error: "server error" });
  }
});
// ======================= End TrustedForm: BACKEND INTEGRATION =======================



app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
