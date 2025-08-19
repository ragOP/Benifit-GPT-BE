// nudges/index.js
const express = require("express");

// ----- schedule you asked for -----
// msg #1: sent immediately by FE (template below)
// msg #2: 3 minutes after page load (attempts 0 -> due in 3m)
// msg #3: 4 minutes after the 2nd message (attempts 1 -> +4m)
const MINUTE = 60 * 1000;
const GAP_AFTER_FIRST  = 3 * MINUTE; // to 2nd message
const GAP_AFTER_SECOND = 4 * MINUTE; // to 3rd message

function computeNextAt(attempts, from = Date.now()) {
  if (attempts === 0) return new Date(from + GAP_AFTER_FIRST);
  if (attempts === 1) return new Date(from + GAP_AFTER_SECOND);
  return null; // no more sends
}

// immediate (landing) template
function buildImmediateLandingMessage({ fullName = "Friend", userId = "unknown" }) {
  const link = `https://mybenefitsai.org/claim/${encodeURIComponent(userId)}`;
  return `You still have unclaimed benefits waiting. They expire soon—claim them now: ${link} Reply STOP to opt out.`;
}

// follow-up template (worker sends the 2 follow-ups)
function buildFollowupMessage({ fullName = "Friend", userId = "unknown" }) {
  const link = `https://mybenefitsai.org/claim/${encodeURIComponent(userId)}`;
  return `Reminder for ${fullName}: finish claiming your benefits here: ${link} Reply STOP to opt out.`;
}

// ------------------------------------------------------------------

function coerceDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function isDue(nextAt, now = new Date()) {
  const d = coerceDate(nextAt);
  return !!(d && d.getTime() <= now.getTime());
}

