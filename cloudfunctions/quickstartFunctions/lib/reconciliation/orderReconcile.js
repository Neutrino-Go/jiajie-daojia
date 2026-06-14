function reconcileOrders(input = {}) {
  const orders = Array.isArray(input.orders) ? input.orders : [];
  const paymentIntents = Array.isArray(input.paymentIntents) ? input.paymentIntents : [];
  const settlements = Array.isArray(input.settlements) ? input.settlements : [];
  const orderById = new Map(orders.map((order) => [order._id || order.orderId, order]));
  const settlementsByOrderId = new Map(settlements.map((item) => [item.orderId, item]));
  const mismatches = [];

  paymentIntents.forEach((intent) => {
    if (intent.status !== "paid") return;
    const order = orderById.get(intent.orderId);
    const paidLike = order && ["paid", "escrowed", "settled"].includes(order.paymentStatus);
    if (!paidLike) {
      mismatches.push({ type: "paid_intent_order_not_paid", orderId: intent.orderId, intentId: intent.intentId || intent._id });
    }
  });

  orders.forEach((order) => {
    const orderId = order._id || order.orderId;
    if (order.settlementStatus === "settled" && !settlementsByOrderId.has(orderId)) {
      mismatches.push({ type: "settled_order_missing_settlement", orderId });
    }
  });

  return {
    checkedOrders: orders.length,
    checkedPaymentIntents: paymentIntents.length,
    checkedSettlements: settlements.length,
    mismatches,
  };
}

module.exports = {
  reconcileOrders,
};
