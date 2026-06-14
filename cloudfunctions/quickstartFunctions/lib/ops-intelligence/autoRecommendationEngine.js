function hasType(insights = {}, type) {
  return (insights.anomalyTypes || []).includes(type);
}

function generateRecommendations(insights = {}) {
  const dispatchWeightSuggestions = [];
  const riskAreaSuggestions = [];
  const pricingSuggestions = [];
  const cleanerManagementSuggestions = [];

  if (hasType(insights, "risk_score_spike")) {
    riskAreaSuggestions.push({
      action: "recommend_only",
      type: "review_high_risk_segments",
      reason: "Average order risk increased.",
    });
    dispatchWeightSuggestions.push({
      action: "recommend_only",
      type: "lower_high_risk_order_priority",
      reason: "Risk signals increased; do not execute automatically.",
    });
  }

  if (hasType(insights, "gmv_drop")) {
    pricingSuggestions.push({
      action: "recommend_only",
      type: "review_city_service_price_conversion",
      reason: "GMV dropped materially; pricing change is recommendation only.",
    });
  }

  if (hasType(insights, "trust_score_drop") || hasType(insights, "cancellation_rate_spike")) {
    cleanerManagementSuggestions.push({
      action: "recommend_only",
      type: "review_cleaner_supply_quality",
      reason: "Trust or cancellation metrics worsened.",
    });
  }

  if (!dispatchWeightSuggestions.length) {
    dispatchWeightSuggestions.push({ action: "recommend_only", type: "keep_current_weights", reason: "No dispatch anomaly detected." });
  }
  if (!riskAreaSuggestions.length) {
    riskAreaSuggestions.push({ action: "recommend_only", type: "monitor_risk_baseline", reason: "No high-risk region signal detected." });
  }
  if (!pricingSuggestions.length) {
    pricingSuggestions.push({ action: "recommend_only", type: "keep_current_prices", reason: "No pricing anomaly detected." });
  }
  if (!cleanerManagementSuggestions.length) {
    cleanerManagementSuggestions.push({ action: "recommend_only", type: "keep_current_cleaner_controls", reason: "No cleaner management anomaly detected." });
  }

  return {
    dispatchWeightSuggestions,
    riskAreaSuggestions,
    pricingSuggestions,
    cleanerManagementSuggestions,
    executionMode: "read_only_recommendation",
  };
}

module.exports = {
  generateRecommendations,
};
