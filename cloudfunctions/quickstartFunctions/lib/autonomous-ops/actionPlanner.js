function hasAnomaly(input = {}, type) {
  const anomalies = (input.anomalies && input.anomalies.anomalyList) || [];
  const insightTypes = (input.insights && input.insights.anomalyTypes) || [];
  return anomalies.some((item) => item.type === type) || insightTypes.includes(type);
}

function action(type, target, value, reason, riskLevel = "medium") {
  return {
    type,
    target,
    value,
    reason,
    riskLevel,
    executionMode: "controlled",
    reversible: true,
  };
}

function planActions(input = {}) {
  const plan = [];
  const recs = input.recommendations || {};

  if (hasAnomaly(input, "risk_score_spike") || (recs.dispatchWeightSuggestions || []).length) {
    plan.push(action(
      "adjust_cleaner_ranking",
      "high_risk_orders",
      -0.2,
      "Lower ranking weight for high-risk order/provider pairings."
    ));
    plan.push(action(
      "visibility_adjustment",
      "critical_risk_orders",
      "hide",
      "Reduce visibility for critical risk orders until review.",
      "high"
    ));
  }

  if (hasAnomaly(input, "cancellation_rate_spike") || (recs.riskAreaSuggestions || []).length) {
    plan.push(action(
      "supply_throttling",
      "high_cancellation_regions",
      0.15,
      "Throttle low-confidence supply exposure in high cancellation segments."
    ));
  }

  if (hasAnomaly(input, "gmv_drop") || (recs.pricingSuggestions || []).length) {
    plan.push(action(
      "pricing_weight_adjustment",
      "conversion_review",
      0.1,
      "Adjust non-money pricing display weight for review queue only."
    ));
  }

  return plan;
}

module.exports = {
  planActions,
};
