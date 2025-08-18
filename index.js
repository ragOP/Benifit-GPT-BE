// index.js
const express = require("express");
const axios = require("axios");
const Stripe = require("stripe");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 9005;

// ====== MODELS / DB ======
const { connectToDatabase } = require("./db");
const UserResponse   = require("./userResponse");
const ChatbotResponse= require("./ChatbotResponse");
const Email          = require("./email");
const Response       = require("./response");
const Response2      = require("./response2");
const Response3      = require("./response3");
const TrustedFormCert= require("./trustedFormCert");
const ProgressState  = require("./progressState");
const SmsLog         = require("./smsLog");
const AnalyticsEvent = require("./analyticsEvent");
const NudgeTask      = require("./nudgeTask");
const { attachNudges } = require("./nudge/index"); 

// message templates (centralized)
const {
  buildStepMessage,
  buildCombinedFirstMessage
} = require("./utils/messageTemplates");

// ====== STRIPE ======
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// ====== TWILIO ======
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN  || "";
const TWILIO_FROM        = process.env.TWILIO_FROM        || ""; // e.g. +12345551234
const twilioEnabled = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM;

let twilioClient = null;
if (twilioEnabled) {
  const twilio = require("twilio");
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}
attachNudges(app, {
  NudgeTask,
  ProgressState,
  SmsLog,
  twilioClient,
  TWILIO_FROM
});

// ====== MIDDLEWARE ORDER (IMPORTANT) ======
// 1) Stripe webhook needs RAW body
app.use("/webhook", express.raw({ type: "application/json" }));

// 2) JSON parser for the rest
app.use(express.json());

// 3) CORS (single place)
const cors = require("cors");
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "https://mybenefitsai.org",
  "https://www.mybenefitsai.org",
];
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    try {
      const host = new URL(origin).hostname;
      if (/\.onrender\.com$/.test(host)) return cb(null, true);
    } catch {}
    return cb(new Error(`CORS: ${origin} not allowed`));
  },
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","Accept","Origin","X-Requested-With"],
  credentials: false,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions)); 

// 4) External Twilio REST router (optional helpers under /api/notify)
const twilioRoutes = require("./twilioRoutes");
app.use("/api/notify", twilioRoutes);

// ====== DB ======
(async () => { await connectToDatabase(); })();

// ====== HELPERS ======
function normalizeBoolArray(arr){ return Array.isArray(arr) ? arr.map(Boolean) : []; }

function parseJsonBody(req){
  if (req && typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}
function pickToField(body){ return body.to || body.phone || body.number || body.mobile || null; }
function normalizeUS(to){
  if (!to) return null;
  let s = String(to).trim();
  if (s.startsWith("+")) return s;
  s = s.replace(/\D+/g, "");
  if (s.length === 11 && s.startsWith("1")) return "+" + s;
  if (s.length === 10) return "+1" + s;
  if (/^\d+$/.test(s)) return "+" + s;
  return null;
}
async function sendSms({ to, body }){
  if (!twilioEnabled) throw new Error("Twilio not configured (TWILIO_* envs missing).");
  const msg = await twilioClient.messages.create({ to, from: TWILIO_FROM, body });
  return { sid: msg.sid };
}

// nudge schedule
const MINUTE = 60 * 1000;
const FIRST_GAP_MS = 2 * MINUTE;   // first follow-up in 2 minutes
const REPEAT_GAP_MS= 2 * MINUTE;   // then every 2 minutes
function computeNextAt(attempts, from = Date.now()){
  return new Date(from + (attempts === 0 ? FIRST_GAP_MS : REPEAT_GAP_MS));
}

async function sendViaLocalTwilio(to, message){
  const { sid } = await twilioClient.messages.create({ to, from: TWILIO_FROM, body: message });
  return sid;
}

// ====== SMS (no cooldown) ======
app.post("/notify/sms", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const rawTo = pickToField(body);
    const to = normalizeUS(rawTo);

    if (!to) {
      return res.status(400).json({
        error: "to is required",
        hint: 'Send JSON with { "to": "+13322097232" } (or phone/number). Use Content-Type: application/json.',
        received: rawTo ?? null,
      });
    }

    const userId  = body.userId  || null;
    const fullName= body.fullName|| "Friend";
    const msgBody = (typeof body.message === "string" && body.message.trim())
      ? body.message.trim()
      : `🎉 Hey ${fullName}! You're eligible for benefits we found for you.
Start here: https://mybenefitsai.org/claim/${encodeURIComponent(userId || "unknown")}
Reply STOP to opt out.`;

    // (optional) log queued
    let queuedId = null;
    if (SmsLog) {
      const q = await SmsLog.create({
        userId: userId || null, to, body: msgBody, status: "queued", meta: body.meta || {}
      }).catch(() => null);
      queuedId = q?._id || null;
    }

    try {
      const { sid } = await sendSms({ to, body: msgBody });
      if (queuedId && SmsLog) await SmsLog.findByIdAndUpdate(queuedId, { sid, status: "sent" });
      return res.status(201).json({ ok: true, sid, to, body: msgBody });
    } catch (err) {
      if (queuedId && SmsLog) await SmsLog.findByIdAndUpdate(queuedId, { status: "failed", error: err?.message || "send failed" });
      return res.status(500).json({ error: "twilio send failed", detail: err?.message || String(err) });
    }
  } catch (e) {
    console.error("/notify/sms fatal error:", e);
    return res.status(500).json({ error: "server error" });
  }
});

