import { formatPercent, formatTooltipNumber } from "../lib/chartFormatters";

const resolveSeriesLabel = (item, labelMap) => {
  const key =
    item?.name ||
    item?.dataKey ||
    item?.payload?.name ||
    item?.payload?.label ||
    item?.payload?.range ||
    item?.payload?.age;
  if (!key) return "";
  if (labelMap && Object.prototype.hasOwnProperty.call(labelMap, key)) {
    return labelMap[key];
  }
  return String(key);
};

const resolvePercentValue = (item) => {
  const percentage = item?.payload?.percentage;
  if (Number.isFinite(percentage)) return percentage;
  const rawPercent = item?.payload?.percent ?? item?.percent;
  if (!Number.isFinite(rawPercent)) return null;
  return Math.abs(rawPercent) <= 1 ? rawPercent * 100 : rawPercent;
};

const formatValue = (value, formatter, unit, item) => {
  const formatted = typeof formatter === "function"
    ? formatter(value, item)
    : formatTooltipNumber(value);
  if (!unit) return formatted;
  return `${formatted}${unit}`;
};

export default function CustomChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
  labelMap,
  unit,
  variant = "default",
  className = "ig-tooltip",
  hideLabel = false,
  showPercent = true,
  footer = null,
}) {
  if (!active || !payload?.length) return null;

  const formattedLabel = typeof labelFormatter === "function" ? labelFormatter(label) : label;
  const shouldShowLabel = !hideLabel && formattedLabel;

  if (variant === "pie") {
    const item = payload[0];
    const name = resolveSeriesLabel(item, labelMap);
    const percent = resolvePercentValue(item);
    const rawValue = Number(item?.value);
    const valueText = formatValue(item?.value, valueFormatter, unit, item);
    const shouldShowPercent = showPercent
      && Number.isFinite(percent)
      && !(unit === "%" && Number.isFinite(rawValue) && Math.abs(percent - rawValue) < 0.5);
    const percentText = shouldShowPercent ? ` (${formatPercent(percent)}%)` : "";

    return (
      <div className={className}>
        {shouldShowLabel ? <span className="ig-tooltip__title">{formattedLabel}</span> : null}
        <div className="ig-tooltip__row">
          <span>{name}:</span>
          <strong>{`${valueText}${percentText}`}</strong>
        </div>
        {footer ? footer : null}
      </div>
    );
  }

  return (
    <div className={className}>
      {shouldShowLabel ? <span className="ig-tooltip__title">{formattedLabel}</span> : null}
      {payload.map((item) => {
        const seriesLabel = resolveSeriesLabel(item, labelMap);
        if (!seriesLabel) return null;
        const valueText = formatValue(item?.value, valueFormatter, unit, item);
        const color = item?.color || item?.payload?.fill || "var(--text-secondary)";
        return (
          <div key={`${seriesLabel}-${item?.dataKey || item?.value}`} className="ig-tooltip__row">
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: color }} />
              {seriesLabel}
            </span>
            <strong>{valueText}</strong>
          </div>
        );
      })}
      {footer ? footer : null}
    </div>
  );
}
