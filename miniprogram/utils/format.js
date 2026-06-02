const {
  STATUS_LABELS,
  STATUS_TIPS,
} = require("./constants");
const { calculateDistanceKm, distanceDisplay } = require("./location");
const { normalizeCleanerStats } = require("./cleaner-stats");
const { cleanerOpenidOf } = require("./cleaner-id");
const { BASE_PRICING, calculateOrderPrice } = require("../config/pricing");

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatMoney(value) {
  const amount = roundMoney(value);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function statusLabel(status) {
  return STATUS_LABELS[status] || "未知状态";
}

function statusTip(status) {
  return STATUS_TIPS[status] || "";
}

function displayText(value) {
  return String(value || "").trim();
}

function hasFiniteValue(value) {
  return value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value));
}

const ORDER_STATUS_COPY = {
  customer: {
    waiting_response: {
      title: "等待家洁师响应",
      desc: "需求已发布，正在等待附近家洁师响应",
      badgeText: "待响应",
    },
    waiting_confirm: {
      title: "待确认",
      desc: "已有家洁师响应，请选择合适的家洁师",
      badgeText: "待确认",
    },
    assigned_waiting_accept: {
      title: "等待家洁师接单",
      desc: "已指定家洁师，等待对方确认是否接单",
      badgeText: "待接单",
    },
    assigned_declined: {
      title: "家洁师已拒绝",
      desc: "家洁师已拒绝，可重新指派或改为公开订单",
      badgeText: "已拒绝",
    },
    waiting_payment: {
      title: "待平台确认",
      desc: "支付能力待接入，当前订单暂不能进入履约流程。",
      badgeText: "待确认",
    },
    confirmed: {
      title: "待服务",
      desc: "家洁师已确认，等待按约定时间上门服务",
      badgeText: "待服务",
    },
    in_service: {
      title: "服务中",
      desc: "家洁师正在服务，请留意沟通消息",
      badgeText: "服务中",
    },
    waiting_complete: {
      title: "待验收",
      desc: "家洁师已提交完成，请验收并评价本次服务",
      badgeText: "待验收",
    },
    completed: {
      title: "已完成",
      desc: "服务已完成，感谢你的使用",
      badgeText: "已完成",
    },
    auto_completed: {
      title: "系统已完成",
      desc: "超时未验收，系统已自动完成订单",
      badgeText: "已完成",
    },
    cancelled: {
      title: "已取消",
      desc: "订单已取消",
      badgeText: "已取消",
    },
  },
  cleaner: {
    waiting_response: {
      title: "可响应订单",
      desc: "客户需求已发布，可选择是否接单",
      badgeText: "可响应",
    },
    waiting_confirm: {
      title: "待客户确认",
      desc: "你已响应此订单，等待客户确认是否选择你",
      badgeText: "待客户确认",
    },
    assigned_waiting_accept: {
      title: "待接单",
      desc: "客户已指定你服务，请确认是否接单",
      badgeText: "待接单",
    },
    assigned_declined: {
      title: "已拒绝",
      desc: "你已拒绝该指派订单",
      badgeText: "已拒绝",
    },
    waiting_payment: {
      title: "待平台确认",
      desc: "试运营流程待平台确认。",
      badgeText: "待确认",
    },
    confirmed: {
      title: "待服务",
      desc: "订单已确认，请按约定时间上门服务",
      badgeText: "待服务",
    },
    in_service: {
      title: "服务中",
      desc: "订单服务进行中，完成后可提交服务完成",
      badgeText: "服务中",
    },
    waiting_complete: {
      title: "待客户验收",
      desc: "你已提交完成，等待客户验收确认",
      badgeText: "待验收",
    },
    completed: {
      title: "已完成",
      desc: "客户已完成验收，订单已结束",
      badgeText: "已完成",
    },
    auto_completed: {
      title: "系统已完成",
      desc: "客户逾期未验收，系统已自动完成订单",
      badgeText: "已完成",
    },
    cancelled: {
      title: "已取消",
      desc: "订单已取消",
      badgeText: "已取消",
    },
  },
};

function getOrderStatusCopy(status, role = "customer") {
  const normalized = normalizeOrderStatus({ status });
  const map = ORDER_STATUS_COPY[role] || ORDER_STATUS_COPY.customer;
  const fallbackLabel = statusLabel(normalized) || "待处理";
  const copy = map[normalized] || {
    title: fallbackLabel === "未知状态" ? "订单状态" : fallbackLabel,
    desc: statusTip(normalized),
    badgeText: fallbackLabel || "待处理",
  };
  return { ...copy };
}

