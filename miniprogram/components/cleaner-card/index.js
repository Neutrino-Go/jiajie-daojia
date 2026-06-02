const { cleanerOpenidOf } = require("../../utils/format");

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
      this.triggerEvent("open", { openid: cleanerOpenidOf(this.data.cleaner) });
    },
    book() {
      this.triggerEvent("book", { cleaner: this.data.cleaner });
    },
  },
});
