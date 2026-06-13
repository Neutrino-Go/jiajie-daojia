const { normalizeRiskScores } = require("./risk/riskNormalizer");
const { detectLongTermPatterns } = require("./behavior/behaviorGraphStore");
const { calibrateDecision } = require("./decision/decisionCalibrator");

function clampScore(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeRate(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 1) return number / 100;
  return Math.max(0, number);
}

function applyTrustDecay(trustScore, lastActiveDays) {
  const decay = Math.min(20, Math.max(0, Number(lastActiveDays || 0)) * 0.5);
  return clampScore(Number(trustScore || 0) - decay);
}

function trustLevelFromScore(score, blocked = false) {
  if (blocked || score < 30) return "blocked";
  if (score < 50) return "low";
  if (score < 75) return "medium";
  return "high";
}

function calculateCleanerTrust(cleanerStats = {}) {
  const completionRate = normalizeRate(cleanerStats.completionRate, 1);
  const cancellationRate = normalizeRate(cleanerStats.cancellationRate, 0);
  const complaintRate = normalizeRate(cleanerStats.complaintRate, 0);
  const avgRating = Number(cleanerStats.avgRating ?? cleanerStats.ratingAvg ?? 5);
  const noShowCount = Number(cleanerStats.noShowCount || 0);
  let trustScore = 100;

  if (cancellationRate > 0.3) trustScore -= 20;
  if (complaintRate > 0.1) trustScore -= 30;
  if (completionRate < 0.7) trustScore -= 20;
  if (avgRating > 0 && avgRating < 3) trustScore -= 15;
  if (cleanerStats.lastActiveDays !== undefined) trustScore = applyTrustDecay(trustScore, cleanerStats.lastActiveDays);

  trustScore = clampScore(trustScore);
  const blocked = noShowCount > 3;
  return {
    cleanerId: cleanerStats.cleanerId || "",
    trustScore,
    completionRate,
    cancellationRate,
    complaintRate,
    avgRating: Number.isFinite(avgRating) ? avgRating : 0,
    avgResponseTime: Number(cleanerStats.avgResponseTime || 0),
    lateCount: Number(cleanerStats.lateCount || 0),
    noShowCount,
    disputeCount: Number(cleanerStats.disputeCount || 0),
    trustLevel: trustLevelFromScore(trustScore, blocked),
    updatedAt: cleanerStats.updatedAt || new Date().toISOString(),
  };
}

function isCancelledStatus(status) {
  return ["cancelled", "assigned_declined", "no_show"].includes(status);
}

function isSuccessStatus(status) {
  return ["confirmed", "in_service", "waiting_complete", "waiting_acceptance", "completed", "auto_completed", "accepted"].includes(status);
}

function pairIdOf(order = {}) {
  const customerOpenid = order.customerOpenid || order.userOpenid || order.claimantOpenid || "";
  const cleanerOpenid = order.acceptedCleanerOpenid || order.cleanerId || order.assignedCleanerOpenid || "";
  return { customerOpenid, cleanerOpenid, key: `${customerOpenid}::${cleanerOpenid}` };
}

function groupPairOrders(orders = []) {
  const grouped = new Map();
  orders.forEach((order) => {
    const pair = pairIdOf(order);
    if (!pair.customerOpenid || !pair.cleanerOpenid) return;
    if (!grouped.has(pair.key)) {
      grouped.set(pair.key, { customerOpenid: pair.customerOpenid, cleanerOpenid: pair.cleanerOpenid, orders: [] });
    }
    grouped.get(pair.key).orders.push(order);
  });
  return Array.from(grouped.values());
}

