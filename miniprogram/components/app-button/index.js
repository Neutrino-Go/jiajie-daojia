Component({
  properties: {
    variant: {
      type: String,
      value: "primary",
    },
    block: {
      type: Boolean,
      value: false,
    },
  },
  methods: {
    tap() {
      this.triggerEvent("tap");
    },
  },
});
