Component({
  properties: {
    checked: {
      type: Boolean,
      value: false,
    },
  },
  methods: {
    toggle() {
      this.triggerEvent("change", { checked: !this.data.checked });
    },
  },
});
