import { useMemo } from "react";
import useSWR from "swr";

const WORD_COLORS = ["#a855f7", "#6366f1", "#f97316", "#14b8a6", "#facc15", "#22d3ee", "#34d399", "#f472b6", "#60a5fa"];

const fetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Falha ao carregar nuvem de palavras.");
  }
  return response.json();
};

const scaleFont = (count, min, max, minSize, maxSize) => {
  if (!Number.isFinite(count)) return minSize;
  if (max <= min) return Math.round((minSize + maxSize) / 2);
  const normalized = (count - min) / (max - min);
  const weighted = Math.pow(normalized, 0.9);
  return Math.round(minSize + weighted * (maxSize - minSize));
};

const buildCloudEntries = (words) => {
  if (!Array.isArray(words) || words.length === 0) return [];
  const limited = words
    .filter((item) => item && item.word)
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, 30);

  const counts = limited.map((item) => item.count || 0);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  const minFont = 16;
  const maxFont = Math.max(minFont + 10, 60);

  return limited.map((item, index) => {
    const fontSize = scaleFont(item.count || 0, minCount, maxCount, minFont, maxFont);
    const color = WORD_COLORS[index % WORD_COLORS.length];
    const opacity = 0.8 + ((item.count || 0) / (maxCount || 1)) * 0.2;
    const fontWeight = item.count === maxCount ? 800 : item.count >= (minCount + maxCount) / 2 ? 700 : 500;
    return {
      key: `${item.word}-${index}`,
      word: item.word,
      count: item.count,
      style: {
        fontSize,
        color,
        opacity: Math.min(1, opacity),
        fontWeight,
      },
    };
  });
};

export default function WordCloudCard({
  apiBaseUrl = "",
  igUserId,
  since,
  until,
  top = 30,
  showCommentsCount = true,
  onCommentsCountRender = null,
}) {
  const sanitizedBaseUrl = useMemo(() => (apiBaseUrl || "").replace(/\/$/, ""), [apiBaseUrl]);

  const requestKey = useMemo(() => {
    if (!igUserId) return null;
    const params = new URLSearchParams({ igUserId });
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    const limitedTop = Math.min(Math.max(top || 30, 1), 30);
    params.set("top", String(limitedTop));
    const path = `/api/instagram/comments/wordcloud?${params.toString()}`;
    return sanitizedBaseUrl ? `${sanitizedBaseUrl}${path}` : path;
  }, [igUserId, since, until, top, sanitizedBaseUrl]);

  const { data, error, isLoading } = useSWR(requestKey, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  if (!igUserId) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-sm text-slate-500">
        Selecione um perfil para visualizar os comentarios.
      </div>
    );
  }

  if (isLoading) {
    return <div className="h-[300px] animate-pulse rounded-2xl bg-slate-100" />;
  }

  if (error) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center text-center text-sm text-rose-500">
        <p>Falha ao carregar a nuvem de palavras.</p>
        <p className="mt-1 text-xs text-rose-400">{error.message}</p>
      </div>
    );
  }

  const entries = buildCloudEntries(data?.words || []);

  // Chama callback com o total de comentários se fornecido
  if (onCommentsCountRender && typeof data?.total_comments === "number") {
    onCommentsCountRender(data.total_comments);
  }

  if (!entries.length) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-sm text-slate-500">
        Sem dados no periodo.
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {showCommentsCount && typeof data.total_comments === "number" ? (
        <div className="flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-medium text-slate-600">
          <span className="inline-flex h-2 w-2 rounded-full bg-rose-500" />
          <span>
            {data.total_comments} comentario{data.total_comments === 1 ? "" : "s"} analisado{data.total_comments === 1 ? "" : "s"} no periodo
          </span>
        </div>
      ) : null}

      <div className="ig-word-cloud ig-word-cloud--large">
        {entries.map((item, index) => {
          if (index === 0) {
            return (
              <span
                key={item.key}
                className="ig-word-cloud__word"
                style={{
                  ...item.style,
                  color: "#ef4444",
                  fontSize: Math.max(item.style.fontSize, 64),
                  fontWeight: 900,
                  width: "100%",
                  textAlign: "center",
                }}
                title={`${item.word} (${item.count})`}
              >
                {item.word}
              </span>
            );
          }
          return (
            <span
              key={item.key}
              className="ig-word-cloud__word"
              style={item.style}
              title={`${item.word} (${item.count})`}
            >
              {item.word}
            </span>
          );
        })}
      </div>
    </div>
  );
}
