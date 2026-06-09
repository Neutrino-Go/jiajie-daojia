const assert = require("assert");
const {
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
} = require("../lib/domain");
const {
  buildLocationStateFromPosition,
  locationDisplayText,
  normalizeQQMapReverseGeocodeResult,
  removeRecentLocationAt,
} = require("../../../miniprogram/utils/location-state");
const {
  getUserOrderStatusGroup: getDisplayOrderStatusGroup,
  getCleanerDistanceText,
  getOrderTabCount,
  fullAddressOf,
  shortOrderNo,
  avatarUrlOf,
  decorateCleaner,
  decorateOrder,
  orderStatusStyle,
  getOrderStatusCopy,
  roleAwareStatusLabel,
  roleAwareStatusTip,
  ratingReviewText,
  ratingValueText,
  withOrderTabCounts,
} = require("../../../miniprogram/utils/format");
const session = require("../../../miniprogram/utils/session");
const miniprogramPricing = require("../../../miniprogram/config/pricing");
const cloudPricing = require("../lib/pricing");

function mustThrow(name, fn, message) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, `${name} should throw`);
  assert.strictEqual(thrown.message, message);
}

function createWxStorageMock(initial = {}) {
  const store = { ...initial };
  return {
    store,
    getStorageSync(key) {
      return store[key];
    },
    setStorageSync(key, value) {
      store[key] = value;
    },
    removeStorageSync(key) {
      delete store[key];
    },
    setTabBarItem() {},
  };
}

async function runIdentitySessionTests() {
  const app = {
    globalData: {
      openid: "openid-a",
      currentUser: { nickname: "old user" },
      currentProfile: { nickname: "old profile" },
      customerProfile: { nickname: "old customer" },
      cleanerProfile: { displayName: "old cleaner" },
      cleaner: { displayName: "old cleaner" },
      currentRole: "customer",
      activeRole: "customer",
    },
  };
  global.getApp = () => app;
  global.wx = createWxStorageMock({
    currentUser: { nickname: "old user" },
    currentProfile: { nickname: "old profile" },
    customerProfile: { nickname: "old customer" },
    cleanerProfile: { displayName: "old cleaner" },
    homeCache: { stale: true },
    profileCache: { stale: true },
    orderCache: { stale: true },
    cleanerListCache: { stale: true },
    token: "keep-token",
  });

  await session.switchIdentity(
    { role: "cleaner", openid: "openid-b" },
    {
      fetchProfile: async (role) => ({
        openid: "openid-b",
        role,
        user: { role, nickname: "public fallback" },
        cleanerProfile: { displayName: "花开富贵", avatarUrl: "cleaner.png", phone: "13900000000" },
      }),
    }
  );

  assert.strictEqual(app.globalData.openid, "openid-b");
  assert.strictEqual(app.globalData.currentRole, "cleaner");
  assert.strictEqual(app.globalData.currentUser.openid, "openid-b");
  assert.strictEqual(app.globalData.currentUser.nickname, "public fallback");
  assert.strictEqual(app.globalData.currentProfile.displayName, "花开富贵");
  assert.strictEqual(global.wx.store.token, "keep-token");
  assert.strictEqual(global.wx.store.homeCache, undefined);
  assert.strictEqual(global.wx.store.customerProfile, undefined);
  assert.strictEqual(global.wx.store.currentRole, "cleaner");
  assert.strictEqual(global.wx.store.userRole, "cleaner");

  session.setRoleLocation("customer", { city: "上海市", district: "嘉定区", community: "建悦里" });
  session.setRoleLocation("cleaner", { city: "哈尔滨市", district: "道里区" });
  assert.strictEqual(session.getRoleLocation("customer").city, "上海市");
  assert.strictEqual(session.getRoleLocation("cleaner").city, "哈尔滨市");
  assert.strictEqual(session.shortRoleLocationLabel(session.getRoleLocation("cleaner")), "哈尔滨市 道里区");
  assert.strictEqual(
    session.formatRegionText({ province: "上海市", city: "上海市", district: "嘉定区", street: "菊园新区", community: "建悦里" }),
    "上海市 嘉定区"
  );
  assert.strictEqual(
    session.formatRegionText({ province: "江苏省", city: "无锡市", district: "江阴市", community: "测试小区" }),
    "江苏省 无锡市 江阴市"
  );
  assert.strictEqual(session.formatRegionText({ city: "哈尔滨市" }), "哈尔滨市");
  assert.strictEqual(session.formatRegionText(null), "请选择地址");
}

