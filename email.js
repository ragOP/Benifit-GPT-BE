const mongoose = require("mongoose");

const emailResponse = new mongoose.Schema(
  {
    email: { type: String, required: true },
  },
  {
    timestamps: true,
  }
);

const Email = mongoose.model("emailResponse", emailResponse);
module.exports = Email;
