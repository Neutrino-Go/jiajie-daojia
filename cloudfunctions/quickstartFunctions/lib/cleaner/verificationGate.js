const { AppError } = require("../domain");

const ID_CARD_PATTERN = /^(\d{15}|\d{17}[\dXx])$/;
const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const TRAINING_STATUSES = new Set(["submitted", "completed", "passed", "approved"]);

function cleanText(value, maxLength = 120) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function firstValue(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const found = value.map((item) => cleanText(item, 200)).find(Boolean);
      if (found) return found;
    } else {
      const text = cleanText(value, 200);
      if (text) return text;
    }
  }
  return "";
}

function normalizeTrainingStatus(value) {
  return cleanText(value, 40).toLowerCase();
}

function idCardOf(data = {}, cleaner = {}) {
  return firstValue(data.idCard, data.idCardNo, data.identityNo, cleaner.idCard, cleaner.idCardNo, cleaner.identityNo);
}

function phoneOf(data = {}, cleaner = {}) {
  return firstValue(data.phone, data.mobile, cleaner.phone, cleaner.mobile);
}

function healthCertOf(data = {}, cleaner = {}) {
  return firstValue(
    data.healthCert,
    data.healthCertificateFileID,
    data.healthCertificateFileIDs,
    data.healthCertificateUploadId,
    cleaner.healthCert,
    cleaner.healthCertificateFileID,
    cleaner.healthCertificateFileIDs,
    cleaner.healthCertificateUploadId
  );
}

function trainingStatusOf(data = {}, cleaner = {}) {
  return normalizeTrainingStatus(firstValue(data.trainingStatus, data.trainingSubmissionStatus, cleaner.trainingSubmissionStatus, cleaner.trainingStatus));
}

function idCardMasked(idCard) {
  const value = cleanText(idCard, 32);
  if (!value) return "";
  return `${value.slice(0, 3)}***********${value.slice(-4)}`;
}

function autoValidateCleanerProfile(data = {}, cleaner = {}) {
  const realName = firstValue(data.realName, cleaner.realName);
  const idCard = idCardOf(data, cleaner);
  const phone = phoneOf(data, cleaner);
  const healthCert = healthCertOf(data, cleaner);
  const trainingStatus = trainingStatusOf(data, cleaner);
  const missing = [];
  if (!realName) missing.push("realName");
  if (!idCard) missing.push("idCard");
  if (!healthCert) missing.push("healthCert");
  if (!phone) missing.push("phone");
  if (!trainingStatus) missing.push("trainingStatus");

  const errors = [];
  if (idCard && !ID_CARD_PATTERN.test(idCard)) errors.push("INVALID_ID_CARD");
  if (phone && !PHONE_PATTERN.test(phone)) errors.push("INVALID_PHONE");
  if (trainingStatus && !TRAINING_STATUSES.has(trainingStatus)) errors.push("INVALID_TRAINING_STATUS");

  return {
    valid: missing.length === 0 && errors.length === 0,
    missing,
    errors,
    normalized: {
      realName,
      idCardMasked: idCardMasked(idCard),
      idCardLast4: idCard ? idCard.slice(-4) : "",
      phone,
      healthCert,
      trainingStatus,
    },
  };
}

function verifyCleanerApplication(data = {}, cleaner = {}) {
  const validation = autoValidateCleanerProfile(data, cleaner);
  if (validation.missing.length > 0) {
    throw AppError("MISSING_REQUIRED_FIELDS", "MISSING_REQUIRED_FIELDS");
  }
  if (validation.errors.length > 0) {
    throw AppError(validation.errors[0], "INVALID_INPUT");
  }
  return validation;
}

module.exports = {
  autoValidateCleanerProfile,
  verifyCleanerApplication,
};
