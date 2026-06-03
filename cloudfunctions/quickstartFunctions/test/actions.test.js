const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");

class MemoryDoc {
  constructor(collection, id) {
    this.collection = collection;
    this.id = id;
  }

  async get() {
    const record = this.collection.records.find((item) => item._id === this.id);
    return { data: record ? clone(record) : null };
  }

  async set({ data }) {
    const existingIndex = this.collection.records.findIndex((item) => item._id === this.id);
    const next = { ...(data || {}), _id: this.id };
    if (existingIndex >= 0) this.collection.records[existingIndex] = clone(next);
    else this.collection.records.push(clone(next));
    return { _id: this.id };
  }

  async update({ data }) {
    const existingIndex = this.collection.records.findIndex((item) => item._id === this.id);
    if (existingIndex < 0) return { updated: 0 };
    this.collection.records[existingIndex] = mergeUpdate(this.collection.records[existingIndex], data || {});
    return { updated: 1 };
  }

  async remove() {
    const before = this.collection.records.length;
    this.collection.records = this.collection.records.filter((item) => item._id !== this.id);
    this.collection.db.data[this.collection.name] = this.collection.records;
    return { deleted: before - this.collection.records.length };
  }
}

class MemoryCollection {
  constructor(db, name) {
    this.db = db;
    this.name = name;
    this.records = db.data[name] || [];
    this.query = null;
    this.limitSize = null;
    this.skipSize = 0;
    this.order = null;
  }

  fork() {
    const next = new MemoryCollection(this.db, this.name);
    next.query = this.query;
    next.limitSize = this.limitSize;
    next.skipSize = this.skipSize;
    next.order = this.order;
    return next;
  }

  where(query) {
    const next = this.fork();
    next.query = query || null;
    return next;
  }

  orderBy(field, direction) {
    const next = this.fork();
    next.order = { field, direction };
    return next;
  }

  skip(size) {
    const next = this.fork();
    next.skipSize = Number(size || 0);
    return next;
  }

  limit(size) {
    const next = this.fork();
    next.limitSize = Number(size || 0);
    return next;
  }

  doc(id) {
    return new MemoryDoc(this, id);
  }

  async add({ data }) {
    const id = (data && data._id) || `${this.name}-${this.records.length + 1}`;
    this.records.push(clone({ ...(data || {}), _id: id }));
    this.db.data[this.name] = this.records;
    return { _id: id };
  }

  async get() {
    let results = this.records.slice();
    if (this.query) {
      results = results.filter((item) => matchesQuery(item, this.query));
    }
    if (this.order) {
      const { field, direction } = this.order;
      results = results.sort((first, second) => {
        const firstValue = first[field] || "";
        const secondValue = second[field] || "";
        if (firstValue === secondValue) return 0;
        const result = firstValue > secondValue ? 1 : -1;
        return direction === "desc" ? -result : result;
      });
    }
    if (this.skipSize) results = results.slice(this.skipSize);
    if (this.limitSize) results = results.slice(0, this.limitSize);
    return { data: results.map(clone) };
  }
}

class MemoryDB {
  constructor(initialData = {}) {
    this.data = {};
    Object.entries(initialData).forEach(([name, records]) => {
      this.data[name] = records.map(clone);
    });
    this.command = {
      push(value) {
        return { __op: "push", value };
      },
    };
  }

  collection(name) {
    if (!this.data[name]) this.data[name] = [];
    return new MemoryCollection(this, name);
  }

  async createCollection(name) {
    if (this.data[name]) throw new Error("collection already exists");
    this.data[name] = [];
    return {};
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function mergeUpdate(record, patch) {
  const next = { ...record };
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (value && value.__op === "push") {
      next[key] = Array.isArray(next[key]) ? next[key].concat(value.value) : [value.value];
    } else {
      next[key] = value;
    }
  });
  return clone(next);
}

function matchesQuery(item, query) {
  return Object.entries(query).every(([key, value]) => {
    if (value && value.__op === "in") return value.values.includes(item[key]);
    return item[key] === value;
  });
}

function setEnv(env) {
  const previous = {};
  Object.keys(env).forEach((key) => {
    previous[key] = process.env[key];
    if (env[key] === undefined || env[key] === null) delete process.env[key];
    else process.env[key] = env[key];
  });
  return () => {
    Object.keys(env).forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  };
}

