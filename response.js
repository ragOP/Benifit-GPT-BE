const mongoose = require("mongoose");

const responseSchema = new mongoose.Schema({
    fullName: {
        type: String,
        default: ""
    },
    email: {
        type: String,
        default: ""
    },
    age: {
        type: Number,
        default: ""
    },
    userId: {
        type: String,
        default: ""
    },
    zipCode: {
        type: String,
        default: ""
    },
    tags: {
        type: [String],
        required: true
    },
    origin: {
        type: String,
        default: ""
    },
    sendMessageOn: {
        type: String,
        default: ""
    },
    isPaymentSuccess: {
        type: Boolean,
        default: false
    },
    number: {
        type: String,
        default: ""
    }
}, { timestamps: true });

const Response = mongoose.model("Response", responseSchema);

module.exports = Response;