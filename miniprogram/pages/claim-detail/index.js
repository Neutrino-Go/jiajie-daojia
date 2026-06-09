const { callCloud, showError } = require("../../utils/cloud");
const { decorateOrder } = require("../../utils/format");
const { getUserRole, getRoleLocation } = require("../../utils/session");

Page({
  data: {
    id: "",
    claim: null,
    order: null,
    loading: true,
  },

  onLoad(options = {}) {
    this.setData({ id: options.id || "" });
    this.load();
  },

  async load() {
    try {
      const data = await callCloud("getProtectionClaimDetail", { claimId: this.data.id });
      const role = getUserRole();
      const order = data.order ? decorateOrder(data.order, "", role, role === "cleaner" ? getRoleLocation("cleaner") : null) : null;
      this.setData({ claim: data.claim, order, loading: false });
    } catch (error) {
      showError(error);
      this.setData({ loading: false });
    }
  },
});
