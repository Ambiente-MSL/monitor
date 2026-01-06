export function isApiEnvelope(value) {
  if (!value || typeof value !== "object") return false;
  return (
    Object.prototype.hasOwnProperty.call(value, "data") &&
    Object.prototype.hasOwnProperty.call(value, "meta") &&
    Object.prototype.hasOwnProperty.call(value, "error")
  );
}

export function unwrapApiData(value, fallback = {}) {
  if (isApiEnvelope(value)) {
    const data = value.data;
    return data == null ? fallback : data;
  }
  return value == null ? fallback : value;
}

export function getApiErrorMessage(payload, fallback = "Erro") {
  if (!payload) return fallback;

  if (isApiEnvelope(payload)) {
    const err = payload.error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      if (err.message) return String(err.message);
      if (err.error) return String(err.error);
    }
  }

  if (payload && typeof payload === "object") {
    if (typeof payload.error === "string") {
      const graphCode = payload.graph?.code;
      return graphCode ? `${payload.error} (Graph code ${graphCode})` : payload.error;
    }
    if (payload.error && typeof payload.error === "object" && payload.error.message) {
      return String(payload.error.message);
    }
    if (typeof payload.message === "string") {
      return payload.message;
    }
  }

  return fallback;
}

