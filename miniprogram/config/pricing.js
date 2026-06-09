const PRICING_VERSION = "2026-06-v0.2.3";
const PAYMENT_FEE_RATE_ESTIMATE = 0.006;
const PROTECTION_FEE = 0;
const INSURANCE_COST_ALLOCATION = 0;
const QUOTE_TTL_MINUTES = 30;
const DEFAULT_CITY = "\u676d\u5dde\u5e02";

const CITY_GROUPS = {
  A: ["\u4e0a\u6d77\u5e02", "\u5317\u4eac\u5e02", "\u6df1\u5733\u5e02", "\u5e7f\u5dde\u5e02"],
  B: ["\u676d\u5dde\u5e02", "\u82cf\u5dde\u5e02", "\u5357\u4eac\u5e02"],
  C: ["\u65e0\u9521\u5e02"],
  D: ["\u54c8\u5c14\u6ee8\u5e02"],
};

const SERVICE_TYPE_KEY_MAP = {
  daily: "daily",
  deep: "deep",
  moveIn: "moveIn",
  movein: "moveIn",
  organize: "organize",
  storage: "organize",
  "\u65e5\u5e38\u4fdd\u6d01": "daily",
  "\u6df1\u5ea6\u4fdd\u6d01": "deep",
  "\u5f00\u8352\u4fdd\u6d01": "moveIn",
  "\u5bb6\u52a1\u6574\u7406": "organize",
  "\u6536\u7eb3\u6574\u7406": "organize",
};

const SERVICE_TYPE_LABELS = {
  daily: "\u65e5\u5e38\u4fdd\u6d01",
  deep: "\u6df1\u5ea6\u4fdd\u6d01",
  moveIn: "\u5f00\u8352\u4fdd\u6d01",
  organize: "\u5bb6\u52a1\u6574\u7406",
};

const PLATFORM_FEE_RATES = {
  daily: 0.03,
  deep: 0.05,
  moveIn: 0.08,
  organize: 0.08,
};

const CLEANER_HOURLY_FLOORS = {
  A: 48,
  B: 43,
  C: 40,
  D: 40,
};

const CLEANER_MOVE_IN_RATES = {
  A: 4.2,
  B: 3.9,
  C: 3.8,
  D: 3.5,
};

const HOURLY_PRICE_TABLE = {
  daily: {
    A: { launch: { 2: 79, 3: 119, 4: 159, 5: 199 }, list: { 2: 98, 3: 145, 4: 188, 5: 229 } },
    B: { launch: { 2: 75, 3: 109, 4: 145, 5: 179 }, list: { 2: 89, 3: 129, 4: 169, 5: 209 } },
    C: { launch: { 2: 69, 3: 99, 4: 132, 5: 165 }, list: { 2: 79, 3: 119, 4: 155, 5: 189 } },
    D: { launch: { 2: 65, 3: 95, 4: 125, 5: 155 }, list: { 2: 75, 3: 109, 4: 145, 5: 179 } },
  },
  deep: {
    A: { launch: { 2: 129, 3: 169, 4: 219, 5: 269 } },
    B: { launch: { 2: 119, 3: 159, 4: 209, 5: 259 } },
    C: { launch: { 2: 109, 3: 149, 4: 199, 5: 239 } },
    D: { launch: { 2: 99, 3: 139, 4: 185, 5: 229 } },
  },
  organize: {
    A: { launch: { 2: 139, 3: 199, 4: 259, 5: 319 } },
    B: { launch: { 2: 129, 3: 179, 4: 239, 5: 299 } },
    C: { launch: { 2: 119, 3: 169, 4: 219, 5: 279 } },
    D: { launch: { 2: 105, 3: 149, 4: 199, 5: 249 } },
  },
};

const MOVE_IN_CITY_PRICES = {
  "\u4e0a\u6d77\u5e02": 5.9,
  "\u5317\u4eac\u5e02": 5.9,
  "\u6df1\u5733\u5e02": 5.9,
  "\u5e7f\u5dde\u5e02": 5.9,
  "\u676d\u5dde\u5e02": 5.9,
  "\u82cf\u5dde\u5e02": 5.5,
  "\u5357\u4eac\u5e02": 5.5,
  "\u65e0\u9521\u5e02": 5.5,
  "\u54c8\u5c14\u6ee8\u5e02": 4.9,
};

