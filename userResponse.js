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
      type: [String],
      default: null,
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
