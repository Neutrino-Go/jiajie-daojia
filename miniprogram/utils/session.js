const ROLE_KEY = "userRole";
const CURRENT_ROLE_KEY = "currentRole";
const LOCATION_KEY = "currentLocation";
const CUSTOMER_LOCATION_KEY = "customerCurrentLocation";
const CLEANER_LOCATION_KEY = "cleanerCurrentLocation";
const ROLE_CACHE_KEYS = [
  "currentUser",
  "currentProfile",
  "customerProfile",
  "cleanerProfile",
  "homeCache",
  "profileCache",
  "orderCache",
  "cleanerListCache",
];

function normalizeRole(role) {
  return role === "cleaner" ? "cleaner" : role === "customer" ? "customer" : "";
}

function getUserRole() {
  const app = getApp();
  return normalizeRole(
    wx.getStorageSync(ROLE_KEY) ||
      wx.getStorageSync(CURRENT_ROLE_KEY) ||
      app.globalData.currentRole ||
      app.globalData.activeRole ||
      app.globalData.user?.role ||
      ""
  );
}

function setUserRole(role) {
  const nextRole = normalizeRole(role);
  if (!nextRole) return "";
  wx.setStorageSync(ROLE_KEY, nextRole);
  wx.setStorageSync(CURRENT_ROLE_KEY, nextRole);
  const app = getApp();
  if (app.globalData.user) {
    app.globalData.user = {
      ...(app.globalData.user || {}),
      role: nextRole,
    };
  }
  app.globalData.currentRole = nextRole;
  app.globalData.activeRole = nextRole;
  return nextRole;
}

function clearUserRole() {
  wx.removeStorageSync(ROLE_KEY);
  wx.removeStorageSync(CURRENT_ROLE_KEY);
}

function removeRoleCaches() {
  ROLE_CACHE_KEYS.forEach((key) => wx.removeStorageSync(key));
}

function clearIdentityContext(role = "", openid = "") {
  const nextRole = normalizeRole(role);
  const app = getApp();
  removeRoleCaches();
  app.globalData.currentUser = null;
  app.globalData.currentProfile = null;
  app.globalData.currentRole = nextRole;
  app.globalData.activeRole = nextRole;
  app.globalData.user = null;
  app.globalData.customerProfile = null;
  app.globalData.cleanerProfile = null;
  app.globalData.cleaner = null;
  if (openid) app.globalData.openid = openid;
  if (nextRole) {
    wx.setStorageSync(ROLE_KEY, nextRole);
    wx.setStorageSync(CURRENT_ROLE_KEY, nextRole);
  }
}

function profileForRole(payload, role) {
  if (!payload) return null;
  return role === "cleaner"
    ? payload.cleanerProfile || payload.cleaner || null
    : payload.customerProfile || null;
}

function applyIdentityProfile(payload, preferredRole) {
  const app = getApp();
  const role = normalizeRole(preferredRole || payload?.role || payload?.user?.role);
  if (!role) return null;
  const openid = payload?.openid || app.globalData.openid || "";
  const user = payload?.user ? { ...payload.user, role, openid } : { role, openid };
  const currentProfile = profileForRole(payload, role);
  app.globalData.openid = openid;
  app.globalData.user = user;
  app.globalData.currentUser = user;
  app.globalData.customerProfile = payload?.customerProfile || null;
  app.globalData.cleanerProfile = payload?.cleanerProfile || payload?.cleaner || null;
  app.globalData.cleaner = payload?.cleaner || payload?.cleanerProfile || null;
  app.globalData.currentProfile = currentProfile;
  app.globalData.currentRole = role;
  app.globalData.activeRole = role;
  wx.setStorageSync(ROLE_KEY, role);
  wx.setStorageSync(CURRENT_ROLE_KEY, role);
  wx.setStorageSync("currentUser", user);
  if (currentProfile) wx.setStorageSync("currentProfile", currentProfile);
  console.log("[identity]", {
    openid,
    role,
    profileType: role === "cleaner" ? "cleanerProfile" : "customerProfile",
    nickname: currentProfile?.nickname || currentProfile?.displayName || "",
    avatarUrl: currentProfile?.avatarUrl || "",
  });
  return {
    openid,
    role,
    user,
    currentProfile,
    customerProfile: app.globalData.customerProfile,
    cleanerProfile: app.globalData.cleanerProfile,
  };
}

async function switchIdentity(identity, options = {}) {
  const role = normalizeRole(identity && identity.role);
  if (!role) throw new Error("角色不正确");
  const openid = identity.openid || "";
  clearIdentityContext(role, openid);
  const payload = options.fetchProfile ? await options.fetchProfile(role) : identity;
  const result = applyIdentityProfile({ ...(payload || {}), role, openid: (payload && payload.openid) || openid }, role);
  configureTabBar(role);
  console.log("[identity]", {
    openid: result?.openid || openid,
    role,
    profileType: role === "cleaner" ? "cleanerProfile" : "customerProfile",
    nickname: result?.currentProfile?.nickname || result?.currentProfile?.displayName || "",
    avatarUrl: result?.currentProfile?.avatarUrl || "",
  });
  return result;
}

