const { callCloud, showError } = require("../../utils/cloud");
const { decorateOrder, decorateCleaner, avatarUrlOf, avatarInitial, ratingReviewText, ratingValueText, cleanerOpenidOf } = require("../../utils/format");
const { getUserRole, requireRole, getRoleLocation, shortRoleLocationLabel } = require("../../utils/session");

const STAR_ITEMS = [1, 2, 3, 4, 5];

function ratingText(rating) {
  return ratingReviewText(rating);
}

function starItems(rating) {
  const value = Number(rating || 0);
  return STAR_ITEMS.map((index) => ({
    index,
    leftValue: index - 0.5,
    rightValue: index,
    fillPercent: value >= index ? 100 : value >= index - 0.5 ? 50 : 0,
    state: value >= index ? "full" : value >= index - 0.5 ? "half" : "empty",
  }));
}

function reviewImagesFromUrls(imageUrls) {
  return (imageUrls || []).filter(Boolean).map((url) => ({
    previewUrl: url,
    fileID: url,
    uploading: false,
    failed: false,
  }));
}

function reviewPreviewUrls(images) {
  return (images || []).map((image) => image.previewUrl || image.url || image.fileID).filter(Boolean);
}

function uploadedReviewImageUrls(images) {
  return (images || []).filter((image) => image.fileID && !image.uploading && !image.failed).map((image) => image.fileID);
}

function imageItemsFromUrls(imageUrls) {
  return (imageUrls || []).filter(Boolean).map((url) => ({
    previewUrl: url,
    fileID: url,
    uploading: false,
    failed: false,
  }));
}

function previewUrls(images) {
  return (images || []).map((image) => image.previewUrl || image.url || image.fileID).filter(Boolean);
}

function uploadedImageUrls(images) {
  return (images || []).filter((image) => image.fileID && !image.uploading && !image.failed).map((image) => image.fileID);
}

