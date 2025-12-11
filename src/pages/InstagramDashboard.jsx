import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useLocation, useOutletContext } from "react-router-dom";
import {
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  startOfDay,
  startOfMonth,
  subDays,
  eachDayOfInterval,
} from "date-fns";
import {
  ResponsiveContainer,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  Sector,
  Brush,
} from "recharts";
import {
  BarChart3,
  Bookmark,
  FileText,
  Facebook,
  Hash,
  Heart,
  Instagram as InstagramIcon,
  MessageCircle,
  Share2,
  Settings,
  Shield,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import useQueryState from "../hooks/useQueryState";
import { useAccounts } from "../context/AccountsContext";
import { DEFAULT_ACCOUNTS } from "../data/accounts";
import WordCloudCard from "../components/WordCloudCard";
import { useAuth } from "../context/AuthContext";
import { getDashboardCache, makeDashboardCacheKey, setDashboardCache } from "../lib/dashboardCache";

const API_BASE_URL = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");
const FALLBACK_ACCOUNT_ID = DEFAULT_ACCOUNTS[0]?.id || "";
const HASHTAG_REGEX = /#([A-Za-z0-9_]+)/g;
const STOP_WORDS = new Set([
  "a", "ao", "aos", "as", "com", "da", "das", "de", "do", "dos", "e", "em", "no", "nos", "na", "nas", "o", "os", "para",
  "por", "que", "se", "sem", "um", "uma", "uns", "umas", "foi", "sao", "ser", "como", "mais", "mas", "ja", "vai",
  "tem", "ter", "pra", "nosso", "nossa", "seu", "sua", "the", "and", "of",
]);

const IG_TOPBAR_PRESETS = [
  { id: "7d", label: "7 dias", days: 7 },
  { id: "1m", label: "1 mês", days: 30 },
  { id: "3m", label: "3 meses", days: 90 },
  { id: "6m", label: "6 meses", days: 180 },
  { id: "1y", label: "1 ano", days: 365 },
];

const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTH_SHORT_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const DEFAULT_GENDER_STATS = [
  { name: "Homens", value: 30 },
  { name: "Mulheres", value: 70 },
];

const DEFAULT_AUDIENCE_TYPE = [
  { name: "Não Seguidores", value: 35 },
  { name: "Seguidores", value: 65 },
];

const DEFAULT_PROFILE_REACH_SERIES = [
  { dateKey: "2025-01-29", label: "29/01", value: 12000 },
  { dateKey: "2025-01-30", label: "30/01", value: 28000 },
  { dateKey: "2025-01-31", label: "31/01", value: 78000 },
  { dateKey: "2025-02-01", label: "01/02", value: 36000 },
  { dateKey: "2025-02-02", label: "02/02", value: 42000 },
  { dateKey: "2025-02-03", label: "03/02", value: 48000 },
  { dateKey: "2025-02-04", label: "04/02", value: 32000 },
  { dateKey: "2025-02-05", label: "05/02", value: 89000 },
  { dateKey: "2025-02-06", label: "06/02", value: 27000 },
];

// const HEATMAP_WEEK_LABELS = ["Sem 1", "Sem 2", "Sem 3", "Sem 4", "Sem 5", "Sem 6"];
// const HEATMAP_DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];
// const DEFAULT_HEATMAP_MATRIX = HEATMAP_DAY_LABELS.map((day, dayIndex) => ({
//   day,
//   values: HEATMAP_WEEK_LABELS.map((_, weekIndex) => ((dayIndex + weekIndex) % 6) + 1),
// }));

const buildWeeklyPattern = (values) => {
  const max = Math.max(...values, 0);
  return values.map((value, index) => ({
    label: WEEKDAY_LABELS[index] || "",
    value,
    percentage: max > 0 ? Math.round((value / max) * 100) : 0,
    active: max > 0 && value === max,
  }));
};

const FOLLOWER_GROWTH_SERIES = [
  { label: "Jan", value: 28000 },
  { label: "Fev", value: 58000 },
  { label: "Mar", value: 12000 },
  { label: "Abr", value: 36000 },
  { label: "Mai", value: 58000 },
  { label: "Jun", value: 18000 },
  { label: "Jul", value: 28000 },
  { label: "Ago", value: 88000 },
  { label: "Set", value: 26000 },
  { label: "Out", value: 34000 },
  { label: "Nov", value: 9000 },
  { label: "Dez", value: 52000 },
];

const FALLBACK_CALENDAR_MONTH_OPTIONS = [
  { value: "2025-08", label: "Agosto 2025", year: 2025, month: 7 },
  { value: "2025-09", label: "Setembro 2025", year: 2025, month: 8 },
  { value: "2025-10", label: "Outubro 2025", year: 2025, month: 9 },
  { value: "2025-11", label: "Novembro 2025", year: 2025, month: 10 },
];

const HERO_TABS = [
  { id: "instagram", label: "Instagram", href: "/instagram", icon: InstagramIcon },
  { id: "facebook", label: "Facebook", href: "/facebook", icon: Facebook },
  { id: "ads", label: "Ads", href: "/ads", icon: BarChart3 },
  { id: "reports", label: "Relatórios", href: "/relatorios", icon: FileText },
  { id: "settings", label: "Configurações", href: "/configuracoes", icon: Settings },
  { id: "admin", label: "Admin", href: "/admin", icon: Shield },
];

const toUnixSeconds = (date) => Math.floor(date.getTime() / 1000);

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

const mapByKey = (items) => {
  const map = {};
  (items || []).forEach((item) => {
    if (item && item.key) map[item.key] = item;
  });
  return map;
};

const safeParseJson = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    console.warn("Falha ao converter resposta JSON", err);
    return null;
  }
};
const describeApiError = (payload, fallback) => {
  if (!payload) return fallback;
  if (payload.error) {
    return payload.graph?.code ? `${payload.error} (Graph code ${payload.graph.code})` : payload.error;
  }
  return payload.message || fallback;
};

const normalizeNumericString = (value) => (
  String(value)
    .replace(/\s+/g, "")
    .replace(/[.,](?=\d{3}(\D|$))/g, "")
    .replace(",", ".")
);

const tryParseNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = normalizeNumericString(value);
    if (!normalized.length) return null;
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") {
    const candidatePaths = [
      ["value"],
      ["count"],
      ["total"],
      ["totalCount"],
      ["total_count"],
      ["summary", "total"],
      ["summary", "totalCount"],
      ["summary", "total_count"],
      ["summary", "count"],
      ["summary", "value"],
    ];
    for (const path of candidatePaths) {
      let current = value;
      for (const key of path) {
        if (current === null || current === undefined) break;
        current = current[key];
      }
      const parsed = tryParseNumber(current);
      if (parsed !== null) return parsed;
    }
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const extractNumber = (value, fallback = 0) => {
  const parsed = tryParseNumber(value);
  return parsed !== null ? parsed : fallback;
};

