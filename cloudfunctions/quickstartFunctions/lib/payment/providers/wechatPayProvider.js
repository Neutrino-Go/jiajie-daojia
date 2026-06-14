const crypto = require("crypto");
const { createPaymentIntentSnapshot, payableAmountOf } = require("../paymentIntent");

const REQUIRED_CONFIG = [
  "WECHAT_PAY_APPID",
  "WECHAT_PAY_MCH_ID",
  "WECHAT_PAY_SERIAL_NO",
  "WECHAT_PAY_PRIVATE_KEY",
  "WECHAT_PAY_API_V3_KEY",
  "WECHAT_PAY_NOTIFY_URL",
];

function roundFen(yuan) {
  return Math.round(Number(yuan || 0) * 100);
}

function randomNonce() {
  return crypto.randomBytes(16).toString("hex");
}

function readWechatPayConfig(env = process.env) {
  const config = {
    appId: String(env.WECHAT_PAY_APPID || "").trim(),
    mchId: String(env.WECHAT_PAY_MCH_ID || "").trim(),
    serialNo: String(env.WECHAT_PAY_SERIAL_NO || "").trim(),
    privateKey: String(env.WECHAT_PAY_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim(),
    apiV3Key: String(env.WECHAT_PAY_API_V3_KEY || "").trim(),
    notifyUrl: String(env.WECHAT_PAY_NOTIFY_URL || "").trim(),
    refundNotifyUrl: String(env.WECHAT_PAY_REFUND_NOTIFY_URL || env.WECHAT_PAY_NOTIFY_URL || "").trim(),
    platformPublicKey: String(env.WECHAT_PAY_PLATFORM_PUBLIC_KEY || "").replace(/\\n/g, "\n").trim(),
    testPrepayId: String(env.WECHAT_PAY_TEST_PREPAY_ID || "").trim(),
  };
  config.missing = REQUIRED_CONFIG.filter((key) => {
    const field = {
      WECHAT_PAY_APPID: "appId",
      WECHAT_PAY_MCH_ID: "mchId",
      WECHAT_PAY_SERIAL_NO: "serialNo",
      WECHAT_PAY_PRIVATE_KEY: "privateKey",
      WECHAT_PAY_API_V3_KEY: "apiV3Key",
      WECHAT_PAY_NOTIFY_URL: "notifyUrl",
    }[key];
    return !config[field];
  });
  return config;
}

function redactedWechatPayConfig(config = readWechatPayConfig()) {
  return {
    appId: config.appId ? `${config.appId.slice(0, 4)}***` : "",
    mchId: config.mchId ? `${config.mchId.slice(0, 4)}***` : "",
    serialNo: config.serialNo ? `${config.serialNo.slice(0, 6)}***` : "",
    notifyUrl: config.notifyUrl || "",
    refundNotifyUrl: config.refundNotifyUrl || "",
    configured: !config.missing || config.missing.length === 0,
    missing: (config.missing || []).slice(),
  };
}

function assertWechatPayConfig(config = readWechatPayConfig()) {
  if (config.missing && config.missing.length) {
    throw new Error(`微信支付配置缺失: ${config.missing.join(", ")}`);
  }
}

function signWechatPayMessage(message, privateKey) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(message);
  signer.end();
  return signer.sign(privateKey, "base64");
}

function buildWechatPayOrderRequest(order = {}, options = {}, config = readWechatPayConfig()) {
  assertWechatPayConfig(config);
  const amountFen = roundFen(payableAmountOf(order));
  if (amountFen <= 0) throw new Error("订单金额不正确");
  const outTradeNo =
    options.outTradeNo ||
    `JJ${String(order._id || order.orderId || "").replace(/[^A-Za-z0-9]/g, "").slice(-18)}${Date.now().toString().slice(-8)}`;
  return {
    appid: config.appId,
    mchid: config.mchId,
    description: String(options.description || order.serviceType || "家洁到家服务订单").slice(0, 120),
    out_trade_no: outTradeNo,
    notify_url: config.notifyUrl,
    amount: {
      total: amountFen,
      currency: "CNY",
    },
    payer: {
      openid: order.customerOpenid || options.openid || "",
    },
  };
}

