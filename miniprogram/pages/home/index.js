const { callCloud, showError } = require("../../utils/cloud");
const {
  getUserRole,
  setUserRole,
  roleName,
  requireRole,
  getRoleLocation,
  setCurrentLocation,
  locationLabel,
  shortRoleLocationLabel,
  formatRegionText,
  configureTabBar,
  syncIdentityFromLogin,
} = require("../../utils/session");
const { getCurrentLocationForDistance, getRuntimeLocation } = require("../../utils/location");
const { decorateCleaner, decorateOrder, sortRecommendedCleaners } = require("../../utils/format");

function withOpenAction(order, canRespond = true) {
  return {
    ...order,
    actions: [{ key: "accept", text: "响应订单", variant: canRespond ? "primary" : "secondary", disabled: !canRespond }],
  };
}

function withAssignedActions(order, canRespond = true) {
  return {
    ...order,
    actions: [
      { key: "accept", text: "接受订单", variant: canRespond ? "primary" : "secondary", disabled: !canRespond },
      { key: "decline", text: "拒绝", variant: "secondary" },
    ],
  };
}

function findOrderById(groups, orderId) {
  for (let i = 0; i < groups.length; i += 1) {
    const list = groups[i] || [];
    for (let j = 0; j < list.length; j += 1) {
      if (list[j] && list[j]._id === orderId) return list[j];
    }
  }
  return null;
}

