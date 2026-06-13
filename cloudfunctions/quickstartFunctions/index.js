const cloud = require("wx-server-sdk");
const {
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
  canHideOrderForRole,
  isSettledIncomeOrder,
  normalizeUserAddress,
  filterRecommendedCleanersByCity,
  isOrderOverdueForAutoAcceptance,
  formatDistanceText,
} = require("./lib/domain");
const {
  QUOTE_TTL_MINUTES,
  calculateOrderPrice,
  calculateQuote,
  fullPricingRule,
  getDefaultPricingRules,
  normalizeServiceTypeKey,
  publicPricingQuote,
  publicPricingRule,
  sanitizePricingInput,
} = require("./lib/pricing");
const {
  applyAutoGovernance,
  calculateBehaviorGraph,
  calculateCleanerTrust,
  calculateCollusionRisk,
  calculateFraudRisk,
  calculateOrderRisk,
  clampScore,
  decisionFromScore,
  riskLevelFromScore,
  trustLevelFromScore,
} = require("./lib/trust-risk");
const { createBehaviorGraphStore } = require("./lib/behavior/behaviorGraphStore");
const { createPaymentIntentSnapshot } = require("./lib/payment/paymentIntent");
const { applyPaymentCallback } = require("./lib/payment/paymentCallback");
const { createSettlementSnapshot } = require("./lib/settlement/settlementEngine");
const { calculateSlaPenalty } = require("./lib/sla/slaEngine");
const { normalizeOrderAdminFilter } = require("./lib/admin/orderAdmin");
const { normalizePayoutAdjustment } = require("./lib/admin/payoutAdmin");
const { reconcileOrders: reconcileOrderRecords } = require("./lib/reconciliation/orderReconcile");
const { reconcilePayouts: reconcilePayoutRecords } = require("./lib/reconciliation/payoutReconcile");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = [
  "users",
  "customerProfiles",
  "cleaners",
  "orders",
  "favorites",
  "platformStats",
  "reviews",
  "conversations",
  "messages",
  "userAddresses",
  "adminUsers",
  "auditLogs",
  "supportTickets",
  "serviceStandards",
  "protectionPlans",
  "protectionClaims",
  "pricingRules",
  "pricingQuotes",
  "coupons",
  "cleanerTrustProfile",
  "orderRiskProfile",
  "behaviorGraphEdges",
  "paymentIntents",
  "paymentCallbacks",
  "settlements",
  "payoutAdjustments",
  "reconciliationReports",
];

const COMMISSION_RATE = 0.05;
const CONTACT_STATUSES = ["confirmed", "in_service", "waiting_complete", "waiting_acceptance", "completed", "auto_completed", "accepted"];
const SERVICE_PROOF_STATUSES = ["in_service", "waiting_complete", "waiting_acceptance"];
const CLAIM_TYPES = ["rework", "refund", "complaint", "property_damage", "cleaner_exception", "safety_risk", "other"];
const CLAIM_STATUSES = ["submitted", "under_review", "needs_more_info", "resolved", "rejected", "cancelled"];
const CLAIM_STATUS_TRANSITIONS = {
  submitted: ["under_review", "needs_more_info", "resolved", "rejected", "cancelled"],
  under_review: ["needs_more_info", "resolved", "rejected", "cancelled"],
  needs_more_info: ["under_review", "resolved", "rejected", "cancelled"],
  resolved: [],
  rejected: [],
  cancelled: [],
};
const DEFAULT_SERVICE_STANDARDS = [
  {
    _id: "standard-daily-cleaning-v1",
    serviceType: "日常保洁",
    title: "日常保洁服务标准",
    includedItems: ["地面清洁", "台面擦拭", "厨卫基础清洁", "垃圾整理"],
    excludedItems: ["高空外窗", "重度油污拆洗", "大型家具搬运", "危险物品处理"],
    customerTips: ["请提前收纳贵重物品", "请与家洁师确认重点区域"],
    cleanerTips: ["服务前确认范围", "服务后提交完成说明"],
    version: "2026-06",
    enabled: true,
  },
  {
    _id: "standard-deep-cleaning-v1",
    serviceType: "深度保洁",
    title: "深度保洁服务标准",
    includedItems: ["厨卫重点清洁", "地面清洁", "可触达台面擦拭"],
    excludedItems: ["高空作业", "家电深度拆机", "危险污染物处理"],
    customerTips: ["请提前说明重点需求", "现场超出范围项目需双方确认"],
    cleanerTips: ["服务前拍照确认重点区域", "异常情况及时报备"],
    version: "2026-06",
    enabled: true,
  },
  {
    _id: "standard-move-in-cleaning-v1",
    serviceType: "开荒保洁",
    title: "开荒保洁服务标准",
    includedItems: ["地面清洁", "可触达台面擦拭", "厨卫基础清洁", "装修后浮尘清洁"],
    excludedItems: ["高空作业", "危险物品处理", "装修垃圾清运", "订单未约定的额外工作"],
    customerTips: ["请提前说明面积和重点区域", "超出订单范围的服务需双方确认"],
    cleanerTips: ["服务前确认范围", "异常情况及时报备"],
    version: "2026-06",
    enabled: true,
  },
  {
    _id: "standard-housework-organize-v1",
    serviceType: "家务整理",
    title: "家务整理服务标准",
    includedItems: ["按订单约定整理物品", "基础归类", "可触达区域整理"],
    excludedItems: ["贵重物品处置", "危险物品处理", "订单未约定的额外工作"],
    customerTips: ["请提前说明整理范围", "贵重物品请自行保管"],
    cleanerTips: ["服务前确认范围", "涉及私人物品时先征得客户确认"],
    version: "2026-06",
    enabled: true,
  },
  {
    _id: "standard-storage-organize-v1",
    serviceType: "收纳整理",
    title: "收纳整理服务标准",
    includedItems: ["按订单约定收纳整理", "基础分类", "收纳建议"],
    excludedItems: ["贵重物品处置", "危险物品处理", "订单未约定的额外工作"],
    customerTips: ["请提前说明重点空间", "贵重物品请自行保管"],
    cleanerTips: ["服务前确认范围", "涉及私人物品时先征得客户确认"],
    version: "2026-06",
    enabled: true,
  },
];
const DEFAULT_PROTECTION_PLANS = [
  {
    _id: "protection-trial-basic-v1",
    planCode: "trial-basic",
    title: "试运营服务保障",
    summary: "不满意可提交售后申请，平台将在试运营规则下协助处理。",
    coverageItems: ["返工协商", "投诉反馈", "财损报备", "异常情况记录"],
    limitations: ["保障范围以实际保险合同和平台规则为准。", "当前支付能力待接入，退款/补偿需由平台人工确认处理。"],
    afterSaleWindowHours: 72,
    reworkAllowed: true,
    refundAllowed: true,
    propertyDamageReportAllowed: true,
    insuranceStatusText: "保险能力待接入/以实际订单保障页为准",
    version: "2026-06",
    enabled: true,
  },
];

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function calculateOrderAmount(order) {
  return calculateOrderPricing(order).orderAmount;
}

function calculateCommission(orderAmount) {
  const amount = roundMoney(orderAmount);
  const platformFee = roundMoney(amount * COMMISSION_RATE);
  return {
    orderAmount: amount,
    platformFee,
    cleanerIncome: roundMoney(amount - platformFee),
    commissionRate: COMMISSION_RATE,
    commissionCap: 0,
  };
}

function calculateOrderPricing(order) {
  if (order && order.pricingSnapshot && (order.pricingSnapshot.customerPayAmount || order.pricingSnapshot.orderAmount)) {
    return {
      ...order.pricingSnapshot,
      orderAmount: Number(order.pricingSnapshot.orderAmount || order.pricingSnapshot.customerPayAmount),
      customerPayAmount: Number(order.pricingSnapshot.customerPayAmount || order.pricingSnapshot.orderAmount),
      platformFee: Number(order.pricingSnapshot.platformFee || order.platformFee || 0),
      cleanerIncome: Number(order.pricingSnapshot.cleanerIncome || order.cleanerIncome || 0),
    };
  }
  const location = order.locationSnapshot || {};
  return calculateOrderPrice({
    city: location.city || order.city || "",
    serviceType: order.serviceType,
    durationHours: order.durationHours,
    areaSqm: order.areaSqm || order.areaSize,
  });
}

function normalizeOrderStatus(status) {
  if (status === "pending") return "waiting_response";
  if (status === "accepted") return "confirmed";
  return status;
}

function paymentStatusForCancelledOrder(order) {
  const paymentStatus = normalizePaymentStatus(order);
  return paymentStatus === "escrowed" || paymentStatus === "settled" ? "refunded" : "unpaid";
}

function statusPaymentPatch(status, order = {}) {
  if (status === "waiting_payment") return { paymentStatus: "pending_pay" };
  if (["confirmed", "in_service", "waiting_complete", "waiting_acceptance"].includes(status)) return { paymentStatus: "escrowed" };
  if (status === "completed" || status === "auto_completed") return { paymentStatus: "settled" };
  if (status === "cancelled") return { paymentStatus: paymentStatusForCancelledOrder(order) };
  if (["waiting_response", "waiting_confirm", "assigned_waiting_accept", "assigned_declined"].includes(status)) return { paymentStatus: "unpaid" };
  return {};
}

function now() {
  return new Date();
}

function ok(data) {
  return {
    success: true,
    data,
  };
}

function fail(error) {
  return {
    success: false,
    code: error.code || "UNKNOWN_ERROR",
    message: error.message || "服务暂时不可用",
  };
}

function getOpenid() {
  return cloud.getWXContext().OPENID;
}

function getAppEnv() {
  return String(process.env.APP_ENV || process.env.NODE_ENV || process.env.WX_APP_ENV || "")
    .trim()
    .toLowerCase();
}

function isExplicitNonProduction() {
  return ["local", "dev", "development", "test", "testing"].includes(getAppEnv());
}

function isProduction() {
  return !isExplicitNonProduction();
}

