function cloudErrorMessage(error) {
  const message = error && (error.message || error.errMsg);
  if (!message) return "服务暂时不可用";
  if (message.includes("timeout")) return "请求超时，请稍后重试";
  if (message.includes("Environment not found")) return "请先在 app.js 配置云环境 ID";
  if (message.includes("FunctionName parameter could not be found")) return "请先上传部署 quickstartFunctions 云函数";
  return message;
}

function callOnce(type, data) {
  return wx.cloud.callFunction({
    name: "quickstartFunctions",
    data: {
      type,
      data: data || {},
    },
  });
}

async function callCloud(type, data) {
  try {
    let response;
    try {
      response = await callOnce(type, data);
    } catch (error) {
      const message = error && (error.message || error.errMsg || "");
      if (!message.includes("timeout")) throw error;
      response = await callOnce(type, data);
    }
    const result = response.result || {};
    if (!result.success) {
      throw new Error(result.message || "操作失败");
    }
    return result.data;
  } catch (error) {
    throw new Error(cloudErrorMessage(error));
  }
}

function showError(error) {
  wx.showToast({
    title: cloudErrorMessage(error),
    icon: "none",
    duration: 2400,
  });
}

module.exports = {
  callCloud,
  showError,
};