const BASE_PRICING = {
  platformFeeRate: PLATFORM_FEE_RATES.daily,
  pricingAuthority: "server",
  note: "This copy is for legacy UI fallback only and is not authoritative. Server quotes are authoritative.",
};

const CITY_PRICING = Object.fromEntries(
  Object.entries(CITY_GROUPS).flatMap(([cityGroup, cities]) =>
    cities.map((city) => [
      city,
      {
        city,
        cityGroup,
        minCleanerHourlyIncome: CLEANER_HOURLY_FLOORS[cityGroup],
      },
    ])
  )
);

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeServiceTypeKey(serviceType) {
  const raw = String(serviceType || "").trim();
  return SERVICE_TYPE_KEY_MAP[raw] || raw || "daily";
}

function serviceTypeLabel(serviceType) {
  return SERVICE_TYPE_LABELS[normalizeServiceTypeKey(serviceType)] || String(serviceType || "");
}

function getCityGroup(city) {
  const name = String(city || "").trim();
  for (const [group, cities] of Object.entries(CITY_GROUPS)) {
    if (cities.includes(name)) return group;
  }
  return "B";
}

function ruleIdFor(rule) {
  return `${rule.serviceType}-${rule.city || rule.cityGroup}-${rule.pricingMode}-${rule.durationHours || "area"}-${rule.version}`;
}

function getMoveInAreaUnitPrice(city) {
  const cityName = String(city || "").trim();
  const cityGroup = getCityGroup(cityName);
  return MOVE_IN_CITY_PRICES[cityName] || (cityGroup === "D" ? 4.9 : cityGroup === "C" ? 5.5 : 5.9);
}

function getDefaultPricingRules() {
  const rules = [];
  Object.entries(HOURLY_PRICE_TABLE).forEach(([serviceType, groups]) => {
    Object.entries(groups).forEach(([cityGroup, config]) => {
      Object.keys(config.launch).forEach((duration) => {
        const durationHours = Number(duration);
        const launchPrice = config.launch[duration];
        const listPrice = (config.list && config.list[duration]) || launchPrice;
        const rule = {
          version: PRICING_VERSION,
          city: "",
          cityGroup,
          serviceType,
          pricingMode: "hourly",
          durationHours,
          listPrice,
          launchPrice,
          platformFeeRate: PLATFORM_FEE_RATES[serviceType],
          cleanerHourlyFloor: CLEANER_HOURLY_FLOORS[cityGroup],
          minimumCleanerIncome: CLEANER_HOURLY_FLOORS[cityGroup] * durationHours,
          enabled: true,
          notes: "pricing fields are RMB yuan numbers",
        };
        rules.push({ _id: ruleIdFor(rule), ruleCode: ruleIdFor(rule), ...rule });
      });
    });
  });
  Object.entries(MOVE_IN_CITY_PRICES).forEach(([city, areaUnitPrice]) => {
    const cityGroup = getCityGroup(city);
    const rule = {
      version: PRICING_VERSION,
      city,
      cityGroup,
      serviceType: "moveIn",
      pricingMode: "area",
      durationHours: 0,
      areaUnitPrice,
      minAreaSqm: 60,
      listPrice: 0,
      launchPrice: 0,
      platformFeeRate: PLATFORM_FEE_RATES.moveIn,
      cleanerMoveInRatePerSqm: CLEANER_MOVE_IN_RATES[cityGroup],
      minimumCleanerIncome: 180,
      enabled: true,
      notes: "pricing fields are RMB yuan numbers",
    };
    rules.push({ _id: ruleIdFor(rule), ruleCode: ruleIdFor(rule), ...rule });
  });
  return rules;
}

function normalizeRule(rule = {}) {
  const serviceType = normalizeServiceTypeKey(rule.serviceType);
  const city = String(rule.city || "").trim();
  const cityGroup = rule.cityGroup || getCityGroup(city);
  const pricingMode = rule.pricingMode || (serviceType === "moveIn" ? "area" : "hourly");
  return {
    ...rule,
    _id: rule._id || rule.ruleCode || "",
    ruleCode: rule.ruleCode || rule._id || "",
    version: rule.version || PRICING_VERSION,
    city,
    cityGroup,
    serviceType,
    pricingMode,
    durationHours: Number(rule.durationHours || 0),
    areaUnitPrice: roundMoney(rule.areaUnitPrice),
    minAreaSqm: Number(rule.minAreaSqm || 0),
    listPrice: roundMoney(rule.listPrice),
    launchPrice: roundMoney(rule.launchPrice),
    platformFeeRate: Number(rule.platformFeeRate ?? PLATFORM_FEE_RATES[serviceType] ?? 0),
    cleanerHourlyFloor: Number(rule.cleanerHourlyFloor || CLEANER_HOURLY_FLOORS[cityGroup] || 40),
    cleanerMoveInRatePerSqm: Number(rule.cleanerMoveInRatePerSqm || CLEANER_MOVE_IN_RATES[cityGroup] || 3.9),
    minimumCleanerIncome: Number(rule.minimumCleanerIncome || 0),
    enabled: rule.enabled !== false,
  };
}

