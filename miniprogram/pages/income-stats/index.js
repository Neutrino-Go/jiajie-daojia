const { callCloud, showError } = require("../../utils/cloud");
const { requireRole } = require("../../utils/session");
const { decorateOrder } = require("../../utils/format");

function getDisplayIncome(order) {
  const candidates = [
    order.incomeAmount,
    order.finalPrice,
    order.actualPrice,
    order.estimatedPrice,
    order.price,
    order.amount,
  ];

  for (const value of candidates) {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }

  return 0;
}

Page({
  data: {
    loading: true,
    stats: {
      monthIncome: 0,
      completedCount: 0,
      orderIncome: 0,
      platformReward: 0,
      recentDays: [],
      orders: [],
    },
    bars: [],
    orders: [],
  },

  onShow() {
    if (!requireRole("cleaner")) return;
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const stats = await callCloud("getIncomeStats");
      const max = Math.max(...(stats.recentDays || []).map((item) => item.amount), 1);
      this.setData({
        stats,
        bars: (stats.recentDays || []).map((item) => ({
          ...item,
          height: item.amount > 0 ? Math.max(16, Math.round((item.amount / max) * 150)) : 0,
        })),
        orders: (stats.orders || []).map((order) => {
          const decorated = decorateOrder(order);
          const incomeAmount = getDisplayIncome(order);
          return {
            ...decorated,
            incomeAmount,
            priceText: `¥${incomeAmount}`,
          };
        }),
      });
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },
});
