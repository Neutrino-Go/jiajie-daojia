const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { generateFeedback } = require("../lib/autonomous-core/feedbackLoopEngine");
const { evaluateSystem } = require("../lib/autonomous-core/selfEvaluationEngine");
const { optimizeStrategy } = require("../lib/autonomous-core/strategyOptimizer");
const { adaptPolicies } = require("../lib/autonomous-core/adaptivePolicyEngine");
const {
  enforceSafetyRules,
  governAutonomy,
  overrideAdaptivePolicies,
  rollbackPolicies,
  runFullAutonomousLoop,
} = require("../lib/autonomous-core/systemGovernor");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const actionResult = {
  actionType: "adjust_cleaner_ranking",
  expectedImpact: {
    gmv: 0.04,
    cancellation: -0.05,
    trust: 0.03,
    risk: -0.04,
  },
  actualImpact: {
    gmv: -0.03,
    cancellation: 0.04,
    trust: -0.02,
    risk: 0.05,
  },
};
const actionBefore = clone(actionResult);
const feedback = generateFeedback(actionResult, { threshold: 0.05 });
assert(feedback.deviationScore > 0.05);
assert.strictEqual(feedback.triggerOptimization, true);
assert.deepStrictEqual(actionResult, actionBefore, "feedback must not mutate action result");

const metrics = {
  dailyMetrics: {
    GMV: 120,
    completionRate: 0.72,
    cancellationRate: 0.28,
    activeUsers: 22,
    activeCleaners: 9,
    trustScoreAvg: 68,
    riskScoreAvg: 42,
  },
  weeklyMetrics: {
    GMV: 1000,
    completionRate: 0.78,
    cancellationRate: 0.18,
    activeUsers: 120,
    activeCleaners: 36,
    trustScoreAvg: 75,
    riskScoreAvg: 30,
  },
};
const evaluationInput = { metrics, anomalies: { severity: "medium", anomalyList: [{ type: "risk_score_spike" }] } };
const evaluationBefore = clone(evaluationInput);
const evaluation = evaluateSystem(evaluationInput);
assert(evaluation.revenueScore >= 0 && evaluation.revenueScore <= 100);
assert(evaluation.riskScore >= 0 && evaluation.riskScore <= 100);
assert(evaluation.userSatisfactionScore >= 0 && evaluation.userSatisfactionScore <= 100);
assert(evaluation.stabilityScore >= 0 && evaluation.stabilityScore <= 100);
assert(evaluation.systemHealthScore >= 0 && evaluation.systemHealthScore <= 100);
assert.deepStrictEqual(evaluationInput, evaluationBefore, "evaluation must not mutate input");

const history = [
  { metrics: { cancellationRate: 0.12, GMV: 1000, riskScoreAvg: 25 } },
  { metrics: { cancellationRate: 0.22, GMV: 760, riskScoreAvg: 45 } },
];
const optimized = optimizeStrategy(history);
assert(optimized.optimizedPolicySet.cleanerSelectionStrictness > 0);
assert(optimized.optimizedPolicySet.visibilityAdjustment > 0);
assert(optimized.optimizedPolicySet.lowTrustCleanerExposure < 1);

const currentPolicy = {
  pricingWeight: 1,
  riskThreshold: 70,
  cleanerRankingFactor: 1,
  supplyThrottleLevel: 0,
  autonomyEnabled: true,
};
const currentPolicyBefore = clone(currentPolicy);
const adapted = adaptPolicies({
  currentPolicy,
  feedback,
  evaluation: { ...evaluation, systemHealthScore: 58 },
  optimizedPolicySet: optimized.optimizedPolicySet,
});
assert.notStrictEqual(adapted.policySet.riskThreshold, currentPolicy.riskThreshold);
assert.notStrictEqual(adapted.policySet.cleanerRankingFactor, currentPolicy.cleanerRankingFactor);
assert(adapted.rollbackSnapshot);
assert.deepStrictEqual(currentPolicy, currentPolicyBefore, "adaptive policy engine must not mutate current policy");

const frozen = governAutonomy({
  evaluation: { systemHealthScore: 45 },
  policySet: adapted.policySet,
  threshold: 60,
});
assert.strictEqual(frozen.decision, "FREEZE");
assert.strictEqual(frozen.autonomyFrozen, true);
assert.strictEqual(frozen.policySet.autonomyEnabled, false);

const safe = enforceSafetyRules({
  policySet: { ...adapted.policySet, paymentAction: "refund", settlementAction: "settle" },
});
assert.strictEqual(safe.policySet.paymentAction, "");
assert.strictEqual(safe.policySet.settlementAction, "");
assert(safe.safetyEvents.some((event) => event.type === "blocked_payment_policy"));
assert(safe.safetyEvents.some((event) => event.type === "blocked_settlement_policy"));

const overridden = overrideAdaptivePolicies(adapted.policySet, { riskThreshold: 55 }, { approved: true });
assert.strictEqual(overridden.policySet.riskThreshold, 55);
assert.throws(() => overrideAdaptivePolicies(adapted.policySet, { riskThreshold: 55 }, { approved: false }), /approval/i);

const rolledBack = rollbackPolicies(adapted.policySet, adapted.rollbackSnapshot);
assert.deepStrictEqual(rolledBack, currentPolicyBefore);

const loopInput = {
  actionResult,
  metrics,
  anomalies: evaluationInput.anomalies,
  history,
  currentPolicy,
};
const loopBefore = clone(loopInput);
const loop = runFullAutonomousLoop(loopInput);
assert.deepStrictEqual(loop.flow, ["Observe", "Decide", "Execute", "Feedback", "Evaluate", "Optimize", "Adapt"]);
assert(loop.feedback.triggerOptimization);
assert(loop.evaluation.systemHealthScore >= 0);
assert(loop.optimization.optimizedPolicySet);
assert(loop.adaptation.policySet);
assert(loop.governor.decision);
assert.deepStrictEqual(loopInput, loopBefore, "closed loop must not mutate caller input");

const coreDir = path.resolve(__dirname, "../lib/autonomous-core");
for (const file of fs.readdirSync(coreDir)) {
  const code = fs.readFileSync(path.join(coreDir, file), "utf8");
  assert(!/mockPayOrder|ENABLE_MOCK_PAYMENT/.test(code), `${file} must not restore mock payment`);
  assert(!/db\.collection\s*\(/.test(code), `${file} must not directly write CloudBase state`);
  assert(!/collection\s*\([^)]*\)\s*\.\s*(add|update|remove|delete)\s*\(/.test(code), `${file} must not execute persistent writes`);
  assert(!/forceRefund\s*\(|settleOrder\s*\(|adjustPayout\s*\(|createPaymentIntent\s*\(/.test(code), `${file} must not call financial operations`);
}

console.log("autonomous core tests passed");
