import PropTypes from "prop-types";
import { useMemo } from "react";

const formatSyncDate = (value, tz) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const formatDate = (timeZone) => parsed.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  }).replace(/\./g, "");
  const formatTime = (timeZone) => parsed.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

  let datePart = "";
  let timePart = "";
  try {
    datePart = formatDate(tz);
    timePart = formatTime(tz);
  } catch {
    datePart = formatDate(undefined);
    timePart = formatTime(undefined);
  }
  return `${datePart} ${timePart}`;
};

export default function LastSyncBadge({ fetchedAt, isStale, source, tz }) {
  const formatted = useMemo(() => formatSyncDate(fetchedAt, tz), [fetchedAt, tz]);
  const tzLabel = tz ? ` (${tz})` : " (local)";
  const label = formatted
    ? `Ultima atualizacao: ${formatted}${tzLabel}`
    : "Ultima atualizacao: —";
  const showCache = Boolean(isStale);
  const showLive = !showCache && source === "meta_live" && Boolean(formatted);
  return (
    <div className="last-sync-badge" aria-live="polite">
      <span className="last-sync-badge__label">{label}</span>
      {showCache && <span className="last-sync-badge__tag last-sync-badge__tag--stale">Exibindo cache</span>}
      {showLive && <span className="last-sync-badge__tag last-sync-badge__tag--live">Atualizado agora</span>}
    </div>
  );
}

LastSyncBadge.propTypes = {
  fetchedAt: PropTypes.string,
  isStale: PropTypes.bool,
  source: PropTypes.string,
  tz: PropTypes.string,
};

LastSyncBadge.defaultProps = {
  fetchedAt: null,
  isStale: false,
  source: null,
  tz: null,
};
