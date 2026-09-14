"use strict";

const { translate } = require("./locale.cjs");

class CancelledError extends Error {
  constructor(message, locale = "ru") {
    const resolvedMessage = message || translate(locale, "cancelled");
    super(resolvedMessage);
    this.name = "CancelledError";
    this.code = "CANCELLED";
  }
}

class ApiError extends Error {
  constructor(message, { status = 0, code = "API_ERROR", cause } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function isCancelled(error) {
  return error instanceof CancelledError || error?.name === "AbortError" || error?.code === "CANCELLED";
}

function toUserError(error, locale = "ru") {
  if (isCancelled(error)) {
    return { code: "CANCELLED", message: translate(locale, "cancelled") };
  }
  if (error instanceof ApiError) {
    if (error.code === "NETWORK_ERROR") {
      return {
        code: "NETWORK_ERROR",
        message: translate(locale, "networkError")
      };
    }
    if (error.code === "NETWORK_TIMEOUT") {
      return {
        code: "NETWORK_TIMEOUT",
        message: translate(locale, "networkTimeout")
      };
    }
    if (error.status === 401) {
      return { code: "INVALID_API_KEY", message: translate(locale, "invalidApiKey") };
    }
    if (error.status === 429) {
      return { code: "RATE_LIMIT", message: translate(locale, "rateLimit") };
    }
    if (error.status === 413) {
      return { code: "FILE_TOO_LARGE", message: translate(locale, "fileTooLargeUser") };
    }
    return { code: error.code, message: translate(locale, "apiFailure", { message: error.message }) };
  }
  if (error?.code === "ENOENT") {
    return { code: "FILE_NOT_FOUND", message: translate(locale, "fileNotFound") };
  }
  if (error?.code === "NO_AUDIO") {
    return { code: "NO_AUDIO", message: translate(locale, "noAudio") };
  }
  return {
    code: error?.code || "UNKNOWN_ERROR",
    message: error?.message || translate(locale, "unknownError")
  };
}

module.exports = { ApiError, CancelledError, isCancelled, toUserError };
