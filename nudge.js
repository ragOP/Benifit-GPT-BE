// nudge.js
const mongoose = require("mongoose");

const NudgeSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true, required: true, unique: true },
    to: { type: String, required: true },         // E.164 phone
    fullName: { type: String, default: "User" },
    tags: { type: [String], default: [] },

    // plan config
    firstDelayMin: { type: Number, default: 90 }, // first reminder in 90m
    intervalMin:   { type: Number, default: 30 }, // then every 30m
    maxSends:      { type: Number, default: 5 },  // stop after 5 sends

    // runtime
    sendCount:   { type: Number, default: 0 },
    nextAt:      { type: Date, default: null },
    stopped:     { type: Boolean, default: false },
    stopReason:  { type: String, default: null },

    lastSentAt:  { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Nudge || mongoose.model("Nudge", NudgeSchema);
