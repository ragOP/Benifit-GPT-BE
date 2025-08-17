// smsLog.js
const mongoose = require("mongoose");

const SmsLogSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true },
    to: { type: String, required: true, index: true },
    body: { type: String, required: true },
    sid: { type: String, default: null },
    status: {
      type: String,
      enum: ["queued", "sent", "failed"],
      default: "queued",
    },
    error: { type: String, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.SmsLog || mongoose.model("SmsLog", SmsLogSchema);
