import "dotenv/config";
import express from "express";
import cors from "cors";
import Stripe from "stripe";
import bodyParser from "body-parser";

const app = express();
const PORT = process.env.PORT || 5000;

// ---- Stripe ----
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// ---- CORS ----
app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"], credentials: true }));

// JSON for normal routes (NOT for webhook)
app.use(express.json());

// In-memory PI reference (replace with DB in prod if needed)
let RAG_LAST_PI = null;

// --------------- NAMESPACED ROUTES: /rag ----------------

/**
 * POST /rag/intent/create
 * body: { amountINR, metadata?, receipt_email? }
 */
app.post("/rag/intent/create", async (req, res) => {
  try {
    const { amountINR, metadata, receipt_email } = req.body;
    if (!amountINR || amountINR <= 0) return res.status(400).json({ error: "amountINR required" });

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(Number(amountINR) * 100),
      currency: "inr",
      automatic_payment_methods: { enabled: true },
      receipt_email: receipt_email || undefined,
      metadata: metadata || {}
    });

    RAG_LAST_PI = intent.id;
    return res.json({ clientSecret: intent.client_secret, id: intent.id });
  } catch (err) {
    console.error("rag:create-intent", err);
    res.status(500).json({ error: err?.message || "Server error" });
  }
});

/**
 * POST /rag/intent/update
 * body: { amountINR?, metadata? }
 */
app.post("/rag/intent/update", async (req, res) => {
  try {
    const { amountINR, metadata } = req.body;
    if (!RAG_LAST_PI) return res.json({ ok: true, skipped: true });

    const payload = {};
    if (amountINR && amountINR > 0) payload.amount = Math.round(Number(amountINR) * 100);
    if (metadata) payload.metadata = metadata;

    if (Object.keys(payload).length === 0) return res.json({ ok: true, noChange: true });

    const updated = await stripe.paymentIntents.update(RAG_LAST_PI, payload);
    return res.json({ ok: true, updated: updated.id, amount: updated.amount });
  } catch (err) {
    console.error("rag:update-intent", err);
    res.status(500).json({ error: err?.message || "Server error" });
  }
});

/**
 * GET /rag/intent/status
 */
app.get("/rag/intent/status", async (_req, res) => {
  try {
    if (!RAG_LAST_PI) return res.json({ status: "unknown" });
    const pi = await stripe.paymentIntents.retrieve(RAG_LAST_PI);
    return res.json({ status: pi.status, id: pi.id });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
});

/**
 * POST /rag/webhook
 * raw body verification
 */
app.post("/rag/webhook",
  bodyParser.raw({ type: "*/*" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error("rag:webhook signature failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object;
        console.log("✅ rag payment succeeded:", pi.id, "Amount:", pi.amount);
        // TODO: mark order paid in your DB, send email, etc.
        break;
      }
      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        console.log("❌ rag payment failed:", pi.id, pi.last_payment_error?.message);
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  }
);

// Health
app.get("/rag/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`RAG API running on http://localhost:${PORT}`));
