const { callCloud, showError } = require("../../utils/cloud");
const { decorateOrder, decorateOrderDistance, withOrderTabCounts } = require("../../utils/format");
const { normalizeLocation } = require("../../utils/location");
const { getUserRole, roleName, requireRole, setUserRole, configureTabBar, syncIdentityFromLogin, getRoleLocation } = require("../../utils/session");

const CUSTOMER_TABS = [
  { key: "all", name: "全部" },
  { key: "pending", name: "待处理" },
  { key: "ongoing", name: "进行中" },
  { key: "completed", name: "已完成" },
  { key: "cancelled", name: "已取消" },
];

const CLEANER_TABS = [
  { key: "all", name: "全部" },
  { key: "pending", name: "待处理" },
  { key: "ongoing", name: "进行中" },
  { key: "completed", name: "已完成" },
  { key: "cancelled", name: "已取消" },
];

function customerActions(order) {
  if (["pending", "waiting_response", "waiting_confirm", "assigned_waiting_accept", "assigned_declined"].includes(order.status)) {
    return [
      { key: "detail", text: "查看详情", variant: "secondary" },
      { key: "cancel", text: "取消订单", variant: "danger" },
    ];
  }
  if (order.status === "waiting_payment") {
    return [{ key: "detail", text: "查看详情", variant: "secondary" }];
  }
  if (order.status === "confirmed" || order.status === "accepted" || order.status === "in_service") {
    return [
      { key: "contact", text: "联系家洁师", variant: "primary" },
      { key: "detail", text: "查看详情", variant: "secondary" },
    ];
  }
  if (["waiting_complete", "waiting_acceptance"].includes(order.status)) {
    return [
      { key: "confirmComplete", text: "验收评价", variant: "primary" },
      { key: "contact", text: "联系家洁师", variant: "secondary" },
    ];
  }
  if (order.status === "completed") {
    if (order.hasReview || order.reviewId) {
      return order.canEditReview
        ? [
            { key: "review", text: "修改评价", variant: "outline-orange" },
            { key: "detail", text: "查看详情", variant: "secondary" },
          ]
        : [{ key: "detail", text: "查看详情", variant: "secondary" }];
    }
    return [
      { key: "review", text: "评价家洁师", variant: "orange" },
      { key: "detail", text: "查看详情", variant: "secondary" },
    ];
  }
  if (order.status === "auto_completed") {
    return [{ key: "detail", text: "查看详情", variant: "secondary" }];
  }
  return [{ key: "detail", text: "查看详情", variant: "secondary" }];
}

function cleanerActions(order) {
  if (order.status === "waiting_confirm") {
    return [{ key: "detail", text: "查看详情", variant: "secondary" }];
  }
  if (order.status === "confirmed" || order.status === "accepted") {
    return [
      { key: "start", text: "开始服务", variant: "primary" },
      { key: "contact", text: "联系客户", variant: "secondary" },
    ];
  }
  if (order.status === "in_service") return [{ key: "complete", text: "提交完成", variant: "primary" }];
  if (order.status === "waiting_payment") return [{ key: "detail", text: "查看详情", variant: "secondary" }];
  return [{ key: "detail", text: "查看详情", variant: "secondary" }];
}

function preferredStatusGroup(preferred) {
  if (["pending", "ongoing", "completed", "cancelled", "all"].includes(preferred)) return preferred;
  if (["waiting_response", "waiting_confirm", "assigned_waiting_accept", "assigned_declined", "pending"].includes(preferred)) {
    return "pending";
  }
  if (["waiting_payment", "confirmed", "accepted", "in_service", "waiting_complete", "waiting_acceptance"].includes(preferred)) return "ongoing";
  return preferred;
}

function baseTabsForRole(role) {
  return role === "cleaner" ? CLEANER_TABS : CUSTOMER_TABS;
}

function cleanerOrderLocationFromLogin(login) {
  const stored = getRoleLocation("cleaner");
  const cleaner = login.cleaner || login.cleanerProfile || {};
  const candidates = [
    stored,
    cleaner.workLocation,
    cleaner.lastLocation,
    cleaner.currentLocation,
    cleaner.location,
    login.cleanerProfile && login.cleanerProfile.workLocation,
    login.cleanerProfile && login.cleanerProfile.lastLocation,
    cleaner,
  ];
  return candidates.find((location) => normalizeLocation(location)) || stored;
}

