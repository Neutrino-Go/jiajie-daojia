const { clamp01, normalizeRiskScores } = require("../risk/riskNormalizer");

function decisionForWeightedRisk(weightedRisk) {
  const value = Number(weightedRisk);
  if (value < 0.2) return "ALLOW";
  if (value < 0.4) return "REVIEW";
  if (value < 0.6) return "RESTRICT";
  if (value < 0.8) return "HIGH_REVIEW";
  return "BLOCK";
}

function calibrateDecision(normalizedRisk = {}) {
  const risk = normalizeRiskScores(normalizedRisk);
  const weighted =
    risk.trust * -0.3 +
    risk.fraud * 0.4 +
    risk.collusion * 0.3 +
    risk.graph * 0.3;
  const boundedRisk = clamp01(weighted);
  return {
    ...risk,
    weightedRisk: weighted,
    normalizedRiskScore: boundedRisk,
    riskScore: Math.round(boundedRisk * 100),
    decision: decisionForWeightedRisk(weighted),
  };
}

module.exports = {
  calibrateDecision,
  decisionForWeightedRisk,
};