Page({
  data: {
    id: "",
    order: null,
    cleaner: null,
    review: null,
    person: null,
    contactInfo: null,
    viewerOpenid: "",
    isCustomerView: true,
    hasContact: false,
    canContact: false,
    canAccept: false,
    canDecline: false,
    canCancel: false,
    canPay: false,
    canStart: false,
    canComplete: false,
    canConfirmComplete: false,
    canReview: false,
    canEditReview: false,
    cleanerSaved: false,
    canSaveCleaner: false,
    canRepublish: false,
    canReassign: false,
    canAfterSale: false,
    canReportException: false,
    starItems: starItems(0),
    ratingHint: "请选择评分",
    ratingValueText: "",
    ratingText: "",
    isReviewEditing: false,
    isChoosingReviewImages: false,
    reviewFormDirty: false,
    reviewForm: {
      rating: 0,
      content: "",
      imageUrls: [],
      images: [],
    },
    completionForm: {
      images: [],
      imageUrls: [],
    },
    completionUploading: false,
    completionSubmitting: false,
  },

  onLoad(options) {
    this.setData({ id: options.id || "" });
  },

  onShow() {
    if (!requireRole(["customer", "cleaner"])) return;
    this.load();
  },

  async load() {
    if (!this.data.id) return;
    try {
      const data = await callCloud("getOrderDetail", { orderId: this.data.id });
      const activeRole = getUserRole();
      const referenceLocation = activeRole === "cleaner" ? getRoleLocation("cleaner") : null;
      const order = decorateOrder(
        {
          ...data.order,
          completionPhotos: data.order.completionPhotos || [],
          completionPhotoUrls: data.order.completionPhotoUrls || data.order.completionImageUrls || data.order.serviceProofImageUrls || [],
          completionImageUrls: data.order.completionPhotoUrls || data.order.completionImageUrls || data.order.serviceProofImageUrls || [],
        },
        data.viewerOpenid,
        activeRole,
        referenceLocation
      );
      const cleaner = data.cleaner ? decorateCleaner(data.cleaner) : null;
      const customerProfile = data.customerProfile || {};
      const isCustomerView = activeRole === "customer";
      const isCleanerView = activeRole === "cleaner";
      const isCustomer = order.customerOpenid === data.viewerOpenid;
      const isAcceptedCleaner = order.acceptedCleanerOpenid === data.viewerOpenid;
      const isAssignedCleaner = order.assignedCleanerOpenid === data.viewerOpenid;
      const hasResponse =
        Boolean(order.myResponse) || (order.responses || []).some((response) => response.cleanerId === data.viewerOpenid);
      const canContactStatus = ["confirmed", "accepted", "in_service", "waiting_complete", "waiting_acceptance", "completed", "auto_completed"].includes(order.status);
      const person = isCustomerView
        ? {
            name: cleaner?.displayName || "家洁师",
            avatarUrl: avatarUrlOf(cleaner),
            avatarText: cleaner?.avatarText || avatarInitial(cleaner?.displayName, "洁"),
            meta: cleaner ? `${cleaner.ratingText} · ${cleaner.reviewCount}条评价` : "订单确认后展示家洁师信息",
          }
        : {
            name: customerProfile.nickname || "住户",
            avatarUrl: avatarUrlOf(customerProfile),
            avatarText: avatarInitial(customerProfile.nickname, "客"),
            meta: order.customerMaskedPhone || "订单确认后可联系",
          };
      const contactName = isCustomerView ? person.name : person.name;
      const contactPhone = isCustomerView ? cleaner?.phone || "" : order.contactPhone || customerProfile.phone || "";
      const contactInfo = {
        visible: canContactStatus && (isCustomer || isAcceptedCleaner),
        name: contactName,
        phone: contactPhone,
        phoneText: contactPhone || "对方暂未填写手机号",
      };
      const isDeclinedAssigned =
        isCustomerView &&
        isCustomer &&
        order.status === "assigned_declined" &&
        order.publishMode === "assigned" &&
        !order.assignedCleanerOpenid;
      const review = data.review
        ? {
            ...data.review,
            content: data.review.content || "用户未填写文字评价",
            imageUrls: data.review.imageUrls || [],
            ratingText: ratingReviewText(data.review.rating),
          }
        : null;
      const canEditReview = isCustomerView && isCustomer && Boolean(data.canEditReview);
      const initialRating = canEditReview && review ? Number(review.rating || 0) : 0;
      const initialContent = canEditReview && review ? review.content || "" : "";
      const keepDraft = this.data.isChoosingReviewImages || this.data.reviewFormDirty;
      const draftForm = this.data.reviewForm || {};
      const nextReviewForm = keepDraft
        ? draftForm
        : {
            rating: initialRating,
            content: initialContent,
            imageUrls: canEditReview && review ? review.imageUrls || [] : [],
            images: canEditReview && review ? reviewImagesFromUrls(review.imageUrls || []) : [],
          };
      const nextRating = Number(nextReviewForm.rating || 0);
      if (keepDraft) {
        console.log("[order-detail] keep dirty review draft", {
          isChoosingReviewImages: this.data.isChoosingReviewImages,
          reviewFormDirty: this.data.reviewFormDirty,
          imageCount: (nextReviewForm.images || []).length || (nextReviewForm.imageUrls || []).length,
        });
      }
      this.setData({
        order,
        cleaner,
        person,
        contactInfo,
        review,
        viewerOpenid: data.viewerOpenid,
        isCustomerView,
        hasContact: contactInfo.visible,
        canContact: canContactStatus && (isCustomer || isAcceptedCleaner),
        canAccept:
          isCleanerView &&
          ((order.publishMode === "public" &&
            ["waiting_response", "waiting_confirm", "pending"].includes(order.status) &&
            !hasResponse) ||
            (["assigned_waiting_accept", "pending"].includes(order.status) && order.publishMode === "assigned" && isAssignedCleaner)),
        canDecline:
          isCleanerView &&
          ["assigned_waiting_accept", "pending"].includes(order.status) &&
          order.publishMode === "assigned" &&
          isAssignedCleaner,
        canCancel:
          isCustomerView &&
          ["waiting_response", "waiting_confirm", "assigned_waiting_accept", "assigned_declined", "waiting_payment", "confirmed", "pending"].includes(order.status) &&
          isCustomer,
        canPay: false,
        canStart: isCleanerView && (order.status === "confirmed" || order.status === "accepted") && order.paymentStatus === "escrowed" && isAcceptedCleaner,
        canComplete: isCleanerView && order.status === "in_service" && isAcceptedCleaner,
        canConfirmComplete: isCustomerView && ["waiting_complete", "waiting_acceptance"].includes(order.status) && isCustomer,
        canReview: isCustomerView && order.status === "completed" && isCustomer && !data.review,
        canEditReview,
        canSaveCleaner: isCustomerView && isCustomer && Boolean(order.acceptedCleanerOpenid),
        cleanerSaved: Boolean(data.savedCleaner),
        canRepublish: isDeclinedAssigned,
        canReassign: isDeclinedAssigned,
        canAfterSale: isCustomer || isAcceptedCleaner,
        canReportException: isCleanerView && (isAcceptedCleaner || isAssignedCleaner),
        starItems: starItems(nextRating),
        ratingHint: ratingText(nextRating),
        ratingValueText: ratingValueText(nextRating),
        ratingText: nextRating ? ratingReviewText(nextRating) : "",
        reviewForm: nextReviewForm,
      });
    } catch (error) {
      showError(error);
    }
  },

  async acceptOrder() {
    const title = this.data.order && this.data.order.publishMode === "public" ? "已响应" : "订单已确认";
    if (this.data.order && this.data.order.publishMode === "public" && this.data.order.nonLocal) {
      const orderLocation = this.data.order.locationText || "该城市";
      const cleanerLocation = shortRoleLocationLabel(getRoleLocation("cleaner"));
      wx.showModal({
        title: "此单非同城，是否接单？",
        content: `该订单位于「${orderLocation}」，你当前接单城市为「${cleanerLocation}」。跨城服务可能产生额外交通成本，请确认是否继续响应。`,
        confirmText: "继续接单",
        cancelText: "取消",
        success: async (result) => {
          if (!result.confirm) return;
          await this.mutate("acceptOrder", { orderId: this.data.id }, title);
        },
      });
      return;
    }
    await this.mutate("acceptOrder", { orderId: this.data.id }, title);
  },

  declineOrder() {
    wx.showModal({
      title: "拒绝指派",
      content: "订单会回到客户手里，不会自动取消。",
      success: async (result) => {
        if (!result.confirm) return;
        await this.mutate("declineAssignedOrder", { orderId: this.data.id }, "已拒绝");
      },
    });
  },

  async cancelOrder() {
    await this.mutate("updateOrderStatus", { orderId: this.data.id, status: "cancelled" }, "已取消");
  },

  async startOrder() {
    if (this.data.order.paymentStatus !== "escrowed") {
      wx.showToast({ title: "试运营流程待平台确认", icon: "none" });
      return;
    }
    await this.mutate("updateOrderStatus", { orderId: this.data.id, status: "in_service" }, "已开始");
  },

  async payOrder() {
    wx.showToast({ title: "支付能力待接入", icon: "none" });
  },

  openSupport() {
    wx.navigateTo({ url: `/pages/support/index?orderId=${this.data.id}` });
  },

  openProtection() {
    wx.navigateTo({ url: "/pages/protection/index" });
  },

  openServiceStandard() {
    const serviceType = encodeURIComponent((this.data.order && this.data.order.serviceType) || "");
    wx.navigateTo({ url: `/pages/service-standard/index?serviceType=${serviceType}` });
  },

  openClaimCreate() {
    wx.navigateTo({ url: `/pages/claim-create/index?orderId=${this.data.id}&type=complaint` });
  },

  openExceptionReport() {
    wx.navigateTo({ url: `/pages/claim-create/index?orderId=${this.data.id}&type=cleaner_exception` });
  },

  openClaimList() {
    wx.navigateTo({ url: `/pages/claim-list/index?orderId=${this.data.id}` });
  },

  async completeOrder() {
    if (this.data.completionSubmitting) return;
    const imageUrls = uploadedImageUrls(this.data.completionForm.images || []);
    if (this.data.completionUploading || (this.data.completionForm.images || []).some((image) => image.uploading)) {
      wx.showToast({ title: "图片仍在上传，请稍后提交", icon: "none" });
      return;
    }
    this.setData({ completionSubmitting: true });
    try {
      await callCloud("submitServiceProof", {
        orderId: this.data.id,
        completionPhotoUrls: imageUrls,
        serviceProof: { note: "" },
      });
    } catch (error) {
      this.setData({ completionSubmitting: false });
      showError(error);
      return;
    }
    await this.mutate(
      "updateOrderStatus",
      {
        orderId: this.data.id,
        status: "waiting_acceptance",
        completionPhotoUrls: imageUrls,
        completionImageUrls: imageUrls,
      },
      "已提交"
    );
    this.setData({ completionSubmitting: false });
  },

  async confirmComplete() {
    if (!this.data.reviewForm.rating) {
      wx.showToast({ title: "请先选择评分", icon: "none" });
      return;
    }
    const imageUrls = this.reviewImageUrlsForSubmit();
    if (!imageUrls) return;
    await this.mutate(
      "updateOrderStatus",
      {
        orderId: this.data.id,
        status: "completed",
        rating: this.data.reviewForm.rating,
        content: this.data.reviewForm.content,
        imageUrls,
      },
      "已完成"
    );
  },

  async selectResponse(event) {
    const cleanerId = event.currentTarget.dataset.cleanerId;
    if (!cleanerId) return;
    await this.mutate("selectOrderResponse", { orderId: this.data.id, cleanerId }, "请完成支付");
  },

  async republishPublic() {
    await this.mutate("updateOrderPublishMode", { orderId: this.data.id, publishMode: "public" }, "已改为公开");
  },

  async reassignCleaner() {
    wx.showLoading({ title: "读取收藏" });
    try {
      const cleaners = await callCloud("listSavedCleaners");
      wx.hideLoading();
      if (!cleaners.length) {
        wx.showToast({ title: "请先收藏家洁师", icon: "none" });
        return;
      }
      wx.showActionSheet({
        itemList: cleaners.map((cleaner) => cleaner.displayName || "家洁师"),
        success: async (res) => {
          const cleaner = cleaners[res.tapIndex];
          if (!cleaner) return;
          await this.mutate(
            "updateOrderPublishMode",
            {
              orderId: this.data.id,
              publishMode: "assigned",
              assignedCleanerOpenid: cleanerOpenidOf(cleaner),
            },
            "已重新指派"
          );
        },
      });
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },

  async mutate(type, data, title) {
    wx.showLoading({ title: "处理中" });
    try {
      await callCloud(type, data);
      wx.showToast({ title });
      if (type === "updateOrderStatus" || type === "submitReview") {
        this.setData({
          isReviewEditing: false,
          isChoosingReviewImages: false,
          reviewFormDirty: false,
        });
      }
      await this.load();
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },

  async openConversation() {
    if (!this.data.canContact) {
      wx.showToast({ title: "订单确认后才能联系对方", icon: "none" });
      return;
    }
    wx.showLoading({ title: "打开会话" });
    try {
      const result = await callCloud("getConversationByOrder", { orderId: this.data.id });
      wx.navigateTo({ url: `/pages/chat/index?id=${result.conversation._id}` });
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },

  callPhone() {
    const phone = this.data.contactInfo && this.data.contactInfo.phone;
    if (!phone) {
      wx.showToast({ title: "对方暂未填写手机号", icon: "none" });
      return;
    }
    wx.makePhoneCall({ phoneNumber: phone });
  },

  copyWechat() {
    if (!this.data.order.contactWechat) return;
    wx.setClipboardData({ data: this.data.order.contactWechat });
  },

  onRatingTap(event) {
    this.setReviewRating(Number(event.currentTarget.dataset.value));
  },

  onRatingTouch(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    wx.createSelectorQuery()
      .in(this)
      .select("#ratingStars")
      .boundingClientRect((rect) => {
        if (!rect || !rect.width) return;
        const raw = ((touch.clientX - rect.left) / rect.width) * 5;
        const rating = Math.max(0.5, Math.min(5, Math.ceil(raw * 2) / 2));
        this.setReviewRating(rating);
      })
      .exec();
  },

  setReviewRating(rating) {
    const value = Math.max(0.5, Math.min(5, Math.round(Number(rating || 0) * 2) / 2));
    this.setData({
      "reviewForm.rating": value,
      starItems: starItems(value),
      ratingHint: ratingText(value),
      ratingValueText: ratingValueText(value),
      ratingText: ratingReviewText(value),
      isReviewEditing: true,
      reviewFormDirty: true,
    });
  },

  onReviewInput(event) {
    this.setData({
      "reviewForm.content": event.detail.value,
      isReviewEditing: true,
      reviewFormDirty: true,
    });
  },

  chooseReviewImages() {
    const currentImages = this.currentReviewImages();
    const remain = 6 - currentImages.length;
    if (remain <= 0) {
      wx.showToast({ title: "最多上传6张照片", icon: "none" });
      return;
    }
    this.setData({
      isChoosingReviewImages: true,
    });
    wx.chooseMedia({
      count: remain,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: async (res) => {
        const files = res.tempFiles || [];
        if (!files.length) {
          this.setData({ isChoosingReviewImages: false });
          return;
        }
        const localImages = files.map((file) => ({
          previewUrl: file.tempFilePath,
          tempFilePath: file.tempFilePath,
          fileID: "",
          uploading: true,
          failed: false,
        }));
        this.setReviewImages(this.currentReviewImages().concat(localImages).slice(0, 6));
        wx.showLoading({ title: "上传中" });
        try {
          for (let index = 0; index < localImages.length; index += 1) {
            const filePath = localImages[index].tempFilePath;
            const ext = (filePath.split(".").pop() || "jpg").toLowerCase();
            const upload = await wx.cloud.uploadFile({
              cloudPath: `review-images/${this.data.id || "order"}-${Date.now()}-${index}.${ext}`,
              filePath,
            });
            const nextImages = this.currentReviewImages();
            const targetIndex = nextImages.findIndex((image) => image.tempFilePath === filePath && image.uploading);
            if (nextImages[targetIndex]) {
              nextImages[targetIndex] = {
                ...nextImages[targetIndex],
                fileID: upload.fileID,
                uploading: false,
                failed: false,
              };
              this.setReviewImages(nextImages);
            }
          }
        } catch (error) {
          console.error("review image upload failed", error);
          const nextImages = this.currentReviewImages().filter((image) => !image.uploading);
          this.setReviewImages(nextImages);
          wx.showToast({ title: "图片上传失败，请重试", icon: "none" });
        } finally {
          this.setData({ isChoosingReviewImages: false });
          wx.hideLoading();
        }
      },
      fail: () => {
        this.setData({ isChoosingReviewImages: false });
      },
    });
  },

  currentReviewImages() {
    const form = this.data.reviewForm || {};
    if (Array.isArray(form.images) && form.images.length) return form.images.slice();
    return reviewImagesFromUrls(form.imageUrls || []);
  },

  setReviewImages(images) {
    const nextImages = (images || []).slice(0, 6);
    this.setData({
      "reviewForm.images": nextImages,
      "reviewForm.imageUrls": reviewPreviewUrls(nextImages),
      isReviewEditing: true,
      reviewFormDirty: true,
    });
  },

  removeReviewImage(event) {
    const index = Number(event.currentTarget.dataset.index);
    const images = this.currentReviewImages().filter((_, currentIndex) => currentIndex !== index);
    this.setReviewImages(images);
  },

  previewReviewImage(event) {
    const current = event.currentTarget.dataset.url;
    const urls = reviewPreviewUrls(this.currentReviewImages());
    if (!current || !urls.length) return;
    wx.previewImage({ current, urls });
  },

  previewSavedReviewImage(event) {
    const current = event.currentTarget.dataset.url;
    const urls = (this.data.review && this.data.review.imageUrls) || [];
    if (!current || !urls.length) return;
    wx.previewImage({ current, urls });
  },

  chooseCompletionImages() {
    const currentImages = this.data.completionForm.images || [];
    const remain = 6 - currentImages.length;
    if (remain <= 0) {
      wx.showToast({ title: "最多上传6张照片", icon: "none" });
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: async (res) => {
        const files = res.tempFiles || [];
        if (!files.length) return;
        const localImages = files.map((file) => ({
          previewUrl: file.tempFilePath,
          tempFilePath: file.tempFilePath,
          fileID: "",
          uploading: true,
          failed: false,
        }));
        this.setCompletionImages(currentImages.concat(localImages).slice(0, 6));
        wx.showLoading({ title: "上传中" });
        this.setData({ completionUploading: true });
        try {
          for (let index = 0; index < localImages.length; index += 1) {
            const filePath = localImages[index].tempFilePath;
            const ext = (filePath.split(".").pop() || "jpg").toLowerCase();
            const upload = await wx.cloud.uploadFile({
              cloudPath: `completion-images/${this.data.id || "order"}-${Date.now()}-${index}.${ext}`,
              filePath,
            });
            const nextImages = (this.data.completionForm.images || []).slice();
            const targetIndex = nextImages.findIndex((image) => image.tempFilePath === filePath && image.uploading);
            if (targetIndex >= 0) {
              nextImages[targetIndex] = {
                ...nextImages[targetIndex],
                fileID: upload.fileID,
                uploading: false,
                failed: false,
              };
              this.setCompletionImages(nextImages);
            }
          }
        } catch (error) {
          console.error("completion image upload failed", error);
          this.setCompletionImages((this.data.completionForm.images || []).filter((image) => !image.uploading));
          wx.showToast({ title: "图片上传失败，请重试", icon: "none" });
        } finally {
          this.setData({ completionUploading: false });
          wx.hideLoading();
        }
      },
    });
  },

  setCompletionImages(images) {
    const nextImages = (images || []).slice(0, 6);
    this.setData({
      "completionForm.images": nextImages,
      "completionForm.imageUrls": previewUrls(nextImages),
    });
  },

  removeCompletionImage(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setCompletionImages((this.data.completionForm.images || []).filter((_, currentIndex) => currentIndex !== index));
  },

  previewCompletionImage(event) {
    const current = event.currentTarget.dataset.url;
    const urls = previewUrls(this.data.completionForm.images || []);
    if (!current || !urls.length) return;
    wx.previewImage({ current, urls });
  },

  previewCompletionRecordImage(event) {
    const current = event.currentTarget.dataset.url;
    const urls = (this.data.order && (this.data.order.completionPhotoUrls || this.data.order.completionImageUrls)) || [];
    if (!current || !urls.length) return;
    wx.previewImage({ current, urls });
  },

  async submitReview() {
    if (!this.data.reviewForm.rating) {
      wx.showToast({ title: "请先选择评分", icon: "none" });
      return;
    }
    const imageUrls = this.reviewImageUrlsForSubmit();
    if (!imageUrls) return;
    await this.mutate(
      "submitReview",
      {
        orderId: this.data.id,
        rating: this.data.reviewForm.rating,
        content: this.data.reviewForm.content,
        imageUrls,
      },
      this.data.canEditReview ? "已修改评价" : "已评价"
    );
  },

  reviewImageUrlsForSubmit() {
    const images = this.currentReviewImages();
    if (images.some((image) => image.uploading)) {
      wx.showToast({ title: "图片仍在上传，请稍后提交", icon: "none" });
      return null;
    }
    return uploadedReviewImageUrls(images);
  },

  async saveCleaner() {
    if (!this.data.order.acceptedCleanerOpenid) return;
    wx.showLoading({ title: "处理中" });
    try {
      const result = await callCloud("saveCleaner", {
        cleanerOpenid: this.data.order.acceptedCleanerOpenid,
        saved: !this.data.cleanerSaved,
      });
      this.setData({ cleanerSaved: result.saved });
      wx.showToast({ title: result.saved ? "已收藏" : "已取消" });
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },
});
