let hasLoggedOrderCardDisplay = false;

Component({
  properties: {
    order: {
      type: Object,
      value: {},
    },
    role: {
      type: String,
      value: "customer",
    },
    actions: {
      type: Array,
      value: [],
    },
  },
  observers: {
    order(order) {
      if (hasLoggedOrderCardDisplay || !order || !order._id) return;
      hasLoggedOrderCardDisplay = true;
      console.log("[order-card display]", {
        orderId: order._id,
        statusBadgeText: order.statusBadgeText,
        statusStyle: order.statusStyle,
        reviewBadgeText: order.reviewBadgeText,
        distanceDisplayText: order.distanceDisplayText,
      });
    },
  },
  methods: {
    open() {
      this.triggerEvent("open", { id: this.data.order._id });
    },
    action(event) {
      const action = event.currentTarget.dataset.action;
      this.triggerEvent("action", { action, id: this.data.order._id });
    },
    more() {
      this.triggerEvent("more", { id: this.data.order._id });
    },
  },
});
