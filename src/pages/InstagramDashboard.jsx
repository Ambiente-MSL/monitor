import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useLocation, useOutletContext } from "react-router-dom";
import { useRef } from "react";
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
  AreaChart,
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
  LineChart,
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
import PostsTable from "../components/PostsTable";
import { DEFAULT_ACCOUNTS } from "../data/accounts";
import WordCloudCard from "../components/WordCloudCard";
import { useAuth } from "../context/AuthContext";
import { getDashboardCache, makeDashboardCacheKey, setDashboardCache } from "../lib/dashboardCache";
import { getApiErrorMessage, unwrapApiData } from "../lib/apiEnvelope";

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
const POSTS_INSIGHTS_LIMIT = 10;
const RECENT_POSTS_TABLE_LIMIT = 5;

const DEFAULT_AUDIENCE_TYPE = [
  { name: "Não Seguidores", value: 35 },
  { name: "Seguidores", value: 65 },
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

const FALLBACK_CALENDAR_MONTH_OPTIONS = [
  { value: "2025-08", label: "Agosto 2025", year: 2025, month: 7 },
  { value: "2025-09", label: "Setembro 2025", year: 2025, month: 8 },
  { value: "2025-10", label: "Outubro 2025", year: 2025, month: 9 },
  { value: "2025-11", label: "Novembro 2025", year: 2025, month: 10 },
];

const HERO_TABS = [
  { id: "instagram", label: "Instagram", href: "/instagram", icon: InstagramIcon, iconClass: "hero-icon-instagram" },
  { id: "facebook", label: "Facebook", href: "/facebook", icon: Facebook, iconClass: "hero-icon-facebook" },
  { id: "ads", label: "Ads", href: "/ads", icon: BarChart3, iconClass: "hero-icon-ads" },
  { id: "reports", label: "Relatórios", href: "/relatorios", icon: FileText, iconClass: "hero-icon-reports" },
  { id: "settings", label: "Configurações", href: "/configuracoes", icon: Settings, iconClass: "hero-icon-settings" },
  { id: "admin", label: "Admin", href: "/admin", icon: Shield, iconClass: "hero-icon-admin" },
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
const describeApiError = (payload, fallback) => getApiErrorMessage(payload, fallback);

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

// Backend sempre retorna formato consistente (meta.py linhas 834-848)
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
    ["insights", "views", "value"],
    ["insights", "video_views", "value"],
  ],
};

const resolvePostMetric = (post, metric, fallback = 0) => {
  const paths = POST_METRIC_PATHS[metric] || [];
  const candidates = paths.map((path) => getNestedValue(post, path));
  return pickFirstNumber(candidates, fallback);
};

const resolvePostViews = (post) => {
  const views = resolvePostMetric(post, "views", null);
  const reach = resolvePostMetric(post, "reach", null);
  return pickFirstNumber([views, reach], 0);
};

