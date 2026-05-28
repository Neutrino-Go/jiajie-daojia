const { callCloud, showError } = require("../../utils/cloud");
const { decorateCleaner } = require("../../utils/format");
const { SERVICE_TYPES } = require("../../utils/constants");
const { getUserRole, requireRole } = require("../../utils/session");

Page({
  data: {
    openid: "",
    mode: "",
    cleaner: null,
    recentReviews: [],
    saved: false,
    canEdit: false,
    isCustomerViewer: false,
    serviceOptions: SERVICE_TYPES,
    serviceChoices: [],
    areaInput: "",
    editForm: {
      serviceAreas: [],
      serviceTypes: [],
    },
  },

  onLoad(options) {
    this.setData({ openid: options.openid || "", mode: options.mode || "" });
  },

  onShow() {
    if (!requireRole(["customer", "cleaner"])) return;
    this.load();
  },

  async load() {
    if (!this.data.openid) return;
    try {
      const data = await callCloud("getCleanerDetail", { cleanerOpenid: this.data.openid });
      const cleaner = decorateCleaner(data.cleaner);
      const currentRole = getUserRole();
      const canEdit = currentRole === "cleaner" && this.data.mode !== "view" && Boolean(data.canEdit);
      const isCustomerViewer = currentRole === "customer";
      this.setData({
        cleaner,
        recentReviews: (data.recentReviews || []).map((review) => ({
          ...review,
          imageUrls: review.imageUrls || [],
          timeText: String(review.updatedAt || review.createdAt || "").slice(0, 10),
        })),
        saved: data.saved,
        canEdit,
        isCustomerViewer,
        editForm: {
          serviceAreas: cleaner.serviceAreas || [],
          serviceTypes: cleaner.serviceTypes || [],
        },
      });
      this.refreshChoices();
    } catch (error) {
      showError(error);
    }
  },

  toggleArea(event) {
    if (!this.data.canEdit) return;
    this.removeArea(event);
  },

  toggleService(event) {
    if (!this.data.canEdit) return;
    this.toggleMultiValue("serviceTypes", event.currentTarget.dataset.value);
  },

  toggleMultiValue(field, value) {
    const current = this.data.editForm[field] || [];
    const next = current.includes(value) ? current.filter((item) => item !== value) : current.concat(value);
    this.setData({ [`editForm.${field}`]: next });
    this.refreshChoices();
  },

  refreshChoices() {
    const selectedServices = this.data.editForm.serviceTypes || [];
    this.setData({
      serviceChoices: this.data.serviceOptions.map((name) => ({ name, selected: selectedServices.includes(name) })),
    });
  },

  onAreaInput(event) {
    this.setData({ areaInput: event.detail.value });
  },

  addArea() {
    const value = this.data.areaInput.trim();
    if (!value) {
      wx.showToast({ title: "请输入小区名称", icon: "none" });
      return;
    }
    const current = this.data.editForm.serviceAreas || [];
    if (current.includes(value)) {
      this.setData({ areaInput: "" });
      return;
    }
    this.setData({
      "editForm.serviceAreas": current.concat(value).slice(0, 12),
      areaInput: "",
    });
  },

  removeArea(event) {
    const value = event.currentTarget.dataset.value;
    const next = (this.data.editForm.serviceAreas || []).filter((item) => item !== value);
    this.setData({ "editForm.serviceAreas": next });
  },

  async saveAll() {
    await this.saveProfile(this.data.editForm);
  },

  async saveProfile(payload) {
    wx.showLoading({ title: "保存中" });
    try {
      const result = await callCloud("updateCleanerProfile", payload);
      const cleaner = decorateCleaner(result.cleaner);
      this.setData({
        cleaner,
        editForm: {
          serviceAreas: cleaner.serviceAreas || [],
          serviceTypes: cleaner.serviceTypes || [],
        },
      });
      this.refreshChoices();
      wx.showToast({ title: "已保存" });
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },

  async toggleSave() {
    wx.showLoading({ title: "处理中" });
    try {
      const result = await callCloud("saveCleaner", {
        cleanerOpenid: this.data.openid,
        saved: !this.data.saved,
      });
      this.setData({ saved: result.saved });
      wx.showToast({ title: result.saved ? "已收藏" : "已取消" });
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },

  bookAgain() {
    wx.navigateTo({ url: `/pages/order-create/index?cleanerOpenid=${this.data.openid}` });
  },

  previewReviewImage(event) {
    const current = event.currentTarget.dataset.url;
    const index = Number(event.currentTarget.dataset.index);
    const urls = (this.data.recentReviews[index] && this.data.recentReviews[index].imageUrls) || [];
    if (!current || !urls.length) return;
    wx.previewImage({ current, urls });
  },
});
