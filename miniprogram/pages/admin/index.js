const { callCloud } = require("../../utils/cloud");

Page({
  data: {
    loading: false,
    summary: null,
    error: "",
  },

  onLoad() {
    this.loadSummary();
  },

  async loadSummary() {
    this.setData({ loading: true, error: "" });
    try {
      const result = await callCloud("adminListDashboardSummary", {});
      this.setData({ summary: result.summary || null });
    } catch (error) {
      this.setData({ error: error.message || "无管理员权限或加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  openOrders() {
    wx.navigateTo({ url: "/pages/admin/orders/index" });
  },

  openRefunds() {
    wx.navigateTo({ url: "/pages/admin/refunds/index" });
  },

  openCleaners() {
    wx.navigateTo({ url: "/pages/admin/cleaners/index" });
  },

  openSettlements() {
    wx.navigateTo({ url: "/pages/admin/settlements/index" });
  },
});