app.get("/notify/sms/last", async (req, res) => {
  try {
    const { userId } = req.query || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const last = await SmsLog.findOne({ userId }).sort({ createdAt: -1 }).lean();
    if (!last) return res.json({ ok: true, last: null });
    return res.json({
      ok: true,
      last: { id: last._id, to: last.to, status: last.status, at: last.createdAt, sid: last.sid || null, error: last.error || null }
    });
  } catch (e) {
    console.error("/notify/sms/last error:", e);
    return res.status(500).json({ error: "server error" });
  }
});

// ====== NUDGES ======
// SINGLE authoritative /nudges/init
// body: { userId, to, fullName, tags[] }
app.post("/nudges/init", async (req, res) => {
  try {
    const { userId, to, fullName = "User", tags = [] } = req.body || {};
    if (!userId || !to) return res.status(400).json({ error: "userId and to are required" });

    const claimUrl   = `https://mybenefitsai.org/claim/${encodeURIComponent(userId)}`;
    const benefitKey = Array.isArray(tags) && tags.length ? String(tags[0]) : "";

    const nextAt = computeNextAt(0);

await NudgeTask.findOneAndUpdate(
  { userId, stepIndex: 0 },
  {
    // always keep these in sync
    $set: {
      to,
      fullName,
      benefitKey,
      claimUrl
    },
    // only on first insert
    $setOnInsert: {
      status: "active",
      attempts: 0,
      maxAttempts: 5,
      nextAt
    }
  },
  { upsert: true, new: true }
);


    const combined = buildCombinedFirstMessage({ userId, fullName });
    return res.json({ ok: true, immediateMessage: combined });
  } catch (e) {
    console.error("/nudges/init error:", e);
    return res.status(500).json({ error: "server error" });
  }
});

