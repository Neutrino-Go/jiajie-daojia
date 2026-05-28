Component({
  properties: {
    title: String,
    desc: String,
    icon: String,
    theme: String,
  },
  methods: {
    tap() {
      this.triggerEvent("tap");
    },
  },
});
