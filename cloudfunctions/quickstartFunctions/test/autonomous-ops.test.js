const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { planActions } = require("../lib/autonomous-ops/actionPlanner");
const { simulateAction } = require("../lib/autonomous-ops/simulationEngine");
const { evaluateGuardrails } = require("../lib/autonomous-ops/guardrailEngine");
const { executeActionPlan, rollbackExecution, runAutonomousOpsCycle } = require("../lib/autonomous-ops/executionEngine");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const metrics = {
  dailyMetrics: {
    GMV: 100,
    cancellationRate: 0.45,
    trustScoreAvg: 62,
    riskScoreAvg: 58,
  },
  weeklyMetrics: {
    GMV: 700,
    cancellationRate: 0.18,
    trustScoreAvg: 76,
    riskScoreAvg: 31,
  },
};
const anomalies = {
  severity: "high",
  anomalyList: [
    { type: "risk_score_spike", severity: "high" },
    { type: "cancellation_rate_spike", severity: "high" },
    { type: "gmv_drop", severity: "medium" },
  ],
};
const insights = {
  severity: "high",
  anomalyTypes: ["risk_score_spike", "cancellation_rate_spike", "gmv_drop"],
  riskTrend: "risk up",
};
const recommendations = {
  dispatchWeightSuggestions: [{ type: "lower_high_risk_order_priority", action: "recommend_only" }],
  riskAreaSuggestions: [{ type: "review_high_risk_segments", action: "recommend_only" }],
  pricingSuggestions: [{ type: "review_city_service_price_conversion", action: "recommend_only" }],
  cleanerManagementSuggestions: [{ type: "review_cleaner_supply_quality", action: "recommend_only" }],
};
const source = { metrics, anomalies, insights, recommendations };
const sourceBefore = clone(source);

const plan = planActions(source);
assert(plan.some((action) => action.type === "adjust_cleaner_ranking"));
assert(plan.some((action) => action.type === "supply_throttling"));
assert(plan.some((action) => action.type === "pricing_weight_adjustment"));
assert(plan.every((action) => action.executionMode === "controlled"));
assert.deepStrictEqual(source, sourceBefore, "planner must not mutate observations");

const rankingSimulation = simulateAction({ type: "adjust_cleaner_ranking", riskLevel: "medium" });
assert(rankingSimulation.confidenceScore > 0);
assert(rankingSimulation.riskImpact < 0);
assert(Number.isFinite(rankingSimulation.gmvImpact));

assert.strictEqual(evaluateGuardrails({ type: "force_refund", category: "money" }).decision, "REJECT");
assert.strictEqual(evaluateGuardrails({ type: "adjust_payout", category: "payout" }).decision, "REJECT");
assert.strictEqual(evaluateGuardrails({ type: "settle_order", category: "settlement" }).decision, "REJECT");
assert.strictEqual(evaluateGuardrails({ type: "visibility_adjustment", riskLevel: "high" }).decision, "NEED_APPROVAL");
assert.strictEqual(evaluateGuardrails({ type: "adjust_cleaner_ranking", riskLevel: "medium" }).decision, "ALLOW");

const initialState = {
  rankingWeights: { cleanerQuality: 1 },
  pricingWeights: { conversionBoost: 0 },
  supplyThrottle: {},
  visibilityRules: {},
  paymentLedger: { untouched: true },
  settlementLedger: { untouched: true },
};
const initialBefore = clone(initialState);
const execution = executeActionPlan([
  { type: "adjust_cleaner_ranking", target: "high_risk_orders", value: -0.2, riskLevel: "medium" },
  { type: "pricing_weight_adjustment", target: "conversion_review", value: 0.1, riskLevel: "medium" },
  { type: "supply_throttling", target: "high_cancellation_regions", value: 0.15, riskLevel: "medium" },
  { type: "visibility_adjustment", target: "critical_risk_orders", value: "hide", riskLevel: "high", approved: true },
  { type: "force_refund", category: "money", target: "order-a", value: 1 },
], { state: initialState });

assert.strictEqual(execution.appliedActions.length, 4);
assert.strictEqual(execution.rejectedActions.length, 1);
assert.strictEqual(execution.rejectedActions[0].guardrailDecision, "REJECT");
assert.strictEqual(execution.nextState.paymentLedger.untouched, true);
assert.strictEqual(execution.nextState.settlementLedger.untouched, true);
assert.deepStrictEqual(initialState, initialBefore, "execution must not mutate caller state");

const rolledBack = rollbackExecution(execution.nextState, execution.rollbackPlan);
assert.deepStrictEqual(rolledBack, initialBefore, "rollback must restore previous safe state");

const cycle = runAutonomousOpsCycle(source, { state: initialState });
assert.deepStrictEqual(cycle.observed.metrics, metrics);
assert(cycle.actionPlan.length > 0);
assert(cycle.simulations.length === cycle.actionPlan.length);
assert(cycle.execution.appliedActions.every((action) => !["force_refund", "settle_order", "adjust_payout"].includes(action.type)));
assert.deepStrictEqual(source, sourceBefore, "cycle must not mutate observations");

const opsDir = path.resolve(__dirname, "../lib/autonomous-ops");
for (const file of fs.readdirSync(opsDir)) {
  const code = fs.readFileSync(path.join(opsDir, file), "utf8");
  assert(!/mockPayOrder|ENABLE_MOCK_PAYMENT/.test(code), `${file} must not restore mock payment`);
  assert(!/db\.collection\s*\(/.test(code), `${file} must not directly write CloudBase state`);
  assert(!/collection\s*\([^)]*\)\s*\.\s*(add|update|remove|delete)\s*\(/.test(code), `${file} must not execute persistent writes`);
  assert(!/forceRefund|settleOrder|adjustPayout/.test(code), `${file} must not call financial operations`);
}

console.log("autonomous ops tests passed");
