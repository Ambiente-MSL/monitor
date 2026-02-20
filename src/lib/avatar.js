const API_BASE_URL = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");

const decodeHtmlEntities = (value) => (
  value
    .replace(/&amp;/gi, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#x3A;/gi, ":")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
);

export const normalizeAvatarUrl = (rawValue) => {
  if (rawValue == null) return "";
  let value = String(rawValue).trim();
  if (!value) return "";

  value = decodeHtmlEntities(value).replace(/^['"]+|['"]+$/g, "");
  if (!value) return "";

  if (value.startsWith("//")) return `https:${value}`;
  if (/^http:\/\//i.test(value)) return value.replace(/^http:\/\//i, "https://");
  return value;
};

export const dedupeNormalizedUrls = (values = []) => {
  const seen = new Set();
  const output = [];
  values.forEach((value) => {
    const normalized = normalizeAvatarUrl(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(normalized);
  });
  return output;
};

export const buildInstagramAvatarProxyUrl = (instagramUserId) => {
  const normalizedId = String(instagramUserId || "").trim();
  if (!normalizedId) return "";
  const params = new URLSearchParams({ igUserId: normalizedId });
  return `${API_BASE_URL}/api/instagram/profile-picture?${params.toString()}`;
};

export const buildInstagramAvatarCandidates = ({
  instagramUserId,
  profilePictureUrl,
  pagePictureUrl,
  additionalUrls = [],
  includeProxy = true,
} = {}) => {
  const urls = [];
  if (includeProxy) {
    urls.push(buildInstagramAvatarProxyUrl(instagramUserId));
  }
  urls.push(
    profilePictureUrl,
    pagePictureUrl,
    ...(Array.isArray(additionalUrls) ? additionalUrls : []),
  );
  return dedupeNormalizedUrls(urls);
};