async function handleTaskSend(task) {
  setInterval(async () => {
  try {
    const now = new Date();
    const due = await NudgeTask.find({
      status: "active",
      nextAt: { $lte: now }   // catch past-due immediately
    }).sort({ nextAt: 1 }).limit(50).lean();

    for (const t of due) await handleTaskSend(t);
  } catch (e) {
    console.error("nudge worker error:", e);
  }
}, 10 * 1000);
  const nowMs = Date.now();
  if (task.status !== "active") return;

  // 1) Read current progress
  const state = await ProgressState.findOne({ userId: task.userId })
    .lean()
    .catch(() => null);

  const completed = Array.isArray(state?.completed) ? state.completed : [];
  const benefits  = Array.isArray(state?.benefits)  ? state.benefits  : [];

  // 2) If benefits are unknown, DO NOT finish this task. Keep sending as scheduled.
  const benefitsKnown = benefits.length > 0;

  // When we do know benefits, the task is only valid if its stepIndex exists.
  const hasStep = benefitsKnown ? (task.stepIndex < benefits.length) : true;

  // If benefitsKnown and step doesn't exist anymore → finish this task.
  if (benefitsKnown && !hasStep) {
    await NudgeTask.findByIdAndUpdate(task._id, { status: "done" });
    return;
  }

  // If benefitsKnown and this step is already completed → spawn next (if any) and finish this task.
  if (benefitsKnown && completed[task.stepIndex]) {
    const nextIndex = task.stepIndex + 1;

    if (nextIndex < benefits.length) {
      const nextBenefitKey = String(benefits[nextIndex] || "");
      const nextClaim      = `https://mybenefitsai.org/claim/${encodeURIComponent(task.userId)}`;

      await NudgeTask.findOneAndUpdate(
        { userId: task.userId, stepIndex: nextIndex },
        {
          $setOnInsert: {
            to: task.to,
            fullName: task.fullName,
            benefitKey: nextBenefitKey,
            claimUrl: nextClaim,
            status: "active",
            attempts: 0,
            maxAttempts: 5,
            nextAt: computeNextAt(0, nowMs),
          },
          $set: {
            to: task.to,
            fullName: task.fullName,
            benefitKey: nextBenefitKey,
            claimUrl: nextClaim,
          },
        },
        { upsert: true, new: true }
      );
    }

    await NudgeTask.findByIdAndUpdate(task._id, { status: "done" });
    return;
  }

  // 3) Not completed → send when due
  if (task.nextAt && task.nextAt.getTime() > nowMs) return; // not yet due

  const text = buildStepMessage({
    fullName: task.fullName,
    benefitKey: task.benefitKey,
    claimUrl : task.claimUrl,
  });

try {
  const sid = await sendViaLocalTwilio(task.to, text);
  const attempts = (task.attempts || 0) + 1;

  if (attempts >= (task.maxAttempts || 5)) {
    await NudgeTask.findByIdAndUpdate(task._id, {
      attempts,
      lastSentAt: new Date(),
      lastSid: sid,              // <-- add this
      lastError: null,           // <-- clear on success
      status: "done",
    });
  } else {
    await NudgeTask.findByIdAndUpdate(task._id, {
      attempts,
      lastSentAt: new Date(),
      lastSid: sid,              // <-- add this
      lastError: null,
      nextAt: computeNextAt(attempts, Date.now()),
    });
  }
} catch (err) {
  console.error("nudge send failed:", err?.message || err);
  await NudgeTask.findByIdAndUpdate(task._id, {
    lastError: err?.message || String(err), // <-- store error
    nextAt: new Date(Date.now() + 5 * 60 * 1000), // 5-min backoff on failure
  });
}

}

app.get("/nudges/overview", async (req, res) => {
  try {
    const { userId } = req.query || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const [tasks, logs, progress] = await Promise.all([
      NudgeTask.find({ userId }).sort({ stepIndex: 1, nextAt: 1 }).lean(),
      SmsLog.find({ userId }).sort({ createdAt: -1 }).lean(),
      ProgressState.findOne({ userId }).lean()
    ]);

    // group logs by taskId for quick join
    const logsByTask = {};
    for (const l of logs) {
      const tid = l?.meta?.taskId || "unmapped";
      (logsByTask[tid] ||= []).push(l);
    }

    // summarize counts
    const counts = {
      totalTasks: tasks.length,
      active: tasks.filter(t => t.status === "active").length,
      done: tasks.filter(t => t.status === "done").length,
      dueNow: tasks.filter(t => t.status === "active" && t.nextAt && t.nextAt <= new Date()).length,
      totalSms: logs.length,
      sentSms: logs.filter(l => l.status === "sent").length,
      failedSms: logs.filter(l => l.status === "failed").length,
    };

    // map tasks with their logs
    const timeline = tasks.map(t => ({
      taskId: t._id,
      stepIndex: t.stepIndex,
      benefitKey: t.benefitKey,
      to: t.to,
      status: t.status,
      attempts: t.attempts,
      maxAttempts: t.maxAttempts,
      lastSentAt: t.lastSentAt,
      nextAt: t.nextAt,
      lastSid: t.lastSid || null,
      lastError: t.lastError || null,
      logs: logsByTask[String(t._id)] || []
    }));

    return res.json({
      ok: true,
      userId,
      progress: progress ? {
        activeIndex: progress.activeIndex,
        unlockedCount: progress.unlockedCount,
        completed: progress.completed,
        benefits: progress.benefits
      } : null,
      counts,
      timeline
    });
  } catch (e) {
    console.error("/nudges/overview error:", e);
    return res.status(500).json({ error: "server error" });
  }
});

