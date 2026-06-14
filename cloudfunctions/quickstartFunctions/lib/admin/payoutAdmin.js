const { roundMoney } = require("../payment/paymentIntent");

function normalizePayoutAdjustment(input = {}) {
  return {
    penalty: roundMoney(input.penalty),
    bonus: roundMoney(input.bonus),
    reason: String(input.reason || "").slice(0, 120),
  };
}

module.exports = {
  normalizePayoutAdjustment,
};
