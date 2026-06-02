const { callCloud, showError } = require("../../utils/cloud");
const { ROLE_LABELS } = require("../../utils/constants");
const { decorateCleaner, maskPhone, avatarUrlOf, avatarInitial } = require("../../utils/format");
const {
  getUserRole,
  roleName,
  requireRole,
  configureTabBar,
  getCurrentLocation,
  locationLabel,
  applyIdentityProfile,
  switchIdentity,
} = require("../../utils/session");
const { getRuntimeLocation } = require("../../utils/location");

function cleanerRatingValue(cleaner) {
  const rating = Number(cleaner?.ratingAvg || cleaner?.rating || 0);
  return rating > 0 ? rating.toFixed(1) : "暂无";
}

function communityCredit(ratingValue) {
  const rating = Number(ratingValue);
  if (!rating) return "暂无";
  if (rating >= 4.8) return "优秀";
  if (rating >= 4.5) return "良好";
  if (rating >= 4.0) return "一般";
  return "待提升";
}

function emptyProfileState(role) {
  const isCustomer = role === "customer";
  return {
    openid: "",
    user: null,
    customerProfile: null,
    cleaner: null,
    activeRole: role,
    activeRoleName: roleName(role),
    isCustomer,
    profileName: isCustomer ? "住户资料加载中" : "家洁师资料加载中",
    profileSub: "资料加载中",
    profileAvatar: isCustomer ? "邻" : "洁",
    profileAvatarUrl: "",
    customerAddress: isCustomer ? locationLabel(getCurrentLocation()) : "",
    cleanerAvailable: false,
    completedOrderCount: 0,
    assetStats: [],
    serviceRecords: [],
    editProfileVisible: false,
    loading: true,
  };
}

