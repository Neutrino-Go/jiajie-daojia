const { callCloud, showError } = require("../../utils/cloud");
const { decorateCleaner } = require("../../utils/format");
const { requireRole, getCurrentLocation } = require("../../utils/session");

Page({
  data: {
    cleaners: [],
    cleaner: null,
    isCleaner: false,
    loading: false,
  },

  onShow() {
    if (!requireRole("customer")) return;
    this.setData({ isCleaner: false });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const currentLocation = getCurrentLocation();
      const cleaners = await callCloud("listCleaners", {});
      this.setData({ cleaners: cleaners.map((cleaner) => decorateCleaner(cleaner, currentLocation)) });
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadCleanerProfile() {
    this.setData({ loading: true });
    try {
      const login = await callCloud("login");
      this.setData({ cleaner: login.cleaner ? decorateCleaner(login.cleaner) : null });
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  openCleaner(event) {
    wx.navigateTo({ url: `/pages/cleaner-detail/index?openid=${event.detail.openid}&mode=view` });
  },

  openMyCleanerProfile() {
    if (!this.data.cleaner || !this.data.cleaner._openid) {
      wx.showToast({ title: "请先选择家洁师身份", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/cleaner-detail/index?openid=${this.data.cleaner._openid}&mode=view` });
  },

  goCleanerOrders() {
    wx.setStorageSync("preferredOrderTab", "open");
    wx.switchTab({ url: "/pages/order-list/index" });
  },
});
