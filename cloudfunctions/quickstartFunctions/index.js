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
} = require("./lib/domain");
const { calculateOrderPrice } = require("./lib/pricing");

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
];

const COMMISSION_RATE = 0.05;
const CONTACT_STATUSES = ["confirmed", "in_service", "waiting_complete", "waiting_acceptance", "completed", "auto_completed", "accepted"];

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
  if (order && order.pricingSnapshot && order.pricingSnapshot.orderAmount) {
    return {
      ...order.pricingSnapshot,
      orderAmount: Number(order.pricingSnapshot.orderAmount),
      platformFee: Number(order.pricingSnapshot.platformFee || order.platformFee || 0),
      cleanerIncome: Number(order.pricingSnapshot.cleanerIncome || order.cleanerIncome || 0),
    };
  }
  const location = order.locationSnapshot || {};
  return calculateOrderPrice({
    city: location.city || order.city || "",
    serviceType: order.serviceType,
    durationHours: order.durationHours,
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
  const openid = data.openid || data.cleanerOpenid || getOpenid();
  return ok({ cleanerProfile: await withCleanerStats(await getCleaner(openid)) });
}

async function getCustomerProfileAction(data = {}) {
  const openid = data.openid || data.customerOpenid || getOpenid();
  return ok({ customerProfile: await getCustomerProfile(openid) });
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

function visibleContact(order, openid) {
  if (!order || !CONTACT_STATUSES.includes(order.status)) {
    return false;
  }
  return order.customerOpenid === openid || order.acceptedCleanerOpenid === openid;
}

function hideContactIfNeeded(order, openid) {
  if (visibleContact(order, openid)) {
    return order;
  }
  return {
    ...order,
    contactPhone: "",
    contactWechat: "",
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
    review,
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

async function autoAcceptOverdueOrdersInternal(data = {}) {
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
    orderIds.push(order._id);
  }
  return {
    checkedCount: result.data.length,
    acceptedCount: orderIds.length,
    orderIds,
  };
}

async function withCleanerStats(cleaner) {
  if (!cleaner) return cleaner;
  const cleanerId = cleaner._openid || cleaner.cleanerId;
  if (!cleanerId) return cleaner;
  const stats = await getCleanerStats(cleanerId, cleaner);
  return {
    ...publicCleaner(cleaner),
    cleanerId,
    stats,
    rating: stats.rating,
    ratingAvg: stats.rating,
    reviewCount: stats.reviewCount,
    serviceCount: stats.serviceCount,
    completedOrderCount: stats.serviceCount,
    completedOrders: stats.completedOrders,
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

function publicCleaner(cleaner) {
  if (!cleaner) return cleaner;
  const avatarUrl = cleanerAvatarUrlOf(cleaner);
  return {
    ...cleaner,
    avatarUrl,
    avatar: cleaner.avatar || avatarUrl,
  };
}

function maskNickname(name) {
  const text = String(name || "").trim();
  if (!text) return "邻里用户";
  return `${text.slice(0, 1)}***`;
}

function decorateReviewForDisplay(review, customerProfile = null, order = null) {
  return {
    ...review,
    imageUrls: normalizeReviewImageUrls(review.imageUrls),
    customerNameMasked: maskNickname(customerProfile && customerProfile.nickname),
    serviceType: review.serviceType || (order && order.serviceType) || "",
  };
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

async function initCollections() {
  const openid = getOpenid();
  await Promise.all(COLLECTIONS.map((name) => safeCreateCollection(name)));
  await ensureUser(openid);
  await ensureCustomerProfile(openid);

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
  cleaner = cleaner ? await withCleanerStats(cleaner) : cleaner;
  return ok({ openid, user, customerProfile, cleaner, cleanerProfile: cleaner });
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
  const cleanerProfile = cleaner ? await withCleanerStats(cleaner) : null;
  return ok({ openid, user, role, customerProfile, cleanerProfile });
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
      customerProfile: await getCustomerProfile(openid),
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
    customerProfile: await getCustomerProfile(openid),
      cleanerProfile: await withCleanerStats(await getCleaner(openid).catch(() => null)),
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

function normalizeOrderLocationSnapshot(data) {
  const source = data.locationSnapshot || data;
  return {
    province: String(source.province || "").slice(0, 30),
    city: String(source.city || "").slice(0, 30),
    district: String(source.district || "").slice(0, 30),
    street: String(source.street || "").slice(0, 40),
    community: String(source.community || data.community || "").slice(0, 40),
    detailAddress: String(source.detailAddress || "").slice(0, 80),
    addressText: String(source.addressText || data.addressText || "").slice(0, 120),
    latitude: latitudeOf(source),
    longitude: longitudeOf(source),
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

async function migrateOrderNos() {
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

async function createOrder(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "customer");
  assertCreateOrderInput(data);
  if ((data.serviceType === "深度保洁" || data.serviceType === "开荒保洁") && Number(data.areaSize || 0) <= 0) {
    throw AppError("请填写面积后再发布");
  }
  const locationSnapshot = normalizeOrderLocationSnapshot(data);
  const pricing = calculateOrderPricing({ ...data, locationSnapshot });
  if (!pricing.orderAmount) {
    throw AppError("订单金额计算失败，请检查服务类型和时长");
  }

  if (data.publishMode === "assigned") {
    const assignedCleaner = await getCleaner(data.assignedCleanerOpenid);
    if (!assignedCleaner || !assignedCleaner.manualApproved || !assignedCleaner.available) {
      throw AppError("指派家洁师暂不可预约");
    }
  }

  const createdAt = now();
  const status = data.publishMode === "assigned" ? "assigned_waiting_accept" : "waiting_response";
  const pricingSnapshot = {
    city: pricing.city,
    cityFactor: pricing.cityFactor,
    serviceTypeFactor: pricing.serviceTypeFactor,
    baseHourlyPrice: pricing.baseHourlyPrice,
    durationHours: pricing.durationHours,
    orderAmount: pricing.orderAmount,
    platformFee: pricing.platformFee,
    cleanerIncome: pricing.cleanerIncome,
    cleanerHourlyIncome: pricing.cleanerHourlyIncome,
    minCleanerHourlyIncome: pricing.minCleanerHourlyIncome,
    isMinIncomeProtected: pricing.isMinIncomeProtected,
    calculatedAt: createdAt,
  };
  const displayOrder = await nextDisplayOrderNo(locationSnapshot, createdAt);
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
      areaSize: data.areaSize || "",
      durationHours: Number(data.durationHours || 0),
      scheduledAt: data.scheduledAt,
      note: data.note || "",
      contactPhone: data.contactPhone,
      contactWechat: data.contactWechat || "",
      amount: pricing.orderAmount,
      estimatedPrice: pricing.orderAmount,
      orderAmount: pricing.orderAmount,
      platformFee: pricing.platformFee,
      cleanerIncome: pricing.cleanerIncome,
      pricingSnapshot,
      paymentStatus: "unpaid",
      settlementStatus: "pending",
      status,
      responses: [],
      declineHistory: [],
      createdAt,
      updatedAt: createdAt,
    },
  });
  return ok({ orderId: result._id });
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
  return ok(
    orders.map((order) =>
      hideContactIfNeeded(
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
      .map((order) => hideContactIfNeeded(order, openid))
  );
}

async function listMyOrders() {
  const openid = getOpenid();
  const user = await ensureUser(openid);
  await autoAcceptOverdueOrdersInternal();
  if (user.role === "customer") {
    const customerOrders = await db
      .collection("orders")
      .where({ customerOpenid: openid })
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    const orders = await attachReviewInfoList(customerOrders.data);
    return ok(orders.filter((order) => !order.hiddenForCustomer).map((order) => hideContactIfNeeded(order, openid)));
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
    return ok(cleanerOrders.filter((order) => !order.hiddenForCleaner).map((order) => hideContactIfNeeded(order, openid)));
  }
  throw AppError("请先选择账号身份");
}

async function acceptOrder(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "cleaner");
  const order = await getOrder(data.orderId);
  const cleaner = await withCleanerStats(await getCleaner(openid));
  assertCleanerCanAccept(order, cleaner);

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
    return ok({ orderId: data.orderId, status: nextStatus });
  }
  const statusTime = {};
  if (nextStatus === "cancelled") statusTime.cancelledAt = updateTime;
  if (nextStatus === "in_service") statusTime.startedAt = updateTime;
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
  }
  await db.collection("orders").doc(data.orderId).update({
    data: {
      status: nextStatus,
      ...statusPaymentPatch(nextStatus, order),
      ...statusTime,
      updatedAt: updateTime,
    },
  });
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
  return ok({ orderId: data.orderId, role, hidden: true });
}

async function migrateOrderPaymentStatus(data = {}) {
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
  return ok({ cleaner: await withCleanerStats(await getCleaner(openid)) });
}

async function updateCleanerLocation(data) {
  const openid = getOpenid();
  await requireUserRole(openid, "cleaner");
  const cleaner = await ensureCleanerProfile(openid);
  const lastLocation = normalizeLastLocation(data.lastLocation || data);
  if (!lastLocation) {
    return ok({ cleaner: await withCleanerStats(cleaner) });
  }
  await db.collection("cleaners").doc(cleaner._id).update({
    data: { lastLocation, updatedAt: now() },
  });
  return ok({ cleaner: await withCleanerStats(await getCleaner(openid)) });
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
    enriched.push(await withCleanerStats(cleaner));
  }
  return ok(enriched);
}

async function getCleanerDetail(data) {
  const viewerOpenid = getOpenid();
  const viewerUser = await ensureUser(viewerOpenid);
  const cleaner = await getCleaner(data.cleanerOpenid);
  if (!cleaner) {
    throw AppError("家洁师资料不存在");
  }
  const enrichedCleaner = await withCleanerStats(cleaner);
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
  const updatedCleaner = await withCleanerStats(await getCleaner(openid));
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
  await autoAcceptOverdueOrdersInternal();
  const order = await getOrder(data.orderId);
  if (!order) {
    throw AppError("订单不存在");
  }

  const user = await ensureUser(openid);
  const isCustomer = order.customerOpenid === openid;
  const isAcceptedCleaner = order.acceptedCleanerOpenid === openid;
  const isAssignedCleaner = order.assignedCleanerOpenid === openid;
  const hasResponse = (order.responses || []).some((response) => response.cleanerId === openid);
  let canView = isCustomer || isAcceptedCleaner || isAssignedCleaner || hasResponse;
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
    cleaner = await withCleanerStats(await getCleaner(order.acceptedCleanerOpenid || order.assignedCleanerOpenid));
  }
  const customerProfile = await getCustomerProfile(order.customerOpenid).catch(() => null);
  const review = await findOne("reviews", { orderId: data.orderId });
  const manualReview = isManualReview(review) ? { ...review, imageUrls: normalizeReviewImageUrls(review.imageUrls) } : null;
  const savedCleaner =
    isCustomer && (order.acceptedCleanerOpenid || order.assignedCleanerOpenid)
      ? await findOne("favorites", {
          customerOpenid: openid,
          cleanerOpenid: order.acceptedCleanerOpenid || order.assignedCleanerOpenid,
        })
      : null;
  const orderWithReview = manualReview
    ? { ...order, reviewId: manualReview._id, hasReview: true, canEditReview: canEditReview(manualReview, now()) }
    : { ...order, reviewId: "", hasReview: false, canEditReview: false };
  return ok({
    order: hideContactIfNeeded(orderWithReview, openid),
    cleaner,
    customerProfile,
    review: manualReview,
    canEditReview: manualReview ? canEditReview(manualReview, now()) : false,
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
  await autoAcceptOverdueOrdersInternal();
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
  return ok(result.data.filter(isManualReview).map((review) => ({ ...review, imageUrls: normalizeReviewImageUrls(review.imageUrls) })));
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

async function autoAcceptOverdueOrders(data) {
  const result = await autoAcceptOverdueOrdersInternal(data);
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
  createOrder,
  listOpenOrders,
  listAssignedOrders,
  listMyOrders,
  acceptOrder,
  selectOrderResponse,
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