function adminOpenidsFromEnv() {
  return String(process.env.ADMIN_OPENIDS || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function isAdmin(openid) {
  if (!openid) return false;
  if (adminOpenidsFromEnv().includes(openid)) return true;
  const byOpenid = await findOne("adminUsers", { openid }).catch(() => null);
  const byWxOpenid = byOpenid || (await findOne("adminUsers", { _openid: openid }).catch(() => null));
  return Boolean(byWxOpenid && byWxOpenid.active !== false && byWxOpenid.disabled !== true);
}

async function requireAdmin(openid) {
  if (!(await isAdmin(openid))) {
    throw AppError("无管理员权限", "FORBIDDEN");
  }
  return { openid, role: "admin" };
}

function requireNonProduction(actionName) {
  if (isProduction()) {
    const message = actionName === "mockPayOrder" ? "正式环境不支持模拟支付" : `正式环境不支持 ${actionName}`;
    throw AppError(message, "PRODUCTION_DISABLED");
  }
}

function requireProductionConfirm(actionName, actual, expected) {
  if (isProduction() && actual !== expected) {
    throw AppError(`正式环境执行 ${actionName} 需要显式确认`, "CONFIRM_REQUIRED");
  }
}

function assertActionAllowedInProduction(actionName, data = {}) {
  if (actionName === "mockPayOrder") {
    requireNonProduction(actionName);
  }
  if (actionName === "migrateOrderPaymentStatus") {
    requireProductionConfirm(actionName, data.confirm, "MIGRATE_PAYMENT_STATUS");
  }
  if (actionName === "migrateOrderNos") {
    requireProductionConfirm(actionName, data.confirm, "MIGRATE_ORDER_NOS");
  }
  if (actionName === "initCollectionsSeed") {
    requireNonProduction("initCollections seed");
  }
  if (actionName === "autoAcceptOverdueOrders" && isProduction()) {
    if (data.days !== undefined && data.days !== null && data.days !== "") {
      throw AppError("正式环境自动验收不允许自定义天数", "PRODUCTION_DISABLED");
    }
  }
}

function scrubAuditValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 3) return "[omitted]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrubAuditValue(item, depth + 1));
  if (typeof value === "string") {
    if (/1[3-9]\d{9}/.test(value)) return "[redacted]";
    if (/cloud:\/\//i.test(value)) return "[redacted]";
    if (/policy|wechat|id-card|health-card/i.test(value)) return "[redacted]";
    if (/\d+\.\d{3,}/.test(value)) return "[redacted]";
    return value;
  }
  if (typeof value === "number") {
    const text = String(value);
    if (/\d+\.\d{3,}/.test(text)) return "[redacted]";
    return value;
  }
  if (typeof value !== "object") return value;
  const sensitiveKey = /(phone|wechat|address|detail|location|latitude|longitude|fileid|fileID|policy|idcard|identity|health|certificate|contact)/i;
  return Object.keys(value).reduce((next, key) => {
    next[key] = sensitiveKey.test(key) ? "[redacted]" : scrubAuditValue(value[key], depth + 1);
    return next;
  }, {});
}

async function writeAuditLog({ actorOpenid, actorRole, action, targetType, targetId, before, after, requestId, metadata }) {
  try {
    await safeCreateCollection("auditLogs");
    await db.collection("auditLogs").add({
      data: {
        actorOpenid: actorOpenid || "",
        actorRole: actorRole || "",
        action,
        targetType: targetType || "",
        targetId: targetId || "",
        before: scrubAuditValue(before),
        after: scrubAuditValue(after),
        requestId: requestId || "",
        metadata: scrubAuditValue(metadata || {}),
        createdAt: now(),
      },
    });
  } catch (error) {
    console.warn("[auditLogs] write failed", error && error.message ? error.message : error);
  }
}

async function safeCreateCollection(name) {
  try {
    await db.createCollection(name);
  } catch (error) {
    if (!String(error.message || "").includes("already exists")) {
      return false;
    }
  }
  return true;
}

async function findOne(collection, where) {
  const result = await db.collection(collection).where(where).limit(1).get();
  return result.data[0] || null;
}

async function ensureUser(openid) {
  const existing = await findOne("users", { _openid: openid });
  if (existing) {
    const role = existing.currentRole || existing.role || "";
    const roles = Array.isArray(existing.roles)
      ? existing.roles
      : existing.role
        ? [existing.role]
        : [];
    await db.collection("users").doc(existing._id).update({
      data: { roles, currentRole: role, role, updatedAt: now() },
    });
    return { ...existing, roles, currentRole: role, role };
  }
  const createdAt = now();
  await db.collection("users").add({
    data: {
      _openid: openid,
      role: "",
      currentRole: "",
      roles: [],
      createdAt,
      updatedAt: createdAt,
    },
  });
  return findOne("users", { _openid: openid });
}

async function getCleaner(openid) {
  return findOne("cleaners", { _openid: openid });
}

async function getCustomerProfile(input = {}) {
  const openid = typeof input === "string" ? input : input.openid || getOpenid();
  const profile = await findOne("customerProfiles", { _openid: openid }).catch(() => null);
  if (profile) return profile;
  const user = await findOne("users", { _openid: openid });
  const legacy = (user && user.profileByRole && user.profileByRole.customer) || {};
  return {
    _openid: openid,
    role: "customer",
    nickname: legacy.nickname || (user && user.nickname) || "邻里用户",
    avatarUrl: legacy.avatarUrl || (user && user.avatarUrl) || "",
    phone: legacy.phone || (user && user.phone) || "",
    address: legacy.address || (user && user.defaultLocation) || null,
    defaultAddressId: legacy.defaultAddressId || "",
  };
}

async function getCleanerProfile(data = {}) {
  const viewerOpenid = getOpenid();
  const openid = data.openid || data.cleanerOpenid || viewerOpenid;
  const viewerIsAdmin = await isAdmin(viewerOpenid);
  const canViewContact = viewerIsAdmin || openid === viewerOpenid;
  return ok({ cleanerProfile: await withCleanerStats(await getCleaner(openid), { canViewContact }) });
}

async function getCustomerProfileAction(data = {}) {
  const viewerOpenid = getOpenid();
  const openid = data.openid || data.customerOpenid || viewerOpenid;
  if (openid !== viewerOpenid) {
    await requireAdmin(viewerOpenid);
  }
  const profile = await getCustomerProfile(openid);
  return ok({ customerProfile: privateCustomerProfileForOwner(profile) });
}

async function ensureCustomerProfile(openid) {
  const existing = await findOne("customerProfiles", { _openid: openid }).catch(() => null);
  if (existing) return existing;
  const user = await findOne("users", { _openid: openid });
  const legacy = (user && user.profileByRole && user.profileByRole.customer) || {};
  const createdAt = now();
  await safeCreateCollection("customerProfiles");
  await db.collection("customerProfiles").add({
    data: {
      _openid: openid,
      role: "customer",
      nickname: legacy.nickname || (user && user.nickname) || "邻里用户",
      avatarUrl: legacy.avatarUrl || (user && user.avatarUrl) || "",
      phone: legacy.phone || (user && user.phone) || "",
      address: legacy.address || (user && user.defaultLocation) || null,
      defaultAddressId: legacy.defaultAddressId || "",
      createdAt,
      updatedAt: createdAt,
    },
  });
  return findOne("customerProfiles", { _openid: openid });
}

async function ensureCleanerProfile(openid) {
  const existing = await getCleaner(openid);
  if (existing) return existing;

  const createdAt = now();
  await db.collection("cleaners").add({
    data: {
      _openid: openid,
      displayName: "家洁师资料待完善",
      avatarUrl: "",
      serviceAreas: [],
      serviceTypes: [],
      phone: "",
      wechatContact: "",
      experience: "",
      available: false,
      phoneVerified: false,
      manualApproved: false,
      seededByPlatform: false,
      ratingAvg: 0,
      reviewCount: 0,
      completedOrderCount: 0,
      lastLocation: null,
      createdAt,
      updatedAt: createdAt,
    },
  });
  return getCleaner(openid);
}

async function getOrder(orderId) {
  if (!orderId) {
    throw AppError("缺少订单 ID");
  }
  const order = await db.collection("orders").doc(orderId).get();
  return order.data ? { ...order.data, _id: order.data._id || orderId } : null;
}

function canViewCustomerContact(order, viewerOpenid, context = {}) {
  if (context.isAdmin) return true;
  if (!order) return false;
  if (order.customerOpenid === viewerOpenid) return true;
  if (!CONTACT_STATUSES.includes(order.status)) return false;
  return order.acceptedCleanerOpenid === viewerOpenid;
}

function canViewCleanerContact(order, viewerOpenid, cleanerOpenid, context = {}) {
  if (context.isAdmin) return true;
  if (!order || !cleanerOpenid) return false;
  if (viewerOpenid === cleanerOpenid) return true;
  if (order.customerOpenid === viewerOpenid) {
    return CONTACT_STATUSES.includes(order.status) && order.acceptedCleanerOpenid === cleanerOpenid;
  }
  return false;
}

function canViewOrderPrivateNote(order, viewerOpenid, context = {}) {
  if (context.isAdmin) return true;
  if (!order) return false;
  if (order.customerOpenid === viewerOpenid) return true;
  return canViewCustomerContact(order, viewerOpenid, context);
}

function canViewOrderParticipantIds(order, viewerOpenid, context = {}) {
  if (context.isAdmin) return true;
  if (!order) return false;
  return (
    order.customerOpenid === viewerOpenid ||
    order.acceptedCleanerOpenid === viewerOpenid ||
    order.assignedCleanerOpenid === viewerOpenid
  );
}

function canViewOrderAfterSalePrivateFields(order, viewerOpenid, context = {}) {
  if (context.isAdmin) return true;
  if (!order) return false;
  if (order.customerOpenid === viewerOpenid) return true;
  return order.acceptedCleanerOpenid === viewerOpenid && CONTACT_STATUSES.includes(order.status);
}

function visibleContact(order, openid, context = {}) {
  return canViewCustomerContact(order, openid, context);
}

function publicLocationSnapshot(location = {}) {
  return {
    province: location.province || "",
    city: location.city || "",
    district: location.district || "",
    street: location.street || "",
    community: location.community || "",
  };
}

function hideContactIfNeeded(order, openid, context = {}) {
  if (canViewCustomerContact(order, openid, context)) {
    return order;
  }
  const publicLocation = publicLocationSnapshot(order.locationSnapshot || order);
  return {
    ...order,
    contactPhone: "",
    contactWechat: "",
    detailAddress: "",
    addressText: "",
    latitude: null,
    longitude: null,
    locationSnapshot: publicLocation,
  };
}

function responseForViewer(response = {}) {
  return {
    cleanerId: response.cleanerId || "",
    status: response.status || "",
  };
}

function publicResponseForCustomer(response = {}) {
  return {
    cleanerId: response.cleanerId || "",
    cleanerName: response.cleanerName || "",
    avatar: response.avatar || "",
    avatarUrl: response.avatarUrl || "",
    avatarText: response.avatarText || "",
    rating: Number(response.rating || 0),
    completedOrders: Number(response.completedOrders || 0),
    distance: response.distance || "",
    responseTime: response.responseTime || "",
    quotedAmount: Number(response.quotedAmount || 0),
    status: response.status || "",
  };
}

function publicOrderForViewer(order, openid, context = {}) {
  if (!order) return order;
  if (context.isAdmin) {
    return order;
  }
  if (order.customerOpenid === openid) {
    const responses = Array.isArray(order.responses) ? order.responses : [];
    return sanitizeOrderPricingForViewer(
      {
        ...order,
        responses: responses.map(publicResponseForCustomer),
        responseCount: Number(order.responseCount ?? responses.length),
      },
      openid,
      context
    );
  }
  const responses = Array.isArray(order.responses) ? order.responses : [];
  const myResponse = responses.find((response) => response.cleanerId === openid);
  const canViewFulfillment = canViewCustomerContact(order, openid, context);
  const next = canViewFulfillment ? { ...order } : hideContactIfNeeded(order, openid, context);
  if (!canViewOrderPrivateNote(order, openid, context)) {
    next.note = "";
  }
  if (!canViewOrderParticipantIds(order, openid, context)) {
    delete next.acceptedCleanerOpenid;
    delete next.assignedCleanerOpenid;
    delete next.cleanerId;
  }
  if (!canViewOrderAfterSalePrivateFields(order, openid, context)) {
    delete next.activeClaimId;
    delete next.lastClaimAt;
    delete next.serviceProof;
    delete next.beforePhotoUrls;
    delete next.completionPhotoUrls;
    delete next.completionImageUrls;
    delete next.completionPhotos;
    delete next.serviceProofImageUrls;
    next.afterSaleStatus = "";
    next.claimCount = 0;
  }
  delete next.customerOpenid;
  delete next.responses;
  next.responseCount = responses.length;
  if (myResponse) {
    next.myResponse = responseForViewer(myResponse);
  } else {
    delete next.myResponse;
  }
  return sanitizeOrderPricingForViewer(next, openid, context);
}

function publicServiceStandard(standard = {}) {
  return {
    _id: standard._id || "",
    serviceType: standard.serviceType || "",
    title: standard.title || "",
    includedItems: Array.isArray(standard.includedItems) ? standard.includedItems.slice(0, 30) : [],
    excludedItems: Array.isArray(standard.excludedItems) ? standard.excludedItems.slice(0, 30) : [],
    customerTips: Array.isArray(standard.customerTips) ? standard.customerTips.slice(0, 20) : [],
    cleanerTips: Array.isArray(standard.cleanerTips) ? standard.cleanerTips.slice(0, 20) : [],
    version: standard.version || "",
    enabled: standard.enabled !== false,
  };
}

function publicProtectionPlan(plan = {}) {
  return {
    _id: plan._id || "",
    planCode: plan.planCode || "",
    title: plan.title || "",
    summary: plan.summary || "",
    coverageItems: Array.isArray(plan.coverageItems) ? plan.coverageItems.slice(0, 30) : [],
    limitations: Array.isArray(plan.limitations) ? plan.limitations.slice(0, 30) : [],
    afterSaleWindowHours: Math.max(0, Number(plan.afterSaleWindowHours || 0)),
    reworkAllowed: Boolean(plan.reworkAllowed),
    refundAllowed: Boolean(plan.refundAllowed),
    propertyDamageReportAllowed: Boolean(plan.propertyDamageReportAllowed),
    insuranceStatusText: plan.insuranceStatusText || "保险能力待接入/以实际订单保障页为准",
    version: plan.version || "",
    enabled: plan.enabled !== false,
  };
}

function serviceStandardSnapshot(standard = {}, serviceType = "") {
  const publicStandard = publicServiceStandard(standard);
  return {
    standardId: publicStandard._id,
    serviceType: publicStandard.serviceType || serviceType,
    title: publicStandard.title || `${serviceType || "服务"}标准`,
    includedItems: publicStandard.includedItems,
    excludedItems: publicStandard.excludedItems,
    customerTips: publicStandard.customerTips,
    version: publicStandard.version || "2026-06",
  };
}

function protectionPlanSnapshot(plan = {}) {
  const publicPlan = publicProtectionPlan(plan);
  return {
    planId: publicPlan._id,
    planCode: publicPlan.planCode || "trial-basic",
    title: publicPlan.title || "试运营服务保障",
    summary: publicPlan.summary || "不满意可提交售后申请，平台将在试运营规则下协助处理。",
    coverageItems: publicPlan.coverageItems,
    limitations: publicPlan.limitations.length ? publicPlan.limitations : ["保障范围以实际保险合同和平台规则为准。"],
    afterSaleWindowHours: publicPlan.afterSaleWindowHours || 72,
    reworkAllowed: publicPlan.reworkAllowed,
    refundAllowed: publicPlan.refundAllowed,
    propertyDamageReportAllowed: publicPlan.propertyDamageReportAllowed,
    insuranceStatusText: publicPlan.insuranceStatusText,
    version: publicPlan.version || "2026-06",
  };
}

function quoteExpiresAt(createdAt) {
  return new Date(createdAt.getTime() + QUOTE_TTL_MINUTES * 60 * 1000).toISOString();
}

function pricingQuoteId(createdAt) {
  return `quote_${createdAt.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
}

function pricingQuoteNo(createdAt) {
  const stamp = createdAt.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `PQ${stamp}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

async function enabledPricingRules() {
  const result = await db.collection("pricingRules").where({ enabled: true }).limit(300).get().catch(() => ({ data: [] }));
  return (result.data || []).filter((item) => item.enabled !== false).concat(getDefaultPricingRules());
}

function pricingSnapshotFromQuote(calculated, metadata = {}) {
  const quoteId = metadata.quoteId || "";
  const quoteNo = metadata.quoteNo || "";
  const snapshot = {
    quoteId,
    quoteNo,
    generatedBy: metadata.generatedBy || "createPricingQuote",
    city: calculated.city,
    cityGroup: calculated.cityGroup,
    serviceType: calculated.serviceType,
    serviceTypeText: calculated.serviceTypeText,
    durationHours: Number(calculated.durationHours || 0),
    areaSqm: Number(calculated.areaSqm || 0),
    actualAreaSqm: Number(calculated.actualAreaSqm || calculated.areaSqm || 0),
    billableAreaSqm: Number(calculated.billableAreaSqm || 0),
    pricingMode: calculated.pricingMode,
    priceRuleId: calculated.priceRuleId,
    priceRuleVersion: calculated.priceRuleVersion,
    listPrice: calculated.listPrice,
    launchPrice: calculated.launchPrice,
    customerPayAmount: calculated.customerPayAmount,
    orderAmount: calculated.customerPayAmount,
    couponCode: calculated.couponCode,
    couponDiscount: calculated.couponDiscount,
    platformFundedDiscount: calculated.platformFundedDiscount,
    platformFeeRate: calculated.platformFeeRate,
    platformFee: calculated.platformFee,
    protectionFee: calculated.protectionFee,
    insuranceCostAllocation: calculated.insuranceCostAllocation,
    paymentFeeEstimate: calculated.paymentFeeEstimate,
    cleanerBaseIncome: calculated.cleanerBaseIncome,
    cleanerIncome: calculated.cleanerIncome,
    platformSubsidy: calculated.platformSubsidy,
    cashGrossMargin: calculated.cashGrossMargin,
    cashBurn: calculated.cashBurn,
    requiresSubsidy: calculated.requiresSubsidy,
    subsidyReason: calculated.subsidyReason,
    marginWarning: calculated.marginWarning,
    grossMarginNote: calculated.grossMarginNote,
    estimate: calculated.estimate,
    pricingText: "报价由平台服务端生成，金额单位为人民币元。",
    calculatedAt: metadata.calculatedAt || now(),
  };
  return snapshot;
}

function publicOrderPricingSnapshot(snapshot = {}, includeCleanerIncome = false, includeCoupon = false) {
  if (!snapshot) return snapshot;
  const next = {
    quoteId: snapshot.quoteId || "",
    quoteNo: snapshot.quoteNo || "",
    generatedBy: snapshot.generatedBy || "",
    city: snapshot.city || "",
    cityGroup: snapshot.cityGroup || "",
    serviceType: snapshot.serviceType || "",
    serviceTypeText: snapshot.serviceTypeText || "",
    durationHours: Number(snapshot.durationHours || 0),
    areaSqm: Number(snapshot.areaSqm || 0),
    actualAreaSqm: Number(snapshot.actualAreaSqm || 0),
    billableAreaSqm: Number(snapshot.billableAreaSqm || 0),
    pricingMode: snapshot.pricingMode || "",
    priceRuleVersion: snapshot.priceRuleVersion || "",
    listPrice: Number(snapshot.listPrice || 0),
    launchPrice: Number(snapshot.launchPrice || 0),
    customerPayAmount: Number(snapshot.customerPayAmount || snapshot.orderAmount || 0),
    orderAmount: Number(snapshot.orderAmount || snapshot.customerPayAmount || 0),
    platformFundedDiscount: Number(snapshot.platformFundedDiscount || 0),
    requiresSubsidy: Boolean(snapshot.requiresSubsidy),
    pricingText: snapshot.pricingText || "报价由平台服务端生成，金额单位为人民币元。",
    calculatedAt: snapshot.calculatedAt || "",
  };
  if (includeCleanerIncome) {
    next.cleanerIncome = Number(snapshot.cleanerIncome || 0);
  }
  if (includeCoupon) {
    next.couponCode = snapshot.couponCode || "";
    next.couponDiscount = Number(snapshot.couponDiscount || 0);
  } else {
    delete next.couponCode;
    delete next.couponDiscount;
  }
  return next;
}

function canViewOrderCleanerIncome(order, openid, context = {}) {
  if (context.isAdmin) return true;
  if (!order || !openid) return false;
  return order.acceptedCleanerOpenid === openid || order.assignedCleanerOpenid === openid || order.cleanerId === openid;
}

function sanitizeOrderPricingForViewer(order, openid, context = {}) {
  if (!order || context.isAdmin) return order;
  const next = { ...order };
  const canViewCleanerIncome = canViewOrderCleanerIncome(order, openid, context);
  const canViewCoupon = order.customerOpenid === openid;
  if (next.pricingSnapshot) {
    next.pricingSnapshot = publicOrderPricingSnapshot(next.pricingSnapshot, canViewCleanerIncome, canViewCoupon);
  }
  if (!canViewCleanerIncome) {
    delete next.cleanerIncome;
    delete next.cleanerBaseIncome;
  }
  [
    "platformFee",
    "platformFeeRate",
    "couponDiscount",
    "couponCode",
    "platformFundedDiscount",
    "protectionFee",
    "platformSubsidy",
    "cashGrossMargin",
    "cashBurn",
    "marginWarning",
    "grossMarginNote",
    "paymentFeeEstimate",
    "insuranceCostAllocation",
  ].forEach((key) => delete next[key]);
  return next;
}

async function createPricingQuoteRecord(input = {}, actorOpenid, options = {}) {
  const createdAt = options.createdAt || now();
  const quoteId = options.quoteId || pricingQuoteId(createdAt);
  const quoteNo = options.quoteNo || pricingQuoteNo(createdAt);
  const rules = await enabledPricingRules();
  const safeInput = sanitizePricingInput(input);
  const calculated = calculateQuote(safeInput, rules);
  const pricingSnapshot = pricingSnapshotFromQuote(calculated, {
    quoteId,
    quoteNo,
    generatedBy: options.generatedBy || "createPricingQuote",
    calculatedAt: createdAt,
  });
  const record = {
    _id: quoteId,
    quoteId,
    quoteNo,
    userOpenid: actorOpenid,
    city: pricingSnapshot.city,
    cityGroup: pricingSnapshot.cityGroup,
    serviceType: pricingSnapshot.serviceType,
    durationHours: pricingSnapshot.durationHours,
    areaSqm: pricingSnapshot.areaSqm,
    billableAreaSqm: pricingSnapshot.billableAreaSqm,
    pricingMode: pricingSnapshot.pricingMode,
    priceRuleId: pricingSnapshot.priceRuleId,
    priceRuleVersion: pricingSnapshot.priceRuleVersion,
    listPrice: pricingSnapshot.listPrice,
    launchPrice: pricingSnapshot.launchPrice,
    customerPayAmount: pricingSnapshot.customerPayAmount,
    couponCode: pricingSnapshot.couponCode,
    couponDiscount: pricingSnapshot.couponDiscount,
    platformFundedDiscount: pricingSnapshot.platformFundedDiscount,
    platformFeeRate: pricingSnapshot.platformFeeRate,
    platformFee: pricingSnapshot.platformFee,
    protectionFee: pricingSnapshot.protectionFee,
    insuranceCostAllocation: pricingSnapshot.insuranceCostAllocation,
    paymentFeeEstimate: pricingSnapshot.paymentFeeEstimate,
    cleanerBaseIncome: pricingSnapshot.cleanerBaseIncome,
    cleanerIncome: pricingSnapshot.cleanerIncome,
    platformSubsidy: pricingSnapshot.platformSubsidy,
    cashGrossMargin: pricingSnapshot.cashGrossMargin,
    cashBurn: pricingSnapshot.cashBurn,
    requiresSubsidy: pricingSnapshot.requiresSubsidy,
    subsidyReason: pricingSnapshot.subsidyReason,
    marginWarning: pricingSnapshot.marginWarning,
    grossMarginNote: pricingSnapshot.grossMarginNote,
    expiresAt: quoteExpiresAt(createdAt),
    usedAt: "",
    status: "active",
    pricingSnapshot,
    createdAt,
    updatedAt: createdAt,
  };
  await db.collection("pricingQuotes").add({ data: record });
  return record;
}

function isQuoteExpired(quote, checkedAt = now()) {
  if (!quote || !quote.expiresAt) return false;
  const expiresAt = new Date(quote.expiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= checkedAt.getTime();
}

function quoteMatchesOrderData(quote, data = {}) {
  const snapshot = quote.pricingSnapshot || quote;
  const city = String((data.locationSnapshot && data.locationSnapshot.city) || data.city || "").trim();
  if (!city) return false;
  if (snapshot.city && city !== snapshot.city) return false;
  if (normalizeServiceTypeKey(data.serviceType) !== snapshot.serviceType) return false;
  if (snapshot.pricingMode === "area") {
    const areaSqm = Number(data.areaSqm || data.areaSize || 0);
    return Number(areaSqm) === Number(snapshot.actualAreaSqm || snapshot.areaSqm || 0);
  }
  return Number(data.durationHours || 0) === Number(snapshot.durationHours || 0);
}

async function getValidQuoteForOrder(data = {}, openid) {
  if (!data.quoteId) return null;
  const quote = await findOne("pricingQuotes", { quoteId: data.quoteId });
  if (!quote) throw AppError("报价不存在或已失效", "INVALID_INPUT");
  if (quote.userOpenid !== openid) throw AppError("无权使用该报价", "FORBIDDEN");
  if (quote.status !== "active") throw AppError("报价已使用或失效，请重新获取报价", "INVALID_INPUT");
  if (isQuoteExpired(quote)) throw AppError("报价已过期，请重新获取报价", "INVALID_INPUT");
  if (!quoteMatchesOrderData(quote, data)) throw AppError("报价与订单信息不一致，请重新获取报价", "INVALID_INPUT");
  return quote;
}

async function consumePricingQuoteForOrder(quote, openid, consumedAt = now()) {
  if (!quote || !quote.quoteId) throw AppError("报价不存在或已失效", "INVALID_INPUT");
  const result = await db
    .collection("pricingQuotes")
    .where({ quoteId: quote.quoteId, userOpenid: openid, status: "active" })
    .update({
      data: {
        status: "used",
        usedAt: consumedAt,
        updatedAt: consumedAt,
      },
    });
  const updated = Number(result.updated ?? (result.stats && result.stats.updated) ?? 0);
  if (updated !== 1) {
    throw AppError("报价已使用或失效，请重新获取报价", "INVALID_INPUT");
  }
}

function fallbackServiceStandard(serviceType = "保洁服务") {
  const type = String(serviceType || "保洁服务").trim() || "保洁服务";
  return {
    _id: "",
    serviceType: type,
    title: `${type}服务标准`,
    includedItems: ["按订单约定范围提供服务"],
    excludedItems: ["高空作业", "危险物品处理", "订单未约定的额外工作"],
    customerTips: ["请提前说明重点需求", "超出订单范围的服务需双方确认"],
    cleanerTips: ["服务前确认范围", "异常情况及时报备"],
    version: "2026-06",
    enabled: true,
  };
}

async function enabledServiceStandards() {
  const result = await db.collection("serviceStandards").where({ enabled: true }).limit(100).get().catch(() => ({ data: [] }));
  const standards = result.data && result.data.length ? result.data : DEFAULT_SERVICE_STANDARDS;
  return standards.filter((item) => item.enabled !== false);
}

async function enabledProtectionPlans() {
  const result = await db.collection("protectionPlans").where({ enabled: true }).limit(100).get().catch(() => ({ data: [] }));
  const plans = result.data && result.data.length ? result.data : DEFAULT_PROTECTION_PLANS;
  return plans.filter((item) => item.enabled !== false);
}

async function getDefaultServiceStandard(serviceType) {
  const standards = await enabledServiceStandards();
  return standards.find((item) => item.serviceType === serviceType) || fallbackServiceStandard(serviceType);
}

async function getDefaultProtectionPlan() {
  const plans = await enabledProtectionPlans();
  return plans[0] || DEFAULT_PROTECTION_PLANS[0];
}

function customerAddressOf(profile = {}) {
  profile = profile || {};
  const address = profile.address || profile.defaultAddress || {};
  return {
    province: address.province || profile.province || "",
    city: address.city || profile.city || "",
    district: address.district || profile.district || "",
    street: address.street || profile.street || "",
    community: address.community || profile.community || "",
    detailAddress: address.detailAddress || profile.detailAddress || "",
  };
}

function publicCustomerProfile(profile = {}) {
  profile = profile || {};
  const address = customerAddressOf(profile);
  return {
    nickname: maskNickname(profile.nickname),
    avatarUrl: profile.avatarUrl || "",
    city: address.city,
    district: address.district,
    community: address.community,
  };
}

function fulfillmentCustomerProfile(profile = {}) {
  profile = profile || {};
  const address = customerAddressOf(profile);
  return {
    nickname: profile.nickname || "邻里用户",
    avatarUrl: profile.avatarUrl || "",
    phone: profile.phone || "",
    contactWechat: profile.contactWechat || profile.wechatContact || "",
    address,
    city: address.city,
    district: address.district,
    street: address.street,
    community: address.community,
    detailAddress: address.detailAddress,
  };
}

function privateCustomerProfileForOwner(profile = {}) {
  profile = profile || {};
  const address = customerAddressOf(profile);
  return {
    role: "customer",
    nickname: profile.nickname || "邻里用户",
    avatarUrl: profile.avatarUrl || "",
    phone: profile.phone || "",
    contactWechat: profile.contactWechat || profile.wechatContact || "",
    address,
    defaultAddressId: profile.defaultAddressId || "",
    city: address.city,
    district: address.district,
    street: address.street,
    community: address.community,
    detailAddress: address.detailAddress,
  };
}

function estimatePrice(serviceType, durationHours) {
  return calculateOrderAmount({ serviceType, durationHours });
}

function getOrderIncome(order) {
  const cleanerIncome = Number(order.cleanerIncome);
  if (Number.isFinite(cleanerIncome) && cleanerIncome > 0) return cleanerIncome;
  const candidates = [order.finalPrice, order.actualPrice, order.orderAmount, order.estimatedPrice];
  for (const value of candidates) {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) return calculateCommission(amount).cleanerIncome;
  }
  return calculateOrderPricing(order).cleanerIncome;
}

async function listCleanerCompletedOrders(openid) {
  const byId = {};
  const pageSize = 100;
  async function collect(field, status) {
    let skip = 0;
    while (true) {
      const result = await db
        .collection("orders")
        .where({ [field]: openid, status })
        .orderBy("completedAt", "desc")
        .skip(skip)
        .limit(pageSize)
        .get();
      result.data
        .filter((order) => field === "cleanerId" || !order.cleanerId || order.cleanerId === openid)
        .forEach((order) => {
          byId[order._id] = order;
        });
      if (result.data.length < pageSize) break;
      skip += pageSize;
    }
  }

  for (const status of ["completed", "auto_completed"]) {
    await collect("cleanerId", status);
    // Legacy compatibility: older orders may not have cleanerId populated yet.
    await collect("acceptedCleanerOpenid", status);
  }

  return Object.values(byId).sort(
    (first, second) =>
      new Date(second.completedAt || second.autoCompletedAt || 0) - new Date(first.completedAt || first.autoCompletedAt || 0)
  );
}

async function listCleanerReviews(cleanerId) {
  const reviews = [];
  const pageSize = 100;
  let skip = 0;
  while (true) {
    const result = await db
      .collection("reviews")
      .where({ cleanerOpenid: cleanerId })
      .orderBy("createdAt", "desc")
      .skip(skip)
      .limit(pageSize)
      .get();
    reviews.push(...result.data);
    if (result.data.length < pageSize) break;
    skip += pageSize;
  }
  return reviews;
}

async function listVisibleCleanerReviews(cleanerId, limit = 3) {
  const reviews = (await listCleanerReviews(cleanerId)).filter(isManualReview).slice(0, limit);
  const decorated = [];
  for (const review of reviews) {
    const customerProfile = await getCustomerProfile(review.customerOpenid).catch(() => null);
    const order = await getOrder(review.orderId).catch(() => null);
    decorated.push(decorateReviewForDisplay(review, customerProfile, order));
  }
  return decorated;
}

async function attachReviewInfo(order) {
  if (!order || !order._id) return order;
  const review = await findOne("reviews", { orderId: order._id });
  if (!review || !isManualReview(review)) {
    return {
      ...order,
      hasReview: Boolean(order.hasReview),
      reviewId: "",
      review: null,
      canEditReview: false,
    };
  }
  return {
    ...order,
    reviewId: review._id,
    hasReview: true,
    review: publicOrderReview(review),
    canEditReview: canEditReview(review, now()),
  };
}

async function attachReviewInfoList(orders) {
  const next = [];
  for (const order of orders || []) {
    next.push(await attachReviewInfo(order));
  }
  return next;
}

async function getCleanerStats(cleanerId, cleaner = null) {
  const [completedOrders, reviews] = await Promise.all([
    listCleanerCompletedOrders(cleanerId),
    listCleanerReviews(cleanerId),
  ]);
  const manualReviews = reviews.filter(isManualReview);
  const reviewCount = manualReviews.length;
  const rating =
    reviewCount > 0
      ? Math.round((manualReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviewCount) * 10) / 10
      : 0;
  const stats = {
    cleanerId,
    rating,
    ratingText: rating > 0 ? `${rating.toFixed(1)}分` : "暂无评分",
    reviewCount,
    serviceCount: completedOrders.length,
    completedOrders,
    communityCount: Array.isArray(cleaner && cleaner.serviceAreas) ? cleaner.serviceAreas.length : 0,
  };
  console.log("[cleaner stats]", cleanerId, {
    serviceCount: stats.serviceCount,
    rating: stats.rating,
    reviewCount: stats.reviewCount,
    completedOrders: completedOrders.map((order) => order._id),
  });
  return stats;
}

async function refreshCleanerStats(cleanerOpenid, updateTime = now()) {
  if (!cleanerOpenid) return null;
  const cleaner = await getCleaner(cleanerOpenid);
  if (!cleaner) return null;
  const stats = await getCleanerStats(cleanerOpenid, cleaner);
  await db.collection("cleaners").doc(cleaner._id).update({
    data: {
      completedOrderCount: stats.serviceCount,
      serviceCount: stats.serviceCount,
      reviewCount: stats.reviewCount,
      ratingAvg: stats.rating,
      updatedAt: updateTime,
    },
  });
  return stats;
}

async function addCompletionReviewIfMissing(order, reviewInput, createdAt = now()) {
  if (!order || !order._id || !order.customerOpenid || !order.acceptedCleanerOpenid || !reviewInput) return null;
  const existingReview = await findOne("reviews", { orderId: order._id });
  if (existingReview) return existingReview;
  const rating = Number(reviewInput.rating || 0);
  const result = await db.collection("reviews").add({
    data: {
      orderId: order._id,
      customerOpenid: order.customerOpenid,
      cleanerOpenid: order.acceptedCleanerOpenid,
      serviceType: order.serviceType || "",
      rating,
      content: reviewInput.content || "",
      imageUrls: reviewInput.autoGenerated ? [] : normalizeReviewImageUrls(reviewInput.imageUrls),
      autoGenerated: Boolean(reviewInput.autoGenerated),
      source: reviewInput.source || "manual",
      editCount: 0,
      createdAt,
      updatedAt: createdAt,
    },
  });
  await db.collection("orders").doc(order._id).update({
    data: {
      reviewId: result._id,
      hasReview: !reviewInput.autoGenerated && (reviewInput.source || "manual") === "manual",
      updatedAt: createdAt,
    },
  });
  return null;
}

async function completeOrderWithReview(order, reviewInput, options = {}) {
  const updateTime = options.completedAt || now();
  const pricing = calculateOrderPricing(order);
  const updateData = {
    status: options.autoAccepted ? "auto_completed" : "completed",
    completedAt: updateTime,
    paymentStatus: "settled",
    settlementStatus: "settled",
    opsState: "COMPLETED",
    settledAt: updateTime,
    cleanerId: order.cleanerId || order.acceptedCleanerOpenid || "",
    orderAmount: Number(order.orderAmount || order.finalPrice || order.actualPrice || order.estimatedPrice || pricing.orderAmount),
    platformFee: Number(order.platformFee || pricing.platformFee),
    cleanerIncome: Number(order.cleanerIncome || pricing.cleanerIncome),
    updatedAt: updateTime,
  };
  if (options.autoAccepted) {
    updateData.autoAccepted = true;
    updateData.autoAcceptedAt = updateTime;
    updateData.autoCompletedAt = updateTime;
  }
  await db.collection("orders").doc(order._id).update({ data: updateData });
  if (!options.autoAccepted) {
    await addCompletionReviewIfMissing(order, reviewInput, updateTime);
  }
  await refreshCleanerStats(order.acceptedCleanerOpenid, updateTime);
}

async function autoAcceptOverdueOrdersInternal(data = {}, auditContext = {}) {
  const checkedAt = now();
  const days = data.days === undefined || data.days === null ? null : Number(data.days);
  const limit = Math.min(Math.max(Number(data.limit || 100), 1), 100);
  const result = await db
    .collection("orders")
    .where({ status: "waiting_complete" })
    .orderBy("serviceFinishedAt", "asc")
    .limit(limit)
    .get();
  const orderIds = [];
  for (const order of result.data) {
    if (!isOrderOverdueForAutoAcceptance(order, checkedAt, days)) continue;
    await completeOrderWithReview(order, null, {
      completedAt: checkedAt,
      autoAccepted: true,
    });
    await writeAuditLog({
      actorOpenid: auditContext.actorOpenid || "",
      actorRole: auditContext.actorRole || "system",
      action: "autoAcceptOverdueOrders",
      targetType: "order",
      targetId: order._id,
      before: { status: order.status, paymentStatus: normalizePaymentStatus(order) },
      after: { status: "auto_completed", paymentStatus: "settled", autoAccepted: true },
      metadata: { checkedAt, days, source: auditContext.source || "internal" },
    });
    orderIds.push(order._id);
  }
  return {
    checkedCount: result.data.length,
    acceptedCount: orderIds.length,
    orderIds,
  };
}

async function withCleanerStats(cleaner, viewerContext = {}) {
  if (!cleaner) return cleaner;
  const cleanerId = cleaner._openid || cleaner.cleanerId;
  if (!cleanerId) return publicCleanerProfile(cleaner, viewerContext);
  const stats = await getCleanerStats(cleanerId, cleaner);
  return {
    ...publicCleanerProfile(cleaner, viewerContext),
    cleanerId,
    stats: {
      cleanerId,
      rating: stats.rating,
      ratingText: stats.ratingText,
      reviewCount: stats.reviewCount,
      serviceCount: stats.serviceCount,
      communityCount: stats.communityCount,
    },
    rating: stats.rating,
    ratingAvg: stats.rating,
    reviewCount: stats.reviewCount,
    serviceCount: stats.serviceCount,
    completedOrderCount: stats.serviceCount,
    communityCount: stats.communityCount,
  };
}

function maskPhone(phone) {
  if (!phone || String(phone).length < 7) return "";
  const value = String(phone);
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function cleanerAvatarUrlOf(cleaner) {
  if (!cleaner) return "";
  return (
    cleaner.avatarUrl ||
    cleaner.avatar ||
    (cleaner.profile && cleaner.profile.avatarUrl) ||
    (cleaner.cleanerProfile && cleaner.cleanerProfile.avatarUrl) ||
    ""
  );
}

function publicCleanerProfile(cleaner, viewerContext = {}) {
  if (!cleaner) return cleaner;
  const cleanerId = cleaner._openid || cleaner.cleanerId || "";
  const avatarUrl = cleanerAvatarUrlOf(cleaner);
  const distanceKm = cleaner.distanceKm === undefined || cleaner.distanceKm === null ? "" : cleaner.distanceKm;
  const profile = {
    cleanerId,
    displayName: cleaner.displayName || "家洁师",
    avatarUrl,
    avatar: cleaner.avatar || avatarUrl,
    ratingAvg: Number(cleaner.ratingAvg || cleaner.rating || 0),
    reviewCount: Number(cleaner.reviewCount || 0),
    completedOrderCount: Number(cleaner.completedOrderCount || cleaner.serviceCount || 0),
    serviceCount: Number(cleaner.serviceCount || cleaner.completedOrderCount || 0),
    serviceAreas: Array.isArray(cleaner.serviceAreas) ? cleaner.serviceAreas.slice(0, 20) : [],
    serviceTypes: Array.isArray(cleaner.serviceTypes) ? cleaner.serviceTypes.slice(0, 20) : [],
    experience: cleaner.experience || "",
    available: Boolean(cleaner.available),
    manualApproved: Boolean(cleaner.manualApproved),
    phoneVerified: Boolean(cleaner.phoneVerified),
    verificationBadges: Array.isArray(cleaner.verificationBadges) ? cleaner.verificationBadges.slice(0, 10) : [],
    insuranceStatusText: cleaner.insuranceStatusText || "",
    distanceKm,
    distanceText: cleaner.distanceText || (distanceKm === "" ? "" : formatDistanceText(distanceKm)),
  };
  if (viewerContext.canViewContact) {
    profile.phone = cleaner.phone || "";
    profile.wechatContact = cleaner.wechatContact || cleaner.contactWechat || "";
  }
  return profile;
}

function publicCleaner(cleaner) {
  return publicCleanerProfile(cleaner);
}

function maskNickname(name) {
  const text = String(name || "").trim();
  if (!text) return "邻里用户";
  return `${text.slice(0, 1)}***`;
}

function decorateReviewForDisplay(review, customerProfile = null, order = null) {
  if (!review) return null;
  return {
    _id: review._id || "",
    rating: Number(review.rating || 0),
    content: review.content || "",
    imageUrls: normalizeReviewImageUrls(review.imageUrls),
    customerNameMasked: maskNickname(customerProfile && customerProfile.nickname),
    serviceType: review.serviceType || (order && order.serviceType) || "",
    createdAt: review.createdAt || "",
    updatedAt: review.updatedAt || review.createdAt || "",
  };
}

function publicOrderReview(review = {}, options = {}) {
  if (!review || !isManualReview(review)) return null;
  const next = {
    _id: review._id || "",
    rating: Number(review.rating || 0),
    content: review.content || "",
    imageUrls: normalizeReviewImageUrls(review.imageUrls),
    createdAt: review.createdAt || "",
    updatedAt: review.updatedAt || review.createdAt || "",
  };
  if (options.includeServiceType) {
    next.serviceType = review.serviceType || "";
  }
  return next;
}

function participantKey(customerOpenid, cleanerOpenid) {
  return `${customerOpenid}__${cleanerOpenid}`;
}

function shortOrderDate(value) {
  if (!value) return "时间待确认";
  return String(value).replace(/-/g, "/").replace("T", " ").slice(0, 16);
}

function orderAmountText(order) {
  const amount = Number(order.orderAmount || order.estimatedPrice || calculateOrderPricing(order).orderAmount || 0);
  return Number.isInteger(amount) ? `¥${amount}` : `¥${amount.toFixed(2)}`;
}

function orderSnapshot(order) {
  return {
    serviceType: order.serviceType || "保洁服务",
    serviceTime: shortOrderDate(order.scheduledAt),
    addressLabel: order.community || order.addressText || "地址待确认",
    price: orderAmountText(order),
    status: normalizeOrderStatus(order.status),
  };
}

async function ensureOrderCardMessage(conversation, order) {
  const existing = await findOne("messages", {
    conversationId: conversation._id,
    type: "order_card",
    orderId: order._id,
  });
  const snapshot = orderSnapshot(order);
  const content = `新订单：${snapshot.serviceType} · ${snapshot.status}`;
  const createdAt = now();
  if (!existing) {
    await db.collection("messages").add({
      data: {
        conversationId: conversation._id,
        type: "order_card",
        orderId: order._id,
        orderSnapshot: snapshot,
        senderOpenid: order.customerOpenid,
        receiverOpenid: order.acceptedCleanerOpenid,
        content,
        createdAt,
      },
    });
  }
  await db.collection("conversations").doc(conversation._id).update({
    data: {
      lastMessage: content,
      lastMessageType: "order_card",
      lastMessageAt: createdAt,
      latestOrderId: order._id,
      serviceType: snapshot.serviceType,
      updatedAt: createdAt,
    },
  });
}

async function ensureConversation(order) {
  if (!order || !order._id || !order.customerOpenid || !order.acceptedCleanerOpenid) return null;
  const key = participantKey(order.customerOpenid, order.acceptedCleanerOpenid);
  const existing = (await findOne("conversations", { participantKey: key })) || (await findOne("conversations", { orderId: order._id }));
  const orderIds = Array.from(new Set([...(existing ? existing.orderIds || [] : []), order._id]));
  const data = {
    participantKey: key,
    orderId: existing && existing.orderId ? existing.orderId : order._id,
    latestOrderId: order._id,
    orderIds,
    customerOpenid: order.customerOpenid,
    cleanerOpenid: order.acceptedCleanerOpenid,
    serviceType: order.serviceType || "",
    updatedAt: now(),
  };
  if (existing) {
    await db.collection("conversations").doc(existing._id).update({ data });
    const conversation = await findOne("conversations", { participantKey: key });
    await ensureOrderCardMessage(conversation || { ...existing, ...data }, order);
    return findOne("conversations", { participantKey: key });
  }
  const result = await db.collection("conversations").add({
    data: {
      ...data,
      lastMessage: "",
      lastMessageAt: now(),
      unreadByCustomer: 0,
      unreadByCleaner: 0,
      createdAt: now(),
    },
  });
  const conversation = await findOne("conversations", { _id: result._id });
  await ensureOrderCardMessage(conversation, order);
  return findOne("conversations", { participantKey: key });
}

async function initCollections(data = {}) {
  const openid = getOpenid();
  await requireAdmin(openid);
  await Promise.all(COLLECTIONS.map((name) => safeCreateCollection(name)));
  await ensureUser(openid);
  await ensureCustomerProfile(openid);
  const seedEnabled = data.seed === undefined ? isExplicitNonProduction() : Boolean(data.seed);
  if (!seedEnabled) {
    await writeAuditLog({
      actorOpenid: openid,
      actorRole: "admin",
      action: "initCollections",
      targetType: "collections",
      metadata: { collections: COLLECTIONS, seeded: false },
    });
    return ok({ collections: COLLECTIONS, seededCleaners: 0 });
  }
  assertActionAllowedInProduction("initCollectionsSeed", data);

  const seedCleaners = [
    {
      _openid: openid,
      displayName: "测试家洁师（当前账号）",
      serviceAreas: ["梧桐小区", "星河湾", "阳光花园"],
      phone: "13800000000",
      wechatContact: "demo-cleaner",
      experience: "平台种子账号，便于单账号跑通接单流程。",
    },
    {
      _openid: "seed-cleaner-001",
      displayName: "王家洁师",
      serviceAreas: ["梧桐小区", "湖畔花园"],
      phone: "13900001111",
      wechatContact: "wangayi-clean",
      experience: "8 年家庭保洁经验，擅长日常保洁和厨房深度清洁。",
    },
    {
      _openid: "seed-cleaner-002",
      displayName: "李家洁师",
      serviceAreas: ["星河湾", "阳光花园"],
      phone: "13700002222",
      wechatContact: "liayi-home",
      experience: "长期服务周边社区，做事细致，支持固定周期服务。",
    },
  ];

  for (const item of seedCleaners) {
    const existing = await findOne("cleaners", { _openid: item._openid });
    const data = {
      ...item,
      avatarUrl: "",
      serviceTypes: ["日常保洁", "深度保洁", "厨房清洁"],
      available: true,
      phoneVerified: true,
      manualApproved: true,
      seededByPlatform: true,
      ratingAvg: item._openid === "seed-cleaner-002" ? 4.8 : 4.9,
      reviewCount: item._openid === "seed-cleaner-002" ? 16 : 24,
      completedOrderCount: item._openid === "seed-cleaner-002" ? 16 : 24,
      lastLocation: {
        province: "浙江省",
        city: "杭州市",
        district: "西湖区",
        street: "文三路街道",
        latitude: item._openid === "seed-cleaner-002" ? 30.286 : 30.276,
        longitude: item._openid === "seed-cleaner-002" ? 120.162 : 120.156,
        updatedAt: now(),
      },
      updatedAt: now(),
    };
    if (existing) {
      await db.collection("cleaners").doc(existing._id).update({ data });
    } else {
      await db.collection("cleaners").add({
        data: {
          ...data,
          createdAt: now(),
        },
      });
    }
  }

  await db.collection("platformStats").doc("main").set({
    data: {
      completedOrderCount: 126,
      activeCleanerCount: seedCleaners.length,
      positiveReviewCount: 118,
      coveredCommunityCount: 8,
      updatedAt: now(),
    },
  });

  await writeAuditLog({
    actorOpenid: openid,
    actorRole: "admin",
    action: "initCollections",
    targetType: "collections",
    metadata: { collections: COLLECTIONS, seeded: true, seededCleaners: seedCleaners.length },
  });

  return ok({ collections: COLLECTIONS, seededCleaners: seedCleaners.length });
}

async function login() {
  const openid = getOpenid();
  await safeCreateCollection("users");
  await safeCreateCollection("customerProfiles");
  await safeCreateCollection("cleaners");
  const user = await ensureUser(openid);
  const customerProfile = await ensureCustomerProfile(openid);
  let cleaner = await getCleaner(openid);
  if (user.role === "cleaner" && !cleaner) {
    cleaner = await ensureCleanerProfile(openid);
  }
  cleaner = cleaner ? await withCleanerStats(cleaner, { canViewContact: true }) : cleaner;
  return ok({ openid, user, customerProfile: privateCustomerProfileForOwner(customerProfile), cleaner, cleanerProfile: cleaner });
}

async function updateUserRole(data) {
  const openid = getOpenid();
  const role = data.role;
  if (!["customer", "cleaner"].includes(role)) {
    throw AppError("角色不正确");
  }
  const user = await ensureUser(openid);
  const roles = Array.from(new Set([...(Array.isArray(user.roles) ? user.roles : []), role]));
  await db.collection("users").doc(user._id).update({
    data: { role, currentRole: role, roles, updatedAt: now() },
  });
  if (role === "cleaner") {
    await ensureCleanerProfile(openid);
  } else {
    await ensureCustomerProfile(openid);
  }
  return login();
}

async function updateUserLocation(data) {
  return updateCustomerLocation(data);
}

async function updateCustomerLocation(data) {
  const openid = getOpenid();
  const user = await ensureUser(openid);
  const location = {
    province: String(data.province || "").slice(0, 30),
    city: String(data.city || "").slice(0, 30),
    district: String(data.district || "").slice(0, 30),
    street: String(data.street || "").slice(0, 40),
    community: String(data.community || "").slice(0, 40),
    detailAddress: String(data.detailAddress || "").slice(0, 80),
    addressText: String(data.addressText || "").slice(0, 120),
    latitude: latitudeOf(data),
    longitude: longitudeOf(data),
  };
  await db.collection("users").doc(user._id).update({
    data: { defaultLocation: location, updatedAt: now() },
  });
  const customerProfile = await ensureCustomerProfile(openid);
  await db.collection("customerProfiles").doc(customerProfile._id).update({
    data: { address: location, updatedAt: now() },
  });
  return ok({ location });
}

async function updateCleanerWorkLocation(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "cleaner");
  const cleaner = await ensureCleanerProfile(openid);
  const workLocation = {
    province: String(data.province || "").slice(0, 30),
    city: String(data.city || "").slice(0, 30),
    district: String(data.district || "").slice(0, 30),
    latitude: latitudeOf(data),
    longitude: longitudeOf(data),
    updatedAt: now(),
  };
  await db.collection("cleaners").doc(cleaner._id).update({
    data: { workLocation, updatedAt: now() },
  });
  return ok({ workLocation });
}

async function updateUserProfile(data) {
  return updateMyProfile({ ...data, role: data.role || "customer" });
}

async function getMyProfile(data) {
  const openid = getOpenid();
  const user = await ensureUser(openid);
  const role = data.role === "cleaner" ? "cleaner" : "customer";
  const customerProfile = await getCustomerProfile(openid);
  const cleaner = role === "cleaner" ? await getCleaner(openid) : await getCleaner(openid).catch(() => null);
  const cleanerProfile = cleaner ? await withCleanerStats(cleaner, { canViewContact: role === "cleaner" }) : null;
  return ok({ openid, user, role, customerProfile: privateCustomerProfileForOwner(customerProfile), cleanerProfile });
}

async function updateMyProfile(data) {
  const openid = getOpenid();
  const role = data.role === "cleaner" ? "cleaner" : "customer";
  if (role === "cleaner") {
    const result = await updateCleanerProfile({
      displayName: data.nickname,
      avatarUrl: data.avatarUrl,
      phone: data.phone,
    });
    const cleanerProfile = result.data.cleaner;
    return ok({
      role,
      user: await ensureUser(openid),
      customerProfile: privateCustomerProfileForOwner(await getCustomerProfile(openid)),
      cleanerProfile,
      cleaner: cleanerProfile,
    });
  }

  await requireUserRole(openid, "customer");
  const profile = await ensureCustomerProfile(openid);
  const nextData = { updatedAt: now() };
  if (data.nickname !== undefined) {
    const nickname = String(data.nickname || "").trim();
    if (!nickname) throw AppError("请填写昵称");
    nextData.nickname = nickname.slice(0, 24);
  }
  if (data.avatarUrl !== undefined) {
    nextData.avatarUrl = String(data.avatarUrl || "").slice(0, 300);
  }
  if (data.phone !== undefined) {
    nextData.phone = String(data.phone || "").slice(0, 20);
  }
  await db.collection("customerProfiles").doc(profile._id).update({ data: nextData });
  return ok({
    role,
    user: await ensureUser(openid),
    customerProfile: privateCustomerProfileForOwner(await getCustomerProfile(openid)),
      cleanerProfile: await withCleanerStats(await getCleaner(openid).catch(() => null), { canViewContact: true }),
  });
}

function toLocation(address) {
  return {
    province: address.province || "",
    city: address.city || "",
    district: address.district || "",
    street: address.street || "",
    community: address.community || "",
    detailAddress: address.detailAddress || "",
    addressText: address.addressText || "",
    latitude: address.latitude === undefined ? null : address.latitude,
    longitude: address.longitude === undefined ? null : address.longitude,
  };
}

function optionalCoordinate(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function latitudeOf(data) {
  const source = data || {};
  const nested = source.location || {};
  return optionalCoordinate(
    source.latitude !== undefined ? source.latitude : source.lat !== undefined ? source.lat : nested.latitude !== undefined ? nested.latitude : nested.lat
  );
}

function longitudeOf(data) {
  const source = data || {};
  const nested = source.location || {};
  return optionalCoordinate(
    source.longitude !== undefined
      ? source.longitude
      : source.lng !== undefined
        ? source.lng
        : source.lon !== undefined
          ? source.lon
          : nested.longitude !== undefined
            ? nested.longitude
            : nested.lng
  );
}

function normalizeLastLocation(data) {
  if (!data) return null;
  const nested = data.location || {};
  if (!data.latitude && !data.longitude && !data.lat && !data.lng && !nested.lat && !nested.lng && !data.city) return null;
  let latitude = optionalCoordinate(data.latitude !== undefined ? data.latitude : data.lat !== undefined ? data.lat : nested.latitude !== undefined ? nested.latitude : nested.lat);
  let longitude = optionalCoordinate(data.longitude !== undefined ? data.longitude : data.lng !== undefined ? data.lng : data.lon !== undefined ? data.lon : nested.longitude !== undefined ? nested.longitude : nested.lng);
  if (!(latitude >= -90 && latitude <= 90) && longitude >= -90 && longitude <= 90 && latitude >= -180 && latitude <= 180) {
    const nextLatitude = longitude;
    longitude = latitude;
    latitude = nextLatitude;
  }
  if (!(latitude >= -90 && latitude <= 90) || !(longitude >= -180 && longitude <= 180)) {
    latitude = null;
    longitude = null;
  }
  return {
    province: String(data.province || "").slice(0, 30),
    city: String(data.city || "").slice(0, 30),
    district: String(data.district || "").slice(0, 30),
    street: String(data.street || "").slice(0, 40),
    latitude,
    longitude,
    updatedAt: now(),
  };
}

async function unsetDefaultUserAddresses(openid) {
  await db.collection("userAddresses").where({ userOpenid: openid }).update({
    data: { isDefault: false, updatedAt: now() },
  });
}

async function updateCustomerProfileAddress(openid, address, defaultAddressId = "") {
  const profile = await ensureCustomerProfile(openid);
  await db.collection("customerProfiles").doc(profile._id).update({
    data: {
      address: address ? toLocation(address) : null,
      defaultAddressId,
      updatedAt: now(),
    },
  });
}

async function listUserAddresses() {
  const openid = getOpenid();
  await requireUserRole(openid, "customer");
  await safeCreateCollection("userAddresses");
  const result = await db
    .collection("userAddresses")
    .where({ userOpenid: openid })
    .limit(100)
    .get();
  const addresses = result.data.sort((first, second) => {
    if (first.isDefault !== second.isDefault) return first.isDefault ? -1 : 1;
    return new Date(second.updatedAt || 0).getTime() - new Date(first.updatedAt || 0).getTime();
  });
  return ok(addresses);
}

async function saveUserAddress(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "customer");
  await safeCreateCollection("userAddresses");
  const address = normalizeUserAddress(data);
  const shouldDefault = Boolean(data.isDefault);
  const createdAt = now();
  let existingAddress = null;
  if (data._id) {
    const existing = await db.collection("userAddresses").doc(data._id).get();
    if (!existing.data || existing.data.userOpenid !== openid) {
      throw AppError("地址不存在");
    }
    existingAddress = existing.data;
  }

  let isDefault = shouldDefault || Boolean(existingAddress && existingAddress.isDefault);
  if (!isDefault) {
    const existingDefault = await findOne("userAddresses", { userOpenid: openid, isDefault: true });
    isDefault = !existingDefault;
  }

  if (isDefault) {
    await unsetDefaultUserAddresses(openid);
  }

  const payload = {
    ...address,
    userOpenid: openid,
    isDefault,
    updatedAt: createdAt,
  };

  if (data._id) {
    await db.collection("userAddresses").doc(data._id).update({ data: payload });
  } else {
    await db.collection("userAddresses").add({
      data: {
        ...payload,
        createdAt,
      },
    });
  }

  if (isDefault) {
    const user = await ensureUser(openid);
    await db.collection("users").doc(user._id).update({
      data: { defaultLocation: toLocation(address), updatedAt: createdAt },
    });
    await updateCustomerProfileAddress(openid, address, data._id || "");
  }

  return listUserAddresses();
}

async function setDefaultUserAddress(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "customer");
  const target = await db.collection("userAddresses").doc(data.addressId).get();
  if (!target.data || target.data.userOpenid !== openid) {
    throw AppError("地址不存在");
  }
  const updatedAt = now();
  await unsetDefaultUserAddresses(openid);
  await db.collection("userAddresses").doc(data.addressId).update({
    data: { isDefault: true, updatedAt },
  });
  const user = await ensureUser(openid);
  await db.collection("users").doc(user._id).update({
    data: { defaultLocation: toLocation(target.data), updatedAt },
  });
  await updateCustomerProfileAddress(openid, target.data, data.addressId);
  return listUserAddresses();
}

async function deleteUserAddress(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "customer");
  const target = await db.collection("userAddresses").doc(data.addressId).get();
  if (!target.data || target.data.userOpenid !== openid) {
    throw AppError("地址不存在");
  }
  await db.collection("userAddresses").doc(data.addressId).remove();
  if (target.data.isDefault) {
    const result = await db.collection("userAddresses").where({ userOpenid: openid }).limit(100).get();
    const next = result.data.sort(
      (first, second) => new Date(second.updatedAt || 0).getTime() - new Date(first.updatedAt || 0).getTime()
    )[0];
    if (next) {
      await db.collection("userAddresses").doc(next._id).update({
        data: { isDefault: true, updatedAt: now() },
      });
      const user = await ensureUser(openid);
      await db.collection("users").doc(user._id).update({
        data: { defaultLocation: toLocation(next), updatedAt: now() },
      });
      await updateCustomerProfileAddress(openid, next, next._id);
    } else {
      await updateCustomerProfileAddress(openid, null, "");
    }
  }
  return listUserAddresses();
}

