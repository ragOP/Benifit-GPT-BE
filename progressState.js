// progressState.js
const mongoose = require("mongoose");

const ProgressStateSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true, unique: true },

    // UI state
    completed: { type: [Boolean], default: [] },     // e.g., [true,false,false]
    unlockedCount: { type: Number, default: 1 },     // how many are unlocked
    activeIndex: { type: Number, default: 0 },       // current active tab

    // Optional snapshot of benefits on that visit (keys like "Medicare","Debt")
    benefits: { type: [String], default: [] },

    // Free-form metadata if you want to store extras later
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.models.ProgressState || mongoose.model("ProgressState", ProgressStateSchema);
