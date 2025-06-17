const mongoose = require("mongoose");

const chatbotResponseSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    age: { type: String, required: true },
    zipcode: { type: String, required: true },
    email: { type: String, required: true },
    medicare: { type: String, required: true },
    healthConditions: { type: String, required: true },
    housingStatus: { type: String, required: true },
    drivesWeekly: { type: String, required: true },
    accidents: { type: String, required: true },
    hasChildren: { type: String, required: true },
    creditCardDebt: { type: String, required: true },
    exercises: { type: String, required: true },
  },
  {
    timestamps: true,
  }
);

const ChatbotResponse = mongoose.model("ChatbotResponse", chatbotResponseSchema);
module.exports = ChatbotResponse;
