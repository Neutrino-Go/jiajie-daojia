const BLOCKED_CATEGORIES = new Set(["money", "settlement", "payout", "payment", "refund"]);
const BLOCKED_TYPES = new Set([
  "adjust_pricing",
  "adjust_payout",
  "create_payment",
  "force_refund",
  "refund_order",
  "settle_order",
]);

const SAFE_TYPES = new Set([
  "adjust_cleaner_ranking",
  "pricing_weight_adjustment",
  "supply_throttling",
  "visibility_adjustment",
]);

function evaluateGuardrails(action = {}) {
  const type = String(action.type || "");
  const category = String(action.category || "");

  if (BLOCKED_TYPES.has(type) || BLOCKED_CATEGORIES.has(category)) {
    return {
      decision: "REJECT",
      reason: "Financial, settlement, payout, payment, and refund actions are blocked.",
    };
  }

  if (!SAFE_TYPES.has(type)) {
    return {
      decision: "REJECT",
      reason: "Action type is not in the low-risk autonomous allowlist.",
    };
  }

  if (action.riskLevel === "high" || action.riskLevel === "critical" || Number(action.riskScore || 0) >= 70) {
    return {
      decision: action.approved ? "ALLOW" : "NEED_APPROVAL",
      reason: action.approved ? "High-risk action has explicit approval." : "High-risk action requires approval.",
    };
  }

  return {
    decision: "ALLOW",
    reason: "Action is low-risk and reversible.",
  };
}

module.exports = {
  evaluateGuardrails,
};
