function numberOf(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cloneImpact(impact = {}) {
  return {
    gmv: numberOf(impact.gmv ?? impact.gmvImpact),
    cancellation: numberOf(impact.cancellation ?? impact.cancellationImpact),
    trust: numberOf(impact.trust ?? impact.trustImpact),
    risk: numberOf(impact.risk ?? impact.riskImpact),
  };
}

function averageDeviation(expected = {}, actual = {}) {
  const keys = ["gmv", "cancellation", "trust", "risk"];
  const total = keys.reduce((sum, key) => sum + Math.abs(numberOf(actual[key]) - numberOf(expected[key])), 0);
  return Math.round((total / keys.length) * 10000) / 10000;
}

function generateFeedback(actionResult = {}, options = {}) {
  const threshold = numberOf(options.threshold || 0.05);
  const expectedImpact = cloneImpact(actionResult.expectedImpact || actionResult.simulation || {});
  const actualImpact = cloneImpact(actionResult.actualImpact || {});
  const deviationScore = averageDeviation(expectedImpact, actualImpact);

  return {
    actionType: actionResult.actionType || actionResult.type || "",
    expectedImpact,
    actualImpact,
    deviationScore,
    threshold,
    triggerOptimization: deviationScore > threshold,
  };
}

module.exports = {
  generateFeedback,
};
