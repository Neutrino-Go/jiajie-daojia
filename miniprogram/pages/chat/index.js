const { callCloud, showError } = require("../../utils/cloud");
const { requireRole } = require("../../utils/session");
const { shortDate } = require("../../utils/format");

function extFromPath(path, fallback) {
  const match = String(path || "").match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  return match ? match[1].toLowerCase() : fallback;
}

function uploadMedia(filePath, folder, fallbackExt) {
  const ext = extFromPath(filePath, fallbackExt);
  return wx.cloud.uploadFile({
    cloudPath: `${folder}/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`,
    filePath,
  });
}

function isCloudFileID(url) {
  return String(url || "").startsWith("cloud://");
}

function voiceDurationText(duration) {
  return duration ? `${duration}"` : "";
}

Page({
  data: {
    id: "",
    conversation: null,
    messages: [],
    input: "",
    openid: "",
    emojiOpen: false,
    recording: false,
    recordingText: "点击麦克风结束录音",
    sendingVoiceLocalId: "",
    playingVoiceId: "",
    emojis: ["😊", "😄", "👍", "❤️", "🙏"],
  },

  recorder: null,
  audio: null,
  recordStartAt: 0,
  voiceUrlCache: {},
  unloaded: false,

  onLoad(options) {
    this.unloaded = false;
    this.setData({ id: options.id || "" });
    this.recorder = wx.getRecorderManager ? wx.getRecorderManager() : null;
    this.audio = wx.createInnerAudioContext ? wx.createInnerAudioContext() : null;
    if (this.recorder) {
      this.recorder.onStop((res) => this.handleRecordStop(res));
      this.recorder.onError((error) => {
        console.error("voice record failed", error);
        this.setData({ recording: false });
        wx.showToast({ title: "语音发送失败，请重试", icon: "none" });
      });
    }
    if (this.audio) {
      this.audio.obeyMuteSwitch = false;
      this.audio.onEnded(() => this.clearPlayingVoice());
      this.audio.onStop(() => this.clearPlayingVoice());
      this.audio.onError((error) => {
        console.error("voice play failed", error);
        this.clearPlayingVoice();
        wx.showToast({ title: "语音加载失败，请稍后重试", icon: "none" });
      });
    }
  },

  onUnload() {
    this.unloaded = true;
    if (this.recorder && this.data.recording) this.recorder.stop();
    if (this.audio) {
      this.audio.stop();
      this.audio.destroy();
      this.audio = null;
    }
  },

  onHide() {
    if (this.audio) this.audio.stop();
    this.clearPlayingVoice();
  },

  onShow() {
    if (!requireRole(["customer", "cleaner"])) return;
    this.load();
  },

  async load() {
    if (!this.data.id) return;
    try {
      const login = await callCloud("login");
      const result = await callCloud("listMessages", { conversationId: this.data.id });
      const conversation = result.conversation;
      const remoteMessages = (result.messages || []).map((message) => ({
        ...message,
        mine: message.type !== "order_card" && message.senderOpenid === login.openid,
        voiceFileID: message.voiceFileID || message.fileID || message.voiceUrl || "",
        timeText: shortDate(message.createdAt),
        durationText: voiceDurationText(message.duration),
        avatarUrl:
          message.senderOpenid === conversation.customerOpenid
            ? conversation.customerAvatarUrl
            : conversation.cleanerAvatarUrl,
        avatarText:
          message.senderOpenid === conversation.customerOpenid
            ? conversation.customerAvatarText
            : conversation.cleanerAvatarText,
      }));
      const localMessages = this.data.messages.filter(
        (message) => message.localOnly && (message.sendStatus === "sending" || message.sendStatus === "failed")
      );
      this.setData({
        openid: login.openid,
        conversation,
        messages: remoteMessages.concat(localMessages),
      });
    } catch (error) {
      showError(error);
    }
  },

  onInput(event) {
    this.setData({ input: event.detail.value });
  },

  toggleEmoji() {
    this.setData({ emojiOpen: !this.data.emojiOpen });
  },

  pickEmoji(event) {
    const emoji = event.currentTarget.dataset.emoji || "";
    this.setData({ input: `${this.data.input}${emoji}` });
  },

  async sendMediaMessage(payload, loadingTitle, errorTitle) {
    wx.showLoading({ title: loadingTitle });
    try {
      await callCloud("sendMessage", { conversationId: this.data.id, ...payload });
      await this.load();
    } catch (error) {
      wx.showToast({ title: errorTitle, icon: "none" });
      console.error(error);
    } finally {
      wx.hideLoading();
    }
  },

  chooseImage() {
    const success = async (filePath) => {
      try {
        wx.showLoading({ title: "发送中" });
        const upload = await uploadMedia(filePath, "chat-images", "jpg");
        wx.hideLoading();
        await this.sendMediaMessage({ type: "image", imageUrl: upload.fileID }, "发送中", "图片发送失败，请重试");
      } catch (error) {
        wx.hideLoading();
        wx.showToast({ title: "图片发送失败，请重试", icon: "none" });
        console.error(error);
      }
    };
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success: (res) => {
          const file = res.tempFiles && res.tempFiles[0];
          if (file && file.tempFilePath) success(file.tempFilePath);
        },
        fail: () => {},
      });
      return;
    }
    wx.chooseImage({
      count: 1,
      sourceType: ["album", "camera"],
      success: (res) => {
        const filePath = res.tempFilePaths && res.tempFilePaths[0];
        if (filePath) success(filePath);
      },
      fail: () => {},
    });
  },

  toggleVoiceRecording() {
    if (this.data.recording) {
      this.stopVoice();
      return;
    }
    this.startVoice();
  },

  startVoice() {
    if (!this.recorder) {
      wx.showToast({ title: "当前微信版本不支持录音", icon: "none" });
      return;
    }
    this.setData({ recording: true, recordingText: "点击麦克风结束录音" });
    this.recordStartAt = Date.now();
    this.recorder.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: "mp3",
    });
  },

  stopVoice() {
    if (!this.recorder || !this.data.recording) return;
    this.recorder.stop();
  },

  async handleRecordStop(res) {
    if (this.unloaded) return;
    this.setData({ recording: false });
    const filePath = res.tempFilePath;
    const duration = Math.max(1, Math.round((res.duration || Date.now() - this.recordStartAt) / 1000));
    if (!filePath) {
      wx.showToast({ title: "语音发送失败，请重试", icon: "none" });
      return;
    }
    const localId = `voice-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.addLocalVoiceMessage({ localId, tempFilePath: filePath, duration, sendStatus: "sending" });
    await this.uploadAndSendVoice({ localId, tempFilePath: filePath, duration });
  },

  addLocalVoiceMessage({ localId, tempFilePath, duration, sendStatus }) {
    const conversation = this.data.conversation || {};
    const isCustomer = this.data.openid === conversation.customerOpenid;
    const message = {
      _id: localId,
      localId,
      localOnly: true,
      type: "voice",
      mine: true,
      tempFilePath,
      voiceUrl: tempFilePath,
      duration,
      durationText: voiceDurationText(duration),
      timeText: "刚刚",
      sendStatus,
      avatarUrl: isCustomer ? conversation.customerAvatarUrl : conversation.cleanerAvatarUrl,
      avatarText: isCustomer ? conversation.customerAvatarText : conversation.cleanerAvatarText,
    };
    this.setData({ messages: this.data.messages.concat(message) });
  },

  updateLocalVoiceMessage(localId, patch) {
    this.setData({
      messages: this.data.messages.map((message) => (message.localId === localId ? { ...message, ...patch } : message)),
    });
  },

  removeLocalVoiceMessage(localId) {
    this.setData({ messages: this.data.messages.filter((message) => message.localId !== localId) });
  },

  async uploadAndSendVoice({ localId, tempFilePath, duration }) {
    this.setData({ sendingVoiceLocalId: localId });
    this.updateLocalVoiceMessage(localId, { sendStatus: "sending" });
    try {
      wx.showLoading({ title: "发送中" });
      const upload = await uploadMedia(tempFilePath, "chat-voices", "mp3");
      wx.hideLoading();
      await callCloud("sendMessage", {
        conversationId: this.data.id,
        type: "voice",
        fileID: upload.fileID,
        voiceFileID: upload.fileID,
        voiceUrl: upload.fileID,
        duration,
      });
      this.removeLocalVoiceMessage(localId);
      await this.load();
    } catch (error) {
      wx.hideLoading();
      this.updateLocalVoiceMessage(localId, { sendStatus: "failed" });
      wx.showToast({ title: "发送失败", icon: "none" });
      console.error(error);
    } finally {
      this.setData({ sendingVoiceLocalId: "" });
    }
  },

  retryVoiceMessage(event) {
    const localId = event.currentTarget.dataset.localId;
    const message = this.data.messages.find((item) => item.localId === localId);
    if (!message || !message.tempFilePath) return;
    this.uploadAndSendVoice({
      localId,
      tempFilePath: message.tempFilePath,
      duration: Number(message.duration || 1),
    });
  },

  async resolveVoiceUrl(message) {
    const localUrl = message.tempFilePath || "";
    if (localUrl) return localUrl;
    const source = message.voiceFileID || message.fileID || message.voiceUrl || "";
    if (!source) return "";
    if (!isCloudFileID(source)) return source;
    if (this.voiceUrlCache[source]) return this.voiceUrlCache[source];
    const result = await wx.cloud.getTempFileURL({ fileList: [source] });
    const item = result.fileList && result.fileList[0];
    const tempFileURL = item && item.tempFileURL;
    if (!tempFileURL) return "";
    this.voiceUrlCache[source] = tempFileURL;
    return tempFileURL;
  },

  async playVoice(event) {
    const id = event.currentTarget.dataset.id;
    const message = this.data.messages.find((item) => item._id === id || item.localId === id);
    if (!message || !this.audio) return;
    if (this.data.playingVoiceId === id) {
      this.audio.stop();
      this.clearPlayingVoice();
      return;
    }
    try {
      const url = await this.resolveVoiceUrl(message);
      if (!url) throw new Error("missing voice url");
      this.audio.stop();
      this.setData({ playingVoiceId: id });
      this.audio.src = url;
      this.audio.play();
    } catch (error) {
      this.clearPlayingVoice();
      wx.showToast({ title: "语音加载失败，请稍后重试", icon: "none" });
      console.error(error);
    }
  },

  clearPlayingVoice() {
    if (this.data.playingVoiceId) {
      this.setData({ playingVoiceId: "" });
    }
  },

  previewImage(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) return;
    wx.previewImage({ urls: [url], current: url });
  },

  openOrder(event) {
    const orderId = event.currentTarget.dataset.orderId;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/order-detail/index?id=${orderId}` });
  },

  async send() {
    const content = this.data.input.trim();
    if (!content) {
      wx.showToast({ title: "请输入消息", icon: "none" });
      return;
    }
    wx.showLoading({ title: "发送中" });
    try {
      await callCloud("sendMessage", { conversationId: this.data.id, type: "text", content });
      this.setData({ input: "", emojiOpen: false });
      await this.load();
    } catch (error) {
      showError(error);
    } finally {
      wx.hideLoading();
    }
  },
});
