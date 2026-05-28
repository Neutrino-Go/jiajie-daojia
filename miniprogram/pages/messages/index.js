const { callCloud, showError } = require("../../utils/cloud");
const { requireRole, setUserRole, configureTabBar, syncIdentityFromLogin } = require("../../utils/session");

const WEEKDAY_TEXT = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function pad(value) {
  return String(value).padStart(2, "0");
}

function compactMessageTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.floor((todayStart - targetStart) / 86400000);

  if (diffDays === 0) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (diffDays === 1) return "昨天";
  if (diffDays > 1 && diffDays < 7) return WEEKDAY_TEXT[date.getDay()];
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

Page({
  data: {
    loading: true,
    conversations: [],
  },

  onShow() {
    if (!requireRole(["customer", "cleaner"])) return;
    this.setData({ loading: true, conversations: [] });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const login = await callCloud("login");
      if (!login.user || !["customer", "cleaner"].includes(login.user.role)) {
        wx.reLaunch({ url: "/pages/role-select/index" });
        return;
      }
      syncIdentityFromLogin(login);
      setUserRole(login.user.role);
      configureTabBar(login.user.role);
      const list = await callCloud("listConversations");
      this.setData({
        conversations: list.map((item) => ({
          ...item,
          timeText: compactMessageTime(item.lastMessageAt || item.updatedAt),
        })),
      });
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  openChat(event) {
    wx.navigateTo({ url: `/pages/chat/index?id=${event.detail.id}` });
  },
});
