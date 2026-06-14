function normalizeOrderAdminFilter(input = {}) {
  return {
    status: String(input.status || "").trim(),
    paymentStatus: String(input.paymentStatus || "").trim(),
    settlementStatus: String(input.settlementStatus || "").trim(),
    limit: Math.min(Math.max(Number(input.limit || 50), 1), 100),
  };
}

module.exports = {
  normalizeOrderAdminFilter,
};
