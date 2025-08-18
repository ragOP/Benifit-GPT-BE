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
  return null; // no more
}

// one place for the immediate (landing) template
function buildImmediateLandingMessage({ fullName = "Friend", userId = "unknown" }) {
  const link = `https://mybenefitsai.org/claim/${encodeURIComponent(userId)}`;
  return `You still have unclaimed benefits waiting. They expire soon—claim them now: ${link} Reply STOP to opt out.`;
}

// step follow-up template (worker sends these 2)
function buildFollowupMessage({ fullName = "Friend", userId = "unknown" }) {
  const link = `https://mybenefitsai.org/claim/${encodeURIComponent(userId)}`;
  return `Reminder for ${fullName}: finish claiming your benefits here: ${link} Reply STOP to opt out.`;
}

module.exports.attachNudges = function attachNudges(app, deps) {
  const {
    NudgeTask,
    ProgressState,
    SmsLog,
    twilioClient,
    TWILIO_FROM,
  } = deps;

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

  // POST /nudges/init
  // body: { userId, to, fullName }
  // - returns immediateMessage for FE to send NOW
  // - creates a single task to drive the 2 worker nudges (3m then +4m)
  app.post("/nudges/init", async (req, res) => {
    try {
      const { userId, to, fullName = "User" } = req.body || {};
      if (!userId || !to) return res.status(400).json({ error: "userId and to are required" });

      const claimUrl = `https://mybenefitsai.org/claim/${encodeURIComponent(userId)}`;
      const nextAt = computeNextAt(0, Date.now());

      // upsert a ONE-step task that will send 2 follow-ups (attempts: 0 -> 3m, 1 -> +4m)
      const task = await NudgeTask.findOneAndUpdate(
        { userId, stepIndex: 0 },
        {
          $set: { to, fullName, benefitKey: "Landing", claimUrl },
          $setOnInsert: {
            status: "active",
            attempts: 0,
            maxAttempts: 2,  // only 2 worker sends (since first was immediate)
            nextAt,          // first due in 3 minutes
          },
        },
        { new: true, upsert: true }
      ).lean();

      const immediateMessage = buildImmediateLandingMessage({ fullName, userId });
      return res.json({
        ok: true,
        immediateMessage,
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

  // GET /nudges/tasks  (list all tasks, optional filters)
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

  // GET /nudges/overview (global, shows counts + due now)
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
        dueNow: tasks.filter(t => t.status === "active" && t.nextAt && t.nextAt <= now).length,
        sentSms: sent,
        failedSms: failed,
      };

      res.json({ ok: true, counts });
    } catch (e) {
      console.error("/nudges/overview error:", e);
      res.status(500).json({ error: "server error" });
    }
  });

  // GET /sms/logs?limit=50 (latest logs across everyone)
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

  // POST /nudges/flush-due  (manual button to run due items)
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

  // ========== WORKER ==========

  async function handleTaskSend(task) {
    if (!task || task.status !== "active") return;

    const nowMs = Date.now();
    if (task.nextAt && task.nextAt.getTime() > nowMs) return; // not due yet

    // Send follow-up (attempt 0 or 1)
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

  // expose for tests if needed
  return { runWorker, handleTaskSend, buildImmediateLandingMessage };
};
