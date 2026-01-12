const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const MEDIUM_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const LONG_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

const trimTrailingZero = (value) => value.replace(/\.0$/, "");

const parseChartDate = (value) => {
  if (!value && value !== 0) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{2}\/\d{2}$/.test(trimmed)) return null;
    if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed) && !/^\d{4}\//.test(trimmed)) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

export const formatChartDate = (value, mode = "short") => {
  if (!value && value !== 0) return "";
  const parsed = parseChartDate(value);
  if (!parsed) return String(value);
  if (mode === "long") return LONG_DATE_FORMATTER.format(parsed);
  if (mode === "medium") return MEDIUM_DATE_FORMATTER.format(parsed);
  return SHORT_DATE_FORMATTER.format(parsed);
};

export const formatTooltipNumber = (value, options = {}) => {
  if (value === null || value === undefined) return "--";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const { maximumFractionDigits = 2 } = options;
  const hasDecimals = Math.abs(numeric % 1) > 0;
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: hasDecimals ? maximumFractionDigits : 0,
  }).format(numeric);
};

export const formatCompactNumber = (value, options = {}) => {
  if (value === null || value === undefined) return "--";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const { maximumFractionDigits = 1 } = options;
  const abs = Math.abs(numeric);
  const sign = numeric < 0 ? "-" : "";
  if (abs >= 1_000_000_000) {
    return `${sign}${trimTrailingZero((abs / 1_000_000_000).toFixed(maximumFractionDigits))}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${trimTrailingZero((abs / 1_000_000).toFixed(maximumFractionDigits))}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${trimTrailingZero((abs / 1_000).toFixed(maximumFractionDigits))}k`;
  }
  return new Intl.NumberFormat("pt-BR").format(numeric);
};

export const formatPercent = (value, options = {}) => {
  if (!Number.isFinite(value)) return "--";
  const { maximumFractionDigits = 1 } = options;
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits }).format(normalized);
};
