// raghib.js
// Single-file Node.js backend (CommonJS). Always charges $1 USD.
// No .env. Put your real Stripe secret key below and run with: 
//   npm i express stripe cors body-parser
//   node raghib.js

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const Stripe = require("stripe");

// >>> REPLACE with your real secret key (live or test). KEEP THIS ON SERVER ONLY.
const STRIPE_SECRET_KEY = "sk_live_or_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

const app = express();
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Basic CORS so your hosted FE can call directly
app.use(cors());
app.use(express.json());

// Keep track of the last PI for a quick status check (demo-only)
let RAG_LAST_PI = null;

// Health
app.get("/rag/health", (_req, res) => res.json({ ok: true }));

// Create a fixed $1 (USD) PaymentIntent
app.post("/rag/oneusd/create", async (_req, res) => {
  try {
    const intent = await stripe.paymentIntents.create({
      amount: 100,                 // $1.00
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      // Optional: add static metadata/receipt_email if you want
    });
    RAG_LAST_PI = intent.id;
    res.json({ id: intent.id, clientSecret: intent.client_secret });
  } catch (err) {
    console.error("rag:oneusd:create error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Server error" });
  }
});

// Check status of the last created PI (simple helper)
app.get("/rag/intent/status", async (_req, res) => {
  try {
    if (!RAG_LAST_PI) return res.json({ status: "unknown" });
    const pi = await stripe.paymentIntents.retrieve(RAG_LAST_PI);
    res.json({ id: pi.id, status: pi.status });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
});

const PORT = 5000; // fixed port, no env
app.listen(PORT, () => console.log(`RAG backend listening on http://localhost:${PORT}`));