function calculateBehaviorGraph(input = {}) {
  const orders = Array.isArray(input.orders) ? input.orders : [];
  const claims = Array.isArray(input.claims) ? input.claims : [];
  const graphEdges = Array.isArray(input.graphEdges) ? input.graphEdges : [];
  let graphRiskScore = 0;
  let behaviorPatternType = "normal";
  const pairSummaries = groupPairOrders(orders).map((pair) => {
    const total = pair.orders.length;
    const cancellationCount = pair.orders.filter((order) => isCancelledStatus(order.status)).length;
    const successCount = pair.orders.filter((order) => isSuccessStatus(order.status)).length;
    const claimCount = claims.filter((claim) => claim.customerOpenid === pair.customerOpenid || claim.cleanerOpenid === pair.cleanerOpenid).length;
    return { ...pair, total, cancellationCount, successCount, claimCount };
  });

  for (const summary of pairSummaries) {
    if (summary.cancellationCount >= 2 && summary.total >= 3) {
      graphRiskScore = Math.max(graphRiskScore, 60);
      behaviorPatternType = "cancel_rebook_loop";
    } else if (summary.total >= 4 && summary.successCount / summary.total > 0.9) {
      graphRiskScore = Math.max(graphRiskScore, 45);
      behaviorPatternType = behaviorPatternType === "normal" ? "dense_interaction_cluster" : behaviorPatternType;
    }
    if (summary.claimCount >= 3) {
      graphRiskScore = Math.max(graphRiskScore, 50);
      behaviorPatternType = behaviorPatternType === "normal" ? "repeated_claim_cluster" : behaviorPatternType;
    }
  }
  const longTermPattern = detectLongTermPatterns({ edges: graphEdges });
  if (longTermPattern.graphRiskScore > graphRiskScore) {
    graphRiskScore = longTermPattern.graphRiskScore;
    behaviorPatternType = longTermPattern.behaviorPatternType;
  }

  return {
    graphRiskScore: clampScore(graphRiskScore),
    graphScore: clampScore(graphRiskScore),
    behaviorPatternType,
    pairSummaries,
    pairOrders: orders,
    graphEdges,
    longTermPattern,
    orders,
  };
}