async function requireUserRole(openid, expectedRole) {
  const user = await ensureUser(openid);
  if (user.role !== expectedRole) {
    throw AppError(expectedRole === "customer" ? "当前身份不能执行客户操作" : "当前身份不能执行家洁师操作");
  }
  return user;
}

async function getPlatformStats() {
  const stats = await db.collection("platformStats").doc("main").get().catch(() => ({ data: null }));
  return ok(
    stats.data || {
      completedOrderCount: 0,
      activeCleanerCount: 0,
      positiveReviewCount: 0,
      coveredCommunityCount: 0,
    }
  );
}

async function getServiceStandards(data = {}) {
  const enabled = await enabledServiceStandards();
  const matched = enabled.filter((item) => !data.serviceType || item.serviceType === data.serviceType);
  const standards = (matched.length ? matched : data.serviceType ? [fallbackServiceStandard(data.serviceType)] : enabled).map(publicServiceStandard);
  return ok({ standards });
}

async function getProtectionPlans() {
  const plans = (await enabledProtectionPlans()).map(publicProtectionPlan);
  return ok({ plans });
}

async function getPricingRules() {
  const openid = getOpenid();
  const viewerIsAdmin = await isAdmin(openid);
  const rules = await enabledPricingRules();
  return ok({ rules: rules.filter((rule) => rule.enabled !== false).map((rule) => (viewerIsAdmin ? fullPricingRule(rule) : publicPricingRule(rule))) });
}