Page({
  data: {
    loading: true,
    activeRole: "",
    activeRoleName: "",
    isCustomer: true,
    locationLabel: "请选择地址",
    recommendationEmptyTitle: "当前城市暂无可约家洁师",
    cleaners: [],
    cleaner: null,
    cleanerAvailable: false,
    grabTab: "open",
    openOrders: [],
    allOpenOrders: [],
    assignedOrders: [],
  },

  onShow() {
    if (!requireRole(["customer", "cleaner"])) return;
    const role = getUserRole();
    const app = getApp();
    const profile = app.globalData.currentProfile || {};
    console.log("[identity]", {
      openid: app.globalData.openid,
      role,
      profileType: role === "cleaner" ? "cleanerProfile" : "customerProfile",
      nickname: profile.nickname || profile.displayName || "",
      avatarUrl: profile.avatarUrl || "",
    });
    this.resetPageData(role);
    this.load();
  },

  resetPageData(role) {
    this.setData({
      loading: true,
      activeRole: role,
      activeRoleName: roleName(role),
      isCustomer: role === "customer",
      cleaners: [],
      cleaner: null,
      cleanerAvailable: false,
      openOrders: [],
      allOpenOrders: [],
      assignedOrders: [],
    });
  },

  syncRole() {
    const activeRole = getUserRole();
    const location = getRoleLocation(activeRole);
    this.setData({
      activeRole,
      activeRoleName: roleName(activeRole),
      isCustomer: activeRole === "customer",
      locationLabel: activeRole === "cleaner" ? shortRoleLocationLabel(location) : formatRegionText(location),
    });
  },

  async load() {
    this.setData({ loading: true });
    try {
      const login = await callCloud("login");
      const role = login.user && ["customer", "cleaner"].includes(login.user.role) ? login.user.role : "";
      if (!role) {
        wx.reLaunch({ url: "/pages/role-select/index" });
        return;
      }
      const identity = syncIdentityFromLogin(login);
      setUserRole(role);
      configureTabBar(role);
      const profileLocation = identity?.customerProfile?.address || login.customerProfile?.address || login.user?.defaultLocation || null;
      if (role === "customer") {
        const cachedLocation = wx.getStorageSync("currentLocation");
        if (!cachedLocation && profileLocation) {
          setCurrentLocation(profileLocation);
        }
      }
      this.syncRole();

      if (role === "customer") {
        const currentLocation = getRoleLocation("customer");
        const userLocation = await getCurrentLocationForDistance(profileLocation);
        const city = (userLocation && userLocation.city) || currentLocation.city || "";
        const cleaners = await callCloud("listCleaners", city ? { city } : {}).catch(() => []);
        const decoratedCleaners = cleaners.map((cleaner) => decorateCleaner(cleaner, userLocation));
        console.log(
          "[distance check]",
          decoratedCleaners.map((cleaner) => ({
            cleanerName: cleaner.displayName,
            userLocation: cleaner.distanceSource?.userLocation,
            cleanerLocation: cleaner.distanceSource?.cleanerLocation,
            distanceKm: cleaner.distanceKm,
            distanceText: cleaner.distanceText,
          }))
        );
        const recommendedCleaners = sortRecommendedCleaners(decoratedCleaners).slice(0, 3);
        this.setData({ cleaners: recommendedCleaners });
      } else {
        const cleanerLocation = getRoleLocation("cleaner");
        const openOrders = await callCloud("listOpenOrders", { scope: "nearby", cleanerLocation }).catch(() => []);
        const allOpenOrders = await callCloud("listOpenOrders", { scope: "all", cleanerLocation }).catch(() => []);
        const assignedOrders = await callCloud("listAssignedOrders").catch(() => []);
        const cleanerAvailable = Boolean(login.cleaner && login.cleaner.available);
        this.setData({
          cleaner: login.cleaner ? decorateCleaner(login.cleaner) : null,
          cleanerAvailable,
          openOrders: openOrders.map((order) => withOpenAction(decorateOrder(order, login.openid, "cleaner", cleanerLocation), cleanerAvailable)),
          allOpenOrders: allOpenOrders.map((order) => withOpenAction(decorateOrder(order, login.openid, "cleaner", cleanerLocation), cleanerAvailable)),
          assignedOrders: assignedOrders.map((order) => withAssignedActions(decorateOrder(order, login.openid, "cleaner", cleanerLocation), cleanerAvailable)),
        });
        if (login.cleaner) {
          await this.refreshCleanerLocation();
        }
      }
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  goLocation() {
    wx.navigateTo({ url: this.data.isCustomer ? "/pages/location-select/index" : "/pages/location-select/index?mode=cleaner" });
  },

  goCreate() {
    wx.navigateTo({ url: "/pages/order-create/index" });
  },

  goOrders(event) {
    const status = event && event.currentTarget.dataset.status;
    if (status) wx.setStorageSync("preferredOrderStatus", status);
    wx.switchTab({ url: "/pages/order-list/index" });
  },

  goCompletedOrders() {
    wx.setStorageSync("preferredOrderStatus", "completed");
    wx.switchTab({ url: "/pages/order-list/index" });
  },

  goCleaners() {
    if (!this.data.isCustomer) {
      wx.showToast({ title: "家洁师端不展示附近家洁师", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/cleaner-list/index" });
  },

  goSaved() {
    wx.navigateTo({ url: "/pages/saved-cleaners/index" });
  },

  goReviews() {
    wx.navigateTo({ url: "/pages/reviews/index" });
  },

  openCleaner(event) {
    const openid = event.detail?.openid || event.currentTarget.dataset.openid;
    if (!openid) return;
    wx.navigateTo({ url: `/pages/cleaner-detail/index?openid=${openid}&mode=view` });
  },

  switchGrabTab(event) {
    this.setData({ grabTab: event.currentTarget.dataset.tab });
  },

  openOrder(event) {
    const id = event.detail?.id || event.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/order-detail/index?id=${id}` });
  },

  async handleOrderAction(event) {
    const { action, id } = event.detail;
    if (action === "accept") {
      await this.acceptOrder(id);
      return;
    }
    if (action === "decline") {
      await this.declineOrder(id);
    }
  },

  async acceptOrder(orderId) {
    if (!this.data.cleanerAvailable) {
      wx.showToast({ title: "请先切换为接单中", icon: "none" });
      return;
    }
    const order = findOrderById([this.data.openOrders, this.data.allOpenOrders, this.data.assignedOrders], orderId);
    if (order && order.publishMode === "public" && order.nonLocal) {
      const orderLocation = order.locationText || "该城市";
      const cleanerLocation = shortRoleLocationLabel(getRoleLocation("cleaner"));
      wx.showModal({
        title: "此单非同城，是否接单？",
        content: `该订单位于「${orderLocation}」，你当前接单城市为「${cleanerLocation}」。跨城服务可能产生额外交通成本，请确认是否继续响应。`,
        confirmText: "继续接单",
        cancelText: "取消",
        success: async (result) => {
          if (!result.confirm) return;
          await this.doAcceptOrder(orderId);
        },
      });
      return;
    }
    await this.doAcceptOrder(orderId);
  },

  async doAcceptOrder(orderId) {
    wx.showLoading({ title: "处理中" });
    try {
      await callCloud("acceptOrder", { orderId });
      wx.showToast({ title: "已响应" });
      wx.navigateTo({ url: `/pages/order-detail/index?id=${orderId}` });
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },

  async declineOrder(orderId) {
    wx.showLoading({ title: "处理中" });
    try {
      await callCloud("declineAssignedOrder", { orderId });
      wx.showToast({ title: "已拒绝" });
      this.load();
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },

  async onAvailabilityChange(event) {
    const available = event.detail.checked;
    wx.showLoading({ title: "更新中" });
    try {
      const payload = { available };
      if (available) {
        payload.lastLocation = await getRuntimeLocation();
      }
      const result = await callCloud("updateCleanerAvailability", payload);
      this.setData({
        cleaner: result.cleaner ? decorateCleaner(result.cleaner) : this.data.cleaner,
        cleanerAvailable: available,
      });
      wx.showToast({ title: available ? "接单中" : "休息中" });
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },

  async toggleAvailability() {
    await this.onAvailabilityChange({ detail: { checked: !this.data.cleanerAvailable } });
  },

  async refreshCleanerLocation() {
    try {
      const lastLocation = await getRuntimeLocation();
      const result = await callCloud("updateCleanerLocation", { lastLocation });
      this.setData({
        cleaner: result.cleaner ? decorateCleaner(result.cleaner) : this.data.cleaner,
        cleanerAvailable: Boolean(result.cleaner && result.cleaner.available),
      });
    } catch (error) {
      console.warn("refresh cleaner location failed", error);
    }
  },
});
