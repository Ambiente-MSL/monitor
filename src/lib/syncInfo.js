const SOURCE_CACHE = new Set(["cache", "stale", "cache-fallback"]);
const SOURCE_LIVE = new Set(["live", "refresh", "prime", "meta_live"]);

const normalizeSource = (value) => {
  if (!value) return null;
  const source = String(value);
  if (source === "db") return "db";
  if (SOURCE_CACHE.has(source)) return "cache";
  if (SOURCE_LIVE.has(source)) return "meta_live";
  return source;
};

export const normalizeSyncInfo = (meta) => {
  if (!meta || typeof meta !== "object") {
    return {
      fetchedAt: null,
      isStale: false,
      source: null,
      tz: null,
      expiresAt: null,
    };
  }
  const sync = meta.sync && typeof meta.sync === "object" ? meta.sync : {};
  const rawSource = meta.source || meta.status || null;
  const source = normalizeSource(rawSource);
  const derivedStale = meta.status === "stale";
  return {
    fetchedAt: sync.fetched_at ?? meta.fetched_at ?? null,
    isStale: Boolean(sync.is_stale ?? meta.is_stale ?? meta.stale ?? derivedStale),
    source,
    tz: meta.timezone || meta.tz || null,
    expiresAt: sync.expires_at ?? meta.expires_at ?? null,
  };
};
