const { callCloud } = require("../../../utils/cloud");

Page({
  data: { loading: false, orders: [], error: "" },
  onLoad() {
    this.loadOrders();
  },
  async loadOrders() {
    this.setData({ loading: true, error: "" });
    try {
      const result = await callCloud("adminListOrders", { limit: 50 });
      this.setData({ orders: result.orders || [] });
    } catch (error) {
      this.setData({ error: error.message || "订单加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