// ===== All-task listing, search, pagination =====
app.get("/nudges/tasks", async (req, res) => {
  try {
    const {
      q = "",                 // free-text search across userId, to, fullName, benefitKey
      status,                 // optional: active | done | paused (if you use paused)
      page = 1,
      limit = 25,
      sort = "-nextAt",       // default: newest due first; examples: "-updatedAt", "userId"
    } = req.query;

    const lim = Math.min(parseInt(limit) || 25, 200);
    const skip = Math.max(((parseInt(page) || 1) - 1) * lim, 0);

    const find = {};
    if (status) find.status = status;

    if (q) {
      const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      find.$or = [
        { userId: rx },
        { to: rx },
        { fullName: rx },
        { benefitKey: rx },
      ];
    }

    const [items, total] = await Promise.all([
      NudgeTask.find(find).sort(sort).skip(skip).limit(lim).lean(),
      NudgeTask.countDocuments(find),
    ]);

    res.json({ ok: true, total, page: parseInt(page) || 1, perPage: lim, items });
  } catch (e) {
    console.error("/nudges/tasks list error:", e);
    res.status(500).json({ error: "server error" });
  }
});

// ===== Quick: mark a task due NOW or change status =====
// PATCH /nudges/tasks?id=<taskId>
// body can include: { nextAt: <ISOString>, status: "active"|"done"|"paused", maxAttempts, repeatGapMs, firstGapMs }
app.patch("/nudges/tasks", async (req, res) => {
  try {
    const { id } = req.query || {};
    if (!id) return res.status(400).json({ error: "id is required" });

    const update = {};
    if (req.body?.nextAt)      update.nextAt      = new Date(req.body.nextAt);
    if (req.body?.status)      update.status      = String(req.body.status);
    if (Number.isFinite(+req.body?.maxAttempts)) update.maxAttempts = Math.max(1, +req.body.maxAttempts);
    if (Number.isFinite(+req.body?.repeatGapMs)) update.repeatGapMs = Math.max(1000, +req.body.repeatGapMs);
    if (Number.isFinite(+req.body?.firstGapMs))  update.firstGapMs  = Math.max(1000, +req.body.firstGapMs);

    const doc = await NudgeTask.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
    if (!doc) return res.status(404).json({ error: "task not found" });

    return res.json({ ok: true, task: doc });
  } catch (e) {
    console.error("/nudges/tasks PATCH error:", e);
    return res.status(500).json({ error: "server error" });
  }
});

// ===== Force-run all currently due tasks (handy button) =====
app.post("/nudges/flush-due", async (req, res) => {
  try {
    const limit = Number(req.body?.limit) || 50;
    const now = new Date();
    const due = await NudgeTask.find({ status: "active", nextAt: { $lte: now } })
      .sort({ nextAt: 1 })
      .limit(limit)
      .lean();

    let processed = 0;
    for (const t of due) {
      await handleTaskSend(t);
      processed++;
    }
    return res.json({ ok: true, processed });
  } catch (e) {
    console.error("/nudges/flush-due error:", e);
    return res.status(500).json({ error: "server error" });
  }
});

// ===== Recent SMS logs (optional, all users) =====
// Shows the latest Twilio sends across everyone (if you want a feed)
app.get("/sms/logs", async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const lim = Math.min(parseInt(limit) || 50, 200);
    const items = await SmsLog.find().sort({ createdAt: -1 }).limit(lim).lean();
    return res.json({ ok: true, items });
  } catch (e) {
    console.error("/sms/logs error:", e);
    return res.status(500).json({ error: "server error" });
  }
});


// ====== PROGRESS ======
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
      unlockedCount: Number.isFinite(doc.unlockedCount) ? doc.unlockedCount : 1,
      activeIndex: Number.isFinite(doc.activeIndex)   ? doc.activeIndex   : 0,
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

    const old = await ProgressState.findOne({ userId }).lean();

    completed    = normalizeBoolArray(completed);
    unlockedCount= Number.isFinite(+unlockedCount) ? Math.max(0, +unlockedCount) : 1;
    activeIndex  = Number.isFinite(+activeIndex)   ? Math.max(0, +activeIndex)   : 0;
    benefits     = Array.isArray(benefits) ? benefits.map(String) : [];

    const doc = await ProgressState.findOneAndUpdate(
      { userId },
      { $set: { completed, unlockedCount, activeIndex, benefits } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    // stop any legacy Nudge docs if you still use them (optional)
    const progressed =
      (old && (Number(activeIndex) > Number(old?.activeIndex) ||
               Number(unlockedCount) > Number(old?.unlockedCount))) ||
      (!old && (activeIndex > 0 || unlockedCount > 1));

    if (progressed) {
      // if you still store old Nudge docs:
      // await Nudge.findOneAndUpdate({ userId, stopped: false }, { $set: { stopped: true, stopReason: "progress" } }).catch(()=>{});
      // NudgeTask version doesn’t need a kill switch here—the worker checks completion each run.
    }

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

// ====== BOT/RESPONSES/EMAIL (unchanged behavior) ======
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
  const tagsArray = (tags || []).map((t) => TAGS[t]).filter(Boolean);
  const transformedEmail = email ? String(email).toLowerCase() : "";
  const response = await Response.create({
    fullName, email: transformedEmail, age,
    userId: user_id, zipCode: zipcode, tags: tagsArray,
    origin, sendMessageOn, number
  });
  return res.status(200).json({ data: response });
});

