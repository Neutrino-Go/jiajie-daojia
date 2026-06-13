const { roundMoney } = require("../payment/paymentIntent");

function calculateCleanerPayout(input = {}) {
  const cleanerIncome = roundMoney(input.cleanerIncome);
  const penalty = roundMoney(input.penalty);
  const bonus = roundMoney(input.bonus);
  const payoutAmount = roundMoney(Math.max(0, cleanerIncome - penalty + bonus));
  return {
    cleanerIncome,
    penalty,
    bonus,
    payoutAmount,
  };
}

module.exports = {
  calculateCleanerPayout,
};
