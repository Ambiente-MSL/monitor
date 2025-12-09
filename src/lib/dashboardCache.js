const cache = new Map();

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
  return cache.get(key) || null;
}

export function setDashboardCache(key, value) {
  if (!key) return;
  cache.set(key, { ...value, __cachedAt: Date.now() });
}

export function mergeDashboardCache(key, value) {
  if (!key) return;
  const current = getDashboardCache(key) || {};
  setDashboardCache(key, { ...current, ...value });
}

export function clearDashboardCache(key) {
  if (!key) return;
  cache.delete(key);
}
