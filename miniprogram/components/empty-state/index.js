Component({
  properties: {
    title: {
      type: String,
      value: "暂无内容",
    },
    tip: {
      type: String,
      value: "",
    },
    image: {
      type: String,
      value: "/images/brand/brand-logo.png",
    },
    actionText: {
      type: String,
      value: "",
    },
  },
  methods: {
    action() {
      this.triggerEvent("action");
    },
  },
});