const resolvePostInteractions = (post) => {
  const interactions = extractNumber(post?.interactions, null);
  if (interactions != null) return interactions;
  return sumInteractions(post);
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

const formatPercent = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0%";
  const rounded = Math.round(numeric * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
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

const classifyViewContentType = (post) => {
  const mediaProductType = String(post.mediaProductType || post.media_product_type || "").toUpperCase();
  const mediaType = String(post.mediaType || post.media_type || "").toUpperCase();
  if (mediaProductType === "REELS" || mediaProductType === "REEL" || mediaType === "REEL") return "REELS";
  if (mediaProductType === "STORY" || mediaType === "STORY") return "STORIES";
  return "POSTS";
};

const classifyInteractionContentType = (post) => {
  const mediaProductType = String(post.mediaProductType || post.media_product_type || "").toUpperCase();
  const mediaType = String(post.mediaType || post.media_type || "").toUpperCase();
  if (mediaProductType === "REELS" || mediaProductType === "REEL" || mediaType === "REEL") return "reels";
  if (mediaType === "VIDEO" || mediaProductType === "VIDEO" || mediaProductType === "IGTV" || mediaType === "IGTV") return "videos";
  return "posts";
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
const IG_VIEW_TYPE_ORDER = ["REELS", "POSTS", "STORIES"];
const IG_VIEW_TYPE_LABEL = {
  REELS: "Reels",
  POSTS: "Posts",
  STORIES: "Stories",
};
const IG_VIEW_TYPE_COLORS = {
  REELS: "#6366f1",
  POSTS: "#ec4899",
  STORIES: "#f59e0b",
};
const INTERACTIONS_TABS = [
  { id: "reels", label: "Reels", icon: "R" },
  { id: "videos", label: "Videos", icon: "V" },
  { id: "posts", label: "Posts", icon: "P" },
];

const BubbleTooltip = ({ active, payload, suffix = "" }) => {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const label = item?.name || item?.payload?.name || "";
  const value = Number(item?.value ?? item?.payload?.value ?? 0);
  const color = item?.payload?.fill || item?.fill || "#6366f1";

  return (
    <div
      style={{
        background: "rgba(17, 24, 39, 0.95)",
        backdropFilter: "blur(8px)",
        padding: "12px 16px",
        borderRadius: "10px",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
        minWidth: "140px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
        <div
          style={{
            width: "12px",
            height: "12px",
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 8px ${color}`,
          }}
        />
        <span style={{ fontSize: "13px", color: "#9ca3af", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: "20px", fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>
        {value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
        {suffix}
      </div>
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
  const postsInsightsCacheKey = useMemo(
    () => makeDashboardCacheKey("instagram-posts-insights", accountSnapshotKey, POSTS_INSIGHTS_LIMIT, sinceParam || "auto", untilParam || "auto"),
    [accountSnapshotKey, sinceParam, untilParam],
  );
  const sinceDate = useMemo(() => parseQueryDate(sinceParam), [sinceParam]);
  const untilDate = useMemo(() => parseQueryDate(untilParam), [untilParam]);
  const sinceIso = useMemo(() => toUtcDateString(sinceDate), [sinceDate]);
  const untilIso = useMemo(() => toUtcDateString(untilDate), [untilDate]);

  // Estado para contador de comentários da wordcloud
  const [commentsCount, setCommentsCount] = useState(null);

  useEffect(() => {
    setCommentsCount(null);
  }, [accountSnapshotKey]);

  // Estado para controlar visualização detalhada
  const [showDetailedView, setShowDetailedView] = useState(false);
  const [showInteractionsDetail, setShowInteractionsDetail] = useState(false);
  const [interactionsTab, setInteractionsTab] = useState('reels'); // reels, videos, posts

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
  const [metricsNotice, setMetricsNotice] = useState("");
  const [metricsFetching, setMetricsFetching] = useState(false);
  const metricsRequestIdRef = useRef(0);
  const lastMetricsAccountKeyRef = useRef("");

  const [posts, setPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [postsError, setPostsError] = useState("");
  const [postsNotice, setPostsNotice] = useState("");
  const [postsFetching, setPostsFetching] = useState(false);
  const postsRequestIdRef = useRef(0);
  const lastPostsAccountKeyRef = useRef("");
  const [recentPosts, setRecentPosts] = useState([]);
  const [recentPostsLoading, setRecentPostsLoading] = useState(false);
  const [recentPostsError, setRecentPostsError] = useState("");
  const recentPostsRequestIdRef = useRef(0);

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
const [profileViewsSeries, setProfileViewsSeries] = useState([]);
const [profileVisitorsBreakdown, setProfileVisitorsBreakdown] = useState(null);
const [activeFollowerGrowthBar, setActiveFollowerGrowthBar] = useState(-1);
const [activeEngagementIndex, setActiveEngagementIndex] = useState(-1);
const [activeGenderIndex, setActiveGenderIndex] = useState(-1);

  const activeSnapshot = useMemo(
    () => (overviewSnapshot?.accountId === accountSnapshotKey && accountSnapshotKey ? overviewSnapshot : null),
    [accountSnapshotKey, overviewSnapshot],
  );

  useEffect(() => {
    const currentAccountKey = accountSnapshotKey;
    const previousAccountKey = lastMetricsAccountKeyRef.current;
    const isFirstLoadForAccount = !previousAccountKey;
    const accountChanged = Boolean(previousAccountKey) && previousAccountKey !== currentAccountKey;
    lastMetricsAccountKeyRef.current = currentAccountKey;

    if (!accountConfig?.instagramUserId) {
      setMetrics([]);
      setFollowerSeries([]);
      setFollowerCounts(null);
      setReachCacheSeries([]);
      setProfileViewsSeries([]);
      setProfileVisitorsBreakdown(null);
      setOverviewSnapshot(null);
      setMetricsLoading(false);
      setMetricsFetching(false);
      setMetricsNotice("");
      setMetricsError("Conta do Instagram não configurada.");
      return;
    }

    const cachedMetrics = getDashboardCache(metricsCacheKey);
    let shouldRefreshForReach = false;
    if (cachedMetrics) {
      const cachedMetricsList = Array.isArray(cachedMetrics.metrics) ? cachedMetrics.metrics : [];
      const cachedReachMetric = cachedMetricsList.find((metric) => metric?.key === "reach");
      const cachedReachValue = extractNumber(cachedReachMetric?.value, null);
      const cachedReachSeries = Array.isArray(cachedMetrics.reachSeries) ? cachedMetrics.reachSeries : [];
      const cachedReachMetricSeries = Array.isArray(cachedReachMetric?.timeseries) ? cachedReachMetric.timeseries : [];
      const hasReachTimeseries = cachedReachSeries.length > 0 || cachedReachMetricSeries.length > 0;
      // Cache antigo/limitado pode ter o total de alcance, mas sem série diária.
      // Nesse caso, força re-fetch para preencher o gráfico com dados reais.
      const shouldBypassCacheForReach = cachedReachValue != null && cachedReachValue > 0 && !hasReachTimeseries;

      setMetrics(Array.isArray(cachedMetrics.metrics) ? cachedMetrics.metrics : []);
      setFollowerSeries(Array.isArray(cachedMetrics.followerSeries) ? cachedMetrics.followerSeries : []);
      setFollowerCounts(cachedMetrics.followerCounts ?? null);
      setReachCacheSeries(Array.isArray(cachedMetrics.reachSeries) ? cachedMetrics.reachSeries : []);
      const cachedViewsSeries = Array.isArray(cachedMetrics.videoViewsSeries)
        ? cachedMetrics.videoViewsSeries
        : Array.isArray(cachedMetrics.profileViewsSeries)
          ? cachedMetrics.profileViewsSeries
          : [];
      setProfileViewsSeries(cachedViewsSeries);
      setProfileVisitorsBreakdown(cachedMetrics.profileVisitorsBreakdown ?? null);
      setMetricsError("");
      setMetricsNotice("");
      setMetricsFetching(false);
      setMetricsLoading(false);

      if (!shouldBypassCacheForReach) {
        return undefined;
      }

      shouldRefreshForReach = true;
    }

    const preset = IG_TOPBAR_PRESETS.find((item) => item.id === "7d") || IG_TOPBAR_PRESETS[0];
    const fallbackStart = startOfDay(subDays(defaultEnd, (preset?.days ?? 7) - 1));
    const effectiveSince = sinceDate || fallbackStart;
    const effectiveUntil = untilDate || defaultEnd;

    const requestId = (metricsRequestIdRef.current || 0) + 1;
    metricsRequestIdRef.current = requestId;

    const SOFT_LOADING_MS = 3000;
    const REQUEST_TIMEOUT_MS = 30000;
    const MAX_ATTEMPTS = 2;
    const shouldBlockUi = (isFirstLoadForAccount || accountChanged) && !cachedMetrics;

    const controllers = [];
    const timeouts = [];
    const trackTimeout = (handle) => {
      timeouts.push(handle);
      return handle;
    };
    const clearAllTimeouts = () => {
      timeouts.forEach((handle) => clearTimeout(handle));
    };
    const sleep = (ms) => new Promise((resolve) => {
      trackTimeout(setTimeout(resolve, ms));
    });

    let cancelled = false;

    const url = (() => {
      const params = new URLSearchParams();
      params.set("since", toUnixSeconds(startOfDay(effectiveSince)));
      params.set("until", toUnixSeconds(endOfDay(effectiveUntil)));
      params.set("igUserId", accountConfig.instagramUserId);
      return `${API_BASE_URL}/api/instagram/metrics?${params.toString()}`;
    })();

    const fetchMetricsPayload = async (attempt = 0) => {
      const controller = new AbortController();
      controllers.push(controller);

      let timedOut = false;
      const hardTimeout = trackTimeout(setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REQUEST_TIMEOUT_MS));

      try {
        const resp = await fetch(url, { signal: controller.signal });
         const text = await resp.text();
         const json = safeParseJson(text) || {};
         if (!resp.ok) {
           const error = new Error(describeApiError(json, "Falha ao carregar métricas do Instagram."));
           error.status = resp.status;
           throw error;
         }
         return unwrapApiData(json, {});
       } catch (err) {
         const status = err?.status;
         const retryableStatus = status === 429 || status === 502 || status === 503 || status === 504;
         const shouldRetry = attempt < MAX_ATTEMPTS - 1 && (timedOut || err?.name === "AbortError" || retryableStatus);
         if (shouldRetry) {
          await sleep(600);
          return fetchMetricsPayload(attempt + 1);
        }
        throw err;
      } finally {
        clearTimeout(hardTimeout);
      }
    };

    if (shouldBlockUi) {
      setMetrics([]);
      setFollowerSeries([]);
      setFollowerCounts(null);
      setReachCacheSeries([]);
      setProfileViewsSeries([]);
      setProfileVisitorsBreakdown(null);
      setOverviewSnapshot(null);
      setMetricsLoading(true);
      setMetricsNotice("");
    } else {
      setMetricsLoading(false);
      setMetricsNotice(
        shouldRefreshForReach
          ? "Atualizando série diária de alcance…"
          : "Atualizando métricas do período selecionado (exibindo dados anteriores até carregar)…",
      );
    }

    setMetricsFetching(true);
    setMetricsError("");
    setOverviewSnapshot(null);

    if (shouldBlockUi) {
      trackTimeout(setTimeout(() => {
        if (cancelled || metricsRequestIdRef.current !== requestId) return;
        setMetricsLoading(false);
        setMetricsNotice("Atualizando métricas… isso pode levar alguns segundos na primeira vez.");
      }, SOFT_LOADING_MS));
    }

    (async () => {
      try {
        const json = await fetchMetricsPayload(0);
        if (cancelled || metricsRequestIdRef.current !== requestId) return;

        const fetchedMetrics = json.metrics || [];
        const fetchedFollowerSeries = Array.isArray(json.follower_series) ? json.follower_series : [];
        const fetchedFollowerCounts = json.follower_counts || null;
        const parseNumericSeries = (series) => (
          Array.isArray(series)
            ? series
              .map((entry) => {
                if (!entry) return null;
                const dateRaw = entry.date || entry.metric_date || entry.end_time || entry.start_time || entry.label;
                if (!dateRaw) return null;
                const numericValue = extractNumber(entry.value, null);
                if (numericValue === null) return null;
                return { date: dateRaw, value: numericValue };
              })
              .filter(Boolean)
            : []
        );
        const reachSeries = parseNumericSeries(json.reach_timeseries);
        const parsedVideoViewsSeries = parseNumericSeries(json.video_views_timeseries);
        const parsedProfileViewsSeries = parseNumericSeries(json.profile_views_timeseries);
        const resolvedViewsSeries = parsedVideoViewsSeries.length ? parsedVideoViewsSeries : parsedProfileViewsSeries;
        const visitorsBreakdown = json.profile_visitors_breakdown || null;

        setMetrics(fetchedMetrics);
        setFollowerSeries(fetchedFollowerSeries);
        setFollowerCounts(fetchedFollowerCounts);
        setReachCacheSeries(reachSeries);
        setProfileViewsSeries(resolvedViewsSeries);
        setProfileVisitorsBreakdown(visitorsBreakdown);
        setDashboardCache(metricsCacheKey, {
          metrics: fetchedMetrics,
          followerSeries: fetchedFollowerSeries,
          followerCounts: fetchedFollowerCounts,
          reachSeries,
          profileViewsSeries: resolvedViewsSeries,
          videoViewsSeries: parsedVideoViewsSeries,
          profileVisitorsBreakdown: visitorsBreakdown,
        });

        setMetricsNotice("");
      } catch (err) {
        if (cancelled || metricsRequestIdRef.current !== requestId) return;
        if (err?.name === "AbortError") {
          setMetricsError("Tempo esgotado ao carregar métricas do Instagram.");
        } else {
          setMetricsError(err?.message || "Não foi possível atualizar.");
        }
        setMetricsNotice("");

        if (shouldBlockUi) {
          setMetrics([]);
          setFollowerSeries([]);
          setFollowerCounts(null);
          setReachCacheSeries([]);
          setProfileViewsSeries([]);
          setProfileVisitorsBreakdown(null);
        }
      } finally {
        if (cancelled || metricsRequestIdRef.current !== requestId) return;
        clearAllTimeouts();
        setMetricsFetching(false);
        setMetricsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      clearAllTimeouts();
      controllers.forEach((c) => c.abort());
    };
  }, [accountConfig?.instagramUserId, accountSnapshotKey, sinceDate, untilDate, defaultEnd, sinceParam, untilParam, metricsCacheKey]);

  useEffect(() => {
    const currentAccountKey = accountSnapshotKey;
    const previousAccountKey = lastPostsAccountKeyRef.current;
    const isFirstLoadForAccount = !previousAccountKey;
    const accountChanged = Boolean(previousAccountKey) && previousAccountKey !== currentAccountKey;
    lastPostsAccountKeyRef.current = currentAccountKey;

    if (!accountConfig?.instagramUserId) {
      setPosts([]);
      setAccountInfo(null);
      setPostsError("Conta do Instagram não configurada.");
      setLoadingPosts(false);
      setPostsFetching(false);
      setPostsNotice("");
      return undefined;
    }

    const cachedPosts = getDashboardCache(postsCacheKey);
    if (cachedPosts) {
      setPosts(Array.isArray(cachedPosts.posts) ? cachedPosts.posts : []);
      setAccountInfo(cachedPosts.accountInfo || null);
      setPostsError("");
      setLoadingPosts(false);
      setPostsFetching(false);
      setPostsNotice("");
      return undefined;
    }

    const requestId = (postsRequestIdRef.current || 0) + 1;
    postsRequestIdRef.current = requestId;

    const SOFT_LOADING_MS = 3000;
    const REQUEST_TIMEOUT_MS = 30000;
    const MAX_ATTEMPTS = 2;
    const shouldBlockUi = (isFirstLoadForAccount || accountChanged) && !cachedPosts;

    const controllers = [];
    const timeouts = [];
    const trackTimeout = (handle) => {
      timeouts.push(handle);
      return handle;
    };
    const clearAllTimeouts = () => {
      timeouts.forEach((handle) => clearTimeout(handle));
    };
    const sleep = (ms) => new Promise((resolve) => {
      trackTimeout(setTimeout(resolve, ms));
    });

    let cancelled = false;

    const url = (() => {
      const params = new URLSearchParams({ igUserId: accountConfig.instagramUserId, limit: "20" });
      if (sinceParam) params.set("since", sinceParam);
      if (untilParam) params.set("until", untilParam);
      return `${API_BASE_URL}/api/instagram/posts?${params.toString()}`;
    })();

    const fetchPostsPayload = async (attempt = 0) => {
      const controller = new AbortController();
      controllers.push(controller);

      let timedOut = false;
      const hardTimeout = trackTimeout(setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REQUEST_TIMEOUT_MS));

      try {
        const resp = await fetch(url, { signal: controller.signal });
         const text = await resp.text();
         const json = safeParseJson(text) || {};
         if (!resp.ok) {
           const error = new Error(describeApiError(json, "Não foi possível carregar os posts."));
           error.status = resp.status;
           throw error;
         }
         return unwrapApiData(json, {});
       } catch (err) {
         const status = err?.status;
         const retryableStatus = status === 429 || status === 502 || status === 503 || status === 504;
         const shouldRetry = attempt < MAX_ATTEMPTS - 1 && (timedOut || err?.name === "AbortError" || retryableStatus);
         if (shouldRetry) {
          await sleep(600);
          return fetchPostsPayload(attempt + 1);
        }
        throw err;
      } finally {
        clearTimeout(hardTimeout);
      }
    };

    if (shouldBlockUi) {
      setPosts([]);
      setAccountInfo(null);
      setLoadingPosts(true);
      setPostsNotice("");
    } else {
      setLoadingPosts(false);
      setPostsNotice("Atualizando posts do período selecionado (exibindo dados anteriores até carregar)…");
    }

    setPostsFetching(true);
    setPostsError("");

    if (shouldBlockUi) {
      trackTimeout(setTimeout(() => {
        if (cancelled || postsRequestIdRef.current !== requestId) return;
        setLoadingPosts(false);
        setPostsNotice("Atualizando posts… isso pode levar alguns segundos na primeira vez.");
      }, SOFT_LOADING_MS));
    }

    (async () => {
      try {
        const json = await fetchPostsPayload(0);
        if (cancelled || postsRequestIdRef.current !== requestId) return;

        const normalizedPosts = Array.isArray(json?.posts) ? json.posts : [];
        const account = json?.account || null;
        setPosts(normalizedPosts);
        setAccountInfo(account);
        setDashboardCache(postsCacheKey, { posts: normalizedPosts, accountInfo: account });
        setPostsNotice("");
      } catch (err) {
        if (cancelled || postsRequestIdRef.current !== requestId) return;
        if (err?.name === "AbortError") {
          setPostsError("Tempo esgotado ao carregar os posts do Instagram.");
        } else {
          setPostsError(err?.message || "Não foi possível carregar os posts.");
        }
        setPostsNotice("");

        if (shouldBlockUi) {
          setPosts([]);
          setAccountInfo(null);
        }
      } finally {
        if (cancelled || postsRequestIdRef.current !== requestId) return;
        clearAllTimeouts();
        setPostsFetching(false);
        setLoadingPosts(false);
      }
    })();

    return () => {
      cancelled = true;
      clearAllTimeouts();
      controllers.forEach((c) => c.abort());
    };
  }, [accountConfig?.instagramUserId, accountSnapshotKey, sinceParam, untilParam, postsCacheKey]);

  useEffect(() => {
    if (!accountConfig?.instagramUserId) {
      setRecentPosts([]);
      setRecentPostsError("Conta do Instagram nao configurada.");
      setRecentPostsLoading(false);
      return undefined;
    }

    const cachedPosts = getDashboardCache(postsInsightsCacheKey);
    if (cachedPosts) {
      setRecentPosts(Array.isArray(cachedPosts.posts) ? cachedPosts.posts : []);
      setRecentPostsError("");
      setRecentPostsLoading(false);
      return undefined;
    }

    const requestId = (recentPostsRequestIdRef.current || 0) + 1;
    recentPostsRequestIdRef.current = requestId;
    const controller = new AbortController();
    const REQUEST_TIMEOUT_MS = 15000;
    const hardTimeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    setRecentPosts([]);
    setRecentPostsLoading(true);
    setRecentPostsError("");

    const url = (() => {
      const params = new URLSearchParams({ igUserId: accountConfig.instagramUserId, limit: String(POSTS_INSIGHTS_LIMIT) });
      if (sinceParam) params.set("since", sinceParam);
      if (untilParam) params.set("until", untilParam);
      return `${API_BASE_URL}/api/instagram/posts/insights?${params.toString()}`;
    })();

    (async () => {
      try {
         const resp = await fetch(url, { signal: controller.signal });
         const text = await resp.text();
         const json = safeParseJson(text) || {};
         if (!resp.ok) {
           throw new Error(describeApiError(json, "Nao foi possivel carregar as publicacoes."));
         }
         if (recentPostsRequestIdRef.current !== requestId) return;
         const data = unwrapApiData(json, {});
         const normalizedPosts = Array.isArray(data?.posts) ? data.posts : [];
         setRecentPosts(normalizedPosts);
         setDashboardCache(postsInsightsCacheKey, { posts: normalizedPosts });
         setRecentPostsError("");
       } catch (err) {
        if (recentPostsRequestIdRef.current !== requestId) return;
        if (err?.name === "AbortError") {
          setRecentPostsError("Tempo esgotado ao carregar publicacoes do Instagram.");
        } else {
          setRecentPostsError(err?.message || "Nao foi possivel carregar as publicacoes.");
        }
      } finally {
        if (recentPostsRequestIdRef.current !== requestId) return;
        clearTimeout(hardTimeout);
        setRecentPostsLoading(false);
      }
    })();

    return () => {
      clearTimeout(hardTimeout);
      controller.abort();
    };
  }, [accountConfig?.instagramUserId, accountSnapshotKey, sinceParam, untilParam, postsInsightsCacheKey]);

const metricsByKey = useMemo(() => mapByKey(metrics), [metrics]);
 const reachMetric = metricsByKey.reach;
 const followersMetric = metricsByKey.followers_total;
 const followerGrowthMetric = metricsByKey.follower_growth;
 const engagementRateMetric = metricsByKey.engagement_rate;
 const profileViewsMetric = metricsByKey.video_views || metricsByKey.profile_views;
 const interactionsMetric = metricsByKey.interactions;

  const reachMetricValue = useMemo(() => extractNumber(reachMetric?.value, null), [reachMetric?.value]);
  const timelineReachSeries = useMemo(() => seriesFromMetric(reachMetric), [reachMetric]);
  const profileViewsSeriesFromMetric = useMemo(() => seriesFromMetric(profileViewsMetric), [profileViewsMetric]);
  const resolvedProfileViewsSeries = useMemo(() => {
    const baseSeries = profileViewsSeriesFromMetric.length ? profileViewsSeriesFromMetric : profileViewsSeries;
    if (!baseSeries?.length) return [];
    const normalized = baseSeries
      .map((entry) => {
        const dateKey = normalizeDateKey(entry.date || entry.end_time || entry.endTime);
        if (!dateKey) return null;
        return { date: dateKey, value: extractNumber(entry.value, null) };
      })
      .filter(Boolean)
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    if (!sinceDate && !untilDate) return normalized;
    const startBoundary = sinceDate ? startOfDay(sinceDate).getTime() : null;
    const endBoundary = untilDate ? endOfDay(untilDate).getTime() : null;
    return normalized.filter((item) => {
      if (!item?.date) return false;
      const currentDate = new Date(`${item.date}T00:00:00`);
      const current = currentDate.getTime();
      if (Number.isNaN(current)) return false;
      if (startBoundary != null && current < startBoundary) return false;
      if (endBoundary != null && current > endBoundary) return false;
      return true;
    });
  }, [profileViewsSeriesFromMetric, profileViewsSeries, sinceDate, untilDate]);
  const profileViewsTotal = useMemo(() => {
    const metricValue = extractNumber(profileViewsMetric?.value, null);
    if (metricValue != null) return metricValue;
    if (!resolvedProfileViewsSeries.length) return null;
    return resolvedProfileViewsSeries.reduce((sum, entry) => sum + extractNumber(entry.value, 0), 0);
  }, [profileViewsMetric?.value, resolvedProfileViewsSeries]);
  const profileViewsPeak = useMemo(() => {
    if (!resolvedProfileViewsSeries.length) return null;
    return resolvedProfileViewsSeries.reduce((max, entry) => Math.max(max, extractNumber(entry.value, 0)), 0);
  }, [resolvedProfileViewsSeries]);
  const profileViewsDays = useMemo(() => {
    if (sinceDate && untilDate) {
      return differenceInCalendarDays(endOfDay(untilDate), startOfDay(sinceDate)) + 1;
    }
    return resolvedProfileViewsSeries.length || null;
  }, [sinceDate, untilDate, resolvedProfileViewsSeries.length]);
  const profileViewsAverage = useMemo(() => {
    if (profileViewsTotal == null || !profileViewsDays) return null;
    if (profileViewsDays <= 0) return null;
    return profileViewsTotal / profileViewsDays;
  }, [profileViewsTotal, profileViewsDays]);
  const profileViewsDeltaPct = useMemo(() => {
    if (typeof profileViewsMetric?.deltaPct === "number") return profileViewsMetric.deltaPct;
    return null;
  }, [profileViewsMetric?.deltaPct]);
  const interactionsMetricValue = useMemo(() => extractNumber(interactionsMetric?.value, null), [interactionsMetric?.value]);
  const interactionsDeltaPct = useMemo(() => {
    if (typeof interactionsMetric?.deltaPct === "number") return interactionsMetric.deltaPct;
    return null;
  }, [interactionsMetric?.deltaPct]);
  const profileVisitorsTotals = useMemo(() => {
    if (!profileVisitorsBreakdown) return null;
    const followers = extractNumber(profileVisitorsBreakdown.followers ?? profileVisitorsBreakdown.followers, null);
    const nonFollowers = extractNumber(profileVisitorsBreakdown.non_followers ?? profileVisitorsBreakdown.nonFollowers, null);
    const other = extractNumber(profileVisitorsBreakdown.other, null);
    const totalFromPayload = extractNumber(profileVisitorsBreakdown.total, null);
    const computedTotal = [followers, nonFollowers, other].reduce(
      (sum, value) => (value != null ? sum + value : sum),
      0,
    );
    const finalTotal = totalFromPayload != null ? totalFromPayload : computedTotal || null;
    return {
      followers: followers ?? null,
      nonFollowers: nonFollowers ?? null,
      other: other ?? null,
      total: finalTotal,
    };
  }, [profileVisitorsBreakdown]);
  const interactionsBreakdown = useMemo(() => {
    const breakdown = engagementRateMetric?.breakdown || {};
    const likes = pickFirstNumber([breakdown.likes, metricsByKey.likes?.value], 0);
    const comments = pickFirstNumber([breakdown.comments, metricsByKey.comments?.value], 0);
    const shares = pickFirstNumber([breakdown.shares, metricsByKey.shares?.value], 0);
    const saves = pickFirstNumber([breakdown.saves, metricsByKey.saves?.value], 0);
    const totalFromBreakdown = extractNumber(breakdown.total, null);
    const computedTotal = likes + comments + shares + saves;
    const total = totalFromBreakdown ?? interactionsMetricValue ?? computedTotal;
    return {
      likes,
      comments,
      shares,
      saves,
      total,
    };
  }, [engagementRateMetric?.breakdown, interactionsMetricValue, metricsByKey]);
  const interactionsDeltaDisplay = useMemo(() => {
    if (interactionsDeltaPct == null) return null;
    const sign = interactionsDeltaPct > 0 ? "+" : "";
    return `${sign}${interactionsDeltaPct}%`;
  }, [interactionsDeltaPct]);
  const interactionsDeltaTone = useMemo(() => {
    if (interactionsDeltaPct == null) return "#6b7280";
    return interactionsDeltaPct < 0 ? "#ef4444" : "#10b981";
  }, [interactionsDeltaPct]);
  const profileViewsChartData = useMemo(() => resolvedProfileViewsSeries.map((entry) => {
    const dateLabel = entry.date
      ? new Date(`${entry.date}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
      : "";
    return {
      label: dateLabel,
      date: entry.date,
      value: extractNumber(entry.value, 0),
    };
  }), [resolvedProfileViewsSeries]);
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

  const interactionPostsSource = useMemo(
    () => (recentPosts.length ? recentPosts : filteredPosts),
    [recentPosts, filteredPosts],
  );
  const interactionsDailyTotals = useMemo(() => {
    if (!interactionPostsSource.length) return [];
    const totals = new Map();
    interactionPostsSource.forEach((post) => {
      const dateKey = normalizeDateKey(post.timestamp || post.timestamp_unix);
      if (!dateKey) return;
      const value = resolvePostInteractions(post);
      totals.set(dateKey, (totals.get(dateKey) || 0) + value);
    });
    return Array.from(totals.entries()).map(([date, value]) => ({ date, value }));
  }, [interactionPostsSource]);
  const interactionsPeak = useMemo(() => {
    if (!interactionsDailyTotals.length) return null;
    return interactionsDailyTotals.reduce((maxValue, entry) => (
      Math.max(maxValue, extractNumber(entry.value, 0))
    ), 0);
  }, [interactionsDailyTotals]);
  const interactionsByTypeTotals = useMemo(() => {
    const totals = { reels: 0, videos: 0, posts: 0 };
    interactionPostsSource.forEach((post) => {
      const type = classifyInteractionContentType(post);
      totals[type] += resolvePostInteractions(post);
    });
    return totals;
  }, [interactionPostsSource]);
  const interactionsTabBreakdown = useMemo(() => {
    const totals = {
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      total: 0,
    };
    interactionPostsSource
      .filter((post) => classifyInteractionContentType(post) === interactionsTab)
      .forEach((post) => {
        const likes = resolvePostMetric(post, "likes");
        const comments = resolvePostMetric(post, "comments");
        const shares = resolvePostMetric(post, "shares");
        const saves = resolvePostMetric(post, "saves");
        totals.likes += likes;
        totals.comments += comments;
        totals.shares += shares;
        totals.saves += saves;
        totals.total += likes + comments + shares + saves;
      });
    return totals;
  }, [interactionPostsSource, interactionsTab]);
  const interactionsTabPosts = useMemo(() => {
    const filtered = interactionPostsSource.filter(
      (post) => classifyInteractionContentType(post) === interactionsTab,
    );
    if (!filtered.length) return [];
    return [...filtered]
      .sort((a, b) => resolvePostMetric(b, "likes") - resolvePostMetric(a, "likes"))
      .slice(0, 6);
  }, [interactionPostsSource, interactionsTab]);
  const interactionsTabLabel = useMemo(
    () => INTERACTIONS_TABS.find((tab) => tab.id === interactionsTab)?.label || interactionsTab,
    [interactionsTab],
  );

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
    if (metricsError) return [];
    return normalizedReachSeries;
  }, [metricsError, metricsLoading, normalizedReachSeries]);

  const reachXAxisInterval = useMemo(() => {
    if (profileReachData.length <= 7) return 0;
    // Mostrar ~7 ticks no eixo X, mas mantendo a série completa no gráfico.
    return Math.max(0, Math.ceil(profileReachData.length / 7) - 1);
  }, [profileReachData.length]);

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

  const viewsByContentType = useMemo(() => {
    const baseSeries = IG_VIEW_TYPE_ORDER.map((type) => ({
      key: type,
      name: IG_VIEW_TYPE_LABEL[type] || type,
      value: 0,
      raw: 0,
      fill: IG_VIEW_TYPE_COLORS[type] || "#6366f1",
    }));
    if (!recentPosts.length) return baseSeries;

    const totals = new Map(IG_VIEW_TYPE_ORDER.map((type) => [type, 0]));
    recentPosts.forEach((post) => {
      const views = resolvePostViews(post);
      const bucket = classifyViewContentType(post);
      totals.set(bucket, (totals.get(bucket) || 0) + views);
    });

    const totalViews = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
    if (!totalViews) return baseSeries;

    return IG_VIEW_TYPE_ORDER
      .map((type) => {
        const raw = totals.get(type) || 0;
        const percent = (raw / totalViews) * 100;
        return {
          key: type,
          name: IG_VIEW_TYPE_LABEL[type] || type,
          value: Math.round(percent * 10) / 10,
          raw,
          fill: IG_VIEW_TYPE_COLORS[type] || "#6366f1",
        };
      })
      .filter((item) => item.raw > 0);
  }, [recentPosts]);

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

  const topPostsByViews = useMemo(() => (
    recentPosts.length
      ? [...recentPosts].sort((a, b) => resolvePostViews(b) - resolvePostViews(a)).slice(0, 10)
      : []
  ), [recentPosts]);

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
      let previousValue = null;
      return followerGrowthSeriesSorted.map((entry, index) => {
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
    return [];
  }, [followerGrowthSeriesSorted, metricsError, metricsLoading]);

  const followerGrowthBarSize = useMemo(() => {
    const length = followerGrowthChartData.length;
    if (length <= 15) return 36;
    if (length <= 30) return 18;
    return undefined;
  }, [followerGrowthChartData.length]);

  const followerGrowthBarCategoryGap = useMemo(() => {
    const length = followerGrowthChartData.length;
    if (length > 120) return "5%";
    if (length > 60) return "10%";
    return "35%";
  }, [followerGrowthChartData.length]);

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

  // Renderização da visualização detalhada de Interações
  if (showInteractionsDetail) {
    return (
      <div className="instagram-dashboard instagram-dashboard--clean">
        <div className="ig-clean-container">
          {/* Degradê de fundo do Instagram */}
          <div className="ig-hero-gradient" aria-hidden="true" />

          {/* Header com Logo Instagram */}
          <div className="ig-clean-header" style={{ marginBottom: '24px' }}>
            <div className="ig-clean-header__brand">
              <div className="ig-clean-header__logo">
                <InstagramIcon size={32} />
              </div>
              <h1>Instagram</h1>
            </div>
          </div>

          {/* Hero com navegação - Tema Rosa para Interações */}
          <div className="ig-hero" style={{ marginTop: '20px', marginBottom: '32px' }}>
            <div className="ig-hero__background" style={{ background: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)' }} />
            <div className="ig-hero__content">
              {/* Navegação de volta */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <button
                  onClick={() => setShowInteractionsDetail(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 20px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    border: 'none',
                    borderRadius: '8px',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="19" y1="12" x2="5" y2="12" />
                    <polyline points="12 19 5 12 12 5" />
                  </svg>
                  Voltar ao Dashboard
                </button>
              </div>

              {/* Título e Métrica Principal */}
              <div style={{ marginTop: '24px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '16px'
                }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <Heart size={24} color="white" fill="white" />
                  </div>
                  <span style={{ fontSize: '14px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Interações</span>
                </div>
                <h2 style={{
                  margin: 0,
                  fontSize: '36px',
                  fontWeight: 700,
                  color: 'white',
                  marginBottom: '12px'
                }}>
                  Análise Detalhada de Engajamento
                </h2>
                <p style={{ margin: 0, fontSize: '15px', color: 'rgba(255, 255, 255, 0.9)', lineHeight: 1.6, maxWidth: '600px' }}>
                  Acompanhe as interações do seu público através de curtidas, comentários, salvamentos, compartilhamentos e reposts em diferentes tipos de conteúdo.
                </p>
              </div>
            </div>
          </div>

          {/* Grid de Métricas Resumidas */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '20px',
            marginBottom: '32px'
          }}>
            {/* Total de Interações */}
            <div className="ig-card-white" style={{
              padding: '24px',
              textAlign: 'center',
              borderRadius: '16px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
              background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.05) 0%, rgba(244, 114, 182, 0.05) 100%)',
              border: '1px solid rgba(236, 72, 153, 0.1)'
            }}>
              <div style={{
                width: '48px',
                height: '48px',
                margin: '0 auto 16px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Heart size={24} color="white" fill="white" />
              </div>
              <div style={{ fontSize: '36px', fontWeight: 800, color: '#ec4899', marginBottom: '8px' }}>
                {formatNumber(interactionsBreakdown.total)}
              </div>
              <div style={{ fontSize: '13px', color: '#6b7280', fontWeight: 600 }}>Total de Interações</div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                marginTop: '12px',
                fontSize: '13px',
                color: interactionsDeltaTone,
                fontWeight: 600
              }}>
                {interactionsDeltaDisplay ? (
                  <>
                    {interactionsDeltaPct < 0 ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
                    <span>{interactionsDeltaDisplay}</span>
                  </>
                ) : (
                  <span>--</span>
                )}
              </div>
            </div>

            {/* Pico de Interações */}
            <div className="ig-card-white" style={{
              padding: '24px',
              textAlign: 'center',
              borderRadius: '16px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
            }}>
              <div style={{
                width: '48px',
                height: '48px',
                margin: '0 auto 16px',
                borderRadius: '50%',
                background: '#fef2f2'
              }} />
              <div style={{ fontSize: '36px', fontWeight: 800, color: '#ec4899', marginBottom: '8px', position: 'relative' }}>
                {interactionsPeak != null ? formatNumber(interactionsPeak) : "--"}
              </div>
              <div style={{ fontSize: '13px', color: '#6b7280', fontWeight: 600 }}>Pico de Interações (1 dia)</div>
            </div>
          </div>

          {/* Tabs de Navegação */}
          <div style={{
            display: 'flex',
            gap: '12px',
            marginBottom: '28px',
            borderBottom: '2px solid #e5e7eb',
            overflowX: 'auto'
          }}>
            {INTERACTIONS_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setInteractionsTab(tab.id)}
                style={{
                  padding: '14px 24px',
                  background: interactionsTab === tab.id ? '#fce7f3' : 'transparent',
                  border: 'none',
                  borderBottom: interactionsTab === tab.id ? '3px solid #ec4899' : '3px solid transparent',
                  cursor: 'pointer',
                  fontSize: '15px',
                  fontWeight: interactionsTab === tab.id ? 700 : 500,
                  color: interactionsTab === tab.id ? '#ec4899' : '#6b7280',
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '-2px'
                }}
                onMouseEnter={(e) => {
                  if (interactionsTab !== tab.id) {
                    e.currentTarget.style.background = '#f9fafb';
                  }
                }}
                onMouseLeave={(e) => {
                  if (interactionsTab !== tab.id) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <span style={{ fontSize: '18px' }}>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <div style={{ marginBottom: '16px', fontSize: '14px', color: '#6b7280', fontWeight: 600 }}>
            Total de interações em {interactionsTabLabel}:{" "}
            <span style={{ color: '#111827' }}>{formatNumber(interactionsByTypeTotals[interactionsTab] || 0)}</span>
          </div>

          {/* Métricas Detalhadas por Tipo */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '20px',
            marginBottom: '32px'
          }}>
            <div className="ig-card-white" style={{
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid #fecaca',
              background: '#fef2f2'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <Heart size={22} color="#ef4444" fill="#ef4444" />
                <span style={{ fontSize: '14px', color: '#6b7280', fontWeight: 600 }}>Curtidas</span>
              </div>
              <div style={{ fontSize: '32px', fontWeight: 700, color: '#ef4444' }}>
                {formatNumber(interactionsTabBreakdown.likes)}
              </div>
            </div>

            <div className="ig-card-white" style={{
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid #bfdbfe',
              background: '#eff6ff'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <MessageCircle size={22} color="#3b82f6" />
                <span style={{ fontSize: '14px', color: '#6b7280', fontWeight: 600 }}>Comentários</span>
              </div>
              <div style={{ fontSize: '32px', fontWeight: 700, color: '#3b82f6' }}>
                {formatNumber(interactionsTabBreakdown.comments)}
              </div>
            </div>

            <div className="ig-card-white" style={{
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid #fde047',
              background: '#fefce8'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <Bookmark size={22} color="#eab308" />
                <span style={{ fontSize: '14px', color: '#6b7280', fontWeight: 600 }}>Salvamentos</span>
              </div>
              <div style={{ fontSize: '32px', fontWeight: 700, color: '#eab308' }}>
                {formatNumber(interactionsTabBreakdown.saves)}
              </div>
            </div>

            <div className="ig-card-white" style={{
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid #86efac',
              background: '#f0fdf4'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <Share2 size={22} color="#22c55e" />
                <span style={{ fontSize: '14px', color: '#6b7280', fontWeight: 600 }}>Compartilhamentos</span>
              </div>
              <div style={{ fontSize: '32px', fontWeight: 700, color: '#22c55e' }}>
                {formatNumber(interactionsTabBreakdown.shares)}
              </div>
            </div>

            <div className="ig-card-white" style={{
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid #c4b5fd',
              background: '#f5f3ff'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 1l4 4-4 4" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <path d="M7 23l-4-4 4-4" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
                <span style={{ fontSize: '14px', color: '#6b7280', fontWeight: 600 }}>Reposts</span>
              </div>
              <div style={{ fontSize: '32px', fontWeight: 700, color: '#8b5cf6' }}>
                {formatNumber(0)}
              </div>
            </div>
          </div>

          {/* Top Content por Curtidas */}
          <section className="ig-card-white" style={{
            padding: '28px',
            borderRadius: '20px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.06)',
            border: '1px solid rgba(0, 0, 0, 0.05)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 700, color: '#111827' }}>
                {interactionsTab === 'reels' ? 'Top Reels por Curtidas' : interactionsTab === 'videos' ? 'Top Videos por Curtidas' : 'Top Posts por Curtidas'}
              </h3>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '20px'
            }}>
              {interactionsTabPosts.length ? interactionsTabPosts.map((post) => {
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
                const postUrl = post.permalink || post.url || `https://www.instagram.com/p/${post.id || ''}`;

                return (
                  <div key={post.id || post.timestamp} style={{
                    background: 'white',
                    borderRadius: '16px',
                    padding: '20px',
                    border: '1px solid #e5e7eb',
                    transition: 'all 0.2s',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.12)';
                    e.currentTarget.style.transform = 'translateY(-4px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                  onClick={() => {
                    if (postUrl) window.open(postUrl, '_blank', 'noopener,noreferrer');
                  }}
                  >
                    <div style={{
                      background: '#f9fafb',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      marginBottom: '16px',
                      border: '1px solid #e5e7eb',
                      height: '200px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt="Post"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div style={{ color: '#9ca3af' }}>
                          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21 15 16 10 5 21" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div style={{
                      fontSize: '15px',
                      color: '#374151',
                      marginBottom: '16px',
                      fontWeight: 500,
                      lineHeight: 1.5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      minHeight: '45px'
                    }}>
                      {post.caption || post.text || 'Sem legenda'}
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: '12px',
                      paddingTop: '16px',
                      borderTop: '1px solid #e5e7eb'
                    }}>
                      <div style={{ textAlign: 'center' }}>
                        <Heart size={16} color="#ef4444" fill="#ef4444" style={{ marginBottom: '6px' }} />
                        <div style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>{formatNumber(likes)}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <MessageCircle size={16} color="#3b82f6" style={{ marginBottom: '6px' }} />
                        <div style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>{formatNumber(comments)}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <Bookmark size={16} color="#eab308" style={{ marginBottom: '6px' }} />
                        <div style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>{formatNumber(saves)}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <Share2 size={16} color="#22c55e" style={{ marginBottom: '6px' }} />
                        <div style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>{formatNumber(shares)}</div>
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div className="ig-empty-state">Sem posts disponiveis.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }

  // Renderização da visualização detalhada de Visualizações
  if (showDetailedView) {
    return (
      <div className="instagram-dashboard instagram-dashboard--clean">
        <div className="ig-clean-container">
          {/* Degradê de fundo do Instagram */}
          <div className="ig-hero-gradient" aria-hidden="true" />

          {/* Header com Logo Instagram */}
          <div className="ig-clean-header" style={{ marginBottom: '24px' }}>
            <div className="ig-clean-header__brand">
              <div className="ig-clean-header__logo">
                <InstagramIcon size={32} />
              </div>
              <h1>Instagram</h1>
            </div>
          </div>

          {/* Hero com navegação */}
          <div className="ig-hero" style={{ marginTop: '20px', marginBottom: '32px' }}>
            <div className="ig-hero__background" />
            <div className="ig-hero__content">
              {/* Navegação de volta */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <button
                  onClick={() => setShowDetailedView(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '12px 24px',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.95)',
                    backdropFilter: 'blur(10px)',
                    border: '2px solid white',
                    fontSize: '14px',
                    fontWeight: 700,
                    color: '#6366f1',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = 'white';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.2)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.95)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  <span>Voltar ao Dashboard</span>
                </button>
              </div>

              {/* Título da seção */}
              <div>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 20px',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.15)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  marginBottom: '12px'
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span style={{ fontSize: '14px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Visualizações</span>
                </div>
              </div>

              {/* Cards de KPI rápido na hero */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                marginTop: '24px'
              }}>
                <div style={{
                  padding: '20px',
                  borderRadius: '16px',
                  background: 'rgba(255, 255, 255, 0.15)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255, 255, 255, 0.2)'
                }}>
                  <div style={{ fontSize: '32px', fontWeight: 700, color: 'white', marginBottom: '4px' }}>
                    {formatNumber(profileViewsTotal ?? null)}
                  </div>
                  <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.85)', fontWeight: 500 }}>
                    Total de Visualizações
                  </div>
                </div>
                <div style={{
                  padding: '20px',
                  borderRadius: '16px',
                  background: 'rgba(255, 255, 255, 0.15)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255, 255, 255, 0.2)'
                }}>
                  <div style={{ fontSize: '32px', fontWeight: 700, color: 'white', marginBottom: '4px' }}>
                    {profileViewsAverage != null ? formatNumber(Math.round(profileViewsAverage)) : '--'}
                  </div>
                  <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.85)', fontWeight: 500 }}>
                    Média Diária
                  </div>
                </div>
                <div style={{
                  padding: '20px',
                  borderRadius: '16px',
                  background: 'rgba(255, 255, 255, 0.15)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255, 255, 255, 0.2)'
                }}>
                  <div style={{ fontSize: '32px', fontWeight: 700, color: 'white', marginBottom: '4px' }}>
                    {profileViewsDeltaPct != null ? `${profileViewsDeltaPct > 0 ? '+' : ''}${profileViewsDeltaPct}%` : '--'}
                  </div>
                  <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.85)', fontWeight: 500 }}>
                    Crescimento (%)
                  </div>
                </div>
                <div style={{
                  padding: '20px',
                  borderRadius: '16px',
                  background: 'rgba(255, 255, 255, 0.15)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255, 255, 255, 0.2)'
                }}>
                  <div style={{ fontSize: '32px', fontWeight: 700, color: 'white', marginBottom: '4px' }}>
                    {profileViewsPeak != null ? formatNumber(profileViewsPeak) : '--'}
                  </div>
                  <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.85)', fontWeight: 500 }}>
                    Pico de Visualizações
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Layout em coluna única */}
          <div style={{
            padding: '0 24px 24px',
            minHeight: 'calc(100vh - 200px)'
          }}>
            {/* Conteúdo principal */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '1400px', margin: '0 auto' }}>
              {/* Card de gráfico de visualizações - Design melhorado */}
              <section className="ig-card-white" style={{
                padding: '28px',
                background: 'white',
                borderRadius: '20px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.06)',
                border: '1px solid rgba(0, 0, 0, 0.05)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                      <polyline points="17 6 23 6 23 12" />
                    </svg>
                  </div>
                  <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 700, color: '#111827' }}>
                    Crescimento de visualizações
                  </h3>
                </div>
                {profileViewsChartData.length ? (
                  <div style={{ height: 340, marginTop: '16px' }}>
                    <ResponsiveContainer>
                      <LineChart data={profileViewsChartData}>
                        <defs>
                          <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1}/>
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                        <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} />
                        <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} />
                        <Tooltip
                          formatter={(value) => formatNumber(value)}
                          labelFormatter={(label) => `Dia ${label}`}
                          contentStyle={{
                            background: 'white',
                            border: '1px solid #e5e7eb',
                            borderRadius: '12px',
                            padding: '12px',
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="url(#gradientLine)"
                          strokeWidth={3}
                          dot={{ r: 4, fill: '#6366f1', strokeWidth: 2, stroke: 'white' }}
                          activeDot={{ r: 6, strokeWidth: 2, stroke: 'white' }}
                        />
                        <defs>
                          <linearGradient id="gradientLine" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#6366f1" />
                            <stop offset="100%" stopColor="#8b5cf6" />
                          </linearGradient>
                        </defs>
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="ig-empty-state" style={{ height: 300 }}>Sem dados de visualizações.</div>
                )}
              </section>

              {/* Gráfico Donut - Seguidores vs Não Seguidores */}
              <section className="ig-card-white" style={{
                padding: '28px',
                borderRadius: '20px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.06)',
                border: '1px solid rgba(0, 0, 0, 0.05)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </div>
                  <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 700, color: '#111827' }}>
                    Por audiência
                  </h3>
                </div>
                <div style={{ height: 300, position: 'relative' }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Seguidores', value: profileVisitorsTotals?.followers || 35, fill: '#6366f1' },
                          { name: 'Não Seguidores', value: profileVisitorsTotals?.nonFollowers || 65, fill: '#ec4899' }
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={70}
                        outerRadius={110}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {[
                          { name: 'Seguidores', value: profileVisitorsTotals?.followers || 35, fill: '#6366f1' },
                          { name: 'Não Seguidores', value: profileVisitorsTotals?.nonFollowers || 65, fill: '#ec4899' }
                        ].map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: 'white',
                          border: '1px solid #e5e7eb',
                          borderRadius: '12px',
                          padding: '12px',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
                        }}
                        formatter={(value) => `${formatNumber(value)}`}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center',
                    pointerEvents: 'none'
                  }}>
                    <div style={{ fontSize: '32px', fontWeight: 800, color: '#111827' }}>
                      {formatNumber(profileVisitorsTotals?.total || 100)}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500, marginTop: '4px' }}>
                      Total de Visitantes
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', marginTop: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#6366f1' }} />
                    <span style={{ fontSize: '13px', color: '#6b7280', fontWeight: 500 }}>Seguidores</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#ec4899' }} />
                    <span style={{ fontSize: '13px', color: '#6b7280', fontWeight: 500 }}>Não Seguidores</span>
                  </div>
                </div>
              </section>

              {/* Gráfico de Barras - Visualizações por Tipo de Conteúdo */}
              <section className="ig-card-white" style={{
                padding: '28px',
                borderRadius: '20px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.06)',
                border: '1px solid rgba(0, 0, 0, 0.05)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="9" y1="9" x2="15" y2="9" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                  </div>
                  <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 700, color: '#111827' }}>
                    Por tipo de conteúdo
                  </h3>
                </div>
                <div style={{ height: 280 }}>
                  <ResponsiveContainer>
                    <BarChart
                      data={viewsByContentType}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} interval={0} />
                      <YAxis
                        tick={{ fontSize: 12, fill: '#6b7280' }}
                        axisLine={{ stroke: '#e5e7eb' }}
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        tickFormatter={(value) => formatPercent(value)}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'white',
                          border: '1px solid #e5e7eb',
                          borderRadius: '12px',
                          padding: '12px',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
                        }}
                        formatter={(value, name, props) => {
                          const raw = props?.payload?.raw;
                          const rawLabel = Number.isFinite(raw) ? ` (${formatNumber(raw)})` : "";
                          const label = props?.payload?.name || name;
                          return [`${formatPercent(value)}${rawLabel}`, label];
                        }}
                      />
                      <Bar dataKey="value" radius={[8, 8, 0, 0]} barSize={36}>
                        {viewsByContentType.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {/* Top Posts com Visualizações - Carousel Horizontal */}
              <section className="ig-card-white" style={{
                padding: '28px',
                borderRadius: '20px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.06)',
                border: '1px solid rgba(0, 0, 0, 0.05)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                  </div>
                  <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 700, color: '#111827' }}>
                    Mais visualizados
                  </h3>
                </div>
                <div style={{
                  display: 'flex',
                  gap: '16px',
                  overflowX: 'auto',
                  paddingBottom: '12px',
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#6366f1 #f3f4f6'
                }}>
                  {topPostsByViews.length ? topPostsByViews.map((post) => {
                    const views = resolvePostViews(post);
                    const previewUrl = [
                      post.previewUrl,
                      post.preview_url,
                      post.thumbnailUrl,
                      post.thumbnail_url,
                      post.mediaUrl,
                      post.media_url,
                    ].find((url) => url && !/\.(mp4|mov)$/i.test(url));

                    return (
                      <div key={post.id} style={{
                        minWidth: '160px',
                        width: '160px',
                        flexShrink: 0,
                        borderRadius: '16px',
                        overflow: 'hidden',
                        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.03) 0%, rgba(139, 92, 246, 0.03) 100%)',
                        border: '1px solid rgba(99, 102, 241, 0.1)',
                        transition: 'all 0.3s ease',
                        cursor: 'pointer'
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.transform = 'translateY(-4px)';
                        e.currentTarget.style.boxShadow = '0 8px 24px rgba(99, 102, 241, 0.2)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                      onClick={() => {
                        const postUrl = post.permalink || post.url || `https://www.instagram.com/p/${post.id || ''}`;
                        if (postUrl) window.open(postUrl, '_blank', 'noopener,noreferrer');
                      }}
                      >
                        <div style={{
                          width: '160px',
                          height: '284px',
                          background: '#f3f4f6',
                          position: 'relative',
                          overflow: 'hidden'
                        }}>
                          {previewUrl ? (
                            <img
                              src={previewUrl}
                              alt="Post"
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover'
                              }}
                            />
                          ) : (
                            <div style={{
                              width: '100%',
                              height: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#9ca3af'
                            }}>
                              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                <circle cx="8.5" cy="8.5" r="1.5" />
                                <polyline points="21 15 16 10 5 21" />
                              </svg>
                            </div>
                          )}
                          <div style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)',
                            padding: '24px 12px 12px',
                            color: 'white'
                          }}>
                            <div style={{ fontSize: '20px', fontWeight: 700 }}>
                              {formatNumber(views)}
                            </div>
                            <div style={{ fontSize: '11px', opacity: 0.9, marginTop: '2px' }}>
                              visualizações
                            </div>
                          </div>
                        </div>
                        <div style={{ padding: '12px' }}>
                          <div style={{
                            fontSize: '12px',
                            color: '#6b7280',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            lineHeight: '1.4',
                            minHeight: '34px'
                          }}>
                            {post.caption || post.text || 'Sem legenda'}
                          </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="ig-empty-state">Sem posts disponíveis.</div>
                  )}
                </div>
              </section>
            </div>
          </div>

          {/* Responsividade e estilos customizados */}
          <style>{`
            @media (max-width: 1280px) {
              .instagram-dashboard--clean .ig-clean-container > div[style*="grid-template-columns: 1fr 380px"] {
                grid-template-columns: 1fr !important;
              }
            }
            @media (max-width: 768px) {
              .instagram-dashboard--clean .ig-hero__content > div[style*="grid-template-columns"] {
                grid-template-columns: 1fr !important;
              }
            }

            /* Scrollbar customizada para carousel horizontal */
            .instagram-dashboard--clean div[style*="overflowX: auto"]::-webkit-scrollbar {
              height: 8px;
            }
            .instagram-dashboard--clean div[style*="overflowX: auto"]::-webkit-scrollbar-track {
              background: #f3f4f6;
              border-radius: 10px;
            }
            .instagram-dashboard--clean div[style*="overflowX: auto"]::-webkit-scrollbar-thumb {
              background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
              border-radius: 10px;
            }
            .instagram-dashboard--clean div[style*="overflowX: auto"]::-webkit-scrollbar-thumb:hover {
              background: linear-gradient(135deg, #5558e3 0%, #7c3aed 100%);
            }
          `}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="instagram-dashboard instagram-dashboard--clean">
      {metricsError && <div className="alert alert--error">{metricsError}</div>}
      {postsError && <div className="alert alert--error">{postsError}</div>}
      {metricsNotice && <div className="alert">{metricsNotice}</div>}
      {postsNotice && <div className="alert">{postsNotice}</div>}
      {!metricsNotice && !postsNotice && (metricsFetching || postsFetching) ? (
        <div className="alert">Atualizando dados…</div>
      ) : null}

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
                  <Icon size={18} className={tab.iconClass} />
                  <span>{tab.label}</span>
                </Link>
              ) : (
                <button
                  key={tab.id}
                  type="button"
                  className={`ig-clean-tab${isActive ? " ig-clean-tab--active" : ""}`}
                  disabled={!tab.href}
                >
                  <Icon size={18} className={tab.iconClass} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <h2 className="ig-clean-title">Visão Geral</h2>

        {/* Grid Principal */}
          <div className="ig-clean-grid" style={showDetailedView ? { display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '24px' } : {}}>
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
            {!showDetailedView && (
              <>
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
                        interval={reachXAxisInterval}
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
                <p className="ig-card-subtitle">Ganho diário</p>
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
                      barCategoryGap={followerGrowthBarCategoryGap}
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
                          barSize={followerGrowthBarSize}
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
                            endIndex={followerGrowthChartData.length - 1}
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

        {/* Novos Cards: Visualizações e Seguidores */}
        <div className="ig-analytics-grid ig-analytics-grid--pair" style={{ marginTop: '24px' }}>
          {/* Card de Visualizações - Estilo Aprimorado */}
          <section className="ig-card-white ig-analytics-card" style={{ position: 'relative', overflow: 'hidden' }}>

            <div className="ig-analytics-card__header" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              position: 'relative',
              zIndex: 1
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)'
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#111827' }}>Visualizações</h4>
                  <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px', marginBottom: 0 }}>Total de reproduções (Reels, Feed e Stories)</p>
                </div>
              </div>
              <button
                onClick={() => setShowDetailedView(true)}
                style={{
                  padding: '8px 14px',
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 8px rgba(99, 102, 241, 0.25)',
                  whiteSpace: 'nowrap'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(99, 102, 241, 0.35)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(99, 102, 241, 0.25)';
                }}
              >
                Ver mais
              </button>
            </div>

            <div className="ig-analytics-card__body">
              <div style={{ textAlign: 'center', padding: '32px 20px' }}>
                <div style={{
                  fontSize: '56px',
                  fontWeight: 800,
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  marginBottom: '8px',
                  lineHeight: 1
                }}>
                  {formatNumber(profileViewsTotal ?? null)}
                </div>
                <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '28px', fontWeight: 500 }}>
                  visualizações no período
                </div>

                {/* Grid de métricas secundárias */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '12px',
                  marginTop: '20px'
                }}>
                  <div style={{
                    padding: '16px 12px',
                    borderRadius: '12px',
                    background: 'rgba(16, 185, 129, 0.05)',
                    border: '1px solid rgba(16, 185, 129, 0.1)'
                  }}>
                    <div style={{ fontSize: '22px', fontWeight: 700, color: '#10b981' }}>
                      {profileViewsDeltaPct != null ? `${profileViewsDeltaPct > 0 ? '+' : ''}${profileViewsDeltaPct}%` : '--'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px', fontWeight: 500 }}>Crescimento</div>
                  </div>
                  <div style={{
                    padding: '16px 12px',
                    borderRadius: '12px',
                    background: 'rgba(139, 92, 246, 0.05)',
                    border: '1px solid rgba(139, 92, 246, 0.1)'
                  }}>
                    <div style={{ fontSize: '22px', fontWeight: 700, color: '#8b5cf6' }}>
                      {profileViewsAverage != null ? formatNumber(Math.round(profileViewsAverage)) : '--'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px', fontWeight: 500 }}>Média diária</div>
                  </div>
                  <div style={{
                    padding: '16px 12px',
                    borderRadius: '12px',
                    background: 'rgba(168, 85, 247, 0.05)',
                    border: '1px solid rgba(168, 85, 247, 0.1)'
                  }}>
                    <div style={{ fontSize: '22px', fontWeight: 700, color: '#a855f7' }}>
                      {profileViewsPeak != null ? formatNumber(profileViewsPeak) : '--'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px', fontWeight: 500 }}>Pico diário</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Card de Interações */}
          <section className="ig-card-white ig-analytics-card" style={{ position: 'relative', overflow: 'hidden' }}>
            <div className="ig-analytics-card__header" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              paddingBottom: '16px',
              borderBottom: '1px solid #e5e7eb'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <Heart size={20} color="white" fill="white" />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#111827' }}>Interações</h4>
                  <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px', marginBottom: 0 }}>Total de engajamento do público</p>
                </div>
              </div>
              <button
                onClick={() => setShowInteractionsDetail(true)}
                style={{
                  padding: '8px 14px',
                  background: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 8px rgba(236, 72, 153, 0.25)',
                  whiteSpace: 'nowrap'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(236, 72, 153, 0.35)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(236, 72, 153, 0.25)';
                }}
              >
                Ver mais
              </button>
            </div>
            <div className="ig-analytics-card__body">
              <div style={{ textAlign: 'center', padding: '32px 20px' }}>
                <div style={{ fontSize: '48px', fontWeight: 700, color: '#ec4899', marginBottom: '8px' }}>
                  {formatNumber(interactionsBreakdown.total)}
                </div>
                <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '28px' }}>
                  Total de interações no período
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '12px',
                  marginTop: '20px'
                }}>
                  <div style={{
                    padding: '14px',
                    background: '#fef2f2',
                    borderRadius: '10px',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#ef4444', marginBottom: '4px' }}>
                      {formatNumber(interactionsBreakdown.likes)}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>Curtidas</div>
                  </div>
                  <div style={{
                    padding: '14px',
                    background: '#eff6ff',
                    borderRadius: '10px',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#3b82f6', marginBottom: '4px' }}>
                      {formatNumber(interactionsBreakdown.comments)}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>Comentários</div>
                  </div>
                  <div style={{
                    padding: '14px',
                    background: '#fefce8',
                    borderRadius: '10px',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#eab308', marginBottom: '4px' }}>
                      {formatNumber(interactionsBreakdown.saves)}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>Salvamentos</div>
                  </div>
                  <div style={{
                    padding: '14px',
                    background: '#f0fdf4',
                    borderRadius: '10px',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#22c55e', marginBottom: '4px' }}>
                      {formatNumber(interactionsBreakdown.shares)}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>Compartilhamentos</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="ig-analytics-grid ig-analytics-grid--pair" style={{ marginTop: '24px' }}>
          <section className="ig-card-white ig-analytics-card" style={{ gridColumn: 'span 2' }}>
            <div className="ig-analytics-card__header">
              <div>
                <h4>Últimos 5 posts</h4>
                <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
                  Publicações mais recentes no período filtrado
                </p>
              </div>
            </div>
            <div className="ig-analytics-card__body" style={{ padding: 0 }}>
              <PostsTable
                posts={recentPosts.slice(0, RECENT_POSTS_TABLE_LIMIT)}
                loading={recentPostsLoading}
                error={recentPostsError}
              />
            </div>
          </section>
        </div>

        <div className="ig-analytics-grid ig-analytics-grid--pair">
          <section className="ig-card-white ig-analytics-card">
            <div className="ig-analytics-card__header">
              <h4>Audiência</h4>
              <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>Seguidores vs Não Seguidores</p>
            </div>
            <div className="ig-analytics-card__body">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={audienceTypeSeries}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={0}
                    outerRadius={90}
                    paddingAngle={2}
                    stroke="none"
                    isAnimationActive={true}
                    activeIndex={activeGenderIndex}
                    activeShape={{
                      outerRadius: 100,
                    }}
                    onMouseEnter={(_, index) => setActiveGenderIndex(index)}
                    onMouseLeave={() => setActiveGenderIndex(-1)}
                  >
                    {audienceTypeSeries.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index === 0 ? "#f472b6" : "#6366f1"} />
                    ))}
                  </Pie>
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
              <div className="ig-calendar" style={{ transform: 'scale(0.85)', transformOrigin: 'top center' }}>
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
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={[
                    { age: "13-17", male: 20, female: 30 },
                    { age: "18-24", male: 60, female: 80 },
                    { age: "25-34", male: 70, female: 75 },
                    { age: "35-44", male: 40, female: 35 },
                    { age: "45++", male: 30, female: 25 },
                  ]}
                  layout="vertical"
                  margin={{ left: 0, right: 20, top: 10, bottom: 10 }}
                  barGap={4}
                  barCategoryGap="60%"
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
              </>
            )}

            {showDetailedView && (
        <div style={{
          background: 'white',
          borderRadius: '20px',
          padding: '32px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          height: 'fit-content',
          position: 'sticky',
          top: '24px'
        }}>
          {/* Botão de fechar */}
          <button
            onClick={() => setShowDetailedView(false)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'rgba(99, 102, 241, 0.1)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              color: '#6366f1',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              zIndex: 10
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(99, 102, 241, 0.2)';
              e.currentTarget.style.transform = 'rotate(90deg)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)';
              e.currentTarget.style.transform = 'rotate(0deg)';
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Header - removido para mais espaço */}

          {/* KPIs Principais - mantendo apenas Média diária e Pico diário */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '16px',
            marginBottom: '32px'
          }}>
            <div style={{
              padding: '18px',
              borderRadius: '14px',
              background: 'rgba(139, 92, 246, 0.05)',
              border: '1px solid rgba(139, 92, 246, 0.1)'
            }}>
              <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, marginBottom: '6px' }}>
                Média diária
              </div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#8b5cf6' }}>
                {profileViewsAverage != null ? formatNumber(Math.round(profileViewsAverage)) : '--'}
              </div>
            </div>

            <div style={{
              padding: '18px',
              borderRadius: '14px',
              background: 'rgba(168, 85, 247, 0.05)',
              border: '1px solid rgba(168, 85, 247, 0.1)'
            }}>
              <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, marginBottom: '6px' }}>
                Pico diário
              </div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#a855f7' }}>
                {profileViewsPeak != null ? formatNumber(profileViewsPeak) : '--'}
              </div>
            </div>
          </div>

          {/* Gráfico de tendência */}
          <div style={{
            padding: '24px',
            borderRadius: '16px',
            background: '#f9fafb',
            border: '1px solid #e5e7eb'
          }}>
            <h4 style={{ margin: '0 0 20px 0', fontSize: '16px', fontWeight: 700, color: '#111827' }}>
              ?? Tendência de Visualizações
            </h4>
            {profileViewsChartData.length ? (
              <div style={{ height: 280 }}>
                <ResponsiveContainer>
                  <AreaChart data={profileViewsChartData}>
                    <defs>
                      <linearGradient id="detailedViewsGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#6b7280' }}
                      axisLine={{ stroke: '#e5e7eb' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#6b7280' }}
                      axisLine={{ stroke: '#e5e7eb' }}
                      tickLine={false}
                      tickFormatter={(value) => formatNumber(value)}
                    />
                    <Tooltip
                      formatter={(value) => formatNumber(value)}
                      contentStyle={{
                        background: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        fontSize: '12px'
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#6366f1"
                      strokeWidth={2}
                      fill="url(#detailedViewsGradient)"
                      animationDuration={800}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>
                Sem dados de visualizações
              </div>
            )}
          </div>
        </div>
            )}
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
