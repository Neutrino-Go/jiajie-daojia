const COMPLETED_STATUSES = new Set(["completed", "auto_completed", "settled"]);
const CANCELLED_STATUSES = new Set(["cancelled", "customer_cancelled", "cleaner_cancelled"]);

function toDate(value) {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date : null;
}

function round2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function amountOf(order = {}) {
  return Number(
    order.customerPayAmount ??
    order.orderAmount ??
    order.totalAmount ??
    order.amount ??
    0
  );
}

function idOf(record = {}, keys = []) {
  for (const key of keys) {
    const value = String(record[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function inWindow(record = {}, startMs, endMs) {
  const date = toDate(record.createdAt || record.updatedAt || record.paidAt || record.completedAt);
  if (!date) return false;
  const time = date.getTime();
  return time >= startMs && time <= endMs;
}

function average(values = []) {
  const numbers = values.map(Number).filter((value) => Number.isFinite(value));
  if (!numbers.length) return 0;
  return round2(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}

function responseMinutes(order = {}) {
  const created = toDate(order.createdAt);
  const accepted = toDate(order.acceptedAt || order.respondedAt || order.responseAt);
  if (!created || !accepted) return null;
  const minutes = (accepted.getTime() - created.getTime()) / (60 * 1000);
  return minutes >= 0 ? minutes : null;
}

function calculateMetricWindow(records = {}, startMs, endMs) {
  const orders = (records.orders || []).filter((order) => inWindow(order, startMs, endMs));
  const completedOrders = orders.filter((order) => COMPLETED_STATUSES.has(order.status));
  const cancelledOrders = orders.filter((order) => CANCELLED_STATUSES.has(order.status));
  const activeUsers = new Set();
  const activeCleaners = new Set();

  orders.forEach((order) => {
    const userId = idOf(order, ["customerOpenid", "userOpenid", "openid"]);
    const cleanerId = idOf(order, ["acceptedCleanerOpenid", "assignedCleanerOpenid", "cleanerId"]);
    if (userId) activeUsers.add(userId);
    if (cleanerId) activeCleaners.add(cleanerId);
  });

  return {
    GMV: round2(completedOrders.reduce((sum, order) => sum + amountOf(order), 0)),
    completionRate: orders.length ? round2(completedOrders.length / orders.length) : 0,
    cancellationRate: orders.length ? round2(cancelledOrders.length / orders.length) : 0,
    avgResponseTime: average(orders.map(responseMinutes).filter((value) => value !== null)),
    activeUsers: activeUsers.size,
    activeCleaners: activeCleaners.size,
    trustScoreAvg: average((records.cleanerTrustProfiles || []).map((profile) => profile.trustScore)),
    riskScoreAvg: average((records.orderRiskProfiles || []).map((profile) => profile.riskScore)),
    orderCount: orders.length,
    completedOrderCount: completedOrders.length,
    cancelledOrderCount: cancelledOrders.length,
  };
}

function calculateSystemMetrics(input = {}) {
  const now = toDate(input.now) || new Date();
  const endMs = now.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  return {
    generatedAt: now.toISOString(),
    dailyMetrics: calculateMetricWindow(input, endMs - dayMs, endMs),
    weeklyMetrics: calculateMetricWindow(input, endMs - 7 * dayMs, endMs),
  };
}

module.exports = {
  calculateMetricWindow,
  calculateSystemMetrics,
};