const pickFirstNumber = (candidates, fallback = 0) => {
  for (const candidate of candidates) {
    const parsed = tryParseNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return fallback;
};

const getNestedValue = (object, path) => {
  if (!object) return null;
  const segments = Array.isArray(path) ? path : String(path).split(".");
  let current = object;
  for (const segment of segments) {
    if (current === null || current === undefined) return null;
    current = current[segment];
  }
  return current;
};

const POST_METRIC_PATHS = {
  likes: [
    ["likeCount"],
    ["like_count"],
    ["likes"],
    ["metrics", "likes"],
    ["metrics", "likes", "value"],
    ["insights", "likes"],
    ["insights", "likes", "value"],
  ],
  comments: [
    ["commentsCount"],
    ["comments_count"],
    ["commentCount"],
    ["comment_count"],
    ["comments"],
    ["comments", "summary"],
    ["comments", "summary", "count"],
    ["comments", "summary", "total"],
    ["comments", "summary", "total_count"],
    ["commentsSummary"],
    ["commentsSummary", "count"],
    ["commentsSummary", "total"],
    ["commentsSummary", "total_count"],
    ["comments_summary"],
    ["comments_summary", "count"],
    ["comments_summary", "total"],
    ["comments_summary", "total_count"],
    ["metrics", "comments"],
    ["metrics", "comments", "value"],
    ["insights", "comments"],
    ["insights", "comments", "value"],
  ],
  shares: [
    ["shares"],
    ["shareCount"],
    ["share_count"],
    ["metrics", "shares"],
    ["metrics", "shares", "value"],
    ["insights", "shares"],
    ["insights", "shares", "value"],
  ],
  saves: [
    ["saved"],
    ["saves"],
    ["saveCount"],
    ["save_count"],
    ["metrics", "saves"],
    ["metrics", "saves", "value"],
    ["insights", "saves"],
    ["insights", "saves", "value"],
  ],
  reach: [
    ["reach"],
    ["reachCount"],
    ["reach_count"],
    ["metrics", "reach"],
    ["metrics", "reach", "value"],
    ["metrics", "reach", "total"],
    ["metrics", "reach", "summary", "total"],
    ["insights", "reach"],
    ["insights", "reach", "value"],
    ["insights", "reach", "total"],
    ["insights", "reach", "summary", "total"],
  ],
};

const resolvePostMetric = (post, metric, fallback = 0) => {
  const paths = POST_METRIC_PATHS[metric] || [];
  const candidates = paths.map((path) => getNestedValue(post, path));
  return pickFirstNumber(candidates, fallback);
};

const sumInteractions = (post) => {
  const likes = resolvePostMetric(post, "likes");
  const comments = resolvePostMetric(post, "comments");
  const shares = resolvePostMetric(post, "shares");
  const saves = resolvePostMetric(post, "saves");
  return likes + comments + shares + saves;
};

const truncate = (text, length = 120) => {
  if (!text) return "";
  return text.length <= length ? text : `${text.slice(0, length - 3)}...`;
};
const toUtcDateString = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return undefined;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const parseQueryDate = (value) => {
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeDateKey = (input) => {
  if (!input) return null;
  const date = typeof input === "number"
    ? new Date(input > 1_000_000_000_000 ? input : input * 1000)
    : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const normalizeSeriesContainer = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object") {
    if (Array.isArray(raw.data)) return raw.data;
    if (Array.isArray(raw.values)) return raw.values;
    if (Array.isArray(raw.timeline)) return raw.timeline;
    if (Array.isArray(raw.points)) return raw.points;
    return Object.entries(raw).map(([dateKey, value]) => ({
      __dateKey: dateKey,
      value,
    }));
  }
  return [];
};

const normalizeSeriesEntry = (entry) => {
  if (entry == null) return null;
  if (Array.isArray(entry)) {
    if (entry.length === 0) return null;
    if (entry.length === 1) return { value: entry[0] };
    return { __dateKey: entry[0], value: entry[1] };
  }
  if (typeof entry === "number" || typeof entry === "string") {
    return { value: entry };
  }
  if (typeof entry === "object") {
    return entry;
  }
  return null;
};

const seriesFromMetric = (metric) => {
  if (!metric) return [];
  const candidateKeys = ["timeline", "timeseries", "series", "history", "values", "data"];
  for (const key of candidateKeys) {
    const entries = normalizeSeriesContainer(metric[key]);
    if (!entries.length) continue;
    const normalized = entries
      .map((rawEntry) => {
        const entry = normalizeSeriesEntry(rawEntry);
        if (!entry) return null;
        const dateKey = normalizeDateKey(
          entry.date ||
          entry.end_time ||
          entry.endTime ||
          entry.timestamp ||
          entry.period ||
          entry.label ||
          entry.__dateKey,
        );
        if (!dateKey) return null;
        const value = extractNumber(
          entry.value ?? entry.count ?? entry.total ?? entry.metric ?? entry.amount ?? entry.sum,
          null,
        );
        if (value == null) return null;
        return { date: dateKey, value };
      })
      .filter(Boolean);
    if (normalized.length) return normalized;
  }
  return [];
};

const formatNumber = (value) => {
  if (value === null || value === undefined) return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  if (Math.abs(numeric) >= 1000) {
    return numeric.toLocaleString("pt-BR");
  }
  return numeric.toString();
};

const classifyMediaType = (post) => {
  const rawMediaType = String(post.mediaType || post.media_type || "").toUpperCase();
  const mediaProductType = String(post.mediaProductType || post.media_product_type || "").toUpperCase();
  const hasChildren = Array.isArray(post.children) && post.children.length > 1;
  const isCarouselType = (value) => value.includes("CAROUSEL") || value.includes("ALBUM");
  if (isCarouselType(rawMediaType) || isCarouselType(mediaProductType) || hasChildren) return "CAROUSEL";
  if (rawMediaType === "VIDEO" || rawMediaType === "REEL" || mediaProductType === "REEL" || mediaProductType === "VIDEO") return "VIDEO";
  return "IMAGE";
};

const analyzeBestTimes = (posts) => {
  if (!Array.isArray(posts) || posts.length === 0) {
    return {
      bestDay: "",
      bestTimeRange: "",
      avgEngagement: 0,
      confidence: "baixa",
    };
  }

  const dayTotals = new Map();
  const hourTotals = new Map();

  posts.forEach((post) => {
    if (!post.timestamp) return;
    const date = new Date(post.timestamp);
    if (Number.isNaN(date.getTime())) return;
    const engagement = sumInteractions(post);

    const dayName = date.toLocaleDateString("pt-BR", { weekday: "long" });
    const dayLabel = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    const hour = date.getHours();

    dayTotals.set(dayLabel, (dayTotals.get(dayLabel) || 0) + engagement);
    hourTotals.set(hour, (hourTotals.get(hour) || 0) + engagement);
  });

  const bestDay = Array.from(dayTotals.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  let bestHourStart = 0;
  let bestHourValue = -Infinity;
  for (let hour = 0; hour <= 21; hour += 1) {
    const total = (hourTotals.get(hour) || 0)
      + (hourTotals.get(hour + 1) || 0)
      + (hourTotals.get(hour + 2) || 0);
    if (total > bestHourValue) {
      bestHourValue = total;
      bestHourStart = hour;
    }
  }

  const bestTimeRange = `${String(bestHourStart).padStart(2, "0")}:00 - ${String(bestHourStart + 3).padStart(2, "0")}:00`;
  const avgEngagement = Math.round(posts.reduce((sum, post) => sum + sumInteractions(post), 0) / posts.length);
  let confidence = "baixa";
  if (posts.length >= 30) confidence = "alta";
  else if (posts.length >= 15) confidence = "media";

  return { bestDay, bestTimeRange, avgEngagement, confidence };
};

const buildKeywordFrequency = (posts) => {
  const counts = new Map();
  posts.forEach((post) => {
    if (!post.caption) return;
    const normalized = post.caption
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, " ");
    const words = normalized.split(/[^a-z0-9a-y]+/i).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
    words.forEach((word) => {
      counts.set(word, (counts.get(word) || 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word, value]) => ({ word, value }));
};

const buildHashtagFrequency = (posts) => {
  const counts = new Map();
  posts.forEach((post) => {
    if (!post.caption) return;
    const matches = post.caption.matchAll(HASHTAG_REGEX);
    for (const match of matches) {
      const tag = match[1]?.toLowerCase();
      if (tag) counts.set(`#${tag}`, (counts.get(`#${tag}`) || 0) + 1);
    }
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, value]) => ({ name, value }));
};

const IG_DONUT_COLORS = ["#8b5cf6", "#f97316", "#ec4899", "#14b8a6"];
const IG_CONTENT_LABEL = {
  IMAGE: "Imagem",
  VIDEO: "Vídeo",
  CAROUSEL: "Carrossel",
};

const BubbleTooltip = ({ active, payload, suffix = "" }) => {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const label = item?.name || item?.payload?.name || "";
  const value = Number(item?.value ?? item?.payload?.value ?? 0);

  return (
    <div className="ig-bubble-tooltip">
      <span>{label}</span>
      <strong>{`${value.toLocaleString("pt-BR")}${suffix}`}</strong>
    </div>
  );
};

const renderActiveShape = (props) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;

  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 10}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
    </g>
  );
};

