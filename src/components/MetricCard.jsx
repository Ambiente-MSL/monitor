import { memo } from "react";

export default memo(function MetricCard({
  title,
  value,
  delta,               // número (positivo/negativo) ou string
  compact = false,     // oculta o corpo para padronizar altura
  variant,
  className = "",
  children,            // conteúdo extra (quando não compacto)
  onOpen,              // se passado, card fica “clicável” para abrir modal
}) {
  const hasDelta = delta !== null && delta !== undefined && delta !== "";
  const isDown = typeof delta === "number" ? delta < 0 : String(delta).trim().startsWith("-");
  const deltaText =
    typeof delta === "number" ? `${Math.abs(delta).toFixed(1)}%` : String(delta);
  const deltaClass = [
    "metric-card__delta",
    "delta-badge",
    isDown ? "metric-card__delta--down" : "",
    isDown ? "delta-badge--neg" : "delta-badge--pos",
  ].filter(Boolean).join(" ");

  const isCompact = compact || variant === "compact";
  const cardClasses = ["metric-card"];
  if (isCompact) cardClasses.push("metric-card--compact");
  if (className) cardClasses.push(className);
  const titleText = typeof title === "string" || typeof title === "number" ? String(title) : "";

  const Cmp = (
    <div className={cardClasses.join(" ")}>
      <div className="metric-card__title" title={titleText || undefined}>{title}</div>
      <div className="metric-card__value-row">
        <div className="metric-card__value">{value ?? "-"}</div>
        {hasDelta && (
          <span className={deltaClass}>
            {deltaText}
          </span>
        )}
      </div>
      {!isCompact && children && (
        <div className="metric-card__body">{children}</div>
      )}
    </div>
  );

  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        style={{all:"unset", cursor:"pointer", display:"block"}}
        aria-label={`Abrir detalhes de ${title}`}
      >
        {Cmp}
      </button>
    );
  }
  return Cmp;
});
