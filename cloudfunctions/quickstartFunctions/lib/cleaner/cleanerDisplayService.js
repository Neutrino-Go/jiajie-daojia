function cleanText(value, maxLength = 80) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function maskRealName(value) {
  const name = cleanText(value, 40);
  if (!name) return "";
  return `${name.slice(0, 1)}*`;
}

function getCleanerDisplayName(cleaner = {}) {
  const maskedRealName = maskRealName(cleaner.realName);
  if (maskedRealName) return maskedRealName;
  const nickname = cleanText(cleaner.nickname || cleaner.displayName, 24);
  if (nickname) return nickname;
  const id = cleanText(cleaner.cleanerId || cleaner._openid || cleaner.openid, 80);
  return `家洁师#${id ? id.slice(-6) : "待完善"}`;
}

module.exports = {
  getCleanerDisplayName,
  maskRealName,
};
