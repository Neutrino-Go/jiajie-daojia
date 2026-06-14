function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function adaptPolicies(input = {}) {
  const currentPolicy = clone(input.currentPolicy || {});
  const feedback = input.feedback || {};
  const evaluation = input.evaluation || {};
  const optimized = input.optimizedPolicySet || {};
  const policySet = clone(currentPolicy);

  policySet.pricingWeight = clamp(Number(policySet.pricingWeight ?? 1) + Number(optimized.visibilityAdjustment || 0) * 0.2, 0.5, 1.5);
  policySet.riskThreshold = clamp(
    Number(policySet.riskThreshold ?? 70) - (feedback.triggerOptimization ? 5 : 0) - (Number(evaluation.systemHealthScore || 100) < 60 ? 5 : 0),
    40,
    90
  );
  policySet.cleanerRankingFactor = clamp(
    Number(policySet.cleanerRankingFactor ?? 1) + Number(optimized.cleanerSelectionStrictness || 0),
    0.5,
    1.8
  );
  policySet.supplyThrottleLevel = clamp(
    Number(policySet.supplyThrottleLevel || 0) + (Number(optimized.lowTrustCleanerExposure ?? 1) < 1 ? 0.1 : 0),
    0,
    0.5
  );
  policySet.lowTrustCleanerExposure = clamp(Number(optimized.lowTrustCleanerExposure ?? policySet.lowTrustCleanerExposure ?? 1), 0.5, 1);
  policySet.autonomyEnabled = currentPolicy.autonomyEnabled !== false;

  return {
    policySet,
    rollbackSnapshot: currentPolicy,
    adaptationReason: feedback.triggerOptimization ? "feedback_deviation" : "routine_adjustment",
  };
}

module.exports = {
  adaptPolicies,
};