async function createPricingQuote(data = {}) {
  const openid = getOpenid();
  await requireUserRole(openid, "customer");
  const quote = await createPricingQuoteRecord(sanitizePricingInput(data), openid, { generatedBy: "createPricingQuote" });
  return ok({ quote: publicPricingQuote(quote) });
}

async function getPricingQuote(data = {}) {
  const openid = getOpenid();
  const viewerIsAdmin = await isAdmin(openid);
  const quote = await findOne("pricingQuotes", { quoteId: data.quoteId });
  if (!quote) throw AppError("报价不存在或已失效", "INVALID_INPUT");
  if (!viewerIsAdmin && quote.userOpenid !== openid) throw AppError("无权查看该报价", "FORBIDDEN");
  const status = quote.status === "active" && isQuoteExpired(quote) ? "expired" : quote.status;
  const next = { ...quote, status };
  return ok({ quote: viewerIsAdmin ? next : publicPricingQuote(next) });
}

function normalizeOrderLocationSnapshot(data) {
  const source = data.locationSnapshot || {};
  const latitude = latitudeOf(source);
  const longitude = longitudeOf(source);
  return {
    province: String(source.province || data.province || "").slice(0, 30),
    city: String(source.city || data.city || "").slice(0, 30),
    district: String(source.district || data.district || "").slice(0, 30),
    street: String(source.street || data.street || "").slice(0, 40),
    community: String(source.community || data.community || "").slice(0, 40),
    detailAddress: String(source.detailAddress || data.detailAddress || "").slice(0, 80),
    addressText: String(source.addressText || data.addressText || "").slice(0, 120),
    latitude: latitude ?? latitudeOf(data),
    longitude: longitude ?? longitudeOf(data),
  };
}

