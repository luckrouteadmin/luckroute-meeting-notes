"use strict";

class CancelledError extends Error {
  constructor(message = "Обработка отменена.") {
    super(message);
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

function toUserError(error) {
  if (isCancelled(error)) {
    return { code: "CANCELLED", message: "Обработка отменена." };
  }
  if (error instanceof ApiError) {
    if (error.code === "NETWORK_ERROR") {
      return {
        code: "NETWORK_ERROR",
        message: "Не удалось подключиться к OpenAI. Проверьте интернет и работу VPN или прокси, затем повторите."
      };
    }
    if (error.code === "NETWORK_TIMEOUT") {
      return {
        code: "NETWORK_TIMEOUT",
        message: "OpenAI слишком долго не отвечает. Проверьте интернет или VPN и повторите попытку."
      };
    }
    if (error.status === 401) {
      return { code: "INVALID_API_KEY", message: "OpenAI отклонил ключ. Откройте настройки и сохраните действующий API-ключ." };
    }
    if (error.status === 429) {
      return { code: "RATE_LIMIT", message: "Достигнут лимит OpenAI. Подождите несколько минут и повторите." };
    }
    if (error.status === 413) {
      return { code: "FILE_TOO_LARGE", message: "Аудиофрагмент оказался слишком большим для загрузки. Попробуйте ещё раз или выберите более короткую запись." };
    }
    return { code: error.code, message: `OpenAI не смог обработать запись: ${error.message}` };
  }
  if (error?.code === "ENOENT") {
    return { code: "FILE_NOT_FOUND", message: "Не удалось найти выбранный файл или папку." };
  }
  if (error?.code === "NO_AUDIO") {
    return { code: "NO_AUDIO", message: "В выбранном видеофайле не найдена звуковая дорожка." };
  }
  return {
    code: error?.code || "UNKNOWN_ERROR",
    message: error?.message || "Неизвестная ошибка. Повторите попытку."
  };
}

module.exports = { ApiError, CancelledError, isCancelled, toUserError };
