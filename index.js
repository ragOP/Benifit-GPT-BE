const express = require("express");
const app = express();
require("dotenv").config();


const PORT = process.env.PORT || 5000;
const cors = require("cors");


const UserResponse = require("./userResponse");
const { connectToDatabase } = require("./db");

app.use(express.json());
app.use(cors());
const answerSchema = new mongoose.Schema({}, { strict: false });
const Answer = mongoose.model("Answer", answerSchema);
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

app.post("/api/submit", async (req, res) => {
  try {
    const data = req.body;
    const newAnswer = new Answer(data);
    await newAnswer.save();
    res.status(200).json({ message: "Answers saved!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to save answers" });
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

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
