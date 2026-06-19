const { callCloud } = require("../../utils/cloud");

Page({
  data: {
    loading: false,
    submitting: false,
    verification: null,
    badges: null,
    form: {
      realName: "",
      idCard: "",
      phone: "",
      healthCertificateFileID: "",
      trainingStatus: "submitted",
      note: "",
    },
    error: "",
  },

  onLoad() {
    this.loadVerification();
  },

  async loadVerification() {
    this.setData({ loading: true, error: "" });
    try {
      const result = await callCloud("getMyCleanerVerification", {});
      this.setData({
        verification: result.verification || null,
        badges: result.badges || null,
      });
    } catch (error) {
      this.setData({ error: error.message || "准入资料加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`form.${field}`]: event.detail.value || "" });
  },

  async submit() {
    this.setData({ submitting: true, error: "" });
    try {
      const result = await callCloud("submitCleanerVerification", {
        ...this.data.form,
      });
      this.setData({ verification: result.verification || null });
      wx.showToast({ title: "已提交", icon: "success" });
    } catch (error) {
      this.setData({ error: error.message || "提交失败" });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