Page({
  data: {
    active: "all",
    activeRole: "customer",
    activeRoleName: "住户端",
    isCustomer: true,
    tabs: CUSTOMER_TABS,
    allOrders: [],
    orders: [],
    loading: false,
    openid: "",
    cleanerLocation: null,
  },

  onShow() {
    if (!requireRole(["customer", "cleaner"])) return;
    this.syncRole();
    this.bootstrap();
  },

  syncRole() {
    const activeRole = getUserRole();
    const preferred = preferredStatusGroup(wx.getStorageSync("preferredOrderStatus"));
    wx.removeStorageSync("preferredOrderStatus");
    const tabs = withOrderTabCounts(baseTabsForRole(activeRole), this.data.allOrders, activeRole);
    const hasPreferred = tabs.some((tab) => tab.key === preferred);
    this.setData({
      activeRole,
      activeRoleName: roleName(activeRole),
      isCustomer: activeRole === "customer",
      tabs,
      active: hasPreferred ? preferred : "all",
    });
  },

  refreshTabsWithCounts(allOrders) {
    const tabs = withOrderTabCounts(baseTabsForRole(this.data.activeRole), allOrders, this.data.activeRole);
    this.setData({ tabs });
  },

  async bootstrap() {
    try {
      const login = await callCloud("login");
      const role = login.user && ["customer", "cleaner"].includes(login.user.role) ? login.user.role : "";
      if (!role) {
        wx.reLaunch({ url: "/pages/role-select/index" });
        return;
      }
      this.setData({ allOrders: [], orders: [] });
      syncIdentityFromLogin(login);
      setUserRole(role);
      configureTabBar(role);
      const app = getApp();
      app.globalData.openid = login.openid;
      app.globalData.user = login.user;
      app.globalData.cleaner = login.cleaner;
      this.setData({
        openid: login.openid,
        activeRole: role,
        activeRoleName: roleName(role),
        isCustomer: role === "customer",
        cleanerLocation: role === "cleaner" ? cleanerOrderLocationFromLogin(login) : null,
      });
      await this.load();
    } catch (error) {
      showError(error);
    }
  },

  async load() {
    this.setData({ loading: true });
    try {
      const orders = await callCloud("listMyOrders");
      const referenceLocation = this.data.activeRole === "cleaner" ? this.data.cleanerLocation || getRoleLocation("cleaner") : null;
      const decorated = orders.map((order) => {
        const orderWithDistance = this.data.activeRole === "cleaner" ? decorateOrderDistance(order, referenceLocation) : order;
        const next = decorateOrder(orderWithDistance, this.data.openid, this.data.activeRole);
        next.actions = this.data.isCustomer ? customerActions(next) : cleanerActions(next);
        next.canHideForRole = ["completed", "auto_completed", "cancelled"].includes(next.status);
        next.canManage = next.canHideForRole;
        return next;
      });
      this.setData({ allOrders: decorated });
      this.refreshTabsWithCounts(decorated);
      this.applyFilter();
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  applyFilter() {
    const active = this.data.active;
    const orders = active === "all" ? this.data.allOrders : this.data.allOrders.filter((order) => order.statusGroup === active);
    this.setData({ orders });
  },

  switchTab(event) {
    this.setData({ active: event.currentTarget.dataset.key });
    this.applyFilter();
  },

  openOrder(event) {
    wx.navigateTo({ url: `/pages/order-detail/index?id=${event.detail.id}` });
  },

  async handleAction(event) {
    const { action, id } = event.detail;
    if (action === "detail" || action === "review") {
      wx.navigateTo({ url: `/pages/order-detail/index?id=${id}` });
      return;
    }
    if (action === "contact") {
      await this.openConversation(id);
      return;
    }
    if (action === "pay") {
      await this.payOrder(id);
      return;
    }
    if (action === "cancel") {
      await this.updateStatus(id, "cancelled", "已取消");
      return;
    }
    if (action === "start") {
      await this.updateStatus(id, "in_service", "已开始");
      return;
    }
    if (action === "complete") {
      wx.navigateTo({ url: `/pages/order-detail/index?id=${id}` });
      return;
    }
    if (action === "confirmComplete") {
      wx.navigateTo({ url: `/pages/order-detail/index?id=${id}` });
    }
  },

  handleMore(event) {
    const id = event.detail.id;
    const order = this.data.allOrders.find((item) => item._id === id);
    if (!order) return;
    const hideText = this.data.activeRole === "cleaner" ? "归档订单" : "删除订单";
    wx.showActionSheet({
      itemList: ["查看详情", hideText],
      success: async (result) => {
        if (result.tapIndex === 0) {
          wx.navigateTo({ url: `/pages/order-detail/index?id=${id}` });
          return;
        }
        await this.hideOrder(order);
      },
    });
  },

  async hideOrder(order) {
    const isCleaner = this.data.activeRole === "cleaner";
    wx.showModal({
      title: isCleaner ? "归档订单？" : "删除订单？",
      content: isCleaner
        ? "归档后该订单将不再显示在你的订单列表中，但不会影响收入统计和服务记录。"
        : "删除后该订单将不再显示在你的订单列表中，但不会影响服务记录和评价。",
      confirmText: isCleaner ? "归档" : "删除",
      confirmColor: isCleaner ? "#16a05d" : "#d9573d",
      success: async (result) => {
        if (!result.confirm) return;
        wx.showLoading({ title: "处理中" });
        try {
          await callCloud("hideOrderForRole", { orderId: order._id, role: this.data.activeRole });
          wx.showToast({ title: isCleaner ? "已归档" : "已删除" });
          await this.load();
        } catch (error) {
          showError(error);
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  async payOrder(orderId) {
    wx.showToast({ title: "支付能力待接入", icon: "none" });
  },

  async updateStatus(orderId, status, toastTitle) {
    wx.showLoading({ title: "处理中" });
    try {
      await callCloud("updateOrderStatus", { orderId, status });
      wx.showToast({ title: toastTitle });
      await this.load();
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },

  async openConversation(orderId) {
    wx.showLoading({ title: "打开会话" });
    try {
      const result = await callCloud("getConversationByOrder", { orderId });
      wx.navigateTo({ url: `/pages/chat/index?id=${result.conversation._id}` });
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },

  handleEmptyAction() {
    if (this.data.isCustomer) {
      wx.navigateTo({ url: "/pages/order-create/index" });
      return;
    }
    wx.switchTab({ url: "/pages/home/index" });
  },
});
