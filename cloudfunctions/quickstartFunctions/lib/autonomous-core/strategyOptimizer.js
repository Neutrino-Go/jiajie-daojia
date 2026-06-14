function metricOf(point = {}) {
  return point.metrics || point;
}

function optimizeStrategy(history = []) {
  const first = metricOf(history[0] || {});
  const last = metricOf(history[history.length - 1] || {});
  const optimizedPolicySet = {
    cleanerSelectionStrictness: 0,
    visibilityAdjustment: 0,
    lowTrustCleanerExposure: 1,
    rationale: [],
  };

  if (Number(last.cancellationRate || 0) > Number(first.cancellationRate || 0)) {
    optimizedPolicySet.cleanerSelectionStrictness = 0.2;
    optimizedPolicySet.rationale.push("cancellation_increased_tighten_cleaner_selection");
  }

  if (Number(last.GMV || 0) < Number(first.GMV || 0)) {
    optimizedPolicySet.visibilityAdjustment = 0.15;
    optimizedPolicySet.rationale.push("gmv_decreased_adjust_visibility");
  }

  if (Number(last.riskScoreAvg || 0) > Number(first.riskScoreAvg || 0)) {
    optimizedPolicySet.lowTrustCleanerExposure = 0.75;
    optimizedPolicySet.rationale.push("risk_increased_lower_low_trust_exposure");
  }

  return {
    optimizedPolicySet,
    historyPoints: history.length,
  };
}

module.exports = {
  optimizeStrategy,
};