async function loadFunction({ openid = "user-a", db = new MemoryDB(), env = {} } = {}) {
  const originalLoad = Module._load;
  const indexPath = path.resolve(__dirname, "../index.js");
  delete require.cache[indexPath];
  const restoreEnv = setEnv({
    APP_ENV: undefined,
    NODE_ENV: undefined,
    WX_APP_ENV: undefined,
    ADMIN_OPENIDS: undefined,
    ...env,
  });
  const cloud = {
    DYNAMIC_CURRENT_ENV: "test-env",
    init() {},
    getWXContext() {
      return { OPENID: openid };
    },
    database() {
      return db;
    },
  };
  Module._load = function load(request, parent, isMain) {
    if (request === "wx-server-sdk") return cloud;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return { main: require(indexPath).main, db, restore: restoreEnv };
  } catch (error) {
    restoreEnv();
    throw error;
  } finally {
    Module._load = originalLoad;
  }
}

async function invoke(main, event) {
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    return await main(event);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
}

function expectFailed(result, code, message, name) {
  assert.strictEqual(result.success, false, `${name} should fail`);
  assert.strictEqual(result.code, code, `${name} code`);
  if (message) assert.strictEqual(result.message, message, `${name} message`);
}

function assertNoSensitiveKeys(value, keys, name) {
  keys.forEach((key) => {
    assert(value[key] === undefined || value[key] === null || value[key] === "", `${name} should not expose ${key}`);
  });
}

function assertHasOrderContact(order, name) {
  assert(order.contactPhone, `${name} should expose contactPhone`);
  assert(order.detailAddress, `${name} should expose detailAddress`);
  assert(order.addressText, `${name} should expose addressText`);
}

function assertPublicOrderSafe(order, name) {
  assertNoSensitiveKeys(order, ["customerOpenid", "contactPhone", "contactWechat", "detailAddress", "addressText"], name);
  assert(order.latitude === undefined || order.latitude === null || order.latitude === "", `${name} should not expose latitude`);
  assert(order.longitude === undefined || order.longitude === null || order.longitude === "", `${name} should not expose longitude`);
  assert(!Array.isArray(order.responses), `${name} should not expose full responses`);
}

function seedUser(openid, role) {
  return { _id: `user-${openid}`, _openid: openid, role, currentRole: role, roles: [role] };
}

function seedCustomerProfile(openid, overrides = {}) {
  return {
    _id: `customer-${openid}`,
    _openid: openid,
    role: "customer",
    nickname: "客户甲",
    avatarUrl: "customer.png",
    phone: "13800000000",
    contactWechat: "customer-wechat",
    internalNote: "customer-private-note",
    idCardFileID: "cloud://customer-id-card",
    address: {
      city: "杭州市",
      district: "西湖区",
      street: "文三路街道",
      community: "梧桐小区",
      detailAddress: "1幢201室",
      latitude: 30.123,
      longitude: 120.456,
    },
    ...overrides,
  };
}

function seedCleaner(openid, overrides = {}) {
  return {
    _id: `cleaner-${openid}`,
    _openid: openid,
    displayName: "王家洁师",
    avatarUrl: "cleaner.png",
    ratingAvg: 4.8,
    reviewCount: 12,
    completedOrderCount: 18,
    serviceAreas: ["梧桐小区"],
    serviceTypes: ["日常保洁"],
    experience: "8年经验",
    available: true,
    manualApproved: true,
    phoneVerified: true,
    phone: "13900000000",
    wechatContact: "cleaner-wechat",
    lastLocation: { city: "杭州市", district: "西湖区", latitude: 30.111, longitude: 120.222 },
    idCardFileID: "cloud://id-card",
    healthCertificateFileID: "cloud://health-card",
    insurancePolicyFileID: "cloud://policy-file",
    insurancePolicyNo: "POLICY-001",
    riskLevel: "internal-high",
    ...overrides,
  };
}

function seedOrder(overrides = {}) {
  return {
    _id: "order-a",
    customerOpenid: "customer-a",
    acceptedCleanerOpenid: "cleaner-a",
    assignedCleanerOpenid: "",
    cleanerId: "cleaner-a",
    publishMode: "public",
    serviceType: "日常保洁",
    status: "confirmed",
    paymentStatus: "escrowed",
    city: "杭州市",
    district: "西湖区",
    street: "文三路街道",
    community: "梧桐小区",
    detailAddress: "1幢201室",
    addressText: "杭州市西湖区文三路街道梧桐小区1幢201室",
    latitude: 30.123,
    longitude: 120.456,
    locationSnapshot: {
      city: "杭州市",
      district: "西湖区",
      street: "文三路街道",
      community: "梧桐小区",
      detailAddress: "1幢201室",
      latitude: 30.123,
      longitude: 120.456,
    },
    contactPhone: "13800000000",
    contactWechat: "customer-wechat",
    responses: [{ cleanerId: "cleaner-a", status: "selected" }],
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    ...overrides,
  };
}

