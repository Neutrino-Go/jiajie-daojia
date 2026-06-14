function listTypes(anomalies = {}) {
  return (anomalies.anomalyList || []).map((item) => item.type);
}

function generateInsights(metrics = {}, anomalies = {}) {
  const daily = metrics.dailyMetrics || {};
  const weekly = metrics.weeklyMetrics || {};
  const types = listTypes(anomalies);
  const severity = anomalies.severity || "none";

  return {
    operationsSummary: `Current operational severity: ${severity}. Detected ${types.length} anomaly signals.`,
    userBehaviorTrend: `Daily active users ${daily.activeUsers || 0}; weekly active users ${weekly.activeUsers || 0}.`,
    cleanerSupplyTrend: `Daily active cleaners ${daily.activeCleaners || 0}; average trust score ${daily.trustScoreAvg || 0}.`,
    riskTrend: `Daily average risk score ${daily.riskScoreAvg || 0}; anomaly signals: ${types.join(", ") || "none"}.`,
    anomalyTypes: types,
    severity,
    metricsSnapshot: {
      dailyMetrics: { ...daily },
      weeklyMetrics: { ...weekly },
    },
  };
}

module.exports = {
  generateInsights,
};
