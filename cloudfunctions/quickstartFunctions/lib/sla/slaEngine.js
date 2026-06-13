const { roundMoney } = require("../payment/paymentIntent");

function calculateSlaPenalty(input = {}) {
  const delayMinutes = Number(input.delayMinutes || 0);
  const reasons = [];
  let penalty = 0;
  if (delayMinutes > 30) {
    reasons.push("delay_over_30min");
    penalty += 15;
  }
  if (input.cancelAfterAccept) {
    reasons.push("cancel_after_accept");
    penalty += 20;
  }
  if (input.noShow) {
    reasons.push("no_show");
    penalty += 50;
  }
  return {
    penalty: roundMoney(penalty),
    reasons,
    delayMinutes,
  };
}

module.exports = {
  calculateSlaPenalty,
};
