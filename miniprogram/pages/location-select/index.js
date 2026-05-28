const { getUserRole, getRoleLocation, setRoleLocation } = require("../../utils/session");
const { callCloud } = require("../../utils/cloud");
const { reverseGeocode } = require("../../utils/location");
const {
  buildLocationStateFromPosition,
  locationDisplayText,
  removeRecentLocationAt,
} = require("../../utils/location-state");

const STREET_MAP = {
  上海市: {
    嘉定区: ["新成路街道", "真新街道", "菊园新区", "嘉定镇街道"],
    浦东新区: ["陆家嘴街道", "花木街道", "张江镇", "周浦镇"],
    徐汇区: ["湖南路街道", "天平路街道", "斜土路街道", "漕河泾街道"],
  },
  无锡市: {
    江阴市: ["澄江街道", "南闸街道", "云亭街道", "夏港街道", "申港街道"],
    梁溪区: ["崇安寺街道", "清名桥街道", "扬名街道", "广益街道"],
    滨湖区: ["河埒街道", "蠡园街道", "荣巷街道", "雪浪街道"],
  },
  哈尔滨市: {
    道里区: ["兆麟街道", "尚志街道", "斯大林街道", "工程街道", "经纬街道"],
    南岗区: ["花园街道", "奋斗路街道", "革新街道", "燎原街道"],
    道外区: ["靖宇街道", "太古街道", "仁里街道", "南马街道"],
  },
  杭州市: {
    西湖区: ["文三路街道", "翠苑街道", "古荡街道", "蒋村街道"],
    上城区: ["湖滨街道", "望江街道", "小营街道", "南星街道"],
    滨江区: ["西兴街道", "长河街道", "浦沿街道"],
  },
  北京市: {
    朝阳区: ["望京街道", "三里屯街道", "亚运村街道", "麦子店街道"],
    海淀区: ["中关村街道", "学院路街道", "万寿路街道", "上地街道"],
  },
  广州市: {
    天河区: ["林和街道", "猎德街道", "石牌街道", "员村街道"],
    越秀区: ["北京街道", "东山街道", "洪桥街道", "建设街道"],
  },
};

function streetsFor(region) {
  const city = region[1] || "";
  const district = region[2] || "";
  return STREET_MAP[city]?.[district] || STREET_MAP[city]?.default || [];
}

function uniqueList(items) {
  return items.filter(Boolean).filter((item, index, list) => list.indexOf(item) === index);
}

function geocodeErrorMessage(error) {
  const message = error && (error.message || error.errMsg || "");
  const status = error && error.status !== undefined ? error.status : "";
  const source = `${status} ${message}`.toLowerCase();
  if (source.includes("key") || status === 110 || status === 111 || status === 112) {
    return `腾讯地图 Key 错误或未授权${status !== "" ? `（status=${status}）` : ""}：${message || "请检查 Key 配置"}`;
  }
  if (source.includes("domain") || source.includes("url not in domain") || source.includes("合法域名")) {
    return "request 合法域名未配置：请在微信小程序后台加入 https://apis.map.qq.com";
  }
  if (source.includes("service") || source.includes("服务") || source.includes("权限")) {
    return `腾讯逆地址解析服务可能未开通${status !== "" ? `（status=${status}）` : ""}：${message || "请检查腾讯位置服务控制台"}`;
  }
  if (message.includes("request:fail") || message.includes("fail")) {
    return `腾讯地图 request 失败：${message}`;
  }
  if (status !== "") {
    return `腾讯地图返回 status=${status}：${message || "逆地址解析失败"}`;
  }
  return message || "定位成功，但地址解析失败，请手动确认省市区";
}

