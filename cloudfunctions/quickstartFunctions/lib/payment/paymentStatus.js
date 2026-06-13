const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];

function assertPaymentStatus(status) {
  if (!PAYMENT_STATUSES.includes(status)) {
    throw new Error("支付状态不正确");
  }
  return status;
}

function nextPaymentStatus(currentStatus, nextStatus) {
  const current = currentStatus || "pending";
  const next = assertPaymentStatus(nextStatus);
  if (current === next) {
    if (current === "paid") throw new Error("不能重复支付");
    return next;
  }
  if (current === "refunded" && next === "paid") {
    throw new Error("不能从已退款变为已支付");
  }
  if (current === "paid" && next === "pending") {
    throw new Error("已支付订单不能回到待支付");
  }
  if (current === "failed" && next === "paid") return "paid";
  if (current === "pending" && ["paid", "failed"].includes(next)) return next;
  if (current === "paid" && next === "refunded") return next;
  if (current === "failed" && next === "refunded") return next;
  throw new Error("支付状态流转不正确");
}

module.exports = {
  PAYMENT_STATUSES,
  assertPaymentStatus,
  nextPaymentStatus,
};
