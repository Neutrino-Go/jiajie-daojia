Component({
  properties: {
    conversation: {
      type: Object,
      value: {},
    },
  },
  methods: {
    open() {
      this.triggerEvent("open", { id: this.data.conversation._id });
    },
  },
});