function syncIdentityFromLogin(login) {
  const role = normalizeRole(login?.user?.role);
  if (!role) return null;
  const app = getApp();
  const cachedUser = wx.getStorageSync("currentUser") || {};
  const cachedOpenid = app.globalData.openid || cachedUser.openid || "";
  if ((login.openid && cachedOpenid && login.openid !== cachedOpenid) || getUserRole() !== role) {
    clearIdentityContext(role, login.openid);
  }
  return applyIdentityProfile({ ...login, role }, role);
}

function roleName(role) {
  return role === "cleaner" ? "家洁师端" : "住户端";
}

function roleHomePath() {
  return "/pages/home/index";
}

function requireRole(allowedRoles) {
  const role = getUserRole();
  const allowed = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  if (!role) {
    wx.reLaunch({ url: "/pages/role-select/index" });
    return false;
  }
  if (allowed.length && !allowed.includes(role)) {
    wx.showToast({ title: "当前身份无权访问该页面", icon: "none" });
    wx.switchTab({ url: roleHomePath(role) });
    return false;
  }
  return true;
}

function getCurrentLocation() {
  return getRoleLocation(getUserRole());
}

function fallbackLocation() {
  return (
    wx.getStorageSync(LOCATION_KEY) ||
    {
      province: "浙江省",
      city: "杭州市",
      district: "西湖区",
      street: "文三路街道",
      community: "梧桐小区",
      detailAddress: "",
    }
  );
}

function locationKeyForRole(role) {
  return normalizeRole(role) === "cleaner" ? CLEANER_LOCATION_KEY : CUSTOMER_LOCATION_KEY;
}

function getRoleLocation(role) {
  const key = locationKeyForRole(role);
  return wx.getStorageSync(key) || wx.getStorageSync(LOCATION_KEY) || fallbackLocation();
}

function setRoleLocation(role, location) {
  const key = locationKeyForRole(role);
  const nested = location.location || {};
  const next = {
    province: location.province || "",
    city: location.city || "",
    district: location.district || "",
    street: location.street || "",
    community: location.community || "",
    detailAddress: location.detailAddress || "",
    addressText: location.addressText || "",
    latitude: location.latitude === undefined ? nested.lat || nested.latitude || null : location.latitude,
    longitude: location.longitude === undefined ? nested.lng || nested.longitude || null : location.longitude,
  };
  wx.setStorageSync(key, next);
  const app = getApp();
  if (normalizeRole(role) === "cleaner") {
    app.globalData.cleanerLocation = next;
  } else {
    app.globalData.customerLocation = next;
  }
  app.globalData.currentLocation = next;
  return next;
}

function setCurrentLocation(location) {
  return setRoleLocation(getUserRole(), location);
}

function shortRoleLocationLabel(location) {
  const current = location || getRoleLocation("cleaner");
  return [current.city, current.district].filter(Boolean).join(" ") || current.city || "选择接单城市";
}

function formatRegionText(location) {
  if (!location) return "请选择地址";
  const parts = [location.province || "", location.city || "", location.district || ""].filter(Boolean);
  const normalized = [];
  parts.forEach((item) => {
    if (item && item !== normalized[normalized.length - 1]) {
      normalized.push(item);
    }
  });
  return normalized.length ? normalized.join(" ") : "请选择地址";
}

function locationLabel(location) {
  const current = location || getCurrentLocation();
  return current.community || current.district || current.city || "请选择地址";
}

function locationFullText(location) {
  const current = location || getCurrentLocation();
  return [current.city, current.district, current.street, current.community, current.detailAddress]
    .filter(Boolean)
    .join(" ");
}

function configureTabBar(role) {
  const currentRole = normalizeRole(role || getUserRole());
  if (!currentRole || !wx.setTabBarItem) return;
  if (currentRole === "cleaner") {
    wx.setTabBarItem({ index: 0, text: "接单" });
    wx.setTabBarItem({ index: 1, text: "订单" });
    wx.setTabBarItem({ index: 2, text: "消息" });
    wx.setTabBarItem({ index: 3, text: "我的" });
    return;
  }
  wx.setTabBarItem({ index: 0, text: "首页" });
  wx.setTabBarItem({ index: 1, text: "订单" });
  wx.setTabBarItem({ index: 2, text: "消息" });
  wx.setTabBarItem({ index: 3, text: "我的" });
}

module.exports = {
  getActiveRole: getUserRole,
  setActiveRole: setUserRole,
  activeRoleName: roleName,
  getUserRole,
  setUserRole,
  clearUserRole,
  roleName,
  roleHomePath,
  requireRole,
  getCurrentLocation,
  setCurrentLocation,
  getRoleLocation,
  setRoleLocation,
  shortRoleLocationLabel,
  formatRegionText,
  locationLabel,
  locationFullText,
  configureTabBar,
  clearIdentityContext,
  applyIdentityProfile,
  switchIdentity,
  syncIdentityFromLogin,
};
