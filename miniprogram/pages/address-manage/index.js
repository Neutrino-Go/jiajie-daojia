const { callCloud, showError } = require("../../utils/cloud");
const { requireRole, getCurrentLocation, setCurrentLocation, locationFullText } = require("../../utils/session");

const EMPTY_FORM = {
  _id: "",
  province: "浙江省",
  city: "杭州市",
  district: "西湖区",
  street: "",
  community: "",
  detailAddress: "",
  latitude: null,
  longitude: null,
  isDefault: false,
};

function toRegion(address) {
  return [address.province || "浙江省", address.city || "杭州市", address.district || "西湖区"];
}

function decorateAddress(address) {
  return {
    ...address,
    areaText: [address.province, address.city, address.district, address.street].filter(Boolean).join(" "),
    fullText: locationFullText(address),
  };
}

function formFromAddress(address) {
  return {
    ...EMPTY_FORM,
    ...address,
    province: address.province || EMPTY_FORM.province,
    city: address.city || EMPTY_FORM.city,
    district: address.district || EMPTY_FORM.district,
    isDefault: Boolean(address.isDefault),
  };
}

Page({
  data: {
    loading: false,
    addresses: [],
    formVisible: false,
    formMode: "add",
    form: { ...EMPTY_FORM },
    region: toRegion(EMPTY_FORM),
  },

  onShow() {
    if (!requireRole("customer")) return;
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const addresses = await callCloud("listUserAddresses");
      const decorated = addresses.map(decorateAddress);
      this.setData({ addresses: decorated });
      this.syncDefaultLocation(decorated);
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  syncDefaultLocation(addresses) {
    const target = addresses.find((item) => item.isDefault);
    if (target) {
      setCurrentLocation(target);
    }
  },

  openAddForm() {
    const current = getCurrentLocation();
    const form = formFromAddress({
      province: current.province,
      city: current.city,
      district: current.district,
      street: current.street,
      community: current.community,
      detailAddress: current.detailAddress,
      latitude: current.latitude,
      longitude: current.longitude,
      isDefault: this.data.addresses.length === 0,
    });
    this.setData({
      formVisible: true,
      formMode: "add",
      form,
      region: toRegion(form),
    });
  },

  editAddress(event) {
    const address = this.data.addresses[Number(event.currentTarget.dataset.index)];
    if (!address) return;
    const form = formFromAddress(address);
    this.setData({
      formVisible: true,
      formMode: "edit",
      form,
      region: toRegion(form),
    });
  },

  closeForm() {
    this.setData({ formVisible: false });
  },

  noop() {},

  onRegionChange(event) {
    const [province, city, district] = event.detail.value;
    this.setData({
      region: event.detail.value,
      "form.province": province,
      "form.city": city,
      "form.district": district,
    });
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  onDefaultChange(event) {
    this.setData({ "form.isDefault": event.detail.value });
  },

  async submitForm() {
    if (!this.data.form.community.trim()) {
      wx.showToast({ title: "请填写小区/社区名称", icon: "none" });
      return;
    }
    if (!this.data.form.detailAddress.trim()) {
      wx.showToast({ title: "请填写详细地址", icon: "none" });
      return;
    }
    wx.showLoading({ title: "保存中" });
    try {
      const addresses = await callCloud("saveUserAddress", this.data.form);
      const decorated = addresses.map(decorateAddress);
      this.setData({ addresses: decorated, formVisible: false });
      this.syncDefaultLocation(decorated);
      wx.showToast({ title: "已保存" });
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },

  async selectAddress(event) {
    const address = this.data.addresses[Number(event.currentTarget.dataset.index)];
    if (!address) return;
    wx.showLoading({ title: "选择中" });
    try {
      const addresses = await callCloud("setDefaultUserAddress", { addressId: address._id });
      const decorated = addresses.map(decorateAddress);
      this.setData({ addresses: decorated });
      setCurrentLocation(address);
      wx.showToast({ title: "已选择" });
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },

  async setDefault(event) {
    const address = this.data.addresses[Number(event.currentTarget.dataset.index)];
    if (!address || address.isDefault) return;
    wx.showLoading({ title: "设置中" });
    try {
      const addresses = await callCloud("setDefaultUserAddress", { addressId: address._id });
      const decorated = addresses.map(decorateAddress);
      this.setData({ addresses: decorated });
      setCurrentLocation(address);
      wx.showToast({ title: "已设为默认" });
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },

  deleteAddress(event) {
    const address = this.data.addresses[Number(event.currentTarget.dataset.index)];
    if (!address) return;
    wx.showModal({
      title: "删除地址",
      content: `确定删除 ${address.community} 吗？`,
      confirmText: "删除",
      confirmColor: "#d93025",
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: "删除中" });
        try {
          const addresses = await callCloud("deleteUserAddress", { addressId: address._id });
          const decorated = addresses.map(decorateAddress);
          this.setData({ addresses: decorated });
          this.syncDefaultLocation(decorated);
          wx.showToast({ title: "已删除" });
        } catch (error) {
          showError(error);
        } finally {
          wx.hideLoading();
        }
      },
    });
  },
});
