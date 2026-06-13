function roundMoney(value) {
  const number = Number(value || 0);
  return Math.round(number * 100) / 100;
}

function payableAmountOf(order = {}) {
  return roundMoney(order.customerPayAmount || order.orderAmount || order.amount || order.estimatedPrice || 0);
}

function paymentIntentKey(orderId, idempotencyKey) {
  return `${orderId || ""}::${idempotencyKey || "default"}`;
}

function createPaymentIntentSnapshot(order = {}, options = {}) {
  const orderId = order._id || order.orderId || "";
  const idempotencyKey = String(options.idempotencyKey || orderId || "default").trim();
  const createdAt = options.createdAt || new Date().toISOString();
  const amount = payableAmountOf(order);
  if (!orderId) throw new Error("缺少订单 ID");
  if (amount <= 0) throw new Error("订单金额不正确");
  const intentKey = paymentIntentKey(orderId, idempotencyKey);
  return {
    _id: options.intentId || `pi_${Buffer.from(intentKey).toString("hex").slice(0, 24)}`,
    intentId: options.intentId || `pi_${Buffer.from(intentKey).toString("hex").slice(0, 24)}`,
    intentKey,
    orderId,
    orderNo: order.displayOrderNo || order.orderNo || "",
    userOpenid: order.customerOpenid || options.userOpenid || "",
    amount,
    currency: "CNY",
    status: "pending",
    paymentProvider: "manual_stub",
    idempotencyKey,
    createdAt,
    updatedAt: createdAt,
  };
}

module.exports = {
  createPaymentIntentSnapshot,
  payableAmountOf,
  paymentIntentKey,
  roundMoney,
};
