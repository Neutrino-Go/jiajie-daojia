const { createPaymentIntentSnapshot } = require("../paymentIntent");

function createManualStubPaymentIntent(order = {}, options = {}) {
  const snapshot = createPaymentIntentSnapshot(order, options);
  return {
    ...snapshot,
    paymentProvider: "manual_stub",
    providerMode: "offline_manual_stub",
    providerStatus: "pending_manual_confirmation",
    payParams: null,
  };
}

module.exports = {
  createManualStubPaymentIntent,
};
