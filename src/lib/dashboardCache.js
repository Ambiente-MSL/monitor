const cache = new Map();
const LS_PREFIX = "dashboardCache|";
const CACHE_NAMESPACE = "monitor:v1";

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

const normalizeExtraParts = (extra) => {
  if (extra === null || extra === undefined) return [];
  if (Array.isArray(extra)) {
    return extra.map(normalizePart).filter((value) => value.length);
  }
  if (typeof extra === "object") {
    return Object.keys(extra)
      .sort()
      .map((key) => `${key}=${normalizePart(extra[key])}`);
  }
  return [normalizePart(extra)];
};

export function makeCacheKey({ page, endpoint, accountId, since, until, extra } = {}) {
  const parts = [
    CACHE_NAMESPACE,
    normalizePart(page || "global"),
    normalizePart(endpoint || "resource"),
    `acc=${normalizePart(accountId || "unknown")}`,
    `since=${normalizePart(since || "auto")}`,
    `until=${normalizePart(until || "auto")}`,
  ];
  const extraParts = normalizeExtraParts(extra);
  return [...parts, ...extraParts].join(":");
}

export function makeDashboardCacheKey(scope, accountId, ...params) {
  return makeCacheKey({
    page: "legacy",
    endpoint: scope || "resource",
    accountId,
    since: params[0],
    until: params[1],
    extra: params.slice(2),
  });
}

const invalidateCacheByPredicate = (predicate) => {
  if (typeof predicate !== "function") return;
  Array.from(cache.keys()).forEach((key) => {
    if (predicate(key)) {
      cache.delete(key);
    }
  });
  const storage = getStorage();
  if (!storage) return;
  try {
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const storageKey = storage.key(i);
      if (!storageKey || !storageKey.startsWith(LS_PREFIX)) continue;
      const rawKey = storageKey.slice(LS_PREFIX.length);
      if (predicate(rawKey)) {
        storage.removeItem(storageKey);
      }
    }
  } catch (err) {
    // ignore
  }
};

export function invalidateCacheByPrefix(prefix) {
  if (!prefix) return;
  const normalized = String(prefix);
  invalidateCacheByPredicate((key) => key.startsWith(normalized));
}

export function invalidateCacheForAccount(accountId, page = null) {
  if (!accountId) return;
  const accountToken = `acc=${normalizePart(accountId)}`;
  const pagePrefix = page ? `${CACHE_NAMESPACE}:${normalizePart(page)}:` : `${CACHE_NAMESPACE}:`;
  invalidateCacheByPredicate((key) => key.startsWith(pagePrefix) && key.includes(`:${accountToken}:`));
}

export function invalidateCacheForPage(page) {
  if (!page) return;
  invalidateCacheByPrefix(`${CACHE_NAMESPACE}:${normalizePart(page)}:`);
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
