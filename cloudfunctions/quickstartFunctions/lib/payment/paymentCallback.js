const { nextPaymentStatus } = require("./paymentStatus");
const { roundMoney } = require("./paymentIntent");

function normalizeCallbackEvent(event = {}) {
  return {
    eventId: String(event.eventId || "").trim(),
    intentId: String(event.intentId || event.paymentIntentId || "").trim(),
    orderId: String(event.orderId || "").trim(),
    status: String(event.status || "").trim(),
    amount: roundMoney(event.amount),
    occurredAt: event.occurredAt || new Date().toISOString(),
  };
}

function applyPaymentCallback(intent = {}, event = {}) {
  const callback = normalizeCallbackEvent(event);
  if (!callback.eventId) throw new Error("缺少支付回调事件 ID");
  if (!callback.intentId || callback.intentId !== intent.intentId) throw new Error("支付回调 intent 不匹配");
  if (!callback.orderId || callback.orderId !== intent.orderId) throw new Error("支付回调订单不匹配");
  if (roundMoney(intent.amount) !== callback.amount) throw new Error("支付回调金额不一致");
  const nextStatus = nextPaymentStatus(intent.status || "pending", callback.status);
  return {
    ...intent,
    status: nextStatus,
    paymentStatus: nextStatus,
    escrowStatus: nextStatus === "paid" ? "held" : nextStatus === "refunded" ? "refunded" : "",
    callbackEventId: callback.eventId,
    paidAt: nextStatus === "paid" ? callback.occurredAt : intent.paidAt || "",
    refundedAt: nextStatus === "refunded" ? callback.occurredAt : intent.refundedAt || "",
    failedAt: nextStatus === "failed" ? callback.occurredAt : intent.failedAt || "",
    updatedAt: callback.occurredAt,
  };
}

module.exports = {
  applyPaymentCallback,
  normalizeCallbackEvent,
};
