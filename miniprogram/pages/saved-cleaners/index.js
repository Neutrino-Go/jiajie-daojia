const { callCloud, showError } = require("../../utils/cloud");
const { decorateCleaner } = require("../../utils/format");
const { requireRole } = require("../../utils/session");
const { getCurrentLocationForDistance } = require("../../utils/location");

Page({
  data: {
    cleaners: [],
    loading: false,
  },

  onShow() {
    if (!requireRole("customer")) return;
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const login = await callCloud("login");
      const userLocation = await getCurrentLocationForDistance(login.customerProfile?.address || login.user?.defaultLocation);
      const cleaners = await callCloud("listSavedCleaners");
      const decoratedCleaners = cleaners.map((cleaner) => {
        const next = decorateCleaner(cleaner, userLocation);
        console.log("[saved cleaners distance]", {
          userLocation,
          cleanerName: next.nickname || next.displayName,
          cleanerLocation: cleaner.lastLocation || cleaner.location,
          distanceText: next.distanceText,
        });
        return next;
      });
      this.setData({ cleaners: decoratedCleaners });
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  openCleaner(event) {
    wx.navigateTo({ url: `/pages/cleaner-detail/index?openid=${event.detail.openid}&mode=view` });
  },

  bookAgain(event) {
    const cleaner = event.detail.cleaner;
    const lastOrder = cleaner.lastOrder || {};
    const prefill = encodeURIComponent(
      JSON.stringify({
        serviceType: lastOrder.serviceType || "",
        addressText: lastOrder.addressText || "",
        community: lastOrder.community || "",
        areaSize: lastOrder.areaSize || "",
        durationHours: lastOrder.durationHours || "",
      })
    );
    wx.navigateTo({
      url: `/pages/order-create/index?cleanerOpenid=${cleaner._openid}&prefill=${prefill}`,
    });
  },

  goCleaners() {
    wx.navigateTo({ url: "/pages/cleaner-list/index" });
  },
});