app.post("/api/update-record", async (req, res) => {
  const { userId, isPaymentSuccess } = req.body;
  try {
    const updated = await Response.findOneAndUpdate(
      { userId }, { isPaymentSuccess }, { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Response not found" });
    return res.status(200).json({ data: updated });
  } catch (e) {
    console.error("update response error:", e);
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
    if (!name || typeof name !== "string") return res.status(400).json({ error: "name is required in query" });
    const value = String(name).trim();
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let doc = await Response.findOne({ userId: value });
    if (!doc) {
      doc = await Response.findOne({ fullName: new RegExp("^" + escapeRegex(value) + "\\s*$", "i") });
    }
    if (!doc) return res.status(404).json({ error: "No offer found for provided name/userId" });
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

app.post("/api/messages", async (req, res) => {
  const { userId, replies, qualifiedFor } = req.body;
  if (!Array.isArray(replies)) return res.status(400).json({ error: "messages must be an array" });

  const isQualified = !!(qualifiedFor && Object.keys(qualifiedFor).length);
  const responses = await UserResponse.create({
    userId, responses: replies, qualifiedFor: qualifiedFor || {}, isQualified
  });
  if (!responses) return res.status(500).json({ error: "Failed to save responses" });
  return res.status(200).json({ data: responses, message: "Responses saved successfully" });
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

app.get("/api/messages/:userId", async (req, res) => {
  const { userId } = req.params;
  const responses = await UserResponse.findOne({ userId });
  if (!responses) return res.status(404).json({ error: "No responses found" });
  return res.status(200).json({ data: responses });
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

// ====== LEMON / STRIPE CHECKOUT ======
app.post("/api/create-checkout", async (req, res) => {
  const { variantId } = req.body;
  try {
    const resp = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`,
      },
      body: JSON.stringify({
        data: {
          type: "checkouts",
          attributes: {
            custom_price: 10,
            checkout_options: { embed: true },
            product_options: { redirect_url: process.env.AFTER_PAY_REDIRECT },
          },
          relationships: {
            store:   { data: { type: "stores",   id: process.env.STORE_ID?.toString() } },
            variant: { data: { type: "variants", id: variantId?.toString() } },
          },
        },
      }),
    });
    const json = await resp.json();
    if (!json?.data?.attributes?.url) {
      console.error("Invalid Lemon API response:", json);
      return res.status(500).json({ error: "Invalid Lemon API response" });
    }
    return res.json({ url: json.data.attributes.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "checkout creation failed" });
  }
});

app.post("/api/create-checkout-session", async (req, res) => {
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
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe Error:", err.message);
    return res.status(500).json({ error: "Unable to create Stripe session", message: err.message });
  }
});

// ====== RAG DEMO ======
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

// ====== STRIPE WEBHOOK ======
app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { customer_email: email, metadata } = session;
    const { userId, name } = metadata;

    try {
      await axios.post("https://benifit-gpt-be.onrender.com/api/update-record", {
        userId, isPaymentSuccess: true,
      });
    } catch (e) { console.error("Failed to update record:", e.message); }

    try {
      await axios.post("https://benifit-gpt-be.onrender.com/email/submit", {
        email, name, userId,
      });
    } catch (e) { console.error("Failed to send email:", e.message); }
  }

  return res.status(200).json({ received: true });
});

// ====== ANALYTICS ======
app.set("trust proxy", true);
function getIp(req){
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null;
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

// ====== EMAIL LIST ======
app.post("/email", async (req, res) => {
  const { email } = req.body;
  const response = await Email.create({ email });
  return res.status(200).json({ data: response });
});
app.get("/email", async (_req, res) => {
  const emails = await Email.find({});
  return res.status(200).json({ data: emails });
});

// ====== SERVER ======
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
