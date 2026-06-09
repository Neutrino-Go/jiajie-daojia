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

  async update({ data }) {
    let updated = 0;
    this.records = this.records.map((item) => {
      if (this.query && !matchesQuery(item, this.query)) return item;
      updated += 1;
      return mergeUpdate(item, data || {});
    });
    this.db.data[this.name] = this.records;
    return { updated, stats: { updated } };
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
  assertNoSensitiveKeys(
    order,
    ["customerOpenid", "contactPhone", "contactWechat", "detailAddress", "addressText", "note", "acceptedCleanerOpenid", "assignedCleanerOpenid", "cleanerId"],
    name
  );
  assert(order.latitude === undefined || order.latitude === null || order.latitude === "", `${name} should not expose latitude`);
  assert(order.longitude === undefined || order.longitude === null || order.longitude === "", `${name} should not expose longitude`);
  assert(!Array.isArray(order.responses), `${name} should not expose full responses`);
}

function assertNoAfterSalePrivateFields(order, name) {
  assertNoSensitiveKeys(
    order,
    ["activeClaimId", "lastClaimAt", "serviceProof", "beforePhotoUrls", "completionPhotoUrls", "completionImageUrls", "completionPhotos", "serviceProofImageUrls"],
    name
  );
  assert(order.afterSaleStatus === undefined || order.afterSaleStatus === "", `${name} should not expose afterSaleStatus`);
  assert(order.claimCount === undefined || Number(order.claimCount || 0) === 0, `${name} should not expose claimCount`);
}

function assertPublicOrderReview(review, name, options = {}) {
  assert(review, `${name} should include public review`);
  assertNoSensitiveKeys(
    review,
    ["customerOpenid", "cleanerOpenid", "orderId", "source", "editCount", "internalNote", "moderationStatus"],
    name
  );
  assert.strictEqual(review._id, options._id || "review-payload");
  assert.strictEqual(review.rating, options.rating || 4.5);
  assert.strictEqual(review.content, options.content || "review content");
  assert.deepStrictEqual(review.imageUrls, options.imageUrls || ["cloud://review-image"]);
  assert.strictEqual(review.createdAt, options.createdAt || "2026-05-21T10:00:00.000Z");
  assert.strictEqual(review.updatedAt, options.updatedAt || "2026-05-22T10:00:00.000Z");
  if (options.serviceType !== undefined) assert.strictEqual(review.serviceType, options.serviceType);
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
    pricingRules: [],
    pricingQuotes: [],
    coupons: [],
    serviceStandards: [],
    protectionPlans: [],
    protectionClaims: [],
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
          note: "Door code 1234, phone 13800000000, test only",
          responses: status === "waiting_payment" ? [{ cleanerId: "cleaner-a", status: "selected" }] : [],
        }),
      ],
    });
    const context = await loadFunction({ openid: "customer-a", db, env: { APP_ENV: "production" } });
    try {
      const detail = await invoke(context.main, { action: "getOrderDetail", data: { orderId: `owner-${status}` } });
      assert.strictEqual(detail.success, true);
      assertHasOrderContact(detail.data.order, `owner detail ${status}`);
      assert.strictEqual(detail.data.order.note, "Door code 1234, phone 13800000000, test only", `owner detail ${status} should expose own note`);
      const list = await invoke(context.main, { action: "listMyOrders", data: {} });
      assert.strictEqual(list.success, true);
      assertHasOrderContact(list.data[0], `owner list ${status}`);
      assert.strictEqual(list.data[0].note, "Door code 1234, phone 13800000000, test only", `owner list ${status} should expose own note`);
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
        acceptedCleanerOpenid: "cleaner-a",
        assignedCleanerOpenid: "cleaner-a",
        cleanerId: "cleaner-a",
        note: "Door code 1234, phone 13800000000, test only",
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
        acceptedCleanerOpenid: "cleaner-a",
        assignedCleanerOpenid: "cleaner-a",
        cleanerId: "cleaner-a",
        note: "Door code 1234, phone 13800000000, test only",
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
    assert.strictEqual(result.data.order.note, "Door code 1234, phone 13800000000, test only");
    assert.strictEqual(result.data.order.acceptedCleanerOpenid, "cleaner-a");
    assert.strictEqual(result.data.order.cleanerId, "cleaner-a");
  } finally {
    owner.restore();
  }

  for (const status of ["confirmed", "in_service", "waiting_complete", "completed"]) {
    const db = createPrivacyDB({
      orders: [
        seedOrder({
          _id: `confirmed-note-${status}`,
          status,
          paymentStatus: "escrowed",
          note: "Door code 1234, phone 13800000000, test only",
        }),
      ],
    });
    const context = await loadFunction({ openid: "cleaner-a", db, env: { APP_ENV: "production" } });
    try {
      const result = await invoke(context.main, { action: "getOrderDetail", data: { orderId: `confirmed-note-${status}` } });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.order.note, "Door code 1234, phone 13800000000, test only", `accepted cleaner ${status} should expose fulfillment note`);
    } finally {
      context.restore();
    }
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

async function runOrderReviewPayloadTests() {
  const reviewPayload = {
    _id: "review-payload",
    orderId: "review-payload-order",
    customerOpenid: "customer-a",
    cleanerOpenid: "cleaner-a",
    serviceType: "深度保洁",
    rating: 4.5,
    content: "review content",
    imageUrls: ["cloud://review-image"],
    source: "manual",
    editCount: 1,
    internalNote: "review internal note",
    moderationStatus: "approved",
    createdAt: "2026-05-21T10:00:00.000Z",
    updatedAt: "2026-05-22T10:00:00.000Z",
  };
  const db = createPrivacyDB({
    orders: [
      seedOrder({
        _id: "review-payload-order",
        status: "completed",
        paymentStatus: "settled",
        serviceType: "深度保洁",
      }),
    ],
    reviews: [reviewPayload],
  });

  const customer = await loadFunction({ openid: "customer-a", db, env: { APP_ENV: "production" } });
  try {
    const detail = await invoke(customer.main, { action: "getOrderDetail", data: { orderId: "review-payload-order" } });
    assert.strictEqual(detail.success, true);
    assertPublicOrderReview(detail.data.review, "getOrderDetail review");
    assert.strictEqual(detail.data.order.review, undefined, "getOrderDetail order should not embed raw review");
    assert.strictEqual(detail.data.order.reviewId, "review-payload");
    assert.strictEqual(detail.data.order.hasReview, true);

    const list = await invoke(customer.main, { action: "listMyOrders", data: {} });
    assert.strictEqual(list.success, true);
    assert.strictEqual(list.data.length, 1);
    assertPublicOrderReview(list.data[0].review, "listMyOrders order.review");
    assert.strictEqual(list.data[0].reviewId, "review-payload");
    assert.strictEqual(list.data[0].hasReview, true);
  } finally {
    customer.restore();
  }

  const cleaner = await loadFunction({ openid: "cleaner-a", db, env: { APP_ENV: "production" } });
  try {
    const result = await invoke(cleaner.main, { action: "listReceivedReviews", data: {} });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.length, 1);
    assertPublicOrderReview(result.data[0], "listReceivedReviews review", { serviceType: "深度保洁" });
  } finally {
    cleaner.restore();
  }
}

function assertNoPricingInternalFields(value, name) {
  assertNoSensitiveKeys(
    value,
    [
      "cleanerBaseIncome",
      "cleanerIncome",
      "platformFee",
      "platformFeeRate",
      "platformSubsidy",
      "cashGrossMargin",
      "cashBurn",
      "marginWarning",
      "grossMarginNote",
      "paymentFeeEstimate",
      "insuranceCostAllocation",
    ],
    name
  );
}