function cityCodeOf(location) {
  const city = location.city || "";
  const district = location.district || "";
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

function displayDateCode(date) {
  const value = date instanceof Date ? date : new Date(date);
  const safeDate = Number.isFinite(value.getTime()) ? value : now();
  const year = String(safeDate.getFullYear()).slice(-2);
  const month = String(safeDate.getMonth() + 1).padStart(2, "0");
  const day = String(safeDate.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function orderDateForNo(order) {
  const value = order.createdAt || order.createTime || order.updatedAt;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : now();
}

function orderNoPrefixOf(order) {
  const location = order.locationSnapshot || order;
  return `${cityCodeOf(location)}-${displayDateCode(orderDateForNo(order))}-`;
}

function displayOrderSequence(displayOrderNo, prefix) {
  const value = String(displayOrderNo || "");
  if (!value.startsWith(prefix)) return 0;
  const sequence = Number(value.slice(prefix.length));
  return Number.isInteger(sequence) && sequence > 0 ? sequence : 0;
}

async function nextDisplayOrderNo(location, createdAt) {
  const cityCode = cityCodeOf(location);
  const dateCode = displayDateCode(createdAt);
  const prefix = `${cityCode}-${dateCode}-`;
  const result = await db
    .collection("orders")
    .where({ displayOrderNoPrefix: prefix })
    .limit(100)
    .get()
    .catch(() => ({ data: [] }));
  return {
    displayOrderNoPrefix: prefix,
    displayOrderNo: `${prefix}${String(result.data.length + 1).padStart(3, "0")}`,
  };
}

async function listAllOrdersForOrderNoMigration() {
  const pageSize = 100;
  const orders = [];
  let skip = 0;
  while (true) {
    const result = await db.collection("orders").skip(skip).limit(pageSize).get();
    const page = result.data || [];
    orders.push(...page);
    if (page.length < pageSize) break;
    skip += pageSize;
  }
  return orders;
}

async function migrateOrderNos(data = {}) {
  const openid = getOpenid();
  await requireAdmin(openid);
  assertActionAllowedInProduction("migrateOrderNos", data);
  const orders = await listAllOrdersForOrderNoMigration();
  const usedSequences = {};

  for (const order of orders) {
    if (!order.displayOrderNo) continue;
    const prefix = order.displayOrderNoPrefix || order.displayOrderNo.replace(/\d{3}$/, "");
    const sequence = displayOrderSequence(order.displayOrderNo, prefix);
    usedSequences[prefix] = Math.max(usedSequences[prefix] || 0, sequence);
  }

  const missingOrders = orders
    .filter((order) => !order.displayOrderNo)
    .sort((a, b) => orderDateForNo(a).getTime() - orderDateForNo(b).getTime());
  const migrated = [];

  for (const order of missingOrders) {
    const prefix = orderNoPrefixOf(order);
    const sequence = (usedSequences[prefix] || 0) + 1;
    usedSequences[prefix] = sequence;
    const displayOrderNo = `${prefix}${String(sequence).padStart(3, "0")}`;
    await db.collection("orders").doc(order._id).update({
      data: {
        displayOrderNoPrefix: prefix,
        displayOrderNo,
        updatedAt: now(),
      },
    });
    migrated.push({ orderId: order._id, displayOrderNo });
  }

  await writeAuditLog({
    actorOpenid: openid,
    actorRole: "admin",
    action: "migrateOrderNos",
    targetType: "orders",
    metadata: { total: orders.length, migratedCount: migrated.length, migrated },
  });

  return ok({
    total: orders.length,
    migratedCount: migrated.length,
    migrated,
  });
}

function openOrderLocationMatch(order, cleanerLocation) {
  const location = cleanerLocation || {};
  if (!location.city) return false;
  if (!order.city) return false;
  if (order.city !== location.city) return false;
  if (location.district && order.district) return order.district === location.district;
  return true;
}

function publicOrderLocationFlag(order, cleanerLocation) {
  if (!cleanerLocation || !cleanerLocation.city || !order.city) return { nonLocal: false };
  const same = openOrderLocationMatch(order, cleanerLocation);
  return {
    nonLocal: !same,
    locationTag: same ? "" : "非当前城市",
  };
}

async function getCollectionData(name) {
  const result = await db.collection(name).limit(1000).get();
  return result.data || [];
}

async function recordBehaviorGraphEdge(edge = {}) {
  await safeCreateCollection("behaviorGraphEdges");
  const store = createBehaviorGraphStore(db, { now });
  return store.addEdge(edge);
}

async function getPersistedBehaviorGraph(order = {}, cleanerId = "") {
  const store = createBehaviorGraphStore(db, { now });
  const sourceId = order.customerOpenid || order.userOpenid || "";
  if (!sourceId && !cleanerId) return { edges: [] };
  return store.getGraph(cleanerId ? { sourceId, targetId: cleanerId } : { sourceId });
}

function cleanerOpenidOfOrder(order = {}) {
  return order.acceptedCleanerOpenid || order.cleanerId || order.assignedCleanerOpenid || "";
}

function orderRiskPublicFields(risk = {}) {
  return {
    riskScore: Number(risk.riskScore || risk.finalRiskScore || 0),
    riskLevel: risk.riskLevel || riskLevelFromScore(risk.riskScore || risk.finalRiskScore || 0),
    riskDecision: risk.decision || decisionFromScore(risk.riskScore || risk.finalRiskScore || 0),
    fraudScore: Number(risk.fraudScore || 0),
    collusionScore: Number(risk.collusionScore || 0),
    graphScore: Number(risk.graphScore || risk.graphRiskScore || 0),
  };
}

function shouldHideOpenOrderByRisk(risk = {}) {
  if (!risk) return false;
  const riskLevel = risk.riskLevel || riskLevelFromScore(risk.riskScore || 0);
  const decision = risk.decision || risk.riskDecision || decisionFromScore(risk.riskScore || 0);
  return ["high", "critical"].includes(riskLevel) || ["HIGH_REVIEW", "BLOCK"].includes(decision);
}

function statusTimeOf(record = {}) {
  const value = record.updatedAt || record.createdAt || record.cancelledAt || "";
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function withinDays(record = {}, days) {
  const time = statusTimeOf(record);
  if (!time) return false;
  return now().getTime() - time.getTime() <= days * 24 * 60 * 60 * 1000;
}

function isCleanerRelatedOrder(order = {}, cleanerId = "") {
  if (!cleanerId) return false;
  return (
    order.acceptedCleanerOpenid === cleanerId ||
    order.cleanerId === cleanerId ||
    order.assignedCleanerOpenid === cleanerId ||
    (Array.isArray(order.responses) && order.responses.some((response) => response.cleanerId === cleanerId))
  );
}

async function upsertCleanerTrustProfile(cleanerId, patch = {}) {
  const updatedAt = now();
  const existing = await findOne("cleanerTrustProfile", { cleanerId }).catch(() => null);
  const data = { cleanerId, ...patch, updatedAt };
  if (existing) {
    await db.collection("cleanerTrustProfile").doc(existing._id).update({ data });
    return { ...existing, ...data };
  }
  await db.collection("cleanerTrustProfile").add({ data: { _id: `trust-${cleanerId}`, ...data } });
  return findOne("cleanerTrustProfile", { cleanerId });
}

async function getCleanerTrustProfile(cleanerId, cleaner = null) {
  const existing = await findOne("cleanerTrustProfile", { cleanerId }).catch(() => null);
  if (existing) return existing;
  const allOrders = await getCollectionData("orders").catch(() => []);
  const relatedOrders = allOrders.filter((order) => isCleanerRelatedOrder(order, cleanerId));
  const total = relatedOrders.length;
  const completed = relatedOrders.filter((order) => ["completed", "auto_completed"].includes(order.status)).length;
  const cancelled = relatedOrders.filter((order) => ["cancelled", "assigned_declined"].includes(order.status)).length;
  const noShowCount = relatedOrders.filter((order) => order.status === "no_show" || order.noShow === true).length;
  const claims = await getCollectionData("protectionClaims").catch(() => []);
  const relatedOrderIds = new Set(relatedOrders.map((order) => order._id));
  const complaintClaims = claims.filter(
    (claim) =>
      relatedOrderIds.has(claim.orderId) &&
      ["complaint", "property_damage", "refund", "rework"].includes(claim.claimType)
  );
  const trust = calculateCleanerTrust({
    cleanerId,
    completionRate: total ? completed / total : 1,
    cancellationRate: total ? cancelled / total : 0,
    complaintRate: total ? complaintClaims.length / total : 0,
    avgRating: cleaner ? Number(cleaner.ratingAvg || 0) || 5 : 5,
    noShowCount,
    lateCount: Number(cleaner && cleaner.lateCount ? cleaner.lateCount : 0),
    disputeCount: complaintClaims.length,
  });
  const governed = applyAutoGovernance(trust, {
    cancellationCount24h: relatedOrders.filter((order) => ["cancelled", "assigned_declined"].includes(order.status) && withinDays(order, 1)).length,
    complaintCount7d: complaintClaims.filter((claim) => withinDays(claim, 7)).length,
  });
  return upsertCleanerTrustProfile(cleanerId, governed);
}

async function getStoredOrderRiskProfile(orderId) {
  return findOne("orderRiskProfile", { orderId }).catch(() => null);
}

async function upsertOrderRiskProfile(orderId, risk = {}) {
  const existing = await getStoredOrderRiskProfile(orderId);
  const updatedAt = now();
  const data = { orderId, ...orderRiskPublicFields(risk), updatedAt };
  if (existing) {
    await db.collection("orderRiskProfile").doc(existing._id).update({ data });
    return { ...existing, ...data };
  }
  await db.collection("orderRiskProfile").add({ data: { _id: orderId, createdAt: updatedAt, ...data } });
  return findOne("orderRiskProfile", { orderId });
}

async function calculateAndStoreOrderRisk(order, cleaner = null) {
  const cleanerId = cleanerOpenidOfOrder(order) || (cleaner && cleaner._openid) || "";
  const cleanerProfile = cleanerId ? await getCleanerTrustProfile(cleanerId, cleaner).catch(() => null) : { trustScore: 80, trustLevel: "medium" };
  const orders = await getCollectionData("orders").catch(() => []);
  const claims = await getCollectionData("protectionClaims").catch(() => []);
  const persistedGraph = await getPersistedBehaviorGraph(order, cleanerId).catch(() => ({ edges: [] }));
  const graph = calculateBehaviorGraph({ orders: orders.concat(order), claims, graphEdges: persistedGraph.edges || [] });
  const fraud = calculateFraudRisk({ orders: orders.concat(order), claims });
  const collusion = calculateCollusionRisk({ orders: orders.concat(order), claims });
  const risk = calculateOrderRisk(order, cleanerProfile || {}, { trustScore: 80 }, {
    graphRiskScore: graph.graphRiskScore,
    fraudScore: fraud.fraudScore,
    collusionScore: collusion.collusionScore,
  });
  return upsertOrderRiskProfile(order._id || order.orderId, risk);
}

async function assertRiskAllowsCleanerAction(order, cleaner, cleanerId) {
  const trust = await getCleanerTrustProfile(cleanerId, cleaner);
  if (trust.trustLevel === "blocked" || trust.blocked === true) {
    throw AppError("家洁师信任状态暂不可接单", "FORBIDDEN");
  }
  if (trust.freezeUntil && new Date(trust.freezeUntil).getTime() > now().getTime()) {
    throw AppError("家洁师账号已临时冻结，请等待平台复核", "FORBIDDEN");
  }
  const storedRisk = await getStoredOrderRiskProfile(order._id);
  const risk = storedRisk || (await calculateAndStoreOrderRisk(order, cleaner));
  const decision = risk.decision || risk.riskDecision || decisionFromScore(risk.riskScore || 0);
  if (decision === "BLOCK") {
    throw AppError("订单风险过高，暂不可接单", "FORBIDDEN");
  }
  if (["RESTRICT", "HIGH_REVIEW"].includes(decision)) {
    throw AppError("订单需要平台复核后处理", "REVIEW_REQUIRED");
  }
  return { trust, risk };
}

async function assertCleanerAssignable(order, cleanerId, cleaner) {
  const trust = await getCleanerTrustProfile(cleanerId, cleaner);
  if (trust.trustLevel === "blocked" || trust.blocked === true) {
    throw AppError("该家洁师暂不可预约", "FORBIDDEN");
  }
  const orders = await getCollectionData("orders").catch(() => []);
  const collusion = calculateCollusionRisk({ orders: orders.concat({ ...order, acceptedCleanerOpenid: cleanerId, cleanerId }) });
  if (collusion.collusionScore >= 75) {
    throw AppError("该指派组合需要平台复核", "REVIEW_REQUIRED");
  }
  return true;
}

async function createOrder(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "customer");
  assertCreateOrderInput(data);
  const locationSnapshot = normalizeOrderLocationSnapshot(data);
  const areaSqm = Number(data.areaSqm || data.areaSize || 0);
  if (normalizeServiceTypeKey(data.serviceType) === "moveIn" && areaSqm <= 0) {
    throw AppError("开荒保洁请填写面积", "INVALID_INPUT");
  }
  const quoteOrderInput = sanitizePricingInput({
    quoteId: data.quoteId || "",
    city: locationSnapshot.city,
    serviceType: data.serviceType,
    durationHours: data.durationHours,
    areaSqm,
    areaSize: areaSqm,
    assignedCleanerOpenid: data.assignedCleanerOpenid || "",
  });
  const quote =
    (await getValidQuoteForOrder({ ...quoteOrderInput, quoteId: data.quoteId || "", locationSnapshot }, openid)) ||
    (await createPricingQuoteRecord(quoteOrderInput, openid, { generatedBy: "createOrder_fallback" }));
  const pricingSnapshot = { ...(quote.pricingSnapshot || {}) };
  if (!pricingSnapshot.customerPayAmount && !pricingSnapshot.orderAmount) {
    throw AppError("订单金额计算失败，请检查服务类型和时长", "INVALID_INPUT");
  }

  if (data.publishMode === "assigned") {
    const assignedCleaner = await getCleaner(data.assignedCleanerOpenid);
    if (!assignedCleaner || !assignedCleaner.manualApproved || !assignedCleaner.available) {
      throw AppError("指派家洁师暂不可预约");
    }
    await assertCleanerAssignable(
      {
        customerOpenid: openid,
        assignedCleanerOpenid: data.assignedCleanerOpenid,
        status: "assigned_waiting_accept",
        publishMode: data.publishMode,
      },
      data.assignedCleanerOpenid,
      assignedCleaner
    );
  }

  const createdAt = now();
  const status = data.publishMode === "assigned" ? "assigned_waiting_accept" : "waiting_response";
  const serviceStandard = await getDefaultServiceStandard(data.serviceType);
  const protectionPlan = await getDefaultProtectionPlan();
  const displayOrder = await nextDisplayOrderNo(locationSnapshot, createdAt);
  if (quote.quoteId) {
    await consumePricingQuoteForOrder(quote, openid, createdAt);
  }
  const result = await db.collection("orders").add({
    data: {
      customerOpenid: openid,
      acceptedCleanerOpenid: "",
      assignedCleanerOpenid: data.publishMode === "assigned" ? data.assignedCleanerOpenid : "",
      cleanerId: "",
      publishMode: data.publishMode,
      serviceType: data.serviceType,
      province: locationSnapshot.province,
      city: locationSnapshot.city,
      district: locationSnapshot.district,
      street: locationSnapshot.street,
      community: locationSnapshot.community,
      detailAddress: locationSnapshot.detailAddress,
      addressText: locationSnapshot.addressText,
      latitude: locationSnapshot.latitude,
      longitude: locationSnapshot.longitude,
      locationSnapshot,
      ...displayOrder,
      areaSize: data.areaSize || data.areaSqm || "",
      areaSqm,
      billableAreaSqm: pricingSnapshot.billableAreaSqm || 0,
      durationHours: Number(data.durationHours || pricingSnapshot.durationHours || 0),
      scheduledAt: data.scheduledAt,
      note: data.note || "",
      contactPhone: data.contactPhone,
      contactWechat: data.contactWechat || "",
      quoteId: quote.quoteId || pricingSnapshot.quoteId || "",
      priceRuleVersion: pricingSnapshot.priceRuleVersion || "",
      listPrice: pricingSnapshot.listPrice || 0,
      launchPrice: pricingSnapshot.launchPrice || 0,
      customerPayAmount: pricingSnapshot.customerPayAmount || pricingSnapshot.orderAmount || 0,
      amount: pricingSnapshot.customerPayAmount || pricingSnapshot.orderAmount || 0,
      estimatedPrice: pricingSnapshot.customerPayAmount || pricingSnapshot.orderAmount || 0,
      orderAmount: pricingSnapshot.customerPayAmount || pricingSnapshot.orderAmount || 0,
      couponDiscount: pricingSnapshot.couponDiscount || 0,
      platformFundedDiscount: pricingSnapshot.platformFundedDiscount || 0,
      platformFeeRate: pricingSnapshot.platformFeeRate || 0,
      platformFee: pricingSnapshot.platformFee || 0,
      protectionFee: pricingSnapshot.protectionFee || 0,
      insuranceCostAllocation: pricingSnapshot.insuranceCostAllocation || 0,
      paymentFeeEstimate: pricingSnapshot.paymentFeeEstimate || 0,
      cleanerBaseIncome: pricingSnapshot.cleanerBaseIncome || 0,
      cleanerIncome: pricingSnapshot.cleanerIncome || 0,
      platformSubsidy: pricingSnapshot.platformSubsidy || 0,
      cashGrossMargin: pricingSnapshot.cashGrossMargin || 0,
      cashBurn: pricingSnapshot.cashBurn || 0,
      pricingSnapshot,
      protectionPlanId: protectionPlan._id || protectionPlan.planCode || "trial-basic",
      protectionSnapshot: protectionPlanSnapshot(protectionPlan),
      serviceStandardSnapshot: serviceStandardSnapshot(serviceStandard, data.serviceType),
      afterSaleStatus: "",
      activeClaimId: "",
      claimCount: 0,
      lastClaimAt: "",
      paymentStatus: "unpaid",
      settlementStatus: "pending",
      opsState: "CREATED",
      status,
      responses: [],
      declineHistory: [],
      createdAt,
      updatedAt: createdAt,
    },
  });
  await recordBehaviorGraphEdge({
    sourceType: "user",
    sourceId: openid,
    targetType: "order",
    targetId: result._id,
    edgeType: "order_created",
    orderId: result._id,
    occurredAt: createdAt,
    metadata: { serviceType: data.serviceType, publishMode: data.publishMode },
  });
  const risk = await calculateAndStoreOrderRisk({
    _id: result._id,
    customerOpenid: openid,
    acceptedCleanerOpenid: "",
    assignedCleanerOpenid: data.publishMode === "assigned" ? data.assignedCleanerOpenid : "",
    cleanerId: "",
    serviceType: data.serviceType,
    status,
    publishMode: data.publishMode,
    city: locationSnapshot.city,
    district: locationSnapshot.district,
    createdAt,
    updatedAt: createdAt,
  });
  await db.collection("orders").doc(result._id).update({ data: orderRiskPublicFields(risk) });
  return ok({ orderId: result._id, risk: orderRiskPublicFields(risk) });
}

async function listOpenOrders(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "cleaner");
  const cleaner = await getCleaner(openid);
  const cleanerLocation = data.cleanerLocation || (cleaner && (cleaner.workLocation || cleaner.lastLocation)) || {};
  const scope = data.scope === "all" ? "all" : "nearby";
  const result = await db
    .collection("orders")
    .where({ publishMode: "public" })
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();

  let orders = result.data.filter(
    (order) =>
      ["waiting_response", "waiting_confirm", "pending"].includes(order.status) &&
      !(order.responses || []).some((item) => item.cleanerId === openid)
  );
  if (data.serviceType) {
    orders = orders.filter((order) => order.serviceType === data.serviceType);
  }
  if (data.community) {
    orders = orders.filter((order) =>
      `${order.community || ""}${order.addressText || ""}`.includes(data.community)
    );
  }
  if (data.scheduledDate) {
    orders = orders.filter((order) => String(order.scheduledAt || "").startsWith(data.scheduledDate));
  }
  if (scope === "nearby") {
    orders = orders.filter((order) => openOrderLocationMatch(order, cleanerLocation));
  }
  const riskProfiles = await getCollectionData("orderRiskProfile").catch(() => []);
  const riskByOrderId = new Map(riskProfiles.map((risk) => [risk.orderId, risk]));
  orders = orders.filter((order) => !shouldHideOpenOrderByRisk(riskByOrderId.get(order._id) || order));
  return ok(
    orders.map((order) =>
      publicOrderForViewer(
        {
          ...order,
          ...publicOrderLocationFlag(order, cleanerLocation),
          cleanerReferenceLocation: cleanerLocation,
        },
        openid
      )
    )
  );
}

async function listAssignedOrders() {
  const openid = getOpenid();
  await requireUserRole(openid, "cleaner");
  const result = await db
    .collection("orders")
    .where({ publishMode: "assigned", assignedCleanerOpenid: openid })
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();
  return ok(
    result.data
      .filter((order) => ["assigned_waiting_accept", "pending"].includes(order.status))
      .map((order) => publicOrderForViewer(order, openid))
  );
}

async function listMyOrders() {
  const openid = getOpenid();
  const user = await ensureUser(openid);
  if (user.role === "customer") {
    const customerOrders = await db
      .collection("orders")
      .where({ customerOpenid: openid })
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    const orders = await attachReviewInfoList(customerOrders.data);
    return ok(orders.filter((order) => !order.hiddenForCustomer).map((order) => publicOrderForViewer(order, openid)));
  }
  if (user.role === "cleaner") {
    const acceptedOrders = await db
      .collection("orders")
      .where({ acceptedCleanerOpenid: openid })
      .orderBy("updatedAt", "desc")
      .limit(100)
      .get();
    const assignedOrders = await db
      .collection("orders")
      .where({ assignedCleanerOpenid: openid })
      .orderBy("updatedAt", "desc")
      .limit(100)
      .get();
    const publicOrders = await db
      .collection("orders")
      .where({ publishMode: "public", status: "waiting_confirm" })
      .orderBy("updatedAt", "desc")
      .limit(100)
      .get();
    const byId = {};
    acceptedOrders.data.concat(assignedOrders.data).forEach((order) => {
      byId[order._id] = order;
    });
    publicOrders.data
      .filter((order) => (order.responses || []).some((item) => item.cleanerId === openid))
      .forEach((order) => {
        byId[order._id] = order;
      });
    const cleanerOrders = await attachReviewInfoList(
      Object.values(byId).sort((first, second) => new Date(second.updatedAt) - new Date(first.updatedAt))
    );
    return ok(cleanerOrders.filter((order) => !order.hiddenForCleaner).map((order) => publicOrderForViewer(order, openid)));
  }
  throw AppError("请先选择账号身份");
}

async function acceptOrder(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "cleaner");
  const order = await getOrder(data.orderId);
  const cleaner = await getCleaner(openid);
  assertCleanerCanAccept(order, cleaner);
  await assertRiskAllowsCleanerAction(order, cleaner, openid);

  const acceptedAt = now();
  if (order.publishMode === "public") {
    const responses = order.responses || [];
    if (responses.some((response) => response.cleanerId === openid)) {
      throw AppError("你已响应过该订单，请等待用户确认");
    }
    const pricing = calculateOrderPricing(order);
    responses.push({
      cleanerId: openid,
      cleanerName: cleaner.displayName || "家洁师",
      avatarText: cleaner.displayName ? cleaner.displayName.slice(0, 1) : "洁",
      avatar: cleanerAvatarUrlOf(cleaner),
      avatarUrl: cleanerAvatarUrlOf(cleaner),
      rating: Number(cleaner.ratingAvg || 0),
      completedOrders: Number(cleaner.completedOrderCount || 0),
      distance: cleaner.distanceKm || "",
      responseTime: acceptedAt,
      quotedAmount: pricing.orderAmount,
      platformFee: pricing.platformFee,
      cleanerIncome: pricing.cleanerIncome,
      status: "pending",
    });
    await db.collection("orders").doc(data.orderId).update({
      data: {
        status: "waiting_confirm",
        responses,
        updatedAt: acceptedAt,
      },
    });
    await recordBehaviorGraphEdge({
      sourceType: "user",
      sourceId: order.customerOpenid,
      targetType: "cleaner",
      targetId: openid,
      edgeType: "order_response",
      orderId: data.orderId,
      occurredAt: acceptedAt,
      metadata: { publishMode: order.publishMode, status: "waiting_confirm" },
    });
    return ok({ orderId: data.orderId, status: "waiting_confirm" });
  }

  await db.collection("orders").doc(data.orderId).update({
    data: {
      status: "waiting_payment",
      paymentStatus: "pending_pay",
      acceptedCleanerOpenid: openid,
      cleanerId: openid,
      acceptedAt,
      updatedAt: acceptedAt,
    },
  });
  await recordBehaviorGraphEdge({
    sourceType: "user",
    sourceId: order.customerOpenid,
    targetType: "cleaner",
    targetId: openid,
    edgeType: "assigned_accept",
    orderId: data.orderId,
    occurredAt: acceptedAt,
    metadata: { publishMode: order.publishMode, status: "waiting_payment" },
  });
  return ok({ orderId: data.orderId, status: "waiting_payment", paymentStatus: "pending_pay" });
}

async function selectOrderResponse(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "customer");
  const order = await getOrder(data.orderId);
  if (!order) {
    throw AppError("订单不存在");
  }
  if (order.customerOpenid !== openid) {
    throw AppError("只有订单发布人可以选择家洁师");
  }
  if (!["waiting_confirm", "pending"].includes(order.status)) {
    throw AppError("当前订单不能选择家洁师");
  }
  const responses = order.responses || [];
  const selected = responses.find((response) => response.cleanerId === data.cleanerId);
  if (!selected) {
    throw AppError("请选择已响应的家洁师");
  }
  const updatedAt = now();
  const nextResponses = responses.map((response) => ({
    ...response,
    status: response.cleanerId === data.cleanerId ? "selected" : "rejected",
  }));
  await db.collection("orders").doc(data.orderId).update({
    data: {
      responses: nextResponses,
      status: "waiting_payment",
      paymentStatus: "pending_pay",
      acceptedCleanerOpenid: data.cleanerId,
      cleanerId: data.cleanerId,
      acceptedAt: updatedAt,
      updatedAt,
    },
  });
  return ok({ orderId: data.orderId, status: "waiting_payment", paymentStatus: "pending_pay" });
}

async function mockPayOrder(data) {
  const openid = getOpenid();
  assertActionAllowedInProduction("mockPayOrder", data);
  await requireUserRole(openid, "customer");
  const order = await getOrder(data.orderId);
  if (!order) {
    throw AppError("订单不存在");
  }
  if (order.customerOpenid !== openid) {
    throw AppError("只有订单发布人可以支付");
  }
  if (order.status !== "waiting_payment" || normalizePaymentStatus(order) !== "pending_pay") {
    throw AppError("当前订单不需要支付");
  }
  if (!order.acceptedCleanerOpenid) {
    throw AppError("请先选择家洁师");
  }

  const paidAt = now();
  await db.collection("orders").doc(data.orderId).update({
    data: {
      status: "confirmed",
      paymentStatus: "escrowed",
      settlementStatus: "escrowed",
      paidAt,
      updatedAt: paidAt,
    },
  });
  await ensureConversation({ ...order, _id: data.orderId, status: "confirmed" });
  await writeAuditLog({
    actorOpenid: openid,
    actorRole: "customer",
    action: "mockPayOrder",
    targetType: "order",
    targetId: data.orderId,
    before: { status: order.status, paymentStatus: normalizePaymentStatus(order) },
    after: { status: "confirmed", paymentStatus: "escrowed" },
    metadata: { appEnv: getAppEnv() || "default-production" },
  });
  return ok({ orderId: data.orderId, status: "confirmed", paymentStatus: "escrowed" });
}

async function declineAssignedOrder(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "cleaner");
  const order = await getOrder(data.orderId);
  if (!["assigned_waiting_accept", "pending"].includes(order.status) || order.publishMode !== "assigned") {
    throw AppError("只有待处理的指派订单可以拒绝");
  }
  if (order.assignedCleanerOpenid !== openid) {
    throw AppError("只有被指派的家洁师可以拒绝");
  }
  const declinedAt = now();
  await db.collection("orders").doc(data.orderId).update({
    data: {
      status: "assigned_declined",
      assignedCleanerOpenid: "",
      declineHistory: _.push({
        cleanerOpenid: openid,
        declinedAt,
        declineReason: data.declineReason || "",
      }),
      updatedAt: declinedAt,
    },
  });
  return ok({ orderId: data.orderId });
}

async function assignCleaner(data) {
  return updateOrderPublishMode({
    ...data,
    publishMode: "assigned",
    assignedCleanerOpenid: data.assignedCleanerOpenid || data.cleanerId || "",
  });
}