function roleAwareStatusLabel(status, role = "customer") {
  return getOrderStatusCopy(status, role).title;
}

function roleAwareStatusTip(status, role = "customer") {
  return getOrderStatusCopy(status, role).desc;
}

function normalizeOrderStatus(order) {
  if (!order) return "";
  if (order.status === "pending") {
    return order.publishMode === "assigned" ? "assigned_waiting_accept" : "waiting_response";
  }
  if (order.status === "accepted") return "confirmed";
  if (order.status === "waiting_acceptance") return "waiting_complete";
  return order.status;
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
    pending_pay: "待平台确认",
    escrowed: "已确认",
    settled: "已完成",
    refunded: "已退款",
  };
  const cleanerMap = {
    unpaid: "待用户确认",
    pending_pay: "待平台确认",
    escrowed: "已确认",
    settled: "已完成",
    refunded: "已退款",
  };
  return (role === "cleaner" ? cleanerMap : customerMap)[paymentStatus] || customerMap.unpaid;
}

function paymentStatusTip(paymentStatus, role = "customer") {
  if (role === "customer" && paymentStatus === "escrowed") {
    return "试运营流程已确认，后续以订单服务进度为准。";
  }
  if (role === "cleaner" && paymentStatus === "escrowed") {
    return "试运营流程已确认，请按订单约定服务。";
  }
  return "";
}

function getUserOrderStatusGroup(order) {
  const status = normalizeOrderStatus(order);
  if (["waiting_response", "waiting_confirm", "assigned_waiting_accept", "assigned_declined", "pending"].includes(status)) {
    return "pending";
  }
  if (["waiting_payment", "confirmed", "in_service", "waiting_complete"].includes(status)) {
    return "ongoing";
  }
  if (status === "completed" || status === "auto_completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "pending";
}

function orderStatusCandidates(order) {
  if (!order) return [];
  return [order.rawStatus, order.status, normalizeOrderStatus(order)].filter(Boolean);
}

function getOrderTabCount(tabKey, orders, role = "customer") {
  const key = tabKey === "active" ? "ongoing" : tabKey;
  if (key !== "pending" && key !== "ongoing") return 0;
  const pendingStatuses =
    role === "cleaner"
      ? ["waiting_response", "waiting_confirm", "assigned_pending", "assigned_waiting_accept"]
      : ["waiting_response", "waiting_confirm"];
  const ongoingStatuses = ["confirmed", "accepted", "in_service", "waiting_complete", "waiting_acceptance", "waiting_payment"];
  const targetStatuses = key === "pending" ? pendingStatuses : ongoingStatuses;
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
  const normalized = normalizeOrderStatus({ status });
  if (normalized === "completed" || normalized === "auto_completed") return "completed";
  if (normalized === "cancelled") return "cancelled";
  if (normalized === "in_service" || normalized === "waiting_complete") return "active";
  if (normalized === "waiting_payment") return "payment";
  if (normalized === "confirmed" || normalized === "accepted") return "accepted";
  return "waiting";
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
  const displayStatus = normalizeOrderStatus(order);
  const price = estimatePrice(order);
  const commission = commissionFor(price);
  const platformFee = Number(order.platformFee || commission.platformFee);
  const cleanerIncome = Number(order.cleanerIncome || commission.cleanerIncome);
  const paymentStatus = normalizePaymentStatus({ ...order, status: displayStatus });
  const distanceFields = orderDistanceFields(order, referenceLocation);
  const locationText = [distanceFields.orderLocation.city, distanceFields.orderLocation.district].filter(Boolean).join(" ");
  const statusCopy = getOrderStatusCopy(displayStatus, viewerRole);
  const statusBadgeText =
    displayText(statusCopy.badgeText) || displayText(statusCopy.title) || displayText(statusLabel(displayStatus)) || "待处理";
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
    statusStyle: orderStatusStyle(displayStatus),
    statusTip: statusCopy.desc,
    statusGroup: getUserOrderStatusGroup({ ...order, status: displayStatus }),
    paymentStatus,
    paymentStatusText: paymentStatusText(paymentStatus, viewerRole),
    paymentTip: paymentStatusTip(paymentStatus, viewerRole),
    canPay: false,
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
    responseCount: Number(order.responseCount ?? (order.responses || []).length),
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
  cleanerOpenidOf,
  decorateOrder,
  decorateCleaner,
};
