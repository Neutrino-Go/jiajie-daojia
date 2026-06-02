const { callCloud, showError } = require("../../utils/cloud");
const {
  SERVICE_TYPES,
  DURATION_OPTIONS,
} = require("../../utils/constants");
const { decorateCleaner } = require("../../utils/format");
const { requireRole, getRoleLocation, locationLabel, locationFullText } = require("../../utils/session");
const { BASE_PRICING, calculateOrderPrice } = require("../../config/pricing");

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatMoney(value) {
  const amount = roundMoney(value);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function calcPricing(inputOrServiceType, durationHours) {
  const input =
    typeof inputOrServiceType === "object"
      ? inputOrServiceType || {}
      : { serviceType: inputOrServiceType, durationHours };
  const pricing = calculateOrderPrice({
    city: input.city || "",
    serviceType: input.serviceType,
    durationHours: input.durationHours,
  });
  return {
    ...pricing,
    canShowEstimate: true,
    estimateHint: "",
    orderAmountText: `¥${formatMoney(pricing.orderAmount)}`,
    platformFeeText: `¥${formatMoney(pricing.platformFee)}`,
    cleanerIncomeText: `¥${formatMoney(pricing.cleanerIncome)}`,
    minIncomeTip: pricing.isMinIncomeProtected ? "已保障家洁师合理收入，价格已自动调整" : "",
  };
}

const PHONE_PATTERN = /^1[3-9]\d{9}$/;

const NEED_TAG_GROUPS = [
  { title: "环境情况", tags: ["有宠物", "儿童家庭", "老人家庭", "新房入住", "长期未清洁"] },
  { title: "工具要求", tags: ["需自带工具", "需自带清洁剂", "需专业设备"] },
  {
    title: "清洗需求",
    tags: ["需清洗衣物", "需清洗被褥", "需床品清洁", "需厨房重油清洁", "需卫生间深度清洁", "需玻璃清洁"],
  },
  { title: "服务偏好", tags: ["希望女性家洁师", "指定家洁师", "安静作业", "优先上午", "优先下午"] },
];

const COMMON_NEED_TAGS = ["有宠物", "需自带工具", "需清洗被褥", "需厨房重油清洁", "需卫生间深度清洁"];
const ALL_NEED_TAGS = NEED_TAG_GROUPS.reduce((tags, group) => tags.concat(group.tags), []);

function pad(value) {
  return String(value).padStart(2, "0");
}

function getDateText(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getTimeText(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getNowPickerState() {
  const now = new Date();
  return {
    minDate: getDateText(now),
    minTime: getTimeText(now),
  };
}

function isToday(dateText) {
  return dateText === getDateText(new Date());
}

function parseSchedule(serviceDate, serviceTime) {
  if (!serviceDate || !serviceTime) return null;
  const date = new Date(`${serviceDate.replace(/-/g, "/")} ${serviceTime}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isFutureSchedule(serviceDate, serviceTime) {
  const date = parseSchedule(serviceDate, serviceTime);
  return Boolean(date && date.getTime() > Date.now());
}

function toast(title) {
  wx.showToast({ title, icon: "none" });
}

function splitNoteParts(note) {
  return String(note || "")
    .split(/[;；,，\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, array) => array.indexOf(part) === index);
}

function selectedTagsFromNote(note) {
  return ALL_NEED_TAGS.filter((tag) => String(note || "").includes(tag));
}

function manualNoteFromValue(note) {
  return splitNoteParts(note)
    .filter((part) => !ALL_NEED_TAGS.includes(part))
    .join("；");
}

function buildNote(manualNote, selectedTags) {
  return splitNoteParts(manualNote).concat(selectedTags).join("；");
}

Page({
  data: {
    serviceTypes: SERVICE_TYPES,
    durationOptions: DURATION_OPTIONS,
    commonNeedTags: COMMON_NEED_TAGS,
    needTagGroups: NEED_TAG_GROUPS,
    selectedNeedTags: [],
    showAllNeedTags: false,
    manualNote: "",
    estimatePrice: 138,
    pricing: calcPricing(SERVICE_TYPES[0], 3, ""),
    savedCleaners: [],
    selectedCleanerName: "请选择已收藏家洁师",
    publishMode: "public",
    cleanerIndex: -1,
    serviceDate: "",
    serviceTime: "",
    minDate: "",
    minTime: "",
    timePickerStart: "00:00",
    locationLabel: "请选择地址",
    locationText: "",
    form: {
      serviceType: SERVICE_TYPES[0],
      addressText: "",
      community: "",
      locationSnapshot: null,
      areaSize: "",
      durationHours: 3,
      scheduledAt: "",
      note: "",
      contactPhone: "",
      contactWechat: "",
      assignedCleanerOpenid: "",
      estimatedPrice: 138,
      orderAmount: 138,
      platformFee: 6.9,
      cleanerIncome: 131.1,
      commissionRate: BASE_PRICING.platformFeeRate,
      commissionCap: 0,
      pricingSnapshot: null,
    },
    submitting: false,
  },

  onLoad(options) {
    if (!requireRole("customer")) return;
    const pickerState = getNowPickerState();
    this.setData({
      minDate: pickerState.minDate,
      minTime: pickerState.minTime,
      timePickerStart: "00:00",
    });
    const form = { ...this.data.form };
    if (options.cleanerOpenid) {
      form.assignedCleanerOpenid = options.cleanerOpenid;
      this.setData({ publishMode: "assigned", form });
    }
    if (options.prefill) {
      try {
        const prefill = JSON.parse(decodeURIComponent(options.prefill));
        Object.assign(form, {
          serviceType: prefill.serviceType || form.serviceType,
          addressText: prefill.addressText || form.addressText,
          community: prefill.community || form.community,
          areaSize: prefill.areaSize || form.areaSize,
          durationHours: prefill.durationHours || form.durationHours,
        });
        this.setData({ form });
      } catch (error) {
        console.warn("Invalid prefill", error);
      }
    }
    this.refreshPrice();
    this.loadSavedCleaners();
  },

  onShow() {
    if (!requireRole("customer")) return;
    const location = getRoleLocation("customer");
    this.setData({
      locationLabel: locationLabel(location),
      locationText: locationFullText(location),
      "form.community": location.community || "",
      "form.addressText": locationFullText(location),
      "form.locationSnapshot": {
        province: location.province || "",
        city: location.city || "",
        district: location.district || "",
        street: location.street || "",
        community: location.community || "",
        detailAddress: location.detailAddress || "",
        addressText: locationFullText(location),
        latitude: location.latitude ?? location.lat ?? null,
        longitude: location.longitude ?? location.lng ?? location.lon ?? null,
      },
    }, () => this.refreshPrice());
  },

  async loadSavedCleaners() {
    try {
      const cleaners = await callCloud("listSavedCleaners");
      const savedCleaners = cleaners.map(decorateCleaner);
      const cleanerIndex = savedCleaners.findIndex(
        (cleaner) => cleaner._openid === this.data.form.assignedCleanerOpenid
      );
      this.setData({
        savedCleaners,
        cleanerIndex,
        selectedCleanerName: cleanerIndex >= 0 ? savedCleaners[cleanerIndex].displayName : "请选择已收藏家洁师",
      });
    } catch (error) {
      this.setData({ savedCleaners: [] });
    }
  },

  setMode(event) {
    const publishMode = event.currentTarget.dataset.mode;
    const form = { ...this.data.form };
    if (publishMode === "public") {
      form.assignedCleanerOpenid = "";
      this.setData({ cleanerIndex: -1 });
    }
    this.setData({ publishMode, form });
  },

  selectService(event) {
    const serviceType = event.currentTarget.dataset.value;
    this.setData({ "form.serviceType": serviceType });
    this.refreshPrice();
  },

  selectDuration(event) {
    const value = Number(event.currentTarget.dataset.value);
    this.setData({ "form.durationHours": value });
    this.refreshPrice();
  },

  refreshPrice() {
    const city = this.data.form.locationSnapshot && this.data.form.locationSnapshot.city;
    const pricing = calcPricing({
      city,
      serviceType: this.data.form.serviceType,
      durationHours: this.data.form.durationHours,
    });
    const pricingSnapshot = {
      city: pricing.city,
      cityFactor: pricing.cityFactor,
      serviceTypeFactor: pricing.serviceTypeFactor,
      baseHourlyPrice: pricing.baseHourlyPrice,
      durationHours: pricing.durationHours,
      orderAmount: pricing.orderAmount,
      platformFee: pricing.platformFee,
      cleanerIncome: pricing.cleanerIncome,
      cleanerHourlyIncome: pricing.cleanerHourlyIncome,
      minCleanerHourlyIncome: pricing.minCleanerHourlyIncome,
      isMinIncomeProtected: pricing.isMinIncomeProtected,
      calculatedAt: new Date().toISOString(),
    };
    this.setData({
      pricing,
      estimatePrice: pricing.orderAmount,
      "form.estimatedPrice": pricing.orderAmount,
      "form.orderAmount": pricing.orderAmount,
      "form.platformFee": pricing.platformFee,
      "form.cleanerIncome": pricing.cleanerIncome,
      "form.commissionRate": BASE_PRICING.platformFeeRate,
      "form.commissionCap": 0,
      "form.pricingSnapshot": pricingSnapshot,
    });
  },

  onDateChange(event) {
    const serviceDate = event.detail.value;
    const timePickerStart = isToday(serviceDate) ? getNowPickerState().minTime : "00:00";
    const updates = { serviceDate, timePickerStart };
    if (this.data.serviceTime && !isFutureSchedule(serviceDate, this.data.serviceTime)) {
      Object.assign(updates, { serviceTime: "", "form.scheduledAt": "" });
      toast("请选择当前时间之后的预约时间");
    }
    this.setData(updates);
    if (this.data.serviceTime && updates.serviceTime !== "") {
      this.updateScheduledAt(serviceDate, this.data.serviceTime);
    }
  },

  onTimeChange(event) {
    const serviceTime = event.detail.value;
    if (this.data.serviceDate && !isFutureSchedule(this.data.serviceDate, serviceTime)) {
      this.setData({ serviceTime: "", "form.scheduledAt": "" });
      toast("请选择当前时间之后的预约时间");
      return;
    }
    this.setData({ serviceTime });
    this.updateScheduledAt(this.data.serviceDate, serviceTime);
  },

  updateScheduledAt(serviceDate, serviceTime) {
    if (!serviceDate || !serviceTime) return;
    if (!isFutureSchedule(serviceDate, serviceTime)) {
      this.setData({ "form.scheduledAt": "" });
      return;
    }
    this.setData({ "form.scheduledAt": `${serviceDate} ${serviceTime}` });
  },

  chooseLocation() {
    wx.navigateTo({ url: "/pages/location-select/index" });
  },

  onCleanerChange(event) {
    const index = Number(event.detail.value);
    const cleaner = this.data.savedCleaners[index];
    this.setData({
      cleanerIndex: index,
      "form.assignedCleanerOpenid": cleaner ? cleaner._openid : "",
      selectedCleanerName: cleaner ? cleaner.displayName : "请选择已收藏家洁师",
    });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    const updates = { [`form.${field}`]: value };
    if (field === "note") {
      updates.selectedNeedTags = selectedTagsFromNote(value);
      updates.manualNote = manualNoteFromValue(value);
    }
    this.setData(updates);
    if (field === "areaSize") {
      this.refreshPrice();
    }
  },

  onPhoneBlur() {
    const phone = String(this.data.form.contactPhone || "").trim();
    if (phone && !PHONE_PATTERN.test(phone)) {
      toast("请输入正确手机号");
    }
  },

  toggleMoreNeedTags() {
    this.setData({ showAllNeedTags: !this.data.showAllNeedTags });
  },

  toggleNeedTag(event) {
    const tag = event.currentTarget.dataset.tag;
    const selectedNeedTags = this.data.selectedNeedTags.includes(tag)
      ? this.data.selectedNeedTags.filter((item) => item !== tag)
      : this.data.selectedNeedTags.concat(tag);
    const manualNote = this.data.manualNote || manualNoteFromValue(this.data.form.note);
    this.setData({
      selectedNeedTags,
      manualNote,
      "form.note": buildNote(manualNote, selectedNeedTags),
    });
  },

  validateForm() {
    const form = this.data.form;
    if (!form.serviceType) {
      toast("请选择服务类型");
      return false;
    }
    if (!this.data.publishMode) {
      toast("请选择预约方式");
      return false;
    }
    if (this.data.publishMode === "assigned" && !form.assignedCleanerOpenid) {
      toast("请选择家洁师");
      return false;
    }
    if (!this.data.serviceDate || !this.data.serviceTime || !form.scheduledAt) {
      toast("请选择服务时间");
      return false;
    }
    if (!isFutureSchedule(this.data.serviceDate, this.data.serviceTime)) {
      toast("请选择当前时间之后的预约时间");
      return false;
    }
    if (!form.durationHours) {
      toast("请选择服务时长");
      return false;
    }
    if (!form.community && !form.addressText) {
      toast("请选择服务地址");
      return false;
    }
    if ((form.serviceType === "深度保洁" || form.serviceType === "开荒保洁") && Number(form.areaSize) <= 0) {
      toast("请填写服务面积");
      return false;
    }
    if (!form.areaSize || Number(form.areaSize) <= 0) {
      toast("请输入服务面积");
      return false;
    }
    const phone = String(form.contactPhone || "").trim();
    if (!phone) {
      toast("请输入联系电话");
      return false;
    }
    if (!PHONE_PATTERN.test(phone)) {
      toast("请输入正确手机号");
      return false;
    }
    return true;
  },

  async submit() {
    if (this.data.submitting) return;
    if (!this.validateForm()) return;
    this.setData({ submitting: true });
    wx.showLoading({ title: "提交中" });
    try {
      const payload = {
        ...this.data.form,
        publishMode: this.data.publishMode,
      };
      const result = await callCloud("createOrder", payload);
      wx.showToast({ title: "已发布" });
      wx.navigateTo({ url: `/pages/order-detail/index?id=${result.orderId}` });
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  },

  openLegal(event) {
    const page = event.currentTarget.dataset.page;
    if (!page) return;
    wx.navigateTo({ url: `/pages/legal/${page}/index` });
  },
});