function createPrivacyDB(extra = {}) {
  return new MemoryDB({
    users: [
      seedUser("customer-a", "customer"),
      seedUser("customer-b", "customer"),
      seedUser("cleaner-a", "cleaner"),
      seedUser("cleaner-b", "cleaner"),
      seedUser("admin-a", "admin"),
    ],
    adminUsers: [{ _id: "admin-a", openid: "admin-a", active: true }],
    customerProfiles: [seedCustomerProfile("customer-a"), seedCustomerProfile("customer-b", { nickname: "客户乙" })],
    cleaners: [seedCleaner("cleaner-a"), seedCleaner("cleaner-b", { displayName: "李家洁师" })],
    orders: [seedOrder()],
    favorites: [],
    reviews: [],
    auditLogs: [],
    supportTickets: [],
    ...extra,
  });
}

function oldWaitingCompleteOrder() {
  return seedOrder({
    _id: "order-overdue",
    status: "waiting_complete",
    paymentStatus: "escrowed",
    serviceFinishedAt: "2026-05-20T00:00:00.000Z",
    serviceCompletedAt: "2026-05-20T00:00:00.000Z",
  });
}

async function runProductionGateTests() {
  for (const env of [{}, { APP_ENV: "production" }]) {
    const context = await loadFunction({ openid: "customer-a", db: createPrivacyDB(), env });
    try {
      const result = await invoke(context.main, { action: "mockPayOrder", data: { orderId: "order-a" } });
      expectFailed(result, "PRODUCTION_DISABLED", "正式环境不支持模拟支付", `mockPayOrder ${JSON.stringify(env)}`);
    } finally {
      context.restore();
    }
  }

  const devContext = await loadFunction({ openid: "customer-a", db: createPrivacyDB(), env: { APP_ENV: "development" } });
  try {
    const result = await invoke(devContext.main, { action: "mockPayOrder", data: { orderId: "missing-order" } });
    assert.strictEqual(result.success, false);
    assert.notStrictEqual(result.code, "PRODUCTION_DISABLED", "development mockPayOrder should reach business validation");
    assert.strictEqual(result.message, "订单不存在");
  } finally {
    devContext.restore();
  }

  const prodCustomDaysDb = createPrivacyDB({ orders: [oldWaitingCompleteOrder()] });
  const prodCustomDays = await loadFunction({ openid: "admin-a", db: prodCustomDaysDb, env: { APP_ENV: "production", ADMIN_OPENIDS: "admin-a" } });
  try {
    const result = await invoke(prodCustomDays.main, { action: "autoAcceptOverdueOrders", data: { days: 0.1 } });
    expectFailed(result, "PRODUCTION_DISABLED", "正式环境自动验收不允许自定义天数", "production autoAcceptOverdueOrders custom days");
  } finally {
    prodCustomDays.restore();
  }

  const prodDefaultDaysDb = createPrivacyDB({ orders: [oldWaitingCompleteOrder()] });
  const prodDefaultDays = await loadFunction({ openid: "admin-a", db: prodDefaultDaysDb, env: { APP_ENV: "production", ADMIN_OPENIDS: "admin-a" } });
  try {
    const result = await invoke(prodDefaultDays.main, { action: "autoAcceptOverdueOrders", data: {} });
    assert.strictEqual(result.success, true, "production autoAcceptOverdueOrders default days should be allowed");
  } finally {
    prodDefaultDays.restore();
  }

  const devCustomDaysDb = createPrivacyDB({ orders: [oldWaitingCompleteOrder()] });
  const devCustomDays = await loadFunction({ openid: "admin-a", db: devCustomDaysDb, env: { APP_ENV: "development", ADMIN_OPENIDS: "admin-a" } });
  try {
    const result = await invoke(devCustomDays.main, { action: "autoAcceptOverdueOrders", data: { days: 0.1 } });
    assert.strictEqual(result.success, true, "development autoAcceptOverdueOrders custom days should be allowed for tests");
  } finally {
    devCustomDays.restore();
  }
}

async function runAdminGateTests() {
  for (const action of ["initCollections", "migrateOrderPaymentStatus", "migrateOrderNos", "autoAcceptOverdueOrders"]) {
    const context = await loadFunction({ openid: "customer-a", db: createPrivacyDB(), env: { APP_ENV: "development" } });
    try {
      const result = await invoke(context.main, { action, data: {} });
      expectFailed(result, "FORBIDDEN", "无管理员权限", action);
    } finally {
      context.restore();
    }
  }

  const prodAdmin = await loadFunction({ openid: "admin-a", db: createPrivacyDB(), env: { APP_ENV: "production", ADMIN_OPENIDS: "admin-a" } });
  try {
    const result = await invoke(prodAdmin.main, { action: "migrateOrderPaymentStatus", data: {} });
    expectFailed(result, "CONFIRM_REQUIRED", "正式环境执行 migrateOrderPaymentStatus 需要显式确认", "production migration confirm");
  } finally {
    prodAdmin.restore();
  }
}

