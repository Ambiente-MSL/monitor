// src/components/InstagramRanking.jsx
import { Play, Heart, MessageCircle, ExternalLink, TrendingUp } from "lucide-react";
import DataState from "./DataState";
import AvatarWithFallback from "./AvatarWithFallback";
import { buildInstagramMediaPreviewCandidates } from "../lib/instagramMedia";

export default function InstagramRanking({ posts, loading }) {
  if (loading) {
    return (
      <div className="ig-ranking-card">
        <h3 className="ig-ranking-card__title">🏆 Melhores Posts</h3>
        <DataState state="loading" label="Carregando ranking..." size="sm" />
      </div>
    );
  }

  if (!posts || posts.length === 0) {
    return (
      <div className="ig-ranking-card">
        <h3 className="ig-ranking-card__title">🏆 Melhores Posts</h3>
        <div className="ig-ranking-empty">Nenhum post para classificar</div>
      </div>
    );
  }

  // Pegar os 3 melhores posts
  const topPosts = posts.slice(0, 3);

  return (
    <div className="ig-ranking-card">
      <h3 className="ig-ranking-card__title">🏆 Melhores Posts</h3>
      <p className="ig-ranking-card__subtitle">Ordenado por interações totais</p>

      <div className="ig-ranking-card__list">
        {topPosts.map((post, index) => {
          const likes = Number(post.likeCount || post.likes || 0);
          const comments = Number(post.commentsCount || post.comments || 0);
          const rawMediaType = String(post.mediaType || post.media_type || "").toUpperCase();
          const mediaProductType = String(post.mediaProductType || post.media_product_type || "").toUpperCase();
          const isVideo = rawMediaType === "VIDEO" || rawMediaType === "REEL" || rawMediaType === "IGTV" || mediaProductType === "REEL";

          const previewCandidates = buildInstagramMediaPreviewCandidates(post);

          return (
            <div key={post.id} className="ig-ranking-item">
              {/* Preview com badge de posição */}
              <div className="ig-ranking-item__preview">
                <AvatarWithFallback
                  candidates={previewCandidates}
                  alt={`Post #${index + 1}`}
                  placeholder={<div className="ig-ranking-item__no-preview">Sem imagem</div>}
                />
                <span className={`ig-ranking-item__position ig-ranking-item__position--${index + 1}`}>
                  #{index + 1}
                </span>
                {isVideo && (
                  <Play className="ig-ranking-item__play" size={16} />
                )}
              </div>

              {/* Métricas resumidas */}
              <div className="ig-ranking-item__content">
                <div className="ig-ranking-item__stats">
                  <span>
                    <Heart size={14} />
                    {likes.toLocaleString("pt-BR")}
                  </span>
                  <span>
                    <MessageCircle size={14} />
                    {comments.toLocaleString("pt-BR")}
                  </span>
                </div>

                {/* Total de interações */}
                <div className="ig-ranking-item__total">
                  <TrendingUp size={14} />
                  {(likes + comments).toLocaleString("pt-BR")} interações
                </div>
              </div>

              {/* Link para o post */}
              {post.permalink && (
                <a
                  href={post.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="ig-ranking-item__link"
                  aria-label="Ver post no Instagram"
                >
                  <ExternalLink size={16} />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
