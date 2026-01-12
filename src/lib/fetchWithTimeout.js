export const DEFAULT_TIMEOUT_MS = 30000;
export const TIMEOUT_ERROR_NAME = "TimeoutError";

export const isTimeoutError = (err) => err?.name === TIMEOUT_ERROR_NAME;

export async function fetchWithTimeout(input, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { signal, ...rest } = options || {};
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId = null;

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch (err) {
    if (timedOut) {
      const timeoutError = new Error("Tempo esgotado ao carregar dados.");
      timeoutError.name = TIMEOUT_ERROR_NAME;
      throw timeoutError;
    }
    throw err;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
