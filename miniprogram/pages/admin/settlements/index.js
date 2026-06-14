const { callCloud } = require("../../../utils/cloud");

Page({
  data: { loading: false, summary: null, error: "" },
  onLoad() {
    this.loadSummary();
  },
  async loadSummary() {
    this.setData({ loading: true, error: "" });
    try {
      const result = await callCloud("adminListDashboardSummary", {});
      this.setData({ summary: result.summary || null });
    } catch (error) {
      this.setData({ error: error.message || "结算信息加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
