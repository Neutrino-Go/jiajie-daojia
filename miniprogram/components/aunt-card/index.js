const { cleanerOpenidOf } = require("../../utils/format");

Component({
  properties: {
    cleaner: {
      type: Object,
      value: {},
    },
  },
  methods: {
    open() {
      this.triggerEvent("open", { openid: cleanerOpenidOf(this.data.cleaner) });
    },
  },
});
