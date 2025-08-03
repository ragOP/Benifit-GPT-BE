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
const Response2 = require("./response2");
const Response3 = require("./response3");

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

// -------------------------------------------------- BENIFIT GPT ROUTES -------------------------------------------------- ////////////////////////////////////////////////////////
const TAGS = {
  is_md: "Medicare",
  is_ssdi: "SSDI",
  is_auto: "Auto",
  is_mva: "MVA",
  is_debt: "Debt",
  is_rvm: "Reverse Mortgage",
};

app.post("/response/create", async (req, res) => {
  const { fullName, email, age, user_id, zipcode, tags, origin } = req.body;
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
    origin,
  });
  return res.status(200).json({ data: response });
});

app.get("/response/all", async (req, res) => {
  const response = await Response.find({});
  return res.status(200).json({ data: response });
});

app.get("/check/offer", async (req, res) => {
  const { name } = req.query;
  const response = await Response.findOne({
    fullName: new RegExp(`^${name}\\s*$`),
  });
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

// app.post("/response/create2", async (req, res) => {
//   const { fullName, email, age, user_id, zipcode, tags } = req.body;
//   const tagsArray = tags.map((tag) => {
//     return TAGS[tag];
//   });
//   const transformedEmail = email.toLowerCase();
//   const response = await Response2.create({
//     fullName,
//     email: transformedEmail,
//     age,
//     userId: user_id,
//     zipCode: zipcode,
//     tags: tagsArray,
//   });
//   return res.status(200).json({ data: response });
// });

// app.get("/response/all2", async (req, res) => {
//   const response = await Response2.find({});
//   return res.status(200).json({ data: response });
// });

// app.get("/check/offer2", async (req, res) => {
//   const { name } = req.query;
//   const response = await Response2.findOne({ fullName: name });
//   return res.status(200).json({ data: response });
// });

// app.post("/email/submit2", async (req, res) => {
//   const { email, name, userId } = req.body;

//   try {
//     const response = await axios.post(
//       "https://api.brevo.com/v3/contacts",
//       {
//         email,
//         attributes: {
//           FIRSTNAME: name,
//           LASTNAME: email,
//           USER_ID: userId,
//         },
//         listIds: [5],
//         updateEnabled: true,
//       },
//       {
//         headers: {
//           "api-key": process.env.BREVO_API_KEY,
//           "Content-Type": "application/json",
//         },
//       }
//     );

//     res.status(200).json({ success: true, data: response.data });
//   } catch (error) {
//     console.error(error.response?.data || error.message);
//     res.status(500).json({ success: false, error: error.response?.data });
//   }
// });

app.get("/check/model", async (req, res) => {
  const { fullName } = req.query;

  if (!fullName) {
    return res.status(400).json({ error: "fullName is required in query" });
  }

  try {
    const results = [];

    const r1 = await Response.findOne({ fullName });
    if (r1) results.push("Response");

    const r2 = await Response2.findOne({ fullName });
    if (r2) results.push("Response2");

   const r3 = await ChatbotResponse.findOne({ fullName });
    if (r3) results.push("ChatbotResponse");



    if (results.length === 0) {
      return res.status(404).json({ message: "Not found in any model" });
    }

    return res.status(200).json({ foundIn: results });
  } catch (err) {
    console.error("Error in /check/model:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post('/api/create-checkout', async (req, res) => {
  const { variantId } = req.body
  try {
    const resp = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`,
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            custom_price: 100,            // $1.00 in cents
            checkout_options: { embed: true }, // or false for hosted
            product_options: {
              redirect_url: process.env.AFTER_PAY_REDIRECT,
            },
          },
          relationships: {
            store: { data: { type: 'stores', id: process.env.STORE_ID.toString() } },
            variant: { data: { type: 'variants', id: variantId.toString() } },
          },
        },
      }),
    })
    const json = await resp.json()
 if (!json || !json.data || !json.data.attributes || !json.data.attributes.url) {
  console.error('Invalid Lemon API response:', json);
  return res.status(500).json({ error: 'Invalid Lemon API response' });
}

return res.json({ url: json.data.attributes.url });

  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'checkout creation failed' })
  }
})

// Lander third routes --->

// app.post("/email3", async (req, res) => {
//   const { email } = req.body;
//   const response = await Email.create({
//     email,
//   });
//   return res.status(200).json({ data: response });
// });

// app.post("/response/create3", async (req, res) => {
//   const { fullName, email, age, user_id, zipcode, tags } = req.body;
//   const tagsArray = tags.map((tag) => {
//     return TAGS[tag];
//   });
//   const transformedEmail = email.toLowerCase();
//   const response = await Response3.create({
//     fullName,
//     email: transformedEmail,
//     age,
//     userId: user_id,
//     zipCode: zipcode,
//     tags: tagsArray,
//   });
//   return res.status(200).json({ data: response });
// });

// app.get("/response/all3", async (req, res) => {
//   const response = await Response3.find({});
//   return res.status(200).json({ data: response });
// });


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
