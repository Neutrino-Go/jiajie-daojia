Component({
  properties: {
    cleaner: {
      type: Object,
      value: {},
    },
  },
  methods: {
    open() {
      this.triggerEvent("open", { openid: this.data.cleaner._openid });
    },
  },
});
