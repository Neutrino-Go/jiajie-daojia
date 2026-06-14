const { generateFeedback } = require("./feedbackLoopEngine");
const { evaluateSystem } = require("./selfEvaluationEngine");
const { optimizeStrategy } = require("./strategyOptimizer");
const { adaptPolicies } = require("./adaptivePolicyEngine");

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function rollbackPolicies(currentPolicy, rollbackSnapshot = {}) {
  return clone(rollbackSnapshot || currentPolicy);
}

function overrideAdaptivePolicies(policySet = {}, override = {}, context = {}) {
  if (!context.approved) {
    throw new Error("policy override requires approval");
  }
  return {
    policySet: {
      ...clone(policySet),
      ...clone(override),
    },
    overrideApplied: true,
  };
}

function enforceSafetyRules(input = {}) {
  const policySet = clone(input.policySet || {});
  const safetyEvents = [];

  if (policySet.paymentAction) {
    policySet.paymentAction = "";
    safetyEvents.push({ type: "blocked_payment_policy" });
  }
  if (policySet.settlementAction) {
    policySet.settlementAction = "";
    safetyEvents.push({ type: "blocked_settlement_policy" });
  }
  if (policySet.payoutAction) {
    policySet.payoutAction = "";
    safetyEvents.push({ type: "blocked_payout_policy" });
  }
  if (policySet.refundAction) {
    policySet.refundAction = "";
    safetyEvents.push({ type: "blocked_refund_policy" });
  }

  return {
    policySet,
    safetyEvents,
  };
}

function governAutonomy(input = {}) {
  const threshold = Number(input.threshold || 50);
  const health = Number((input.evaluation && input.evaluation.systemHealthScore) || 0);
  const safe = enforceSafetyRules({ policySet: input.policySet || {} });
  const policySet = safe.policySet;
  if (health < threshold) {
    policySet.autonomyEnabled = false;
    return {
      decision: "FREEZE",
      autonomyFrozen: true,
      reason: "system_health_below_threshold",
      policySet,
      safetyEvents: safe.safetyEvents,
    };
  }
  return {
    decision: "ALLOW",
    autonomyFrozen: false,
    reason: "system_health_within_threshold",
    policySet,
    safetyEvents: safe.safetyEvents,
  };
}

function runFullAutonomousLoop(input = {}) {
  const observed = clone(input);
  const feedback = generateFeedback(observed.actionResult || {}, input.feedbackOptions || {});
  const evaluation = evaluateSystem({ metrics: observed.metrics, anomalies: observed.anomalies });
  const optimization = optimizeStrategy(observed.history || []);
  const adaptation = adaptPolicies({
    currentPolicy: observed.currentPolicy || {},
    feedback,
    evaluation,
    optimizedPolicySet: optimization.optimizedPolicySet,
  });
  const governor = governAutonomy({
    evaluation,
    policySet: adaptation.policySet,
    threshold: input.healthThreshold || 50,
  });

  return {
    flow: ["Observe", "Decide", "Execute", "Feedback", "Evaluate", "Optimize", "Adapt"],
    feedback,
    evaluation,
    optimization,
    adaptation,
    governor,
  };
}

module.exports = {
  enforceSafetyRules,
  governAutonomy,
  overrideAdaptivePolicies,
  rollbackPolicies,
  runFullAutonomousLoop,
};
