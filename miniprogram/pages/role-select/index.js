const { callCloud, showError } = require("../../utils/cloud");
const { switchIdentity } = require("../../utils/session");

function showCloudUnavailable() {
  wx.showToast({
    title: "云服务暂不可用，请检查云环境或稍后重试",
    icon: "none",
    duration: 2400,
  });
}

Page({
  data: {
    bootstrapping: false,
  },

  onLoad() {
    this.setData({ bootstrapping: false });
    // Do not block the role cards. A slow cloud login should not make this page feel blank.
    setTimeout(() => this.bootstrap(), 0);
  },

  async bootstrap() {
    if (this.data.bootstrapping) return;
    this.setData({ bootstrapping: true });
    try {
      const login = await callCloud("login");
      if (login.user && ["customer", "cleaner"].includes(login.user.role)) {
        await switchIdentity(
          { role: login.user.role, openid: login.openid },
          { fetchProfile: (role) => callCloud("getMyProfile", { role }) }
        );
        wx.reLaunch({ url: "/pages/home/index" });
      }
    } catch (error) {
      console.warn("role-select bootstrap failed", error);
      showCloudUnavailable();
    } finally {
      this.setData({ bootstrapping: false });
    }
  },

  async chooseRole(event) {
    const role = event.currentTarget.dataset.role;
    wx.showLoading({ title: "进入中" });
    try {
      const data = await callCloud("updateUserRole", { role });
      await switchIdentity(
        { role, openid: data.openid },
        { fetchProfile: (nextRole) => callCloud("getMyProfile", { role: nextRole }) }
      );
      wx.reLaunch({ url: "/pages/home/index" });
    } catch (error) {
      console.warn("choose role failed", error);
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },
});
