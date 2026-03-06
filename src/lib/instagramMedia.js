import { dedupeNormalizedUrls } from "./avatar";

const API_BASE_URL = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");

const isLikelyVideoUrl = (value) => (
  typeof value === "string" && /\.(mp4|mov|m4v|webm|mpe?g|avi|wmv|flv)(\?|$)/i.test(value)
);

export const buildInstagramMediaPreviewProxyUrl = (mediaId) => {
  const normalizedId = String(mediaId || "").trim();
  if (!normalizedId) return "";
  const params = new URLSearchParams({ mediaId: normalizedId });
  return `${API_BASE_URL}/api/instagram/media-preview?${params.toString()}`;
};

export const buildInstagramMediaPreviewCandidates = (post = {}) => {
  const mediaId = post?.id ?? post?.mediaId ?? post?.media_id;
  const mediaType = String(post?.mediaType || post?.media_type || "").toUpperCase();
  const mediaProductType = String(post?.mediaProductType || post?.media_product_type || "").toUpperCase();
  const isVideo = (
    mediaType === "VIDEO"
    || mediaType === "REEL"
    || mediaType === "IGTV"
    || mediaProductType === "VIDEO"
    || mediaProductType === "REEL"
    || mediaProductType === "IGTV"
  );

  const candidates = [
    buildInstagramMediaPreviewProxyUrl(mediaId),
    post?.previewUrl,
    post?.preview_url,
    post?.thumbnailUrl,
    post?.thumbnail_url,
    post?.posterUrl,
    post?.poster_url,
    post?.mediaPreviewUrl,
    post?.media_preview_url,
  ];

  if (!isVideo) {
    candidates.push(
      post?.mediaUrl,
      post?.media_url,
      post?.thumbnail,
    );
  }

  return dedupeNormalizedUrls(candidates).filter((url) => !isLikelyVideoUrl(url));
};
