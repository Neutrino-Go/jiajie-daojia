function cleanerOpenidOf(cleaner = {}) {
  return cleaner.cleanerId || cleaner._openid || cleaner.openid || "";
}

module.exports = {
  cleanerOpenidOf,
};
