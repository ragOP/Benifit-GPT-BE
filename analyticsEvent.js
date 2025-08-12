// analyticsEvent.js
const mongoose = require("mongoose");

const AnalyticsEventSchema = new mongoose.Schema(
  {
    // who/what
    userId: { type: String, default: null },         // optional if you have a userId
    sessionId: { type: String, default: null },      // optional; you can send a random UUID from FE

    // what happened
    type: {
      type: String,
      enum: ["page_view", "button_click", "page_visit"],
      required: true,
    },

    // context
    page: { type: String, default: null },           // e.g. "/"
    buttonId: { type: String, default: null },       // e.g. "cta-1"
    meta: { type: Object, default: {} },             // any extra info you want

    // request metadata
    ip: { type: String, default: null },
    ua: { type: String, default: null },
    referrer: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AnalyticsEvent", AnalyticsEventSchema);
