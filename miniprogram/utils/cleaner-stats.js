const { cleanerOpenidOf } = require("./cleaner-id");

function normalizeCleanerStats(cleaner = {}) {
  const stats = cleaner.stats || {};
  const serviceCount = Number(
    stats.serviceCount ??
      cleaner.serviceCount ??
      cleaner.completedOrderCount ??
      cleaner.completedOrders?.length ??
      cleaner.reviewCount ??
      0
  );
  const reviewCount = Number(stats.reviewCount ?? cleaner.reviewCount ?? 0);
  const rating = Number(stats.rating ?? cleaner.rating ?? cleaner.ratingAvg ?? 0);
  const ratingText = rating > 0 ? `${rating.toFixed(1)}分` : "暂无评分";
  const completedOrders = stats.completedOrders || cleaner.completedOrders || [];
  const communityCount = Number(
    stats.communityCount ??
      cleaner.communityCount ??
      (Array.isArray(cleaner.serviceAreas) ? cleaner.serviceAreas.length : 0)
  );
  const cleanerId = cleanerOpenidOf(cleaner) || stats.cleanerId || "";

  console.log("[cleaner stats]", cleanerId, {
    serviceCount,
    rating,
    reviewCount,
    completedOrders: completedOrders.map ? completedOrders.map((order) => order._id || order) : completedOrders,
  });

  return {
    cleanerId,
    rating,
    ratingText,
    reviewCount,
    serviceCount,
    completedOrders,
    communityCount,
  };
}

module.exports = {
  normalizeCleanerStats,
};
