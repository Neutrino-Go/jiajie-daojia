const { callCloud, showError } = require("../../utils/cloud");
const { decorateOrder } = require("../../utils/format");
const { requireRole } = require("../../utils/session");

Page({
  data: {
    orders: [],
    loading: false,
    openid: "",
  },

  onShow() {
    if (!requireRole("cleaner")) return;
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const login = await callCloud("login");
      const orders = await callCloud("listMyOrders");
      const mine = orders.filter((order) => order.acceptedCleanerOpenid === login.openid);
      this.setData({ openid: login.openid, orders: mine.map((order) => decorateOrder(order, login.openid, "cleaner")) });
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  openOrder(event) {
    wx.navigateTo({ url: `/pages/order-detail/index?id=${event.detail.id}` });
  },
});
