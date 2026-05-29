const { calculateDistanceKm, distanceDisplay } = require("./location");
const { normalizeCleanerStats } = require("./cleaner-stats");
const { BASE_PRICING, calculateOrderPrice } = require("../config/pricing");
const {
  normalizeOrderStatus: normalizeOrderStatusValue,
  getOrderStatusMeta,
  getOrderStatusStyle,
  getOrderStatusGroup,
  getOrderTabStatuses,
} = require("./order-status");

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatMoney(value) {
  const amount = roundMoney(value);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function statusLabel(status) {
  return getOrderStatusMeta(status).title;
}

function statusTip(status) {
  return getOrderStatusMeta(status).desc;
}

function displayText(value) {
  return String(value || "").trim();
}

function hasFiniteValue(value) {
  return value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value));
}

function getOrderStatusCopy(status, role = "customer") {
  const meta = getOrderStatusMeta(status, { role });
  return {
    title: meta.title,
    desc: meta.desc,
    badgeText: meta.badgeText,
  };
}

function roleAwareStatusLabel(status, role = "customer") {
  return getOrderStatusCopy(status, role).title;
}

function roleAwareStatusTip(status, role = "customer") {
  return getOrderStatusCopy(status, role).desc;
}

function normalizeOrderStatus(order) {
  return normalizeOrderStatusValue(order);
}

function normalizePaymentStatus(order) {
  if (!order) return "unpaid";
  if (order.paymentStatus) return order.paymentStatus;
  const status = normalizeOrderStatus(order);
  if (status === "completed" || status === "auto_completed") return "settled";
  if (status === "cancelled") return order.paidAt ? "refunded" : "unpaid";
  if (status === "waiting_payment") return "pending_pay";
  if (["confirmed", "in_service", "waiting_complete"].includes(status)) return "escrowed";
  return "unpaid";
}

function paymentStatusText(paymentStatus, role = "customer") {
  const customerMap = {
    unpaid: "未支付",
    pending_pay: "待支付",
    escrowed: "平台托管中",
    settled: "已结算",
    refunded: "已退款",
  };
  const cleanerMap = {
    unpaid: "待用户确认",
    pending_pay: "待用户支付",
    escrowed: "平台托管中",
    settled: "已结算",
    refunded: "已退款",
  };
  return (role === "cleaner" ? cleanerMap : customerMap)[paymentStatus] || customerMap.unpaid;
}

function paymentStatusTip(paymentStatus, role = "customer") {
  if (role === "customer" && paymentStatus === "escrowed") {
    return "费用已由平台托管，验收完成后结算给家洁师。";
  }
  if (role === "cleaner" && paymentStatus === "escrowed") {
    return "用户已支付，待服务完成后结算。";
  }
  return "";
}

function getUserOrderStatusGroup(order) {
  return getOrderStatusGroup(order);
}

function orderStatusCandidates(order) {
  if (!order) return [];
  return [order.rawStatus, order.status, normalizeOrderStatus(order)].filter(Boolean);
}

function getOrderTabCount(tabKey, orders, role = "customer") {
  const key = tabKey === "active" ? "ongoing" : tabKey;
  if (key !== "pending" && key !== "ongoing") return 0;
  const targetStatuses = getOrderTabStatuses(key, role);
  return (orders || []).filter((order) => orderStatusCandidates(order).some((status) => targetStatuses.includes(status))).length;
}

function withOrderTabCounts(tabs, orders, role = "customer") {
  return (tabs || []).map((tab) => {
    if (tab.key !== "pending" && tab.key !== "ongoing" && tab.key !== "active") {
      return { ...tab, count: 0 };
    }
    return {
      ...tab,
      count: getOrderTabCount(tab.key, orders, role),
    };
  });
}

function orderStatusStyle(status) {
  return getOrderStatusStyle(status);
}

function shortDate(value) {
  if (!value) return "待确认";
  const text = String(value).replace(/-/g, "/").replace("T", " ");
  return text.slice(0, 16);
}

