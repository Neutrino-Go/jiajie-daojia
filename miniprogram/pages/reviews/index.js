const { callCloud, showError } = require("../../utils/cloud");
const { getUserRole, requireRole } = require("../../utils/session");
const { shortDate } = require("../../utils/format");

Page({
  data: {
    loading: true,
    isCleaner: false,
    reviews: [],
  },

  onShow() {
    if (!requireRole(["customer", "cleaner"])) return;
    this.setData({ isCleaner: getUserRole() === "cleaner" });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      if (!this.data.isCleaner) {
        this.setData({ reviews: [] });
        return;
      }
      const reviews = await callCloud("listReceivedReviews");
      this.setData({
        reviews: reviews.map((review) => ({
          ...review,
          imageUrls: review.imageUrls || [],
          ratingText: Number(review.rating || 0).toFixed(1),
          timeText: shortDate(review.createdAt),
        })),
      });
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  goCleaners() {
    wx.navigateTo({ url: "/pages/cleaner-list/index" });
  },

  previewImage(event) {
    const current = event.currentTarget.dataset.url;
    const index = Number(event.currentTarget.dataset.index);
    const urls = (this.data.reviews[index] && this.data.reviews[index].imageUrls) || [];
    if (!current || !urls.length) return;
    wx.previewImage({ current, urls });
  },
});
