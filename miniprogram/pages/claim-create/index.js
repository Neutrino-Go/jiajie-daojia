const { callCloud, showError } = require("../../utils/cloud");

const CLAIM_TYPES = ["rework", "refund", "complaint", "property_damage", "cleaner_exception", "safety_risk", "other"];
const CLAIM_LABELS = ["返工协商", "退款/补偿申请", "投诉反馈", "财损报备", "家洁师异常报备", "安全风险", "其他"];

Page({
  data: {
    orderId: "",
    typeIndex: 0,
    claimTypes: CLAIM_TYPES,
    claimLabels: CLAIM_LABELS,
    description: "",
    requestedAmount: "",
    imageFileIDsText: "",
    submitting: false,
    refundNotice: "当前支付能力待接入，退款/补偿需由平台人工确认处理。",
  },

  onLoad(options = {}) {
    const type = options.type || "complaint";
    const index = Math.max(0, CLAIM_TYPES.indexOf(type));
    this.setData({ orderId: options.orderId || "", typeIndex: index });
  },

  onTypeChange(event) {
    this.setData({ typeIndex: Number(event.detail.value || 0) });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [field]: event.detail.value });
  },

  imageFileIDs() {
    return String(this.data.imageFileIDsText || "")
      .split(/[\n,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6);
  },

  async submit() {
    const description = String(this.data.description || "").trim();
    if (!description) {
      wx.showToast({ title: "请填写问题描述", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: "提交中" });
    try {
      const claimType = CLAIM_TYPES[this.data.typeIndex] || "complaint";
      const action = claimType === "cleaner_exception" ? "reportCleanerException" : "createProtectionClaim";
      const result = await callCloud(action, {
        orderId: this.data.orderId,
        claimType,
        description,
        requestedAmount: this.data.requestedAmount,
        imageFileIDs: this.imageFileIDs(),
      });
      wx.showToast({ title: "已提交" });
      setTimeout(() => {
        wx.redirectTo({ url: `/pages/claim-detail/index?id=${result.claimId}` });
      }, 500);
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  },
});