function publicPricingRule(rule = {}) {
  const normalized = normalizeRule(rule);
  return {
    _id: normalized._id,
    ruleCode: normalized.ruleCode,
    version: normalized.version,
    city: normalized.city,
    cityGroup: normalized.cityGroup,
    serviceType: normalized.serviceType,
    serviceTypeText: serviceTypeLabel(normalized.serviceType),
    pricingMode: normalized.pricingMode,
    durationHours: normalized.durationHours,
    areaUnitPrice: normalized.areaUnitPrice,
    minAreaSqm: normalized.minAreaSqm,
    listPrice: normalized.listPrice,
    launchPrice: normalized.launchPrice,
    enabled: normalized.enabled,
  };
}

function fullPricingRule(rule = {}) {
  return normalizeRule(rule);
}

function matchPricingRule(input = {}, rules = []) {
  const serviceType = normalizeServiceTypeKey(input.serviceType);
  const city = String(input.city || "").trim();
  const cityGroup = getCityGroup(city);
  const pricingMode = serviceType === "moveIn" ? "area" : "hourly";
  const durationHours = Number(input.durationHours || 0);
  const normalizedRules = (rules.length ? rules : getDefaultPricingRules())
    .map(normalizeRule)
    .filter((rule) => rule.enabled !== false);

  if (pricingMode === "area") {
    const exact = normalizedRules.find((rule) => rule.serviceType === serviceType && rule.pricingMode === "area" && rule.city === city);
    if (exact) return exact;
    return normalizedRules.find((rule) => rule.serviceType === serviceType && rule.pricingMode === "area" && !rule.city && rule.cityGroup === cityGroup);
  }

  return normalizedRules.find(
    (rule) =>
      rule.serviceType === serviceType &&
      rule.pricingMode === "hourly" &&
      Number(rule.durationHours) === durationHours &&
      (rule.city === city || (!rule.city && rule.cityGroup === cityGroup))
  );
}

function throwPricingInput(message) {
  const error = new Error(message);
  error.code = "INVALID_INPUT";
  throw error;
}

function assertQuoteInput(input = {}) {
  const city = String(input.city || "").trim();
  if (!city) throwPricingInput("\u8bf7\u9009\u62e9\u670d\u52a1\u57ce\u5e02");

  const serviceType = normalizeServiceTypeKey(input.serviceType);
  if (!["daily", "deep", "moveIn", "organize"].includes(serviceType)) {
    throwPricingInput("\u670d\u52a1\u7c7b\u578b\u4e0d\u6b63\u786e");
  }

  if (serviceType === "moveIn") {
    const areaSqm = Number(input.areaSqm || input.areaSize || 0);
    if (!Number.isFinite(areaSqm) || areaSqm <= 0) {
      throwPricingInput("\u5f00\u8352\u4fdd\u6d01\u8bf7\u586b\u5199\u9762\u79ef");
    }
    return;
  }

  const durationHours = Number(input.durationHours || 0);
  if (![2, 3, 4, 5].includes(durationHours)) {
    throwPricingInput("\u8bf7\u9009\u62e9 2-5 \u5c0f\u65f6\u670d\u52a1\u65f6\u957f");
  }
}

