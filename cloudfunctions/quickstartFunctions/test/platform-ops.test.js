const assert = require("assert");

const paymentIntent = require("../lib/payment/paymentIntent");
const paymentCallback = require("../lib/payment/paymentCallback");
const paymentStatus = require("../lib/payment/paymentStatus");
const settlementEngine = require("../lib/settlement/settlementEngine");
const cleanerPayout = require("../lib/settlement/cleanerPayout");
const slaEngine = require("../lib/sla/slaEngine");
const orderReconcile = require("../lib/reconciliation/orderReconcile");
const payoutReconcile = require("../lib/reconciliation/payoutReconcile");
const paymentProvider = require("../lib/payment/providers/paymentProvider");
const wechatPayProvider = require("../lib/payment/providers/wechatPayProvider");

const order = {
  _id: "order-paid",
  orderNo: "ORD-1",
  customerOpenid: "customer-a",
  acceptedCleanerOpenid: "cleaner-a",
  status: "waiting_payment",
  orderAmount: 129,
  customerPayAmount: 129,
  cleanerIncome: 100,
  platformFee: 29,
};

const firstIntent = paymentIntent.createPaymentIntentSnapshot(order, {
  idempotencyKey: "same-key",
  createdAt: "2026-06-14T00:00:00.000Z",
});
const secondIntent = paymentIntent.createPaymentIntentSnapshot(order, {
  idempotencyKey: "same-key",
  createdAt: "2026-06-14T00:00:00.000Z",
});
assert.strictEqual(firstIntent.intentKey, secondIntent.intentKey, "same idempotencyKey should create same intent key");
assert.strictEqual(firstIntent.status, "pending");
assert.strictEqual(paymentStatus.nextPaymentStatus("pending", "paid"), "paid");
assert.throws(() => paymentStatus.nextPaymentStatus("paid", "paid"), /不能重复支付/);
assert.throws(() => paymentStatus.nextPaymentStatus("refunded", "paid"), /不能从已退款变为已支付/);

const paidCallback = paymentCallback.applyPaymentCallback(firstIntent, {
  eventId: "evt-paid",
  intentId: firstIntent.intentId,
  status: "paid",
  amount: 129,
  orderId: "order-paid",
  occurredAt: "2026-06-14T00:01:00.000Z",
});
assert.strictEqual(paidCallback.status, "paid");
assert.strictEqual(paidCallback.paymentStatus, "paid");
assert.strictEqual(paidCallback.escrowStatus, "held");
assert.throws(
  () => paymentCallback.applyPaymentCallback(firstIntent, { eventId: "evt-bad", intentId: firstIntent.intentId, status: "paid", amount: 1, orderId: "order-paid" }),
  /支付回调金额不一致/
);

const slaPenalty = slaEngine.calculateSlaPenalty({ delayMinutes: 45, cancelAfterAccept: true, noShow: true });
assert.strictEqual(slaPenalty.penalty, 85);
assert.deepStrictEqual(slaPenalty.reasons, ["delay_over_30min", "cancel_after_accept", "no_show"]);

const payout = cleanerPayout.calculateCleanerPayout({ cleanerIncome: 100, penalty: 20, bonus: 5 });
assert.strictEqual(payout.payoutAmount, 85);
assert.strictEqual(payout.cleanerIncome, 100);

const settlement = settlementEngine.createSettlementSnapshot(
  { ...order, status: "completed", paymentStatus: "escrowed" },
  { penalty: 20, bonus: 5, createdAt: "2026-06-14T00:02:00.000Z" }
);
assert.strictEqual(settlement.payoutAmount, 85);
assert.strictEqual(settlement.platformFee, 29);
assert.strictEqual(settlement.status, "pending_payout");

const orderMismatches = orderReconcile.reconcileOrders({
  orders: [{ _id: "order-a", paymentStatus: "unpaid", settlementStatus: "pending" }],
  paymentIntents: [{ orderId: "order-a", status: "paid", amount: 79 }],
  settlements: [],
});
assert(orderMismatches.mismatches.some((item) => item.type === "paid_intent_order_not_paid"));

const payoutMismatches = payoutReconcile.reconcilePayouts({
  settlements: [{ orderId: "order-a", cleanerIncome: 100, penalty: 10, bonus: 0, payoutAmount: 100 }],
});
assert(payoutMismatches.mismatches.some((item) => item.type === "payout_amount_mismatch"));

assert.throws(
  () => paymentProvider.selectPaymentProvider({ env: { APP_ENV: "production", PAYMENT_PROVIDER: "manual_stub" } }),
  /正式环境不支持 manual_stub/,
  "manual_stub should be blocked in production"
);
assert.strictEqual(
  paymentProvider.selectPaymentProvider({ env: { APP_ENV: "development", PAYMENT_PROVIDER: "manual_stub" } }).name,
  "manual_stub",
  "manual_stub should be available only in explicit non-production"
);
const missingWechatConfig = wechatPayProvider.readWechatPayConfig({ APP_ENV: "production", PAYMENT_PROVIDER: "wechat_pay" });
assert(missingWechatConfig.missing.includes("WECHAT_PAY_MCH_ID"), "WeChat Pay config should report missing merchant id");

const { privateKey } = require("crypto").generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const fakeWechatEnv = {
  WECHAT_PAY_APPID: "wx-test-appid",
  WECHAT_PAY_MCH_ID: "mch-test",
  WECHAT_PAY_SERIAL_NO: "serial-test",
  WECHAT_PAY_PRIVATE_KEY: privatePem,
  WECHAT_PAY_API_V3_KEY: "0123456789abcdef0123456789abcdef",
  WECHAT_PAY_NOTIFY_URL: "https://example.com/pay/callback",
  WECHAT_PAY_TEST_PREPAY_ID: "wx-prepay-test",
};
const wechatIntent = wechatPayProvider.createWechatPaymentIntent(order, {
  idempotencyKey: "wechat-key",
  createdAt: "2026-06-14T00:00:00.000Z",
  env: fakeWechatEnv,
});
assert.strictEqual(wechatIntent.paymentProvider, "wechat_pay");
assert.strictEqual(wechatIntent.amountFen, 12900);
assert(wechatIntent.payParams.package.startsWith("prepay_id="), "WeChat pay params should include prepay package");
assert(wechatIntent.payParams.paySign, "WeChat pay params should include signed paySign");
assert.strictEqual(
  wechatPayProvider.verifyWechatPaySignature({}, "{}", wechatPayProvider.readWechatPayConfig(fakeWechatEnv)),
  false,
  "WeChat callback signature should fail closed when headers are missing"
);

console.log("platform ops tests passed");
