const mongoose = require("mongoose");

const userResponseSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    responses: {
      type: [String],
      required: true,
    },
    qualifiedFor: {
      type: {
        medicare: { type: Boolean, default: false },
        creditDebtRelief: { type: Boolean, default: false },
        discountedAutoInsurancePlan: { type: Boolean, default: false },
        higherCompensationForAccidents: { type: Boolean, default: false },
        aca: { type: Boolean, default: false },
      },
    },
    isQualified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const UserResponse = mongoose.model("UserResponse", userResponseSchema);
module.exports = UserResponse;
