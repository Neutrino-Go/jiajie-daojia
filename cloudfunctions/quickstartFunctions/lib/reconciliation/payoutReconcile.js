const { calculateCleanerPayout } = require("../settlement/cleanerPayout");

function reconcilePayouts(input = {}) {
  const settlements = Array.isArray(input.settlements) ? input.settlements : [];
  const mismatches = [];
  settlements.forEach((settlement) => {
    const expected = calculateCleanerPayout(settlement);
    if (Number(settlement.payoutAmount || 0) !== expected.payoutAmount) {
      mismatches.push({
        type: "payout_amount_mismatch",
        orderId: settlement.orderId,
        settlementId: settlement.settlementId || settlement._id,
        expectedPayoutAmount: expected.payoutAmount,
        actualPayoutAmount: Number(settlement.payoutAmount || 0),
      });
    }
  });
  return {
    checkedSettlements: settlements.length,
    mismatches,
  };
}

module.exports = {
  reconcilePayouts,
};
