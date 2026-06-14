function clamp100(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function severityPenalty(severity) {
  if (severity === "critical") return 30;
  if (severity === "high") return 22;
  if (severity === "medium") return 12;
  if (severity === "low") return 5;
  return 0;
}

function evaluateSystem(input = {}) {
  const daily = (input.metrics && input.metrics.dailyMetrics) || {};
  const weekly = (input.metrics && input.metrics.weeklyMetrics) || {};
  const anomalies = input.anomalies || {};
  const gmvRatio = Number(weekly.GMV || 0) > 0 ? Number(daily.GMV || 0) / (Number(weekly.GMV || 0) / 7) : 1;
  const revenueScore = clamp100(70 + (gmvRatio - 1) * 30);
  const riskScore = clamp100(100 - Number(daily.riskScoreAvg || 0) - severityPenalty(anomalies.severity));
  const userSatisfactionScore = clamp100(
    Number(daily.completionRate || 0) * 55 +
    (1 - Number(daily.cancellationRate || 0)) * 35 +
    Math.min(Number(daily.activeUsers || 0), 100) * 0.1
  );
  const stabilityScore = clamp100(
    Number(daily.trustScoreAvg || 0) * 0.55 +
    (1 - Number(daily.cancellationRate || 0)) * 35 +
    (Number(daily.activeCleaners || 0) > 0 ? 10 : 0)
  );
  const systemHealthScore = clamp100(
    revenueScore * 0.25 +
    riskScore * 0.3 +
    userSatisfactionScore * 0.25 +
    stabilityScore * 0.2
  );

  return {
    revenueScore,
    riskScore,
    userSatisfactionScore,
    stabilityScore,
    systemHealthScore,
  };
}

module.exports = {
  clamp100,
  evaluateSystem,
};
