const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { calculateSystemMetrics } = require("../lib/ops-intelligence/metricsEngine");
const { detectAnomalies } = require("../lib/ops-intelligence/anomalyDetector");
const { generateInsights } = require("../lib/ops-intelligence/systemInsights");
const { generateRecommendations } = require("../lib/ops-intelligence/autoRecommendationEngine");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const now = "2026-06-14T12:00:00.000Z";
const orders = [
  {
    _id: "order-completed",
    customerOpenid: "user-a",
    acceptedCleanerOpenid: "cleaner-a",
    status: "completed",
    customerPayAmount: 100,
    createdAt: "2026-06-14T08:00:00.000Z",
    acceptedAt: "2026-06-14T08:10:00.000Z",
  },
  {
    _id: "order-cancelled",
    customerOpenid: "user-b",
    acceptedCleanerOpenid: "cleaner-b",
    status: "cancelled",
    customerPayAmount: 80,
    createdAt: "2026-06-14T09:00:00.000Z",
    acceptedAt: "2026-06-14T09:20:00.000Z",
  },
  {
    _id: "order-old",
    customerOpenid: "user-c",
    acceptedCleanerOpenid: "cleaner-a",
    status: "completed",
    customerPayAmount: 70,
    createdAt: "2026-06-10T09:00:00.000Z",
    acceptedAt: "2026-06-10T09:30:00.000Z",
  },
  {
    _id: "order-week-cancelled",
    customerOpenid: "user-a",
    acceptedCleanerOpenid: "cleaner-c",
    status: "cancelled",
    customerPayAmount: 60,
    createdAt: "2026-06-11T09:00:00.000Z",
  },
];
const users = [
  { openid: "user-a", lastActiveAt: "2026-06-14T06:00:00.000Z" },
  { openid: "user-b", lastActiveAt: "2026-06-13T06:00:00.000Z" },
  { openid: "user-stale", lastActiveAt: "2026-05-01T06:00:00.000Z" },
];
const cleaners = [
  { cleanerId: "cleaner-a", lastActiveAt: "2026-06-14T07:00:00.000Z" },
  { cleanerId: "cleaner-b", lastActiveAt: "2026-06-13T07:00:00.000Z" },
  { cleanerId: "cleaner-stale", lastActiveAt: "2026-05-01T07:00:00.000Z" },
];
const cleanerTrustProfiles = [
  { cleanerId: "cleaner-a", trustScore: 80 },
  { cleanerId: "cleaner-b", trustScore: 60 },
];
const orderRiskProfiles = [
  { orderId: "order-completed", riskScore: 20 },
  { orderId: "order-cancelled", riskScore: 60 },
];

const input = { orders, users, cleaners, cleanerTrustProfiles, orderRiskProfiles };
const before = clone(input);
const metrics = calculateSystemMetrics({ ...input, now });

assert.strictEqual(metrics.dailyMetrics.GMV, 100);
assert.strictEqual(metrics.weeklyMetrics.GMV, 170);
assert.strictEqual(metrics.dailyMetrics.activeUsers, 2);
assert.strictEqual(metrics.dailyMetrics.activeCleaners, 2);
assert.strictEqual(metrics.dailyMetrics.avgResponseTime, 15);
assert.strictEqual(metrics.dailyMetrics.trustScoreAvg, 70);
assert.strictEqual(metrics.dailyMetrics.riskScoreAvg, 40);
assert.strictEqual(metrics.dailyMetrics.completionRate, 0.5);
assert.strictEqual(metrics.dailyMetrics.cancellationRate, 0.5);
assert.deepStrictEqual(input, before, "metrics must not mutate source business data");

const anomalies = detectAnomalies({
  current: {
    GMV: 100,
    cancellationRate: 0.45,
    trustScoreAvg: 65,
    riskScoreAvg: 55,
  },
  previous: {
    GMV: 180,
    cancellationRate: 0.3,
    trustScoreAvg: 82,
    riskScoreAvg: 30,
  },
});
assert.strictEqual(anomalies.severity, "high");
assert(anomalies.anomalyList.some((item) => item.type === "cancellation_rate_spike"));
assert(anomalies.anomalyList.some((item) => item.type === "gmv_drop"));
assert(anomalies.anomalyList.some((item) => item.type === "trust_score_drop"));
assert(anomalies.anomalyList.some((item) => item.type === "risk_score_spike"));

const insights = generateInsights(metrics, anomalies);
assert(insights.operationsSummary.includes("high"));
assert(insights.userBehaviorTrend);
assert(insights.cleanerSupplyTrend);
assert(insights.riskTrend);
assert.deepStrictEqual(input, before, "insights must not mutate source business data");

const recommendations = generateRecommendations(insights);
assert(Array.isArray(recommendations.dispatchWeightSuggestions));
assert(Array.isArray(recommendations.riskAreaSuggestions));
assert(Array.isArray(recommendations.pricingSuggestions));
assert(Array.isArray(recommendations.cleanerManagementSuggestions));
assert(recommendations.pricingSuggestions.every((item) => item.action === "recommend_only"));
assert.deepStrictEqual(input, before, "recommendations must not mutate source business data");

const opsDir = path.resolve(__dirname, "../lib/ops-intelligence");
for (const file of fs.readdirSync(opsDir)) {
  const source = fs.readFileSync(path.join(opsDir, file), "utf8");
  assert(!/db\.collection\s*\(/.test(source), `${file} must not directly mutate or read CloudBase state`);
  assert(!/collection\s*\([^)]*\)\s*\.\s*(add|update|remove|delete)\s*\(/.test(source), `${file} must remain read-only`);
}

console.log("ops intelligence tests passed");
