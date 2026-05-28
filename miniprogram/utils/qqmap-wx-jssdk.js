class QQMapWX {
  constructor(options) {
    this.key = options && options.key ? options.key : "";
  }

  reverseGeocoder(options) {
    const location = options.location || {};
    wx.request({
      url: "https://apis.map.qq.com/ws/geocoder/v1/",
      method: "GET",
      data: {
        key: this.key,
        location: `${location.latitude},${location.longitude}`,
        get_poi: 1,
      },
      success: (response) => {
        const data = response.data || {};
        console.log("[腾讯地图 reverseGeocoder response.data]", data);
        if (data.status === 0) {
          options.success && options.success(data);
          return;
        }
        const error = new Error(data.message || "腾讯地图逆地址解析失败");
        error.status = data.status;
        error.message = data.message || data.msg || error.message;
        error.data = data;
        options.fail && options.fail(error);
      },
      fail: (error) => {
        console.error("[腾讯地图 reverseGeocoder wx.request fail]", error);
        options.fail && options.fail(error);
      },
      complete: (response) => {
        options.complete && options.complete(response);
      },
    });
  }
}

module.exports = QQMapWX;
