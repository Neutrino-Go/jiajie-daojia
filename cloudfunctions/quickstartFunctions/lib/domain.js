function AppError(message, code) {
  const error = new Error(message);
  error.code = code || "BUSINESS_ERROR";
  return error;
}

function requireValue(value, message) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw AppError(message);
  }
}

function cleanText(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function normalizeUserAddress(input) {
  const address = {
    province: cleanText(input.province, 30),
    city: cleanText(input.city, 30),
    district: cleanText(input.district, 30),
    street: cleanText(input.street, 40),
    community: cleanText(input.community, 40),
    detailAddress: cleanText(input.detailAddress, 80),
    latitude: optionalNumber(input.latitude),
    longitude: optionalNumber(input.longitude),
  };
  requireValue(address.community, "请填写小区/社区名称");
  requireValue(address.detailAddress, "请填写详细地址");
  return address;
}

function normalizeCity(value) {
  return cleanText(value, 30);
}

function filterRecommendedCleanersByCity(cleaners, location) {
  const city = normalizeCity(location && location.city);
  if (!city) return [];
  return (cleaners || []).filter((cleaner) => normalizeCity(cleaner.lastLocation && cleaner.lastLocation.city) === city);
}

function validCoordinate(location) {
  if (!location) return false;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude);
}

function haversineDistanceKm(from, to) {
  if (!validCoordinate(from) || !validCoordinate(to)) return null;
  const earthRadiusKm = 6371;
  const fromLat = (Number(from.latitude) * Math.PI) / 180;
  const toLat = (Number(to.latitude) * Math.PI) / 180;
  const deltaLat = ((Number(to.latitude) - Number(from.latitude)) * Math.PI) / 180;
  const deltaLng = ((Number(to.longitude) - Number(from.longitude)) * Math.PI) / 180;
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusKm * c * 10) / 10;
}

