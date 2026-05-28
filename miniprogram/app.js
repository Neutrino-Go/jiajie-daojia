const { envList } = require("./envList");

App({
  globalData: {
    env: envList && envList[0] && envList[0].envId ? envList[0].envId : "",
    openid: "",
    user: null,
    currentUser: null,
    currentProfile: null,
    customerProfile: null,
    cleanerProfile: null,
    cleaner: null,
    currentRole: "",
    activeRole: "",
    currentLocation: null,
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上基础库以使用云能力");
      return;
    }
    const cloudConfig = {
      traceUser: true,
    };
    if (this.globalData.env) {
      cloudConfig.env = this.globalData.env;
    }
    wx.cloud.init(cloudConfig);
  },

  onShow() {
    const profile = this.globalData.currentProfile || {};
    console.log("[identity]", {
      openid: this.globalData.openid,
      role: this.globalData.currentRole || this.globalData.activeRole || this.globalData.user?.role || "",
      profileType: (this.globalData.currentRole || this.globalData.activeRole) === "cleaner" ? "cleanerProfile" : "customerProfile",
      nickname: profile.nickname || profile.displayName || "",
      avatarUrl: profile.avatarUrl || "",
    });
  },
});
