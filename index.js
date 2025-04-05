const express = require("express");
const app = express();
const PORT = 5000;
const cors = require("cors");
const UserResponse = require("./userResponse");
const { connectToDatabase } = require("./db");

app.use(express.json());
app.use(cors());

(async () => {
  await connectToDatabase();
})();

app.post("/api/messages", async (req, res) => {
  const { userId, messages, qualifiedFor } = req.body;

    console.log("User ID:", userId);

  let isQualified = false;

  if (qualifiedFor.length > 0) {
    isQualified = true;
  }

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "messages must be an array" });
  }

  const userMessages = messages
    .filter((msg) => msg.type === "user")
    .map((msg) => msg.text);

  const responses = await UserResponse.create({
    userId: userId,
    responses: userMessages,
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