function formatDistanceText(distanceKm) {
  if (distanceKm === undefined || distanceKm === null || distanceKm === "") return "距离未知";
  const distance = Number(distanceKm);
  if (!Number.isFinite(distance)) return "距离未知";
  if (distance < 0.1) return "<0.1km";
  return `${distance.toFixed(1)}km`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function scoreRecommendedCleaner(cleaner) {
  const distance = Number(cleaner.distanceKm);
  const distanceScore = Number.isFinite(distance) ? clamp(1 - distance / 20, 0, 1) : 0;
  const ratingScore = clamp(Number(cleaner.ratingAvg || 0) / 5, 0, 1);
  const orderScore = clamp(Number(cleaner.completedOrderCount || cleaner.reviewCount || 0) / 100, 0, 1);
  return Math.round((distanceScore * 50 + ratingScore * 30 + orderScore * 20) * 10) / 10;
}

function sortRecommendedCleaners(cleaners) {
  return (cleaners || [])
    .map((cleaner) => ({
      ...cleaner,
      score: scoreRecommendedCleaner(cleaner),
    }))
    .sort((first, second) => second.score - first.score);
}

function normalizeOrderStatus(status) {
  if (status === "accepted") return "confirmed";
  if (status === "waiting_acceptance") return "waiting_complete";
  return status;
}

function normalizePaymentStatus(order) {
  if (!order) return "unpaid";
  if (order.paymentStatus) return order.paymentStatus;
  const status = normalizeOrderStatus(order.status);
  if (status === "completed" || status === "auto_completed") return "settled";
  if (status === "cancelled") return order.paidAt ? "refunded" : "unpaid";
  if (status === "waiting_payment") return "pending_pay";
  if (["confirmed", "in_service", "waiting_complete"].includes(status)) return "escrowed";
  return "unpaid";
}

function isTerminalOrderStatus(status) {
  return ["completed", "auto_completed", "cancelled"].includes(normalizeOrderStatus(status));
}

function canHideOrderForRole(order, role) {
  if (!order || !["customer", "cleaner"].includes(role)) return false;
  return isTerminalOrderStatus(order.status);
}

function isSettledIncomeOrder(order) {
  const status = normalizeOrderStatus(order && order.status);
  return ["completed", "auto_completed"].includes(status) && normalizePaymentStatus(order) === "settled";
}

function autoAcceptanceHoursForOrder(order) {
  const serviceType = String((order && order.serviceType) || "");
  if (serviceType === "日常保洁") return 48;
  if (serviceType === "深度保洁" || serviceType === "开荒保洁" || serviceType === "家务整理") return 72;
  return 72;
}

function getUserOrderStatusGroup(order) {
  const status = normalizeOrderStatus(order && order.status);
  if (["pending", "waiting_response", "waiting_confirm", "assigned_waiting_accept", "assigned_declined"].includes(status)) {
    return "pending";
  }
  if (["waiting_payment", "confirmed", "in_service", "waiting_complete"].includes(status)) {
    return "ongoing";
  }
  if (status === "completed" || status === "auto_completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "pending";
}

function assertCompletionReviewInput(input) {
  const rating = Number(input && input.rating);
  if (!Number.isFinite(rating) || rating < 0.5 || rating > 5) {
    throw AppError("请选择 0.5-5 星评分");
  }
  if (Math.round(rating * 2) !== rating * 2) {
    throw AppError("请选择 0.5 星递增的评分");
  }
}

function isManualReview(review) {
  if (!review || review.source !== "manual" || review.autoGenerated) return false;
  const rating = Number(review.rating);
  return Number.isFinite(rating) && rating >= 0.5 && rating <= 5;
}

function canEditReview(review, currentTime = new Date()) {
  if (!review || Number(review.editCount || 0) > 0) return false;
  const createdAt = new Date(review.createdAt);
  const nowTime = new Date(currentTime);
  if (Number.isNaN(createdAt.getTime()) || Number.isNaN(nowTime.getTime())) return false;
  return nowTime.getTime() - createdAt.getTime() <= 24 * 60 * 60 * 1000;
}

function normalizeReviewImageUrls(imageUrls) {
  if (!Array.isArray(imageUrls)) return [];
  return imageUrls
    .map((url) => String(url || "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function buildAutoAcceptanceReview() {
  return {
    rating: 5,
    content: "系统自动验收，默认好评",
    autoGenerated: true,
    source: "auto_acceptance",
  };
}

function isOrderOverdueForAutoAcceptance(order, currentTime = new Date(), days = null) {
  if (!order || normalizeOrderStatus(order.status) !== "waiting_complete" || !(order.serviceCompletedAt || order.serviceFinishedAt)) return false;
  const finishedAt = new Date(order.serviceCompletedAt || order.serviceFinishedAt);
  const checkedAt = new Date(currentTime);
  if (Number.isNaN(finishedAt.getTime()) || Number.isNaN(checkedAt.getTime())) return false;
  const hours = days === undefined || days === null ? autoAcceptanceHoursForOrder(order) : Number(days) * 24;
  return checkedAt.getTime() - finishedAt.getTime() > hours * 60 * 60 * 1000;
}

function isMoveInServiceType(serviceType) {
  const value = String(serviceType || "").trim();
  return value === "开荒保洁" || value === "moveIn" || value === "movein";
}

function assertCreateOrderInput(input) {
  requireValue(input.publishMode, "请选择发布方式");
  if (!["public", "assigned"].includes(input.publishMode)) {
    throw AppError("发布方式不正确");
  }
  if (input.publishMode === "assigned") {
    requireValue(input.assignedCleanerOpenid, "请选择指派家洁师");
  }
  requireValue(input.serviceType, "请选择服务类型");
  if (isMoveInServiceType(input.serviceType) && Number(input.areaSqm || input.areaSize || 0) <= 0) {
    throw AppError("开荒保洁请填写面积后再发布");
  }
  if (!input.addressText && !input.community) {
    throw AppError("请填写地址或小区");
  }
  requireValue(input.scheduledAt, "请选择服务时间");
  requireValue(input.contactPhone, "请填写联系电话");
}

function assertCleanerCanAccept(order, cleaner) {
  if (!cleaner) {
    throw AppError("请先完善家洁师资料");
  }
  if (!cleaner.manualApproved) {
    throw AppError("家洁师资料待平台审核");
  }
  if (!cleaner.available) {
    throw AppError("当前状态不可接单");
  }
  const canRespondPublic =
    order && order.publishMode === "public" && ["waiting_response", "waiting_confirm", "pending"].includes(order.status);
  const canAcceptAssigned =
    order && order.publishMode === "assigned" && ["assigned_waiting_accept", "pending"].includes(order.status);
  if (!canRespondPublic && !canAcceptAssigned) {
    throw AppError("订单已被确认或不可响应");
  }
  if (canAcceptAssigned && order.assignedCleanerOpenid !== cleaner._openid) {
    throw AppError("只有被指派的家洁师可以接单");
  }
}

function assertStatusTransition(order, nextStatus, openid, input = {}) {
  if (!order) {
    throw AppError("订单不存在");
  }
  const normalizedNextStatus = normalizeOrderStatus(nextStatus);
  const currentStatus = normalizeOrderStatus(order.status);
  if (normalizedNextStatus === "cancelled") {
    if (order.customerOpenid !== openid) {
      throw AppError("只能取消自己的订单");
    }
    if (!["waiting_response", "waiting_confirm", "assigned_waiting_accept", "assigned_declined", "waiting_payment", "confirmed", "pending", "accepted"].includes(order.status)) {
      throw AppError("当前订单不可取消");
    }
    return;
  }
  if (normalizedNextStatus === "in_service") {
    if (order.acceptedCleanerOpenid !== openid) {
      throw AppError("只有接单家洁师可以开始服务");
    }
    if (!["confirmed", "accepted"].includes(currentStatus)) {
      throw AppError("只有已确认订单可以开始服务");
    }
    if (normalizePaymentStatus(order) !== "escrowed") {
      throw AppError("客户支付后才可开始服务");
    }
    return;
  }
  if (normalizedNextStatus === "waiting_complete") {
    if (order.acceptedCleanerOpenid !== openid) {
      throw AppError("只有接单家洁师可以完成服务");
    }
    if (currentStatus !== "in_service") {
      throw AppError("只有服务中订单可以完成");
    }
    return;
  }
  if (normalizedNextStatus === "completed") {
    if (order.customerOpenid !== openid) {
      throw AppError("只有下单客户可以确认完成");
    }
    if (currentStatus !== "waiting_complete") {
      throw AppError("只有待验收订单可以完成");
    }
    if (!input || input.rating === undefined || input.rating === null || input.rating === "") {
      throw AppError("请先完成评分后再验收");
    }
    assertCompletionReviewInput(input);
    return;
  }
  throw AppError("不支持的状态更新");
}

function assertReviewAllowed(order, openid, existingReview) {
  if (!order) {
    throw AppError("订单不存在");
  }
  if (order.customerOpenid !== openid) {
    throw AppError("只有下单客户可以评价");
  }
  if (order.status !== "completed") {
    throw AppError("服务完成后才能评价");
  }
  if (!order.acceptedCleanerOpenid) {
    throw AppError("订单缺少接单家洁师");
  }
  if (existingReview) {
    throw AppError("该订单已评价");
  }
}

module.exports = {
  AppError,
  assertCreateOrderInput,
  assertCleanerCanAccept,
  assertStatusTransition,
  assertReviewAllowed,
  assertCompletionReviewInput,
  normalizeReviewImageUrls,
  canEditReview,
  isManualReview,
  normalizePaymentStatus,
  isTerminalOrderStatus,
  canHideOrderForRole,
  isSettledIncomeOrder,
  autoAcceptanceHoursForOrder,
  buildAutoAcceptanceReview,
  getUserOrderStatusGroup,
  isOrderOverdueForAutoAcceptance,
  normalizeUserAddress,
  filterRecommendedCleanersByCity,
  haversineDistanceKm,
  formatDistanceText,
  scoreRecommendedCleaner,
  sortRecommendedCleaners,
};
