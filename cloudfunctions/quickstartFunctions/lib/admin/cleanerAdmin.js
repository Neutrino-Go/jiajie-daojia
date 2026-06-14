function cleanerBlockPatch(reason = "") {
  return {
    available: false,
    trustLevel: "blocked",
    opsBlockReason: String(reason || "").slice(0, 120),
  };
}

module.exports = {
  cleanerBlockPatch,
};
