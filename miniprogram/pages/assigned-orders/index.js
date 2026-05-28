const { callCloud, showError } = require("../../utils/cloud");
const { decorateOrder } = require("../../utils/format");
const { requireRole } = require("../../utils/session");

Page({
  data: {
    orders: [],
    openid: "",
    loading: false,
  },

  onShow() {
    if (!requireRole("cleaner")) return;
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const login = await callCloud("login");
      const orders = await callCloud("listAssignedOrders");
      this.setData({
        openid: login.openid,
        orders: orders.map((order) => ({
        ...decorateOrder(order, login.openid, "cleaner"),
          actions: [{ key: "accept", text: "接受订单", variant: "primary" }],
        })),
      });
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  openOrder(event) {
    wx.navigateTo({ url: `/pages/order-detail/index?id=${event.detail.id}` });
  },

  async handleAction(event) {
    if (event.detail.action !== "accept") return;
    wx.showLoading({ title: "处理中" });
    try {
      await callCloud("acceptOrder", { orderId: event.detail.id });
      wx.showToast({ title: "订单已确认" });
      this.load();
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },
});
