const { createManualStubPaymentIntent } = require("./manualStubProvider");
const { createWechatPaymentIntent, readWechatPayConfig, redactedWechatPayConfig } = require("./wechatPayProvider");

function appEnvOf(env = process.env) {
  return String(env.APP_ENV || env.NODE_ENV || env.WX_APP_ENV || "")
    .trim()
    .toLowerCase();
}

function isExplicitNonProductionEnv(env = process.env) {
  return ["local", "dev", "development", "test", "testing"].includes(appEnvOf(env));
}

function isProductionEnv(env = process.env) {
  return !isExplicitNonProductionEnv(env);
}

function paymentProviderName(env = process.env) {
  const configured = String(env.PAYMENT_PROVIDER || "").trim().toLowerCase();
  if (configured) return configured;
  return isProductionEnv(env) ? "wechat_pay" : "manual_stub";
}

function selectPaymentProvider(options = {}) {
  const env = options.env || process.env;
  const name = paymentProviderName(env);
  if (name === "manual_stub") {
    if (isProductionEnv(env)) {
      throw new Error("正式环境不支持 manual_stub 支付 provider");
    }
    return {
      name: "manual_stub",
      publicStatus: {
        provider: "manual_stub",
        enabled: true,
        productionReady: false,
        message: "非生产环境手动支付占位，仅用于测试流程。",
      },
      createPaymentIntent({ order, openid, idempotencyKey, createdAt }) {
        return createManualStubPaymentIntent(order, { idempotencyKey, createdAt, userOpenid: openid });
      },
    };
  }
  if (name === "wechat_pay") {
    const config = readWechatPayConfig(env);
    return {
      name: "wechat_pay",
      publicStatus: {
        provider: "wechat_pay",
        enabled: true,
        productionReady: !config.missing.length,
        config: redactedWechatPayConfig(config),
        message: config.missing.length ? "微信支付配置缺失，当前不能发起真实支付。" : "微信支付 JSAPI provider 已配置。",
      },
      createPaymentIntent({ order, openid, idempotencyKey, createdAt }) {
        return createWechatPaymentIntent(order, {
          idempotencyKey,
          createdAt,
          userOpenid: openid,
          openid,
          env,
        });
      },
    };
  }
  return {
    name: "disabled",
    publicStatus: {
      provider: "disabled",
      enabled: false,
      productionReady: false,
      message: "支付能力待接入。",
    },
    createPaymentIntent() {
      throw new Error("支付能力待接入");
    },
  };
}

function getPaymentProviderStatus(env = process.env) {
  try {
    return selectPaymentProvider({ env }).publicStatus;
  } catch (error) {
    return {
      provider: paymentProviderName(env),
      enabled: false,
      productionReady: false,
      message: error.message,
    };
  }
}

module.exports = {
  appEnvOf,
  getPaymentProviderStatus,
  isExplicitNonProductionEnv,
  isProductionEnv,
  paymentProviderName,
  selectPaymentProvider,
};