const renderActiveGenderShape = (props) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;

  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 8}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
    </g>
  );
};
export default function InstagramDashboard() {
  const outlet = useOutletContext() || {};
  const { setTopbarConfig, resetTopbarConfig } = outlet;
  const location = useLocation();
  const { apiFetch } = useAuth();
  const { accounts, loading: accountsLoading } = useAccounts();
  const availableAccounts = accounts.length ? accounts : DEFAULT_ACCOUNTS;
  const [getQuery, setQuery] = useQueryState({ account: FALLBACK_ACCOUNT_ID });
  const queryAccountId = getQuery("account");

  useEffect(() => {
    if (!availableAccounts.length) return;
    if (!queryAccountId) {
      setQuery({ account: availableAccounts[0].id });
      return;
    }
    if (!accountsLoading && !availableAccounts.some((account) => account.id === queryAccountId)) {
      setQuery({ account: availableAccounts[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableAccounts.length, queryAccountId, accountsLoading]);

  const accountId = queryAccountId && availableAccounts.some((account) => account.id === queryAccountId)
    ? queryAccountId
    : availableAccounts[0]?.id || "";

  const accountConfig = useMemo(
    () => availableAccounts.find((item) => item.id === accountId) || null,
    [availableAccounts, accountId],
  );

  const accountSnapshotKey = useMemo(
    () => accountConfig?.instagramUserId || accountConfig?.id || "",
    [accountConfig?.id, accountConfig?.instagramUserId],
  );

  const sinceParam = getQuery("since");
  const untilParam = getQuery("until");
  const metricsCacheKey = useMemo(
    () => makeDashboardCacheKey("instagram-metrics", accountSnapshotKey, sinceParam || "auto", untilParam || "auto"),
    [accountSnapshotKey, sinceParam, untilParam],
  );
  const postsCacheKey = useMemo(
    () => makeDashboardCacheKey("instagram-posts", accountSnapshotKey, sinceParam || "auto", untilParam || "auto"),
    [accountSnapshotKey, sinceParam, untilParam],
  );
  const sinceDate = useMemo(() => parseQueryDate(sinceParam), [sinceParam]);
  const untilDate = useMemo(() => parseQueryDate(untilParam), [untilParam]);
  const sinceIso = useMemo(() => toUtcDateString(sinceDate), [sinceDate]);
  const untilIso = useMemo(() => toUtcDateString(untilDate), [untilDate]);

  // Estado para contador de comentários da wordcloud
  const [commentsCount, setCommentsCount] = useState(null);

  const now = useMemo(() => new Date(), []);
  const defaultEnd = useMemo(() => endOfDay(subDays(startOfDay(now), 1)), [now]);

  useEffect(() => {
    if (sinceDate && untilDate) return;
    const defaultPreset = IG_TOPBAR_PRESETS.find((item) => item.id === "7d") || IG_TOPBAR_PRESETS[0];
    if (!defaultPreset?.days || defaultPreset.days <= 0) return;
    const endDate = defaultEnd;
    const startDate = startOfDay(subDays(endDate, defaultPreset.days - 1));
    setQuery({
      since: toUnixSeconds(startDate),
      until: toUnixSeconds(endDate),
    });
  }, [defaultEnd, setQuery, sinceDate, untilDate]);

  const activePreset = useMemo(() => {
    if (!sinceDate || !untilDate) return "custom";
    const diff = differenceInCalendarDays(endOfDay(untilDate), startOfDay(sinceDate)) + 1;
    const preset = IG_TOPBAR_PRESETS.find((item) => item.days === diff);
    return preset?.id ?? "custom";
  }, [sinceDate, untilDate]);

  const handlePresetSelect = useCallback(
    (presetId) => {
      const preset = IG_TOPBAR_PRESETS.find((item) => item.id === presetId);
      if (!preset?.days || preset.days <= 0) return;
      const endDate = defaultEnd;
      const startDate = startOfDay(subDays(endDate, preset.days - 1));
      setQuery({
        since: toUnixSeconds(startDate),
        until: toUnixSeconds(endDate),
      });
    },
    [defaultEnd, setQuery],
  );

  const handleDateChange = useCallback(
    (start, end) => {
      if (!start || !end) return;
      const normalizedStart = startOfDay(start);
      const normalizedEnd = endOfDay(end);
      setQuery({
        since: toUnixSeconds(normalizedStart),
        until: toUnixSeconds(normalizedEnd),
      });
    },
    [setQuery],
  );

  useEffect(() => {
    if (!setTopbarConfig) return undefined;
    setTopbarConfig({
      hidden: false,
      presets: IG_TOPBAR_PRESETS,
      selectedPreset: activePreset,
      onPresetSelect: handlePresetSelect,
      onDateChange: handleDateChange,
    });
    return () => resetTopbarConfig?.();
  }, [
    activePreset,
    handleDateChange,
    handlePresetSelect,
    resetTopbarConfig,
    setTopbarConfig,
  ]);
  const [metrics, setMetrics] = useState([]);
  const [metricsError, setMetricsError] = useState("");
  const [metricsLoading, setMetricsLoading] = useState(false);

  const [posts, setPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [postsError, setPostsError] = useState("");

  const calendarMonthOptions = useMemo(() => {
    const monthMap = new Map();
    posts.forEach((post) => {
      if (!post?.timestamp) return;
      const dateObj = new Date(post.timestamp);
      if (Number.isNaN(dateObj.getTime())) return;
      const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}`;
      if (monthMap.has(key)) return;
      monthMap.set(key, {
        value: key,
        label: dateObj.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
        year: dateObj.getFullYear(),
        month: dateObj.getMonth(),
      });
    });

    if (!monthMap.size) {
      return FALLBACK_CALENDAR_MONTH_OPTIONS;
    }

    return Array.from(monthMap.values()).sort((a, b) => {
      if (a.year === b.year) return b.month - a.month;
      return b.year - a.year;
    });
  }, [posts]);

  const defaultCalendarValue = useMemo(() => {
    const fallbackValue = calendarMonthOptions[0]?.value
      || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

    if (untilDate) {
      const candidate = `${untilDate.getFullYear()}-${String(untilDate.getMonth() + 1).padStart(2, "0")}`;
      if (calendarMonthOptions.some((option) => option.value === candidate)) {
        return candidate;
      }
    }

    return fallbackValue;
  }, [calendarMonthOptions, untilDate]);

  const [calendarMonth, setCalendarMonth] = useState(defaultCalendarValue);

  useEffect(() => {
    setCalendarMonth((current) => (current === defaultCalendarValue ? current : defaultCalendarValue));
  }, [defaultCalendarValue]);

  const [accountInfo, setAccountInfo] = useState(null);
  const [followerSeries, setFollowerSeries] = useState([]);
  const [followerCounts, setFollowerCounts] = useState(null);
  const [overviewSnapshot, setOverviewSnapshot] = useState(null);
  const [reachCacheSeries, setReachCacheSeries] = useState([]);
  const [activeFollowerGrowthBar, setActiveFollowerGrowthBar] = useState(-1);
  const [activeEngagementIndex, setActiveEngagementIndex] = useState(-1);
  const [activeGenderIndex, setActiveGenderIndex] = useState(-1);

  const activeSnapshot = useMemo(
    () => (overviewSnapshot?.accountId === accountSnapshotKey && accountSnapshotKey ? overviewSnapshot : null),
    [accountSnapshotKey, overviewSnapshot],
  );

  useEffect(() => {
    const cachedMetrics = getDashboardCache(metricsCacheKey);
    if (cachedMetrics) {
      setMetrics(Array.isArray(cachedMetrics.metrics) ? cachedMetrics.metrics : []);
      setFollowerSeries(Array.isArray(cachedMetrics.followerSeries) ? cachedMetrics.followerSeries : []);
      setFollowerCounts(cachedMetrics.followerCounts ?? null);
      setReachCacheSeries(Array.isArray(cachedMetrics.reachSeries) ? cachedMetrics.reachSeries : []);
      setMetricsError("");
      setMetricsLoading(false);
    } else {
      setMetrics([]);
      setFollowerSeries([]);
      setFollowerCounts(null);
      setReachCacheSeries([]);
      setOverviewSnapshot(null);
    }

    const cachedPosts = getDashboardCache(postsCacheKey);
    if (cachedPosts) {
      setPosts(Array.isArray(cachedPosts.posts) ? cachedPosts.posts : []);
      setAccountInfo(cachedPosts.accountInfo || null);
      setPostsError("");
      setLoadingPosts(false);
    } else {
      setPosts([]);
      setAccountInfo(null);
    }
  }, [metricsCacheKey, postsCacheKey]);

  useEffect(() => {
    if (!accountConfig?.instagramUserId) {
      setMetrics([]);
      setFollowerSeries([]);
      setFollowerCounts(null);
      setReachCacheSeries([]);
      setOverviewSnapshot(null);
      setMetricsLoading(false);
      setMetricsError("Conta do Instagram não configurada.");
      return;
    }

    const cachedMetrics = getDashboardCache(metricsCacheKey);
    if (cachedMetrics) {
      setMetrics(Array.isArray(cachedMetrics.metrics) ? cachedMetrics.metrics : []);
      setFollowerSeries(Array.isArray(cachedMetrics.followerSeries) ? cachedMetrics.followerSeries : []);
      setFollowerCounts(cachedMetrics.followerCounts ?? null);
      setReachCacheSeries(Array.isArray(cachedMetrics.reachSeries) ? cachedMetrics.reachSeries : []);
      setMetricsError("");
      setMetricsLoading(false);
      return undefined;
    }

    const preset = IG_TOPBAR_PRESETS.find((item) => item.id === "7d") || IG_TOPBAR_PRESETS[0];
    const fallbackStart = startOfDay(subDays(defaultEnd, (preset?.days ?? 7) - 1));
    const effectiveSince = sinceDate || fallbackStart;
    const effectiveUntil = untilDate || defaultEnd;

    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      setMetricsLoading(true);
      setMetricsError("");
      setOverviewSnapshot(null);
      setMetrics([]);
      setFollowerSeries([]);
      setFollowerCounts(null);
      setReachCacheSeries([]);
      try {
        const params = new URLSearchParams();
        params.set("since", toUnixSeconds(startOfDay(effectiveSince)));
        params.set("until", toUnixSeconds(endOfDay(effectiveUntil)));
        params.set("igUserId", accountConfig.instagramUserId);
        const url = `${API_BASE_URL}/api/instagram/metrics?${params.toString()}`;
        const resp = await fetch(url, { signal: controller.signal });
        const json = safeParseJson(await resp.text()) || {};
        if (!resp.ok) throw new Error(describeApiError(json, "Falha ao carregar metricas do Instagram."));
        if (cancelled) return;
        const fetchedMetrics = json.metrics || [];
        const fetchedFollowerSeries = Array.isArray(json.follower_series) ? json.follower_series : [];
        const fetchedFollowerCounts = json.follower_counts || null;
        const reachSeries = Array.isArray(json.reach_timeseries)
          ? json.reach_timeseries
            .map((entry) => {
              if (!entry) return null;
              const dateRaw = entry.date || entry.metric_date || entry.end_time || entry.start_time || entry.label;
              if (!dateRaw) return null;
              const numericValue = extractNumber(entry.value, null);
              if (numericValue === null) return null;
              return {
                date: dateRaw,
                value: numericValue,
              };
            })
            .filter(Boolean)
          : [];
        if (cancelled) return;
        setMetrics(fetchedMetrics);
        setFollowerSeries(fetchedFollowerSeries);
        setFollowerCounts(fetchedFollowerCounts);
        setReachCacheSeries(reachSeries);
        setDashboardCache(metricsCacheKey, {
          metrics: fetchedMetrics,
          followerSeries: fetchedFollowerSeries,
          followerCounts: fetchedFollowerCounts,
          reachSeries,
        });
      } catch (err) {
        if (!cancelled && err.name !== "AbortError") {
          setMetrics([]);
          setFollowerSeries([]);
          setFollowerCounts(null);
          setReachCacheSeries([]);
          setMetricsError(err.message || "Não foi possível atualizar.");
        }
      } finally {
        if (!cancelled) {
          setMetricsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accountConfig?.instagramUserId, sinceDate, untilDate, defaultEnd, sinceParam, untilParam, metricsCacheKey]);

  useEffect(() => {
    if (!accountConfig?.instagramUserId) {
      setPosts([]);
      setAccountInfo(null);
      setPostsError("Conta do Instagram não configurada.");
      return undefined;
    }

    const cachedPosts = getDashboardCache(postsCacheKey);
    if (cachedPosts) {
      setPosts(Array.isArray(cachedPosts.posts) ? cachedPosts.posts : []);
      setAccountInfo(cachedPosts.accountInfo || null);
      setPostsError("");
      setLoadingPosts(false);
      return undefined;
    }

    let cancelled = false;
    const loadPosts = async () => {
      setLoadingPosts(true);
      setPostsError("");
      try {
        const params = new URLSearchParams({ igUserId: accountConfig.instagramUserId, limit: "20" });
        if (sinceParam) params.set("since", sinceParam);
        if (untilParam) params.set("until", untilParam);
        const resp = await apiFetch(`/api/instagram/posts?${params.toString()}`);
        if (cancelled) return;
        const normalizedPosts = Array.isArray(resp?.posts) ? resp.posts : [];
        const account = resp?.account || null;
        setPosts(normalizedPosts);
        setAccountInfo(account);
        setDashboardCache(postsCacheKey, { posts: normalizedPosts, accountInfo: account });
      } catch (err) {
        if (cancelled) return;
        const rawMessage = err?.message || "";
        const friendlyMessage = rawMessage.includes("<") ? "Não foi possível carregar os posts (erro 502)." : rawMessage;
        setPosts([]);
        setAccountInfo(null);
        setPostsError(friendlyMessage || "Não foi possível carregar os posts.");
      } finally {
        if (!cancelled) {
          setLoadingPosts(false);
        }
      }
    };

    loadPosts();
    return () => {
      cancelled = true;
    };
  }, [accountConfig?.instagramUserId, apiFetch, sinceParam, untilParam, postsCacheKey]);

  const metricsByKey = useMemo(() => mapByKey(metrics), [metrics]);
  const reachMetric = metricsByKey.reach;
  const followersMetric = metricsByKey.followers_total;
  const followerGrowthMetric = metricsByKey.follower_growth;
  const engagementRateMetric = metricsByKey.engagement_rate;

  const reachMetricValue = useMemo(() => extractNumber(reachMetric?.value, null), [reachMetric?.value]);
  const timelineReachSeries = useMemo(() => seriesFromMetric(reachMetric), [reachMetric]);
  const followerSeriesNormalized = useMemo(() => (followerSeries || [])
    .map((entry) => {
      const dateKey = normalizeDateKey(entry.date || entry.end_time || entry.endTime);
      if (!dateKey) return null;
      return { date: dateKey, value: extractNumber(entry.value, null) };
    })
    .filter(Boolean), [followerSeries]);
  const followerSeriesInRange = useMemo(() => {
    if (!followerSeriesNormalized.length) return [];
    const sorted = [...followerSeriesNormalized].sort((a, b) => {
      if (!a?.date) return -1;
      if (!b?.date) return 1;
      return a.date.localeCompare(b.date);
    });
    if (!sinceDate && !untilDate) {
      return sorted;
    }
    const startBoundary = sinceDate ? startOfDay(sinceDate).getTime() : null;
    const endBoundary = untilDate ? endOfDay(untilDate).getTime() : null;
    return sorted.filter((item) => {
      if (!item?.date) return false;
      const currentDate = new Date(`${item.date}T00:00:00`);
      const current = currentDate.getTime();
      if (Number.isNaN(current)) return false;
      if (startBoundary != null && current < startBoundary) return false;
      if (endBoundary != null && current > endBoundary) return false;
      return true;
    });
  }, [followerSeriesNormalized, sinceDate, untilDate]);

  const filteredPosts = useMemo(() => {
    if (!posts.length) return [];
    if (!sinceDate && !untilDate) return posts;
    return posts.filter((post) => {
      if (!post.timestamp) return true;
      const date = new Date(post.timestamp);
      if (Number.isNaN(date.getTime())) return true;
      if (sinceDate && date < sinceDate) return false;
      if (untilDate && date > untilDate) return false;
      return true;
    });
  }, [posts, sinceDate, untilDate]);

  // Calcula total de seguidores ganhos no período filtrado
  const followersDelta = useMemo(() => {
    if (metricsLoading) return null;
    const sumPositiveDiff = (series) => {
      if (!Array.isArray(series) || series.length < 2) return null;
      let prev = null;
      let total = 0;
      series.forEach((entry) => {
        const value = extractNumber(entry?.value, null);
        if (value == null) return;
        if (prev != null) {
          const diff = value - prev;
          if (Number.isFinite(diff) && diff > 0) {
            total += diff;
          }
        }
        prev = value;
      });
      return total > 0 ? total : 0;
    };

    const inRangePositive = sumPositiveDiff(followerSeriesInRange);
    if (Number.isFinite(inRangePositive) && inRangePositive > 0) {
      return Math.round(inRangePositive);
    }

    const normalizedPositive = sumPositiveDiff(followerSeriesNormalized);
    if (Number.isFinite(normalizedPositive) && normalizedPositive > 0) {
      return Math.round(normalizedPositive);
    }

    const computeNetDelta = (series) => {
      if (!Array.isArray(series) || series.length < 2) return null;
      const firstValue = extractNumber(series[0]?.value, null);
      const lastValue = extractNumber(series[series.length - 1]?.value, null);
      if (firstValue == null || lastValue == null) return null;
      const diff = lastValue - firstValue;
      return Number.isFinite(diff) ? diff : null;
    };

    const netDelta = computeNetDelta(followerSeriesInRange);
    if (Number.isFinite(netDelta)) {
      return Math.round(netDelta);
    }

    const fallbackNet = computeNetDelta(followerSeriesNormalized);
    if (Number.isFinite(fallbackNet)) {
      return Math.round(fallbackNet);
    }

    if (followerCounts) {
      const startCount = extractNumber(followerCounts.start, null);
      const endCount = extractNumber(followerCounts.end, null);
      if (startCount != null && endCount != null) {
        const diff = endCount - startCount;
        if (Number.isFinite(diff)) {
          return Math.round(diff);
        }
      }

      const followsCount = extractNumber(followerCounts.follows, null);
      const unfollowsCount = extractNumber(followerCounts.unfollows, null);
      if (followsCount != null || unfollowsCount != null) {
        const diff = (followsCount || 0) - (unfollowsCount || 0);
        if (Number.isFinite(diff)) {
          return Math.round(diff);
        }
      }
    }

    const fallbackMetric = extractNumber(followerGrowthMetric?.value, null);
    if (Number.isFinite(fallbackMetric)) {
      return Math.round(fallbackMetric);
    }

    return 0;
  }, [followerCounts, followerGrowthMetric?.value, followerSeriesInRange, followerSeriesNormalized, metricsLoading]);



  const reachTimelineFromCache = useMemo(() => {
    if (!reachCacheSeries.length) return [];
    return [...reachCacheSeries]
      .sort((a, b) => (a.date > b.date ? 1 : -1))
      .map(({ date, value }) => {
        const numericValue = extractNumber(value, 0);
        const parsedDate = new Date(`${date}T00:00:00`);
        return {
          dateKey: date,
          label: SHORT_DATE_FORMATTER.format(parsedDate),
          value: numericValue,
        };
      })
      .filter((entry) => Number.isFinite(entry.value));
  }, [reachCacheSeries]);

  const reachTimelineFromMetric = useMemo(() => {
    if (!timelineReachSeries.length) return [];
    return [...timelineReachSeries]
      .sort((a, b) => (a.date > b.date ? 1 : -1))
      .map(({ date, value }) => {
        const numericValue = extractNumber(value, 0);
        const parsedDate = new Date(`${date}T00:00:00`);
        return {
          dateKey: date,
          label: SHORT_DATE_FORMATTER.format(parsedDate),
          value: numericValue,
        };
      })
      .filter((entry) => Number.isFinite(entry.value));
  }, [timelineReachSeries]);

  const reachTimelineFromPosts = useMemo(() => {
    if (!filteredPosts.length) return [];
    const totals = new Map();
    filteredPosts.forEach((post) => {
      if (!post.timestamp) return;
      const dateObj = new Date(post.timestamp);
      if (Number.isNaN(dateObj.getTime())) return;
      const reachMetricValue = resolvePostMetric(post, "reach", null);
      const numericValue = reachMetricValue != null ? extractNumber(reachMetricValue, null) : null;
      if (numericValue == null) return;
      const key = dateObj.toISOString().slice(0, 10);
      totals.set(key, (totals.get(key) || 0) + numericValue);
    });
    return Array.from(totals.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dateKey, value]) => ({
        dateKey,
        label: SHORT_DATE_FORMATTER.format(new Date(`${dateKey}T00:00:00`)),
        value,
      }));
  }, [filteredPosts]);

  const reachSeriesBase = useMemo(() => {
    if (reachTimelineFromCache.length) return reachTimelineFromCache;
    if (reachTimelineFromMetric.length) return reachTimelineFromMetric;
    if (reachTimelineFromPosts.length) return reachTimelineFromPosts;
    return [];
  }, [reachTimelineFromCache, reachTimelineFromMetric, reachTimelineFromPosts]);

  const normalizedReachSeries = useMemo(() => {
    if (!reachSeriesBase.length) return [];
    const sinceKey = sinceDate ? normalizeDateKey(sinceDate) : null;
    const untilKey = untilDate ? normalizeDateKey(untilDate) : null;

    const resolveEntryDateKey = (entry) => {
      if (entry?.dateKey) return entry.dateKey;
      if (entry?.date) return normalizeDateKey(entry.date);
      if (entry?.end_time) return normalizeDateKey(entry.end_time);
      if (entry?.start_time) return normalizeDateKey(entry.start_time);
      if (entry?.label) {
        const parsed = normalizeDateKey(entry.label);
        if (parsed) return parsed;
      }
      return null;
    };

    return reachSeriesBase
      .map((entry) => ({
        ...entry,
        value: extractNumber(entry.value, 0),
      }))
      .filter((entry) => {
        const entryKey = resolveEntryDateKey(entry);
        if (!entryKey) return true;
        if (sinceKey && entryKey < sinceKey) return false;
        if (untilKey && entryKey > untilKey) return false;
        return true;
      });
  }, [reachSeriesBase, sinceDate, untilDate]);

  const profileReachData = useMemo(() => {
    if (metricsLoading) return [];
    const data = normalizedReachSeries.length
      ? normalizedReachSeries
      : metricsError
        ? []
        : DEFAULT_PROFILE_REACH_SERIES;

    // Limitar a 7 pontos de dados para melhor visualização
    if (data.length <= 7) return data;

    // Se houver mais de 7 pontos, distribuir uniformemente
    const step = Math.floor(data.length / 7);
    const sampledData = [];

    for (let i = 0; i < 7; i++) {
      const index = i === 6 ? data.length - 1 : i * step;
      sampledData.push(data[index]);
    }

    return sampledData;
  }, [metricsError, metricsLoading, normalizedReachSeries]);

  const profileReachTotal = useMemo(() => normalizedReachSeries.reduce(
    (acc, entry) => acc + (Number.isFinite(entry.value) ? entry.value : 0),
    0,
  ), [normalizedReachSeries]);

  const reachValue = useMemo(() => {
    if (metricsLoading) return null;
    if (reachMetricValue != null && reachMetricValue > 0) return reachMetricValue;
    if (normalizedReachSeries.length) {
      if (profileReachTotal > 0) return profileReachTotal;
      if (reachMetricValue != null) return reachMetricValue;
      return 0;
    }
    return reachMetricValue ?? null;
  }, [metricsLoading, normalizedReachSeries, profileReachTotal, reachMetricValue]);

  const hasReachData = useMemo(
    () => !metricsLoading && (normalizedReachSeries.length > 0 || reachMetricValue != null),
    [metricsLoading, normalizedReachSeries.length, reachMetricValue],
  );

  const peakReachPoint = useMemo(() => {
    if (!profileReachData.length) return null;
    return profileReachData.reduce(
      (currentMax, entry) => (entry.value > currentMax.value ? entry : currentMax),
      profileReachData[0],
    );
  }, [profileReachData]);

  useEffect(() => {
    setOverviewSnapshot(null);
  }, [accountSnapshotKey, sinceIso, untilIso]);

  const totalFollowers = useMemo(() => {
    if (metricsLoading) return null;
    const candidateValues = [
      activeSnapshot?.followers,
      accountInfo?.followers_count,
      accountInfo?.followers,
      getNestedValue(accountInfo, ["followers", "count"]),
      getNestedValue(accountInfo, ["insights", "followers"]),
      getNestedValue(accountInfo, ["insights", "followers", "value"]),
      followerCounts?.end ?? followerCounts?.total,
      followersMetric?.value,
    ];

    if (followerSeriesNormalized.length) {
      const lastPoint = followerSeriesNormalized[followerSeriesNormalized.length - 1];
      candidateValues.push(lastPoint?.value);
    }

    let zeroFallback = null;
    for (const rawValue of candidateValues) {
      const parsed = tryParseNumber(rawValue);
      if (parsed === null) continue;
      if (parsed > 0) return parsed;
      if (parsed === 0 && zeroFallback === null) {
        zeroFallback = 0;
      }
    }

    return zeroFallback ?? null;
  }, [
    accountInfo,
    activeSnapshot,
    followerCounts,
    followerSeriesNormalized,
    followersMetric,
    metricsLoading,
  ]);

  const engagementRateValue = tryParseNumber(engagementRateMetric?.value);

  const followerGrowthStats = useMemo(() => {
    const totalsByWeekday = Array.from({ length: 7 }, () => 0);
    if (followerSeriesNormalized.length >= 2) {
      let accumulatedGrowth = 0;
      for (let index = 1; index < followerSeriesNormalized.length; index += 1) {
        const previous = followerSeriesNormalized[index - 1];
        const current = followerSeriesNormalized[index];
        const diff = extractNumber(current.value, 0) - extractNumber(previous.value, 0);
        const positiveGrowth = diff > 0 ? diff : 0;
        accumulatedGrowth += positiveGrowth;
        if (positiveGrowth <= 0) continue;
        const dayRef = new Date(`${current.date}T00:00:00`);
        if (Number.isNaN(dayRef.getTime())) continue;
        const weekday = dayRef.getDay();
        totalsByWeekday[weekday] += positiveGrowth;
      }
      const samples = Math.max(1, followerSeriesNormalized.length - 1);
      return {
        average: Math.round(accumulatedGrowth / samples),
        weeklyPattern: buildWeeklyPattern(totalsByWeekday),
      };
    }
    const fallbackGrowth = Math.max(0, extractNumber(followerGrowthMetric?.value, 0));
    return {
      average: fallbackGrowth ? Math.round(fallbackGrowth / 30) : 0,
      weeklyPattern: buildWeeklyPattern(totalsByWeekday),
    };
  }, [followerSeriesNormalized, followerGrowthMetric?.value]);

  const avgFollowersPerDay = followerGrowthStats.average;

  const postsCount = filteredPosts.length;

  useEffect(() => {
    if (!accountSnapshotKey || metricsLoading) return;
    const hasValue = Number.isFinite(totalFollowers)
      || Number.isFinite(reachValue)
      || Number.isFinite(avgFollowersPerDay)
      || Number.isFinite(postsCount);
    if (!hasValue) return;
    setOverviewSnapshot({
      accountId: accountSnapshotKey,
      followers: Number.isFinite(totalFollowers) ? totalFollowers : null,
      reach: Number.isFinite(reachValue) ? reachValue : null,
      followersDaily: Number.isFinite(avgFollowersPerDay) ? avgFollowersPerDay : null,
      posts: Number.isFinite(postsCount) ? postsCount : null,
    });
  }, [
    accountSnapshotKey,
    avgFollowersPerDay,
    metricsLoading,
    postsCount,
    reachValue,
    totalFollowers,
  ]);

  const reachDisplayValue = hasReachData ? reachValue : null;

  const overviewMetrics = useMemo(() => {
    if (metricsLoading) {
      return {
        followers: null,
        reach: null,
        followersDaily: null,
        followersDelta: null,
        posts: null,
      };
    }

    return {
      followers: activeSnapshot?.followers ?? totalFollowers ?? null,
      reach: activeSnapshot?.reach ?? reachDisplayValue ?? null,
      followersDaily: activeSnapshot?.followersDaily
        ?? (Number.isFinite(avgFollowersPerDay) ? avgFollowersPerDay : null),
      followersDelta,
      posts: activeSnapshot?.posts ?? postsCount ?? null,
    };
  }, [
    activeSnapshot,
    avgFollowersPerDay,
    followersDelta,
    metricsLoading,
    postsCount,
    reachDisplayValue,
    totalFollowers,
  ]);

  const followerDeltaValue = useMemo(() => {
    if (metricsLoading) return null;
    const numeric = Number(overviewMetrics.followersDelta);
    return Number.isFinite(numeric) ? numeric : null;
  }, [metricsLoading, overviewMetrics.followersDelta]);

  const FollowerDeltaIcon = followerDeltaValue != null && followerDeltaValue < 0 ? TrendingDown : TrendingUp;
  const followerDeltaColor = followerDeltaValue == null
    ? "#9ca3af"
    : followerDeltaValue < 0
      ? "#ef4444"
      : followerDeltaValue > 0
        ? "#10b981"
        : "#9ca3af";

  const engagementRateDisplay = useMemo(() => (
    engagementRateValue != null
      ? `${engagementRateValue.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}%`
      : "--"
  ), [engagementRateValue]);

  const contentBreakdown = useMemo(() => {
    if (!filteredPosts.length) return [];
    const totals = new Map(Object.keys(IG_CONTENT_LABEL).map((type) => [type, 0]));
    filteredPosts.forEach((post) => {
      const kind = classifyMediaType(post);
      totals.set(kind, (totals.get(kind) || 0) + sumInteractions(post));
    });
    return Array.from(totals.entries()).map(([type, value]) => ({
      name: IG_CONTENT_LABEL[type] || type,
      value,
    }));
  }, [filteredPosts]);

  const postCalendar = useMemo(() => {
    const [calendarYear, calendarMonthIndex] = calendarMonth.split("-").map(Number);
    const baseDate = Number.isFinite(calendarYear) && Number.isFinite(calendarMonthIndex)
      ? new Date(calendarYear, calendarMonthIndex - 1, 1)
      : new Date();
    const monthStart = startOfMonth(baseDate);
    const monthEnd = endOfMonth(baseDate);

    const postsPerDay = new Map();
    posts.forEach((post) => {
      if (!post?.timestamp) return;
      const dateObj = new Date(post.timestamp);
      if (Number.isNaN(dateObj.getTime())) return;
      if (dateObj < monthStart || dateObj > monthEnd) return;
      const key = dateObj.toISOString().slice(0, 10);
      postsPerDay.set(key, (postsPerDay.get(key) || 0) + 1);
    });

    const days = eachDayOfInterval({ start: monthStart, end: monthEnd }).map((date) => {
      const key = date.toISOString().slice(0, 10);
      const count = postsPerDay.get(key) || 0;
      let level = 0;
      if (count > 0) {
        if (count === 1) level = 1;
        else if (count === 2) level = 2;
        else if (count === 3) level = 3;
        else if (count === 4) level = 4;
        else level = 5;
      }
      return {
        key,
        date,
        count,
        level,
        tooltip: `${count} ${count === 1 ? "publicação" : "publicações"}`,
      };
    });

    const leadingEmpty = monthStart.getDay();
    const trailingEmpty = (7 - ((leadingEmpty + days.length) % 7)) % 7;

    return {
      leadingEmpty,
      trailingEmpty,
      days,
      title: monthStart.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    };
  }, [calendarMonth, posts]);

  const bestTimes = useMemo(() => analyzeBestTimes(filteredPosts), [filteredPosts]);

  const topPosts = useMemo(() => (filteredPosts.length
    ? [...filteredPosts].sort((a, b) => sumInteractions(b) - sumInteractions(a)).slice(0, 6)
    : []), [filteredPosts]);

  const followerGrowthSeriesSorted = useMemo(() => {
    if (metricsLoading) return [];
    const source = followerSeriesInRange.length ? followerSeriesInRange : followerSeriesNormalized;
    if (!source.length) return [];
    return source
      .filter((entry) => entry?.date && Number.isFinite(entry.value))
      .sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [followerSeriesInRange, followerSeriesNormalized, metricsLoading]);

  const followerGrowthChartData = useMemo(() => {
    if (metricsLoading) return [];
    if (followerGrowthSeriesSorted.length) {
      const MAX_POINTS = 64;
      const seriesToUse = followerGrowthSeriesSorted.length > MAX_POINTS
        ? followerGrowthSeriesSorted.slice(followerGrowthSeriesSorted.length - MAX_POINTS)
        : followerGrowthSeriesSorted;

      let previousValue = null;
      return seriesToUse.map((entry, index) => {
        const dateKey = entry.date || null;
        const parsedDate = dateKey ? new Date(`${dateKey}T00:00:00`) : null;
        const validDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;
        const monthLabel = validDate ? MONTH_SHORT_PT[validDate.getMonth()] || "" : "";
        const dayLabel = validDate ? String(validDate.getDate()) : "";
        const label = validDate && monthLabel ? `${dayLabel}/${monthLabel}` : entry.label || `${index + 1}`;
        const tooltipDate = validDate && monthLabel
          ? `${String(validDate.getDate()).padStart(2, "0")} - ${monthLabel} - ${validDate.getFullYear()}`
          : dateKey || label;
        const currentValue = extractNumber(entry.value, null);
        let growthValue = 0;
        if (previousValue != null && currentValue != null) {
          const diff = currentValue - previousValue;
          growthValue = Number.isFinite(diff) ? Math.max(0, diff) : 0;
        }
        previousValue = currentValue != null ? currentValue : previousValue;
        return {
          label,
          value: growthValue,
          tooltipDate,
        };
      });
    }

    if (metricsError) return [];

    return FOLLOWER_GROWTH_SERIES.map((entry, index) => ({
      label: entry.label || `${index + 1}`,
      value: Math.max(0, extractNumber(entry.value, 0)),
      tooltipDate: entry.label || `#${index + 1}`,
    }));
  }, [followerGrowthSeriesSorted, metricsError, metricsLoading]);

  const followerGrowthDomain = useMemo(() => {
    if (!followerGrowthChartData.length) return [0, "auto"];
    const maxValue = followerGrowthChartData.reduce(
      (max, point) => Math.max(max, extractNumber(point.value, 0)),
      0,
    );
    if (maxValue <= 0) return [0, "auto"];
    const magnitude = 10 ** Math.floor(Math.log10(maxValue || 1));
    const rawStep = magnitude / 2;
    const step = Math.max(1, Math.round(rawStep));
    const adjustedMax = Math.ceil(maxValue / step) * step;
    return [0, adjustedMax];
  }, [followerGrowthChartData]);

  const followerGrowthTicks = useMemo(() => {
    if (!Array.isArray(followerGrowthDomain)) {
      return undefined;
    }
    const [, max] = followerGrowthDomain;
    if (typeof max !== "number" || max <= 0) return undefined;
    const magnitude = 10 ** Math.floor(Math.log10(max || 1));
    const rawStep = magnitude / 2;
    const step = Math.max(1, Math.round(rawStep));
    const ticks = [];
    for (let value = 0; value <= max; value += step) {
      ticks.push(value);
    }
    if (ticks[ticks.length - 1] !== max) {
      ticks.push(max);
    }
    return ticks;
  }, [followerGrowthDomain]);

  const followerGrowthPeakPoint = useMemo(() => {
    if (!followerGrowthChartData.length) return null;
    return followerGrowthChartData.reduce(
      (acc, point, index) => {
        const numeric = extractNumber(point.value, 0);
        if (numeric > acc.value) {
          return { value: numeric, index, label: point.label, tooltipDate: point.tooltipDate };
        }
        return acc;
      },
      {
        value: extractNumber(followerGrowthChartData[0].value, 0),
        index: 0,
        label: followerGrowthChartData[0].label,
        tooltipDate: followerGrowthChartData[0].tooltipDate,
      },
    );
  }, [followerGrowthChartData]);

  const highlightedFollowerGrowthIndex = activeFollowerGrowthBar >= 0
    ? activeFollowerGrowthBar
    : followerGrowthPeakPoint?.index ?? -1;

  const highlightedFollowerGrowthPoint = highlightedFollowerGrowthIndex >= 0
    ? followerGrowthChartData[highlightedFollowerGrowthIndex] ?? null
    : null;

  useEffect(() => {
    setActiveFollowerGrowthBar(-1);
  }, [accountSnapshotKey, followerGrowthChartData]);

  const genderDistribution = useMemo(() => {
    const breakdown =
      metricsByKey.audience_gender?.breakdown ||
      metricsByKey.gender?.breakdown ||
      metricsByKey.audience_gender_age?.breakdown ||
      metricsByKey.gender_distribution?.value ||
      accountInfo?.audience_gender;

    if (!breakdown) return [];
    const entries = Array.isArray(breakdown)
      ? breakdown
      : Object.entries(breakdown).map(([name, value]) => ({ name, value }));

    return entries
      .map((entry) => ({
        name: entry.name || entry.key || entry.label,
        value: extractNumber(entry.value ?? entry.count ?? entry.total, 0),
      }))
      .filter((entry) => entry.name && entry.value > 0);
  }, [metricsByKey, accountInfo]);

  const genderStatsSeries = useMemo(() => (
    genderDistribution.length
      ? genderDistribution.map((entry) => ({
        name: entry.name || "",
        value: Number(entry.value ?? 0),
      }))
      : DEFAULT_GENDER_STATS
  ), [genderDistribution]);

  // Série de dados para o gráfico de Audiência (Seguidores vs Não Seguidores)
  const audienceTypeSeries = useMemo(() => {
    // Tenta calcular a partir dos dados reais de alcance
    const reachValue = extractNumber(reachMetric?.value, 0);
    const followersValue = extractNumber(followersMetric?.value, 0);

    if (reachValue > 0 && followersValue > 0) {
      // Estima percentual de não seguidores baseado no alcance vs seguidores
      const nonFollowerReachEstimate = Math.max(0, reachValue - followersValue);
      const totalReach = reachValue;

      const nonFollowerPct = totalReach > 0 ? (nonFollowerReachEstimate / totalReach) * 100 : 35;
      const followerPct = 100 - nonFollowerPct;

      return [
        { name: "Não Seguidores", value: Math.round(nonFollowerPct * 10) / 10 },
        { name: "Seguidores", value: Math.round(followerPct * 10) / 10 },
      ];
    }

    return DEFAULT_AUDIENCE_TYPE;
  }, [reachMetric, followersMetric]);

  // const heatmapData = useMemo(() => DEFAULT_HEATMAP_MATRIX, []);

  // const maxHeatmapValue = useMemo(() => (
  //   heatmapData.reduce((acc, row) => {
  //     const rowMax = Math.max(...row.values);
  //     return rowMax > acc ? rowMax : acc;
  //   }, 0)
  // ), [heatmapData]);

  const keywordList = useMemo(() => buildKeywordFrequency(filteredPosts), [filteredPosts]);
  const hashtagList = useMemo(() => buildHashtagFrequency(filteredPosts), [filteredPosts]);

  const accountInitial = (accountInfo?.username || accountInfo?.name || "IG").charAt(0).toUpperCase();
  const [coverImage, setCoverImage] = useState(null);
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverError, setCoverError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!accountId) return () => { cancelled = true; };
    const loadCover = async () => {
      setCoverLoading(true);
      setCoverError("");
      try {
        const response = await apiFetch(
          `/api/covers?platform=instagram&account_id=${encodeURIComponent(accountId)}`,
          { method: "GET" },
        );
        if (cancelled) return;
        setCoverImage(response?.cover?.url || response?.cover?.storage_url || null);
      } catch (err) {
        if (cancelled) return;
        setCoverImage(null);
        setCoverError(err?.message || "Não foi possível carregar a capa.");
      } finally {
        if (!cancelled) {
          setCoverLoading(false);
        }
      }
    };
    loadCover();
    return () => {
      cancelled = true;
    };
  }, [accountId, apiFetch]);

  const handleCoverUpload = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        alert("Envie um arquivo de imagem.");
        return;
      }
      setCoverLoading(true);
      setCoverError("");
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
          reader.readAsDataURL(file);
        });

        const response = await apiFetch("/api/covers", {
          method: "POST",
          body: {
            platform: "instagram",
            account_id: accountId,
            data_url: dataUrl,
            content_type: file.type,
            size_bytes: file.size,
          },
        });
        setCoverImage(response?.cover?.url || response?.cover?.storage_url || dataUrl);
      } catch (err) {
        setCoverError(err?.message || "Não foi possível salvar a capa.");
      } finally {
        setCoverLoading(false);
      }
    },
    [accountId, apiFetch],
  );

  const handleCoverRemove = useCallback(async () => {
    setCoverLoading(true);
    setCoverError("");
    try {
      await apiFetch(`/api/covers?platform=instagram&account_id=${encodeURIComponent(accountId)}`, {
        method: "DELETE",
      });
      setCoverImage(null);
    } catch (err) {
      setCoverError(err?.message || "Não foi possível remover a capa.");
    } finally {
      setCoverLoading(false);
    }
  }, [accountId, apiFetch]);

  return (
    <div className="instagram-dashboard instagram-dashboard--clean">
      {metricsError && <div className="alert alert--error">{metricsError}</div>}
      {postsError && <div className="alert alert--error">{postsError}</div>}

      {/* Container Limpo (fundo branco) */}
      <div className="ig-clean-container">
        <div className="ig-hero-gradient" aria-hidden="true" />
        {/* Header com Logo Instagram e Tabs */}
        <div className="ig-clean-header">
          <div className="ig-clean-header__brand">
            <div className="ig-clean-header__logo">
              <InstagramIcon size={32} />
            </div>
            <h1>Instagram</h1>
          </div>

          <nav className="ig-clean-tabs">
            {HERO_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.href ? location.pathname === tab.href : tab.id === "instagram";
              const linkTarget = tab.href
                ? (location.search ? { pathname: tab.href, search: location.search } : tab.href)
                : null;
              return tab.href ? (
                <Link
                  key={tab.id}
                  to={linkTarget}
                  className={`ig-clean-tab${isActive ? " ig-clean-tab--active" : ""}`}
                >
                  <Icon size={18} />
                  <span>{tab.label}</span>
                </Link>
              ) : (
                <button
                  key={tab.id}
                  type="button"
                  className={`ig-clean-tab${isActive ? " ig-clean-tab--active" : ""}`}
                  disabled={!tab.href}
                >
                  <Icon size={18} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <h2 className="ig-clean-title">Visão Geral</h2>

        {/* Grid Principal */}
          <div className="ig-clean-grid">
          <div className="ig-clean-grid__left">
            <section className="ig-profile-vertical">
              <div
                className="ig-profile-vertical__cover"
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                  minHeight: "120px",
                  backgroundColor: "#f5f5f5",
                  backgroundImage: coverImage ? `url(${coverImage})` : "linear-gradient(135deg, #f2f4f7 0%, #e5e7eb 100%)",
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  borderRadius: "16px",
                  overflow: "hidden",
                }}
              >
                {coverLoading && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "rgba(17,24,39,0.35)",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 600,
                      fontSize: "0.95rem",
                      zIndex: 2,
                    }}
                  >
                    Carregando capa...
                  </div>
                )}
                {!coverImage && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#6b7280" }}>
                    <InstagramIcon size={32} />
                    <span style={{ fontWeight: 600 }}>Capa não configurada</span>
                  </div>
                )}
                {coverImage && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.35) 100%)",
                      }}
                      aria-hidden="true"
                    />
                  )}
                {coverError && (
                  <div
                    style={{
                      position: "absolute",
                      left: 12,
                      bottom: 12,
                      right: 12,
                      background: "rgba(255,255,255,0.92)",
                      color: "#b91c1c",
                      border: "1px solid #fecdd3",
                      borderRadius: "10px",
                      padding: "8px 10px",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                    }}
                  >
                    {coverError}
                  </div>
                )}
                <div style={{ position: "absolute", right: 12, bottom: 12, display: "flex", gap: "6px" }}>
                  <label
                    htmlFor="ig-cover-upload"
                    style={{
                      background: "rgba(255,255,255,0.9)",
                      color: "#111827",
                      borderRadius: "6px",
                      padding: "4px 8px",
                      fontSize: "0.75rem",
                      cursor: "pointer",
                      border: "1px solid #e5e7eb",
                      fontWeight: 600,
                    }}
                  >
                    Enviar capa
                  </label>
                  {coverImage && (
                    <button
                      type="button"
                      onClick={handleCoverRemove}
                      style={{
                        background: "rgba(255,255,255,0.9)",
                        color: "#b91c1c",
                        borderRadius: "6px",
                        padding: "4px 8px",
                        fontSize: "0.75rem",
                        border: "1px solid #fecdd3",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Remover
                    </button>
                  )}
                  <input
                    id="ig-cover-upload"
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleCoverUpload}
                  />
                </div>
              </div>

              <div className="ig-profile-vertical__avatar-wrapper">
                <div className="ig-profile-vertical__avatar">
                  {accountInfo?.profile_picture_url ? (
                    <img src={accountInfo.profile_picture_url} alt="Profile" />
                  ) : (
                    <span>{accountInitial}</span>
                  )}
                </div>
              </div>

              <div className="ig-profile-vertical__body">
                <h3 className="ig-profile-vertical__username" style={{ marginTop: '-10px' }}>
                  @{accountInfo?.username || accountInfo?.name || "insta_sample"}
                </h3>

                <div className="ig-profile-vertical__stats-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '20px' }}>
                  <div className="ig-overview-stat" style={{ paddingBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
                    <div className="ig-overview-stat__value">
                      {metricsLoading ? (
                        <span className="ig-skeleton ig-skeleton--stat" aria-hidden="true" />
                      ) : (
                        formatNumber(overviewMetrics.followers ?? null)
                      )}
                    </div>
                    <div className="ig-overview-stat__label">Total de seguidores</div>
                  </div>
                  <div className="ig-overview-stat" style={{ paddingBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
                    <div className="ig-overview-stat__value">
                      {metricsLoading ? (
                        <span className="ig-skeleton ig-skeleton--stat" aria-hidden="true" />
                      ) : (
                        formatNumber(overviewMetrics.reach ?? null)
                      )}
                    </div>
                    <div className="ig-overview-stat__label">Alcance</div>
                  </div>
                  <div className="ig-overview-stat" style={{ paddingTop: '8px' }}>
                    <div className="ig-overview-stat__value">
                      {metricsLoading ? (
                        <span className="ig-skeleton ig-skeleton--stat" aria-hidden="true" />
                      ) : (
                        formatNumber(overviewMetrics.posts ?? null)
                      )}
                    </div>
                    <div className="ig-overview-stat__label">Posts criados</div>
                  </div>
                  <div className="ig-overview-stat" style={{ paddingTop: '8px' }}>
                    <div className="ig-overview-stat__value" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      {metricsLoading ? (
                        <span className="ig-skeleton ig-skeleton--stat" aria-hidden="true" />
                      ) : (
                        <>
                          {formatNumber(followerDeltaValue ?? null)}
                          {followerDeltaValue != null ? (
                            <FollowerDeltaIcon size={20} style={{ color: followerDeltaColor }} />
                          ) : null}
                        </>
                      )}
                    </div>
                    <div className="ig-overview-stat__label">Seguidores ganhos</div>
                  </div>
                </div>

                <div className="ig-profile-vertical__divider" />

                <div className="ig-profile-vertical__engagement">
                  <h4>Engajamento por Conteúdo</h4>
                  {contentBreakdown.length ? (
                    <>
                      <div className="ig-profile-vertical__engagement-chart">
                        <ResponsiveContainer width="100%" height={260}>
                          <PieChart>
                            <Pie
                              data={contentBreakdown}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={65}
                              outerRadius={100}
                              paddingAngle={3}
                              stroke="none"
                              activeIndex={activeEngagementIndex}
                              activeShape={renderActiveShape}
                              onMouseEnter={(_, index) => setActiveEngagementIndex(index)}
                              onMouseLeave={() => setActiveEngagementIndex(-1)}
                            >
                              {contentBreakdown.map((_, index) => (
                                <Cell key={index} fill={IG_DONUT_COLORS[index % IG_DONUT_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value, name) => [Number(value).toLocaleString("pt-BR"), name]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="ig-engagement-legend" style={{ marginTop: '12px', gap: '14px' }}>
                        {contentBreakdown.map((slice, index) => (
                          <div key={slice.name || index} className="ig-engagement-legend__item" style={{ fontSize: '15px' }}>
                            <span
                              className="ig-engagement-legend__swatch"
                              style={{ backgroundColor: IG_DONUT_COLORS[index % IG_DONUT_COLORS.length], width: '14px', height: '14px' }}
                            />
                            <span className="ig-engagement-legend__label">{slice.name}</span>
                          </div>
                        ))}
                      </div>

                      <div className="ig-engagement-summary">
                        <div className="ig-engagement-summary__value">{engagementRateDisplay}</div>
                        <div className="ig-engagement-summary__label">Taxa de engajamento</div>
                      </div>

                      <div className="ig-engagement-mini-grid">
                        <div className="ig-engagement-mini-card ig-engagement-mini-card--teal">
                          <span className="ig-engagement-mini-card__label">Melhor horário para postar</span>
                          <span className="ig-engagement-mini-card__value">{bestTimes.bestTimeRange || "--"}</span>
                        </div>
                        <div className="ig-engagement-mini-card ig-engagement-mini-card--pink">
                          <span className="ig-engagement-mini-card__label">Melhor dia</span>
                          <span className="ig-engagement-mini-card__value">{bestTimes.bestDay || "--"}</span>
                        </div>
                      </div>
                      <p className="ig-best-time-caption">*Baseado nas publicações dos últimos 30 dias</p>
                    </>
                  ) : (
                    <div className="ig-empty-state">Sem dados</div>
                  )}
                </div>

                {/* Posts em Destaque */}
                <div className="ig-profile-vertical__divider" />
                <div className="ig-profile-vertical__top-posts">
                  <h4>Top posts</h4>
                  <div className="ig-top-posts-list">
                    {loadingPosts && !topPosts.length ? (
                      <div className="ig-empty-state">Carregando...</div>
                    ) : topPosts.length ? (
                      topPosts.slice(0, 4).map((post) => {
                        const likes = resolvePostMetric(post, "likes");
                        const comments = resolvePostMetric(post, "comments");
                        const saves = resolvePostMetric(post, "saves");
                        const shares = resolvePostMetric(post, "shares");
                        const previewUrl = [
                          post.previewUrl,
                          post.preview_url,
                          post.thumbnailUrl,
                          post.thumbnail_url,
                          post.mediaUrl,
                          post.media_url,
                        ].find((url) => url && !/\.(mp4|mov)$/i.test(url));

                        const postDate = post.timestamp ? new Date(post.timestamp) : null;
                        const dateStr = postDate ? postDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
                        const timeStr = postDate ? postDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
                        const postUrl = post.permalink || post.url || `https://www.instagram.com/p/${post.id || ''}`;

                        const handleThumbClick = () => {
                          if (postUrl) {
                            window.open(postUrl, '_blank', 'noopener,noreferrer');
                          }
                        };

                        return (
                          <div key={post.id || post.timestamp} className="ig-top-post-compact">
                            <div className="ig-top-post-compact__main">
                              <div className="ig-top-post-compact__left">
                                <div
                                  className="ig-top-post-compact__thumb"
                                  onClick={handleThumbClick}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      handleThumbClick();
                                    }
                                  }}
                                >
                                  {previewUrl ? (
                                    <img src={previewUrl} alt="Post" />
                                  ) : (
                                    <div className="ig-empty-thumb">Sem imagem</div>
                                  )}
                                </div>
                                <div className="ig-top-post-compact__datetime">
                                  {dateStr} {timeStr}
                                </div>
                              </div>
                              <div className="ig-top-post-compact__right">
                                <div className="ig-top-post-compact__metrics-column">
                                  <span className="ig-metric ig-metric--like">
                                    <Heart size={20} fill="#ef4444" color="#ef4444" />
                                    <span className="ig-metric__value">{formatNumber(likes)}</span>
                                  </span>
                                  <span className="ig-metric ig-metric--share">
                                    <Share2 size={20} color="#f97316" />
                                    <span className="ig-metric__value">{formatNumber(shares)}</span>
                                  </span>
                                  <span className="ig-metric ig-metric--comment">
                                    <MessageCircle size={20} fill="#a855f7" color="#a855f7" />
                                    <span className="ig-metric__value">{formatNumber(comments)}</span>
                                  </span>
                                  <span className="ig-metric ig-metric--save">
                                    <Bookmark size={20} fill="#3b82f6" color="#3b82f6" />
                                    <span className="ig-metric__value">{formatNumber(saves)}</span>
                                  </span>
                                </div>
                                <div className="ig-top-post-compact__caption">
                                  {truncate(post.caption || "Aqui vai o texto da legenda que post está sendo apresentado se não tiver espaço...", 120)}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="ig-empty-state">Nenhum post disponível</div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="ig-clean-grid__right">
            {/* Card de Crescimento do Perfil */}
            <section className="ig-growth-clean">
              <header className="ig-card-header">
                <div>
                  <h2 className="ig-clean-title2">Crescimento do perfil</h2>
                  <h3>Alcance</h3>
                </div>
              </header>

              <div className="ig-chart-area">
                {metricsLoading ? (
                  <div className="ig-chart-skeleton ig-chart-skeleton--tall" aria-hidden="true" />
                ) : profileReachData.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart
                      data={profileReachData}
                      margin={{ top: 24, right: 28, left: 12, bottom: 12 }}
                    >
                      <defs>
                        <linearGradient id="igReachGradient" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#ec4899" />
                          <stop offset="100%" stopColor="#f97316" />
                        </linearGradient>
                        <linearGradient id="igReachGlow" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="rgba(236, 72, 153, 0.32)" />
                          <stop offset="100%" stopColor="rgba(249, 115, 22, 0)" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#e5e7eb"
                        horizontal={true}
                        vertical={true}
                        strokeOpacity={0.5}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#6b7280', fontFamily: 'Lato, sans-serif' }}
                        fontSize={12}
                        tickLine={false}
                        axisLine={{ stroke: '#e5e7eb' }}
                        interval={0}
                        angle={0}
                        tickFormatter={(value) => {
                          if (!value) return '';
                          const parts = value.split('/');
                          if (parts.length === 2) {
                            const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
                            const day = parts[0];
                            const monthPart = parts[1];

                            if (monthNames.includes(monthPart)) {
                              return `${day} ${monthPart}`;
                            }

                            const monthIndex = parseInt(monthPart) - 1;
                            if (!isNaN(monthIndex) && monthIndex >= 0 && monthIndex < 12) {
                              return `${day} ${monthNames[monthIndex]}`;
                            }
                          }
                          return value;
                        }}
                      />
                      <YAxis
                        tick={{ fill: '#6b7280', fontFamily: 'Lato, sans-serif' }}
                        fontSize={12}
                        tickLine={false}
                        axisLine={{ stroke: '#e5e7eb' }}
                        tickFormatter={(value) => {
                          if (value >= 1000000) {
                            return `${Math.round(value / 1000000)}M`;
                          }
                          if (value >= 1000) {
                            return `${Math.round(value / 1000)}k`;
                          }
                          return value;
                        }}
                        domain={['dataMin', (dataMax) => (Number.isFinite(dataMax) ? Math.ceil(dataMax * 1.1) : dataMax)]}
                      />
                      <Tooltip
                        cursor={{ stroke: 'rgba(17, 24, 39, 0.2)', strokeDasharray: '4 4' }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const [{ payload: item, value }] = payload;
                          const numericValue = Number(value ?? item?.value ?? 0);
                          const label = item?.label ?? "Período";
                          const isPeak =
                            !!peakReachPoint &&
                            item?.dateKey === peakReachPoint.dateKey &&
                            numericValue === peakReachPoint.value;
                          return (
                            <div className="ig-tooltip">
                              <span className="ig-tooltip__title">{label}</span>
                              <div className="ig-tooltip__row">
                                <span>Contas alcançadas</span>
                                <strong>{numericValue.toLocaleString("pt-BR")}</strong>
                              </div>
                              {isPeak ? (
                                <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
                                  Pico do período
                                </div>
                              ) : null}
                            </div>
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        fill="url(#igReachGlow)"
                        stroke="none"
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="url(#igReachGradient)"
                        strokeWidth={7}
                        strokeOpacity={0.2}
                        dot={false}
                        isAnimationActive={false}
                        activeDot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="url(#igReachGradient)"
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 6, fill: '#ffffff', stroke: '#ef4444', strokeWidth: 2 }}
                      />
                      {peakReachPoint ? (
                        <>
                          <ReferenceLine
                            x={peakReachPoint.label}
                            stroke="#111827"
                            strokeDasharray="4 4"
                            strokeOpacity={0.45}
                          />
                          <ReferenceLine
                            y={peakReachPoint.value}
                            stroke="#111827"
                            strokeDasharray="4 4"
                            strokeOpacity={0.45}
                          />
                          <ReferenceDot
                            x={peakReachPoint.label}
                            y={peakReachPoint.value}
                            r={6}
                            fill="#111827"
                            stroke="#ffffff"
                            strokeWidth={2}
                          />
                        </>
                      ) : null}
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                <div className="ig-empty-state">Sem dados disponíveis</div>
                )}
              </div>
            </section>

            {/* Card de Crescimento de Seguidores */}
            <section className="ig-growth-clean ig-growth-followers ig-follower-growth-card">
              <header className="ig-card-header">
                <div>
                  <h3>Crescimento de Seguidores</h3>
                <p className="ig-card-subtitle">Evolução mensal</p>
                </div>
              </header>

              <div className="ig-chart-area">
                {metricsLoading ? (
                  <div className="ig-chart-skeleton ig-chart-skeleton--compact" aria-hidden="true" />
                ) : followerGrowthChartData.length ? (
                  <ResponsiveContainer width="100%" height={followerGrowthChartData.length > 15 ? 380 : 280}>
                    <BarChart
                      data={followerGrowthChartData}
                      margin={{ top: 16, right: 16, bottom: followerGrowthChartData.length > 15 ? 70 : 32, left: 0 }}
                      barCategoryGap="35%"
                    >
                        <defs>
                          <linearGradient id="igFollowerGrowthBar" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#d8b4fe" />
                            <stop offset="100%" stopColor="#c084fc" />
                          </linearGradient>
                          <linearGradient id="igFollowerGrowthBarActive" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f472b6" />
                            <stop offset="45%" stopColor="#d946ef" />
                            <stop offset="100%" stopColor="#6366f1" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 8" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fill: "#9ca3af", fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
                          interval={followerGrowthChartData.length > 15 ? "preserveEnd" : 0}
                          height={32}
                        />
                        <YAxis
                          tick={{ fill: "#9ca3af", fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(value) => {
                            if (value >= 1000000) {
                              const millions = (value / 1000000).toFixed(1);
                              return `${millions.endsWith(".0") ? millions.slice(0, -2) : millions}M`;
                            }
                            if (value >= 1000) return `${Math.round(value / 1000)}k`;
                            return value;
                          }}
                          ticks={followerGrowthTicks}
                          domain={followerGrowthDomain}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(216, 180, 254, 0.25)" }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const dataPoint = payload[0];
                            const tooltipValue = formatNumber(extractNumber(dataPoint.value, 0));
                            const tooltipDate = dataPoint.payload?.tooltipDate || dataPoint.payload?.label;
                            return (
                              <div className="ig-follower-tooltip">
                                <div className="ig-follower-tooltip__label">
                                  Seguidores ganhos: {tooltipValue}
                                </div>
                                <div className="ig-follower-tooltip__date">{tooltipDate}</div>
                              </div>
                            );
                          }}
                        />
                        {highlightedFollowerGrowthPoint ? (
                          <>
                            <ReferenceLine
                              x={highlightedFollowerGrowthPoint.label}
                              stroke="#111827"
                              strokeDasharray="4 4"
                              strokeOpacity={0.3}
                            />
                            <ReferenceLine
                              y={extractNumber(highlightedFollowerGrowthPoint.value, 0)}
                              stroke="#111827"
                              strokeDasharray="4 4"
                              strokeOpacity={0.35}
                            />
                            <ReferenceDot
                              x={highlightedFollowerGrowthPoint.label}
                              y={extractNumber(highlightedFollowerGrowthPoint.value, 0)}
                              r={6}
                              fill="#111827"
                              stroke="#ffffff"
                              strokeWidth={2}
                            />
                          </>
                        ) : null}
                        <Bar
                          dataKey="value"
                          radius={[12, 12, 0, 0]}
                          barSize={followerGrowthChartData.length > 15 ? 30 : 36}
                          minPointSize={6}
                          onMouseEnter={(_, index) => setActiveFollowerGrowthBar(index)}
                          onMouseLeave={() => setActiveFollowerGrowthBar(-1)}
                        >
                          {followerGrowthChartData.map((entry, index) => (
                            <Cell
                              key={`${entry.label || "point"}-${index}`}
                              fill={index === highlightedFollowerGrowthIndex
                                ? "url(#igFollowerGrowthBarActive)"
                                : "url(#igFollowerGrowthBar)"}
                            />
                          ))}
                        </Bar>
                        {followerGrowthChartData.length > 15 && (
                          <Brush
                            dataKey="label"
                            height={40}
                            stroke="#c084fc"
                            fill="transparent"
                            startIndex={0}
                            endIndex={Math.min(14, followerGrowthChartData.length - 1)}
                            travellerWidth={14}
                            y={280}
                          >
                            <BarChart>
                              <Bar dataKey="value" fill="#e9d5ff" radius={[3, 3, 0, 0]} />
                            </BarChart>
                          </Brush>
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                ) : (
                  <div className="ig-empty-state">Sem dados disponiveis.</div>
                )}
              </div>
        </section>

        <div className="ig-analytics-grid ig-analytics-grid--pair">
          <section className="ig-card-white ig-analytics-card">
            <div className="ig-analytics-card__header">
              <h4>Audiência</h4>
              <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>Seguidores vs Não Seguidores</p>
            </div>
            <div className="ig-analytics-card__body">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  {/* Círculo de seguidores (background) */}
                  <Pie
                    data={[{ value: 100 }]}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    outerRadius={activeGenderIndex === 1 ? 130 : 120}
                    innerRadius={0}
                    fill="#6366f1"
                    stroke="none"
                    isAnimationActive={true}
                    onMouseEnter={() => setActiveGenderIndex(1)}
                    onMouseLeave={() => setActiveGenderIndex(-1)}
                  />
                  {/* Círculo de não seguidores (foreground - overlapping) */}
                  <Pie
                    data={audienceTypeSeries}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={activeGenderIndex === 0 ? 130 : 120}
                    innerRadius={0}
                    startAngle={90}
                    endAngle={90 + (audienceTypeSeries[0]?.value || 0) * 3.6}
                    fill="#f472b6"
                    stroke="none"
                    paddingAngle={0}
                    isAnimationActive={true}
                    onMouseEnter={() => setActiveGenderIndex(0)}
                    onMouseLeave={() => setActiveGenderIndex(-1)}
                  />
                  <Tooltip content={(props) => <BubbleTooltip {...props} suffix="%" />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="ig-analytics-legend" style={{ marginTop: '20px', gap: '18px' }}>
                {audienceTypeSeries.map((slice, index) => (
                  <div key={slice.name || index} className="ig-analytics-legend__item" style={{ fontSize: '16px', fontWeight: '500' }}>
                    <span
                      className="ig-analytics-legend__swatch"
                      style={{ backgroundColor: index === 0 ? "#f472b6" : "#6366f1", width: '16px', height: '16px' }}
                    />
                    <span className="ig-analytics-legend__label">{slice.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="ig-card-white ig-analytics-card">
            <div className="ig-analytics-card__header">
              <div>
                <h4>Quantidade de publicações por dia</h4>
                <span className="ig-calendar__month">{postCalendar.title}</span>
              </div>
              <select
                className="ig-calendar__month-select"
                value={calendarMonth}
                onChange={(event) => setCalendarMonth(event.target.value)}
              >
                {calendarMonthOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="ig-analytics-card__body">
              <div className="ig-calendar">
                <div className="ig-calendar__weekdays">
                  <span className="ig-calendar__weekday">Dom</span>
                  <span className="ig-calendar__weekday">Seg</span>
                  <span className="ig-calendar__weekday">Ter</span>
                  <span className="ig-calendar__weekday">Qua</span>
                  <span className="ig-calendar__weekday">Qui</span>
                  <span className="ig-calendar__weekday">Sex</span>
                  <span className="ig-calendar__weekday">Sáb</span>
                </div>
                <div className="ig-calendar__grid">
                  {Array.from({ length: postCalendar.leadingEmpty }, (_, index) => (
                    <div key={`calendar-leading-${index}`} className="ig-calendar__day ig-calendar__day--empty" />
                  ))}

                  {postCalendar.days.map((day) => (
                    <div
                      key={day.key}
                      className={`ig-calendar__day ig-calendar__day--level-${day.level}`}
                      data-tooltip={day.tooltip}
                    >
                      <span className="ig-calendar__day-number">{day.date.getDate()}</span>
                    </div>
                  ))}

                  {Array.from({ length: postCalendar.trailingEmpty }, (_, index) => (
                    <div key={`calendar-trailing-${index}`} className="ig-calendar__day ig-calendar__day--empty" />
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="ig-analytics-grid ig-analytics-grid--pair">
          <section className="ig-card-white ig-analytics-card">
            <div className="ig-analytics-card__header">
              <h4>Idade</h4>
            </div>
            <div className="ig-analytics-card__body">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={[
                    { age: "13-17", male: 20, female: 30 },
                    { age: "18-24", male: 60, female: 80 },
                    { age: "25-34", male: 70, female: 75 },
                    { age: "35-44", male: 40, female: 35 },
                    { age: "45++", male: 30, female: 25 },
                  ]}
                  layout="vertical"
                  margin={{ left: 0, right: 20, top: 5, bottom: 5 }}
                  barGap={4}
                  barCategoryGap="45%"
                >
                  <defs>
                    <linearGradient id="maleGradient" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#6366f1" />
                      <stop offset="100%" stopColor="#4f46e5" />
                    </linearGradient>
                    <linearGradient id="femaleGradient" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#f472b6" />
                      <stop offset="100%" stopColor="#ec4899" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: '#6b7280', fontFamily: 'Lato, sans-serif' }}
                    fontSize={12}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="age"
                    tick={{ fill: '#374151', fontFamily: 'Lato, sans-serif', fontWeight: 600 }}
                    fontSize={13}
                    width={50}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(99, 102, 241, 0.08)' }}
                    formatter={(value) => Number(value).toLocaleString("pt-BR")}
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
                    }}
                  />
                  <Bar dataKey="male" fill="url(#maleGradient)" radius={[0, 6, 6, 0]} barSize={14} />
                  <Bar dataKey="female" fill="url(#femaleGradient)" radius={[0, 6, 6, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
              <div className="ig-analytics-legend" style={{ marginTop: '4px', gap: '16px', justifyContent: 'center' }}>
                <div className="ig-analytics-legend__item" style={{ fontSize: '13px', fontWeight: '500' }}>
                  <span className="ig-analytics-legend__swatch" style={{ backgroundColor: '#4f46e5', width: '12px', height: '12px' }} />
                  <span className="ig-analytics-legend__label">Homens</span>
                </div>
                <div className="ig-analytics-legend__item" style={{ fontSize: '13px', fontWeight: '500' }}>
                  <span className="ig-analytics-legend__swatch" style={{ backgroundColor: '#ec4899', width: '12px', height: '12px' }} />
                  <span className="ig-analytics-legend__label">Mulheres</span>
                </div>
              </div>
            </div>
          </section>

          <section className="ig-card-white ig-analytics-card">
            <div className="ig-analytics-card__header">
              <h4>Top Cidades</h4>
            </div>
            <div className="ig-top-cities-new-layout">
              <div className="ig-top-cities-new-layout__left">
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '32px', fontWeight: '700', color: '#1f2937', lineHeight: '1', marginBottom: '8px' }}>
                    1.500
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="ig-top-city-row__icon" style={{ backgroundColor: "#5eead4", width: '12px', height: '12px', borderRadius: '3px' }}></span>
                    <span style={{ fontSize: '13px', fontWeight: '500', color: '#374151' }}>Crato</span>
                    <svg width="14" height="14" viewBox="0 0 16 16">
                      <path d="M8 3 L13 9 L3 9 Z" fill="#10b981" />
                    </svg>
                  </div>
                </div>

                <div className="ig-top-cities__table">
                  <div className="ig-top-city-row">
                    <div className="ig-top-city-row__left">
                      <span className="ig-top-city-row__icon" style={{ backgroundColor: "#3b82f6" }}></span>
                      <span className="ig-top-city-row__name">Fortaleza</span>
                    </div>
                    <span className="ig-top-city-row__value">350</span>
                  </div>
                  <div className="ig-top-city-row">
                    <div className="ig-top-city-row__left">
                      <span className="ig-top-city-row__icon" style={{ backgroundColor: "#f87171" }}></span>
                      <span className="ig-top-city-row__name">Crato</span>
                    </div>
                    <span className="ig-top-city-row__value">200</span>
                  </div>
                  <div className="ig-top-city-row">
                    <div className="ig-top-city-row__left">
                      <span className="ig-top-city-row__icon" style={{ backgroundColor: "#fb923c" }}></span>
                      <span className="ig-top-city-row__name">Massape</span>
                    </div>
                    <span className="ig-top-city-row__value">500</span>
                  </div>
                  <div className="ig-top-city-row">
                    <div className="ig-top-city-row__left">
                      <span className="ig-top-city-row__icon" style={{ backgroundColor: "#5eead4" }}></span>
                      <span className="ig-top-city-row__name">France</span>
                    </div>
                    <span className="ig-top-city-row__value">700</span>
                  </div>
                </div>
              </div>

              <div className="ig-top-cities-new-layout__right">
                <ResponsiveContainer width="100%" height={120}>
                  <ComposedChart
                    data={[
                      { name: '26', value: 1200 },
                      { name: '27', value: 1350 },
                      { name: '28', value: 1300 },
                      { name: '29', value: 1450 },
                      { name: '30', value: 1400 },
                      { name: '31', value: 1550 },
                      { name: '01', value: 1500 }
                    ]}
                    margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
                  >
                    <defs>
                      <linearGradient id="cityGrowthGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#5eead4" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#5eead4" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#5eead4"
                      strokeWidth={2}
                      fill="url(#cityGrowthGradient)"
                      dot={false}
                      animationDuration={800}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>
        </div>

      </div>
      </div>

      {/* Palavras-chave e Hashtags - Largura Total */}
      <div className="ig-analytics-grid ig-analytics-grid--pair">
        <section className="ig-card-white ig-analytics-card ig-analytics-card--large">
          <div className="ig-analytics-card__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0 }}>Palavras chaves mais comentadas</h4>
            {commentsCount !== null && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 16px',
                borderRadius: '20px',
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                boxShadow: '0 2px 8px rgba(239, 68, 68, 0.25)',
                fontSize: '13px',
                fontWeight: 600,
                color: 'white'
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span>{commentsCount.toLocaleString('pt-BR')} comentário{commentsCount !== 1 ? 's' : ''} analisado{commentsCount !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
          <div className="ig-analytics-card__body">
            <WordCloudCard
              apiBaseUrl={API_BASE_URL}
              igUserId={accountConfig?.instagramUserId}
              since={sinceIso}
              until={untilIso}
              top={120}
              showCommentsCount={false}
              onCommentsCountRender={setCommentsCount}
            />
          </div>
        </section>
        <section className="ig-card-white ig-analytics-card ig-analytics-card--large">
          <div className="ig-analytics-card__header">
            <h4>Hashtags mais usadas</h4>
          </div>
          <div className="ig-analytics-card__body">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={hashtagList.slice(0, 10)} layout="vertical" margin={{ left: 12, right: 12, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#111827' }} fontSize={12} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#111827' }} fontSize={12} width={100} />
                <Tooltip
                  cursor={{ fill: 'rgba(236, 72, 153, 0.1)' }}
                  formatter={(value) => [String(value), "Ocorrências"]}
                />
                <Bar dataKey="value" fill="#ec4899" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Hashtags e palavras-chave (seAAo antiga - manter para compatibilidade) */}
      <div className="ig-clean-grid" style={{ display: 'none' }}>
        <div className="ig-card-white">
          <div className="ig-card__title">
            <Hash size={16} />
            <span>Hashtags mais usadas</span>
          </div>
          <div className="ig-chart-container">
            {hashtagList.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={hashtagList} layout="vertical" margin={{ left: 12, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis type="number" tick={{ fill: '#111827' }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fill: '#111827' }} />
                  <Tooltip formatter={(value) => [String(value), "Ocorrências"]} />
                  <Bar dataKey="value" fill="#ec4899" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="ig-empty-state">Sem hashtags registradas.</div>
            )}
          </div>
          <div className="ig-keywords">
            {keywordList.length ? (
              keywordList.slice(0, 10).map((item) => (
                <span key={item.word} className="ig-keywords__item">
                  {item.word}
                  <small>{item.value}</small>
                </span>
              ))
            ) : (
              <span className="ig-keywords__empty">Sem palavras em destaque.</span>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