async function updateOrderPublishMode(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "customer");
  const order = await getOrder(data.orderId);
  if (!order) {
    throw AppError("订单不存在");
  }
  if (order.customerOpenid !== openid) {
    throw AppError("只有订单客户可以修改发布方式");
  }
  if (!["waiting_response", "waiting_confirm", "assigned_declined", "pending"].includes(order.status)) {
    throw AppError("只有待响应或已拒绝的订单可以修改发布方式");
  }
  if (!["public", "assigned"].includes(data.publishMode)) {
    throw AppError("发布方式不正确");
  }

  const updateData = {
    publishMode: data.publishMode,
    updatedAt: now(),
  };

  if (data.publishMode === "public") {
    updateData.assignedCleanerOpenid = "";
    updateData.status = "waiting_response";
    updateData.responses = [];
  } else {
    if (!data.assignedCleanerOpenid) {
      throw AppError("请选择指派家洁师");
    }
    const cleaner = await getCleaner(data.assignedCleanerOpenid);
    if (!cleaner || !cleaner.manualApproved || !cleaner.available) {
      throw AppError("指派家洁师暂不可预约");
    }
    await assertCleanerAssignable(order, data.assignedCleanerOpenid, cleaner);
    const favorite = await findOne("favorites", {
      customerOpenid: openid,
      cleanerOpenid: data.assignedCleanerOpenid,
    });
    if (!favorite) {
      throw AppError("只能重新指派已收藏家洁师");
    }
    updateData.assignedCleanerOpenid = data.assignedCleanerOpenid;
    updateData.status = "assigned_waiting_accept";
    updateData.responses = [];
  }

  await db.collection("orders").doc(data.orderId).update({ data: updateData });
  if (data.publishMode === "assigned") {
    await recordBehaviorGraphEdge({
      sourceType: "user",
      sourceId: order.customerOpenid,
      targetType: "cleaner",
      targetId: data.assignedCleanerOpenid,
      edgeType: "order_assigned",
      orderId: data.orderId,
      occurredAt: updateData.updatedAt,
      metadata: { status: "assigned_waiting_accept" },
    });
  }
  return ok({ orderId: data.orderId, publishMode: data.publishMode });
}

async function updateOrderStatus(data) {
  const openid = getOpenid();
  const order = await getOrder(data.orderId);
  const nextStatus = data.status === "waiting_acceptance" ? "waiting_complete" : data.status;
  assertStatusTransition(order, nextStatus, openid, data);
  const updateTime = now();
  if (nextStatus === "completed") {
    await completeOrderWithReview(
      order,
      {
        rating: data.rating,
        content: data.content || "",
        imageUrls: normalizeReviewImageUrls(data.imageUrls),
        source: "manual",
      },
      { completedAt: updateTime }
    );
    await writeAuditLog({
      actorOpenid: openid,
      actorRole: "customer",
      action: "updateOrderStatus",
      targetType: "order",
      targetId: data.orderId,
      before: { status: order.status, paymentStatus: normalizePaymentStatus(order) },
      after: { status: nextStatus, paymentStatus: "settled" },
      metadata: { nextStatus },
    });
    return ok({ orderId: data.orderId, status: nextStatus });
  }
  const statusTime = {};
  if (nextStatus === "cancelled") statusTime.cancelledAt = updateTime;
  if (nextStatus === "in_service") {
    statusTime.startedAt = updateTime;
    statusTime.opsState = "IN_SERVICE";
  }
  if (nextStatus === "waiting_complete") {
    const completionPhotoUrls = normalizeReviewImageUrls(data.completionPhotoUrls || data.completionImageUrls || data.serviceProofImageUrls);
    statusTime.serviceFinishedAt = updateTime;
    statusTime.serviceCompletedAt = updateTime;
    statusTime.completedSubmitAt = updateTime;
    statusTime.completionPhotoUrls = completionPhotoUrls;
    statusTime.completionImageUrls = completionPhotoUrls;
    statusTime.completionPhotos = completionPhotoUrls.map((fileID) => ({
      fileID,
      url: fileID,
      uploadedAt: updateTime,
    }));
    statusTime.opsState = "COMPLETED";
  }
  await db.collection("orders").doc(data.orderId).update({
    data: {
      status: nextStatus,
      ...statusPaymentPatch(nextStatus, order),
      ...statusTime,
      updatedAt: updateTime,
    },
  });
  if (["cancelled", "in_service", "waiting_complete"].includes(nextStatus)) {
    await writeAuditLog({
      actorOpenid: openid,
      actorRole: openid === order.customerOpenid ? "customer" : "cleaner",
      action: "updateOrderStatus",
      targetType: "order",
      targetId: data.orderId,
      before: { status: order.status, paymentStatus: normalizePaymentStatus(order) },
      after: { status: nextStatus, paymentStatus: statusPaymentPatch(nextStatus, order).paymentStatus || normalizePaymentStatus(order) },
      metadata: { nextStatus },
    });
  }
  return ok({ orderId: data.orderId, status: nextStatus });
}

async function hideOrderForRole(data) {
  const openid = getOpenid();
  const user = await ensureUser(openid);
  const role = data.role === "cleaner" || data.role === "customer" ? data.role : user.role;
  const order = await getOrder(data.orderId);
  if (!order) {
    throw AppError("订单不存在");
  }
  if (!canHideOrderForRole(order, role)) {
    throw AppError(role === "cleaner" ? "当前订单不可归档" : "当前订单不可删除");
  }
  if (role === "customer" && order.customerOpenid !== openid) {
    throw AppError("只能删除自己的订单");
  }
  const isCleanerOrder =
    order.acceptedCleanerOpenid === openid ||
    order.assignedCleanerOpenid === openid ||
    order.cleanerId === openid ||
    (order.responses || []).some((response) => response.cleanerId === openid);
  if (role === "cleaner" && !isCleanerOrder) {
    throw AppError("只能归档自己的订单");
  }

  const hiddenAt = now();
  await db.collection("orders").doc(data.orderId).update({
    data:
      role === "cleaner"
        ? { hiddenForCleaner: true, hiddenForCleanerAt: hiddenAt, updatedAt: hiddenAt }
        : { hiddenForCustomer: true, hiddenForCustomerAt: hiddenAt, updatedAt: hiddenAt },
  });
  await writeAuditLog({
    actorOpenid: openid,
    actorRole: role,
    action: "hideOrderForRole",
    targetType: "order",
    targetId: data.orderId,
    before: { hiddenForCustomer: Boolean(order.hiddenForCustomer), hiddenForCleaner: Boolean(order.hiddenForCleaner), status: order.status },
    after: role === "cleaner" ? { hiddenForCleaner: true } : { hiddenForCustomer: true },
    metadata: { role },
  });
  return ok({ orderId: data.orderId, role, hidden: true });
}

async function migrateOrderPaymentStatus(data = {}) {
  const openid = getOpenid();
  await requireAdmin(openid);
  assertActionAllowedInProduction("migrateOrderPaymentStatus", data);
  const limit = Math.min(Math.max(Number(data.limit || 100), 1), 100);
  const result = await db.collection("orders").orderBy("createdAt", "desc").limit(limit).get();
  const migratedOrderIds = [];
  for (const order of result.data) {
    if (order.paymentStatus) continue;
    const paymentStatus = normalizePaymentStatus(order);
    await db.collection("orders").doc(order._id).update({
      data: {
        paymentStatus,
        settlementStatus: paymentStatus === "settled" ? "settled" : paymentStatus === "escrowed" ? "escrowed" : "pending",
        updatedAt: now(),
      },
    });
    migratedOrderIds.push(order._id);
  }
  await writeAuditLog({
    actorOpenid: openid,
    actorRole: "admin",
    action: "migrateOrderPaymentStatus",
    targetType: "orders",
    metadata: { checkedCount: result.data.length, migratedCount: migratedOrderIds.length, migratedOrderIds },
  });
  return ok({ checkedCount: result.data.length, migratedCount: migratedOrderIds.length, migratedOrderIds });
}

async function updateCleanerAvailability(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "cleaner");
  const cleaner = await ensureCleanerProfile(openid);
  const available = Boolean(data.available);
  const updateData = { available, updatedAt: now() };
  const lastLocation = available ? normalizeLastLocation(data.lastLocation) : null;
  if (lastLocation) {
    updateData.lastLocation = lastLocation;
  }
  await db.collection("cleaners").doc(cleaner._id).update({
    data: updateData,
  });
  await writeAuditLog({
    actorOpenid: openid,
    actorRole: "cleaner",
    action: "updateCleanerAvailability",
    targetType: "cleaner",
    targetId: cleaner._id,
    before: { available: Boolean(cleaner.available) },
    after: { available },
  });
  const updatedCleaner = await withCleanerStats(await getCleaner(openid), { canViewContact: true });
  return ok({ cleaner: updatedCleaner, cleanerProfile: updatedCleaner });
}

async function updateCleanerLocation(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "cleaner");
  const cleaner = await ensureCleanerProfile(openid);
  const lastLocation = normalizeLastLocation(data.lastLocation || data);
  if (!lastLocation) {
    return ok({ cleaner: await withCleanerStats(cleaner, { canViewContact: true }) });
  }
  await db.collection("cleaners").doc(cleaner._id).update({
    data: { lastLocation, updatedAt: now() },
  });
  return ok({ cleaner: await withCleanerStats(await getCleaner(openid), { canViewContact: true }) });
}

async function listCleaners(data) {
  await requireUserRole(getOpenid(), "customer");
  const result = await db
    .collection("cleaners")
    .where({ manualApproved: true, available: true })
    .orderBy("ratingAvg", "desc")
    .limit(100)
    .get();
  let cleaners = result.data;
  if (data.community) {
    cleaners = cleaners.filter((cleaner) =>
      (cleaner.serviceAreas || []).some((area) => area.includes(data.community) || data.community.includes(area))
    );
  }
  if (data.city) {
    cleaners = filterRecommendedCleanersByCity(cleaners, { city: data.city });
  }
  if (data.serviceType) {
    cleaners = cleaners.filter((cleaner) => (cleaner.serviceTypes || []).includes(data.serviceType));
  }
  const enriched = [];
  for (const cleaner of cleaners) {
    const cleanerId = cleaner._openid || cleaner.cleanerId || "";
    const trust = cleanerId ? await getCleanerTrustProfile(cleanerId, cleaner).catch(() => null) : null;
    if (trust && (trust.trustLevel === "blocked" || trust.blocked === true)) continue;
    enriched.push({
      cleaner: await withCleanerStats(cleaner),
      rankingDown: Boolean(trust && (trust.rankingDown || Number(trust.trustScore || 0) < 50)),
      trustScore: trust ? Number(trust.trustScore || 0) : 80,
    });
  }
  enriched.sort(
    (first, second) =>
      Number(first.rankingDown) - Number(second.rankingDown) ||
      second.trustScore - first.trustScore ||
      Number(second.cleaner.ratingAvg || 0) - Number(first.cleaner.ratingAvg || 0)
  );
  return ok(enriched.map((item) => item.cleaner));
}

async function getCleanerDetail(data) {
  const viewerOpenid = getOpenid();
  const viewerUser = await ensureUser(viewerOpenid);
  const cleaner = await getCleaner(data.cleanerOpenid);
  if (!cleaner) {
    throw AppError("家洁师资料不存在");
  }
  const viewerIsAdmin = await isAdmin(viewerOpenid);
  const enrichedCleaner = await withCleanerStats(cleaner, {
    canViewContact: viewerIsAdmin || cleaner._openid === viewerOpenid,
  });
  const recentReviews = await listVisibleCleanerReviews(data.cleanerOpenid, 3);
  const favorite = await findOne("favorites", {
    customerOpenid: viewerOpenid,
    cleanerOpenid: data.cleanerOpenid,
  });
  const canEdit = Boolean(viewerUser && viewerUser.role === "cleaner" && cleaner._openid === viewerOpenid);
  return ok({
    cleaner: enrichedCleaner,
    recentReviews,
    saved: Boolean(favorite),
    viewerOpenid,
    viewerRole: viewerUser ? viewerUser.role : "",
    canEdit,
  });
}

async function updateCleanerProfile(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "cleaner");
  const cleaner = await ensureCleanerProfile(openid);

  const nextData = {
    updatedAt: now(),
  };
  if (data.avatarUrl !== undefined) nextData.avatarUrl = data.avatarUrl;
  if (data.displayName !== undefined) {
    const displayName = String(data.displayName || "").trim();
    if (!displayName) throw AppError("请填写昵称");
    nextData.displayName = displayName.slice(0, 24);
  }
  if (data.phone !== undefined) nextData.phone = String(data.phone || "").slice(0, 20);
  if (Array.isArray(data.serviceAreas)) nextData.serviceAreas = data.serviceAreas.slice(0, 8);
  if (Array.isArray(data.serviceTypes)) nextData.serviceTypes = data.serviceTypes.slice(0, 8);

  await db.collection("cleaners").doc(cleaner._id).update({ data: nextData });
  const updatedCleaner = await withCleanerStats(await getCleaner(openid), { canViewContact: true });
  return ok({ cleaner: updatedCleaner, cleanerProfile: updatedCleaner });
}

async function saveCleaner(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "customer");
  if (!data.cleanerOpenid) {
    throw AppError("缺少家洁师 ID");
  }
  const cleaner = await getCleaner(data.cleanerOpenid);
  if (!cleaner || !cleaner.manualApproved) {
    throw AppError("家洁师资料暂不可收藏");
  }
  const favorite = await findOne("favorites", { customerOpenid: openid, cleanerOpenid: data.cleanerOpenid });
  const shouldSave = data.saved === undefined ? !favorite : Boolean(data.saved);
  if (shouldSave && !favorite) {
    await db.collection("favorites").add({
      data: { customerOpenid: openid, cleanerOpenid: data.cleanerOpenid, createdAt: now() },
    });
  }
  if (!shouldSave && favorite) {
    await db.collection("favorites").doc(favorite._id).remove();
  }
  return ok({ saved: shouldSave });
}

async function listSavedCleaners() {
  const openid = getOpenid();
  await requireUserRole(openid, "customer");
  const favorites = await db.collection("favorites").where({ customerOpenid: openid }).limit(100).get();
  const cleaners = [];
  for (const favorite of favorites.data) {
    const cleaner = await getCleaner(favorite.cleanerOpenid);
    if (!cleaner) continue;
    const recent = await db
      .collection("orders")
      .where({ customerOpenid: openid, acceptedCleanerOpenid: favorite.cleanerOpenid })
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();
    cleaners.push({
      ...(await withCleanerStats(cleaner)),
      favoriteId: favorite._id,
      lastOrder: recent.data[0] || null,
    });
  }
  return ok(cleaners);
}

async function getOrderDetail(data) {
  const openid = getOpenid();
  const order = await getOrder(data.orderId);
  if (!order) {
    throw AppError("订单不存在");
  }

  const user = await ensureUser(openid);
  const viewerIsAdmin = await isAdmin(openid);
  const isCustomer = order.customerOpenid === openid;
  const isAcceptedCleaner = order.acceptedCleanerOpenid === openid;
  const isAssignedCleaner = order.assignedCleanerOpenid === openid;
  const hasResponse = (order.responses || []).some((response) => response.cleanerId === openid);
  let canView = viewerIsAdmin || isCustomer || isAcceptedCleaner || isAssignedCleaner || hasResponse;
  if (
    !canView &&
    user.role === "cleaner" &&
    order.publishMode === "public" &&
    ["waiting_response", "waiting_confirm", "pending"].includes(order.status)
  ) {
    const viewerCleaner = await getCleaner(openid);
    canView = Boolean(viewerCleaner && viewerCleaner.manualApproved && viewerCleaner.available);
  }
  if (!canView) {
    throw AppError("无权查看该订单");
  }

  let cleaner = null;
  if (order.acceptedCleanerOpenid || order.assignedCleanerOpenid) {
    const cleanerOpenid = order.acceptedCleanerOpenid || order.assignedCleanerOpenid;
    cleaner = await withCleanerStats(await getCleaner(cleanerOpenid), {
      canViewContact: canViewCleanerContact(order, openid, cleanerOpenid, { isAdmin: viewerIsAdmin }),
    });
  }
  const customerProfile = await getCustomerProfile(order.customerOpenid).catch(() => null);
  const viewerCanViewCustomerContact = canViewCustomerContact(order, openid, { isAdmin: viewerIsAdmin });
  const customerProfileForViewer =
    viewerIsAdmin || isCustomer
      ? privateCustomerProfileForOwner(customerProfile)
      : viewerCanViewCustomerContact && isAcceptedCleaner
        ? fulfillmentCustomerProfile(customerProfile)
        : publicCustomerProfile(customerProfile);
  const review = await findOne("reviews", { orderId: data.orderId });
  const manualReview = publicOrderReview(review);
  const reviewCanEdit = isManualReview(review) ? canEditReview(review, now()) : false;
  const savedCleaner =
    isCustomer && (order.acceptedCleanerOpenid || order.assignedCleanerOpenid)
      ? await findOne("favorites", {
          customerOpenid: openid,
          cleanerOpenid: order.acceptedCleanerOpenid || order.assignedCleanerOpenid,
        })
      : null;
  const orderWithReview = manualReview
    ? { ...order, reviewId: manualReview._id, hasReview: true, canEditReview: reviewCanEdit }
    : { ...order, reviewId: "", hasReview: false, canEditReview: false };
  return ok({
    order: publicOrderForViewer(orderWithReview, openid, { isAdmin: viewerIsAdmin }),
    cleaner,
    customerProfile: customerProfileForViewer,
    review: manualReview,
    canEditReview: reviewCanEdit,
    savedCleaner: Boolean(savedCleaner),
    viewerOpenid: openid,
  });
}

async function listConversations() {
  const openid = getOpenid();
  const user = await ensureUser(openid);
  if (!["customer", "cleaner"].includes(user.role)) {
    throw AppError("\u8bf7\u5148\u9009\u62e9\u8d26\u53f7\u8eab\u4efd");
  }
  const field = user.role === "customer" ? "customerOpenid" : "cleanerOpenid";
  const result = await db
    .collection("conversations")
    .where({ [field]: openid })
    .orderBy("updatedAt", "desc")
    .limit(100)
    .get();

  const list = [];
  const seenKeys = new Set();
  for (const conversation of result.data) {
    const orderId = conversation.latestOrderId || conversation.orderId || (conversation.orderIds || []).slice(-1)[0];
    const order = await getOrder(orderId).catch(() => null);
    const pairKey =
      conversation.participantKey ||
      (order && order.customerOpenid && (conversation.cleanerOpenid || order.acceptedCleanerOpenid)
        ? participantKey(order.customerOpenid, conversation.cleanerOpenid || order.acceptedCleanerOpenid)
        : conversation._id);
    if (seenKeys.has(pairKey)) continue;
    seenKeys.add(pairKey);

    const otherOpenid =
      user.role === "customer"
        ? conversation.cleanerOpenid || (order && order.acceptedCleanerOpenid)
        : conversation.customerOpenid || (order && order.customerOpenid);
    const otherCleaner = user.role === "customer" && otherOpenid ? await getCleaner(otherOpenid) : null;
    const otherCustomer = user.role === "cleaner" && otherOpenid ? await getCustomerProfile(otherOpenid) : null;
    const otherAvatarUrl =
      user.role === "customer"
        ? cleanerAvatarUrlOf(otherCleaner)
        : (otherCustomer && otherCustomer.avatarUrl) || "";
    const otherName =
      user.role === "customer"
        ? (otherCleaner && otherCleaner.displayName) || "\u5bb6\u6d01\u5e08"
        : (otherCustomer && otherCustomer.nickname) || "\u90bb\u91cc\u7528\u6237";
    const lastMessage =
      conversation.lastMessageType === "order_card" && order
        ? `\u65b0\u8ba2\u5355\uff1a${order.serviceType || conversation.serviceType || "\u4fdd\u6d01\u670d\u52a1"} · ${normalizeOrderStatus(order.status)}`
        : conversation.lastMessage || "\u6682\u65e0\u6d88\u606f";

    list.push({
      ...conversation,
      order,
      participantKey: pairKey,
      lastMessage,
      otherName,
      otherAvatarUrl,
      otherAvatarText: otherName.slice(0, 1),
      unreadCount: user.role === "customer" ? conversation.unreadByCustomer || 0 : conversation.unreadByCleaner || 0,
    });
  }
  return ok(list);
}
async function getConversationByOrder(data) {
  const openid = getOpenid();
  console.log("[getConversationByOrder] start", {
    orderId: data.orderId,
    openid,
  });
  const order = await getOrder(data.orderId);
  if (!order) {
    throw AppError("订单不存在");
  }
  const canContact = order.customerOpenid === openid || order.acceptedCleanerOpenid === openid;
  if (!canContact) {
    throw AppError("无权查看该会话");
  }

  if (!CONTACT_STATUSES.includes(order.status)) {
    throw AppError("订单未接单，暂不能联系家洁师");
  }

  const key = participantKey(order.customerOpenid, order.acceptedCleanerOpenid);
  const existed =
    (await findOne("conversations", { participantKey: key })) ||
    (await findOne("conversations", { orderId: data.orderId }));
  console.log("[getConversationByOrder] conversation missing, creating", {
    orderId: data.orderId,
    status: order.status,
    customerOpenid: order.customerOpenid,
    acceptedCleanerOpenid: order.acceptedCleanerOpenid,
    existed: Boolean(existed),
  });
  const conversation = await ensureConversation({ ...order, _id: data.orderId });

  console.log("[getConversationByOrder] conversation result", conversation);

  if (!conversation) {
    throw AppError("会话创建失败，请稍后重试");
  }

  return ok({ conversation });
}