async function runReadDoesNotAutoAcceptTests() {
  for (const action of ["listMyOrders", "getOrderDetail", "getIncomeStats"]) {
    const db = createPrivacyDB({ orders: [oldWaitingCompleteOrder()] });
    const context = await loadFunction({ openid: action === "getIncomeStats" ? "cleaner-a" : "customer-a", db, env: { APP_ENV: "production" } });
    try {
      const data = action === "getOrderDetail" ? { orderId: "order-overdue" } : {};
      await invoke(context.main, { action, data });
      assert.strictEqual(db.data.orders[0].status, "waiting_complete", `${action} should not auto accept`);
      assert.strictEqual(db.data.orders[0].paymentStatus, "escrowed", `${action} should not settle`);
    } finally {
      context.restore();
    }
  }

  const db = createPrivacyDB({ orders: [oldWaitingCompleteOrder()] });
  const adminContext = await loadFunction({ openid: "admin-a", db, env: { APP_ENV: "development", ADMIN_OPENIDS: "admin-a" } });
  try {
    const result = await invoke(adminContext.main, { action: "autoAcceptOverdueOrders", data: { days: 1 } });
    assert.strictEqual(result.success, true);
    assert.strictEqual(db.data.orders[0].status, "auto_completed");
    assert(db.data.auditLogs.length > 0, "autoAcceptOverdueOrders should write audit log");
  } finally {
    adminContext.restore();
  }
}

async function runCustomerPrivacyTests() {
  const context = await loadFunction({ openid: "customer-a", db: createPrivacyDB(), env: { APP_ENV: "production" } });
  try {
    const result = await invoke(context.main, { action: "getCustomerProfile", data: { customerOpenid: "customer-b" } });
    expectFailed(result, "FORBIDDEN", "无管理员权限", "getCustomerProfile other customer");
  } finally {
    context.restore();
  }

  const unselected = await loadFunction({
    openid: "cleaner-b",
    db: createPrivacyDB({
      orders: [
        seedOrder({
          _id: "order-unselected",
          status: "waiting_payment",
          acceptedCleanerOpenid: "cleaner-a",
          responses: [{ cleanerId: "cleaner-b", status: "pending" }],
        }),
      ],
    }),
    env: { APP_ENV: "production" },
  });
  try {
    const result = await invoke(unselected.main, { action: "getOrderDetail", data: { orderId: "order-unselected" } });
    assert.strictEqual(result.success, true);
    assertNoSensitiveKeys(result.data.order, ["contactPhone", "contactWechat", "detailAddress", "addressText"], "unselected order");
    assertNoSensitiveKeys(result.data.customerProfile, ["phone", "contactWechat", "_openid", "idCardFileID", "internalNote"], "unselected customer profile");
    assertNoSensitiveKeys(result.data.customerProfile.address || {}, ["detailAddress", "latitude", "longitude"], "unselected customer address");
  } finally {
    unselected.restore();
  }

  const confirmed = await loadFunction({ openid: "cleaner-a", db: createPrivacyDB(), env: { APP_ENV: "production" } });
  try {
    const result = await invoke(confirmed.main, { action: "getOrderDetail", data: { orderId: "order-a" } });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.customerProfile.phone, "13800000000");
    assert.strictEqual(result.data.customerProfile.address.detailAddress, "1幢201室");
    assertNoSensitiveKeys(result.data.customerProfile, ["_openid", "idCardFileID", "internalNote"], "confirmed cleaner customer profile");
    assertNoSensitiveKeys(result.data.customerProfile.address, ["latitude", "longitude"], "confirmed cleaner customer address");
  } finally {
    confirmed.restore();
  }

  const owner = await loadFunction({ openid: "customer-a", db: createPrivacyDB(), env: { APP_ENV: "production" } });
  try {
    const result = await invoke(owner.main, { action: "getCustomerProfile", data: {} });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.customerProfile.phone, "13800000000");
    assertNoSensitiveKeys(result.data.customerProfile, ["_openid", "idCardFileID", "internalNote"], "owner customer profile");
  } finally {
    owner.restore();
  }
}