runIdentitySessionTests()
  .then(() => {
assertCreateOrderInput({
  publishMode: "public",
  serviceType: "日常保洁",
  community: "梧桐小区",
  scheduledAt: "2026-05-22 09:00",
  contactPhone: "13800000000",
});

mustThrow(
  "assigned cleaner requirement",
  () =>
    assertCreateOrderInput({
      publishMode: "assigned",
      serviceType: "日常保洁",
      community: "梧桐小区",
      scheduledAt: "2026-05-22 09:00",
      contactPhone: "13800000000",
    }),
  "请选择指派家洁师"
);

assertCleanerCanAccept(
  {
    status: "pending",
    publishMode: "assigned",
    assignedCleanerOpenid: "cleaner-a",
  },
  { _openid: "cleaner-a", manualApproved: true, available: true }
);

mustThrow(
  "wrong assigned cleaner",
  () =>
    assertCleanerCanAccept(
      {
        status: "pending",
        publishMode: "assigned",
        assignedCleanerOpenid: "cleaner-a",
      },
      { _openid: "cleaner-b", manualApproved: true, available: true }
    ),
  "只有被指派的家洁师可以接单"
);

assertStatusTransition(
  { status: "accepted", customerOpenid: "customer-a", acceptedCleanerOpenid: "cleaner-a" },
  "in_service",
  "cleaner-a"
);

mustThrow(
  "cleaner cannot start unpaid order",
  () =>
    assertStatusTransition(
      { status: "confirmed", paymentStatus: "pending_pay", customerOpenid: "customer-a", acceptedCleanerOpenid: "cleaner-a" },
      "in_service",
      "cleaner-a"
    ),
  "客户支付后才可开始服务"
);

mustThrow(
  "customer cannot start service",
  () =>
    assertStatusTransition(
      { status: "accepted", customerOpenid: "customer-a", acceptedCleanerOpenid: "cleaner-a" },
      "in_service",
      "customer-a"
    ),
  "只有接单家洁师可以开始服务"
);

assert.strictEqual(getUserOrderStatusGroup({ status: "waiting_response" }), "pending");
assert.strictEqual(getUserOrderStatusGroup({ status: "waiting_confirm" }), "pending");
assert.strictEqual(getUserOrderStatusGroup({ status: "confirmed" }), "ongoing");
assert.strictEqual(getUserOrderStatusGroup({ status: "in_service" }), "ongoing");
assert.strictEqual(getUserOrderStatusGroup({ status: "waiting_complete" }), "ongoing");
assert.strictEqual(getUserOrderStatusGroup({ status: "waiting_acceptance" }), "ongoing");
assert.strictEqual(getUserOrderStatusGroup({ status: "waiting_payment" }), "ongoing");
assert.strictEqual(getUserOrderStatusGroup({ status: "completed" }), "completed");
assert.strictEqual(getUserOrderStatusGroup({ status: "auto_completed" }), "completed");
assert.strictEqual(getUserOrderStatusGroup({ status: "cancelled" }), "cancelled");
assert.strictEqual(getDisplayOrderStatusGroup({ status: "waiting_complete" }), "ongoing");
assert.strictEqual(getDisplayOrderStatusGroup({ status: "waiting_acceptance" }), "ongoing");
assert.strictEqual(
  fullAddressOf({
    locationSnapshot: {
      province: "上海市",
      city: "上海市",
      district: "嘉定区",
      street: "嘉戬公路",
      community: "建悦里",
      detailAddress: "3号楼1208",
    },
  }),
  "上海市 上海市 嘉定区 嘉戬公路 建悦里 3号楼1208"
);
assert.strictEqual(fullAddressOf({ community: "建悦里" }), "建悦里");
assert.strictEqual(shortOrderNo({ displayOrderNo: "SHJD-260528-001", _id: "abcdef" }), "SHJD-260528-001");
assert.strictEqual(
  shortOrderNo({
    _id: "abcdef1234567890",
    createdAt: "2026-05-27T10:20:30.000Z",
    locationSnapshot: { city: "上海市", district: "嘉定区" },
  }),
  "SHJD-260527-OLD"
);
assert.strictEqual(shortOrderNo({ _id: "abcdef1234567890" }), "订单编号待生成");
assert.strictEqual(ratingValueText(3), "3分");
assert.strictEqual(ratingValueText(3.5), "3.5分");
assert.strictEqual(ratingReviewText(1.5), "很不满意");
assert.strictEqual(ratingReviewText(3.5), "一般");
assert.strictEqual(ratingReviewText(5), "非常满意");
assert.strictEqual(
  avatarUrlOf({
    avatarUrl: "cleaner.png",
    avatar: "legacy.png",
    profile: { avatarUrl: "profile.png" },
    cleanerProfile: { avatarUrl: "cleaner-profile.png" },
  }),
  "cleaner-profile.png"
);
assert.strictEqual(decorateCleaner({ displayName: "花开富贵", cleanerProfile: { avatarUrl: "cleaner-profile.png" } }).avatarUrl, "cleaner-profile.png");
assert.strictEqual(
  decorateOrder(
    {
      _id: "distance-order",
      customerOpenid: "customer-a",
      serviceType: "日常保洁",
      status: "confirmed",
      locationSnapshot: { city: "上海市", district: "嘉定区" },
      lat: 31.37482,
      lng: 121.26621,
    },
    "cleaner-a",
    "cleaner",
    { city: "上海市", district: "嘉定区", latitude: 31.3749, longitude: 121.2663 }
  ).distanceText,
  "<1km"
);
assert.strictEqual(decorateOrder({ _id: "reviewed-order", status: "completed", hasReview: true }, "", "customer").reviewedText, "已评价");

const mixedOrders = [
  { status: "waiting_response" },
  { status: "waiting_confirm" },
  { status: "assigned_pending" },
  { status: "assigned_waiting_accept" },
  { status: "confirmed" },
  { status: "in_service" },
  { status: "waiting_complete" },
  { status: "waiting_payment" },
  { status: "completed" },
  { status: "cancelled" },
];
assert.strictEqual(getOrderTabCount("pending", mixedOrders, "customer"), 2);
assert.strictEqual(getOrderTabCount("pending", mixedOrders, "cleaner"), 4);
assert.strictEqual(getOrderTabCount("ongoing", mixedOrders, "customer"), 4);
assert.strictEqual(getOrderTabCount("active", mixedOrders, "cleaner"), 4);
assert.strictEqual(getOrderTabCount("pending", [{ rawStatus: "pending", status: "waiting_response" }], "customer"), 1);
assert.deepStrictEqual(
  withOrderTabCounts(
    [
      { key: "all", name: "全部" },
      { key: "pending", name: "待处理" },
      { key: "ongoing", name: "进行中" },
      { key: "completed", name: "已完成" },
    ],
    mixedOrders,
    "customer"
  ).map((tab) => ({ key: tab.key, count: tab.count || 0 })),
  [
    { key: "all", count: 0 },
    { key: "pending", count: 2 },
    { key: "ongoing", count: 4 },
    { key: "completed", count: 0 },
  ]
);

assertStatusTransition(
  { status: "waiting_complete", customerOpenid: "customer-a", acceptedCleanerOpenid: "cleaner-a" },
  "completed",
  "customer-a",
  { rating: 5 }
);

assertStatusTransition(
  { status: "waiting_acceptance", customerOpenid: "customer-a", acceptedCleanerOpenid: "cleaner-a" },
  "completed",
  "customer-a",
  { rating: 5 }
);

mustThrow(
  "completion rating required",
  () =>
    assertStatusTransition(
      { status: "waiting_complete", customerOpenid: "customer-a", acceptedCleanerOpenid: "cleaner-a" },
      "completed",
      "customer-a"
    ),
  "请先完成评分后再验收"
);

mustThrow(
  "cleaner cannot confirm completion",
  () =>
    assertStatusTransition(
      { status: "waiting_complete", customerOpenid: "customer-a", acceptedCleanerOpenid: "cleaner-a" },
      "completed",
      "cleaner-a",
      { rating: 5 }
    ),
  "只有下单客户可以确认完成"
);

assertCompletionReviewInput({ rating: 0.5 });
assertCompletionReviewInput({ rating: 4.5 });
mustThrow("invalid completion rating", () => assertCompletionReviewInput({ rating: 0 }), "请选择 0.5-5 星评分");
mustThrow("invalid completion half rating", () => assertCompletionReviewInput({ rating: 4.7 }), "请选择 0.5 星递增的评分");
assert.strictEqual(isManualReview({ source: "manual", rating: 4.5 }), true);
assert.strictEqual(isManualReview({ source: "auto_acceptance", rating: 5 }), false);
assert.strictEqual(isManualReview({ source: "manual", rating: "" }), false);
assert.deepStrictEqual(
  normalizeReviewImageUrls([" cloud://a ", "", "cloud://b", "cloud://c", "cloud://d", "cloud://e", "cloud://f", "cloud://g"]),
  ["cloud://a", "cloud://b", "cloud://c", "cloud://d", "cloud://e", "cloud://f"]
);
assert.strictEqual(
  canEditReview(
    { createdAt: "2026-05-26T10:00:00.000Z", editCount: 0 },
    new Date("2026-05-27T09:59:59.000Z")
  ),
  true
);
assert.strictEqual(
  canEditReview(
    { createdAt: "2026-05-26T10:00:00.000Z", editCount: 0 },
    new Date("2026-05-27T10:00:01.000Z")
  ),
  false
);
assert.strictEqual(canEditReview({ createdAt: "2026-05-26T10:00:00.000Z", editCount: 1 }, new Date("2026-05-26T12:00:00.000Z")), false);

assert.strictEqual(normalizePaymentStatus({ status: "completed" }), "settled");
assert.strictEqual(normalizePaymentStatus({ status: "auto_completed" }), "settled");
assert.strictEqual(normalizePaymentStatus({ status: "cancelled", paidAt: "2026-05-26T10:00:00.000Z" }), "refunded");
assert.strictEqual(normalizePaymentStatus({ status: "waiting_payment" }), "pending_pay");
assert.strictEqual(normalizePaymentStatus({ status: "confirmed" }), "escrowed");
assert.strictEqual(canHideOrderForRole({ status: "completed" }, "customer"), true);
assert.strictEqual(canHideOrderForRole({ status: "auto_completed" }, "cleaner"), true);
assert.strictEqual(canHideOrderForRole({ status: "waiting_complete" }, "customer"), false);
assert.strictEqual(isSettledIncomeOrder({ status: "completed", paymentStatus: "settled" }), true);
assert.strictEqual(isSettledIncomeOrder({ status: "auto_completed", paymentStatus: "settled" }), true);
assert.strictEqual(isSettledIncomeOrder({ status: "completed", paymentStatus: "escrowed" }), false);
assert.strictEqual(autoAcceptanceHoursForOrder({ serviceType: "日常保洁" }), 48);
assert.strictEqual(autoAcceptanceHoursForOrder({ serviceType: "深度保洁" }), 72);

const decoratedCompletedOrder = decorateOrder(
  {
    _id: "order-card-1",
    customerOpenid: "customer-a",
    status: "completed",
    serviceType: "家务整理",
    durationHours: 3,
    scheduledAt: "2026/05/25 18:26",
    hasReview: true,
    distanceText: "距离未知",
    locationSnapshot: { city: "上海市", district: "嘉定区" },
  },
  "customer-a",
  "customer"
);
assert.strictEqual(decoratedCompletedOrder.serviceTypeText, "家务整理");
assert.strictEqual(decoratedCompletedOrder.serviceTimeText, "2026/05/25 18:26");
assert.strictEqual(decoratedCompletedOrder.statusStyle, "completed");
assert.strictEqual(decoratedCompletedOrder.reviewStatusText, "已评价");
assert.strictEqual(decoratedCompletedOrder.distanceText, "距离未知");
assert.strictEqual(decoratedCompletedOrder.statusBadgeText, "已完成");
assert.strictEqual(decoratedCompletedOrder.reviewBadgeText, "已评价");
assert.strictEqual(decoratedCompletedOrder.distanceDisplayText, "距离未知");
assert.strictEqual(decoratedCompletedOrder.nonLocalText, "");
assert.strictEqual(decoratedCompletedOrder.canManage, true);

const decoratedActiveOrder = decorateOrder(
  {
    _id: "order-card-2",
    customerOpenid: "customer-a",
    status: "waiting_complete",
    serviceType: "日常保洁",
    scheduledAt: "2026/05/25 20:00",
  },
  "cleaner-a",
  "cleaner"
);
assert.strictEqual(decoratedActiveOrder.statusStyle, "active");
assert.strictEqual(decoratedActiveOrder.reviewStatusText, "");
assert.strictEqual(decoratedActiveOrder.statusBadgeText, "待验收");
assert.strictEqual(decoratedActiveOrder.reviewBadgeText, "");
assert.strictEqual(decoratedActiveOrder.canManage, false);
const decoratedNonLocalOrder = decorateOrder(
  {
    _id: "order-card-3",
    customerOpenid: "customer-a",
    status: "waiting_response",
    serviceType: "深度保洁",
    scheduledAt: "2026/05/30 07:00",
    nonLocal: true,
  },
  "cleaner-a",
  "cleaner",
  { latitude: 31.2, longitude: 121.3 }
);
assert.strictEqual(decoratedNonLocalOrder.statusBadgeText, "可响应");
assert.strictEqual(decoratedNonLocalOrder.nonLocalText, "非同城");
assert.strictEqual(decoratedNonLocalOrder.distanceDisplayText, "");
assert.strictEqual(orderStatusStyle("waiting_payment"), "payment");
assert.deepStrictEqual(getOrderStatusCopy("waiting_payment", "customer"), {
  title: "待平台确认",
  desc: "支付能力待接入，当前订单暂不能进入履约流程。",
  badgeText: "待确认",
});
assert.deepStrictEqual(getOrderStatusCopy("waiting_payment", "cleaner"), {
  title: "待平台确认",
  desc: "试运营流程待平台确认。",
  badgeText: "待确认",
});
assert.strictEqual(roleAwareStatusLabel("waiting_payment", "customer"), "待平台确认");
assert.strictEqual(roleAwareStatusLabel("waiting_payment", "cleaner"), "待平台确认");
assert.strictEqual(roleAwareStatusLabel("waiting_complete", "customer"), "待验收");
assert.strictEqual(roleAwareStatusLabel("waiting_complete", "cleaner"), "待客户验收");
assert.strictEqual(roleAwareStatusLabel("waiting_acceptance", "customer"), "待验收");
assert.strictEqual(roleAwareStatusLabel("waiting_acceptance", "cleaner"), "待客户验收");
assert.strictEqual(roleAwareStatusTip("confirmed", "cleaner"), "订单已确认，请按约定时间上门服务");

const shanghaiDaily = miniprogramPricing.calculateOrderPrice({
  city: "上海市",
  serviceType: "日常保洁",
  durationHours: 3,
});
const harbinDaily = miniprogramPricing.calculateOrderPrice({
  city: "哈尔滨市",
  serviceType: "日常保洁",
  durationHours: 3,
});
assert.strictEqual(shanghaiDaily.orderAmount, 119);
assert.strictEqual(shanghaiDaily.listPrice, 145);
assert.strictEqual(shanghaiDaily.platformFee, 3.57);
assert.strictEqual(shanghaiDaily.cleanerIncome, 144);
assert.strictEqual(shanghaiDaily.cleanerHourlyIncome, 48);
assert.strictEqual(harbinDaily.orderAmount, 95);
assert.strictEqual(harbinDaily.platformFee, 2.85);
assert.strictEqual(harbinDaily.cleanerIncome, 120);
assert.strictEqual(harbinDaily.cleanerHourlyIncome, 40);
assert(shanghaiDaily.orderAmount > harbinDaily.orderAmount, "Shanghai daily price should be higher than Harbin");

const shanghaiDeep = miniprogramPricing.calculateOrderPrice({
  city: "上海市",
  serviceType: "深度保洁",
  durationHours: 3,
});
const shanghaiMoveIn = miniprogramPricing.calculateOrderPrice({
  city: "上海市",
  serviceType: "开荒保洁",
  durationHours: 3,
  areaSqm: 80,
});
assert(shanghaiMoveIn.orderAmount > shanghaiDeep.orderAmount, "move-in cleaning should be higher than deep cleaning");
assert(shanghaiDeep.orderAmount > shanghaiDaily.orderAmount, "deep cleaning should be higher than daily cleaning");

assert.strictEqual(shanghaiMoveIn.pricingMode, "area");
assert.strictEqual(shanghaiMoveIn.billableAreaSqm, 80);
assert.strictEqual(shanghaiMoveIn.orderAmount, 472);
assert.strictEqual(shanghaiDaily.isMinIncomeProtected, true);
assert(shanghaiDaily.cleanerHourlyIncome >= shanghaiDaily.minCleanerHourlyIncome);
assert.deepStrictEqual(cloudPricing.calculateOrderPrice({ city: "上海市", serviceType: "日常保洁", durationHours: 3 }), shanghaiDaily);

const autoReview = buildAutoAcceptanceReview({ _id: "order-auto", acceptedCleanerOpenid: "cleaner-a" });
assert.strictEqual(autoReview.rating, 5);
assert.strictEqual(autoReview.autoGenerated, true);
assert.strictEqual(autoReview.source, "auto_acceptance");

assert.strictEqual(
  isOrderOverdueForAutoAcceptance(
    { status: "waiting_complete", serviceFinishedAt: "2026-05-20T00:00:00.000Z" },
    new Date("2026-05-23T00:00:01.000Z")
  ),
  true
);
assert.strictEqual(
  isOrderOverdueForAutoAcceptance(
    { status: "waiting_complete", serviceFinishedAt: "2026-05-21T00:00:00.000Z" },
    new Date("2026-05-23T00:00:00.000Z")
  ),
  false
);

assertReviewAllowed(
  { _id: "order-a", status: "completed", customerOpenid: "customer-a", acceptedCleanerOpenid: "cleaner-a" },
  "customer-a",
  null
);

mustThrow(
  "duplicate review",
  () =>
    assertReviewAllowed(
      { _id: "order-a", status: "completed", customerOpenid: "customer-a", acceptedCleanerOpenid: "cleaner-a" },
      "customer-a",
      { _id: "review-a" }
    ),
  "该订单已评价"
);

const address = normalizeUserAddress({
  province: " 浙江省 ",
  city: "杭州市",
  district: "西湖区",
  street: "文三路街道",
  community: "梧桐小区",
  detailAddress: " 1幢 201 ",
  latitude: "30.123",
  longitude: "120.456",
});
assert.deepStrictEqual(address, {
  province: "浙江省",
  city: "杭州市",
  district: "西湖区",
  street: "文三路街道",
  community: "梧桐小区",
  detailAddress: "1幢 201",
  latitude: 30.123,
  longitude: 120.456,
});

mustThrow(
  "address community required",
  () =>
    normalizeUserAddress({
      province: "浙江省",
      city: "杭州市",
      district: "西湖区",
      detailAddress: "1幢 201",
    }),
  "请填写小区/社区名称"
);

mustThrow(
  "address detail required",
  () =>
    normalizeUserAddress({
      province: "浙江省",
      city: "杭州市",
      district: "西湖区",
      community: "梧桐小区",
    }),
  "请填写详细地址"
);

assert.deepStrictEqual(
  filterRecommendedCleanersByCity(
    [
      { _openid: "cleaner-hz", lastLocation: { city: "杭州市" } },
      { _openid: "cleaner-sh", lastLocation: { city: "上海市" } },
      { _openid: "cleaner-empty", lastLocation: {} },
    ],
    { city: "杭州市" }
  ).map((cleaner) => cleaner._openid),
  ["cleaner-hz"]
);

assert.deepStrictEqual(
  filterRecommendedCleanersByCity([{ _openid: "cleaner-hz", lastLocation: { city: "杭州市" } }], { city: "" }),
  []
);

const distance = haversineDistanceKm(
  { latitude: 30.2741, longitude: 120.1551 },
  { latitude: 30.2841, longitude: 120.1551 }
);
assert(distance > 1 && distance < 1.2, "distance should be about 1.1km");
assert.strictEqual(formatDistanceText(distance), "1.1km");
assert.strictEqual(formatDistanceText(null), "距离未知");

assert.deepStrictEqual(
  getCleanerDistanceText(
    { lastLocation: { latitude: 30.2741, longitude: 120.1551 } },
    { latitude: 30.2742, longitude: 120.1551 }
  ),
  { distanceKm: 0, distanceText: "<1km" }
);

assert.deepStrictEqual(
  getCleanerDistanceText(
    { currentLocation: { latitude: 30.3041, longitude: 120.1551 } },
    { latitude: 30.2741, longitude: 120.1551 }
  ),
  { distanceKm: 3.3, distanceText: "3.3km" }
);

assert.deepStrictEqual(getCleanerDistanceText({ lastLocation: {} }, { latitude: 30.2741, longitude: 120.1551 }), {
  distanceKm: null,
  distanceText: "距离未知",
});

const warn = console.warn;
console.warn = () => {};
assert.deepStrictEqual(
  getCleanerDistanceText(
    { location: { latitude: 31.2304, longitude: 121.4737, city: "杭州市" } },
    { latitude: 30.2741, longitude: 120.1551, city: "杭州市" }
  ),
  { distanceKm: null, distanceText: "距离待确认" }
);
console.warn = warn;

const scored = scoreRecommendedCleaner({
  distanceKm: 2,
  ratingAvg: 4.5,
  completedOrderCount: 20,
});
assert(scored > 0 && scored <= 100, "score should stay in 0-100 range");

assert.deepStrictEqual(
  sortRecommendedCleaners([
    { _openid: "far-busy", distanceKm: 8, ratingAvg: 5, completedOrderCount: 80 },
    { _openid: "near-good", distanceKm: 1, ratingAvg: 4.8, completedOrderCount: 20 },
    { _openid: "near-low", distanceKm: 1, ratingAvg: 3, completedOrderCount: 1 },
  ]).map((cleaner) => cleaner._openid),
  ["near-good", "far-busy", "near-low"]
);

const locatedShanghai = buildLocationStateFromPosition({
  latitude: 31.37482,
  longitude: 121.26621,
  address: {
    province: "上海市",
    city: "上海市",
    district: "嘉定区",
    township: "菊园新区",
  },
});
assert.deepStrictEqual(locatedShanghai.region, ["上海市", "上海市", "嘉定区"]);
assert.strictEqual(locatedShanghai.street, "菊园新区");
assert.strictEqual(locationDisplayText(locatedShanghai), "上海市 / 上海市 / 嘉定区 / 菊园新区");

const unknownLocated = buildLocationStateFromPosition({
  latitude: 31.37482,
  longitude: 121.26621,
});
assert.deepStrictEqual(unknownLocated.region, ["", "", ""]);
assert.strictEqual(unknownLocated.street, "");
assert.strictEqual(locationDisplayText(unknownLocated), "定位成功，请手动确认省市区");

assert.deepStrictEqual(
  removeRecentLocationAt([{ community: "梧桐小区" }, { community: "阳光花园" }], 0),
  [{ community: "阳光花园" }]
);

const normalizedQQMap = normalizeQQMapReverseGeocodeResult(
  {
    result: {
      address: "上海市嘉定区菊园新区胜竹路",
      address_component: {
        province: "上海市",
        city: "上海市",
        district: "嘉定区",
        street: "菊园新区",
      },
      formatted_addresses: {
        recommend: "上海市嘉定区菊园新区",
      },
      pois: [{ address: "上海市嘉定区胜竹路" }],
    },
  },
  { latitude: 31.37482, longitude: 121.26621 }
);
assert.deepStrictEqual(normalizedQQMap, {
  province: "上海市",
  city: "上海市",
  district: "嘉定区",
  street: "菊园新区",
  addressText: "上海市嘉定区菊园新区",
  latitude: 31.37482,
  longitude: 121.26621,
});

const normalizedQQMapFallbackStreet = normalizeQQMapReverseGeocodeResult(
  {
    result: {
      address: "上海市嘉定区菊园新区胜竹路",
      address_component: {
        province: "上海市",
        city: "上海市",
        district: "嘉定区",
        street: "",
      },
      formatted_addresses: {
        recommend: "上海市嘉定区菊园新区",
      },
    },
  },
  { latitude: 31.37482, longitude: 121.26621 }
);
assert.strictEqual(normalizedQQMapFallbackStreet.street, "菊园新区");

console.log("domain tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
