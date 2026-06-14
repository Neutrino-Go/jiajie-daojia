const SEVERITY_RANK = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function ratioChange(current, previous) {
  const now = Number(current);
  const before = Number(previous);
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return 0;
  return (now - before) / before;
}

function severityOf(anomalies = []) {
  if (!anomalies.length) return "none";
  return anomalies.reduce((current, item) => {
    return SEVERITY_RANK[item.severity] > SEVERITY_RANK[current] ? item.severity : current;
  }, "low");
}

function detectAnomalies(metrics = {}) {
  const current = metrics.current || metrics.dailyMetrics || {};
  const previous = metrics.previous || metrics.previousDailyMetrics || metrics.weeklyAverage || {};
  const anomalyList = [];

  if (ratioChange(current.cancellationRate, previous.cancellationRate) >= 0.3) {
    anomalyList.push({
      type: "cancellation_rate_spike",
      severity: "high",
      current: current.cancellationRate,
      previous: previous.cancellationRate,
    });
  }

  if (ratioChange(current.GMV, previous.GMV) <= -0.3) {
    anomalyList.push({
      type: "gmv_drop",
      severity: "high",
      current: current.GMV,
      previous: previous.GMV,
    });
  }

  if (ratioChange(current.trustScoreAvg, previous.trustScoreAvg) <= -0.15) {
    anomalyList.push({
      type: "trust_score_drop",
      severity: "medium",
      current: current.trustScoreAvg,
      previous: previous.trustScoreAvg,
    });
  }

  if (ratioChange(current.riskScoreAvg, previous.riskScoreAvg) >= 0.3) {
    anomalyList.push({
      type: "risk_score_spike",
      severity: "high",
      current: current.riskScoreAvg,
      previous: previous.riskScoreAvg,
    });
  }

  return {
    anomalyList,
    severity: severityOf(anomalyList),
  };
}

module.exports = {
  detectAnomalies,
};