function createJsapiPayParams({ appId, prepayId, privateKey, serialNo, timestamp, nonceStr }) {
  if (!prepayId) throw new Error("缺少微信支付 prepay_id");
  const timeStamp = String(timestamp || Math.floor(Date.now() / 1000));
  const nonce = nonceStr || randomNonce();
  const packageValue = `prepay_id=${prepayId}`;
  const message = `${appId}\n${timeStamp}\n${nonce}\n${packageValue}\n`;
  return {
    timeStamp,
    nonceStr: nonce,
    package: packageValue,
    signType: "RSA",
    paySign: signWechatPayMessage(message, privateKey),
    serialNo,
  };
}

function createWechatPaymentIntent(order = {}, options = {}) {
  const config = readWechatPayConfig(options.env || process.env);
  const requestPayload = buildWechatPayOrderRequest(order, options, config);
  const prepayId = options.prepayId || config.testPrepayId;
  if (!prepayId) {
    throw new Error("微信支付下单客户端未配置，无法生成 prepay_id");
  }
  const snapshot = createPaymentIntentSnapshot(order, options);
  const payParams = createJsapiPayParams({
    appId: config.appId,
    prepayId,
    privateKey: config.privateKey,
    serialNo: config.serialNo,
    timestamp: options.timestamp,
    nonceStr: options.nonceStr,
  });
  return {
    ...snapshot,
    paymentProvider: "wechat_pay",
    providerMode: "wechat_pay_jsapi",
    providerStatus: "prepay_created",
    providerConfig: redactedWechatPayConfig(config),
    providerOrderRequest: requestPayload,
    outTradeNo: requestPayload.out_trade_no,
    prepayId,
    payParams,
    amountFen: requestPayload.amount.total,
  };
}

function verifyWechatPaySignature(headers = {}, rawBody = "", config = readWechatPayConfig()) {
  const signature = headers["wechatpay-signature"] || headers["Wechatpay-Signature"] || headers.signature || "";
  const serial = headers["wechatpay-serial"] || headers["Wechatpay-Serial"] || headers.serial || "";
  const timestamp = headers["wechatpay-timestamp"] || headers["Wechatpay-Timestamp"] || headers.timestamp || "";
  const nonce = headers["wechatpay-nonce"] || headers["Wechatpay-Nonce"] || headers.nonce || "";
  if (!signature || !serial || !timestamp || !nonce) return false;
  if (config.platformPublicKey) {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
    verifier.end();
    return verifier.verify(config.platformPublicKey, signature, "base64");
  }
  return serial === config.serialNo;
}

function normalizeWechatPayCallback(data = {}) {
  const resource = data.resource || {};
  const plaintext = resource.plaintext || data.plaintext || {};
  const transaction = typeof plaintext === "string" ? JSON.parse(plaintext) : plaintext;
  return {
    eventId: data.id || data.eventId || transaction.transaction_id || "",
    outTradeNo: transaction.out_trade_no || data.outTradeNo || "",
    transactionId: transaction.transaction_id || data.transactionId || "",
    status: transaction.trade_state === "SUCCESS" || data.status === "paid" ? "paid" : data.status || "failed",
    amount: Number(transaction.amount && transaction.amount.total ? transaction.amount.total / 100 : data.amount || 0),
    occurredAt: data.create_time || transaction.success_time || new Date().toISOString(),
  };
}

module.exports = {
  buildWechatPayOrderRequest,
  createJsapiPayParams,
  createWechatPaymentIntent,
  normalizeWechatPayCallback,
  readWechatPayConfig,
  redactedWechatPayConfig,
  roundFen,
  verifyWechatPaySignature,
};