function maskPhone(phone) {
  if (!phone || String(phone).length < 7) return "";
  const value = String(phone);
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function avatarUrlOf(...sources) {
  for (const source of sources) {
    if (!source) continue;
    const value =
      (source.cleanerProfile && source.cleanerProfile.avatarUrl) ||
      source.avatarUrl ||
      (source.cleaner && source.cleaner.avatarUrl) ||
      (source.cleaner && source.cleaner.avatar) ||
      source.avatar ||
      (source.profile && source.profile.avatarUrl);
    if (value) return value;
  }
  return "";
}

function avatarInitial(value, fallback = "邻") {
  const text = String(value || "").trim();
  return text ? text.slice(0, 1) : fallback;
}

function estimatePrice(order) {
  if (!order) return 0;
  if (order.pricingSnapshot && order.pricingSnapshot.orderAmount) return Number(order.pricingSnapshot.orderAmount);
  if (order.amount) return Number(order.amount);
  if (order.orderAmount) return Number(order.orderAmount);
  if (order.estimatedPrice) return Number(order.estimatedPrice);
  return calculateOrderPrice({
    city: (order.locationSnapshot && order.locationSnapshot.city) || order.city || "",
    serviceType: order.serviceType,
    durationHours: order.durationHours,
  }).orderAmount;
}

function commissionFor(orderAmount) {
  const amount = roundMoney(orderAmount);
  const platformFee = roundMoney(amount * BASE_PRICING.platformFeeRate);
  return {
    orderAmount: amount,
    platformFee,
    cleanerIncome: roundMoney(amount - platformFee),
    commissionRate: BASE_PRICING.platformFeeRate,
    commissionCap: 0,
  };
}

function workload(order) {
  if (!order) return "";
  const parts = [];
  if (order.areaSize) parts.push(`${order.areaSize}㎡`);
  if (order.durationHours) parts.push(`${order.durationHours}小时`);
  return parts.join(" · ") || "工作量待确认";
}

function compactParts(parts) {
  return (parts || []).map((part) => String(part || "").trim()).filter(Boolean);
}

function cityCodeOf(location) {
  const city = (location && location.city) || "";
  const district = (location && location.district) || "";
  const exact = {
    "上海市|嘉定区": "SHJD",
    "哈尔滨市|道里区": "HRBDL",
    "无锡市|江阴市": "WXJY",
  };
  if (exact[`${city}|${district}`]) return exact[`${city}|${district}`];
  const cityMap = {
    上海市: "SH",
    哈尔滨市: "HRB",
    无锡市: "WX",
    杭州市: "HZ",
    北京市: "BJ",
    广州市: "GZ",
  };
  const districtMap = {
    嘉定区: "JD",
    道里区: "DL",
    江阴市: "JY",
    西湖区: "XH",
    朝阳区: "CY",
    天河区: "TH",
  };
  return `${cityMap[city] || "LOCAL"}${districtMap[district] || ""}`;
}

function displayDateCode(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function legacyDisplayOrderNo(order) {
  if (!order) return "";
  const location = order.locationSnapshot || order;
  const dateCode = displayDateCode(order.createdAt || order.createTime);
  if ((location.city || location.district) && dateCode) {
    return `${cityCodeOf(location)}-${dateCode}-OLD`;
  }
  return "订单编号待生成";
}

function fullAddressOf(order) {
  if (!order) return "地址待补充";
  const snapshot = order.locationSnapshot || {};
  if (snapshot.addressText) return snapshot.addressText;
  const joined = compactParts([
    snapshot.province || order.province,
    snapshot.city || order.city,
    snapshot.district || order.district,
    snapshot.street || order.street,
    snapshot.community || order.community,
    snapshot.detailAddress || order.detailAddress,
  ]).join(" ");
  return joined || order.addressText || order.community || "地址待补充";
}

function shortOrderNo(order) {
  if (!order) return "";
  if (order.displayOrderNo) return order.displayOrderNo;
  return legacyDisplayOrderNo(order);
}

function haversineDistanceKm(from, to) {
  return calculateDistanceKm(from, to);
}

function formatDistanceText(distanceKm) {
  if (distanceKm === undefined || distanceKm === null || distanceKm === "") return "距离未知";
  const distance = Number(distanceKm);
  if (!Number.isFinite(distance)) return "距离未知";
  if (distance < 0.1) return "<0.1km";
  return `${distance.toFixed(1)}km`;
}

function ratingReviewText(rating) {
  const value = Number(rating || 0);
  if (!value) return "请选择评分";
  if (value <= 1.5) return "很不满意";
  if (value <= 2.5) return "不太满意";
  if (value <= 3.5) return "一般";
  if (value <= 4.5) return "满意";
  return "非常满意";
}

function ratingValueText(rating) {
  const value = Number(rating || 0);
  if (!value) return "";
  return `${Number.isInteger(value) ? String(value) : value.toFixed(1)}分`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function scoreRecommendedCleaner(cleaner) {
  const distance = Number(cleaner.distanceKm);
  const distanceScore = Number.isFinite(distance) && cleaner.distanceStatus === "valid" ? clamp(1 - distance / 20, 0, 1) : 0;
  const stats = normalizeCleanerStats(cleaner);
  const ratingScore = clamp(Number(stats.rating || 0) / 5, 0, 1);
  const orderScore = clamp(Number(stats.serviceCount || 0) / 100, 0, 1);
  return Math.round((distanceScore * 50 + ratingScore * 30 + orderScore * 20) * 10) / 10;
}

function sortRecommendedCleaners(cleaners) {
  return (cleaners || []).slice().sort((first, second) => Number(second.score || 0) - Number(first.score || 0));
}

function cleanerLocationOf(cleaner) {
  return (
    cleaner.lastLocation ||
    cleaner.currentLocation ||
    cleaner.location ||
    (cleaner.profile && cleaner.profile.location) ||
    cleaner.lastActiveLocation ||
    cleaner.profileLocation ||
    cleaner.addressLocation ||
    cleaner
  );
}

function getCleanerDistanceInfo(cleaner, userLocation) {
  return distanceDisplay(userLocation, cleanerLocationOf(cleaner || {}), {
    cleanerName: cleaner && (cleaner.displayName || cleaner.nickname || cleaner.name),
  });
}

function getCleanerDistanceText(cleaner, userLocation) {
  const distanceInfo = getCleanerDistanceInfo(cleaner, userLocation);
  return {
    distanceKm: distanceInfo.distanceKm,
    distanceText: distanceInfo.distanceText,
  };
}

function orderLocationOf(order) {
  const snapshot = order.locationSnapshot || {};
  return {
    province: snapshot.province || order.province || "",
    city: snapshot.city || order.city || "",
    district: snapshot.district || order.district || "",
    street: snapshot.street || order.street || "",
    community: snapshot.community || order.community || "",
    addressText: snapshot.addressText || order.addressText || "",
    latitude: snapshot.latitude ?? snapshot.lat ?? order.latitude ?? order.lat ?? null,
    longitude: snapshot.longitude ?? snapshot.lng ?? snapshot.lon ?? order.longitude ?? order.lng ?? order.lon ?? null,
  };
}

function warnMissingOrderDistanceCoordinate(order, referenceLocation, orderLocation, distanceInfo) {
  if (!referenceLocation || distanceInfo.distanceStatus !== "unknown") return;
  console.warn("[order distance missing coordinate]", {
    orderId: order._id,
    addressText: order.addressText,
    locationSnapshot: order.locationSnapshot,
    orderLocation,
    cleanerLocation: referenceLocation,
  });
}

function orderDistanceFields(order, referenceLocation) {
  const orderLocation = orderLocationOf(order);
  const distanceInfo = referenceLocation ? distanceDisplay(referenceLocation, orderLocation) : { distanceText: "" };
  warnMissingOrderDistanceCoordinate(order, referenceLocation, orderLocation, distanceInfo);
  return {
    orderLocation,
    distanceText: order.nonLocal ? "非当前城市" : distanceInfo.distanceText || order.distanceText || "",
    distanceKm: distanceInfo.distanceKm ?? order.distanceKm ?? null,
    distanceStatus: order.nonLocal ? "nonLocal" : distanceInfo.distanceStatus || order.distanceStatus || "",
  };
}

function decorateOrderDistance(order, cleanerLocation) {
  const fields = orderDistanceFields(order, cleanerLocation);
  return {
    ...order,
    distanceText: fields.distanceText || "距离未知",
    distanceKm: fields.distanceKm,
    distanceStatus: fields.distanceStatus || "unknown",
  };
}

function decorateOrder(order, openid, role = "", referenceLocation = null) {
  const isCustomer = order.customerOpenid === openid;
  const isCleaner = order.acceptedCleanerOpenid === openid || order.assignedCleanerOpenid === openid;
  const viewerRole = role || (isCustomer ? "customer" : isCleaner ? "cleaner" : "");
  const statusMeta = getOrderStatusMeta(order, { role: viewerRole });
  const displayStatus = statusMeta.key === "unknown" ? normalizeOrderStatus(order) : statusMeta.key;
  const price = estimatePrice(order);
  const commission = commissionFor(price);
  const platformFee = Number(order.platformFee || commission.platformFee);
  const cleanerIncome = Number(order.cleanerIncome || commission.cleanerIncome);
  const paymentStatus = normalizePaymentStatus({ ...order, status: displayStatus });
  const distanceFields = orderDistanceFields(order, referenceLocation);
  const locationText = [distanceFields.orderLocation.city, distanceFields.orderLocation.district].filter(Boolean).join(" ");
  const statusCopy = {
    title: statusMeta.title,
    desc: statusMeta.desc,
    badgeText: statusMeta.badgeText,
  };
  const statusBadgeText = displayText(statusMeta.badgeText) || displayText(statusMeta.title) || "状态未知";
  const reviewBadgeText = order.hasReview || order.reviewId ? "已评价" : "";
  const nonLocalText = order.nonLocal ? "非同城" : "";
  const rawDistanceText = displayText(distanceFields.distanceText || order.distanceText);
  const distanceDisplayText = order.nonLocal
    ? rawDistanceText && rawDistanceText !== "非当前城市"
      ? rawDistanceText
      : hasFiniteValue(distanceFields.distanceKm)
        ? formatDistanceText(distanceFields.distanceKm)
        : ""
    : rawDistanceText || "距离未知";
  const completionPhotoUrls = (order.completionPhotoUrls || order.completionImageUrls || order.serviceProofImageUrls || []).filter(Boolean);
  const completionPhotos = Array.isArray(order.completionPhotos)
    ? order.completionPhotos
    : completionPhotoUrls.map((fileID) => ({ fileID, url: fileID }));
  return {
    ...order,
    completionPhotos,
    completionPhotoUrls,
    completionImageUrls: completionPhotoUrls,
    status: displayStatus,
    rawStatus: order.status,
    displayAddress: fullAddressOf(order),
    locationText,
    distanceText: distanceDisplayText,
    distanceDisplayText,
    distanceKm: distanceFields.distanceKm,
    distanceStatus: distanceFields.distanceStatus,
    nonLocal: Boolean(order.nonLocal),
    nonLocalText,
    shortAddress: order.community || order.addressText || "附近小区",
    serviceTypeText: order.serviceType || "日常保洁",
    durationHours: Number(order.durationHours || order.duration || 0),
    serviceTimeText: shortDate(order.serviceTime || order.scheduledAt),
    statusCopy,
    statusText: statusBadgeText,
    statusBadgeText,
    statusTitle: statusCopy.title,
    statusDesc: statusCopy.desc,
    statusStyle: statusMeta.statusStyle,
    statusTip: statusCopy.desc,
    statusGroup: statusMeta.statusGroup,
    paymentStatus,
    paymentStatusText: paymentStatusText(paymentStatus, viewerRole),
    paymentTip: paymentStatusTip(paymentStatus, viewerRole),
    canPay: viewerRole === "customer" && displayStatus === "waiting_payment" && paymentStatus === "pending_pay",
    scheduledText: shortDate(order.scheduledAt),
    workloadText: workload(order),
    orderAmount: price,
    platformFee,
    cleanerIncome,
    priceText: `¥${formatMoney(price)}`,
    priceRangeText: `¥${formatMoney(price)}`,
    platformFeeText: `¥${formatMoney(platformFee)}`,
    platformFeeDeductText: `-¥${formatMoney(platformFee)}`,
    cleanerIncomeText: `¥${formatMoney(cleanerIncome)}`,
    roleText: viewerRole === "customer" ? "我发布的" : viewerRole === "cleaner" && isCleaner ? "客户发布" : "可接订单",
    customerMaskedPhone: maskPhone(order.contactPhone),
    responseCount: (order.responses || []).length,
    reviewedText: reviewBadgeText,
    reviewStatusText: reviewBadgeText,
    reviewBadgeText,
    canManage: ["completed", "auto_completed", "cancelled"].includes(displayStatus),
    displayOrderNo: shortOrderNo(order),
  };
}

function decorateCleaner(cleaner, userLocation) {
  const stats = normalizeCleanerStats(cleaner);
  const distanceInfo = getCleanerDistanceInfo(cleaner, userLocation);
  const avatarUrl = avatarUrlOf(cleaner);
  const decorated = {
    ...cleaner,
    avatarUrl,
    avatarText: avatarUrl ? "" : avatarInitial(cleaner.displayName, "洁"),
    areaText: (cleaner.serviceAreas || []).join("、") || "附近社区",
    serviceText: (cleaner.serviceTypes || []).join("、") || "日常保洁",
    rating: stats.rating,
    ratingAvg: stats.rating,
    ratingText: stats.ratingText,
    reviewCount: stats.reviewCount,
    serviceCount: stats.serviceCount,
    completedOrderCount: stats.serviceCount,
    completedOrderCountText: stats.serviceCount,
    communityCount: stats.communityCount,
    stats,
    distanceKm: distanceInfo.distanceKm,
    distanceText: distanceInfo.distanceText,
    distanceStatus: distanceInfo.distanceStatus,
    distanceSource: {
      userLocation: distanceInfo.userLocation,
      cleanerLocation: distanceInfo.cleanerLocation,
    },
    manualApprovedText: cleaner.manualApproved ? "平台已审核" : "待审核",
    availableText: cleaner.available ? "接单中" : "休息中",
  };
  return {
    ...decorated,
    score: scoreRecommendedCleaner(decorated),
  };
}

module.exports = {
  statusLabel,
  statusTip,
  getOrderStatusCopy,
  roleAwareStatusLabel,
  roleAwareStatusTip,
  normalizeOrderStatus,
  normalizePaymentStatus,
  paymentStatusText,
  paymentStatusTip,
  getUserOrderStatusGroup,
  getOrderTabCount,
  withOrderTabCounts,
  orderStatusStyle,
  formatMoney,
  shortDate,
  maskPhone,
  avatarUrlOf,
  avatarInitial,
  estimatePrice,
  commissionFor,
  workload,
  fullAddressOf,
  shortOrderNo,
  orderLocationOf,
  decorateOrderDistance,
  haversineDistanceKm,
  formatDistanceText,
  ratingReviewText,
  ratingValueText,
  scoreRecommendedCleaner,
  sortRecommendedCleaners,
  getCleanerDistanceText,
  decorateOrder,
  decorateCleaner,
};
