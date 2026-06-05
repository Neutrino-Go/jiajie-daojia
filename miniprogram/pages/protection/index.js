const { callCloud, showError } = require("../../utils/cloud");

Page({
  data: {
    plans: [],
    loading: true,
  },

  onLoad() {
    this.load();
  },

  async load() {
    try {
      const data = await callCloud("getProtectionPlans");
      this.setData({ plans: data.plans || [], loading: false });
    } catch (error) {
      showError(error);
      this.setData({ loading: false });
    }
  },
});
