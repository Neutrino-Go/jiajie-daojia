const { callCloud, showError } = require("../../utils/cloud");

Page({
  data: {
    serviceType: "",
    standards: [],
    loading: true,
  },

  onLoad(options = {}) {
    this.setData({ serviceType: options.serviceType || "" });
    this.load();
  },

  async load() {
    try {
      const data = await callCloud("getServiceStandards", { serviceType: this.data.serviceType });
      this.setData({ standards: data.standards || [], loading: false });
    } catch (error) {
      showError(error);
      this.setData({ loading: false });
    }
  },
});
