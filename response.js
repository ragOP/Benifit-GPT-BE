const mongoose = require("mongoose");

const responseSchema = new mongoose.Schema({
    fullName: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    age: {
        type: Number,
        required: true
    },
    userId: {
        type: String,
        required: true
    },
    zipCode: {
        type: String,
        required: true
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
}, { timestamps: true });

const Response = mongoose.model("Response", responseSchema);

module.exports = Response;