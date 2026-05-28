Component({
  properties: {
    label: {
      type: String,
      value: "请选择地址",
    },
  },
  methods: {
    tap() {
      this.triggerEvent("tap");
    },
  },
});
