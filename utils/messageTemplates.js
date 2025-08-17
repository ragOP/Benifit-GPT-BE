// utils/messageTemplates.js

// map benefit key -> your copy
const COPY = {
  Medicare: 'Your $168/mo Food Allowance Card is waiting. Claim it now for groceries, gas, or rent:',
  Debt: 'You’re approved for 100% debt relief, still unclaimed. Claim it here before it’s gone:',
  MVA: 'Up to $100,000 accident payout unclaimed. Secure your benefit now:',
  Auto: 'Discounted auto insurance with same coverage is waiting. Lock in your savings:',
  // If you ever use these:
  "Free Health": 'Free health coverage + $500/mo grocery allowance still unclaimed. Activate now:',
  "Reverse Mortgage": 'Approved for $100,000 homeowner payout, but unclaimed. Claim it today:',
  SSDI: 'Your SSDI benefit (worth up to $4,018/mo) is unclaimed. Secure it today:',
};

// fallback line when we don’t recognize the tag
const FALLBACK = 'You are eligible for benefits we found for you. Start here:';

function buildStepMessage({ fullName = "User", benefitKey = "", claimUrl }) {
  const line = COPY[benefitKey] || FALLBACK;
  return (
    `Hey ${fullName}! ${line} ${claimUrl}\n` +
    `Texts are optional. Reply STOP to opt out, HELP for help. Msg & data rates may apply.`
  );
}

// the “combined” first-time message you asked for
function buildCombinedFirstMessage({ userId, fullName = "User" }) {
  const claimUrl = `https://mybenefitsai.org/claim/${encodeURIComponent(userId)}`;
  return (
    `Hey ${fullName}! You are eligible for benefits we found for you. Start here: ${claimUrl}\n` +
    `Texts are optional. Reply STOP to opt out, HELP for help. Msg & data rates may apply.`
  );
}

module.exports = { buildStepMessage, buildCombinedFirstMessage };