Page({
  data: {
    region: ["浙江省", "杭州市", "西湖区"],
    regionLabel: "浙江省 / 杭州市 / 西湖区",
    streetOptions: streetsFor(["浙江省", "杭州市", "西湖区"]),
    streetIndex: 0,
    street: "文三路街道",
    hasStreetOptions: true,
    mode: "customer",
    isCleanerMode: false,
    pageTitle: "选择地址",
    pageSubtitle: "用于首页地址、发布需求地址预填和推荐家洁师。",
    community: "梧桐小区",
    addressText: "",
    currentPosition: null,
    currentPositionText: "正在获取当前位置",
    currentMarkers: [],
    locating: false,
    recent: [],
  },

  onLoad(options = {}) {
    const role = getUserRole();
    const mode = options.mode === "cleaner" || role === "cleaner" ? "cleaner" : "customer";
    const cached = wx.getStorageSync(mode === "cleaner" ? "cleanerCurrentLocation" : "customerCurrentLocation");
    const current = getRoleLocation(mode);
    const region = [current.province || "浙江省", current.city || "杭州市", current.district || "西湖区"];
    const mappedStreets = streetsFor(region);
    const streetOptions = mappedStreets.length ? uniqueList([current.street, ...mappedStreets]) : [];
    const streetIndex = Math.max(0, streetOptions.indexOf(current.street));
    this.setData({
      mode,
      isCleanerMode: mode === "cleaner",
      pageTitle: mode === "cleaner" ? "选择接单城市" : "选择地址",
      pageSubtitle: mode === "cleaner" ? "用于筛选附近公开订单，只需确认城市和区县。" : "用于首页地址、发布需求地址预填和推荐家洁师。",
      region,
      regionLabel: region.join(" / "),
      streetOptions,
      streetIndex,
      street: streetOptions.length ? streetOptions[streetIndex] : current.street || "",
      hasStreetOptions: streetOptions.length > 0,
      community: current.community || "",
      addressText: current.addressText || "",
      currentPosition:
        current.latitude && current.longitude
          ? {
              latitude: current.latitude,
              longitude: current.longitude,
            }
          : null,
      currentPositionText:
        current.latitude && current.longitude
          ? locationDisplayText({
              resolved: Boolean(current.province || current.city || current.district || current.street),
              region,
              street: current.street || "",
              addressText: current.addressText || "",
            })
          : "正在获取当前位置",
      currentMarkers:
        current.latitude && current.longitude
          ? [
              {
                id: 1,
                latitude: current.latitude,
                longitude: current.longitude,
                width: 28,
                height: 28,
              },
            ]
          : [],
      recent: wx.getStorageSync("recentLocations") || [],
    });
    if (!cached) {
      this.locate();
    }
  },

  onRegionChange(event) {
    const region = event.detail.value;
    const streetOptions = streetsFor(region);
    this.setData({
      region,
      regionLabel: region.join(" / "),
      streetOptions,
      streetIndex: 0,
      street: streetOptions[0] || "",
      hasStreetOptions: streetOptions.length > 0,
    });
    this.refreshCurrentPositionText();
  },

  onStreetChange(event) {
    const streetIndex = Number(event.detail.value);
    this.setData({ streetIndex, street: this.data.streetOptions[streetIndex] });
    this.refreshCurrentPositionText();
  },

  onStreetInput(event) {
    this.setData({ street: event.detail.value.trim() });
    this.refreshCurrentPositionText();
  },

  onCommunityInput(event) {
    this.setData({ community: event.detail.value.trim() });
  },

  useRecent(event) {
    const item = this.data.recent[Number(event.currentTarget.dataset.index)];
    if (!item) return;
    const region = [item.province, item.city, item.district];
    const mappedStreets = streetsFor(region);
    const streetOptions = mappedStreets.length ? uniqueList([item.street, ...mappedStreets]) : [];
    const streetIndex = Math.max(0, streetOptions.indexOf(item.street));
    this.setData({
      region,
      regionLabel: region.join(" / "),
      streetOptions,
      street: streetOptions.length ? streetOptions[streetIndex] : item.street || "",
      hasStreetOptions: streetOptions.length > 0,
      streetIndex,
      community: item.community,
      addressText: item.addressText || "",
      currentPosition:
        item.latitude && item.longitude
          ? {
              latitude: item.latitude,
              longitude: item.longitude,
            }
          : this.data.currentPosition,
      currentMarkers:
        item.latitude && item.longitude
          ? [
              {
                id: 1,
                latitude: item.latitude,
                longitude: item.longitude,
                width: 28,
                height: 28,
              },
            ]
          : this.data.currentMarkers,
    });
    this.refreshCurrentPositionText();
  },

  refreshCurrentPositionText() {
    const position = this.data.currentPosition;
    if (!position) return;
    const [province, city, district] = this.data.region;
    const resolved = Boolean(province || city || district || this.data.street);
    this.setData({
      currentPositionText: locationDisplayText({
        resolved,
        region: this.data.region,
        street: this.data.street,
        addressText: this.data.addressText,
      }),
    });
  },

  reverseGeocode(position) {
    return reverseGeocode(position.latitude, position.longitude);
  },

  locate() {
    if (this.data.locating) return;
    this.setData({ locating: true, currentPositionText: "正在获取当前位置" });
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: true,
      success: async (res) => {
        console.log("[定位经纬度]", res);
        let resolved = null;
        let geocodeFailed = false;
        let geocodeError = null;
        try {
          resolved = await this.reverseGeocode(res);
          console.log("[逆地址解析结果]", resolved);
        } catch (error) {
          geocodeFailed = true;
          geocodeError = error;
          console.error("[逆地址解析失败]", error);
          resolved = res;
        }
        const locationState = buildLocationStateFromPosition(resolved);
        const mappedStreets = locationState.resolved ? streetsFor(locationState.region) : [];
        const streetOptions = mappedStreets.length ? uniqueList([locationState.street, ...mappedStreets]) : [];
        const streetIndex = Math.max(0, streetOptions.indexOf(locationState.street));
        const position = {
          latitude: res.latitude,
          longitude: res.longitude,
        };
        this.setData({
          region: locationState.region,
          regionLabel: locationState.regionLabel,
          streetOptions,
          streetIndex,
          street: streetOptions.length ? streetOptions[streetIndex] || "" : locationState.street || "",
          hasStreetOptions: streetOptions.length > 0,
          addressText: locationState.addressText || "",
          currentPosition: position,
          currentMarkers: [
            {
              id: 1,
              latitude: res.latitude,
              longitude: res.longitude,
              width: 28,
              height: 28,
            },
          ],
          locating: false,
          currentPositionText: locationDisplayText(locationState),
        });
        if (geocodeFailed) {
          const message = geocodeErrorMessage(geocodeError);
          wx.showModal({
            title: "地址解析失败",
            content: message,
            showCancel: false,
          });
        }
      },
      fail: () => {
        this.setData({
          locating: false,
          currentPositionText: "定位失败，请检查授权后重试",
        });
        wx.showToast({ title: "定位失败，请手动选择地址", icon: "none" });
      },
    });
  },

  deleteRecent(event) {
    const index = Number(event.currentTarget.dataset.index);
    const recent = removeRecentLocationAt(this.data.recent, index);
    wx.setStorageSync("recentLocations", recent);
    this.setData({ recent });
  },

  async confirm() {
    if (!this.data.isCleanerMode && !this.data.community) {
      wx.showToast({ title: "请输入小区名称", icon: "none" });
      return;
    }
    const [province, city, district] = this.data.region;
    const location = setRoleLocation(this.data.mode, {
      province,
      city,
      district,
      street: this.data.isCleanerMode ? "" : this.data.street,
      community: this.data.isCleanerMode ? "" : this.data.community,
      detailAddress: "",
      addressText: this.data.addressText,
      latitude: this.data.currentPosition ? this.data.currentPosition.latitude : null,
      longitude: this.data.currentPosition ? this.data.currentPosition.longitude : null,
    });
    if (!this.data.isCleanerMode) {
      const recent = [location, ...(wx.getStorageSync("recentLocations") || [])]
        .filter((item, index, list) => list.findIndex((target) => target.community === item.community) === index)
        .slice(0, 3);
      wx.setStorageSync("recentLocations", recent);
    }
    wx.showLoading({ title: "保存中" });
    try {
      await callCloud(this.data.isCleanerMode ? "updateCleanerWorkLocation" : "updateCustomerLocation", location);
      wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/home/index" }) });
    } catch (error) {
      wx.showToast({ title: "地址已保存本地，云端同步失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },
});