Page({
  data: {
    openid: "",
    user: null,
    customerProfile: null,
    cleaner: null,
    activeRole: "customer",
    activeRoleName: "住户端",
    isCustomer: true,
    loading: false,
    profileName: "",
    profileSub: "",
    profileAvatar: "邻",
    profileAvatarUrl: "",
    editProfileVisible: false,
    editProfileForm: {
      nickname: "",
      phone: "",
      avatarUrl: "",
    },
    customerAddress: "请选择地址",
    cleanerAvailable: false,
    completedOrderCount: 0,
    assetStats: [],
    serviceRecords: [],
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
    this.setData(emptyProfileState(role));
    this.loadProfileByRole(role);
  },

  syncRole() {
    const activeRole = getUserRole();
    this.setData({
      activeRole,
      activeRoleName: roleName(activeRole),
      isCustomer: activeRole === "customer",
      customerAddress: locationLabel(getCurrentLocation()),
    });
  },

  async loadProfileByRole(role) {
    try {
      const data = await callCloud("getMyProfile", { role });
      if (!data.user || !["customer", "cleaner"].includes(role)) {
        wx.reLaunch({ url: "/pages/role-select/index" });
        return;
      }
      const identity = applyIdentityProfile(data, role);
      configureTabBar(role);
      const cleanerProfile = data.cleanerProfile || data.cleaner;
      const decoratedCleaner = cleanerProfile ? decorateCleaner(cleanerProfile) : null;
      this.setData({
        openid: identity?.openid || data.openid,
        user: { ...data.user, role, roleText: ROLE_LABELS[role] || roleName(role) },
        customerProfile: role === "customer" ? data.customerProfile || null : null,
        cleaner: role === "cleaner" ? decoratedCleaner : null,
        cleanerAvailable: role === "cleaner" && Boolean(cleanerProfile && cleanerProfile.available),
        completedOrderCount:
          role === "cleaner" ? Number(cleanerProfile?.serviceCount || cleanerProfile?.completedOrderCount || 0) : 0,
        loading: false,
      });
      this.syncRole();
      this.refreshProfileDisplay();
      this.promptProfileSetup({ ...data.user, role }, data.customerProfile, cleanerProfile);
      console.log("[identity]", {
        openid: data.openid,
        role,
        profileType: role === "cleaner" ? "cleanerProfile" : "customerProfile",
        nickname:
          role === "cleaner"
            ? cleanerProfile?.displayName || cleanerProfile?.nickname || ""
            : data.customerProfile?.nickname || "",
        avatarUrl: (role === "cleaner" ? cleanerProfile?.avatarUrl : data.customerProfile?.avatarUrl) || "",
      });
    } catch (error) {
      showError(error);
      this.setData({ loading: false });
    }
  },

  load() {
    return this.loadProfileByRole(getUserRole());
  },

  refreshProfileDisplay() {
    const cleaner = this.data.cleaner;
    if (this.data.isCustomer) {
      const profile = this.data.customerProfile || {};
      const nickname = profile.nickname || "邻里用户";
      const address = profile.address || getCurrentLocation();
      this.setData({
        profileName: nickname,
        profileSub: maskPhone(profile.phone) || "手机号待完善",
        profileAvatarUrl: avatarUrlOf(profile),
        profileAvatar: avatarInitial(nickname, "邻"),
        customerAddress: locationLabel(address),
        assetStats: [
          { value: 24, label: "已服务" },
          { value: 3, label: "收藏" },
          { value: 2, label: "优惠券" },
        ],
        serviceRecords: [
          { value: 3, label: "已发布需求" },
          { value: 24, label: "已完成服务" },
          { value: "良好", label: "社区信用" },
        ],
      });
      return;
    }
    const displayName = cleaner?.displayName || "家洁师资料待完善";
    const completedOrderCount = Number(this.data.completedOrderCount || cleaner?.completedOrderCount || 0);
    const serviceAreaCount = Array.isArray(cleaner?.serviceAreas) ? cleaner.serviceAreas.length : 0;
    const ratingValue = cleanerRatingValue(cleaner);
    this.setData({
      profileName: displayName,
      profileSub: cleaner ? `${cleaner.ratingText} · 已服务${completedOrderCount}单` : "完善资料后开始接单",
      profileAvatarUrl: avatarUrlOf(cleaner),
      profileAvatar: cleaner?.avatarText || avatarInitial(displayName, "洁"),
      assetStats: [
        { value: completedOrderCount, label: "已服务", action: "completedOrders" },
        { value: ratingValue, label: "评分", action: "reviews" },
        { value: serviceAreaCount, label: "社区", action: "profile" },
      ],
      serviceRecords: [
        { value: completedOrderCount, label: "已完成服务" },
        { value: serviceAreaCount, label: "已服务社区" },
        { value: communityCredit(ratingValue), label: "社区信用" },
      ],
    });
  },

  promptProfileSetup(user, customerProfile, cleanerProfile) {
    if (!user) return;
    const role = this.data.isCustomer ? "customer" : "cleaner";
    const profile = role === "customer" ? customerProfile : cleanerProfile;
    const alreadyPrompted = wx.getStorageSync(`profileSetupPrompted:${role}`);
    const name = role === "customer" ? profile?.nickname : profile?.displayName;
    const avatarUrl = profile?.avatarUrl;
    const lacksNickname =
      !name || name === "邻里用户" || name === "家洁师资料待完善";
    const lacksAvatar = !avatarUrl;
    if (alreadyPrompted || (!lacksNickname && !lacksAvatar)) return;
    wx.setStorageSync(`profileSetupPrompted:${role}`, true);
    wx.showModal({
      title: "完善个人资料",
      content: "是否使用微信昵称和头像？",
      confirmText: "使用微信信息",
      cancelText: "手动填写",
      success: (res) => {
        if (res.confirm) {
          this.useWechatProfile();
        } else if (res.cancel) {
          this.openProfileEditor();
        }
      },
    });
  },

  useWechatProfile() {
    if (!wx.getUserProfile) {
      this.openProfileEditor();
      return;
    }
    wx.getUserProfile({
      desc: "用于完善家洁到家个人资料",
      success: async (res) => {
        const info = res.userInfo || {};
        await this.saveCurrentProfile({
          nickname: info.nickName || this.data.profileName,
          avatarUrl: info.avatarUrl || this.data.profileAvatarUrl,
        });
      },
      fail: () => this.openProfileEditor(),
    });
  },

  openProfileEditor() {
    const roleProfile = this.data.isCustomer ? this.data.customerProfile || {} : this.data.cleaner || {};
    this.setData({
      editProfileVisible: true,
      editProfileForm: {
        nickname: this.data.profileName || "",
        phone: roleProfile.phone || "",
        avatarUrl: this.data.profileAvatarUrl || "",
      },
    });
  },

  closeProfileEditor() {
    this.setData({ editProfileVisible: false });
  },

  noop() {},

  onProfileFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`editProfileForm.${field}`]: event.detail.value });
  },

  async chooseProfileAvatar() {
    const handlePath = async (filePath) => {
      wx.showLoading({ title: "上传中" });
      try {
        const finalPath = await this.cropImageIfAvailable(filePath);
        const upload = await wx.cloud.uploadFile({
          cloudPath: `${this.data.isCustomer ? "customer-avatars" : "cleaner-avatars"}/${this.data.openid || Date.now()}-${Date.now()}.jpg`,
          filePath: finalPath,
        });
        if (this.data.editProfileVisible) {
          this.setData({ "editProfileForm.avatarUrl": upload.fileID });
        } else {
          await this.saveCurrentProfile({ avatarUrl: upload.fileID });
        }
      } catch (error) {
        showError(error);
      } finally {
        wx.hideLoading();
      }
    };
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success: (res) => {
          const file = res.tempFiles && res.tempFiles[0];
          if (file && file.tempFilePath) handlePath(file.tempFilePath);
        },
      });
      return;
    }
    wx.chooseImage({
      count: 1,
      sourceType: ["album", "camera"],
      success: (res) => {
        const filePath = res.tempFilePaths && res.tempFilePaths[0];
        if (filePath) handlePath(filePath);
      },
    });
  },

  cropImageIfAvailable(filePath) {
    return new Promise((resolve) => {
      if (!wx.cropImage) {
        resolve(filePath);
        return;
      }
      wx.cropImage({
        src: filePath,
        cropScale: "1:1",
        success: (res) => resolve(res.tempFilePath || filePath),
        fail: () => resolve(filePath),
      });
    });
  },

  async submitProfileEditor() {
    const nickname = this.data.editProfileForm.nickname.trim();
    if (!nickname) {
      wx.showToast({ title: "请填写昵称", icon: "none" });
      return;
    }
    await this.saveCurrentProfile({
      nickname,
      phone: this.data.editProfileForm.phone,
      avatarUrl: this.data.editProfileForm.avatarUrl,
    });
    this.closeProfileEditor();
  },

  async saveCurrentProfile(payload) {
    wx.showLoading({ title: "保存中" });
    try {
      const role = this.data.isCustomer ? "customer" : "cleaner";
      const result = await callCloud("updateMyProfile", { ...payload, role });
      const cleaner = result.cleanerProfile ? decorateCleaner(result.cleanerProfile) : this.data.cleaner;
      this.setData({
        user: result.user,
        customerProfile: result.customerProfile || this.data.customerProfile,
        cleaner,
      });
      const app = getApp();
      app.globalData.user = result.user;
      app.globalData.customerProfile = result.customerProfile || this.data.customerProfile;
      app.globalData.cleanerProfile = result.cleanerProfile || cleaner;
      app.globalData.cleaner = result.cleaner || cleaner;
      app.globalData.currentProfile = this.data.isCustomer ? app.globalData.customerProfile : app.globalData.cleanerProfile;
      this.refreshProfileDisplay();
      wx.showToast({ title: "已保存" });
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },

  goCustomerOrders() {
    wx.switchTab({ url: "/pages/order-list/index" });
  },

  goCleanerOrders() {
    wx.switchTab({ url: "/pages/order-list/index" });
  },

  goSaved() {
    wx.navigateTo({ url: "/pages/saved-cleaners/index" });
  },

  openCustomerAddress() {
    wx.navigateTo({ url: "/pages/address-manage/index" });
  },

  showCoupon() {
    wx.showToast({ title: "试运营优惠以实际订单为准", icon: "none" });
  },

  showIncome() {
    wx.navigateTo({ url: "/pages/income-stats/index" });
  },

  showReviews() {
    wx.navigateTo({ url: "/pages/reviews/index" });
  },

  showCleanerProfile() {
    const openid = this.data.cleaner?._openid || this.data.openid;
    wx.navigateTo({ url: `/pages/cleaner-detail/index?openid=${openid}` });
  },

  handleAssetTap(event) {
    const action = event.currentTarget.dataset.action;
    if (action === "completedOrders") {
      wx.setStorageSync("preferredOrderStatus", "completed");
      wx.switchTab({ url: "/pages/order-list/index" });
      return;
    }
    if (action === "reviews") {
      this.showReviews();
      return;
    }
    if (action === "profile") {
      this.showCleanerProfile();
    }
  },

  contactService() {
    wx.navigateTo({ url: "/pages/support/index?type=service" });
  },

  feedback() {
    wx.navigateTo({ url: "/pages/support/index?type=feedback" });
  },

  settings() {
    const legalPages = [
      "/pages/legal/user-agreement/index",
      "/pages/legal/privacy-policy/index",
      "/pages/legal/platform-rules/index",
      "/pages/legal/service-guarantee/index",
      "/pages/legal/refund-cancellation/index",
      "/pages/legal/account-deletion/index",
    ];
    wx.showActionSheet({
      itemList: ["账号身份", "用户协议", "隐私政策", "平台交易规则", "服务保障规则", "退款取消规则", "删除/注销说明"],
      success: (res) => {
        if (res.tapIndex === 0) this.confirmSwitchRole();
        const page = legalPages[res.tapIndex - 1];
        if (page) wx.navigateTo({ url: page });
      },
    });
  },

  confirmSwitchRole() {
    const nextRole = this.data.isCustomer ? "cleaner" : "customer";
    wx.showModal({
      title: "切换账号身份",
      content: `确认切换为${nextRole === "cleaner" ? "家洁师端" : "住户端"}？切换后首页和订单功能会按新身份展示。`,
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: "切换中" });
        try {
          const updated = await callCloud("updateUserRole", { role: nextRole });
          await switchIdentity(
            { role: nextRole, openid: updated.openid },
            { fetchProfile: (role) => callCloud("getMyProfile", { role }) }
          );
          wx.reLaunch({ url: "/pages/home/index" });
        } catch (error) {
          showError(error);
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  async onAvailabilityChange(event) {
    wx.showLoading({ title: "更新中" });
    try {
      const available = event.detail.checked;
      const payload = { available };
      if (available) {
        payload.lastLocation = await getRuntimeLocation();
      }
      const result = await callCloud("updateCleanerAvailability", payload);
      this.setData({
        cleaner: result.cleaner ? decorateCleaner(result.cleaner) : this.data.cleaner,
        cleanerAvailable: available,
      });
      const app = getApp();
      app.globalData.cleaner = result.cleaner || app.globalData.cleaner;
      app.globalData.cleanerProfile = result.cleaner || app.globalData.cleanerProfile;
      if (!this.data.isCustomer) app.globalData.currentProfile = app.globalData.cleanerProfile;
      this.refreshProfileDisplay();
      wx.showToast({ title: available ? "接单中" : "休息中" });
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },
});