async function runOrderViewerRegressionTests() {
  for (const status of ["waiting_response", "waiting_payment"]) {
    const db = createPrivacyDB({
      orders: [
        seedOrder({
          _id: `owner-${status}`,
          status,
          paymentStatus: status === "waiting_payment" ? "pending_pay" : "unpaid",
          acceptedCleanerOpenid: status === "waiting_payment" ? "cleaner-a" : "",
          cleanerId: status === "waiting_payment" ? "cleaner-a" : "",
          responses: status === "waiting_payment" ? [{ cleanerId: "cleaner-a", status: "selected" }] : [],
        }),
      ],
    });
    const context = await loadFunction({ openid: "customer-a", db, env: { APP_ENV: "production" } });
    try {
      const detail = await invoke(context.main, { action: "getOrderDetail", data: { orderId: `owner-${status}` } });
      assert.strictEqual(detail.success, true);
      assertHasOrderContact(detail.data.order, `owner detail ${status}`);
      const list = await invoke(context.main, { action: "listMyOrders", data: {} });
      assert.strictEqual(list.success, true);
      assertHasOrderContact(list.data[0], `owner list ${status}`);
    } finally {
      context.restore();
    }
  }

  const openDb = createPrivacyDB({
    orders: [
      seedOrder({
        _id: "open-order",
        status: "waiting_response",
        paymentStatus: "unpaid",
        acceptedCleanerOpenid: "",
        cleanerId: "",
        responses: [
          { cleanerId: "cleaner-a", status: "pending", phone: "13900000000" },
          { cleanerId: "cleaner-c", status: "pending", phone: "13600000000" },
        ],
      }),
    ],
  });
  const openContext = await loadFunction({ openid: "cleaner-b", db: openDb, env: { APP_ENV: "production" } });
  try {
    const list = await invoke(openContext.main, { action: "listOpenOrders", data: { scope: "all" } });
    assert.strictEqual(list.success, true);
    assert.strictEqual(list.data.length, 1);
    assertPublicOrderSafe(list.data[0], "listOpenOrders");
    assert.strictEqual(list.data[0].responseCount, 2, "listOpenOrders should expose responseCount");
  } finally {
    openContext.restore();
  }

  const unselectedDb = createPrivacyDB({
    orders: [
      seedOrder({
        _id: "waiting-confirm",
        status: "waiting_confirm",
        paymentStatus: "unpaid",
        acceptedCleanerOpenid: "",
        cleanerId: "",
        responses: [
          { cleanerId: "cleaner-b", status: "pending", quotedAmount: 100 },
          { cleanerId: "cleaner-a", status: "pending", quotedAmount: 120 },
        ],
      }),
    ],
  });
  const unselected = await loadFunction({ openid: "cleaner-b", db: unselectedDb, env: { APP_ENV: "production" } });
  try {
    const result = await invoke(unselected.main, { action: "getOrderDetail", data: { orderId: "waiting-confirm" } });
    assert.strictEqual(result.success, true);
    assertPublicOrderSafe(result.data.order, "unselected cleaner order detail");
    assert.strictEqual(result.data.order.responseCount, 2);
    assert.deepStrictEqual(result.data.order.myResponse, { cleanerId: "cleaner-b", status: "pending" });
  } finally {
    unselected.restore();
  }

  const owner = await loadFunction({ openid: "customer-a", db: unselectedDb, env: { APP_ENV: "production" } });
  try {
    const result = await invoke(owner.main, { action: "getOrderDetail", data: { orderId: "waiting-confirm" } });
    assert.strictEqual(result.success, true);
    assert(Array.isArray(result.data.order.responses), "customer owner should still see responses");
    assert.strictEqual(result.data.order.responses.length, 2);
  } finally {
    owner.restore();
  }
}

