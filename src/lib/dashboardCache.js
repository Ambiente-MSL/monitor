const cache = new Map();
const LS_PREFIX = "dashboardCache|";

const getStorage = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage || null;
  } catch (err) {
    return null;
  }
};

const endOfToday = () => {
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  return now.getTime();
};

const isExpired = (record) => {
  if (!record || typeof record !== "object") return true;
  if (record.__expiresAt && typeof record.__expiresAt === "number") {
    return record.__expiresAt < Date.now();
  }
  return false;
};

const readFromStorage = (key) => {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(`${LS_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isExpired(parsed) ? null : parsed;
  } catch (err) {
    return null;
  }
};

const writeToStorage = (key, value) => {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(`${LS_PREFIX}${key}`, JSON.stringify(value));
  } catch (err) {
    // ignore write failures (quota/private mode)
  }
};

const removeFromStorage = (key) => {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(`${LS_PREFIX}${key}`);
  } catch (err) {
    // ignore
  }
};

const normalizePart = (part) => {
  if (part === null || part === undefined) return "";
  return String(part);
};

export function makeDashboardCacheKey(scope, accountId, ...params) {
  return [normalizePart(scope || "global"), normalizePart(accountId || "unknown"), ...params.map(normalizePart)].join(
    "|",
  );
}

export function getDashboardCache(key) {
  if (!key) return null;
  const inMemory = cache.get(key);
  if (inMemory && !isExpired(inMemory)) {
    return inMemory;
  }
  const stored = readFromStorage(key);
  if (stored && !isExpired(stored)) {
    cache.set(key, stored);
    return stored;
  }
  if (inMemory) cache.delete(key);
  if (stored) removeFromStorage(key);
  return null;
}

export function setDashboardCache(key, value) {
  if (!key) return;
  const record = { ...value, __cachedAt: Date.now(), __expiresAt: endOfToday() };
  cache.set(key, record);
  writeToStorage(key, record);
}

export function mergeDashboardCache(key, value) {
  if (!key) return;
  const current = getDashboardCache(key) || {};
  setDashboardCache(key, { ...current, ...value });
}

export function clearDashboardCache(key) {
  if (!key) return;
  cache.delete(key);
  removeFromStorage(key);
}