async function listMessages(data) {
  const openid = getOpenid();
  const conversation = await findOne("conversations", { _id: data.conversationId });
  if (!conversation) {
    throw AppError("会话未找到，请从订单重新进入");
  }
  if (conversation.customerOpenid !== openid && conversation.cleanerOpenid !== openid) {
    throw AppError("无权查看该会话");
  }
  const result = await db
    .collection("messages")
    .where({ conversationId: data.conversationId })
    .orderBy("createdAt", "asc")
    .limit(100)
    .get();
  const customer = await getCustomerProfile(conversation.customerOpenid);
  const cleaner = await getCleaner(conversation.cleanerOpenid);
  const customerName = (customer && customer.nickname) || "邻里用户";
  const cleanerName = (cleaner && cleaner.displayName) || "家洁师";
  return ok({
    conversation: {
      ...conversation,
      customerName,
      cleanerName,
      customerAvatarUrl: (customer && customer.avatarUrl) || "",
      cleanerAvatarUrl: cleanerAvatarUrlOf(cleaner),
      customerAvatarText: customerName.slice(0, 1),
      cleanerAvatarText: cleanerName.slice(0, 1),
    },
    messages: result.data,
  });
}

async function sendMessage(data) {
  const openid = getOpenid();
  const conversation = await findOne("conversations", { _id: data.conversationId });
  if (!conversation) {
    throw AppError("会话未找到，请从订单重新进入");
  }
  const isCustomer = conversation.customerOpenid === openid;
  const isCleaner = conversation.cleanerOpenid === openid;
  if (!isCustomer && !isCleaner) {
    throw AppError("无权发送消息");
  }
  const type = ["text", "image", "voice"].includes(data.type) ? data.type : "text";
  const content = String(data.content || "").trim();
  const imageUrl = String(data.imageUrl || "").trim();
  const voiceFileID = String(data.voiceFileID || data.fileID || data.voiceUrl || "").trim();
  const voiceUrl = String(data.voiceUrl || voiceFileID).trim();
  const duration = Math.max(0, Math.round(Number(data.duration || 0)));
  if (type === "text" && !content) {
    throw AppError("请输入消息内容");
  }
  if (type === "image" && !imageUrl) {
    throw AppError("图片发送失败，请重试");
  }
  if (type === "voice" && !voiceUrl) {
    throw AppError("语音发送失败，请重试");
  }
  const createdAt = now();
  const lastMessage = type === "image" ? "[图片]" : type === "voice" ? `[语音] ${duration || ""}秒` : content.slice(0, 80);
  await db.collection("messages").add({
    data: {
      conversationId: data.conversationId,
      type,
      orderId: conversation.latestOrderId || conversation.orderId || "",
      senderOpenid: openid,
      receiverOpenid: isCustomer ? conversation.cleanerOpenid : conversation.customerOpenid,
      content: content.slice(0, 500),
      imageUrl,
      fileID: type === "voice" ? voiceFileID : "",
      voiceFileID,
      voiceUrl,
      duration,
      senderId: openid,
      senderRole: isCustomer ? "customer" : "cleaner",
      createdAt,
    },
  });
  await db.collection("conversations").doc(conversation._id).update({
    data: {
      lastMessage,
      lastMessageType: type,
      lastMessageAt: createdAt,
      unreadByCustomer: isCustomer ? conversation.unreadByCustomer || 0 : Number(conversation.unreadByCustomer || 0) + 1,
      unreadByCleaner: isCleaner ? conversation.unreadByCleaner || 0 : Number(conversation.unreadByCleaner || 0) + 1,
      updatedAt: createdAt,
    },
  });
  return ok({ sent: true });
}

async function getIncomeStats() {
  const openid = getOpenid();
  await requireUserRole(openid, "cleaner");
  const completedOrders = (await listCleanerCompletedOrders(openid)).filter(isSettledIncomeOrder);
  const nowDate = now();
  const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
  const nextMonthStart = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 1);

  const orderIncome = completedOrders.reduce((sum, order) => sum + getOrderIncome(order), 0);
  const monthOrders = completedOrders.filter((order) => {
    if (!order.completedAt) return false;
    const completedAt = new Date(order.completedAt);
    return completedAt >= monthStart && completedAt < nextMonthStart;
  });
  const monthIncome = monthOrders.reduce((sum, order) => sum + getOrderIncome(order), 0);

  const recentDays = [];
  const recentDayMap = {};
  for (let index = 6; index >= 0; index -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - index);
    const key = day.toISOString().slice(0, 10);
    const item = { label: key.slice(5), amount: 0 };
    recentDays.push(item);
    recentDayMap[key] = item;
  }
  for (const order of completedOrders) {
    if (!order.completedAt) continue;
    const key = new Date(order.completedAt).toISOString().slice(0, 10);
    const item = recentDayMap[key];
    if (item) item.amount += getOrderIncome(order);
  }
  const incomeOrders = completedOrders.slice(0, 20).map((order) => ({
    ...order,
    incomeAmount: getOrderIncome(order),
  }));
  console.log(
    "[getIncomeStats] income orders",
    incomeOrders.map((order) => ({
      id: order._id,
      serviceType: order.serviceType,
      finalPrice: order.finalPrice,
      actualPrice: order.actualPrice,
      estimatedPrice: order.estimatedPrice,
      incomeAmount: order.incomeAmount,
    }))
  );
  return ok({
    monthIncome,
    completedCount: monthOrders.length,
    orderIncome,
    platformReward: 0,
    recentDays,
    orders: incomeOrders,
  });
}

async function listReceivedReviews() {
  const openid = getOpenid();
  await requireUserRole(openid, "cleaner");
  const result = await db.collection("reviews").where({ cleanerOpenid: openid }).limit(100).get();
  return ok(result.data.filter(isManualReview).map((review) => publicOrderReview(review, { includeServiceType: true })));
}

async function submitReview(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "customer");
  const order = await getOrder(data.orderId);
  const existingReview = await findOne("reviews", { orderId: data.orderId });
  const rating = Number(data.rating || 0);
  assertCompletionReviewInput({ rating });
  if (!order) throw AppError("订单不存在");

  const createdAt = now();
  if (existingReview && isManualReview(existingReview)) {
    if (existingReview.customerOpenid !== openid) throw AppError("只有下单客户可以修改评价");
    if (!canEditReview(existingReview, createdAt)) throw AppError("评价已超过可修改时间");
    await db.collection("reviews").doc(existingReview._id).update({
      data: {
        rating,
        content: data.content || "",
        imageUrls: normalizeReviewImageUrls(data.imageUrls),
        source: "manual",
        autoGenerated: false,
        editCount: Number(existingReview.editCount || 0) + 1,
        updatedAt: createdAt,
      },
    });
    await refreshCleanerStats(existingReview.cleanerOpenid || order.acceptedCleanerOpenid, createdAt);
    return ok({ orderId: data.orderId, reviewId: existingReview._id, edited: true });
  }

  assertReviewAllowed(order, openid, null);
  const reviewData = {
    orderId: data.orderId,
    customerOpenid: openid,
    cleanerOpenid: order.acceptedCleanerOpenid,
    serviceType: order.serviceType || "",
    rating,
    content: data.content || "",
    imageUrls: normalizeReviewImageUrls(data.imageUrls),
    source: "manual",
    autoGenerated: false,
    editCount: 0,
    createdAt,
    updatedAt: createdAt,
  };
  let reviewId = "";
  if (existingReview) {
    await db.collection("reviews").doc(existingReview._id).update({ data: reviewData });
    reviewId = existingReview._id;
  } else {
    const result = await db.collection("reviews").add({ data: reviewData });
    reviewId = result._id;
  }
  await db.collection("orders").doc(data.orderId).update({
    data: {
      reviewId,
      hasReview: true,
      updatedAt: createdAt,
    },
  });

  const cleaner = await getCleaner(order.acceptedCleanerOpenid);
  if (cleaner) {
    await refreshCleanerStats(order.acceptedCleanerOpenid, createdAt);
  }

  return ok({ orderId: data.orderId, reviewId });
}

async function createSupportTicket(data = {}) {
  const openid = getOpenid();
  const description = String(data.description || "").trim();
  if (!description) {
    throw AppError("请填写问题描述");
  }
  const viewerIsAdmin = await isAdmin(openid);
  const user = await ensureUser(openid);
  let orderId = "";
  if (data.orderId) {
    const order = await getOrder(data.orderId);
    if (!order) {
      throw AppError("订单不存在");
    }
    const canCreate =
      viewerIsAdmin ||
      order.customerOpenid === openid ||
      order.acceptedCleanerOpenid === openid ||
      order.assignedCleanerOpenid === openid;
    if (!canCreate) {
      throw AppError("无权为该订单提交工单", "FORBIDDEN");
    }
    orderId = data.orderId;
  }

  await safeCreateCollection("supportTickets");
  const createdAt = now();
  const result = await db.collection("supportTickets").add({
    data: {
      actorOpenid: openid,
      actorRole: viewerIsAdmin ? "admin" : user.role || user.currentRole || "",
      type: String(data.type || data.issueType || "general").trim().slice(0, 40),
      orderId,
      orderNo: String(data.orderNo || "").trim().slice(0, 80),
      description: description.slice(0, 1000),
      imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6) : [],
      status: "open",
      createdAt,
      updatedAt: createdAt,
    },
  });
  return ok({ ticketId: result._id, status: "open" });
}

function normalizeClaimType(type) {
  const claimType = String(type || "").trim();
  if (!CLAIM_TYPES.includes(claimType)) {
    throw AppError("售后类型不正确", "INVALID_INPUT");
  }
  return claimType;
}

function normalizeCleanerExceptionType(type) {
  const claimType = String(type || "cleaner_exception").trim();
  if (!["cleaner_exception", "safety_risk"].includes(claimType)) {
    throw AppError("异常报备类型不正确", "INVALID_INPUT");
  }
  return claimType;
}

function normalizeClaimDescription(description) {
  const text = String(description || "").trim();
  if (!text) {
    throw AppError("请填写问题描述", "INVALID_INPUT");
  }
  if (text.length > 1000) {
    throw AppError("问题描述过长", "INVALID_INPUT");
  }
  return text;
}

function normalizeClaimImages(value) {
  const images = Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (images.length > 6) {
    throw AppError("最多上传 6 张图片", "INVALID_INPUT");
  }
  return images;
}

function normalizeRequestedAmount(value) {
  if (value === undefined || value === null || value === "") return 0;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw AppError("申请金额必须为非负数", "INVALID_INPUT");
  }
  return roundMoney(amount);
}

function canCreateProtectionClaimForOrder(order, openid, context = {}) {
  if (context.isAdmin) return true;
  if (!order) return false;
  if (order.customerOpenid === openid) return true;
  return order.acceptedCleanerOpenid === openid && CONTACT_STATUSES.includes(order.status);
}

function canViewProtectionClaim(claim, order, openid, context = {}) {
  if (context.isAdmin) return true;
  if (!claim) return false;
  if (claim.claimantOpenid === openid) return true;
  if (!order) return false;
  if (order.customerOpenid === openid) return true;
  return order.acceptedCleanerOpenid === openid && CONTACT_STATUSES.includes(order.status);
}

function canReportCleanerException(order, openid, context = {}) {
  if (context.isAdmin) return true;
  if (!order) return false;
  return order.acceptedCleanerOpenid === openid || order.assignedCleanerOpenid === openid || order.cleanerId === openid;
}

function publicProtectionClaim(claim = {}) {
  const auditTrail = Array.isArray(claim.auditTrail)
    ? claim.auditTrail.slice(-20).map((item) => ({
        action: item.action || "",
        actorRole: item.actorRole || "",
        status: item.status || "",
        from: item.from || "",
        to: item.to || "",
        createdAt: item.createdAt || "",
      }))
    : [];
  return {
    _id: claim._id || "",
    orderId: claim.orderId || "",
    orderNo: claim.orderNo || "",
    claimNo: claim.claimNo || "",
    claimantRole: claim.claimantRole || "",
    claimType: claim.claimType || "",
    status: claim.status || "submitted",
    description: claim.description || "",
    imageFileIDs: Array.isArray(claim.imageFileIDs) ? claim.imageFileIDs.slice(0, 6) : [],
    requestedAmount: Number(claim.requestedAmount || 0),
    proposedResolution: claim.proposedResolution || "",
    resolutionNote: claim.resolutionNote || "",
    createdAt: claim.createdAt || "",
    updatedAt: claim.updatedAt || "",
    closedAt: claim.closedAt || "",
    auditTrail,
  };
}

async function listAllProtectionClaims() {
  const result = await db.collection("protectionClaims").orderBy("createdAt", "desc").limit(100).get().catch(() => ({ data: [] }));
  return result.data || [];
}

async function getProtectionClaim(claimId) {
  if (!claimId) throw AppError("缺少售后工单 ID", "INVALID_INPUT");
  const result = await db.collection("protectionClaims").doc(claimId).get().catch(() => ({ data: null }));
  return result.data ? { ...result.data, _id: result.data._id || claimId } : null;
}

function nextClaimNo(existingClaims, createdAt) {
  const dateCode = displayDateCode(createdAt);
  const sequence = String((existingClaims || []).length + 1).padStart(4, "0");
  return `CLM-${dateCode}-${sequence}`;
}

async function createProtectionClaimRecord({ order, actorOpenid, actorRole, claimType, description, imageFileIDs, requestedAmount, actionName }) {
  await safeCreateCollection("protectionClaims");
  const existingClaims = await listAllProtectionClaims();
  const createdAt = now();
  const claimNo = nextClaimNo(existingClaims, createdAt);
  const auditTrail = [
    {
      action: "submitted",
      actorOpenid,
      actorRole,
      status: "submitted",
      createdAt,
    },
  ];
  const result = await db.collection("protectionClaims").add({
    data: {
      orderId: order._id,
      orderNo: order.displayOrderNo || order.orderNo || "",
      claimNo,
      claimantOpenid: actorOpenid,
      claimantRole: actorRole,
      claimType,
      status: "submitted",
      description,
      imageFileIDs,
      requestedAmount,
      proposedResolution: "",
      resolutionNote: "",
      assignedAdminOpenid: "",
      createdAt,
      updatedAt: createdAt,
      closedAt: "",
      auditTrail,
    },
  });
  const claimId = result._id;
  const claimCount = Number(order.claimCount || 0) + 1;
  await db.collection("orders").doc(order._id).update({
    data: {
      afterSaleStatus: "submitted",
      activeClaimId: claimId,
      claimCount,
      lastClaimAt: createdAt,
      updatedAt: createdAt,
    },
  });
  await writeAuditLog({
    actorOpenid,
    actorRole,
    action: actionName,
    targetType: "protectionClaim",
    targetId: claimId,
    after: { orderId: order._id, claimType, status: "submitted", requestedAmount, claimCount },
    metadata: { orderId: order._id, claimNo, claimType },
  });
  await recordBehaviorGraphEdge({
    sourceType: actorRole || "user",
    sourceId: actorOpenid,
    targetType: "order",
    targetId: order._id,
    edgeType: "claim_submitted",
    orderId: order._id,
    claimId,
    occurredAt: createdAt,
    metadata: { claimType, actionName },
  });
  return { claimId, claimNo, status: "submitted" };
}

async function createProtectionClaim(data = {}) {
  const openid = getOpenid();
  const viewerIsAdmin = await isAdmin(openid);
  const user = await ensureUser(openid);
  const order = await getOrder(data.orderId);
  if (!order) throw AppError("订单不存在");
  if (!canCreateProtectionClaimForOrder(order, openid, { isAdmin: viewerIsAdmin })) {
    throw AppError("无权为该订单提交售后工单", "FORBIDDEN");
  }
  const claimType = normalizeClaimType(data.claimType);
  const description = normalizeClaimDescription(data.description);
  const imageFileIDs = normalizeClaimImages(data.imageFileIDs || data.imageUrls);
  const requestedAmount = normalizeRequestedAmount(data.requestedAmount);
  const actorRole = viewerIsAdmin ? "admin" : user.role || user.currentRole || "";
  return ok(
    await createProtectionClaimRecord({
      order,
      actorOpenid: openid,
      actorRole,
      claimType,
      description,
      imageFileIDs,
      requestedAmount,
      actionName: "createProtectionClaim",
    })
  );
}

async function listMyProtectionClaims(data = {}) {
  const openid = getOpenid();
  const viewerIsAdmin = await isAdmin(openid);
  const claims = await listAllProtectionClaims();
  const visible = [];
  for (const claim of claims) {
    if (data.status && claim.status !== data.status) continue;
    if (data.claimType && claim.claimType !== data.claimType) continue;
    if (data.orderId && claim.orderId !== data.orderId) continue;
    const order = await getOrder(claim.orderId).catch(() => null);
    if (canViewProtectionClaim(claim, order, openid, { isAdmin: viewerIsAdmin })) {
      visible.push(publicProtectionClaim(claim));
    }
  }
  return ok({ claims: visible });
}

async function getProtectionClaimDetail(data = {}) {
  const openid = getOpenid();
  const viewerIsAdmin = await isAdmin(openid);
  const claim =
    (await getProtectionClaim(data.claimId || data.id).catch(() => null)) ||
    (data.claimNo ? await findOne("protectionClaims", { claimNo: data.claimNo }).catch(() => null) : null);
  if (!claim) throw AppError("售后工单不存在");
  const order = await getOrder(claim.orderId).catch(() => null);
  if (!canViewProtectionClaim(claim, order, openid, { isAdmin: viewerIsAdmin })) {
    throw AppError("无权查看该售后工单", "FORBIDDEN");
  }
  return ok({
    claim: publicProtectionClaim(claim),
    order: order ? publicOrderForViewer(order, openid, { isAdmin: viewerIsAdmin }) : null,
  });
}

function assertProtectionClaimStatusTransition(currentStatus, nextStatus) {
  if (!CLAIM_STATUSES.includes(nextStatus)) {
    throw AppError("售后状态不正确", "INVALID_STATUS");
  }
  const allowed = CLAIM_STATUS_TRANSITIONS[currentStatus || "submitted"] || [];
  if (!allowed.includes(nextStatus)) {
    throw AppError("售后状态流转不正确", "INVALID_STATUS");
  }
}

async function updateProtectionClaimStatus(data = {}) {
  const openid = getOpenid();
  await requireAdmin(openid);
  const claim = await getProtectionClaim(data.claimId || data.id);
  if (!claim) throw AppError("售后工单不存在");
  const nextStatus = String(data.status || "").trim();
  assertProtectionClaimStatusTransition(claim.status, nextStatus);
  const updatedAt = now();
  const terminal = ["resolved", "rejected", "cancelled"].includes(nextStatus);
  const trailItem = {
    action: "status_update",
    actorOpenid: openid,
    actorRole: "admin",
    from: claim.status,
    to: nextStatus,
    createdAt: updatedAt,
  };
  const auditTrail = Array.isArray(claim.auditTrail) ? claim.auditTrail.concat(trailItem).slice(-50) : [trailItem];
  await db.collection("protectionClaims").doc(claim._id).update({
    data: {
      status: nextStatus,
      proposedResolution: String(data.proposedResolution || claim.proposedResolution || "").trim().slice(0, 500),
      resolutionNote: String(data.resolutionNote || claim.resolutionNote || "").trim().slice(0, 500),
      assignedAdminOpenid: openid,
      updatedAt,
      closedAt: terminal ? updatedAt : claim.closedAt || "",
      auditTrail,
    },
  });
  if (claim.orderId) {
    const openStatuses = ["submitted", "under_review", "needs_more_info"];
    let nextActiveClaimId = claim._id;
    let nextAfterSaleStatus = nextStatus;
    if (terminal) {
      const claims = await listAllProtectionClaims();
      const nextOpenClaim = claims.find((item) => item.orderId === claim.orderId && item._id !== claim._id && openStatuses.includes(item.status));
      nextActiveClaimId = nextOpenClaim ? nextOpenClaim._id : "";
      nextAfterSaleStatus = nextOpenClaim ? nextOpenClaim.status : nextStatus;
    }
    await db.collection("orders").doc(claim.orderId).update({
      data: {
        afterSaleStatus: nextAfterSaleStatus,
        activeClaimId: nextActiveClaimId,
        updatedAt,
      },
    });
  }
  await writeAuditLog({
    actorOpenid: openid,
    actorRole: "admin",
    action: "updateProtectionClaimStatus",
    targetType: "protectionClaim",
    targetId: claim._id,
    before: { status: claim.status },
    after: { status: nextStatus },
    metadata: { orderId: claim.orderId, claimType: claim.claimType },
  });
  return ok({ claimId: claim._id, status: nextStatus });
}