async function runCleanerPrivacyTests() {
  const malformedDb = createPrivacyDB({
    cleaners: [seedCleaner("cleaner-a"), { _id: "malformed", phone: "13911112222", wechatContact: "leak", manualApproved: true, available: true }],
  });
  const listContext = await loadFunction({ openid: "customer-a", db: malformedDb, env: { APP_ENV: "production" } });
  try {
    const listResult = await invoke(listContext.main, { action: "listCleaners", data: {} });
    assert.strictEqual(listResult.success, true);
    listResult.data.forEach((cleaner) => {
      assertNoSensitiveKeys(
        cleaner,
        ["phone", "wechatContact", "lastLocation", "idCardFileID", "healthCertificateFileID", "insurancePolicyFileID", "insurancePolicyNo", "riskLevel", "_openid"],
        "public cleaner"
      );
    });

    const detailResult = await invoke(listContext.main, { action: "getCleanerDetail", data: { cleanerOpenid: "cleaner-a" } });
    assert.strictEqual(detailResult.success, true);
    assertNoSensitiveKeys(
      detailResult.data.cleaner,
      ["phone", "wechatContact", "lastLocation", "idCardFileID", "healthCertificateFileID", "insurancePolicyFileID", "insurancePolicyNo", "riskLevel", "_openid"],
      "cleaner detail"
    );
  } finally {
    listContext.restore();
  }

  const reviewDb = createPrivacyDB({
    orders: [
      seedOrder({
        _id: "review-order",
        status: "completed",
        paymentStatus: "settled",
        serviceType: "深度保洁",
      }),
    ],
    reviews: [
      {
        _id: "review-public",
        orderId: "review-order",
        customerOpenid: "customer-a",
        cleanerOpenid: "cleaner-a",
        serviceType: "",
        rating: 4.5,
        content: "服务认真，沟通顺畅",
        imageUrls: ["cloud://review-image"],
        source: "manual",
        editCount: 1,
        internalNote: "review-internal-note",
        moderationStatus: "approved",
        createdAt: "2026-05-21T10:00:00.000Z",
        updatedAt: "2026-05-22T10:00:00.000Z",
      },
    ],
  });
  const reviewContext = await loadFunction({ openid: "customer-b", db: reviewDb, env: { APP_ENV: "production" } });
  try {
    const result = await invoke(reviewContext.main, { action: "getCleanerDetail", data: { cleanerOpenid: "cleaner-a" } });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.recentReviews.length, 1);
    const review = result.data.recentReviews[0];
    assertNoSensitiveKeys(
      review,
      ["customerOpenid", "cleanerOpenid", "orderId", "source", "editCount", "internalNote", "moderationStatus"],
      "public recent review"
    );
    assert.strictEqual(review._id, "review-public");
    assert.strictEqual(review.rating, 4.5);
    assert.strictEqual(review.content, "服务认真，沟通顺畅");
    assert.deepStrictEqual(review.imageUrls, ["cloud://review-image"]);
    assert.strictEqual(review.customerNameMasked, "客***");
    assert.strictEqual(review.serviceType, "深度保洁");
    assert.strictEqual(review.createdAt, "2026-05-21T10:00:00.000Z");
    assert.strictEqual(review.updatedAt, "2026-05-22T10:00:00.000Z");
  } finally {
    reviewContext.restore();
  }

  const confirmed = await loadFunction({ openid: "customer-a", db: createPrivacyDB(), env: { APP_ENV: "production" } });
  try {
    const result = await invoke(confirmed.main, { action: "getOrderDetail", data: { orderId: "order-a" } });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.cleaner.phone, "13900000000");
    assert.strictEqual(result.data.cleaner.wechatContact, "cleaner-wechat");
    assertNoSensitiveKeys(
      result.data.cleaner,
      ["lastLocation", "idCardFileID", "healthCertificateFileID", "insurancePolicyFileID", "insurancePolicyNo", "riskLevel", "_openid"],
      "confirmed order cleaner"
    );
  } finally {
    confirmed.restore();
  }

  for (const status of ["waiting_payment", "assigned_waiting_accept", "waiting_response"]) {
    const db = createPrivacyDB({
      orders: [
        seedOrder({
          _id: `customer-cleaner-contact-${status}`,
          status,
          paymentStatus: status === "waiting_payment" ? "pending_pay" : "unpaid",
          publishMode: status === "assigned_waiting_accept" ? "assigned" : "public",
          acceptedCleanerOpenid: status === "waiting_payment" ? "cleaner-a" : "",
          assignedCleanerOpenid: status === "assigned_waiting_accept" ? "cleaner-a" : "",
          cleanerId: "cleaner-a",
          responses: status === "waiting_response" ? [] : [{ cleanerId: "cleaner-a", status: "selected" }],
        }),
      ],
    });
    const context = await loadFunction({ openid: "customer-a", db, env: { APP_ENV: "production" } });
    try {
      const result = await invoke(context.main, { action: "getOrderDetail", data: { orderId: `customer-cleaner-contact-${status}` } });
      assert.strictEqual(result.success, true);
      assertNoSensitiveKeys(result.data.cleaner || {}, ["phone", "wechatContact"], `customer ${status} cleaner profile`);
    } finally {
      context.restore();
    }
  }

  const cleanerSelf = await loadFunction({ openid: "cleaner-a", db: createPrivacyDB(), env: { APP_ENV: "production" } });
  try {
    const result = await invoke(cleanerSelf.main, { action: "getCleanerProfile", data: {} });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.cleanerProfile.phone, "13900000000");
    assert.strictEqual(result.data.cleanerProfile.wechatContact, "cleaner-wechat");
  } finally {
    cleanerSelf.restore();
  }

  const admin = await loadFunction({ openid: "admin-a", db: createPrivacyDB(), env: { APP_ENV: "production", ADMIN_OPENIDS: "admin-a" } });
  try {
    const result = await invoke(admin.main, { action: "getOrderDetail", data: { orderId: "order-a" } });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.cleaner.phone, "13900000000");
    assert.strictEqual(result.data.cleaner.wechatContact, "cleaner-wechat");
    assert.strictEqual(result.data.customerProfile.phone, "13800000000");
  } finally {
    admin.restore();
  }
}

