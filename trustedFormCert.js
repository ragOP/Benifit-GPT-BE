// trustedFormCert.js
const mongoose = require("mongoose");

const TrustedFormCertSchema = new mongoose.Schema(
  {
    cert_url: { type: String, required: true, index: true, unique: true },
    reference: { type: String, index: true }, // your user/lead id
    vendor: { type: String },
    email: { type: String },
    phone: { type: String },

    // claim result
    claimed: { type: Boolean, default: false },
    statusCode: { type: Number, default: null },     // HTTP status from TF
    tf_response: { type: mongoose.Schema.Types.Mixed }, // raw JSON from TF on success
    error: { type: String, default: null },           // error message if any
  },
  { timestamps: true }
);

module.exports = mongoose.model("TrustedFormCert", TrustedFormCertSchema);
