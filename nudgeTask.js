// models/nudgeTask.js
const mongoose = require("mongoose");

const NudgeTaskSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true, required: true },
    to: { type: String, required: true }, // E.164 number, e.g. +13322097232
    fullName: { type: String, default: "User" },

    // which step we’re nudging (0 = first benefit tab, 1 = second, etc.)
    stepIndex: { type: Number, required: true },

    // schedule state
    status: { type: String, enum: ["active", "done"], default: "active", index: true },
    attempts: { type: Number, default: 0 }, // how many nudges sent for this step
    maxAttempts: { type: Number, default: 5 }, // cap at 5 total for each step

    // next due time to send (Date)
    nextAt: { type: Date, required: true },

    // last time an SMS went out for this step
    lastSentAt: { type: Date, default: null },

    // cached for building messages
    benefitKey: { type: String, default: "" }, // e.g. "Medicare", "Debt", "Auto", "MVA", etc.
    claimUrl: { type: String, default: "" },   // https://mybenefitsai.org/claim/<userId>
  },
  { timestamps: true }
);

NudgeTaskSchema.index({ status: 1, nextAt: 1 });
NudgeTaskSchema.index({ userId: 1, stepIndex: 1 }, { unique: true });

module.exports = mongoose.model("NudgeTask", NudgeTaskSchema);
