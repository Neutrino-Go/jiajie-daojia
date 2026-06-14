const { roundMoney } = require("../payment/paymentIntent");
const { calculateCleanerPayout } = require("./cleanerPayout");

function createSettlementSnapshot(order = {}, options = {}) {
  const orderId = order._id || order.orderId || "";
  if (!orderId) throw new Error("缺少订单 ID");
  if (!["completed", "auto_completed"].includes(order.status)) {
    throw new Error("只有已完成订单可以结算");
  }
  const createdAt = options.createdAt || new Date().toISOString();
  const cleanerIncome = roundMoney(order.cleanerIncome);
  const platformFee = roundMoney(order.platformFee);
  const payout = calculateCleanerPayout({
    cleanerIncome,
    penalty: options.penalty || 0,
    bonus: options.bonus || 0,
  });
  return {
    _id: options.settlementId || `stl_${orderId}`,
    settlementId: options.settlementId || `stl_${orderId}`,
    orderId,
    orderNo: order.displayOrderNo || order.orderNo || "",
    cleanerOpenid: order.acceptedCleanerOpenid || order.cleanerId || "",
    customerOpenid: order.customerOpenid || "",
    cleanerIncome,
    platformFee,
    penalty: payout.penalty,
    bonus: payout.bonus,
    payoutAmount: payout.payoutAmount,
    status: "pending_payout",
    createdAt,
    updatedAt: createdAt,
  };
}

module.exports = {
  createSettlementSnapshot,
};