async function submitServiceProof(data = {}) {
  const openid = getOpenid();
  await requireUserRole(openid, "cleaner");
  const order = await getOrder(data.orderId);
  if (!order) throw AppError("订单不存在");
  if (order.acceptedCleanerOpenid !== openid) {
    throw AppError("无权提交该订单服务证明", "FORBIDDEN");
  }
  if (!SERVICE_PROOF_STATUSES.includes(order.status)) {
    throw AppError("当前订单暂不能提交服务证明", "INVALID_STATUS");
  }
  const completionPhotoUrls = normalizeClaimImages(data.completionPhotoUrls || data.completionImageUrls || data.serviceProofImageUrls || []);
  const proofNote = String((data.serviceProof && data.serviceProof.note) || data.note || "").trim().slice(0, 500);
  const updatedAt = now();
  const serviceProof = {
    note: proofNote,
    submittedBy: openid,
    submittedAt: updatedAt,
    photoCount: completionPhotoUrls.length,
  };
  await db.collection("orders").doc(order._id).update({
    data: {
      serviceProof,
      completionPhotoUrls,
      completionImageUrls: completionPhotoUrls,
      completionPhotos: completionPhotoUrls.map((fileID) => ({ fileID, url: fileID, uploadedAt: updatedAt })),
      updatedAt,
    },
  });
  await writeAuditLog({
    actorOpenid: openid,
    actorRole: "cleaner",
    action: "submitServiceProof",
    targetType: "order",
    targetId: order._id,
    after: { photoCount: completionPhotoUrls.length, hasNote: Boolean(proofNote) },
  });
  return ok({ orderId: order._id, serviceProof });
}

async function reportCleanerException(data = {}) {
  const openid = getOpenid();
  await requireUserRole(openid, "cleaner");
  const order = await getOrder(data.orderId);
  if (!order) throw AppError("订单不存在");
  if (!canReportCleanerException(order, openid)) {
    throw AppError("无权为该订单报备异常", "FORBIDDEN");
  }
  const description = normalizeClaimDescription(data.description);
  const imageFileIDs = normalizeClaimImages(data.imageFileIDs || data.imageUrls);
  return ok(
    await createProtectionClaimRecord({
      order,
      actorOpenid: openid,
      actorRole: "cleaner",
      claimType: normalizeCleanerExceptionType(data.claimType),
      description,
      imageFileIDs,
      requestedAmount: 0,
      actionName: "reportCleanerException",
    })
  );
}

async function blockCleaner(data = {}) {
  const openid = getOpenid();
  await requireAdmin(openid);
  const cleanerId = data.cleanerId || data.cleanerOpenid || "";
  if (!cleanerId) throw AppError("缺少家洁师 ID", "INVALID_INPUT");
  const cleaner = await getCleaner(cleanerId);
  const before = await findOne("cleanerTrustProfile", { cleanerId }).catch(() => null);
  const profile = await upsertCleanerTrustProfile(cleanerId, {
    trustScore: 0,
    trustLevel: "blocked",
    blocked: true,
    governanceStatus: "blocked",
    reason: String(data.reason || "").slice(0, 120),
  });
  if (cleaner) {
    await db.collection("cleaners").doc(cleaner._id).update({ data: { available: false, trustLevel: "blocked", updatedAt: now() } });
  }
  await writeAuditLog({
    actorOpenid: openid,
    actorRole: "admin",
    action: "blockCleaner",
    targetType: "cleanerTrustProfile",
    targetId: cleanerId,
    before: before ? { trustScore: before.trustScore, trustLevel: before.trustLevel } : null,
    after: { trustScore: profile.trustScore, trustLevel: profile.trustLevel, blocked: true },
    metadata: { reason: String(data.reason || "").slice(0, 120) },
  });
  return ok({ cleanerId, trustProfile: profile });
}

async function unblockCleaner(data = {}) {
  const openid = getOpenid();
  await requireAdmin(openid);
  const cleanerId = data.cleanerId || data.cleanerOpenid || "";
  if (!cleanerId) throw AppError("缺少家洁师 ID", "INVALID_INPUT");
  const before = await findOne("cleanerTrustProfile", { cleanerId }).catch(() => null);
  const score = clampScore(data.score === undefined ? 60 : data.score);
  const profile = await upsertCleanerTrustProfile(cleanerId, {
    trustScore: score,
    trustLevel: trustLevelFromScore(score),
    blocked: false,
    freezeUntil: "",
    governanceStatus: "",
    rankingDown: score < 50,
    reason: String(data.reason || "").slice(0, 120),
  });
  const cleaner = await getCleaner(cleanerId);
  if (cleaner) {
    await db.collection("cleaners").doc(cleaner._id).update({ data: { available: true, trustLevel: profile.trustLevel, updatedAt: now() } });
  }
  await writeAuditLog({
    actorOpenid: openid,
    actorRole: "admin",
    action: "unblockCleaner",
    targetType: "cleanerTrustProfile",
    targetId: cleanerId,
    before: before ? { trustScore: before.trustScore, trustLevel: before.trustLevel } : null,
    after: { trustScore: profile.trustScore, trustLevel: profile.trustLevel, blocked: false },
    metadata: { reason: String(data.reason || "").slice(0, 120) },
  });
  return ok({ cleanerId, trustProfile: profile });
}

async function adjustTrustScore(data = {}) {
  const openid = getOpenid();
  await requireAdmin(openid);
  const cleanerId = data.cleanerId || data.cleanerOpenid || "";
  if (!cleanerId) throw AppError("缺少家洁师 ID", "INVALID_INPUT");
  const score = clampScore(data.score);
  const before = await findOne("cleanerTrustProfile", { cleanerId }).catch(() => null);
  const governed = applyAutoGovernance(
    {
      cleanerId,
      trustScore: score,
      trustLevel: trustLevelFromScore(score),
      reason: String(data.reason || "").slice(0, 120),
    },
    {}
  );
  const profile = await upsertCleanerTrustProfile(cleanerId, governed);
  const cleaner = await getCleaner(cleanerId);
  if (cleaner && profile.trustLevel === "blocked") {
    await db.collection("cleaners").doc(cleaner._id).update({ data: { available: false, trustLevel: "blocked", updatedAt: now() } });
  }
  await writeAuditLog({
    actorOpenid: openid,
    actorRole: "admin",
    action: "adjustTrustScore",
    targetType: "cleanerTrustProfile",
    targetId: cleanerId,
    before: before ? { trustScore: before.trustScore, trustLevel: before.trustLevel } : null,
    after: { trustScore: profile.trustScore, trustLevel: profile.trustLevel, rankingDown: Boolean(profile.rankingDown) },
    metadata: { reason: String(data.reason || "").slice(0, 120) },
  });
  return ok({ cleanerId, trustProfile: profile });
}

async function flagOrder(data = {}) {
  const openid = getOpenid();
  await requireAdmin(openid);
  const order = await getOrder(data.orderId);
  if (!order) throw AppError("订单不存在", "INVALID_INPUT");
  const level = ["low", "medium", "high", "critical"].includes(data.riskLevel) ? data.riskLevel : "medium";
  const scoreByLevel = { low: 15, medium: 40, high: 65, critical: 95 };
  const riskScore = clampScore(data.riskScore === undefined ? scoreByLevel[level] : data.riskScore);
  const risk = await upsertOrderRiskProfile(order._id, {
    riskScore,
    riskLevel: level,
    decision: decisionFromScore(riskScore),
    fraudScore: Number(data.fraudScore || 0),
    collusionScore: Number(data.collusionScore || 0),
    graphScore: Number(data.graphScore || 0),
  });
  await db.collection("orders").doc(order._id).update({ data: orderRiskPublicFields(risk) });
  await writeAuditLog({
    actorOpenid: openid,
    actorRole: "admin",
    action: "flagOrder",
    targetType: "orderRiskProfile",
    targetId: order._id,
    before: { riskScore: order.riskScore || 0, riskLevel: order.riskLevel || "" },
    after: { riskScore: risk.riskScore, riskLevel: risk.riskLevel, riskDecision: risk.riskDecision },
    metadata: { reason: String(data.reason || "").slice(0, 120) },
  });
  return ok({ orderId: order._id, riskProfile: risk });
}

function publicPaymentIntent(intent = {}) {
  return {
    intentId: intent.intentId || intent._id || "",
    orderId: intent.orderId || "",
    amount: Number(intent.amount || 0),
    currency: intent.currency || "CNY",
    status: intent.status || "pending",
    escrowStatus: intent.escrowStatus || "",
    paymentProvider: intent.paymentProvider || "manual_stub",
    createdAt: intent.createdAt || "",
    updatedAt: intent.updatedAt || "",
  };
}

async function findPaymentIntentByIntentId(intentId) {
  return findOne("paymentIntents", { intentId }).catch(() => null);
}

async function createPaymentIntent(data = {}) {
  const openid = getOpenid();
  const order = await getOrder(data.orderId);
  if (!order) throw AppError("订单不存在", "INVALID_INPUT");
  const viewerIsAdmin = await isAdmin(openid);
  if (!viewerIsAdmin && order.customerOpenid !== openid) {
    throw AppError("无权为该订单创建支付意图", "FORBIDDEN");
  }
  if (!["waiting_payment", "confirmed"].includes(order.status) && normalizePaymentStatus(order) !== "pending_pay") {
    throw AppError("当前订单不需要支付", "INVALID_STATUS");
  }
  await safeCreateCollection("paymentIntents");
  const createdAt = now();
  const snapshot = createPaymentIntentSnapshot(order, {
    idempotencyKey: data.idempotencyKey || data.requestId || order._id,
    createdAt,
    userOpenid: order.customerOpenid,
  });
  const existingByKey = await findOne("paymentIntents", { intentKey: snapshot.intentKey }).catch(() => null);
  if (existingByKey) return ok({ paymentIntent: publicPaymentIntent(existingByKey), idempotent: true });
  const existingActive = await findOne("paymentIntents", { orderId: order._id, status: "pending" }).catch(() => null);
  if (existingActive) return ok({ paymentIntent: publicPaymentIntent(existingActive), idempotent: true });
  await db.collection("paymentIntents").add({ data: snapshot });
  await db.collection("orders").doc(order._id).update({
    data: {
      paymentIntentId: snapshot.intentId,
      paymentIntentStatus: "pending",
      opsState: order.opsState || "CREATED",
      updatedAt: createdAt,
    },
  });
  await writeAuditLog({
    actorOpenid: openid,
    actorRole: viewerIsAdmin ? "admin" : "customer",
    action: "createPaymentIntent",
    targetType: "paymentIntent",
    targetId: snapshot.intentId,
    after: { orderId: order._id, amount: snapshot.amount, status: "pending" },
  });
  return ok({ paymentIntent: publicPaymentIntent(snapshot), idempotent: false });
}

async function handlePaymentCallback(data = {}) {
  const intent = await findPaymentIntentByIntentId(data.intentId || data.paymentIntentId);
  if (!intent) throw AppError("支付意图不存在", "INVALID_INPUT");
  const duplicate = await findOne("paymentCallbacks", { eventId: data.eventId }).catch(() => null);
  if (duplicate) {
    return ok({ paymentIntent: publicPaymentIntent(intent), duplicate: true });
  }
  let nextIntent;
  try {
    nextIntent = applyPaymentCallback(intent, data);
  } catch (error) {
    throw AppError(error.message, "INVALID_INPUT");
  }
  const order = await getOrder(intent.orderId);
  if (!order) throw AppError("订单不存在", "INVALID_INPUT");
  await safeCreateCollection("paymentCallbacks");
  await db.collection("paymentCallbacks").add({
    data: {
      eventId: data.eventId,
      intentId: intent.intentId,
      orderId: intent.orderId,
      status: data.status,
      amount: Number(data.amount || 0),
      createdAt: now(),
    },
  });
  await db.collection("paymentIntents").doc(intent._id).update({ data: nextIntent });
  const updateData = {
    paymentIntentStatus: nextIntent.status,
    updatedAt: now(),
  };
  if (nextIntent.status === "paid") {
    updateData.status = "confirmed";
    updateData.paymentStatus = "escrowed";
    updateData.escrowStatus = "held";
    updateData.opsState = "PAID";
    updateData.paidAt = nextIntent.paidAt || now();
  }
  if (nextIntent.status === "failed") {
    updateData.paymentStatus = "pending_pay";
    updateData.escrowStatus = "";
  }
  if (nextIntent.status === "refunded") {
    updateData.paymentStatus = "refunded";
    updateData.escrowStatus = "refunded";
    updateData.opsState = "REFUNDED";
  }
  await db.collection("orders").doc(order._id).update({ data: updateData });
  await writeAuditLog({
    actorOpenid: "payment_callback",
    actorRole: "system",
    action: "handlePaymentCallback",
    targetType: "paymentIntent",
    targetId: intent.intentId,
    before: { status: intent.status },
    after: { status: nextIntent.status, orderId: order._id },
  });
  return ok({ paymentIntent: publicPaymentIntent(nextIntent), duplicate: false });
}

async function getPaymentStatus(data = {}) {
  const openid = getOpenid();
  const intent = await findPaymentIntentByIntentId(data.intentId || data.paymentIntentId);
  if (!intent) throw AppError("支付意图不存在", "INVALID_INPUT");
  const viewerIsAdmin = await isAdmin(openid);
  if (!viewerIsAdmin && intent.userOpenid !== openid) throw AppError("无权查看支付状态", "FORBIDDEN");
  return ok({ paymentIntent: publicPaymentIntent(intent) });
}

async function settleOrder(data = {}) {
  const openid = getOpenid();
  await requireAdmin(openid);
  const order = await getOrder(data.orderId);
  if (!order) throw AppError("订单不存在", "INVALID_INPUT");
  const existing = await findOne("settlements", { orderId: order._id }).catch(() => null);
  if (existing) return ok({ settlement: existing, idempotent: true });
  let settlement;
  try {
    settlement = createSettlementSnapshot(order, {
      penalty: data.penalty || 0,
      bonus: data.bonus || 0,
      createdAt: now(),
    });
  } catch (error) {
    throw AppError(error.message, "INVALID_STATUS");
  }
  await safeCreateCollection("settlements");
  await db.collection("settlements").add({ data: settlement });
  await db.collection("orders").doc(order._id).update({
    data: {
      settlementStatus: "settled",
      escrowStatus: "released",
      opsState: "SETTLED",
      settledAt: settlement.createdAt,
      updatedAt: settlement.updatedAt,
    },
  });
  await writeAuditLog({
    actorOpenid: openid,
    actorRole: "admin",
    action: "settleOrder",
    targetType: "settlement",
    targetId: settlement.settlementId,
    after: { orderId: order._id, payoutAmount: settlement.payoutAmount, penalty: settlement.penalty, bonus: settlement.bonus },
  });
  return ok({ settlement, idempotent: false });
}

async function forceRefund(data = {}) {
  const openid = getOpenid();
  await requireAdmin(openid);
  const order = await getOrder(data.orderId);
  if (!order) throw AppError("订单不存在", "INVALID_INPUT");
  const intent = (await findOne("paymentIntents", { orderId: order._id, status: "paid" }).catch(() => null)) || null;
  const updatedAt = now();
  if (intent) {
    await db.collection("paymentIntents").doc(intent._id).update({ data: { status: "refunded", refundedAt: updatedAt, updatedAt } });
  }
  await db.collection("orders").doc(order._id).update({
    data: {
      paymentStatus: "refunded",
      paymentIntentStatus: "refunded",
      escrowStatus: "refunded",
      opsState: "REFUNDED",
      refundedAt: updatedAt,
      updatedAt,
    },
  });
  await writeAuditLog({
    actorOpenid: openid,
    actorRole: "admin",
    action: "forceRefund",
    targetType: "order",
    targetId: order._id,
    after: { paymentStatus: "refunded", hasPaymentIntent: Boolean(intent) },
    metadata: { reason: String(data.reason || "").slice(0, 120) },
  });
  return ok({ orderId: order._id, refunded: true });
}

async function adminListOrders(data = {}) {
  const openid = getOpenid();
  await requireAdmin(openid);
  const filter = normalizeOrderAdminFilter(data);
  const result = await db.collection("orders").orderBy("updatedAt", "desc").limit(filter.limit).get();
  let orders = result.data || [];
  if (filter.status) orders = orders.filter((order) => order.status === filter.status);
  if (filter.paymentStatus) orders = orders.filter((order) => order.paymentStatus === filter.paymentStatus);
  if (filter.settlementStatus) orders = orders.filter((order) => order.settlementStatus === filter.settlementStatus);
  return ok({ orders });
}

async function adjustPayout(data = {}) {
  const openid = getOpenid();
  await requireAdmin(openid);
  const settlement = await findOne("settlements", { orderId: data.orderId }).catch(() => null);
  if (!settlement) throw AppError("结算记录不存在", "INVALID_INPUT");
  const adjustment = normalizePayoutAdjustment(data);
  const next = createSettlementSnapshot(
    { ...settlement, _id: settlement.orderId, status: "completed", paymentStatus: "escrowed" },
    { penalty: adjustment.penalty, bonus: adjustment.bonus, settlementId: settlement.settlementId || settlement._id, createdAt: settlement.createdAt || now() }
  );
  await db.collection("settlements").doc(settlement._id).update({ data: { ...next, adjustmentReason: adjustment.reason, updatedAt: now() } });
  await safeCreateCollection("payoutAdjustments");
  await db.collection("payoutAdjustments").add({
    data: { orderId: settlement.orderId, ...adjustment, actorOpenid: openid, createdAt: now() },
  });
  return ok({ settlement: next });
}

async function reconcileOrders(data = {}) {
  const openid = getOpenid();
  await requireAdmin(openid);
  const orders = await getCollectionData("orders").catch(() => []);
  const paymentIntents = await getCollectionData("paymentIntents").catch(() => []);
  const settlements = await getCollectionData("settlements").catch(() => []);
  const report = reconcileOrderRecords({ orders, paymentIntents, settlements });
  await safeCreateCollection("reconciliationReports");
  await db.collection("reconciliationReports").add({
    data: { type: "orders", report, createdAt: now(), actorOpenid: openid },
  });
  return ok({ report });
}

async function reconcilePayouts(data = {}) {
  const openid = getOpenid();
  await requireAdmin(openid);
  const settlements = await getCollectionData("settlements").catch(() => []);
  const report = reconcilePayoutRecords({ settlements });
  await safeCreateCollection("reconciliationReports");
  await db.collection("reconciliationReports").add({
    data: { type: "payouts", report, createdAt: now(), actorOpenid: openid },
  });
  return ok({ report });
}

async function autoAcceptOverdueOrders(data) {
  const openid = getOpenid();
  await requireAdmin(openid);
  assertActionAllowedInProduction("autoAcceptOverdueOrders", data);
  const result = await autoAcceptOverdueOrdersInternal(data, {
    actorOpenid: openid,
    actorRole: "admin",
    source: "adminAction",
  });
  await writeAuditLog({
    actorOpenid: openid,
    actorRole: "admin",
    action: "autoAcceptOverdueOrders.summary",
    targetType: "orders",
    metadata: result,
  });
  return ok(result);
}

const actions = {
  initCollections,
  login,
  updateUserRole,
  getMyProfile,
  updateMyProfile,
  getCustomerProfile: getCustomerProfileAction,
  getCleanerProfile,
  updateUserProfile,
  updateUserLocation,
  updateCustomerLocation,
  updateCleanerWorkLocation,
  listUserAddresses,
  saveUserAddress,
  setDefaultUserAddress,
  deleteUserAddress,
  getPlatformStats,
  getServiceStandards,
  getProtectionPlans,
  getPricingRules,
  createPricingQuote,
  getPricingQuote,
  createOrder,
  listOpenOrders,
  listAssignedOrders,
  listMyOrders,
  acceptOrder,
  selectOrderResponse,
  assignCleaner,
  mockPayOrder,
  declineAssignedOrder,
  updateOrderStatus,
  hideOrderForRole,
  migrateOrderPaymentStatus,
  updateOrderPublishMode,
  updateCleanerAvailability,
  updateCleanerLocation,
  listCleaners,
  getCleanerDetail,
  updateCleanerProfile,
  saveCleaner,
  listSavedCleaners,
  getOrderDetail,
  listConversations,
  getConversationByOrder,
  listMessages,
  sendMessage,
  getIncomeStats,
  listReceivedReviews,
  submitReview,
  createSupportTicket,
  createProtectionClaim,
  listMyProtectionClaims,
  getProtectionClaimDetail,
  updateProtectionClaimStatus,
  submitServiceProof,
  reportCleanerException,
  createPaymentIntent,
  handlePaymentCallback,
  getPaymentStatus,
  settleOrder,
  forceRefund,
  adminListOrders,
  adjustPayout,
  reconcileOrders,
  reconcilePayouts,
  blockCleaner,
  unblockCleaner,
  adjustTrustScore,
  flagOrder,
  autoAcceptOverdueOrders,
  migrateOrderNos,
};

exports.main = async (event) => {
  try {
    const type = event.type || event.action;
    if (!actions[type]) {
      throw AppError("未知操作");
    }
    return await actions[type](event.data || {});
  } catch (error) {
    console.error(error);
    return fail(error);
  }
};