function calculateQuote(input = {}, rules = []) {
  assertQuoteInput(input);
  const city = String(input.city || "").trim();
  const cityGroup = getCityGroup(city);
  const serviceType = normalizeServiceTypeKey(input.serviceType);
  const pricingMode = serviceType === "moveIn" ? "area" : "hourly";
  const durationHours = Number(input.durationHours || 0);
  const rule = matchPricingRule({ ...input, serviceType, city }, rules);
  if (!rule) throwPricingInput("\u6682\u672a\u627e\u5230\u53ef\u7528\u4ef7\u683c\u89c4\u5219");

  let listPrice = roundMoney(rule.listPrice || rule.launchPrice);
  let launchPrice = roundMoney(rule.launchPrice || rule.listPrice);
  const areaSqm = Number(input.areaSqm || input.areaSize || 0);
  let billableAreaSqm = 0;
  let cleanerBaseIncome = 0;
  let cleanerIncome = 0;
  let estimate = false;

  if (pricingMode === "area") {
    const minAreaSqm = Number(rule.minAreaSqm || 60);
    billableAreaSqm = Math.max(areaSqm, minAreaSqm);
    listPrice = roundMoney(billableAreaSqm * rule.areaUnitPrice);
    launchPrice = listPrice;
    cleanerBaseIncome = roundMoney(billableAreaSqm * rule.cleanerMoveInRatePerSqm);
    cleanerIncome = roundMoney(Math.max(cleanerBaseIncome, Number(rule.minimumCleanerIncome || 180)));
    estimate = true;
  } else {
    cleanerBaseIncome = roundMoney(Number(rule.cleanerHourlyFloor || 0) * Number(durationHours || 0));
    cleanerIncome = roundMoney(Math.max(cleanerBaseIncome, Number(rule.minimumCleanerIncome || 0)));
  }

  const couponDiscount = roundMoney(Math.max(0, Number(input.couponDiscount || 0)));
  const customerPayAmount = roundMoney(Math.max(0, launchPrice - couponDiscount));
  const platformFundedDiscount = roundMoney(Math.max(0, listPrice - customerPayAmount));
  const platformFeeRate = Number(rule.platformFeeRate || 0);
  const platformFee = roundMoney(customerPayAmount * platformFeeRate);
  const paymentFeeEstimate = roundMoney(customerPayAmount * PAYMENT_FEE_RATE_ESTIMATE);
  const protectionFee = PROTECTION_FEE;
  const insuranceCostAllocation = INSURANCE_COST_ALLOCATION;
  const cashGrossMargin = roundMoney(customerPayAmount - cleanerIncome - protectionFee - insuranceCostAllocation - paymentFeeEstimate);
  const cashBurn = roundMoney(Math.max(0, -cashGrossMargin));
  const platformSubsidy = cashBurn;
  const requiresSubsidy = platformSubsidy > 0;

  return {
    city,
    cityGroup,
    serviceType,
    serviceTypeText: serviceTypeLabel(serviceType),
    pricingMode,
    durationHours,
    areaSqm: pricingMode === "area" ? areaSqm : 0,
    actualAreaSqm: pricingMode === "area" ? areaSqm : 0,
    billableAreaSqm,
    priceRuleId: rule._id || rule.ruleCode || "",
    priceRuleVersion: rule.version || PRICING_VERSION,
    listPrice,
    launchPrice,
    customerPayAmount,
    couponCode: String(input.couponCode || "").trim(),
    couponDiscount,
    platformFundedDiscount,
    platformFeeRate,
    platformFee,
    protectionFee,
    insuranceCostAllocation,
    paymentFeeEstimate,
    cleanerBaseIncome,
    cleanerIncome,
    platformSubsidy,
    cashGrossMargin,
    cashBurn,
    requiresSubsidy,
    subsidyReason: requiresSubsidy ? "launch_price_or_coupon_income_protection" : "",
    marginWarning: cashGrossMargin < 0 ? "NEGATIVE_CASH_MARGIN" : "",
    grossMarginNote: "cashGrossMargin = customerPayAmount - cleanerIncome - protectionFee - insuranceCostAllocation - paymentFeeEstimate",
    estimate,
    pricingSnapshot: null,
    rule,
  };
}