function fraudLevelFromScore(score) {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function calculateFraudRisk(input = {}) {
  const orders = Array.isArray(input.orders) ? input.orders : [];
  let fraudScore = 0;
  const factors = [];
  for (const pair of groupPairOrders(orders)) {
    const total = pair.orders.length;
    const cancellationCount = pair.orders.filter((order) => isCancelledStatus(order.status)).length;
    const nonCancelledCount = total - cancellationCount;
    if (total >= 3 && cancellationCount / total > 0.6) {
      fraudScore = Math.max(fraudScore, 70);
      factors.push("repeated_cancel_same_cleaner");
    }
    if (cancellationCount >= 2 && nonCancelledCount >= 1) {
      fraudScore = Math.max(fraudScore, 60);
      factors.push("cancel_rebook_loop");
    }
  }
  const cleanerCancelMap = new Map();
  orders.forEach((order) => {
    const pair = pairIdOf(order);
    if (!pair.cleanerOpenid || !isCancelledStatus(order.status)) return;
    const set = cleanerCancelMap.get(pair.cleanerOpenid) || new Set();
    set.add(pair.customerOpenid);
    cleanerCancelMap.set(pair.cleanerOpenid, set);
  });
  for (const customers of cleanerCancelMap.values()) {
    if (customers.size >= 3) {
      fraudScore = Math.max(fraudScore, 55);
      factors.push("multi_account_pattern");
    }
  }
  fraudScore = clampScore(fraudScore);
  return { fraudScore, fraudLevel: fraudLevelFromScore(fraudScore), factors: Array.from(new Set(factors)) };
}

function calculateCollusionRisk(input = {}) {
  const orders = Array.isArray(input.orders) ? input.orders : [];
  let collusionScore = 0;
  const collusionPairs = [];
  for (const pair of groupPairOrders(orders)) {
    const total = pair.orders.length;
    const successCount = pair.orders.filter((order) => isSuccessStatus(order.status)).length;
    const cancellationCount = pair.orders.filter((order) => isCancelledStatus(order.status)).length;
    let pairScore = 0;
    if (total >= 4 && successCount / total > 0.9) pairScore = Math.max(pairScore, 70);
    if (total >= 4) pairScore = Math.max(pairScore, 60);
    if (cancellationCount >= 2 && successCount >= 1) pairScore = Math.max(pairScore, 55);
    if (pairScore > 0) {
      collusionPairs.push({
        customerOpenid: pair.customerOpenid,
        cleanerOpenid: pair.cleanerOpenid,
        interactionCount: total,
        successRate: total ? successCount / total : 0,
        cancellationCount,
        score: pairScore,
      });
      collusionScore = Math.max(collusionScore, pairScore);
    }
  }
  return { collusionScore: clampScore(collusionScore), collusionPairs };
}

function decisionFromScore(score) {
  const value = clampScore(score);
  if (value < 30) return "ALLOW";
  if (value < 50) return "REVIEW";
  if (value < 75) return "RESTRICT";
  if (value <= 90) return "HIGH_REVIEW";
  return "BLOCK";
}

function riskLevelFromScore(score) {
  const value = clampScore(score);
  if (value < 30) return "low";
  if (value < 50) return "medium";
  if (value < 75) return "high";
  return "critical";
}

function calculateGlobalRisk(user = {}, cleaner = {}, orderGraph = {}) {
  const userTrustScore = clampScore(user.trustScore ?? 80);
  const cleanerTrustScore = clampScore(cleaner.trustScore ?? 80);
  const graphScore = clampScore(orderGraph.graphRiskScore ?? orderGraph.graphScore ?? 0);
  const fraudScore = clampScore(orderGraph.fraudScore ?? 0);
  const collusionScore = clampScore(orderGraph.collusionScore ?? 0);
  const trustScore = Math.min(userTrustScore, cleanerTrustScore);
  const normalizedRisk = normalizeRiskScores({ trustScore, fraudScore, collusionScore, graphScore });
  const calibrated = calibrateDecision(normalizedRisk);
  let finalRiskScore = calibrated.riskScore;
  if (cleaner.trustLevel === "blocked") finalRiskScore = 100;
  finalRiskScore = clampScore(finalRiskScore);
  const decision = cleaner.trustLevel === "blocked" ? "BLOCK" : calibrateDecision({
    ...normalizedRisk,
    graph: graphScore / 100,
  }).decision;
  return {
    finalRiskScore,
    riskScore: finalRiskScore,
    decision,
    calibratedDecision: decision,
    riskLevel: riskLevelFromScore(finalRiskScore),
    graphScore,
    fraudScore,
    collusionScore,
    normalizedRisk,
    weightedRisk: calibrated.weightedRisk,
  };
}

function calculateOrderRisk(order = {}, cleaner = {}, user = {}, graphInput = {}) {
  const behaviorGraph = graphInput.graphRiskScore !== undefined ? graphInput : calculateBehaviorGraph(graphInput);
  const fraud = graphInput.fraudScore !== undefined ? graphInput : calculateFraudRisk(graphInput);
  const collusion = graphInput.collusionScore !== undefined ? graphInput : calculateCollusionRisk(graphInput);
  const global = calculateGlobalRisk(user, cleaner, {
    graphRiskScore: behaviorGraph.graphRiskScore,
    fraudScore: fraud.fraudScore,
    collusionScore: collusion.collusionScore,
  });
  return {
    orderId: order._id || order.orderId || "",
    riskScore: global.finalRiskScore,
    riskLevel: global.riskLevel,
    decision: global.decision,
    fraudScore: fraud.fraudScore,
    fraudLevel: fraud.fraudLevel,
    collusionScore: collusion.collusionScore,
    collusionPairs: collusion.collusionPairs || [],
    graphScore: behaviorGraph.graphRiskScore,
    behaviorPatternType: behaviorGraph.behaviorPatternType || "normal",
    riskFactors: {
      repeatedCancellation: (fraud.factors || []).includes("repeated_cancel_same_cleaner"),
      abnormalClaimRate: behaviorGraph.behaviorPatternType === "repeated_claim_cluster",
      userComplaintHistory: behaviorGraph.behaviorPatternType === "repeated_claim_cluster",
      cleanerRiskScore: cleaner.trustLevel === "low" || cleaner.trustLevel === "blocked",
    },
  };
}

function applyAutoGovernance(profile = {}, stats = {}) {
  const trustScore = clampScore(profile.trustScore ?? 100);
  const next = {
    ...profile,
    trustScore,
    trustLevel: profile.trustLevel || trustLevelFromScore(trustScore),
    rankingDown: Boolean(profile.rankingDown),
    reviewRequired: Boolean(profile.reviewRequired),
    blocked: Boolean(profile.blocked),
  };
  if (Number(stats.cancellationCount24h || 0) >= 3) {
    const base = stats.now ? new Date(stats.now) : new Date();
    next.freezeUntil = new Date(base.getTime() + 24 * 60 * 60 * 1000).toISOString();
    next.governanceStatus = "frozen";
  }
  if (Number(stats.complaintCount7d || 0) >= 2) {
    next.reviewRequired = true;
    next.governanceStatus = next.governanceStatus || "review_required";
  }
  if (trustScore < 30) {
    next.trustLevel = "blocked";
    next.blocked = true;
    next.governanceStatus = "blocked";
  } else if (trustScore < 50) {
    next.trustLevel = "low";
    next.rankingDown = true;
    next.governanceStatus = next.governanceStatus || "ranking_down";
  }
  return next;
}

module.exports = {
  applyAutoGovernance,
  applyTrustDecay,
  calculateBehaviorGraph,
  calculateCleanerTrust,
  calculateCollusionRisk,
  calculateFraudRisk,
  calculateGlobalRisk,
  calculateOrderRisk,
  clampScore,
  calibrateDecision,
  decisionFromScore,
  normalizeRiskScores,
  riskLevelFromScore,
  trustLevelFromScore,
};
