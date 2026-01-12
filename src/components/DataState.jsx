const DEFAULT_LABELS = {
  loading: "Carregando dados...",
  error: "Falha ao carregar dados.",
  empty: "Sem dados para exibir.",
};

export default function DataState({
  state = "loading",
  label,
  hint,
  size = "md",
  inline = false,
  className = "",
}) {
  const normalizedState = ["loading", "error", "empty"].includes(state) ? state : "loading";
  const resolvedLabel = label || DEFAULT_LABELS[normalizedState] || DEFAULT_LABELS.loading;
  const sizeClass = size ? `data-state--${size}` : "";
  const classes = [
    "data-state",
    `data-state--${normalizedState}`,
    sizeClass,
    inline ? "data-state--inline" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role={normalizedState === "loading" ? "status" : "note"} aria-live="polite">
      {normalizedState === "loading" ? <span className="data-state__spinner" aria-hidden="true" /> : null}
      <span className="data-state__label">{resolvedLabel}</span>
      {hint ? <span className="data-state__hint">{hint}</span> : null}
    </div>
  );
}
