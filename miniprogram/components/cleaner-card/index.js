Component({
  properties: {
    cleaner: {
      type: Object,
      value: {},
    },
    showBook: {
      type: Boolean,
      value: false,
    },
  },
  methods: {
    open() {
      this.triggerEvent("open", { openid: this.data.cleaner._openid });
    },
    book() {
      this.triggerEvent("book", { cleaner: this.data.cleaner });
    },
  },
});