function assertAuditSafe(db, text) {
  const serialized = JSON.stringify(db.data.auditLogs || []);
  assert(serialized.includes(text), `audit log should include ${text}`);
  ["13800000000", "customer-wechat", "1幢201室", "cloud://id-card", "POLICY-001", "30.123", "120.456"].forEach((secret) => {
    assert(!serialized.includes(secret), `audit log should redact ${secret}`);
  });
}

async function runAuditLogTests() {
  const cases = [
    { action: "updateOrderStatus", data: { orderId: "order-a", status: "in_service" }, actor: "cleaner-a", expected: "updateOrderStatus" },
    { action: "updateOrderStatus", data: { orderId: "order-a", status: "cancelled" }, actor: "customer-a", expected: "updateOrderStatus", order: seedOrder({ status: "waiting_response", paymentStatus: "unpaid", acceptedCleanerOpenid: "" }) },
    { action: "updateOrderStatus", data: { orderId: "order-a", status: "waiting_acceptance" }, actor: "cleaner-a", expected: "updateOrderStatus", order: seedOrder({ status: "in_service", paymentStatus: "escrowed" }) },
    { action: "hideOrderForRole", data: { orderId: "order-a", role: "customer" }, actor: "customer-a", expected: "hideOrderForRole", order: seedOrder({ status: "completed", paymentStatus: "settled" }) },
    { action: "updateCleanerAvailability", data: { available: false }, actor: "cleaner-a", expected: "updateCleanerAvailability" },
  ];

  for (const item of cases) {
    const db = createPrivacyDB(item.order ? { orders: [item.order] } : {});
    const context = await loadFunction({ openid: item.actor, db, env: { APP_ENV: "development" } });
    try {
      const result = await invoke(context.main, { action: item.action, data: item.data });
      assert.strictEqual(result.success, true, `${item.action} should succeed`);
      assertAuditSafe(db, item.expected);
    } finally {
      context.restore();
    }
  }
}

async function runSupportTicketTests() {
  const stranger = await loadFunction({ openid: "customer-b", db: createPrivacyDB(), env: { APP_ENV: "production" } });
  try {
    const result = await invoke(stranger.main, { action: "createSupportTicket", data: { orderId: "order-a", description: "我想看别人的订单" } });
    expectFailed(result, "FORBIDDEN", "无权为该订单提交工单", "support ticket stranger");
  } finally {
    stranger.restore();
  }

  for (const actor of ["customer-a", "cleaner-a"]) {
    const db = createPrivacyDB();
    const context = await loadFunction({ openid: actor, db, env: { APP_ENV: "production" } });
    try {
      const result = await invoke(context.main, { action: "createSupportTicket", data: { orderId: "order-a", description: "订单需要协助" } });
      assert.strictEqual(result.success, true);
      assert.strictEqual(db.data.supportTickets.length, 1);
      assert.strictEqual(db.data.supportTickets[0].orderId, "order-a");
      assert.strictEqual(db.data.supportTickets[0].actorRole, actor === "customer-a" ? "customer" : "cleaner");
      assert(!JSON.stringify(result.data).includes("13800000000"), "support response should not expose order details");
    } finally {
      context.restore();
    }
  }

  const adminDb = createPrivacyDB();
  const admin = await loadFunction({ openid: "admin-a", db: adminDb, env: { APP_ENV: "production", ADMIN_OPENIDS: "admin-a" } });
  try {
    const result = await invoke(admin.main, { action: "createSupportTicket", data: { orderId: "order-a", description: "管理员协助" } });
    assert.strictEqual(result.success, true);
    assert.strictEqual(adminDb.data.supportTickets[0].actorRole, "admin");
  } finally {
    admin.restore();
  }

  const generalDb = createPrivacyDB();
  const general = await loadFunction({ openid: "customer-b", db: generalDb, env: { APP_ENV: "production" } });
  try {
    const result = await invoke(general.main, { action: "createSupportTicket", data: { orderNo: "HJ-001", description: "普通反馈" } });
    assert.strictEqual(result.success, true);
    assert.strictEqual(generalDb.data.supportTickets[0].orderNo, "HJ-001");
  } finally {
    general.restore();
  }
}

