const { callCloud } = require("../../../utils/cloud");

Page({
  data: { loading: false, verifications: [], error: "" },
  onLoad() {
    this.loadVerifications();
  },
  async loadVerifications() {
    this.setData({ loading: true, error: "" });
    try {
      const result = await callCloud("adminListCleanerVerifications", {});
      this.setData({ verifications: result.verifications || [] });
    } catch (error) {
      this.setData({ error: error.message || "家洁师准入列表加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
