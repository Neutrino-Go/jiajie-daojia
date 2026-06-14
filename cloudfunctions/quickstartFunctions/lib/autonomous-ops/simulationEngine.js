const IMPACTS = {
  adjust_cleaner_ranking: {
    gmvImpact: 0.01,
    cancellationImpact: -0.04,
    trustImpact: 0.03,
    riskImpact: -0.05,
    confidenceScore: 0.72,
  },
  pricing_weight_adjustment: {
    gmvImpact: 0.03,
    cancellationImpact: 0,
    trustImpact: 0,
    riskImpact: 0,
    confidenceScore: 0.55,
  },
  supply_throttling: {
    gmvImpact: -0.02,
    cancellationImpact: -0.05,
    trustImpact: 0.02,
    riskImpact: -0.04,
    confidenceScore: 0.68,
  },
  visibility_adjustment: {
    gmvImpact: -0.01,
    cancellationImpact: -0.03,
    trustImpact: 0.01,
    riskImpact: -0.06,
    confidenceScore: 0.65,
  },
};

function simulateAction(action = {}) {
  const impact = IMPACTS[action.type] || {
    gmvImpact: 0,
    cancellationImpact: 0,
    trustImpact: 0,
    riskImpact: 0,
    confidenceScore: 0.25,
  };

  return {
    actionType: action.type || "",
    target: action.target || "",
    ...impact,
    simulated: true,
  };
}

module.exports = {
  simulateAction,
};
