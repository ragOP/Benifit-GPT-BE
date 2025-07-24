const express = require("express");
const axios = require("axios");
const app = express();
require("dotenv").config();

const PORT = process.env.PORT || 5000;
const cors = require("cors");

const UserResponse = require("./userResponse");
const ChatbotResponse = require("./ChatbotResponse");
const { connectToDatabase } = require("./db");
const Email = require("./email");
const Response = require("./response");

app.use(express.json());
app.use(cors());

(async () => {
  await connectToDatabase();
})();

app.post("/api/messages", async (req, res) => {
  const { userId, replies, qualifiedFor } = req.body;

  console.log("Request body:", req.body);
  console.log("Qualified For:", qualifiedFor);
  console.log("Qualified For keys:", Object.keys(qualifiedFor));

  console.log("User ID:", userId);

  let isQualified = false;

  if (Object.keys(qualifiedFor).length > 0) {
    isQualified = true;
  }

  if (!Array.isArray(replies)) {
    return res.status(400).json({ error: "messages must be an array" });
  }

  // const userMessages = messages
  //   .filter((msg) => msg.type === "user")
  //   .map((msg) => msg.text);

  const responses = await UserResponse.create({
    userId: userId,
    responses: replies,
    qualifiedFor: qualifiedFor,
    isQualified: isQualified,
  });
  if (!responses) {
    return res.status(500).json({ error: "Failed to save responses" });
  }
  return res
    .status(200)
    .json({ data: responses, message: "Responses saved successfully" });
});

app.get("/api/messages", async (req, res) => {
  try {
    const allResponses = await UserResponse.find({});
    return res.status(200).json({ data: allResponses });
  } catch (error) {
    console.error("Error fetching all responses:", error);
    return res.status(500).json({ error: "Failed to fetch responses" });
  }
});

app.post("/api/chatbot", async (req, res) => {
  try {
    const newEntry = new ChatbotResponse(req.body);
    await newEntry.save();
    res.status(200).json({ message: "Chatbot response saved ✅" });
  } catch (err) {
    console.error("Error saving chatbot response:", err);
    res.status(500).json({ error: "Server error ❌" });
  }
});

app.get("/api/chatbot", async (req, res) => {
  try {
    const responses = await ChatbotResponse.find().sort({ createdAt: -1 });
    res.status(200).json(responses);
  } catch (err) {
    console.error("Error fetching chatbot responses:", err);
    res.status(500).json({ error: "Failed to fetch chatbot responses" });
  }
});

app.get("/chatbotmessages", async (req, res) => {
  try {
    const responses = await ChatbotResponse.find().sort({ createdAt: -1 });
    res.status(200).json(responses);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch chatbot responses" });
  }
});
app.get("/api/messages/:userId", async (req, res) => {
  const { userId } = req.params;
  console.log("User ID:", userId);

  const responses = await UserResponse.findOne({ userId: userId });
  console.log(responses);
  if (!responses) {
    return res.status(404).json({ error: "No responses found" });
  }
  return res.status(200).json({ data: responses });
});

app.post("/email", async (req, res) => {
  const { email } = req.body;
  const response = await Email.create({
    email,
  });
  return res.status(200).json({ data: response });
});

app.get("/email", async (req, res) => {
  const emails = await Email.find({});
  return res.status(200).json({ data: emails });
});

const TAGS = {
  is_md: "Medicare",
  is_ssdi: "SSDI",
  is_auto: "Auto",
  is_mva: "MVA",
  is_debt: "Debt",
  is_rvm: "Reverse Mortgage",
};

app.post("/response/create", async (req, res) => {
  const { fullName, email, age, user_id, zipcode, tags } = req.body;
  const tagsArray = tags.map((tag) => {
    return TAGS[tag];
  });
  const transformedEmail = email.toLowerCase();
  const response = await Response.create({
    fullName,
    email: transformedEmail,
    age,
    userId: user_id,
    zipCode: zipcode,
    tags: tagsArray,
  });
  return res.status(200).json({ data: response });
});

app.get("/response/all", async (req, res) => {
  const response = await Response.find({});
  return res.status(200).json({ data: response });
});

app.get("/check/offer", async (req, res) => {
  const { userId } = req.query;
  const response = await Response.findOne({ userId: userId });
  return res.status(200).json({ data: response });
});

app.post("/email/submit", async (req, res) => {
  const { email, name, userId } = req.body;

  try {
    const response = await axios.post(
      "https://api.brevo.com/v3/contacts",
      {
        email,
        attributes: {
          FIRSTNAME: name,
          LASTNAME: email,
          USER_ID: userId,
        },
        listIds: [5],
        updateEnabled: true,
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
