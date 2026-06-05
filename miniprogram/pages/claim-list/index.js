const { callCloud, showError } = require("../../utils/cloud");

function claimTitle(claim) {
  const map = {
    rework: "返工协商",
    refund: "退款/补偿申请",
    complaint: "投诉反馈",
    property_damage: "财损报备",
    cleaner_exception: "家洁师异常报备",
    safety_risk: "安全风险",
    other: "其他",
  };
  return map[claim.claimType] || "售后工单";
}

Page({
  data: {
    orderId: "",
    claims: [],
    loading: true,
  },

  onLoad(options = {}) {
    this.setData({ orderId: options.orderId || "" });
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const data = await callCloud("listMyProtectionClaims", { orderId: this.data.orderId });
      const claims = (data.claims || []).map((claim) => ({
        ...claim,
        title: claimTitle(claim),
      }));
      this.setData({ claims, loading: false });
    } catch (error) {
      showError(error);
      this.setData({ loading: false });
    }
  },

  openClaim(event) {
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/claim-detail/index?id=${id}` });
  },
});
