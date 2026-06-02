const { callCloud, showError } = require("../../utils/cloud");

Page({
  data: {
    orderId: "",
    form: {
      type: "service",
      orderNo: "",
      description: "",
    },
    images: [],
    submitting: false,
  },

  onLoad(options = {}) {
    this.setData({
      orderId: options.orderId || "",
      "form.type": options.type || "service",
    });
  },

  onTypeChange(event) {
    const values = ["service", "order", "feedback", "privacy"];
    this.setData({ "form.type": values[Number(event.detail.value || 0)] || "service" });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  chooseImages() {
    wx.chooseImage({
      count: Math.max(0, 3 - this.data.images.length),
      sourceType: ["album", "camera"],
      success: (result) => {
        const next = (result.tempFilePaths || []).map((filePath) => ({ filePath, uploading: false, fileID: "" }));
        this.setData({ images: this.data.images.concat(next).slice(0, 3) });
      },
    });
  },

  removeImage(event) {
    const index = Number(event.currentTarget.dataset.index);
    const images = this.data.images.slice();
    images.splice(index, 1);
    this.setData({ images });
  },

  async uploadImages() {
    const uploaded = [];
    for (const image of this.data.images) {
      if (image.fileID) {
        uploaded.push(image.fileID);
        continue;
      }
      const upload = await wx.cloud.uploadFile({
        cloudPath: `support/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`,
        filePath: image.filePath,
      });
      if (upload.fileID) uploaded.push(upload.fileID);
    }
    return uploaded;
  },

  async submit() {
    const description = String(this.data.form.description || "").trim();
    if (!description) {
      wx.showToast({ title: "请填写问题描述", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: "提交中" });
    try {
      const imageUrls = await this.uploadImages();
      await callCloud("createSupportTicket", {
        type: this.data.form.type,
        orderId: this.data.orderId,
        orderNo: this.data.form.orderNo,
        description,
        imageUrls,
      });
      wx.showToast({ title: "已提交" });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  },
});
