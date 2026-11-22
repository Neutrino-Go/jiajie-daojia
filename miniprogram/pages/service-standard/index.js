const { callCloud, showError } = require("../../utils/cloud");

function safeDecode(value) {
  try {
    return decodeURIComponent(value || "");
  } catch (error) {
    return value || "";
  }
}

Page({
  data: {
    serviceType: "",
    standards: [],
    loading: true,
  },

  onLoad(options = {}) {
    const rawServiceType = options.serviceType || "";
    const serviceType = rawServiceType ? safeDecode(rawServiceType) : "";
    this.setData({ serviceType });
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