async function runPricingEngineTests() {
  const DAILY = "\u65e5\u5e38\u4fdd\u6d01";
  const DEEP = "\u6df1\u5ea6\u4fdd\u6d01";
  const MOVE_IN = "\u5f00\u8352\u4fdd\u6d01";
  const ORGANIZE = "\u5bb6\u52a1\u6574\u7406";
  const SHANGHAI = "\u4e0a\u6d77\u5e02";
  const HANGZHOU = "\u676d\u5dde\u5e02";
  const WUXI = "\u65e0\u9521\u5e02";
  const HARBIN = "\u54c8\u5c14\u6ee8\u5e02";

  const rulesDb = createPrivacyDB({
    pricingRules: [
      { _id: "disabled-rule", serviceType: DAILY, city: SHANGHAI, enabled: false, launchPrice: 1, listPrice: 2, cashBurn: 999 },
    ],
  });
  const rulesCustomer = await loadFunction({ openid: "customer-a", db: rulesDb, env: { APP_ENV: "production" } });
  try {
    const result = await invoke(rulesCustomer.main, { action: "getPricingRules", data: {} });
    assert.strictEqual(result.success, true);
    assert(result.data.rules.length > 0, "getPricingRules should return default enabled rules");
    assert(!result.data.rules.some((rule) => rule._id === "disabled-rule"), "disabled pricing rules should not return");
    assertNoPricingInternalFields(result.data.rules[0], "public pricing rule");
  } finally {
    rulesCustomer.restore();
  }

  const quoteDb = createPrivacyDB();
  const quoteCustomer = await loadFunction({ openid: "customer-a", db: quoteDb, env: { APP_ENV: "production" } });
  try {
    const cases = [
      { city: SHANGHAI, serviceType: DAILY, durationHours: 2, customerPayAmount: 79, listPrice: 98 },
      { city: HANGZHOU, serviceType: DAILY, durationHours: 3, customerPayAmount: 109 },
      { city: WUXI, serviceType: DAILY, durationHours: 4, customerPayAmount: 132 },
      { city: HARBIN, serviceType: DAILY, durationHours: 5, customerPayAmount: 155 },
      { city: SHANGHAI, serviceType: DEEP, durationHours: 3, customerPayAmount: 169 },
      { city: HANGZHOU, serviceType: ORGANIZE, durationHours: 4, customerPayAmount: 239 },
    ];
    for (const item of cases) {
      const result = await invoke(quoteCustomer.main, { action: "createPricingQuote", data: item });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.quote.customerPayAmount, item.customerPayAmount, `${item.city} ${item.serviceType} ${item.durationHours}h customerPayAmount`);
      if (item.listPrice) assert.strictEqual(result.data.quote.listPrice, item.listPrice);
      assert(result.data.quote.quoteId, "quote should include quoteId");
      assertNoPricingInternalFields(result.data.quote, "public pricing quote");
    }

    const shMoveIn = await invoke(quoteCustomer.main, { action: "createPricingQuote", data: { city: SHANGHAI, serviceType: MOVE_IN, areaSqm: 80, durationHours: 4 } });
    assert.strictEqual(shMoveIn.success, true);
    assert.strictEqual(shMoveIn.data.quote.pricingMode, "area");
    assert.strictEqual(shMoveIn.data.quote.customerPayAmount, 472);
    assert.strictEqual(shMoveIn.data.quote.billableAreaSqm, 80);

    const harbinMoveIn = await invoke(quoteCustomer.main, { action: "createPricingQuote", data: { city: HARBIN, serviceType: MOVE_IN, areaSqm: 80, durationHours: 4 } });
    assert.strictEqual(harbinMoveIn.success, true);
    assert.strictEqual(harbinMoveIn.data.quote.customerPayAmount, 392);

    const minArea = await invoke(quoteCustomer.main, { action: "createPricingQuote", data: { city: SHANGHAI, serviceType: MOVE_IN, areaSqm: 40, durationHours: 4 } });
    assert.strictEqual(minArea.success, true);
    assert.strictEqual(minArea.data.quote.actualAreaSqm, 40);
    assert.strictEqual(minArea.data.quote.billableAreaSqm, 60);
    assert.strictEqual(minArea.data.quote.customerPayAmount, 354);

    expectFailed(
      await invoke(quoteCustomer.main, { action: "createPricingQuote", data: { city: SHANGHAI, serviceType: MOVE_IN, durationHours: 4 } }),
      "INVALID_INPUT",
      null,
      "moveIn missing areaSqm"
    );

    const subsidized = quoteDb.data.pricingQuotes.find((quote) => quote.city === SHANGHAI && quote.serviceType === "daily" && Number(quote.durationHours) === 2);
    assert(subsidized.pricingSnapshot.cleanerIncome >= 96, "daily A group 2h cleanerIncome should be protected");
    assert.strictEqual(subsidized.pricingSnapshot.customerPayAmount, 79);
    assert.strictEqual(subsidized.pricingSnapshot.platformSubsidy, subsidized.pricingSnapshot.cashBurn, "platformSubsidy should equal cashBurn only");
    assert(subsidized.pricingSnapshot.cashGrossMargin < 0, "launch price should be allowed to produce negative cash margin");

    const couponQuote = await invoke(quoteCustomer.main, {
      action: "createPricingQuote",
      data: { city: SHANGHAI, serviceType: DAILY, durationHours: 2, couponDiscount: 20 },
    });
    assert.strictEqual(couponQuote.success, true);
    const couponStored = quoteDb.data.pricingQuotes.find((quote) => quote.quoteId === couponQuote.data.quote.quoteId);
    assert.strictEqual(couponStored.pricingSnapshot.customerPayAmount, 79, "public couponDiscount should be ignored");
    assert.strictEqual(couponStored.pricingSnapshot.couponDiscount, 0, "public action should not trust raw couponDiscount");
    assert(couponStored.pricingSnapshot.cleanerIncome >= 96, "coupon should not reduce cleanerIncome");

    const tamperedCouponQuote = await invoke(quoteCustomer.main, {
      action: "createPricingQuote",
      data: { city: SHANGHAI, serviceType: DAILY, durationHours: 2, couponDiscount: 999 },
    });
    assert.strictEqual(tamperedCouponQuote.success, true);
    assert.strictEqual(tamperedCouponQuote.data.quote.customerPayAmount, 79, "couponDiscount=999 must not make price zero");
    assert.strictEqual(tamperedCouponQuote.data.quote.couponDiscount, 0);
  } finally {
    quoteCustomer.restore();
  }

  const lifecycleDb = createPrivacyDB({ orders: [] });
  const lifecycleCustomer = await loadFunction({ openid: "customer-a", db: lifecycleDb, env: { APP_ENV: "production" } });
  let quoteId = "";
  try {
    const quoteResult = await invoke(lifecycleCustomer.main, {
      action: "createPricingQuote",
      data: { city: HANGZHOU, serviceType: DAILY, durationHours: 3 },
    });
    assert.strictEqual(quoteResult.success, true);
    quoteId = quoteResult.data.quote.quoteId;

    const ownQuote = await invoke(lifecycleCustomer.main, { action: "getPricingQuote", data: { quoteId } });
    assert.strictEqual(ownQuote.success, true);
    assert.strictEqual(ownQuote.data.quote.quoteId, quoteId);
    assertNoPricingInternalFields(ownQuote.data.quote, "public getPricingQuote");

    const orderResult = await invoke(lifecycleCustomer.main, {
      action: "createOrder",
      data: {
        publishMode: "public",
        serviceType: DAILY,
        city: HANGZHOU,
        district: "\u897f\u6e56\u533a",
        street: "\u6587\u4e09\u8def",
        community: "\u68a7\u6850\u5c0f\u533a",
        addressText: "\u676d\u5dde\u5e02\u897f\u6e56\u533a\u68a7\u6850\u5c0f\u533a",
        durationHours: 3,
        scheduledAt: "2026-06-20 09:00",
        contactPhone: "13800000000",
        areaSize: 80,
        quoteId,
        orderAmount: 1,
        customerPayAmount: 1,
        platformFee: 0,
        cleanerIncome: 1,
      },
    });
    assert.strictEqual(orderResult.success, true);
    assert.strictEqual(lifecycleDb.data.pricingQuotes[0].status, "used");
    assert(lifecycleDb.data.pricingQuotes[0].usedAt, "used quote should record usedAt");
    const order = lifecycleDb.data.orders[0];
    assert.strictEqual(order.quoteId, quoteId);
    assert.strictEqual(order.customerPayAmount, 109);
    assert.strictEqual(order.orderAmount, 109);
    assert.notStrictEqual(order.cleanerIncome, 1, "createOrder should ignore client cleanerIncome");
    assert.strictEqual(order.pricingSnapshot.quoteId, quoteId);
    assert.strictEqual(order.pricingSnapshot.customerPayAmount, 109);

    expectFailed(
      await invoke(lifecycleCustomer.main, {
        action: "createOrder",
        data: {
          publishMode: "public",
          serviceType: DAILY,
          city: HANGZHOU,
          community: "\u68a7\u6850\u5c0f\u533a",
          addressText: "\u676d\u5dde\u5e02\u897f\u6e56\u533a\u68a7\u6850\u5c0f\u533a",
          durationHours: 3,
          scheduledAt: "2026-06-21 09:00",
          contactPhone: "13800000000",
          areaSize: 80,
          quoteId,
        },
      }),
      "INVALID_INPUT",
      null,
      "used quote createOrder"
    );
    assert.strictEqual(lifecycleDb.data.orders.length, 1, "reusing used quote should not create another order");
  } finally {
    lifecycleCustomer.restore();
  }

  const otherUser = await loadFunction({ openid: "customer-b", db: lifecycleDb, env: { APP_ENV: "production" } });
  try {
    expectFailed(await invoke(otherUser.main, { action: "getPricingQuote", data: { quoteId } }), "FORBIDDEN", null, "other user getPricingQuote");
  } finally {
    otherUser.restore();
  }

  const expiredDb = createPrivacyDB({
    orders: [],
    pricingQuotes: [
      {
        _id: "quote-expired",
        quoteId: "quote-expired",
        userOpenid: "customer-a",
        city: HANGZHOU,
        serviceType: DAILY,
        durationHours: 3,
        status: "active",
        expiresAt: "2020-01-01T00:00:00.000Z",
        pricingSnapshot: { quoteId: "quote-expired", customerPayAmount: 109, orderAmount: 109, cleanerIncome: 129, platformFee: 0, pricingMode: "hourly" },
      },
    ],
  });
  const expiredCustomer = await loadFunction({ openid: "customer-a", db: expiredDb, env: { APP_ENV: "production" } });
  try {
    expectFailed(
      await invoke(expiredCustomer.main, {
        action: "createOrder",
        data: {
          publishMode: "public",
          serviceType: DAILY,
          city: HANGZHOU,
          community: "\u68a7\u6850\u5c0f\u533a",
          addressText: "\u676d\u5dde\u5e02\u897f\u6e56\u533a\u68a7\u6850\u5c0f\u533a",
          durationHours: 3,
          scheduledAt: "2026-06-21 09:00",
          contactPhone: "13800000000",
          areaSize: 80,
          quoteId: "quote-expired",
        },
      }),
      "INVALID_INPUT",
      null,
      "expired quote createOrder"
    );
  } finally {
    expiredCustomer.restore();
  }

  const cityMismatchDb = createPrivacyDB({ orders: [] });
  const cityMismatchCustomer = await loadFunction({ openid: "customer-a", db: cityMismatchDb, env: { APP_ENV: "production" } });
  try {
    const quoteResult = await invoke(cityMismatchCustomer.main, {
      action: "createPricingQuote",
      data: { city: HANGZHOU, serviceType: DAILY, durationHours: 3 },
    });
    assert.strictEqual(quoteResult.success, true);
    const hangzhouQuoteId = quoteResult.data.quote.quoteId;
    expectFailed(
      await invoke(cityMismatchCustomer.main, {
        action: "createOrder",
        data: {
          publishMode: "public",
          serviceType: DAILY,
          city: SHANGHAI,
          community: "\u8bd5\u70b9\u5c0f\u533a",
          addressText: "\u4e0a\u6d77\u5e02\u8bd5\u70b9\u5c0f\u533a",
          durationHours: 3,
          scheduledAt: "2026-06-22 09:00",
          contactPhone: "13800000000",
          quoteId: hangzhouQuoteId,
        },
      }),
      "INVALID_INPUT",
      null,
      "quote city mismatch"
    );
    expectFailed(
      await invoke(cityMismatchCustomer.main, {
        action: "createOrder",
        data: {
          publishMode: "public",
          serviceType: DAILY,
          community: "\u68a7\u6850\u5c0f\u533a",
          addressText: "\u68a7\u6850\u5c0f\u533a",
          durationHours: 3,
          scheduledAt: "2026-06-22 09:00",
          contactPhone: "13800000000",
          quoteId: hangzhouQuoteId,
        },
      }),
      "INVALID_INPUT",
      null,
      "quote missing city"
    );
    const locationCityResult = await invoke(cityMismatchCustomer.main, {
      action: "createOrder",
      data: {
        publishMode: "public",
        serviceType: DAILY,
        locationSnapshot: { city: HANGZHOU, district: "\u897f\u6e56\u533a", community: "\u68a7\u6850\u5c0f\u533a", addressText: "\u676d\u5dde\u5e02\u68a7\u6850\u5c0f\u533a" },
        community: "\u68a7\u6850\u5c0f\u533a",
        addressText: "\u676d\u5dde\u5e02\u68a7\u6850\u5c0f\u533a",
        durationHours: 3,
        scheduledAt: "2026-06-22 09:00",
        contactPhone: "13800000000",
        quoteId: hangzhouQuoteId,
      },
    });
    assert.strictEqual(locationCityResult.success, true, "locationSnapshot.city should satisfy quote city match");
  } finally {
    cityMismatchCustomer.restore();
  }

  const fallbackDb = createPrivacyDB({ orders: [] });
  const fallbackCustomer = await loadFunction({ openid: "customer-a", db: fallbackDb, env: { APP_ENV: "production" } });
  try {
    const deepResult = await invoke(fallbackCustomer.main, {
      action: "createOrder",
      data: {
        publishMode: "public",
        serviceType: DEEP,
        city: SHANGHAI,
        district: "\u6d66\u4e1c\u65b0\u533a",
        street: "\u82b1\u6728\u8857\u9053",
        community: "\u8bd5\u70b9\u5c0f\u533a",
        addressText: "\u4e0a\u6d77\u5e02\u6d66\u4e1c\u65b0\u533a\u8bd5\u70b9\u5c0f\u533a",
        durationHours: 3,
        scheduledAt: "2026-06-20 09:00",
        contactPhone: "13800000000",
      },
    });
    assert.strictEqual(deepResult.success, true, "deep cleaning should not require area");

    const moveInAreaSqmResult = await invoke(fallbackCustomer.main, {
      action: "createOrder",
      data: {
        publishMode: "public",
        serviceType: MOVE_IN,
        city: SHANGHAI,
        district: "\u6d66\u4e1c\u65b0\u533a",
        street: "\u82b1\u6728\u8857\u9053",
        community: "\u8bd5\u70b9\u5c0f\u533a",
        addressText: "\u4e0a\u6d77\u5e02\u6d66\u4e1c\u65b0\u533a\u8bd5\u70b9\u5c0f\u533a",
        durationHours: 4,
        areaSqm: 80,
        scheduledAt: "2026-06-20 10:00",
        contactPhone: "13800000000",
      },
    });
    assert.strictEqual(moveInAreaSqmResult.success, true, "moveIn should accept areaSqm without areaSize");

    expectFailed(
      await invoke(fallbackCustomer.main, {
        action: "createOrder",
        data: {
          publishMode: "public",
          serviceType: MOVE_IN,
          city: SHANGHAI,
          community: "\u8bd5\u70b9\u5c0f\u533a",
          addressText: "\u4e0a\u6d77\u5e02\u8bd5\u70b9\u5c0f\u533a",
          durationHours: 4,
          scheduledAt: "2026-06-20 11:00",
          contactPhone: "13800000000",
        },
      }),
      "BUSINESS_ERROR",
      "开荒保洁请填写面积后再发布",
      "moveIn missing area on createOrder"
    );

    expectFailed(
      await invoke(fallbackCustomer.main, {
        action: "createOrder",
        data: {
          publishMode: "public",
          serviceType: DAILY,
          community: "\u8bd5\u70b9\u5c0f\u533a",
          addressText: "\u8bd5\u70b9\u5c0f\u533a",
          durationHours: 2,
          scheduledAt: "2026-06-20 12:00",
          contactPhone: "13800000000",
        },
      }),
      "INVALID_INPUT",
      null,
      "fallback createOrder missing city"
    );

    const result = await invoke(fallbackCustomer.main, {
      action: "createOrder",
      data: {
        publishMode: "public",
        serviceType: DAILY,
        city: SHANGHAI,
        district: "\u6d66\u4e1c\u65b0\u533a",
        street: "\u82b1\u6728\u8857\u9053",
        community: "\u8bd5\u70b9\u5c0f\u533a",
        addressText: "\u4e0a\u6d77\u5e02\u6d66\u4e1c\u65b0\u533a\u8bd5\u70b9\u5c0f\u533a",
        durationHours: 2,
        scheduledAt: "2026-06-20 09:00",
        contactPhone: "13800000000",
        areaSize: 80,
        orderAmount: 1,
        cleanerIncome: 1,
      },
    });
    assert.strictEqual(result.success, true);
    const fallbackOrder = fallbackDb.data.orders.find((order) => order._id === result.data.orderId);
    assert.strictEqual(fallbackOrder.pricingSnapshot.generatedBy, "createOrder_fallback");
    assert.strictEqual(fallbackOrder.customerPayAmount, 79);
    assert.notStrictEqual(fallbackOrder.cleanerIncome, 1);
  } finally {
    fallbackCustomer.restore();
  }

  const responsesDb = createPrivacyDB({
    orders: [
      seedOrder({
        _id: "response-pricing-order",
        status: "waiting_confirm",
        publishMode: "public",
        responses: [
          {
            cleanerId: "cleaner-a",
            cleanerName: "\u5f20\u5bb6\u6d01\u5e08",
            status: "pending",
            quotedAmount: 109,
            platformFee: 3.27,
            cleanerIncome: 129,
            responseTime: "2026-06-20T00:00:00.000Z",
          },
          {
            cleanerId: "cleaner-b",
            cleanerName: "\u674e\u5bb6\u6d01\u5e08",
            status: "pending",
            quotedAmount: 109,
            platformFee: 3.27,
            cleanerIncome: 129,
            responseTime: "2026-06-20T00:01:00.000Z",
          },
        ],
      }),
    ],
  });
  const responseCustomer = await loadFunction({ openid: "customer-a", db: responsesDb, env: { APP_ENV: "production" } });
  try {
    const detail = await invoke(responseCustomer.main, { action: "getOrderDetail", data: { orderId: "response-pricing-order" } });
    assert.strictEqual(detail.success, true);
    assert.strictEqual(detail.data.order.responses.length, 2, "customer should still see response list");
    assert.strictEqual(detail.data.order.responses[0].cleanerId, "cleaner-a");
    assert.strictEqual(detail.data.order.responses[0].status, "pending");
    assert.strictEqual(detail.data.order.responses[0].platformFee, undefined, "customer responses should not expose platformFee");
    assert.strictEqual(detail.data.order.responses[0].cleanerIncome, undefined, "customer responses should not expose cleanerIncome");
    const selected = await invoke(responseCustomer.main, { action: "selectOrderResponse", data: { orderId: "response-pricing-order", cleanerId: "cleaner-a" } });
    assert.strictEqual(selected.success, true, "customer should still be able to select cleaner from sanitized response list");
  } finally {
    responseCustomer.restore();
  }
  const responseCleaner = await loadFunction({ openid: "cleaner-b", db: responsesDb, env: { APP_ENV: "production" } });
  try {
    const detail = await invoke(responseCleaner.main, { action: "getOrderDetail", data: { orderId: "response-pricing-order" } });
    assert.strictEqual(detail.success, true);
    assert.strictEqual(detail.data.order.responses, undefined, "unselected cleaner should not see full responses");
    assert(detail.data.order.myResponse, "responded cleaner should see own myResponse");
    assert.strictEqual(detail.data.order.myResponse.platformFee, undefined);
    assert.strictEqual(detail.data.order.myResponse.cleanerIncome, undefined);
  } finally {
    responseCleaner.restore();
  }

  const publicOrderContext = await loadFunction({ openid: "cleaner-b", db: lifecycleDb, env: { APP_ENV: "production" } });
  try {
    const list = await invoke(publicOrderContext.main, { action: "listOpenOrders", data: { scope: "all" } });
    assert.strictEqual(list.success, true);
    if (list.data[0]) {
      assertNoPricingInternalFields(list.data[0], "public order pricing");
      assertNoSensitiveKeys(list.data[0], ["customerOpenid", "note", "responses"], "public order regression");
    }
  } finally {
    publicOrderContext.restore();
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

function assertNoProtectionPromiseText(value, name) {
  const text = JSON.stringify(value || {});
  ["百万保障", "全额赔付", "已投保"].forEach((phrase) => {
    assert(!text.includes(phrase), `${name} should not contain ${phrase}`);
  });
}

async function runProtectionWorkflowTests() {
  const configDb = createPrivacyDB({
    serviceStandards: [
      {
        _id: "standard-disabled",
        serviceType: "日常保洁",
        title: "disabled",
        enabled: false,
        internalNote: "hidden",
      },
      {
        _id: "standard-basic",
        serviceType: "日常保洁",
        title: "日常保洁服务标准",
        includedItems: ["地面清洁"],
        excludedItems: ["高空作业"],
        customerTips: ["提前收纳贵重物品"],
        cleanerTips: ["服务前确认范围"],
        version: "2026-06",
        enabled: true,
        internalNote: "hidden",
      },
    ],
    protectionPlans: [
      {
        _id: "plan-basic",
        planCode: "trial-basic",
        title: "试运营服务保障",
        summary: "不满意可提交售后申请，平台将在试运营规则下协助处理。",
        coverageItems: ["返工协商", "投诉反馈"],
        limitations: ["保障范围以实际保险合同和平台规则为准。"],
        afterSaleWindowHours: 72,
        reworkAllowed: true,
        refundAllowed: true,
        propertyDamageReportAllowed: true,
        insuranceStatusText: "保险能力待接入/以实际订单保障页为准",
        version: "2026-06",
        enabled: true,
        internalNote: "hidden",
      },
    ],
  });
  const configContext = await loadFunction({ openid: "customer-a", db: configDb, env: { APP_ENV: "production" } });
  try {
    const standards = await invoke(configContext.main, { action: "getServiceStandards", data: {} });
    assert.strictEqual(standards.success, true);
    assert.strictEqual(standards.data.standards.length, 1);
    assert.strictEqual(standards.data.standards[0]._id, "standard-basic");
    assertNoSensitiveKeys(standards.data.standards[0], ["internalNote"], "public service standard");

    const plans = await invoke(configContext.main, { action: "getProtectionPlans", data: {} });
    assert.strictEqual(plans.success, true);
    assert.strictEqual(plans.data.plans.length, 1);
    assertNoProtectionPromiseText(plans.data, "protection plans");
    assertNoSensitiveKeys(plans.data.plans[0], ["internalNote"], "public protection plan");
  } finally {
    configContext.restore();
  }

  const moveInServiceType = "\u5f00\u8352\u4fdd\u6d01";
  const organizeServiceType = "\u5bb6\u52a1\u6574\u7406";
  const fallbackStandardsDb = createPrivacyDB({ serviceStandards: [] });
  const fallbackStandardsContext = await loadFunction({ openid: "customer-a", db: fallbackStandardsDb, env: { APP_ENV: "production" } });
  try {
    for (const serviceType of [moveInServiceType, organizeServiceType]) {
      const result = await invoke(fallbackStandardsContext.main, { action: "getServiceStandards", data: { serviceType } });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.standards.length, 1);
      assert.strictEqual(result.data.standards[0].serviceType, serviceType);
      assert(result.data.standards[0].title.includes(serviceType), `${serviceType} fallback title should match serviceType`);
      assertNoProtectionPromiseText(result.data.standards[0], `${serviceType} fallback standard`);
    }
  } finally {
    fallbackStandardsContext.restore();
  }

  const baseOrder = seedOrder();
  const createOrderDb = createPrivacyDB({
    orders: [],
    serviceStandards: [
      {
        _id: "standard-create",
        serviceType: baseOrder.serviceType,
        title: "Standard for createOrder",
        includedItems: ["floor"],
        excludedItems: ["high risk work"],
        customerTips: ["confirm scope"],
        cleanerTips: ["confirm before service"],
        version: "test",
        enabled: true,
        internalNote: "hidden",
      },
    ],
    protectionPlans: [
      {
        _id: "plan-create",
        planCode: "trial-create",
        title: "Trial service protection",
        summary: "After-sales requests are handled by manual platform review during trial operations.",
        coverageItems: ["rework request", "complaint feedback"],
        limitations: ["Coverage follows actual contract and platform rules."],
        afterSaleWindowHours: 72,
        reworkAllowed: true,
        refundAllowed: true,
        propertyDamageReportAllowed: true,
        insuranceStatusText: "Insurance capability is pending integration.",
        version: "test",
        enabled: true,
        internalNote: "hidden",
      },
    ],
  });
  const createOrderContext = await loadFunction({ openid: "customer-a", db: createOrderDb, env: { APP_ENV: "production" } });
  try {
    const result = await invoke(createOrderContext.main, {
      action: "createOrder",
      data: {
        publishMode: "public",
        serviceType: baseOrder.serviceType,
        city: baseOrder.city,
        district: baseOrder.district,
        street: baseOrder.street,
        community: baseOrder.community,
        detailAddress: baseOrder.detailAddress,
        addressText: baseOrder.addressText,
        scheduledAt: "2026-06-06 09:00",
        durationHours: 3,
        contactPhone: "13800000000",
        note: "private create order note",
      },
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(createOrderDb.data.orders.length, 1);
    const createdOrder = createOrderDb.data.orders[0];
    assert.strictEqual(createdOrder.protectionPlanId, "plan-create");
    assert.strictEqual(createdOrder.protectionSnapshot.planCode, "trial-create");
    assert.strictEqual(createdOrder.serviceStandardSnapshot.standardId, "standard-create");
    assert.strictEqual(createdOrder.serviceStandardSnapshot.title, "Standard for createOrder");
    assert.strictEqual(createdOrder.afterSaleStatus, "");
    assert.strictEqual(createdOrder.activeClaimId, "");
    assert.strictEqual(createdOrder.claimCount, 0);
    assertNoProtectionPromiseText(createdOrder.protectionSnapshot, "created order protection snapshot");
  } finally {
    createOrderContext.restore();
  }

  const fallbackCreateDb = createPrivacyDB({ orders: [], serviceStandards: [] });
  const fallbackCreateContext = await loadFunction({ openid: "customer-a", db: fallbackCreateDb, env: { APP_ENV: "production" } });
  try {
    const result = await invoke(fallbackCreateContext.main, {
      action: "createOrder",
      data: {
        publishMode: "public",
        serviceType: moveInServiceType,
        city: baseOrder.city,
        district: baseOrder.district,
        street: baseOrder.street,
        community: baseOrder.community,
        detailAddress: baseOrder.detailAddress,
        addressText: baseOrder.addressText,
        areaSize: 80,
        scheduledAt: "2026-06-06 09:00",
        durationHours: 3,
        contactPhone: "13800000000",
      },
    });
    assert.strictEqual(result.success, true);
    assert(fallbackCreateDb.data.orders[0].serviceStandardSnapshot.title.includes(moveInServiceType), "createOrder fallback standard should match serviceType");
    assert(!fallbackCreateDb.data.orders[0].serviceStandardSnapshot.title.includes(baseOrder.serviceType), "createOrder fallback should not reuse daily standard");
  } finally {
    fallbackCreateContext.restore();
  }

  const afterSaleOrder = seedOrder({
    _id: "order-after-sale-private",
    status: "waiting_confirm",
    acceptedCleanerOpenid: "cleaner-a",
    cleanerId: "cleaner-a",
    responses: [
      { cleanerId: "cleaner-a", status: "selected" },
      { cleanerId: "cleaner-b", status: "submitted" },
    ],
    afterSaleStatus: "submitted",
    activeClaimId: "claim-private",
    claimCount: 2,
    lastClaimAt: "2026-06-02T00:00:00.000Z",
    serviceProof: { note: "private proof", submittedBy: "cleaner-a" },
    beforePhotoUrls: ["cloud://before-private"],
    completionPhotoUrls: ["cloud://complete-private"],
    completionImageUrls: ["cloud://complete-private"],
    completionPhotos: [{ fileID: "cloud://complete-private" }],
    serviceProofImageUrls: ["cloud://legacy-proof-private"],
  });
  const afterSalePrivacyDb = createPrivacyDB({ orders: [afterSaleOrder] });
  const unselectedCleaner = await loadFunction({ openid: "cleaner-b", db: afterSalePrivacyDb, env: { APP_ENV: "production" } });
  try {
    const detail = await invoke(unselectedCleaner.main, { action: "getOrderDetail", data: { orderId: "order-after-sale-private" } });
    assert.strictEqual(detail.success, true);
    assertNoAfterSalePrivateFields(detail.data.order, "unselected cleaner order detail");
    assertPublicOrderSafe(detail.data.order, "unselected cleaner order detail");
  } finally {
    unselectedCleaner.restore();
  }
  const unopenedOrderDb = createPrivacyDB({
    orders: [
      seedOrder({
        ...afterSaleOrder,
        _id: "order-open-after-sale-private",
        status: "waiting_response",
        acceptedCleanerOpenid: "",
        cleanerId: "",
        responses: [],
      }),
    ],
  });
  const unopenedCleaner = await loadFunction({ openid: "cleaner-b", db: unopenedOrderDb, env: { APP_ENV: "production" } });
  try {
    const list = await invoke(unopenedCleaner.main, { action: "listOpenOrders", data: { scope: "all" } });
    assert.strictEqual(list.success, true);
    assert(list.data.length >= 1, "listOpenOrders should return public order");
    assertNoAfterSalePrivateFields(list.data[0], "unresponded cleaner listOpenOrders");
    assertPublicOrderSafe(list.data[0], "unresponded cleaner listOpenOrders");
    const detail = await invoke(unopenedCleaner.main, { action: "getOrderDetail", data: { orderId: "order-open-after-sale-private" } });
    assert.strictEqual(detail.success, true);
    assertNoAfterSalePrivateFields(detail.data.order, "unresponded cleaner order detail");
  } finally {
    unopenedCleaner.restore();
  }
  const afterSaleCustomer = await loadFunction({ openid: "customer-a", db: createPrivacyDB({ orders: [afterSaleOrder] }), env: { APP_ENV: "production" } });
  try {
    const detail = await invoke(afterSaleCustomer.main, { action: "getOrderDetail", data: { orderId: "order-after-sale-private" } });
    assert.strictEqual(detail.success, true);
    assert.strictEqual(detail.data.order.serviceProof.note, "private proof");
    assert.strictEqual(detail.data.order.completionPhotoUrls[0], "cloud://complete-private");
    assert.strictEqual(detail.data.order.serviceProofImageUrls[0], "cloud://legacy-proof-private");
    assert.strictEqual(detail.data.order.afterSaleStatus, "submitted");
  } finally {
    afterSaleCustomer.restore();
  }
  const afterSaleAcceptedCleaner = await loadFunction({
    openid: "cleaner-a",
    db: createPrivacyDB({ orders: [seedOrder({ ...afterSaleOrder, status: "confirmed" })] }),
    env: { APP_ENV: "production" },
  });
  try {
    const detail = await invoke(afterSaleAcceptedCleaner.main, { action: "getOrderDetail", data: { orderId: "order-after-sale-private" } });
    assert.strictEqual(detail.success, true);
    assert.strictEqual(detail.data.order.serviceProof.note, "private proof");
    assert.strictEqual(detail.data.order.completionPhotoUrls[0], "cloud://complete-private");
    assert.strictEqual(detail.data.order.serviceProofImageUrls[0], "cloud://legacy-proof-private");
  } finally {
    afterSaleAcceptedCleaner.restore();
  }

  const waitingPaymentAfterSaleOrder = seedOrder({
    ...afterSaleOrder,
    _id: "order-waiting-payment-after-sale-private",
    status: "waiting_payment",
    acceptedCleanerOpenid: "cleaner-a",
    cleanerId: "cleaner-a",
  });
  const waitingPaymentCleaner = await loadFunction({
    openid: "cleaner-a",
    db: createPrivacyDB({ orders: [waitingPaymentAfterSaleOrder] }),
    env: { APP_ENV: "production" },
  });
  try {
    const detail = await invoke(waitingPaymentCleaner.main, { action: "getOrderDetail", data: { orderId: "order-waiting-payment-after-sale-private" } });
    assert.strictEqual(detail.success, true);
    assertNoAfterSalePrivateFields(detail.data.order, "waiting_payment selected cleaner order detail");
  } finally {
    waitingPaymentCleaner.restore();
  }
  const waitingPaymentCustomer = await loadFunction({
    openid: "customer-a",
    db: createPrivacyDB({ orders: [waitingPaymentAfterSaleOrder] }),
    env: { APP_ENV: "production" },
  });
  try {
    const detail = await invoke(waitingPaymentCustomer.main, { action: "getOrderDetail", data: { orderId: "order-waiting-payment-after-sale-private" } });
    assert.strictEqual(detail.success, true);
    assert.strictEqual(detail.data.order.serviceProof.note, "private proof");
    assert.strictEqual(detail.data.order.completionPhotoUrls[0], "cloud://complete-private");
    assert.strictEqual(detail.data.order.serviceProofImageUrls[0], "cloud://legacy-proof-private");
    assert.strictEqual(detail.data.order.afterSaleStatus, "submitted");
  } finally {
    waitingPaymentCustomer.restore();
  }

  const createDb = createPrivacyDB();
  const customer = await loadFunction({ openid: "customer-a", db: createDb, env: { APP_ENV: "production" } });
  try {
    const result = await invoke(customer.main, {
      action: "createProtectionClaim",
      data: {
        orderId: "order-a",
        claimType: "rework",
        description: "Kitchen corner still needs follow-up. Phone 13800000000 should not enter audit logs.",
        imageFileIDs: ["cloud://claim-1"],
        requestedAmount: 0,
      },
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(createDb.data.protectionClaims.length, 1);
    assert.strictEqual(createDb.data.protectionClaims[0].claimType, "rework");
    assert.strictEqual(createDb.data.orders[0].afterSaleStatus, "submitted");
    assert.strictEqual(createDb.data.orders[0].activeClaimId, result.data.claimId);
    assert.strictEqual(createDb.data.orders[0].claimCount, 1);
    assertAuditSafe(createDb, "createProtectionClaim");
  } finally {
    customer.restore();
  }

  const stranger = await loadFunction({ openid: "customer-b", db: createPrivacyDB(), env: { APP_ENV: "production" } });
  try {
    const result = await invoke(stranger.main, {
      action: "createProtectionClaim",
      data: { orderId: "order-a", claimType: "refund", description: "I should not access this order" },
    });
    expectFailed(result, "FORBIDDEN", null, "stranger createProtectionClaim");
  } finally {
    stranger.restore();
  }

  const invalidDb = createPrivacyDB();
  const invalid = await loadFunction({ openid: "customer-a", db: invalidDb, env: { APP_ENV: "production" } });
  try {
    expectFailed(
      await invoke(invalid.main, { action: "createProtectionClaim", data: { orderId: "order-a", claimType: "bad", description: "invalid" } }),
      "INVALID_INPUT",
      null,
      "invalid claim type"
    );
    expectFailed(
      await invoke(invalid.main, { action: "createProtectionClaim", data: { orderId: "order-a", claimType: "refund", description: "" } }),
      "INVALID_INPUT",
      null,
      "missing claim description"
    );
    expectFailed(
      await invoke(invalid.main, {
        action: "createProtectionClaim",
        data: { orderId: "order-a", claimType: "refund", description: "too many images", imageFileIDs: ["1", "2", "3", "4", "5", "6", "7"] },
      }),
      "INVALID_INPUT",
      null,
      "too many claim images"
    );
  } finally {
    invalid.restore();
  }

  const claimDb = createPrivacyDB({
    protectionClaims: [
      {
        _id: "claim-a",
        orderId: "order-a",
        orderNo: "HJ-001",
        claimNo: "CLM-001",
        claimantOpenid: "customer-a",
        claimantRole: "customer",
        claimType: "complaint",
        status: "submitted",
        description: "Private complaint 13800000000",
        imageFileIDs: ["cloud://claim-private"],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        auditTrail: [{ action: "submitted", actorOpenid: "customer-a", actorRole: "customer", status: "submitted", createdAt: "2026-06-01T00:00:00.000Z" }],
      },
      {
        _id: "claim-b",
        orderId: "other-order",
        orderNo: "HJ-002",
        claimNo: "CLM-002",
        claimantOpenid: "customer-b",
        claimantRole: "customer",
        claimType: "refund",
        status: "submitted",
        description: "Other order",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        auditTrail: [],
      },
    ],
    orders: [
      seedOrder(),
      seedOrder({
        _id: "other-order",
        customerOpenid: "customer-b",
        acceptedCleanerOpenid: "cleaner-b",
        cleanerId: "cleaner-b",
      }),
    ],
  });
  const claimCustomer = await loadFunction({ openid: "customer-a", db: claimDb, env: { APP_ENV: "production" } });
  try {
    const list = await invoke(claimCustomer.main, { action: "listMyProtectionClaims", data: {} });
    assert.strictEqual(list.success, true);
    assert.deepStrictEqual(
      list.data.claims.map((item) => item._id),
      ["claim-a"]
    );
    const detail = await invoke(claimCustomer.main, { action: "getProtectionClaimDetail", data: { claimId: "claim-a" } });
    assert.strictEqual(detail.success, true);
    assert.strictEqual(detail.data.claim.description, "Private complaint 13800000000");
    assertNoSensitiveKeys(detail.data.claim, ["claimantOpenid", "assignedAdminOpenid"], "public protection claim");
    assert.strictEqual(detail.data.claim.auditTrail[0].actorOpenid, undefined);
    assert(detail.data.order, "claim detail should include sanitized order");
  } finally {
    claimCustomer.restore();
  }

  const claimCleaner = await loadFunction({ openid: "cleaner-a", db: claimDb, env: { APP_ENV: "production" } });
  try {
    const list = await invoke(claimCleaner.main, { action: "listMyProtectionClaims", data: {} });
    assert.strictEqual(list.success, true);
    assert.deepStrictEqual(
      list.data.claims.map((item) => item._id),
      ["claim-a"]
    );
    const detail = await invoke(claimCleaner.main, { action: "getProtectionClaimDetail", data: { claimId: "claim-a" } });
    assert.strictEqual(detail.success, true);
    assertNoSensitiveKeys(detail.data.order, ["customerOpenid", "responses"], "claim detail order");
  } finally {
    claimCleaner.restore();
  }

  const waitingPaymentClaimDb = createPrivacyDB({
    orders: [seedOrder({ _id: "waiting-payment-claim-order", status: "waiting_payment", acceptedCleanerOpenid: "cleaner-a", cleanerId: "cleaner-a" })],
    protectionClaims: [
      {
        _id: "claim-waiting-payment-customer",
        orderId: "waiting-payment-claim-order",
        claimNo: "CLM-WAITING-PAYMENT",
        claimantOpenid: "customer-a",
        claimantRole: "customer",
        claimType: "complaint",
        status: "submitted",
        description: "customer claim before fulfillment",
        imageFileIDs: ["cloud://waiting-payment-claim"],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        auditTrail: [],
      },
    ],
  });
  const waitingPaymentClaimCleaner = await loadFunction({ openid: "cleaner-a", db: waitingPaymentClaimDb, env: { APP_ENV: "production" } });
  try {
    expectFailed(
      await invoke(waitingPaymentClaimCleaner.main, { action: "getProtectionClaimDetail", data: { claimId: "claim-waiting-payment-customer" } }),
      "FORBIDDEN",
      null,
      "waiting_payment selected cleaner should not view customer claim"
    );
    const list = await invoke(waitingPaymentClaimCleaner.main, { action: "listMyProtectionClaims", data: {} });
    assert.strictEqual(list.success, true);
    assert.deepStrictEqual(list.data.claims.map((item) => item._id), []);
  } finally {
    waitingPaymentClaimCleaner.restore();
  }

  const claimStranger = await loadFunction({ openid: "cleaner-b", db: claimDb, env: { APP_ENV: "production" } });
  try {
    const detail = await invoke(claimStranger.main, { action: "getProtectionClaimDetail", data: { claimId: "claim-a" } });
    expectFailed(detail, "FORBIDDEN", null, "stranger claim detail");
  } finally {
    claimStranger.restore();
  }

  const assignedClaimDb = createPrivacyDB({
    orders: [
      seedOrder({
        _id: "assigned-claim-order",
        publishMode: "assigned",
        status: "assigned_waiting_accept",
        acceptedCleanerOpenid: "",
        assignedCleanerOpenid: "cleaner-a",
        cleanerId: "cleaner-a",
      }),
    ],
    protectionClaims: [
      {
        _id: "claim-customer-assigned",
        orderId: "assigned-claim-order",
        claimNo: "CLM-ASSIGNED-CUSTOMER",
        claimantOpenid: "customer-a",
        claimantRole: "customer",
        claimType: "complaint",
        status: "submitted",
        description: "customer private complaint",
        imageFileIDs: ["cloud://customer-claim-private"],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        auditTrail: [],
      },
      {
        _id: "claim-assigned-cleaner",
        orderId: "assigned-claim-order",
        claimNo: "CLM-ASSIGNED-CLEANER",
        claimantOpenid: "cleaner-a",
        claimantRole: "cleaner",
        claimType: "cleaner_exception",
        status: "submitted",
        description: "assigned cleaner own exception",
        imageFileIDs: ["cloud://cleaner-exception"],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        auditTrail: [],
      },
    ],
  });
  const assignedViewer = await loadFunction({ openid: "cleaner-a", db: assignedClaimDb, env: { APP_ENV: "production" } });
  try {
    expectFailed(
      await invoke(assignedViewer.main, { action: "getProtectionClaimDetail", data: { claimId: "claim-customer-assigned" } }),
      "FORBIDDEN",
      null,
      "assigned cleaner should not view customer claim"
    );
    const ownClaim = await invoke(assignedViewer.main, { action: "getProtectionClaimDetail", data: { claimId: "claim-assigned-cleaner" } });
    assert.strictEqual(ownClaim.success, true);
    assert.strictEqual(ownClaim.data.claim._id, "claim-assigned-cleaner");
  } finally {
    assignedViewer.restore();
  }

  const adminDb = createPrivacyDB({
    protectionClaims: [
      {
        _id: "claim-admin",
        orderId: "order-a",
        claimNo: "CLM-ADMIN",
        claimantOpenid: "customer-a",
        claimantRole: "customer",
        claimType: "refund",
        status: "submitted",
        description: "Needs review",
        auditTrail: [],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
  });
  const normalUser = await loadFunction({ openid: "customer-a", db: adminDb, env: { APP_ENV: "production" } });
  try {
    const result = await invoke(normalUser.main, {
      action: "updateProtectionClaimStatus",
      data: { claimId: "claim-admin", status: "under_review" },
    });
    expectFailed(result, "FORBIDDEN", null, "non-admin updateProtectionClaimStatus");
  } finally {
    normalUser.restore();
  }
  const admin = await loadFunction({ openid: "admin-a", db: adminDb, env: { APP_ENV: "production", ADMIN_OPENIDS: "admin-a" } });
  try {
    const result = await invoke(admin.main, {
      action: "updateProtectionClaimStatus",
      data: { claimId: "claim-admin", status: "under_review", resolutionNote: "Manual review only; no refund executed." },
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(adminDb.data.protectionClaims[0].status, "under_review");
    assertAuditSafe(adminDb, "updateProtectionClaimStatus");
    const invalidTransition = await invoke(admin.main, {
      action: "updateProtectionClaimStatus",
      data: { claimId: "claim-admin", status: "submitted" },
    });
    expectFailed(invalidTransition, "INVALID_STATUS", null, "invalid claim transition");
  } finally {
    admin.restore();
  }

  const activeClaimClearDb = createPrivacyDB({
    orders: [seedOrder({ activeClaimId: "claim-active-a", afterSaleStatus: "under_review" })],
    protectionClaims: [
      {
        _id: "claim-active-a",
        orderId: "order-a",
        claimNo: "CLM-ACTIVE-A",
        claimantOpenid: "customer-a",
        claimantRole: "customer",
        claimType: "complaint",
        status: "under_review",
        description: "active claim a",
        auditTrail: [],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
  });
  const activeClaimClearAdmin = await loadFunction({ openid: "admin-a", db: activeClaimClearDb, env: { APP_ENV: "production", ADMIN_OPENIDS: "admin-a" } });
  try {
    const result = await invoke(activeClaimClearAdmin.main, { action: "updateProtectionClaimStatus", data: { claimId: "claim-active-a", status: "resolved" } });
    assert.strictEqual(result.success, true);
    assert.strictEqual(activeClaimClearDb.data.orders[0].activeClaimId, "");
    assert.strictEqual(activeClaimClearDb.data.orders[0].afterSaleStatus, "resolved");
  } finally {
    activeClaimClearAdmin.restore();
  }

  const activeClaimKeepDb = createPrivacyDB({
    orders: [seedOrder({ activeClaimId: "claim-active-b", afterSaleStatus: "under_review" })],
    protectionClaims: [
      {
        _id: "claim-active-a",
        orderId: "order-a",
        claimNo: "CLM-ACTIVE-A",
        claimantOpenid: "customer-a",
        claimantRole: "customer",
        claimType: "complaint",
        status: "under_review",
        description: "active claim a",
        auditTrail: [],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
      {
        _id: "claim-active-b",
        orderId: "order-a",
        claimNo: "CLM-ACTIVE-B",
        claimantOpenid: "customer-a",
        claimantRole: "customer",
        claimType: "refund",
        status: "under_review",
        description: "active claim b",
        auditTrail: [],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
  });
  const activeClaimKeepAdmin = await loadFunction({ openid: "admin-a", db: activeClaimKeepDb, env: { APP_ENV: "production", ADMIN_OPENIDS: "admin-a" } });
  try {
    const result = await invoke(activeClaimKeepAdmin.main, { action: "updateProtectionClaimStatus", data: { claimId: "claim-active-a", status: "resolved" } });
    assert.strictEqual(result.success, true);
    assert.strictEqual(activeClaimKeepDb.data.orders[0].activeClaimId, "claim-active-b");
    assert.strictEqual(activeClaimKeepDb.data.orders[0].afterSaleStatus, "under_review");
  } finally {
    activeClaimKeepAdmin.restore();
  }

  const activeClaimNextDb = createPrivacyDB({
    orders: [seedOrder({ activeClaimId: "claim-active-a", afterSaleStatus: "under_review" })],
    protectionClaims: [
      {
        _id: "claim-active-a",
        orderId: "order-a",
        claimNo: "CLM-ACTIVE-A",
        claimantOpenid: "customer-a",
        claimantRole: "customer",
        claimType: "complaint",
        status: "under_review",
        description: "active claim a",
        auditTrail: [],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
      {
        _id: "claim-active-b",
        orderId: "order-a",
        claimNo: "CLM-ACTIVE-B",
        claimantOpenid: "customer-a",
        claimantRole: "customer",
        claimType: "refund",
        status: "submitted",
        description: "active claim b",
        auditTrail: [],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
  });
  const activeClaimNextAdmin = await loadFunction({ openid: "admin-a", db: activeClaimNextDb, env: { APP_ENV: "production", ADMIN_OPENIDS: "admin-a" } });
  try {
    const result = await invoke(activeClaimNextAdmin.main, { action: "updateProtectionClaimStatus", data: { claimId: "claim-active-a", status: "resolved" } });
    assert.strictEqual(result.success, true);
    assert.strictEqual(activeClaimNextDb.data.orders[0].activeClaimId, "claim-active-b");
    assert.strictEqual(activeClaimNextDb.data.orders[0].afterSaleStatus, "submitted");
  } finally {
    activeClaimNextAdmin.restore();
  }

  const proofDb = createPrivacyDB({ orders: [seedOrder({ status: "in_service" })] });
  const proofCleaner = await loadFunction({ openid: "cleaner-a", db: proofDb, env: { APP_ENV: "production" } });
  try {
    const result = await invoke(proofCleaner.main, {
      action: "submitServiceProof",
      data: { orderId: "order-a", completionPhotoUrls: ["cloud://done-1"], serviceProof: { note: "Completed kitchen and bedroom." } },
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(proofDb.data.orders[0].completionPhotoUrls.length, 1);
    assert.strictEqual(proofDb.data.orders[0].serviceProof.note, "Completed kitchen and bedroom.");
    assertAuditSafe(proofDb, "submitServiceProof");
    expectFailed(
      await invoke(proofCleaner.main, {
        action: "submitServiceProof",
        data: { orderId: "order-a", completionPhotoUrls: ["1", "2", "3", "4", "5", "6", "7"] },
      }),
      "INVALID_INPUT",
      null,
      "too many service proof images"
    );
  } finally {
    proofCleaner.restore();
  }

  for (const status of ["waiting_complete", "waiting_acceptance"]) {
    const db = createPrivacyDB({ orders: [seedOrder({ status })] });
    const context = await loadFunction({ openid: "cleaner-a", db, env: { APP_ENV: "production" } });
    try {
      const result = await invoke(context.main, {
        action: "submitServiceProof",
        data: { orderId: "order-a", completionPhotoUrls: ["cloud://done-1"] },
      });
      assert.strictEqual(result.success, true, `${status} submitServiceProof should succeed`);
    } finally {
      context.restore();
    }
  }

  for (const status of ["completed", "auto_completed", "cancelled", "confirmed"]) {
    const db = createPrivacyDB({ orders: [seedOrder({ status })] });
    const context = await loadFunction({ openid: "cleaner-a", db, env: { APP_ENV: "production" } });
    try {
      const result = await invoke(context.main, {
        action: "submitServiceProof",
        data: { orderId: "order-a", completionPhotoUrls: ["cloud://done-1"] },
      });
      expectFailed(result, "INVALID_STATUS", null, `${status} submitServiceProof should fail`);
    } finally {
      context.restore();
    }
  }

  const proofStranger = await loadFunction({ openid: "cleaner-b", db: createPrivacyDB(), env: { APP_ENV: "production" } });
  try {
    const result = await invoke(proofStranger.main, {
      action: "submitServiceProof",
      data: { orderId: "order-a", completionPhotoUrls: ["cloud://done-1"] },
    });
    expectFailed(result, "FORBIDDEN", null, "stranger submitServiceProof");
  } finally {
    proofStranger.restore();
  }

  const assignedDb = createPrivacyDB({
    orders: [
      seedOrder({
        _id: "assigned-order",
        publishMode: "assigned",
        status: "assigned_waiting_accept",
        acceptedCleanerOpenid: "",
        assignedCleanerOpenid: "cleaner-a",
        cleanerId: "cleaner-a",
      }),
    ],
  });
  const assignedCleaner = await loadFunction({ openid: "cleaner-a", db: assignedDb, env: { APP_ENV: "production" } });
  try {
    const result = await invoke(assignedCleaner.main, {
      action: "reportCleanerException",
      data: { orderId: "assigned-order", description: "Customer requested a schedule change.", imageFileIDs: ["cloud://exception-1"] },
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(assignedDb.data.protectionClaims[0].claimType, "cleaner_exception");
    assertAuditSafe(assignedDb, "reportCleanerException");
    const safetyRisk = await invoke(assignedCleaner.main, {
      action: "reportCleanerException",
      data: { orderId: "assigned-order", claimType: "safety_risk", description: "Safety concern reported by cleaner." },
    });
    assert.strictEqual(safetyRisk.success, true);
    assert.strictEqual(assignedDb.data.protectionClaims[1].claimType, "safety_risk");
    expectFailed(
      await invoke(assignedCleaner.main, {
        action: "reportCleanerException",
        data: { orderId: "assigned-order", claimType: "refund", description: "refund should not be reported through exception action" },
      }),
      "INVALID_INPUT",
      null,
      "cleaner exception refund type"
    );
    expectFailed(
      await invoke(assignedCleaner.main, {
        action: "reportCleanerException",
        data: { orderId: "assigned-order", claimType: "complaint", description: "complaint should not be reported through exception action" },
      }),
      "INVALID_INPUT",
      null,
      "cleaner exception complaint type"
    );
  } finally {
    assignedCleaner.restore();
  }

  const exceptionStranger = await loadFunction({ openid: "cleaner-b", db: assignedDb, env: { APP_ENV: "production" } });
  try {
    const result = await invoke(exceptionStranger.main, {
      action: "reportCleanerException",
      data: { orderId: "assigned-order", description: "I should not report this" },
    });
    expectFailed(result, "FORBIDDEN", null, "stranger reportCleanerException");
  } finally {
    exceptionStranger.restore();
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
    "pages/protection/index",
    "pages/service-standard/index",
    "pages/claim-create/index",
    "pages/claim-detail/index",
    "pages/claim-list/index",
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
  const orderDetailWxml = fs.readFileSync(path.join(root, "miniprogram/pages/order-detail/index.wxml"), "utf8");
  const claimCreateText = fs.readFileSync(path.join(root, "miniprogram/pages/claim-create/index.js"), "utf8");
  const orderCardWxml = fs.readFileSync(path.join(root, "miniprogram/components/order-card/index.wxml"), "utf8");
  const profileText = fs.readFileSync(path.join(root, "miniprogram/pages/profile/index.js"), "utf8");
  const formatText = fs.readFileSync(path.join(root, "miniprogram/utils/format.js"), "utf8");
  const frontendPricingText = fs.readFileSync(path.join(root, "miniprogram/config/pricing.js"), "utf8");
  const cloudIndexText = fs.readFileSync(path.join(root, "cloudfunctions/quickstartFunctions/index.js"), "utf8");
  assert(orderCreateText.includes("cleanerOpenidOf"), "order-create should use cleanerOpenidOf");
  assert(orderCreateText.includes("createPricingQuote"), "order-create should request server pricing quotes");
  assert(orderCreateText.includes("quoteId"), "order-create should submit quoteId");
  assert(orderCreateText.includes("请选择服务地址后获取报价"), "order-create should not show fallback amount without city");
  assert(/not authoritative|legacy|fallback/i.test(frontendPricingText), "miniprogram/config/pricing.js should be marked as non-authoritative fallback");
  assert(!/createPricingQuoteRecord\(data,\s*openid/.test(cloudIndexText), "createPricingQuote public action should sanitize user pricing input");
  assert(orderDetailText.includes("cleanerOpenidOf"), "order-detail should use cleanerOpenidOf");
  assert(orderDetailText.includes("openClaimCreate"), "order-detail should include claim create entry");
  assert(orderDetailText.includes("openExceptionReport"), "order-detail should include cleaner exception entry");
  assert(orderDetailText.includes("canCleanerAfterSale"), "order-detail should compute canCleanerAfterSale by fulfillment status");
  assert(!/canAfterSale:\s*isCustomer\s*\|\|\s*isAcceptedCleaner/.test(orderDetailText), "order-detail should not expose after-sales to all acceptedCleanerOpenid states");
  assert(!/canAfterSale:\s*isCustomer\s*\|\|\s*isAcceptedCleaner\s*\|\|\s*isAssignedCleaner/.test(orderDetailText), "assigned cleaner should use exception report, not general after-sales");
  assert(claimCreateText.includes("getUserRole"), "claim-create should read current user role");
  assert(/getUserRole\(\)\s*===\s*"cleaner"|role\s*===\s*"cleaner"/.test(claimCreateText), "claim-create should check cleaner role before reportCleanerException");
  assert(/cleaner_exception/.test(claimCreateText) && /safety_risk/.test(claimCreateText) && /reportCleanerException/.test(claimCreateText), "claim-create should route cleaner exception and safety_risk to reportCleanerException");
  assert(orderDetailWxml.includes("openClaimCreate"), "order-detail wxml should expose after-sales entry");
  assert(orderDetailWxml.includes("openExceptionReport"), "order-detail wxml should expose cleaner exception entry");
  assert(profileText.includes("openAfterSales"), "profile should include after-sales list entry");
  const extraGroupMatch = orderCardWxml.match(/<view[^>]*class="order-extra-group"[\s\S]*?<\/view>/);
  assert(extraGroupMatch, "order-card should retain order-extra-group for review/distance metadata");
  assert(!extraGroupMatch[0].includes("afterSaleStatusText"), "afterSaleStatusText should not be rendered inside order-extra-group");
  if (orderCardWxml.includes("afterSaleStatusText")) {
    assert(orderCardWxml.includes("after-sale-line"), "afterSaleStatusText should use an independent line when shown on cards");
  }
  assert(/Boolean\(order\.myResponse\)|order\.myResponse/.test(orderDetailText), "order-detail should include order.myResponse in hasResponse");
  assert(/responseCount:\s*Number\(order\.responseCount\s*\?\?/.test(formatText), "decorateOrder should preserve backend responseCount");
  assert(formatText.includes("afterSaleStatusText"), "decorateOrder should expose afterSaleStatusText");
  assert(
    !/function decorateReviewForDisplay[\s\S]*?return\s*{\s*\.\.\.review/.test(cloudIndexText),
    "decorateReviewForDisplay should not spread raw review fields"
  );
  const attachReviewInfoBlock = (cloudIndexText.match(/async function attachReviewInfo[\s\S]*?async function attachReviewInfoList/) || [""])[0];
  assert(attachReviewInfoBlock.includes("publicOrderReview"), "attachReviewInfo should return publicOrderReview");
  assert(!/\n\s*review,\s*\n/.test(attachReviewInfoBlock), "attachReviewInfo should not return raw review");
  assert(
    !/manualReview\s*=\s*isManualReview\(review\)\s*\?\s*{\s*\.\.\.review/.test(cloudIndexText),
    "getOrderDetail should not spread raw review into manualReview"
  );
  const listReceivedReviewsBlock = (cloudIndexText.match(/async function listReceivedReviews[\s\S]*?async function submitReview/) || [""])[0];
  assert(listReceivedReviewsBlock.includes("publicOrderReview"), "listReceivedReviews should return publicOrderReview");
  assert(!/\{\s*\.\.\.review/.test(listReceivedReviewsBlock), "listReceivedReviews should not spread raw review");

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
  .then(runOrderReviewPayloadTests)
  .then(runPricingEngineTests)
  .then(runAuditLogTests)
  .then(runSupportTicketTests)
  .then(runProtectionWorkflowTests)
  .then(runStaticMiniprogramTests)
  .then(() => {
    console.log("action tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