module.exports.attachNudges = function attachNudges(app, deps) {
  const {
    NudgeTask,      // Mongoose model with fields: userId, to, fullName, attempts(Number), maxAttempts(Number), status('active'|'done'), nextAt(Date), lastSentAt(Date), lastSid(String), lastError(String), benefitKey(String), claimUrl(String), stepIndex(Number)
    SmsLog,         // Mongoose model with { userId, to, body, status: 'queued'|'sent'|'failed', sid?, error?, createdAt }, with timestamps: true
    twilioClient,   // Twilio client
    TWILIO_FROM,    // E.164 number
  } = deps;
// server.js (or index.js of your Express app)
const path = require("path");

// Serve the admin UI
app.get("/nudges/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "nudges-admin.html"));
});

  // low-level SMS helper with logging
  async function sendSmsLogged({ userId, to, body, meta = {} }) {
    if (!twilioClient || !TWILIO_FROM) throw new Error("Twilio not configured");
    const queued = await SmsLog.create({
      userId: userId || null,
      to, body,
      status: "queued",
      meta,
    }).catch(() => null);

    try {
      const msg = await twilioClient.messages.create({ to, from: TWILIO_FROM, body });
      if (queued) await SmsLog.findByIdAndUpdate(queued._id, { status: "sent", sid: msg.sid });
      return msg.sid;
    } catch (err) {
      if (queued) await SmsLog.findByIdAndUpdate(queued._id, { status: "failed", error: err?.message || "send failed" });
      throw err;
    }
  }

  // ========== ROUTES ==========

  /**
   * POST /nudges/init
   * body: { userId, to, fullName, resetOnReinit=true }
   * - Creates a task if none exists.
   * - If a task exists and is "done" (or resetOnReinit=true), it resets to active (attempts=0, nextAt=+3m).
   * - Returns the immediate landing message for FE to send.
   */
  app.post("/nudges/init", async (req, res) => {
    try {
      const { userId, to, fullName = "User", resetOnReinit = true } = req.body || {};
      if (!userId || !to) return res.status(400).json({ error: "userId and to are required" });

      const claimUrl = `https://mybenefitsai.org/claim/${encodeURIComponent(userId)}`;
      const existing = await NudgeTask.findOne({ userId, stepIndex: 0 }).lean();

      let task;

      if (!existing) {
        // brand new task
        task = await NudgeTask.create({
          userId, to, fullName,
          benefitKey: "Landing",
          claimUrl,
          stepIndex: 0,        // keep 0 for the “landing” step
          status: "active",    // IMPORTANT: active until all follow-ups sent
          attempts: 0,
          maxAttempts: 2,      // two worker sends (FE already sent the landing SMS)
          nextAt: computeNextAt(0, Date.now()), // first follow-up in 3 minutes
        });
      } else {
        // update contact fields
        const update = { to, fullName, claimUrl, benefitKey: "Landing" };

        // decide whether to reset attempts/nextAt
        if (resetOnReinit || existing.status !== "active") {
          update.status = "active";
          update.attempts = 0;
          update.maxAttempts = 2;
          update.nextAt = computeNextAt(0, Date.now());
          update.lastError = null;
        }

        await NudgeTask.updateOne({ _id: existing._id }, { $set: update });
        task = await NudgeTask.findById(existing._id).lean();
      }

      const immediateMessage = buildImmediateLandingMessage({ fullName, userId });

      return res.json({
        ok: true,
        immediateMessage, // FE should send this right away
        plan: {
          userId: task.userId,
          to: task.to,
          fullName: task.fullName,
          attempts: task.attempts,
          maxAttempts: task.maxAttempts,
          nextAt: task.nextAt,
          status: task.status,
        },
      });
    } catch (e) {
      console.error("/nudges/init error:", e);
      return res.status(500).json({ error: "server error" });
    }
  });

  /**
   * GET /nudges/tasks
   * Query: q, status, page, limit, sort
   */
  app.get("/nudges/tasks", async (req, res) => {
    try {
      const {
        q = "",
        status,
        page = 1,
        limit = 25,
        sort = "-nextAt",
      } = req.query;

      const lim = Math.min(parseInt(limit) || 25, 200);
      const skip = Math.max(((parseInt(page) || 1) - 1) * lim, 0);
      const find = {};
      if (status) find.status = status;

      if (q) {
        const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        find.$or = [{ userId: rx }, { to: rx }, { fullName: rx }, { benefitKey: rx }];
      }

      const [items, total] = await Promise.all([
        NudgeTask.find(find).sort(sort).skip(skip).limit(lim).lean(),
        NudgeTask.countDocuments(find),
      ]);

      res.json({ ok: true, total, page: parseInt(page) || 1, perPage: lim, items });
    } catch (e) {
      console.error("/nudges/tasks error:", e);
      res.status(500).json({ error: "server error" });
    }
  });

  /**
   * GET /nudges/overview
   * Global counters with safer date handling
   */
  app.get("/nudges/overview", async (_req, res) => {
    try {
      const [tasks, sent, failed] = await Promise.all([
        NudgeTask.find({}).lean(),
        SmsLog.countDocuments({ status: "sent" }),
        SmsLog.countDocuments({ status: "failed" }),
      ]);

      const now = new Date();

      const counts = {
        totalTasks: tasks.length,
        active: tasks.filter(t => t.status === "active").length,
        done: tasks.filter(t => t.status === "done").length,
        dueNow: tasks.filter(t => t.status === "active" && isDue(t.nextAt, now)).length,
        sentSms: sent,
        failedSms: failed,
      };

      res.json({ ok: true, counts, now });
    } catch (e) {
      console.error("/nudges/overview error:", e);
      res.status(500).json({ error: "server error" });
    }
  });

  /**
   * GET /sms/logs
   * Query: limit
   */
  app.get("/sms/logs", async (req, res) => {
    try {
      const lim = Math.min(parseInt(req.query.limit) || 50, 200);
      const items = await SmsLog.find().sort({ createdAt: -1 }).limit(lim).lean();
      res.json({ ok: true, items });
    } catch (e) {
      console.error("/sms/logs error:", e);
      res.status(500).json({ error: "server error" });
    }
  });

  /**
   * POST /nudges/flush-due
   * body: { limit? }
   * Processes up to `limit` due tasks right now.
   */
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
      res.json({ ok: true, processed });
    } catch (e) {
      console.error("/nudges/flush-due error:", e);
      res.status(500).json({ error: "server error" });
    }
  });

  /**
   * POST /nudges/send-now
   * body: { userId }
   * Sends a follow-up immediately (ignores schedule), and advances attempts.
   */
  app.post("/nudges/send-now", async (req, res) => {
    try {
      const { userId } = req.body || {};
      if (!userId) return res.status(400).json({ error: "userId required" });

      const task = await NudgeTask.findOne({ userId, stepIndex: 0 }).lean();
      if (!task) return res.status(404).json({ error: "task not found" });

      await handleTaskSend({ ...task, nextAt: new Date(0) }); // force due
      const latest = await NudgeTask.findById(task._id).lean();
      res.json({ ok: true, plan: latest });
    } catch (e) {
      console.error("/nudges/send-now error:", e);
      res.status(500).json({ error: "server error" });
    }
  });

  /**
   * POST /nudges/cancel
   * body: { userId }
   * Cancels a task (marks done & clears nextAt).
   */
  app.post("/nudges/cancel", async (req, res) => {
    try {
      const { userId } = req.body || {};
      if (!userId) return res.status(400).json({ error: "userId required" });

      const task = await NudgeTask.findOneAndUpdate(
        { userId, stepIndex: 0 },
        { $set: { status: "done", nextAt: null } },
        { new: true }
      ).lean();

      if (!task) return res.status(404).json({ error: "task not found" });
      res.json({ ok: true, plan: task });
    } catch (e) {
      console.error("/nudges/cancel error:", e);
      res.status(500).json({ error: "server error" });
    }
  });

  /**
   * POST /nudges/requeue
   * body: { userId }
   * Re-activates a done task (attempts remain; nextAt = computeNextAt(attempts))
   */
  app.post("/nudges/requeue", async (req, res) => {
    try {
      const { userId } = req.body || {};
      if (!userId) return res.status(400).json({ error: "userId required" });

      const task = await NudgeTask.findOne({ userId, stepIndex: 0 }).lean();
      if (!task) return res.status(404).json({ error: "task not found" });

      if (task.status === "active") {
        return res.json({ ok: true, plan: task, note: "already active" });
      }

      const nextAt = computeNextAt(task.attempts ?? 0, Date.now());
      await NudgeTask.updateOne(
        { _id: task._id },
        { $set: { status: "active", nextAt, lastError: null } }
      );
      const latest = await NudgeTask.findById(task._id).lean();
      res.json({ ok: true, plan: latest });
    } catch (e) {
      console.error("/nudges/requeue error:", e);
      res.status(500).json({ error: "server error" });
    }
  });

  // ========== WORKER ==========

  async function handleTaskSend(task) {
    if (!task || task.status !== "active") return;

    const nowMs = Date.now();
    const due = !task.nextAt || coerceDate(task.nextAt)?.getTime() <= nowMs;
    if (!due) return; // not due yet

    const text = buildFollowupMessage({ fullName: task.fullName, userId: task.userId });

    try {
      const sid = await sendSmsLogged({
        userId: task.userId, to: task.to, body: text,
        meta: { taskId: String(task._id), attempt: (task.attempts || 0) }
      });

      const attempts = (task.attempts || 0) + 1;
      const nextAt   = computeNextAt(attempts, Date.now());

      if (attempts >= (task.maxAttempts || 2) || !nextAt) {
        await NudgeTask.findByIdAndUpdate(task._id, {
          $set: {
            attempts,
            lastSentAt: new Date(),
            lastSid: sid,
            lastError: null,
            status: "done",
            nextAt: null,
          },
        });
      } else {
        await NudgeTask.findByIdAndUpdate(task._id, {
          $set: {
            attempts,
            lastSentAt: new Date(),
            lastSid: sid,
            lastError: null,
            status: "active",           // keep active until final attempt
            nextAt,
          },
        });
      }
    } catch (err) {
      console.error("nudge send failed:", err?.message || err);
      // backoff 1 minute on failure
      await NudgeTask.findByIdAndUpdate(task._id, {
        $set: {
          lastError: err?.message || String(err),
          nextAt: new Date(Date.now() + 1 * MINUTE),
        },
      });
    }
  }

  async function runWorker() {
    try {
      const now = new Date();
      const due = await NudgeTask.find({
        status: "active",
        nextAt: { $lte: now },
      }).sort({ nextAt: 1 }).limit(100).lean();

      for (const t of due) await handleTaskSend(t);
    } catch (e) {
      console.error("nudge worker error:", e);
    }
  }

  // single global worker
  setInterval(runWorker, 10 * 1000);

  return { runWorker, handleTaskSend, buildImmediateLandingMessage };
};