function publicPricingQuote(quote = {}) {
  const snapshot = quote.pricingSnapshot || quote;
  return {
    quoteId: quote.quoteId || snapshot.quoteId || "",
    quoteNo: quote.quoteNo || snapshot.quoteNo || "",
    city: snapshot.city || quote.city || "",
    cityGroup: snapshot.cityGroup || quote.cityGroup || "",
    serviceType: snapshot.serviceType || quote.serviceType || "",
    serviceTypeText: snapshot.serviceTypeText || serviceTypeLabel(snapshot.serviceType || quote.serviceType),
    durationHours: Number(snapshot.durationHours || quote.durationHours || 0),
    areaSqm: Number(snapshot.areaSqm || quote.areaSqm || 0),
    actualAreaSqm: Number(snapshot.actualAreaSqm || quote.actualAreaSqm || 0),
    billableAreaSqm: Number(snapshot.billableAreaSqm || quote.billableAreaSqm || 0),
    pricingMode: snapshot.pricingMode || quote.pricingMode || "",
    listPrice: roundMoney(snapshot.listPrice ?? quote.listPrice),
    launchPrice: roundMoney(snapshot.launchPrice ?? quote.launchPrice),
    customerPayAmount: roundMoney(snapshot.customerPayAmount ?? quote.customerPayAmount),
    couponCode: snapshot.couponCode || quote.couponCode || "",
    couponDiscount: roundMoney(snapshot.couponDiscount ?? quote.couponDiscount),
    platformFundedDiscount: roundMoney(snapshot.platformFundedDiscount ?? quote.platformFundedDiscount),
    requiresSubsidy: Boolean(snapshot.requiresSubsidy ?? quote.requiresSubsidy),
    subsidyReason: snapshot.requiresSubsidy || quote.requiresSubsidy ? "\u5e73\u53f0\u8865\u8d34\u5df2\u8ba1\u5165\u8bd5\u8fd0\u8425\u6d3b\u52a8\u4ef7" : "",
    pricingText: snapshot.pricingText || quote.pricingText || "\u62a5\u4ef7\u7531\u5e73\u53f0\u670d\u52a1\u7aef\u751f\u6210\uff0c\u91d1\u989d\u5355\u4f4d\u4e3a\u4eba\u6c11\u5e01\u5143\u3002",
    expiresAt: quote.expiresAt || snapshot.expiresAt || "",
    status: quote.status || "active",
  };
}

function calculateOrderPrice(input = {}) {
  const serviceType = normalizeServiceTypeKey(input.serviceType);
  const quoteInput = {
    ...input,
    city: input.city || DEFAULT_CITY,
    durationHours: serviceType === "moveIn" ? input.durationHours : Number(input.durationHours || 3),
  };
  const quote = calculateQuote(quoteInput);
  return {
    city: quote.city,
    cityGroup: quote.cityGroup,
    serviceType: quote.serviceType,
    serviceTypeText: quote.serviceTypeText,
    pricingMode: quote.pricingMode,
    durationHours: quote.durationHours,
    areaSqm: quote.areaSqm,
    billableAreaSqm: quote.billableAreaSqm,
    listPrice: quote.listPrice,
    launchPrice: quote.launchPrice,
    orderAmount: quote.customerPayAmount,
    customerPayAmount: quote.customerPayAmount,
    platformFee: quote.platformFee,
    cleanerIncome: quote.cleanerIncome,
    cleanerHourlyIncome: quote.durationHours ? roundMoney(quote.cleanerIncome / quote.durationHours) : 0,
    minCleanerHourlyIncome: CLEANER_HOURLY_FLOORS[quote.cityGroup] || 40,
    platformFeeRate: quote.platformFeeRate,
    isMinIncomeProtected: quote.cleanerIncome >= quote.cleanerBaseIncome,
    pricingText: "\u62a5\u4ef7\u7531\u5e73\u53f0\u670d\u52a1\u7aef\u89c4\u5219\u751f\u6210\uff0c\u91d1\u989d\u5355\u4f4d\u4e3a\u4eba\u6c11\u5e01\u5143\u3002",
  };
}

module.exports = {
  BASE_PRICING,
  CITY_GROUPS,
  CITY_PRICING,
  CLEANER_HOURLY_FLOORS,
  DEFAULT_CITY_PRICING: { city: DEFAULT_CITY, avgMonthlySalary: 10000, minCleanerHourlyIncome: CLEANER_HOURLY_FLOORS.B },
  HOURLY_PRICE_TABLE,
  MOVE_IN_CITY_PRICES,
  PAYMENT_FEE_RATE_ESTIMATE,
  PRICING_VERSION,
  QUOTE_TTL_MINUTES,
  SERVICE_TYPE_KEY_MAP,
  SERVICE_TYPE_LABELS,
  calculateOrderPrice,
  calculateQuote,
  fullPricingRule,
  getCityGroup,
  getDefaultPricingRules,
  getMoveInAreaUnitPrice,
  matchPricingRule,
  normalizeServiceTypeKey,
  publicPricingQuote,
  publicPricingRule,
  roundMoney,
  serviceTypeLabel,
};
