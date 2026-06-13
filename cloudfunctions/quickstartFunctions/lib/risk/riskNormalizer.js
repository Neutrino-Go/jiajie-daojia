function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function normalizeScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  if (number <= 1 && number >= 0) return clamp01(number);
  return clamp01(number / 100);
}

function normalizeRiskScores(input = {}) {
  return {
    trust: normalizeScore(input.trustScore ?? input.trust ?? 0),
    fraud: normalizeScore(input.fraudScore ?? input.fraud ?? 0),
    collusion: normalizeScore(input.collusionScore ?? input.collusion ?? 0),
    graph: normalizeScore(input.graphScore ?? input.graphRiskScore ?? input.graph ?? 0),
  };
}

module.exports = {
  clamp01,
  normalizeRiskScores,
  normalizeScore,
};
