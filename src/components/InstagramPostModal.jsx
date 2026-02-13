import { useEffect, useState, useCallback } from "react";
import { X, Heart, MessageCircle, Send, Bookmark, ExternalLink, Play } from "lucide-react";

const formatNumber = (num) => {
  if (num == null || Number.isNaN(num)) return "0";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
};

const formatDate = (timestamp) => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const isLikelyVideoUrl = (value) => (
  typeof value === "string" && /\.(mp4|mov|m4v|webm)(\?|$)/i.test(value)
);

// Helper para extrair valor de caminhos aninhados
const getNestedValue = (obj, path) => {
  if (!obj || !Array.isArray(path)) return undefined;
  return path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
};

// Helper para extrair numero
const extractNumber = (value) => {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

// Helper para pegar primeiro numero valido
const pickFirstNumber = (candidates, fallback = 0) => {
  for (const c of candidates) {
    const n = extractNumber(c);
    if (n != null) return n;
  }
  return fallback;
};

// Caminhos para metricas de posts
const POST_METRIC_PATHS = {
  likes: [
    ["likes"],
    ["likeCount"],
    ["like_count"],
    ["insights", "likes", "value"],
  ],
  comments: [
    ["comments"],
    ["commentsCount"],
    ["comments_count"],
    ["insights", "comments", "value"],
  ],
  shares: [
    ["shares"],
    ["shareCount"],
    ["shares_count"],
    ["insights", "shares", "value"],
  ],
  saves: [
    ["saves"],
    ["saveCount"],
    ["saved"],
    ["saved_count"],
    ["insights", "saves", "value"],
    ["insights", "saved", "value"],
  ],
  reach: [
    ["reach"],
    ["reachCount"],
    ["reach_count"],
    ["insights", "reach", "value"],
  ],
  views: [
    ["views"],
    ["viewCount"],
    ["view_count"],
    ["videoViews"],
    ["video_views"],
    ["plays"],
    ["insights", "views", "value"],
    ["insights", "video_views", "value"],
  ],
  impressions: [
    ["impressions"],
    ["impressionsCount"],
    ["impressions_count"],
    ["insights", "impressions", "value"],
  ],
};

const resolvePostMetric = (post, metric, fallback = 0) => {
  const paths = POST_METRIC_PATHS[metric] || [];
  const candidates = paths.map((path) => getNestedValue(post, path));
  return pickFirstNumber(candidates, fallback);
};

export default function InstagramPostModal({ post, onClose, accountInfo }) {
  const [imageError, setImageError] = useState(false);
  const [videoError, setVideoError] = useState(false);

  useEffect(() => {
    if (!post) return;
    const onEsc = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onEsc);
      document.body.style.overflow = "";
    };
  }, [post, onClose]);

  // Reset imageError quando post mudar
  useEffect(() => {
    setImageError(false);
    setVideoError(false);
  }, [post?.id]);

  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  }, [onClose]);

  if (!post) return null;

  const mediaType = String(post.media_type || post.mediaType || "").toUpperCase();
  const mediaProductType = String(post.media_product_type || post.mediaProductType || "").toUpperCase();
  const isVideo = (
    mediaType === "VIDEO"
    || mediaType === "REEL"
    || mediaType === "REELS"
    || mediaType === "IGTV"
    || mediaProductType === "VIDEO"
    || mediaProductType === "REEL"
    || mediaProductType === "REELS"
    || mediaProductType === "IGTV"
    || post.is_video
  );
  const isCarousel = mediaType === "CAROUSEL_ALBUM" || mediaType === "CAROUSEL";

  const videoUrl = [
    post.videoUrl,
    post.video_url,
    post.mediaUrl,
    post.media_url,
  ].find((url) => {
    if (!url) return false;
    if (isVideo) return true;
    return isLikelyVideoUrl(url);
  });

  // Usar mesma logica dos cards - buscar primeira URL valida que nao seja video
  const mediaUrl = [
    post.previewUrl,
    post.preview_url,
    post.thumbnailUrl,
    post.thumbnail_url,
    post.mediaPreviewUrl,
    post.media_preview_url,
    !isVideo ? post.mediaUrl : null,
    !isVideo ? post.media_url : null,
    post.thumbnail,
  ].find((url) => url && !isLikelyVideoUrl(url));
  const showVideoPlayer = isVideo && videoUrl && !videoError;

  // Usar resolvePostMetric para extrair metricas corretamente
  const likes = resolvePostMetric(post, "likes");
  const comments = resolvePostMetric(post, "comments");
  const shares = resolvePostMetric(post, "shares");
  const saves = resolvePostMetric(post, "saves");
  const plays = resolvePostMetric(post, "views");
  const reach = resolvePostMetric(post, "reach");
  const impressions = resolvePostMetric(post, "impressions");

  const caption = post.caption || "";
  const permalink = post.permalink || `https://www.instagram.com/p/${post.id || ""}`;
  const timestamp = post.timestamp;

  const username = accountInfo?.username || accountInfo?.name || "Instagram";
  const profilePic = accountInfo?.profile_picture_url;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "20px",
        backdropFilter: "blur(4px)"
      }}
      onClick={handleBackdropClick}
    >
      {/* Botao fechar */}
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: "20px",
          right: "20px",
          background: "rgba(255,255,255,0.1)",
          border: "none",
          borderRadius: "50%",
          width: "44px",
          height: "44px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "white",
          transition: "background 0.2s"
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.2)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
        aria-label="Fechar"
      >
        <X size={24} />
      </button>

      {/* Container principal */}
      <div
        style={{
          display: "flex",
          maxWidth: "1100px",
          maxHeight: "90vh",
          width: "100%",
          background: "white",
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Lado esquerdo - Midia */}
        <div
          style={{
            flex: "1 1 60%",
            maxWidth: "600px",
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            minHeight: "400px"
          }}
        >
          {showVideoPlayer ? (
            <video
              controls
              playsInline
              preload="metadata"
              poster={mediaUrl || undefined}
              style={{
                maxWidth: "100%",
                maxHeight: "90vh",
                objectFit: "contain",
                display: "block"
              }}
              onError={() => setVideoError(true)}
            >
              <source src={videoUrl} />
              Seu navegador nao suporta reproducao de video.
            </video>
          ) : imageError || !mediaUrl ? (
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "#999",
              padding: "40px",
              textAlign: "center"
            }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <p style={{ marginTop: "16px", fontSize: "14px" }}>
                {isVideo ? "Nao foi possivel reproduzir este video no Monitor" : "Midia indisponivel"}
              </p>
              <a
                href={permalink}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  marginTop: "12px",
                  padding: "10px 20px",
                  background: "linear-gradient(135deg, #833AB4, #E1306C, #F77737)",
                  color: "white",
                  borderRadius: "8px",
                  textDecoration: "none",
                  fontSize: "14px",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "8px"
                }}
              >
                {isVideo && <Play size={18} fill="white" />}
                {isVideo ? "Assistir no Instagram" : "Ver no Instagram"}
              </a>
            </div>
          ) : (
            <>
              <img
                src={mediaUrl}
                alt="Post"
                style={{
                  maxWidth: "100%",
                  maxHeight: "90vh",
                  objectFit: "contain",
                  display: "block"
                }}
                onError={() => setImageError(true)}
              />
              {/* Botao de play para videos - abre no Instagram */}
              {isVideo && (
                <a
                  href={permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    position: "absolute",
                    width: "80px",
                    height: "80px",
                    borderRadius: "50%",
                    background: "rgba(0,0,0,0.6)",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    transition: "transform 0.2s, background 0.2s",
                    textDecoration: "none"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "scale(1.1)";
                    e.currentTarget.style.background = "rgba(0,0,0,0.8)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "scale(1)";
                    e.currentTarget.style.background = "rgba(0,0,0,0.6)";
                  }}
                  title="Assistir no Instagram"
                >
                  <Play size={36} fill="white" />
                </a>
              )}
            </>
          )}

          {/* Badge de tipo */}
          {(isVideo || isCarousel) && !imageError && (
            <div style={{
              position: "absolute",
              top: "12px",
              right: "12px",
              background: "rgba(0,0,0,0.7)",
              color: "white",
              padding: "4px 10px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600
            }}>
              {isCarousel ? "Carrossel" : "Video"}
            </div>
          )}
        </div>

        {/* Lado direito - Informacoes */}
        <div
          style={{
            flex: "1 1 40%",
            minWidth: "320px",
            maxWidth: "500px",
            display: "flex",
            flexDirection: "column",
            background: "white"
          }}
        >
          {/* Header com perfil */}
          <div style={{
            display: "flex",
            alignItems: "center",
            padding: "16px",
            borderBottom: "1px solid #efefef",
            gap: "12px"
          }}>
            {profilePic ? (
              <img
                src={profilePic}
                alt={username}
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  objectFit: "cover"
                }}
              />
            ) : (
              <div style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #833AB4, #E1306C, #F77737)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontWeight: 700,
                fontSize: "16px"
              }}>
                {username.charAt(0).toUpperCase()}
              </div>
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: "14px", color: "#262626" }}>
                @{username}
              </div>
              {timestamp && (
                <div style={{ fontSize: "12px", color: "#8e8e8e" }}>
                  {formatDate(timestamp)}
                </div>
              )}
            </div>
            <a
              href={permalink}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "#8e8e8e",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "12px",
                textDecoration: "none"
              }}
              title="Abrir no Instagram"
            >
              <ExternalLink size={16} />
            </a>
          </div>

          {/* Caption */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px"
          }}>
            {caption ? (
              <p style={{
                margin: 0,
                fontSize: "14px",
                lineHeight: 1.5,
                color: "#262626",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word"
              }}>
                {caption.length > 500 ? `${caption.slice(0, 500)}...` : caption}
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: "14px", color: "#8e8e8e", fontStyle: "italic" }}>
                Sem legenda
              </p>
            )}
          </div>

          {/* Metricas */}
          <div style={{ borderTop: "1px solid #efefef" }}>
            {/* Icones de acao */}
            <div style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 16px",
              gap: "16px"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#262626" }}>
                <Heart size={24} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#262626" }}>
                <MessageCircle size={24} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#262626" }}>
                <Send size={24} />
              </div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", color: "#262626" }}>
                <Bookmark size={24} />
              </div>
            </div>

            {/* Numeros */}
            <div style={{
              padding: "0 16px 16px",
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "12px"
            }}>
              <div style={{
                background: "#fafafa",
                borderRadius: "8px",
                padding: "12px",
                textAlign: "center"
              }}>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#262626" }}>
                  {formatNumber(likes)}
                </div>
                <div style={{ fontSize: "12px", color: "#8e8e8e", marginTop: "2px" }}>
                  Curtidas
                </div>
              </div>

              <div style={{
                background: "#fafafa",
                borderRadius: "8px",
                padding: "12px",
                textAlign: "center"
              }}>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#262626" }}>
                  {formatNumber(comments)}
                </div>
                <div style={{ fontSize: "12px", color: "#8e8e8e", marginTop: "2px" }}>
                  Comentarios
                </div>
              </div>

              {saves > 0 && (
                <div style={{
                  background: "#fafafa",
                  borderRadius: "8px",
                  padding: "12px",
                  textAlign: "center"
                }}>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "#262626" }}>
                    {formatNumber(saves)}
                  </div>
                  <div style={{ fontSize: "12px", color: "#8e8e8e", marginTop: "2px" }}>
                    Salvos
                  </div>
                </div>
              )}

              {shares > 0 && (
                <div style={{
                  background: "#fafafa",
                  borderRadius: "8px",
                  padding: "12px",
                  textAlign: "center"
                }}>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "#262626" }}>
                    {formatNumber(shares)}
                  </div>
                  <div style={{ fontSize: "12px", color: "#8e8e8e", marginTop: "2px" }}>
                    Compartilhamentos
                  </div>
                </div>
              )}

              {isVideo && plays > 0 && (
                <div style={{
                  background: "#fafafa",
                  borderRadius: "8px",
                  padding: "12px",
                  textAlign: "center"
                }}>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "#262626" }}>
                    {formatNumber(plays)}
                  </div>
                  <div style={{ fontSize: "12px", color: "#8e8e8e", marginTop: "2px" }}>
                    Reproducoes
                  </div>
                </div>
              )}

              {reach > 0 && (
                <div style={{
                  background: "#fafafa",
                  borderRadius: "8px",
                  padding: "12px",
                  textAlign: "center"
                }}>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "#262626" }}>
                    {formatNumber(reach)}
                  </div>
                  <div style={{ fontSize: "12px", color: "#8e8e8e", marginTop: "2px" }}>
                    Alcance
                  </div>
                </div>
              )}

              {impressions > 0 && (
                <div style={{
                  background: "#fafafa",
                  borderRadius: "8px",
                  padding: "12px",
                  textAlign: "center"
                }}>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "#262626" }}>
                    {formatNumber(impressions)}
                  </div>
                  <div style={{ fontSize: "12px", color: "#8e8e8e", marginTop: "2px" }}>
                    Impressoes
                  </div>
                </div>
              )}
            </div>

            {/* Total de interacoes */}
            <div style={{
              padding: "12px 16px",
              borderTop: "1px solid #efefef",
              background: "linear-gradient(135deg, #f8f9fa 0%, #fff 100%)"
            }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between"
              }}>
                <span style={{ fontSize: "14px", color: "#8e8e8e" }}>Total de interacoes</span>
                <span style={{ fontSize: "18px", fontWeight: 700, color: "#262626" }}>
                  {formatNumber(likes + comments + shares + saves)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
