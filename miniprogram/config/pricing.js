const BASE_PRICING = {
  baseMonthlySalary: 8000,
  baseHourlyPrice: 46,
  compressionFactor: 0.4,
  minCityFactor: 0.88,
  maxCityFactor: 1.25,
  platformFeeRate: 0.05,
};

// TODO: 后续改为从云数据库读取城市定价配置，支持运营后台动态调整。
const CITY_PRICING = {
  上海市: { city: "上海市", avgMonthlySalary: 12000, minCleanerHourlyIncome: 48 },
  北京市: { city: "北京市", avgMonthlySalary: 12000, minCleanerHourlyIncome: 48 },
  深圳市: { city: "深圳市", avgMonthlySalary: 11500, minCleanerHourlyIncome: 48 },
  广州市: { city: "广州市", avgMonthlySalary: 10500, minCleanerHourlyIncome: 45 },
  杭州市: { city: "杭州市", avgMonthlySalary: 10000, minCleanerHourlyIncome: 43 },
  苏州市: { city: "苏州市", avgMonthlySalary: 9500, minCleanerHourlyIncome: 43 },
  南京市: { city: "南京市", avgMonthlySalary: 9000, minCleanerHourlyIncome: 43 },
  无锡市: { city: "无锡市", avgMonthlySalary: 8500, minCleanerHourlyIncome: 40 },
  哈尔滨市: { city: "哈尔滨市", avgMonthlySalary: 7000, minCleanerHourlyIncome: 40 },
};

const DEFAULT_CITY_PRICING = {
  city: "默认城市",
  avgMonthlySalary: 8000,
  minCleanerHourlyIncome: 40,
};

const SERVICE_TYPE_FACTOR = {
  daily: 1,
  deep: 1.3,
  moveIn: 1.5,
  organize: 1.2,
};

const SERVICE_TYPE_KEY_MAP = {
  日常保洁: "daily",
  深度保洁: "deep",
  开荒保洁: "moveIn",
  家务整理: "organize",
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getServiceTypeKey(serviceType) {
  return SERVICE_TYPE_KEY_MAP[serviceType] || serviceType || "daily";
}

function getCityPricing(city) {
  return CITY_PRICING[city] || { ...DEFAULT_CITY_PRICING, city: city || DEFAULT_CITY_PRICING.city };
}

function calculateCityFactor(cityPricing) {
  const salaryRatio = Number(cityPricing.avgMonthlySalary || BASE_PRICING.baseMonthlySalary) / BASE_PRICING.baseMonthlySalary;
  return clamp(
    1 + (salaryRatio - 1) * BASE_PRICING.compressionFactor,
    BASE_PRICING.minCityFactor,
    BASE_PRICING.maxCityFactor
  );
}

function calculateOrderPrice(input = {}) {
  const durationHours = Math.max(1, Number(input.durationHours || 3));
  const cityPricing = getCityPricing(input.city);
  const cityFactor = calculateCityFactor(cityPricing);
  const serviceTypeKey = getServiceTypeKey(input.serviceType);
  const serviceTypeFactor = SERVICE_TYPE_FACTOR[serviceTypeKey] || 1;
  let orderAmount = BASE_PRICING.baseHourlyPrice * cityFactor * serviceTypeFactor * durationHours;
  let platformFee = orderAmount * BASE_PRICING.platformFeeRate;
  let cleanerIncome = orderAmount - platformFee;
  let cleanerHourlyIncome = cleanerIncome / durationHours;
  let isMinIncomeProtected = false;

  if (cleanerHourlyIncome < cityPricing.minCleanerHourlyIncome) {
    orderAmount = (cityPricing.minCleanerHourlyIncome * durationHours) / (1 - BASE_PRICING.platformFeeRate);
    platformFee = orderAmount * BASE_PRICING.platformFeeRate;
    cleanerIncome = orderAmount - platformFee;
    cleanerHourlyIncome = cleanerIncome / durationHours;
    isMinIncomeProtected = true;
  }

  orderAmount = isMinIncomeProtected ? Math.ceil(orderAmount) : Math.round(orderAmount);
  platformFee = roundMoney(orderAmount * BASE_PRICING.platformFeeRate);
  cleanerIncome = roundMoney(orderAmount - platformFee);
  cleanerHourlyIncome = roundMoney(cleanerIncome / durationHours);

  return {
    city: cityPricing.city,
    cityFactor: Number(cityFactor.toFixed(3)),
    serviceTypeFactor,
    baseHourlyPrice: BASE_PRICING.baseHourlyPrice,
    durationHours,
    orderAmount,
    platformFee,
    cleanerIncome,
    cleanerHourlyIncome,
    minCleanerHourlyIncome: cityPricing.minCleanerHourlyIncome,
    isMinIncomeProtected,
    pricingText: `已根据${input.city || "当前城市"}、服务类型和服务时长自动估算`,
  };
}

module.exports = {
  BASE_PRICING,
  CITY_PRICING,
  DEFAULT_CITY_PRICING,
  SERVICE_TYPE_FACTOR,
  SERVICE_TYPE_KEY_MAP,
  calculateCityFactor,
  calculateOrderPrice,
  getCityPricing,
  getServiceTypeKey,
};