function listRegisteredPages() {
  const appJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../miniprogram/app.json"), "utf8"));
  return appJson.pages || [];
}

function runStaticMiniprogramTests() {
  const root = path.resolve(__dirname, "../../..");
  const pages = listRegisteredPages();
  pages.forEach((pagePath) => {
    ["js", "wxml", "wxss", "json"].forEach((ext) => {
      assert(fs.existsSync(path.join(root, "miniprogram", `${pagePath}.${ext}`)), `${pagePath}.${ext} should exist`);
    });
  });

  const requiredPages = [
    "pages/support/index",
    "pages/legal/user-agreement/index",
    "pages/legal/privacy-policy/index",
    "pages/legal/platform-rules/index",
    "pages/legal/service-guarantee/index",
    "pages/legal/refund-cancellation/index",
    "pages/legal/account-deletion/index",
  ];
  requiredPages.forEach((page) => assert(pages.includes(page), `${page} should be registered`));

  const miniprogramText = readFiles(path.join(root, "miniprogram"));
  assert(!/\bENABLE_MOCK_PAYMENT\b/.test(miniprogramText), "ENABLE_MOCK_PAYMENT should not remain in miniprogram");
  assert(!/mockPayOrder/.test(miniprogramText), "miniprogram should not call mockPayOrder");
  ["暂未开放", "百万保障", "全额赔付", "已投保", "平台托管中", "支付到平台托管", "费用已由平台托管"].forEach((phrase) => {
    assert(!miniprogramText.includes(phrase), `miniprogram should not contain ${phrase}`);
  });

  const files = listTextFiles(path.join(root, "miniprogram"));
  const cleanerOpenidUses = files
    .filter((file) => /cleaner\._openid/.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(root, file).replace(/\\/g, "/"));
  assert.deepStrictEqual(cleanerOpenidUses, ["miniprogram/utils/cleaner-id.js"], "cleaner._openid should only remain in cleanerOpenidOf helper");
  const orderCreateText = fs.readFileSync(path.join(root, "miniprogram/pages/order-create/index.js"), "utf8");
  const orderDetailText = fs.readFileSync(path.join(root, "miniprogram/pages/order-detail/index.js"), "utf8");
  const formatText = fs.readFileSync(path.join(root, "miniprogram/utils/format.js"), "utf8");
  const cloudIndexText = fs.readFileSync(path.join(root, "cloudfunctions/quickstartFunctions/index.js"), "utf8");
  assert(orderCreateText.includes("cleanerOpenidOf"), "order-create should use cleanerOpenidOf");
  assert(orderDetailText.includes("cleanerOpenidOf"), "order-detail should use cleanerOpenidOf");
  assert(/Boolean\(order\.myResponse\)|order\.myResponse/.test(orderDetailText), "order-detail should include order.myResponse in hasResponse");
  assert(/responseCount:\s*Number\(order\.responseCount\s*\?\?/.test(formatText), "decorateOrder should preserve backend responseCount");
  assert(
    !/function decorateReviewForDisplay[\s\S]*?return\s*{\s*\.\.\.review/.test(cloudIndexText),
    "decorateReviewForDisplay should not spread raw review fields"
  );

  const { decorateOrder } = require(path.join(root, "miniprogram/utils/format.js"));
  const decorated = decorateOrder(
    seedOrder({
      _id: "static-response-count",
      status: "waiting_confirm",
      responseCount: 2,
      responses: undefined,
    }),
    "cleaner-b",
    "cleaner"
  );
  assert.strictEqual(decorated.responseCount, 2, "decorateOrder should preserve responseCount when responses are hidden");
}

function readFiles(dir) {
  let text = "";
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) text += readFiles(full);
    else if (/\.(js|wxml|wxss|json)$/.test(entry.name)) text += fs.readFileSync(full, "utf8") + "\n";
  }
  return text;
}

function listTextFiles(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files = files.concat(listTextFiles(full));
    else if (/\.(js|wxml|wxss|json)$/.test(entry.name)) files.push(full);
  }
  return files;
}

runProductionGateTests()
  .then(runAdminGateTests)
  .then(runReadDoesNotAutoAcceptTests)
  .then(runCustomerPrivacyTests)
  .then(runOrderViewerRegressionTests)
  .then(runCleanerPrivacyTests)
  .then(runAuditLogTests)
  .then(runSupportTicketTests)
  .then(runStaticMiniprogramTests)
  .then(() => {
    console.log("action tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
