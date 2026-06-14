const { planActions } = require("./actionPlanner");
const { simulateAction } = require("./simulationEngine");
const { evaluateGuardrails } = require("./guardrailEngine");

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function ensureState(state = {}) {
  return {
    rankingWeights: { ...(state.rankingWeights || {}) },
    pricingWeights: { ...(state.pricingWeights || {}) },
    supplyThrottle: { ...(state.supplyThrottle || {}) },
    visibilityRules: { ...(state.visibilityRules || {}) },
    paymentLedger: clone(state.paymentLedger || {}),
    settlementLedger: clone(state.settlementLedger || {}),
  };
}

function applySafeAction(state, action) {
  const target = action.target || "default";
  if (action.type === "adjust_cleaner_ranking") {
    state.rankingWeights[target] = Number(action.value || 0);
  }
  if (action.type === "pricing_weight_adjustment") {
    state.pricingWeights[target] = Number(action.value || 0);
  }
  if (action.type === "supply_throttling") {
    state.supplyThrottle[target] = Number(action.value || 0);
  }
  if (action.type === "visibility_adjustment") {
    state.visibilityRules[target] = action.value || "review";
  }
}

function executeActionPlan(actionPlan = [], options = {}) {
  const previousState = ensureState(options.state || {});
  const nextState = ensureState(options.state || {});
  const appliedActions = [];
  const rejectedActions = [];
  const approvalRequiredActions = [];

  actionPlan.forEach((action) => {
    const guard = evaluateGuardrails(action);
    if (guard.decision === "ALLOW") {
      applySafeAction(nextState, action);
      appliedActions.push({ ...action, guardrailDecision: guard.decision, guardrailReason: guard.reason });
      return;
    }
    if (guard.decision === "NEED_APPROVAL") {
      approvalRequiredActions.push({ ...action, guardrailDecision: guard.decision, guardrailReason: guard.reason });
      return;
    }
    rejectedActions.push({ ...action, guardrailDecision: guard.decision, guardrailReason: guard.reason });
  });

  return {
    appliedActions,
    approvalRequiredActions,
    rejectedActions,
    nextState,
    rollbackPlan: {
      previousState,
      appliedActionTypes: appliedActions.map((action) => action.type),
    },
  };
}

function rollbackExecution(currentState, rollbackPlan = {}) {
  return ensureState(rollbackPlan.previousState || currentState || {});
}

function runAutonomousOpsCycle(observation = {}, options = {}) {
  const actionPlan = planActions(observation);
  const simulations = actionPlan.map((action) => simulateAction(action));
  const guardedPlan = actionPlan.map((action, index) => ({
    ...action,
    simulation: simulations[index],
  }));
  const execution = executeActionPlan(guardedPlan, options);

  return {
    observed: clone(observation),
    actionPlan,
    simulations,
    execution,
    flow: ["OBSERVE", "PLAN", "SIMULATE", "GUARD", "EXECUTE"],
  };
}

module.exports = {
  executeActionPlan,
  rollbackExecution,
  runAutonomousOpsCycle,
};
