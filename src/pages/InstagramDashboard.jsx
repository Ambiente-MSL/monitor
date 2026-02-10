import { useEffect, useMemo, useState, useCallback, useLayoutEffect } from "react";
import { Link, useLocation, useOutletContext } from "react-router-dom";
import { useRef } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  ZoomableGroup
} from "react-simple-maps";
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
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import useQueryState from "../hooks/useQueryState";
import { useAccounts } from "../context/AccountsContext";
import PostsTable from "../components/PostsTable";
import DataState from "../components/DataState";
import InstagramPostModal from "../components/InstagramPostModal";
import { DEFAULT_ACCOUNTS } from "../data/accounts";
import WordCloudCard from "../components/WordCloudCard";
import CustomChartTooltip from "../components/CustomChartTooltip";
import InfoTooltip from "../components/InfoTooltip";
import DateRangeIndicator from "../components/DateRangeIndicator";
import { useAuth } from "../context/AuthContext";
import {
  getDashboardCache,
  invalidateCacheForAccount,
  makeCacheKey,
  setDashboardCache,
} from "../lib/dashboardCache";
import { getApiErrorMessage, isApiEnvelope, unwrapApiData } from "../lib/apiEnvelope";
import { formatChartDate, formatCompactNumber, formatTooltipNumber } from "../lib/chartFormatters";
import { normalizeSyncInfo } from "../lib/syncInfo";

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
  { id: "1m", label: "30 dias", days: 30 },
  { id: "3m", label: "90 dias", days: 90 },
  { id: "6m", label: "180 dias", days: 180 },
  { id: "1y", label: "365 dias", days: 365 },
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
const SHORT_MONTH_FORMATTER = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const formatAxisDate = (value) => formatChartDate(value, "short");
const formatTooltipDate = (value) => formatChartDate(value, "medium");

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
const toLocalDateString = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return undefined;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
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

const resolveViewsSeries = (videoSeries, profileSeries) => {
  const buildMap = (series) => {
    const map = new Map();
    (series || []).forEach((entry) => {
      const key = normalizeDateKey(
        entry?.date ||
        entry?.metric_date ||
        entry?.end_time ||
        entry?.endTime ||
        entry?.start_time ||
        entry?.label ||
        entry?.__dateKey,
      );
      if (!key) return;
      const value = extractNumber(entry?.value, null);
      if (value == null) return;
      map.set(key, value);
    });
    return map;
  };

  const videoMap = buildMap(videoSeries);
  const profileMap = buildMap(profileSeries);
  const keys = new Set([...videoMap.keys(), ...profileMap.keys()]);
  return Array.from(keys)
    .sort()
    .map((key) => {
      const videoValue = extractNumber(videoMap.get(key), null);
      const profileValue = extractNumber(profileMap.get(key), null);
      let value = null;
      if (Number.isFinite(videoValue) && videoValue > 0) {
        value = videoValue;
      } else if (Number.isFinite(profileValue)) {
        value = profileValue;
      } else if (Number.isFinite(videoValue)) {
        value = videoValue;
      }
      if (value == null) return null;
      return { date: key, value };
    })
    .filter(Boolean);
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

const scrollTopReels = (direction) => {
  const container = document.querySelector('.top-reels-scroll-container');
  if (!container) return;
  const scrollAmount = 280; // largura do card + gap
  const newPosition = container.scrollLeft + (direction === 'left' ? -scrollAmount : scrollAmount);
  container.scrollTo({ left: newPosition, behavior: 'smooth' });
};

const formatPercent = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0%";
  const rounded = Math.round(numeric * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
};

const formatDeltaPercent = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const roundedAbsolute = Math.abs(Math.round(numeric * 10) / 10);
  const hasFraction = roundedAbsolute % 1 !== 0;
  const formatted = roundedAbsolute.toLocaleString("pt-BR", {
    minimumFractionDigits: hasFraction ? 1 : 0,
    maximumFractionDigits: 1,
  });
  if (numeric > 0) return `+${formatted}%`;
  if (numeric < 0) return `-${formatted}%`;
  return "0%";
};

const getTrendDirection = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric > 0) return "up";
  if (numeric < 0) return "down";
  return "flat";
};

const formatDuration = (seconds) => {
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric) || numeric <= 0) return "00:00:00";
  const total = Math.max(0, Math.round(numeric));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

const formatHour = (hour) => String((hour + 24) % 24).padStart(2, "0");

const buildRecommendedWindow = (peakHour) => {
  if (!Number.isFinite(peakHour)) return "";
  const startHour = (peakHour + 23) % 24; // 30-60 min antes do pico
  const startLabel = `${formatHour(startHour)}:00`;
  const endLabel = `${formatHour(startHour)}:30`;
  return `${startLabel} - ${endLabel}`;
};

const normalizeActiveHours = (activeHours) => {
  if (!activeHours) return [];
  if (Array.isArray(activeHours)) {
    if (!activeHours.length) return [];
    if (typeof activeHours[0] !== "object") {
      return activeHours.map((value, hour) => ({
        hour,
        value: extractNumber(value, 0),
      }));
    }
    return activeHours
      .map((entry, index) => {
        if (!entry || typeof entry !== "object") return null;
        const rawHour = entry.hour ?? entry.key ?? entry.name ?? entry.label ?? index;
        const hour = Number(rawHour);
        if (!Number.isFinite(hour)) return null;
        return {
          hour,
          value: extractNumber(entry.value ?? entry.count ?? entry.total, 0),
        };
      })
      .filter(Boolean);
  }
  if (typeof activeHours === "object") {
    return Object.entries(activeHours)
      .map(([hourKey, value]) => {
        const hour = Number(hourKey);
        if (!Number.isFinite(hour)) return null;
        return { hour, value: extractNumber(value, 0) };
      })
      .filter(Boolean);
  }
  return [];
};

const pickPeakHour = (hours) => {
  let peakHour = null;
  let peakValue = -Infinity;
  hours.forEach((entry) => {
    const hour = Number(entry?.hour);
    if (!Number.isFinite(hour)) return;
    const value = extractNumber(entry?.value, 0);
    if (value > peakValue) {
      peakValue = value;
      peakHour = hour;
    }
  });
  return Number.isFinite(peakHour) ? peakHour : null;
};

const normalizePostMedia = (post) => {
  if (!post || typeof post !== "object") return post;
  const mediaType = post.mediaType ?? post.media_type;
  const mediaProductType = post.mediaProductType ?? post.media_product_type;
  const childrenRaw = post.children;
  const normalizedChildren = Array.isArray(childrenRaw)
    ? childrenRaw
    : Array.isArray(childrenRaw?.data)
      ? childrenRaw.data
      : null;

  const normalized = { ...post };
  if (mediaType && !post.mediaType) normalized.mediaType = mediaType;
  if (mediaType && !post.media_type) normalized.media_type = mediaType;
  if (mediaProductType && !post.mediaProductType) normalized.mediaProductType = mediaProductType;
  if (mediaProductType && !post.media_product_type) normalized.media_product_type = mediaProductType;
  if (normalizedChildren) normalized.children = normalizedChildren;
  return normalized;
};

const normalizePostsList = (posts) => (Array.isArray(posts) ? posts.map(normalizePostMedia) : []);

const classifyMediaType = (post) => {
  const rawMediaType = String(post.mediaType || post.media_type || "").toUpperCase();
  const mediaProductType = String(post.mediaProductType || post.media_product_type || "").toUpperCase();
  const childrenCount = Array.isArray(post.children)
    ? post.children.length
    : Array.isArray(post.children?.data)
      ? post.children.data.length
      : 0;
  const carouselCount = extractNumber(post?.carouselMediaCount ?? post?.carousel_media_count, null);
  const hasChildren = childrenCount > 0 || (carouselCount != null && carouselCount > 1);
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

const analyzeBestTimes = (posts, activeHours) => {
  const normalizedActiveHours = normalizeActiveHours(activeHours);
  const peakHourFromInsights = normalizedActiveHours.length
    ? pickPeakHour(normalizedActiveHours)
    : null;

  if (!Array.isArray(posts) || posts.length === 0) {
    return {
      bestDay: "",
      bestTimeRange: peakHourFromInsights != null ? buildRecommendedWindow(peakHourFromInsights) : "",
      avgEngagement: 0,
      confidence: peakHourFromInsights != null ? "media" : "baixa",
      source: peakHourFromInsights != null ? "insights" : "none",
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

  let bestHour = null;
  let bestHourValue = -Infinity;
  hourTotals.forEach((value, hour) => {
    if (value > bestHourValue) {
      bestHourValue = value;
      bestHour = hour;
    }
  });

  const resolvedPeakHour = peakHourFromInsights ?? bestHour;
  const bestTimeRange = resolvedPeakHour != null ? buildRecommendedWindow(resolvedPeakHour) : "";
  const avgEngagement = Math.round(posts.reduce((sum, post) => sum + sumInteractions(post), 0) / posts.length);
  let confidence = "baixa";
  if (peakHourFromInsights != null) confidence = "alta";
  else if (posts.length >= 30) confidence = "alta";
  else if (posts.length >= 15) confidence = "media";

  return {
    bestDay,
    bestTimeRange,
    avgEngagement,
    confidence,
    source: peakHourFromInsights != null ? "insights" : "posts",
  };
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
const IG_INTERACTION_TYPE_ORDER = ["reels", "posts", "videos"];
const IG_INTERACTION_TYPE_LABEL = {
  reels: "Reels",
  posts: "Posts",
  videos: "Vídeos",
};
const IG_INTERACTION_TYPE_COLORS = {
  reels: "#6366f1",
  posts: "#ec4899",
  videos: "#14b8a6",
};
const INTERACTIONS_TABS = [
  { id: "reels", label: "Reels", icon: "R" },
  { id: "posts", label: "Posts", icon: "P" },
];

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
    () => makeCacheKey({
      page: "instagram",
      endpoint: "metrics",
      accountId: accountSnapshotKey,
      since: sinceParam || "auto",
      until: untilParam || "auto",
    }),
    [accountSnapshotKey, sinceParam, untilParam],
  );
  const postsCacheKey = useMemo(
    () => makeCacheKey({
      page: "instagram",
      endpoint: "posts",
      accountId: accountSnapshotKey,
      since: sinceParam || "auto",
      until: untilParam || "auto",
      extra: { limit: 25 },
    }),
    [accountSnapshotKey, sinceParam, untilParam],
  );
  const postsInsightsCacheKey = useMemo(
    () => makeCacheKey({
      page: "instagram",
      endpoint: "posts-insights",
      accountId: accountSnapshotKey,
      since: sinceParam || "auto",
      until: untilParam || "auto",
      extra: { limit: POSTS_INSIGHTS_LIMIT },
    }),
    [accountSnapshotKey, sinceParam, untilParam],
  );
  const sinceDate = useMemo(() => parseQueryDate(sinceParam), [sinceParam]);
  const untilDate = useMemo(() => parseQueryDate(untilParam), [untilParam]);
  const sinceIso = useMemo(() => toLocalDateString(sinceDate), [sinceDate]);
  const untilIso = useMemo(() => toLocalDateString(untilDate), [untilDate]);
  const audienceTimeframe = useMemo(() => {
    if (!sinceDate || !untilDate) return "this_week";
    const diff = differenceInCalendarDays(endOfDay(untilDate), startOfDay(sinceDate)) + 1;
    return diff <= 7 ? "this_week" : "this_month";
  }, [sinceDate, untilDate]);
  const audienceTimeframeLabel = useMemo(
    () => (audienceTimeframe === "this_month" ? "Últimos 30 dias" : "Últimos 7 dias"),
    [audienceTimeframe],
  );
  const audienceCacheKey = useMemo(
    () => makeCacheKey({
      page: "instagram",
      endpoint: "audience",
      accountId: accountSnapshotKey,
      since: sinceParam || "auto",
      until: untilParam || "auto",
      extra: { timeframe: audienceTimeframe },
    }),
    [accountSnapshotKey, sinceParam, untilParam, audienceTimeframe],
  );

  // Estado para contador de comentários da wordcloud
  const [commentsCount, setCommentsCount] = useState(null);

  useEffect(() => {
    setCommentsCount(null);
  }, [accountSnapshotKey]);

  // Estado para controlar visualização detalhada
  const [showDetailedView, setShowDetailedView] = useState(false);
  const [showInteractionsDetail, setShowInteractionsDetail] = useState(false);
  const [showFollowersDetail, setShowFollowersDetail] = useState(false);
  const [showPostsDetail, setShowPostsDetail] = useState(false);
  const [showWordCloudDetail, setShowWordCloudDetail] = useState(false);
  const [showCitiesDetail, setShowCitiesDetail] = useState(false);
  const [selectedWordCloud, setSelectedWordCloud] = useState(null);
  const [wordCloudDetails, setWordCloudDetails] = useState(null);
  const [wordCloudDetailsLoading, setWordCloudDetailsLoading] = useState(false);
  const [wordCloudDetailsError, setWordCloudDetailsError] = useState("");
  const [wordCloudDetailsLoadingMore, setWordCloudDetailsLoadingMore] = useState(false);
  const [wordCloudDetailsPage, setWordCloudDetailsPage] = useState(1);
  const [interactionsTab, setInteractionsTab] = useState('reels'); // reels, videos, posts

  // Estado para modal de post
  const [selectedPost, setSelectedPost] = useState(null);

  const now = useMemo(() => new Date(), []);
  const defaultEnd = useMemo(() => endOfDay(subDays(startOfDay(now), 1)), [now]);

  useEffect(() => {
    if (!sinceDate || !untilDate) return;
    const maxUntil = endOfDay(defaultEnd);
    const currentUntil = endOfDay(untilDate);
    if (currentUntil <= maxUntil) return;

    const requestedStart = startOfDay(sinceDate);
    const requestedUntil = startOfDay(untilDate);
    const rangeDays = Math.max(
      1,
      differenceInCalendarDays(requestedUntil, requestedStart) + 1,
    );
    const adjustedUntil = maxUntil;
    const adjustedStart = startOfDay(subDays(adjustedUntil, rangeDays - 1));

    setQuery({
      since: toUnixSeconds(adjustedStart),
      until: toUnixSeconds(adjustedUntil),
    });
  }, [defaultEnd, setQuery, sinceDate, untilDate]);

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

  const [metricsSync, setMetricsSync] = useState(() => normalizeSyncInfo(null));

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
    metricsSync,
    resetTopbarConfig,
    setTopbarConfig,
  ]);
  const [metrics, setMetrics] = useState([]);
  const [metricsRollups, setMetricsRollups] = useState(null);
  const [metricsError, setMetricsError] = useState("");
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsNotice, setMetricsNotice] = useState("");
  const [metricsFetching, setMetricsFetching] = useState(false);
  const metricsRequestIdRef = useRef(0);
  const lastMetricsAccountKeyRef = useRef("");
  const lastCacheAccountKeyRef = useRef("");

  const [posts, setPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [postsError, setPostsError] = useState("");
  const [postsNotice, setPostsNotice] = useState("");
  const [postsFetching, setPostsFetching] = useState(false);
  const postsRequestIdRef = useRef(0);
  const lastPostsAccountKeyRef = useRef("");
  const [recentPosts, setRecentPosts] = useState([]);
  const [recentPostsLoading, setRecentPostsLoading] = useState(false);
  const [recentPostsFetching, setRecentPostsFetching] = useState(false);
  const [recentPostsError, setRecentPostsError] = useState("");
  const recentPostsRequestIdRef = useRef(0);
  const topReelsScrollRef = useRef(null);

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
  const [followerGainSeries, setFollowerGainSeries] = useState([]);
  const [followersGainedTotal, setFollowersGainedTotal] = useState(null);
  const [audienceData, setAudienceData] = useState(null);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audienceFetching, setAudienceFetching] = useState(false);
  const [audienceError, setAudienceError] = useState("");
  const audienceRequestIdRef = useRef(0);
  const [followerCounts, setFollowerCounts] = useState(null);
  const [overviewSnapshot, setOverviewSnapshot] = useState(null);
  const [reachCacheSeries, setReachCacheSeries] = useState([]);
  const [profileViewsSeries, setProfileViewsSeries] = useState([]);
  const [videoViewsSeries, setVideoViewsSeries] = useState([]);
  const [profileVisitorsBreakdown, setProfileVisitorsBreakdown] = useState(null);
  const [activeFollowerGrowthBar, setActiveFollowerGrowthBar] = useState(-1);
  const [activeEngagementIndex, setActiveEngagementIndex] = useState(-1);
  const [activeGenderIndex, setActiveGenderIndex] = useState(-1);
  const lastUiAccountKeyRef = useRef("");

  useLayoutEffect(() => {
    const previousKey = lastUiAccountKeyRef.current;
    if (previousKey && previousKey !== accountSnapshotKey) {
      // Limpa estados para evitar exibir dados da conta anterior ao trocar o seletor.
      setMetrics([]);
      setMetricsRollups(null);
      setFollowerSeries([]);
      setFollowerGainSeries([]);
      setFollowersGainedTotal(null);
      setFollowerCounts(null);
      setReachCacheSeries([]);
      setProfileViewsSeries([]);
      setVideoViewsSeries([]);
      setProfileVisitorsBreakdown(null);
      setMetricsError("");
      setMetricsNotice("");
      setMetricsFetching(false);
      setMetricsLoading(false);
      setMetricsSync(normalizeSyncInfo(null));
      setOverviewSnapshot(null);

      setPosts([]);
      setAccountInfo(null);
      setPostsError("");
      setPostsNotice("");
      setPostsFetching(false);
      setLoadingPosts(false);

      setRecentPosts([]);
      setRecentPostsError("");
      setRecentPostsFetching(false);
      setRecentPostsLoading(false);

      setAudienceData(null);
      setAudienceError("");
      setAudienceFetching(false);
      setAudienceLoading(false);

      setCoverImage(null);
      setCoverError("");
      setCoverLoading(false);

      setCommentsCount(null);
      setActiveFollowerGrowthBar(-1);
      setActiveEngagementIndex(-1);
      setActiveGenderIndex(-1);
    }

    lastUiAccountKeyRef.current = accountSnapshotKey || "";
  }, [accountSnapshotKey]);

  const activeSnapshot = useMemo(
    () => (overviewSnapshot?.accountId === accountSnapshotKey && accountSnapshotKey ? overviewSnapshot : null),
    [accountSnapshotKey, overviewSnapshot],
  );

  useEffect(() => {
    const previousKey = lastCacheAccountKeyRef.current;
    if (previousKey && previousKey !== accountSnapshotKey) {
      invalidateCacheForAccount(previousKey, "instagram");
    }
    lastCacheAccountKeyRef.current = accountSnapshotKey || "";
  }, [accountSnapshotKey]);

  useEffect(() => {
    const currentAccountKey = accountSnapshotKey;
    const previousAccountKey = lastMetricsAccountKeyRef.current;
    const isFirstLoadForAccount = !previousAccountKey;
    const accountChanged = Boolean(previousAccountKey) && previousAccountKey !== currentAccountKey;
    lastMetricsAccountKeyRef.current = currentAccountKey;
    setMetricsSync(normalizeSyncInfo(null));

    if (!accountConfig?.instagramUserId) {
      setMetrics([]);
      setMetricsRollups(null);
      setFollowerSeries([]);
      setFollowerGainSeries([]);
      setFollowersGainedTotal(null);
      setFollowerCounts(null);
      setReachCacheSeries([]);
      setProfileViewsSeries([]);
      setVideoViewsSeries([]);
      setProfileVisitorsBreakdown(null);
      setOverviewSnapshot(null);
      setMetricsLoading(false);
      setMetricsFetching(false);
      setMetricsNotice("");
      setMetricsError("Conta do Instagram não configurada.");
      return;
    }

    const cachedMetrics = getDashboardCache(metricsCacheKey);
    const hasCachedMetrics = Boolean(cachedMetrics);
    let shouldRefreshForReach = false;
    if (cachedMetrics) {
      if (cachedMetrics.sync) {
        setMetricsSync(cachedMetrics.sync);
      }
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
      setMetricsRollups(cachedMetrics.rollups ?? null);
      setFollowerSeries(Array.isArray(cachedMetrics.followerSeries) ? cachedMetrics.followerSeries : []);
      setFollowerGainSeries(Array.isArray(cachedMetrics.followerGainSeries) ? cachedMetrics.followerGainSeries : []);
      setFollowersGainedTotal(
        cachedMetrics.followersGainedTotal != null ? cachedMetrics.followersGainedTotal : null,
      );
      setFollowerCounts(cachedMetrics.followerCounts ?? null);
      setReachCacheSeries(Array.isArray(cachedMetrics.reachSeries) ? cachedMetrics.reachSeries : []);
      const cachedVideoSeries = Array.isArray(cachedMetrics.videoViewsSeries)
        ? cachedMetrics.videoViewsSeries
        : [];
      const cachedProfileSeries = Array.isArray(cachedMetrics.profileViewsSeries)
        ? cachedMetrics.profileViewsSeries
        : [];
      const cachedViewsSeries = resolveViewsSeries(cachedVideoSeries, cachedProfileSeries);
      setProfileViewsSeries(cachedViewsSeries);
      setVideoViewsSeries(cachedVideoSeries);
      setProfileVisitorsBreakdown(cachedMetrics.profileVisitorsBreakdown ?? null);
      setMetricsError("");
      setMetricsNotice("");
      setMetricsLoading(false);

      if (shouldBypassCacheForReach) {
        shouldRefreshForReach = true;
      }
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
    const shouldBlockUi = (isFirstLoadForAccount || accountChanged) && !hasCachedMetrics;

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
         const payload = unwrapApiData(json, {});
         const meta = isApiEnvelope(json) ? json.meta : json.meta || null;
         return { payload, meta };
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
      setMetricsRollups(null);
      setFollowerSeries([]);
      setFollowerGainSeries([]);
      setFollowersGainedTotal(null);
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
          ? "Atualizando serie diaria de alcance..."
          : hasCachedMetrics
            ? "Atualizando metricas do periodo selecionado (exibindo dados em cache)..."
            : "Atualizando metricas do periodo selecionado...",
      );
    }

    setMetricsFetching(true);
    setMetricsError("");
    setOverviewSnapshot(null);

    if (shouldBlockUi) {
      trackTimeout(setTimeout(() => {
        if (cancelled || metricsRequestIdRef.current !== requestId) return;
        setMetricsLoading(false);
        setMetricsNotice("Atualizando metricas... isso pode levar alguns segundos na primeira vez.");
      }, SOFT_LOADING_MS));
    }

    (async () => {
      try {
        const { payload, meta } = await fetchMetricsPayload(0);
        if (cancelled || metricsRequestIdRef.current !== requestId) return;

        const syncInfo = normalizeSyncInfo(meta);
        setMetricsSync(syncInfo);

        const fetchedMetrics = payload.metrics || [];
        const fetchedFollowerSeries = Array.isArray(payload.follower_series) ? payload.follower_series : [];
        const fetchedFollowerGainSeries = Array.isArray(payload.followers_gain_series) ? payload.followers_gain_series : [];
        const fetchedFollowersGainedTotal = extractNumber(payload.followers_gained_total, null);
        const fetchedFollowerCounts = payload.follower_counts || null;
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
        const reachSeries = parseNumericSeries(payload.reach_timeseries);
        const parsedVideoViewsSeries = parseNumericSeries(payload.video_views_timeseries);
        const parsedProfileViewsSeries = parseNumericSeries(payload.profile_views_timeseries);
        const resolvedViewsSeries = resolveViewsSeries(parsedVideoViewsSeries, parsedProfileViewsSeries);
        const visitorsBreakdown = payload.profile_visitors_breakdown || null;

        setMetrics(fetchedMetrics);
        setMetricsRollups(payload?.rollups ?? null);
        setFollowerSeries(fetchedFollowerSeries);
        setFollowerGainSeries(fetchedFollowerGainSeries);
        setFollowersGainedTotal(fetchedFollowersGainedTotal);
        setFollowerCounts(fetchedFollowerCounts);
        setReachCacheSeries(reachSeries);
        setProfileViewsSeries(resolvedViewsSeries);
        setVideoViewsSeries(parsedVideoViewsSeries);
        setProfileVisitorsBreakdown(visitorsBreakdown);
        setDashboardCache(metricsCacheKey, {
          metrics: fetchedMetrics,
          rollups: payload?.rollups ?? null,
          followerSeries: fetchedFollowerSeries,
          followerGainSeries: fetchedFollowerGainSeries,
          followersGainedTotal: fetchedFollowersGainedTotal,
          followerCounts: fetchedFollowerCounts,
          reachSeries,
          profileViewsSeries: resolvedViewsSeries,
          videoViewsSeries: parsedVideoViewsSeries,
          profileVisitorsBreakdown: visitorsBreakdown,
          sync: syncInfo,
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
          setMetricsRollups(null);
          setFollowerSeries([]);
          setFollowerGainSeries([]);
          setFollowersGainedTotal(null);
          setFollowerCounts(null);
          setReachCacheSeries([]);
          setProfileViewsSeries([]);
          setVideoViewsSeries([]);
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
    const hasCachedPosts = Boolean(cachedPosts);
    if (cachedPosts) {
      const cachedList = normalizePostsList(Array.isArray(cachedPosts.posts) ? cachedPosts.posts : []);
      setPosts(cachedList);
      setAccountInfo(cachedPosts.accountInfo || null);
      setPostsError("");
      setLoadingPosts(false);
      setPostsNotice("");
    }

    const requestId = (postsRequestIdRef.current || 0) + 1;
    postsRequestIdRef.current = requestId;

    const SOFT_LOADING_MS = 3000;
    const REQUEST_TIMEOUT_MS = 30000;
    const MAX_ATTEMPTS = 2;
    const shouldBlockUi = (isFirstLoadForAccount || accountChanged) && !hasCachedPosts;

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
      const params = new URLSearchParams({ igUserId: accountConfig.instagramUserId, limit: "25" });
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
      setPostsNotice(
        hasCachedPosts
          ? "Atualizando posts do periodo selecionado (exibindo dados em cache)..."
          : "Atualizando posts do periodo selecionado...",
      );
    }

    setPostsFetching(true);
    setPostsError("");

    if (shouldBlockUi) {
      trackTimeout(setTimeout(() => {
        if (cancelled || postsRequestIdRef.current !== requestId) return;
        setLoadingPosts(false);
        setPostsNotice("Atualizando posts... isso pode levar alguns segundos na primeira vez.");
      }, SOFT_LOADING_MS));
    }

    (async () => {
      try {
        const json = await fetchPostsPayload(0);
        if (cancelled || postsRequestIdRef.current !== requestId) return;

        const normalizedPosts = normalizePostsList(Array.isArray(json?.posts) ? json.posts : []);
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
      setRecentPostsFetching(false);
      return undefined;
    }

    const cachedPosts = getDashboardCache(postsInsightsCacheKey);
    const hasCachedPosts = Boolean(cachedPosts);
    if (cachedPosts) {
      const cachedList = normalizePostsList(Array.isArray(cachedPosts.posts) ? cachedPosts.posts : []);
      setRecentPosts(cachedList);
      setRecentPostsError("");
      setRecentPostsLoading(false);
    }

    const requestId = (recentPostsRequestIdRef.current || 0) + 1;
    recentPostsRequestIdRef.current = requestId;
    const controller = new AbortController();
    const REQUEST_TIMEOUT_MS = 15000;
    const hardTimeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const shouldBlockUi = !hasCachedPosts;
    let cancelled = false;

    if (shouldBlockUi) {
      setRecentPosts([]);
      setRecentPostsLoading(true);
    } else {
      setRecentPostsLoading(false);
    }
    setRecentPostsError("");
    setRecentPostsFetching(true);

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
         if (cancelled || recentPostsRequestIdRef.current !== requestId) return;
         const data = unwrapApiData(json, {});
         const normalizedPosts = normalizePostsList(Array.isArray(data?.posts) ? data.posts : []);
         setRecentPosts(normalizedPosts);
         setDashboardCache(postsInsightsCacheKey, { posts: normalizedPosts });
         setRecentPostsError("");
       } catch (err) {
        if (cancelled || recentPostsRequestIdRef.current !== requestId) return;
        if (err?.name === "AbortError") {
          setRecentPostsError("Tempo esgotado ao carregar publicacoes do Instagram.");
        } else {
          setRecentPostsError(err?.message || "Nao foi possivel carregar as publicacoes.");
        }
      } finally {
        if (cancelled || recentPostsRequestIdRef.current !== requestId) return;
        clearTimeout(hardTimeout);
        setRecentPostsLoading(false);
        setRecentPostsFetching(false);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(hardTimeout);
      controller.abort();
    };
  }, [accountConfig?.instagramUserId, accountSnapshotKey, sinceParam, untilParam, postsInsightsCacheKey]);

  useEffect(() => {
    if (!accountConfig?.instagramUserId) {
      setAudienceData(null);
      setAudienceError("Conta do Instagram nao configurada.");
      setAudienceLoading(false);
      setAudienceFetching(false);
      return undefined;
    }

    const cached = getDashboardCache(audienceCacheKey);
    const hasCached = Boolean(cached);
    if (cached) {
      setAudienceData(cached);
      setAudienceError("");
      setAudienceLoading(false);
    }

    const requestId = (audienceRequestIdRef.current || 0) + 1;
    audienceRequestIdRef.current = requestId;
    const controller = new AbortController();
    const REQUEST_TIMEOUT_MS = 15000;
    const hardTimeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const shouldBlockUi = !hasCached;
    let cancelled = false;

    if (shouldBlockUi) {
      setAudienceData(null);
      setAudienceLoading(true);
    } else {
      setAudienceLoading(false);
    }
    setAudienceError("");
    setAudienceFetching(true);

    const audienceParams = new URLSearchParams({
      igUserId: accountConfig.instagramUserId,
      timeframe: audienceTimeframe,
    });
    if (sinceParam) {
      audienceParams.set("since", sinceParam);
    }
    if (untilParam) {
      audienceParams.set("until", untilParam);
    }
    const url = `${API_BASE_URL}/api/instagram/audience?${audienceParams.toString()}`;

    (async () => {
      try {
        const resp = await fetch(url, { signal: controller.signal });
        const text = await resp.text();
        const json = safeParseJson(text) || {};
        if (!resp.ok) {
          throw new Error(describeApiError(json, "Nao foi possivel carregar a audiencia."));
        }
        if (cancelled || audienceRequestIdRef.current !== requestId) return;
        const data = unwrapApiData(json, {});
        setAudienceData(data);
        setDashboardCache(audienceCacheKey, data);
        setAudienceError("");
      } catch (err) {
        if (cancelled || audienceRequestIdRef.current !== requestId) return;
        if (err?.name === "AbortError") {
          setAudienceError("Tempo esgotado ao carregar audiencia.");
        } else {
          setAudienceError(err?.message || "Nao foi possivel carregar a audiencia.");
        }
      } finally {
        if (cancelled || audienceRequestIdRef.current !== requestId) return;
        clearTimeout(hardTimeout);
        setAudienceLoading(false);
        setAudienceFetching(false);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(hardTimeout);
      controller.abort();
    };
  }, [accountConfig?.instagramUserId, audienceCacheKey, audienceTimeframe]);

const metricsByKey = useMemo(() => mapByKey(metrics), [metrics]);
 const reachMetric = metricsByKey.reach;
 const followersMetric = metricsByKey.followers_total;
 const followersGainedMetric = metricsByKey.followers_gained;
 const followerGrowthMetric = metricsByKey.follower_growth;
 const engagementRateMetric = metricsByKey.engagement_rate;
const videoViewsMetric = metricsByKey.video_views;
const videoAvgWatchTimeMetric = metricsByKey.video_avg_watch_time;
const profileViewsMetricRaw = metricsByKey.profile_views;
const profileViewsMetric = useMemo(() => {
  const videoValue = extractNumber(videoViewsMetric?.value, null);
  const profileValue = extractNumber(profileViewsMetricRaw?.value, null);
  if (videoValue != null && videoValue > 0) return videoViewsMetric;
  if (profileValue != null) return profileViewsMetricRaw;
  return videoViewsMetric || profileViewsMetricRaw;
}, [videoViewsMetric, profileViewsMetricRaw]);
 const interactionsMetric = metricsByKey.interactions;
 const interactionsSeriesFromRollup = useMemo(() => {
   if (!metricsRollups || !sinceDate || !untilDate) return [];
   const diff = differenceInCalendarDays(endOfDay(untilDate), startOfDay(sinceDate)) + 1;
   const bucket = diff === 7 ? "7d" : diff === 30 ? "30d" : diff === 90 ? "90d" : null;
   if (!bucket) return [];
   const rollupEntry = metricsRollups?.[bucket]?.interactions;
   const rawPayload = rollupEntry?.payload;
   const payload = typeof rawPayload === "string" ? safeParseJson(rawPayload) : rawPayload;
   const values = Array.isArray(payload?.values) ? payload.values : [];
   return values
     .map((entry) => {
       const dateKey = normalizeDateKey(entry?.metric_date || entry?.date || entry?.label);
       if (!dateKey) return null;
       const value = extractNumber(entry?.value, null);
       if (value == null) return null;
       return { date: dateKey, value };
     })
     .filter(Boolean)
     .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
 }, [metricsRollups, sinceDate, untilDate]);
 const interactionsSeriesFromMetric = useMemo(() => seriesFromMetric(interactionsMetric), [interactionsMetric]);

  const reachMetricValue = useMemo(() => extractNumber(reachMetric?.value, null), [reachMetric?.value]);
  const timelineReachSeries = useMemo(() => seriesFromMetric(reachMetric), [reachMetric]);
  const videoViewsSeriesFromMetric = useMemo(() => seriesFromMetric(videoViewsMetric), [videoViewsMetric]);
  const resolvedVideoViewsSeries = useMemo(() => {
    const baseSeries = videoViewsSeries.length ? videoViewsSeries : videoViewsSeriesFromMetric;
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
  }, [videoViewsSeriesFromMetric, videoViewsSeries, sinceDate, untilDate]);
  const profileViewsSeriesFromMetric = useMemo(() => seriesFromMetric(profileViewsMetric), [profileViewsMetric]);
  const resolvedProfileViewsSeries = useMemo(() => {
    const baseSeries = profileViewsSeries.length ? profileViewsSeries : profileViewsSeriesFromMetric;
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
  const videoViewsTotal = useMemo(() => {
    const metricValue = extractNumber(videoViewsMetric?.value, null);
    if (!resolvedVideoViewsSeries.length) {
      return metricValue != null ? metricValue : null;
    }
    const seriesTotal = resolvedVideoViewsSeries.reduce((sum, entry) => sum + extractNumber(entry.value, 0), 0);
    if (metricValue == null) return seriesTotal;
    if (metricValue === 0 && seriesTotal > 0) return seriesTotal;
    return metricValue;
  }, [videoViewsMetric?.value, resolvedVideoViewsSeries]);
  const videoViewsPeak = useMemo(() => {
    if (!resolvedVideoViewsSeries.length) return null;
    return resolvedVideoViewsSeries.reduce((max, entry) => Math.max(max, extractNumber(entry.value, 0)), 0);
  }, [resolvedVideoViewsSeries]);
  const videoViewsDays = useMemo(() => {
    if (sinceDate && untilDate) {
      return differenceInCalendarDays(endOfDay(untilDate), startOfDay(sinceDate)) + 1;
    }
    return resolvedVideoViewsSeries.length || null;
  }, [sinceDate, untilDate, resolvedVideoViewsSeries.length]);
  const videoViewsAverage = useMemo(() => {
    if (videoViewsTotal == null || !videoViewsDays) return null;
    if (videoViewsDays <= 0) return null;
    return videoViewsTotal / videoViewsDays;
  }, [videoViewsTotal, videoViewsDays]);
  const videoViewsChartData = useMemo(() => {
    const base = resolvedVideoViewsSeries
      .map((entry) => {
        const value = extractNumber(entry.value, null);
        if (value == null) return null;
        const dateLabel = entry.date
          ? new Date(`${entry.date}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
          : "";
        const tooltipDate = entry.date
          ? new Date(`${entry.date}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
          : "";
        return {
          label: dateLabel,
          date: entry.date,
          value,
          tooltipDate,
        };
      })
      .filter(Boolean);

    if (base.length < 3) return base;

    return base.map((entry, index) => {
      if (entry.value !== 0) return entry;
      const prev = base[index - 1]?.value ?? null;
      const next = base[index + 1]?.value ?? null;
      if (Number.isFinite(prev) && prev > 0 && Number.isFinite(next) && next > 0) {
        return { ...entry, value: null };
      }
      return entry;
    });
  }, [resolvedVideoViewsSeries]);
  const profileViewsTotal = useMemo(() => {
    const metricValue = extractNumber(profileViewsMetric?.value, null);
    if (!resolvedProfileViewsSeries.length) {
      return metricValue != null ? metricValue : null;
    }
    const seriesTotal = resolvedProfileViewsSeries.reduce((sum, entry) => sum + extractNumber(entry.value, 0), 0);
    if (metricValue == null) return seriesTotal;
    if (metricValue === 0 && seriesTotal > 0) return seriesTotal;
    return metricValue;
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
  const videoAvgWatchTimeSeconds = useMemo(
    () => extractNumber(videoAvgWatchTimeMetric?.value, null),
    [videoAvgWatchTimeMetric?.value],
  );
  const videoAvgWatchTimeDisplay = useMemo(
    () => formatDuration(videoAvgWatchTimeSeconds),
    [videoAvgWatchTimeSeconds],
  );
  const reachDeltaPct = useMemo(() => extractNumber(reachMetric?.deltaPct, null), [reachMetric?.deltaPct]);
  const reachDeltaDirection = useMemo(() => getTrendDirection(reachDeltaPct), [reachDeltaPct]);
  const reachDeltaDisplay = useMemo(() => formatDeltaPercent(reachDeltaPct), [reachDeltaPct]);
  const interactionsMetricValue = useMemo(() => extractNumber(interactionsMetric?.value, null), [interactionsMetric?.value]);
  const interactionsDeltaPct = useMemo(() => extractNumber(interactionsMetric?.deltaPct, null), [interactionsMetric?.deltaPct]);
  const interactionsDeltaDirection = useMemo(() => getTrendDirection(interactionsDeltaPct), [interactionsDeltaPct]);
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
    return formatDeltaPercent(interactionsDeltaPct);
  }, [interactionsDeltaPct]);
  const profileViewsChartData = useMemo(() => {
    const base = resolvedProfileViewsSeries
      .map((entry) => {
        const value = extractNumber(entry.value, null);
        if (value == null) return null;
        const dateLabel = entry.date
          ? new Date(`${entry.date}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
          : "";
        return {
          label: dateLabel,
          date: entry.date,
          value,
        };
      })
      .filter(Boolean);

    if (base.length < 3) return base;

    return base.map((entry, index) => {
      if (entry.value !== 0) return entry;
      const prev = base[index - 1]?.value ?? null;
      const next = base[index + 1]?.value ?? null;
      if (Number.isFinite(prev) && prev > 0 && Number.isFinite(next) && next > 0) {
        return { ...entry, value: null };
      }
      return entry;
    });
  }, [resolvedProfileViewsSeries]);
  const followerSeriesNormalized = useMemo(() => (followerSeries || [])
    .map((entry) => {
      const dateKey = normalizeDateKey(entry.date || entry.end_time || entry.endTime);
      if (!dateKey) return null;
      return { date: dateKey, value: extractNumber(entry.value, null) };
    })
    .filter(Boolean), [followerSeries]);
  const followerGainSeriesNormalized = useMemo(() => (followerGainSeries || [])
    .map((entry) => {
      const dateKey = normalizeDateKey(
        entry.date || entry.metric_date || entry.end_time || entry.endTime || entry.label,
      );
      if (!dateKey) return null;
      const value = extractNumber(entry.value, null);
      if (value == null) return null;
      return { date: dateKey, value };
    })
    .filter(Boolean)
    .sort((a, b) => (a.date || "").localeCompare(b.date || "")), [followerGainSeries]);
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
  const followerGainSeriesInRange = useMemo(() => {
    if (!followerGainSeriesNormalized.length) return [];
    if (!sinceDate && !untilDate) return followerGainSeriesNormalized;
    const startBoundary = sinceDate ? startOfDay(sinceDate).getTime() : null;
    const endBoundary = untilDate ? endOfDay(untilDate).getTime() : null;
    return followerGainSeriesNormalized.filter((item) => {
      if (!item?.date) return false;
      const currentDate = new Date(`${item.date}T00:00:00`);
      const current = currentDate.getTime();
      if (Number.isNaN(current)) return false;
      if (startBoundary != null && current < startBoundary) return false;
      if (endBoundary != null && current > endBoundary) return false;
      return true;
    });
  }, [followerGainSeriesNormalized, sinceDate, untilDate]);

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

  const contentPostsSource = useMemo(() => {
    if (!filteredPosts.length && !recentPosts.length) return [];
    const byId = new Map();
    const extras = [];
    const mergePost = (primary, secondary) => {
      const merged = { ...secondary, ...primary };
      if (!merged.children && secondary.children) merged.children = secondary.children;
      if (!merged.mediaType && secondary.mediaType) merged.mediaType = secondary.mediaType;
      if (!merged.media_type && secondary.media_type) merged.media_type = secondary.media_type;
      if (!merged.mediaProductType && secondary.mediaProductType) merged.mediaProductType = secondary.mediaProductType;
      if (!merged.media_product_type && secondary.media_product_type) merged.media_product_type = secondary.media_product_type;
      return merged;
    };
    const addPost = (post, preferPrimary) => {
      if (!post) return;
      const id = post.id;
      if (!id) {
        extras.push(post);
        return;
      }
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, post);
        return;
      }
      byId.set(id, preferPrimary ? mergePost(post, existing) : mergePost(existing, post));
    };

    recentPosts.forEach((post) => addPost(post, true));
    filteredPosts.forEach((post) => addPost(post, false));
    const merged = Array.from(byId.values());
    return extras.length ? [...merged, ...extras] : merged;
  }, [filteredPosts, recentPosts]);
  const totalInteractionsLikesComments = useMemo(() => {
    if (metricsLoading) return null;

    // Inclui curtidas, comentários, compartilhamentos e salvamentos
    if (contentPostsSource.length) {
      let total = 0;
      let hasMetric = false;

      contentPostsSource.forEach((post) => {
        const likes = resolvePostMetric(post, "likes", null);
        const comments = resolvePostMetric(post, "comments", null);
        const shares = resolvePostMetric(post, "shares", null);
        const saves = resolvePostMetric(post, "saves", null);
        if (likes != null || comments != null || shares != null || saves != null) hasMetric = true;
        total += (likes || 0) + (comments || 0) + (shares || 0) + (saves || 0);
      });

      if (hasMetric) return Math.max(0, total);
    }

    const likesFromBreakdown = extractNumber(interactionsBreakdown.likes, null);
    const commentsFromBreakdown = extractNumber(interactionsBreakdown.comments, null);
    const sharesFromBreakdown = extractNumber(interactionsBreakdown.shares, null);
    const savesFromBreakdown = extractNumber(interactionsBreakdown.saves, null);
    if (likesFromBreakdown == null && commentsFromBreakdown == null && sharesFromBreakdown == null && savesFromBreakdown == null) return null;
    return Math.max(0, (likesFromBreakdown || 0) + (commentsFromBreakdown || 0) + (sharesFromBreakdown || 0) + (savesFromBreakdown || 0));
  }, [contentPostsSource, interactionsBreakdown.comments, interactionsBreakdown.likes, interactionsBreakdown.shares, interactionsBreakdown.saves, metricsLoading]);
  const interactionsDailyTotals = useMemo(() => {
    if (!contentPostsSource.length) return [];
    const totals = new Map();
    contentPostsSource.forEach((post) => {
      const dateKey = normalizeDateKey(post.timestamp || post.timestamp_unix);
      if (!dateKey) return;
      const value = resolvePostInteractions(post);
      totals.set(dateKey, (totals.get(dateKey) || 0) + value);
    });
    return Array.from(totals.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }, [contentPostsSource]);
  const interactionsSeriesResolved = useMemo(() => {
    const baseSeries = interactionsSeriesFromRollup.length
      ? interactionsSeriesFromRollup
      : (interactionsSeriesFromMetric.length ? interactionsSeriesFromMetric : interactionsDailyTotals);
    if (!baseSeries.length) return [];
    const normalized = baseSeries
      .map((entry) => {
        const dateKey = normalizeDateKey(
          entry?.date || entry?.metric_date || entry?.end_time || entry?.endTime || entry?.label,
        );
        if (!dateKey) return null;
        return { date: dateKey, value: extractNumber(entry?.value, 0) };
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
  }, [interactionsDailyTotals, interactionsSeriesFromMetric, interactionsSeriesFromRollup, sinceDate, untilDate]);
  const interactionsChartData = useMemo(() => {
    if (!interactionsSeriesResolved.length) return [];
    const firstDateKey = interactionsSeriesResolved[0]?.date;
    const lastDateKey = interactionsSeriesResolved[interactionsSeriesResolved.length - 1]?.date;
    if (!firstDateKey || !lastDateKey) return [];

    const maxRangeEnd = startOfDay(defaultEnd);
    const requestedStart = sinceDate ? startOfDay(sinceDate) : null;
    const requestedEnd = untilDate ? startOfDay(untilDate) : null;
    const rangeEndCandidate = requestedEnd || new Date(`${lastDateKey}T00:00:00`);
    const rangeEnd = rangeEndCandidate > maxRangeEnd ? maxRangeEnd : rangeEndCandidate;

    let rangeStart = requestedStart || new Date(`${firstDateKey}T00:00:00`);
    if (requestedStart && requestedEnd && requestedEnd > maxRangeEnd) {
      const span = Math.max(1, differenceInCalendarDays(requestedEnd, requestedStart) + 1);
      rangeStart = startOfDay(subDays(rangeEnd, span - 1));
    }

    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
      return [];
    }
    if (rangeStart > rangeEnd) {
      return [];
    }

    const startKey = rangeStart.toISOString().slice(0, 10);
    const endKey = rangeEnd.toISOString().slice(0, 10);
    const hasDataInRange = interactionsSeriesResolved.some(
      (entry) => entry.date >= startKey && entry.date <= endKey,
    );
    if (!hasDataInRange) return [];

    const totalsByDate = new Map();
    interactionsSeriesResolved.forEach((entry) => {
      const value = extractNumber(entry.value, 0);
      totalsByDate.set(entry.date, (totalsByDate.get(entry.date) || 0) + value);
    });

    return eachDayOfInterval({ start: rangeStart, end: rangeEnd }).map((day) => {
      const dateKey = day.toISOString().slice(0, 10);
      return {
        date: dateKey,
        value: totalsByDate.has(dateKey) ? totalsByDate.get(dateKey) : 0,
        tooltipDate: formatTooltipDate(dateKey),
      };
    });
  }, [defaultEnd, interactionsSeriesResolved, sinceDate, untilDate]);
  const interactionsPeak = useMemo(() => {
    if (!interactionsChartData.length) return null;
    return interactionsChartData.reduce((maxValue, entry) => (
      Math.max(maxValue, extractNumber(entry.value, 0))
    ), 0);
  }, [interactionsChartData]);
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
    const sumGainSeries = (series) => {
      if (!Array.isArray(series) || !series.length) return null;
      let total = 0;
      let hasValue = false;
      series.forEach((entry) => {
        const value = extractNumber(entry?.value, null);
        if (value == null) return;
        hasValue = true;
        total += Math.max(0, value);
      });
      if (!hasValue) return null;
      return total > 0 ? total : 0;
    };

    const gainedMetricValue = extractNumber(followersGainedMetric?.value, null);
    if (gainedMetricValue != null) {
      return Math.max(0, Math.round(gainedMetricValue));
    }

    const gainedTotalValue = extractNumber(followersGainedTotal, null);
    if (gainedTotalValue != null) {
      return Math.max(0, Math.round(gainedTotalValue));
    }

    const followsCount = extractNumber(followerCounts?.follows, null);
    if (followsCount != null) {
      return Math.max(0, Math.round(followsCount));
    }

    const gainInRange = sumGainSeries(followerGainSeriesInRange);
    if (Number.isFinite(gainInRange)) {
      return Math.round(gainInRange);
    }

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

    return null;
  }, [
    followersGainedTotal,
    followerCounts,
    followersGainedMetric?.value,
    followerGainSeriesInRange,
    followerGrowthMetric?.value,
    followerSeriesInRange,
    followerSeriesNormalized,
    metricsLoading,
    sinceDate,
    untilDate,
  ]);



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
      .map((entry) => {
        const dateKey = entry?.dateKey || resolveEntryDateKey(entry);
        const label = entry?.label || (dateKey ? SHORT_DATE_FORMATTER.format(new Date(`${dateKey}T00:00:00`)) : "");
        return {
          ...entry,
          dateKey,
          label,
          value: extractNumber(entry.value, 0),
        };
      })
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
    return [...normalizedReachSeries].sort((a, b) => {
      const aKey = a?.dateKey || "";
      const bKey = b?.dateKey || "";
      if (aKey && bKey) return aKey.localeCompare(bKey);
      return (a?.label || "").localeCompare(b?.label || "");
    });
  }, [metricsError, metricsLoading, normalizedReachSeries]);

  const reachRangeDays = useMemo(() => {
    if (sinceDate && untilDate) {
      return differenceInCalendarDays(endOfDay(untilDate), startOfDay(sinceDate)) + 1;
    }
    return profileReachData.length || 0;
  }, [sinceDate, untilDate, profileReachData.length]);

  const formatReachAxisTick = useCallback((value) => {
    if (!value) return "";
    const parsedDate = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsedDate.getTime())) return value;
    if (reachRangeDays > 31) return SHORT_MONTH_FORMATTER.format(parsedDate);
    return SHORT_DATE_FORMATTER.format(parsedDate);
  }, [reachRangeDays]);

  const formatReachTooltipLabel = useCallback((value) => {
    if (!value) return "Periodo";
    const parsedDate = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsedDate.getTime())) return value;
    return FULL_DATE_FORMATTER.format(parsedDate);
  }, []);

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
    const gainSeries = followerGainSeriesInRange.length
      ? followerGainSeriesInRange
      : followerGainSeriesNormalized;
    if (gainSeries.length) {
      let accumulatedGrowth = 0;
      let samples = 0;
      gainSeries.forEach((entry) => {
        const gainValue = Math.max(0, extractNumber(entry.value, 0));
        accumulatedGrowth += gainValue;
        samples += 1;
        const dayRef = new Date(`${entry.date}T00:00:00`);
        if (Number.isNaN(dayRef.getTime())) return;
        const weekday = dayRef.getDay();
        totalsByWeekday[weekday] += gainValue;
      });
      return {
        average: samples ? Math.round(accumulatedGrowth / samples) : 0,
        weeklyPattern: buildWeeklyPattern(totalsByWeekday),
      };
    }
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
  }, [
    followerGainSeriesInRange,
    followerGainSeriesNormalized,
    followerSeriesNormalized,
    followerGrowthMetric?.value,
  ]);

  const avgFollowersPerDay = followerGrowthStats.average;

  const postsCount = filteredPosts.length;

  useEffect(() => {
    if (!accountSnapshotKey || metricsLoading) return;
    const hasValue = Number.isFinite(totalFollowers)
      || Number.isFinite(reachValue)
      || Number.isFinite(avgFollowersPerDay)
      || Number.isFinite(postsCount)
      || Number.isFinite(totalInteractionsLikesComments);
    if (!hasValue) return;
    setOverviewSnapshot({
      accountId: accountSnapshotKey,
      followers: Number.isFinite(totalFollowers) ? totalFollowers : null,
      reach: Number.isFinite(reachValue) ? reachValue : null,
      followersDaily: Number.isFinite(avgFollowersPerDay) ? avgFollowersPerDay : null,
      posts: Number.isFinite(postsCount) ? postsCount : null,
      interactionsTotal: Number.isFinite(totalInteractionsLikesComments) ? totalInteractionsLikesComments : null,
    });
  }, [
    accountSnapshotKey,
    avgFollowersPerDay,
    metricsLoading,
    postsCount,
    reachValue,
    totalInteractionsLikesComments,
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
        interactionsTotal: null,
      };
    }

    return {
      followers: activeSnapshot?.followers ?? totalFollowers ?? null,
      reach: activeSnapshot?.reach ?? reachDisplayValue ?? null,
      followersDaily: activeSnapshot?.followersDaily
        ?? (Number.isFinite(avgFollowersPerDay) ? avgFollowersPerDay : null),
      followersDelta,
      posts: activeSnapshot?.posts ?? postsCount ?? null,
      interactionsTotal: activeSnapshot?.interactionsTotal
        ?? (Number.isFinite(totalInteractionsLikesComments) ? totalInteractionsLikesComments : null),
    };
  }, [
    activeSnapshot,
    avgFollowersPerDay,
    followersDelta,
    metricsLoading,
    postsCount,
    reachDisplayValue,
    totalInteractionsLikesComments,
    totalFollowers,
  ]);

  const followersGainedValue = useMemo(() => {
    const numeric = extractNumber(followersDelta, null);
    if (numeric == null) return null;
    return Math.max(0, numeric);
  }, [followersDelta]);
  const followersGrowthPct = useMemo(() => {
    if (metricsLoading) return null;
    const gained = followersGainedValue;
    if (gained == null) return null;
    const startCount = extractNumber(followerCounts?.start, null)
      ?? extractNumber(followerSeriesInRange[0]?.value, null)
      ?? extractNumber(followerSeriesNormalized[0]?.value, null);
    if (startCount == null || startCount <= 0) return null;
    const pct = (gained / startCount) * 100;
    if (!Number.isFinite(pct)) return null;
    return Math.round(pct * 10) / 10;
  }, [
    followersGainedValue,
    followerCounts,
    followerSeriesInRange,
    followerSeriesNormalized,
    metricsLoading,
  ]);

  const engagementRateDisplay = useMemo(() => (
    engagementRateValue != null
      ? `${engagementRateValue.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}%`
      : "--"
  ), [engagementRateValue]);

  const contentBreakdown = useMemo(() => {
    if (!contentPostsSource.length) return [];
    const totals = new Map(Object.keys(IG_CONTENT_LABEL).map((type) => [type, 0]));
    contentPostsSource.forEach((post) => {
      const kind = classifyMediaType(post);
      totals.set(kind, (totals.get(kind) || 0) + sumInteractions(post));
    });
    const totalInteractions = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
    return Array.from(totals.entries()).map(([type, value]) => ({
      name: IG_CONTENT_LABEL[type] || type,
      value,
      percentage: totalInteractions > 0 ? (value / totalInteractions) * 100 : 0,
    }));
  }, [contentPostsSource]);

  const viewsByContentType = useMemo(() => {
    const baseSeries = IG_VIEW_TYPE_ORDER.map((type) => ({
      key: type,
      name: IG_VIEW_TYPE_LABEL[type] || type,
      value: 0,
      raw: 0,
      fill: IG_VIEW_TYPE_COLORS[type] || "#6366f1",
    }));
    if (!contentPostsSource.length) return baseSeries;

    const totals = new Map(IG_VIEW_TYPE_ORDER.map((type) => [type, 0]));
    contentPostsSource.forEach((post) => {
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
      });
  }, [contentPostsSource]);

  const interactionsByContentType = useMemo(() => {
    const baseSeries = IG_INTERACTION_TYPE_ORDER.map((type) => ({
      key: type,
      name: IG_INTERACTION_TYPE_LABEL[type] || type,
      value: 0,
      raw: 0,
      fill: IG_INTERACTION_TYPE_COLORS[type] || "#6366f1",
    }));
    if (!interactionPostsSource.length) return baseSeries;

    const totals = new Map(IG_INTERACTION_TYPE_ORDER.map((type) => [type, 0]));
    interactionPostsSource.forEach((post) => {
      const bucket = classifyInteractionContentType(post);
      if (!totals.has(bucket)) return;
      totals.set(bucket, (totals.get(bucket) || 0) + resolvePostInteractions(post));
    });

    const totalInteractions = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
    if (!totalInteractions) return baseSeries;

    return IG_INTERACTION_TYPE_ORDER.map((type) => {
      const raw = totals.get(type) || 0;
      const percent = (raw / totalInteractions) * 100;
      return {
        key: type,
        name: IG_INTERACTION_TYPE_LABEL[type] || type,
        value: Math.round(percent * 10) / 10,
        raw,
        fill: IG_INTERACTION_TYPE_COLORS[type] || "#6366f1",
      };
    });
  }, [interactionPostsSource]);

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

  const bestTimes = useMemo(
    () => analyzeBestTimes(interactionPostsSource, audienceData?.active_hours ?? audienceData?.activeHours),
    [interactionPostsSource, audienceData],
  );

  const bestTimesCaption = useMemo(() => {
    if (bestTimes.source === "insights") {
      return "*Baseado no horÃ¡rio em que seus seguidores estÃ£o mais ativos (Insights).";
    }
    if (bestTimes.source === "posts") {
      return "*Baseado no engajamento das suas publicações recentes.";
    }
    return "*Sem dados suficientes para estimar o melhor horÃ¡rio.";
  }, [bestTimes.source]);

  const recentPostsById = useMemo(() => {
    const map = new Map();
    recentPosts.forEach((post) => {
      if (post?.id) {
        map.set(post.id, post);
      }
    });
    return map;
  }, [recentPosts]);

  const mergePostMetrics = useCallback((basePost, insightsPost) => {
    if (!insightsPost) return basePost;
    return {
      ...basePost,
      likes: insightsPost.likes ?? basePost.likes,
      comments: insightsPost.comments ?? basePost.comments,
      shares: insightsPost.shares ?? basePost.shares,
      saves: insightsPost.saves ?? basePost.saves,
      interactions: insightsPost.interactions ?? basePost.interactions,
      reach: insightsPost.reach ?? basePost.reach,
      views: insightsPost.views ?? basePost.views,
      insights: insightsPost.insights ?? basePost.insights,
    };
  }, []);

  const filteredPostsWithInsights = useMemo(
    () => filteredPosts.map((post) => mergePostMetrics(post, recentPostsById.get(post?.id))),
    [filteredPosts, mergePostMetrics, recentPostsById],
  );

  const topPosts = useMemo(() => (filteredPostsWithInsights.length
    ? [...filteredPostsWithInsights].sort((a, b) => sumInteractions(b) - sumInteractions(a)).slice(0, 6)
    : []), [filteredPostsWithInsights]);

  const topPostsByViews = useMemo(() => (
    recentPosts.length
      ? [...recentPosts].sort((a, b) => resolvePostViews(b) - resolvePostViews(a)).slice(0, 10)
      : []
  ), [recentPosts]);

  const followerGrowthSeriesSorted = useMemo(() => {
    if (metricsLoading) return [];
    if (!followerSeriesNormalized.length) return [];
    return [...followerSeriesNormalized]
      .filter((entry) => entry?.date && Number.isFinite(entry.value))
      .sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [followerSeriesNormalized, metricsLoading]);

  const followerGrowthChartData = useMemo(() => {
    if (metricsLoading) return [];
    if (metricsError) return [];
    const hasGainSeries = followerGainSeriesNormalized.length > 0;
    const seriesForRange = hasGainSeries ? followerGainSeriesNormalized : followerGrowthSeriesSorted;
    if (!seriesForRange.length) return [];

    const firstDateKey = seriesForRange[0]?.date;
    const lastDateKey = seriesForRange[seriesForRange.length - 1]?.date;
    if (!firstDateKey || !lastDateKey) return [];

    const rangeStart = sinceDate ? startOfDay(sinceDate) : new Date(`${firstDateKey}T00:00:00`);
    const rangeEnd = untilDate ? startOfDay(untilDate) : new Date(`${lastDateKey}T00:00:00`);

    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
      return [];
    }
    if (rangeStart > rangeEnd) {
      return [];
    }

    const startKey = rangeStart.toISOString().slice(0, 10);
    const endKey = rangeEnd.toISOString().slice(0, 10);
    const hasDataInRange = seriesForRange.some(
      (entry) => entry.date >= startKey && entry.date <= endKey,
    );
    if (!hasDataInRange) return [];

    if (hasGainSeries) {
      const gainsByDate = new Map();
      followerGainSeriesNormalized.forEach((entry) => {
        const numericValue = extractNumber(entry.value, 0);
        gainsByDate.set(entry.date, Math.max(0, numericValue));
      });

      return eachDayOfInterval({ start: rangeStart, end: rangeEnd }).map((day) => {
        const dateKey = day.toISOString().slice(0, 10);
        const monthLabel = MONTH_SHORT_PT[day.getMonth()] || "";
        const dayLabel = String(day.getDate());
        const label = monthLabel ? `${dayLabel}/${monthLabel}` : dayLabel;
        const tooltipDate = monthLabel
          ? `${String(day.getDate()).padStart(2, "0")} - ${monthLabel} - ${day.getFullYear()}`
          : dateKey;

        return {
          label,
          value: gainsByDate.get(dateKey) || 0,
          tooltipDate,
          dateKey,
        };
      });
    }

    const totalsByDate = new Map();
    followerGrowthSeriesSorted.forEach((entry) => {
      totalsByDate.set(entry.date, entry.value);
    });

    let lastKnownTotal = null;
    for (let index = followerGrowthSeriesSorted.length - 1; index >= 0; index -= 1) {
      const entry = followerGrowthSeriesSorted[index];
      if (entry.date < startKey) {
        lastKnownTotal = entry.value;
        break;
      }
    }

    return eachDayOfInterval({ start: rangeStart, end: rangeEnd }).map((day) => {
      const dateKey = day.toISOString().slice(0, 10);
      const monthLabel = MONTH_SHORT_PT[day.getMonth()] || "";
      const dayLabel = String(day.getDate());
      const label = monthLabel ? `${dayLabel}/${monthLabel}` : dayLabel;
      const tooltipDate = monthLabel
        ? `${String(day.getDate()).padStart(2, "0")} - ${monthLabel} - ${day.getFullYear()}`
        : dateKey;

      const currentTotal = totalsByDate.get(dateKey);
      let growthValue = 0;
      if (currentTotal != null && lastKnownTotal != null) {
        const diff = currentTotal - lastKnownTotal;
        growthValue = Number.isFinite(diff) ? Math.max(0, diff) : 0;
      }
      if (currentTotal != null) {
        lastKnownTotal = currentTotal;
      }

      return {
        label,
        value: growthValue,
        tooltipDate,
        dateKey,
      };
    });
  }, [
    followerGainSeriesNormalized,
    followerGrowthSeriesSorted,
    metricsError,
    metricsLoading,
    sinceDate,
    untilDate,
  ]);

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
    const followersFromVisitors = extractNumber(profileVisitorsTotals?.followers, null);
    const nonFollowersFromVisitors = extractNumber(profileVisitorsTotals?.nonFollowers, null);
    const otherFromVisitors = extractNumber(profileVisitorsTotals?.other, null);
    const totalFromVisitors = extractNumber(profileVisitorsTotals?.total, null);
    const followersValue = followersFromVisitors ?? 0;
    const nonFollowerValue = (nonFollowersFromVisitors ?? 0) + (otherFromVisitors ?? 0);
    const totalVisitors = totalFromVisitors ?? (followersValue + nonFollowerValue);

    if (totalVisitors > 0 && (followersValue > 0 || nonFollowerValue > 0)) {
      const followerPct = (followersValue / totalVisitors) * 100;
      const nonFollowerPct = 100 - followerPct;
      return [
        { name: "Não Seguidores", value: Math.round(nonFollowerPct * 10) / 10 },
        { name: "Seguidores", value: Math.round(followerPct * 10) / 10 },
      ];
    }

    // Tenta calcular a partir dos dados reais de alcance
    const reachValue = extractNumber(reachMetric?.value, 0);
    const followersValueMetric = extractNumber(followersMetric?.value, 0);

    if (reachValue > 0 && followersValueMetric > 0) {
      // Estima percentual de não seguidores baseado no alcance vs seguidores
      const nonFollowerReachEstimate = Math.max(0, reachValue - followersValueMetric);
      const totalReach = reachValue;

      const nonFollowerPct = totalReach > 0 ? (nonFollowerReachEstimate / totalReach) * 100 : 35;
      const followerPct = 100 - nonFollowerPct;

      return [
        { name: "Não Seguidores", value: Math.round(nonFollowerPct * 10) / 10 },
        { name: "Seguidores", value: Math.round(followerPct * 10) / 10 },
      ];
    }

    return DEFAULT_AUDIENCE_TYPE;
  }, [profileVisitorsTotals, reachMetric, followersMetric]);

  const audienceGenderSeries = useMemo(() => {
    const entries = Array.isArray(audienceData?.gender) ? audienceData.gender : [];
    if (!entries.length) return [];
    const total = entries.reduce((sum, entry) => sum + extractNumber(entry.value, 0), 0);
    return entries
      .map((entry) => {
        const label = entry.label || entry.key || "Outro";
        const raw = extractNumber(entry.value, 0);
        const percent = extractNumber(entry.percentage, null);
        const resolvedPercent = percent != null
          ? percent
          : total > 0
            ? (raw / total) * 100
            : 0;
        const normalizedLabel = String(label).toLowerCase();
        const color = normalizedLabel.startsWith("f")
          ? "#ec4899"
          : normalizedLabel.startsWith("m")
            ? "#6366f1"
            : "#8b5cf6";
        return {
          name: label,
          value: Math.round(resolvedPercent * 10) / 10,
          raw,
          color,
        };
      })
      .filter((entry) => entry.value > 0);
  }, [audienceData]);

  const audienceAgeSeries = useMemo(() => {
    const entries = Array.isArray(audienceData?.ages) ? audienceData.ages : [];
    if (!entries.length) return [];
    const total = entries.reduce((sum, entry) => sum + extractNumber(entry.value, 0), 0);
    return entries
      .map((entry) => {
        const label = entry.range || entry.label || entry.name;
        const raw = extractNumber(entry.value, 0);
        const percent = extractNumber(entry.percentage, null);
        const resolvedPercent = percent != null
          ? percent
          : total > 0
            ? (raw / total) * 100
            : 0;
        return {
          name: label,
          value: Math.round(resolvedPercent * 10) / 10,
          raw,
        };
      })
      .filter((entry) => entry.name && entry.value > 0);
  }, [audienceData]);

  const audienceCities = useMemo(() => {
    const entries = Array.isArray(audienceData?.cities) ? audienceData.cities : [];
    if (!entries.length) return [];
    return entries
      .map((entry) => ({
        name: entry.name || entry.city || entry.label || "",
        value: extractNumber(entry.value, 0),
        percentage: extractNumber(entry.percentage, null),
      }))
      .filter((entry) => entry.name);
  }, [audienceData]);

  const audienceCitiesTotal = useMemo(() => {
    const totalFromPayload = extractNumber(audienceData?.totals?.cities, null);
    if (totalFromPayload != null) return totalFromPayload;
    return audienceCities.reduce((sum, entry) => sum + extractNumber(entry.value, 0), 0);
  }, [audienceCities, audienceData]);

  const audienceTopCity = useMemo(() => {
    if (!audienceCities.length) return null;
    const top = audienceCities[0];
    const nameValue = String(top.name || "");
    const parts = nameValue.split(",").map((part) => part.trim()).filter(Boolean);
    const cityName = parts[0] || nameValue;
    return {
      ...top,
      cityName,
    };
  }, [audienceCities]);

  const audienceTopCityRows = useMemo(() => (
    audienceCities.slice(0, 4).map((city) => {
      const nameValue = String(city.name || "");
      const parts = nameValue.split(",").map((part) => part.trim()).filter(Boolean);
      const cityName = parts[0] || nameValue;
      return {
        ...city,
        cityName,
      };
    })
  ), [audienceCities]);

  const audienceGenderTotalPct = useMemo(() => (
    audienceGenderSeries.reduce((sum, entry) => sum + extractNumber(entry.value, 0), 0)
  ), [audienceGenderSeries]);

  const audienceStatusState = audienceLoading ? "loading" : audienceError ? "error" : "empty";
  const audienceStatusMessage = audienceLoading ? "Carregando dados..." : (audienceError || "Sem dados");

  // const heatmapData = useMemo(() => DEFAULT_HEATMAP_MATRIX, []);

  // const maxHeatmapValue = useMemo(() => (
  //   heatmapData.reduce((acc, row) => {
  //     const rowMax = Math.max(...row.values);
  //     return rowMax > acc ? rowMax : acc;
  //   }, 0)
  // ), [heatmapData]);

  const keywordList = useMemo(() => buildKeywordFrequency(filteredPosts), [filteredPosts]);
  const hashtagList = useMemo(() => buildHashtagFrequency(filteredPosts), [filteredPosts]);

  // WordCloud detail panel functions
  const WORDCLOUD_DETAILS_PAGE_SIZE = 10;

  const buildWordCloudDetailsUrl = useCallback((word, offset = 0) => {
    if (!accountConfig?.instagramUserId || !word) return null;
    const params = new URLSearchParams({
      igUserId: accountConfig.instagramUserId,
      word,
      limit: String(WORDCLOUD_DETAILS_PAGE_SIZE),
      offset: String(offset),
    });
    if (sinceIso) params.set("since", sinceIso);
    if (untilIso) params.set("until", untilIso);
    return `${API_BASE_URL}/api/instagram/comments/search?${params.toString()}`;
  }, [accountConfig?.instagramUserId, sinceIso, untilIso]);

  const fetchWordCloudDetails = useCallback(async (word, offset = 0) => {
    const url = buildWordCloudDetailsUrl(word, offset);
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Falha ao carregar comentários.");
    }
    return response.json();
  }, [buildWordCloudDetailsUrl]);

  const handleWordCloudWordClick = useCallback((word, count) => {
    // Close other panels
    setShowDetailedView(false);
    setShowFollowersDetail(false);
    setShowInteractionsDetail(false);
    setShowPostsDetail(false);
    setShowCitiesDetail(false);

    // Set wordcloud panel state
    setSelectedWordCloud({ word, count });
    setShowWordCloudDetail(true);
    setWordCloudDetails(null);
    setWordCloudDetailsError("");
    setWordCloudDetailsLoading(true);
    setWordCloudDetailsLoadingMore(false);
    setWordCloudDetailsPage(1);

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Fetch details
    fetchWordCloudDetails(word, 0)
      .then((payload) => {
        setWordCloudDetails(payload);
        setWordCloudDetailsPage(1);
      })
      .catch((err) => {
        setWordCloudDetailsError(err?.message || "Falha ao carregar comentários.");
      })
      .finally(() => {
        setWordCloudDetailsLoading(false);
      });
  }, [fetchWordCloudDetails]);

  const wordCloudDetailsTotalPages = useMemo(() => {
    if (!wordCloudDetails) return 0;
    const total = Number(wordCloudDetails.total_comments || 0);
    return Math.ceil(total / WORDCLOUD_DETAILS_PAGE_SIZE);
  }, [wordCloudDetails]);


  const closeWordCloudDetail = useCallback(() => {
    setShowWordCloudDetail(false);
    setSelectedWordCloud(null);
    setWordCloudDetails(null);
    setWordCloudDetailsError("");
    setWordCloudDetailsLoading(false);
    setWordCloudDetailsLoadingMore(false);
    setWordCloudDetailsPage(1);
  }, []);

  const handleShowCitiesDetail = useCallback(() => {
    // Close other panels
    setShowDetailedView(false);
    setShowFollowersDetail(false);
    setShowInteractionsDetail(false);
    setShowPostsDetail(false);
    setShowWordCloudDetail(false);
    setSelectedWordCloud(null);
    // Open cities panel
    setShowCitiesDetail(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const wordCloudCanGoPrev = wordCloudDetailsPage > 1;
  const wordCloudCanGoNext = wordCloudDetailsPage < wordCloudDetailsTotalPages;

  const wordCloudPageNumbers = useMemo(() => {
    const pages = [];
    const maxVisible = 5;
    const total = wordCloudDetailsTotalPages;
    const current = wordCloudDetailsPage;

    if (total <= maxVisible) {
      for (let i = 1; i <= total; i++) pages.push(i);
      return pages;
    }

    if (current <= 3) {
      for (let i = 1; i <= Math.min(maxVisible, total); i++) pages.push(i);
      pages.push("...");
      pages.push(total);
      return pages;
    }

    if (current >= total - 2) {
      pages.push(1);
      pages.push("...");
      for (let i = total - maxVisible + 1; i <= total; i++) {
        if (i > 1) pages.push(i);
      }
      return pages;
    }

    pages.push(1);
    pages.push("...");
    for (let i = current - 1; i <= current + 1; i++) {
      pages.push(i);
    }
    pages.push("...");
    pages.push(total);
    return pages;
  }, [wordCloudDetailsPage, wordCloudDetailsTotalPages]);

  const handleWordCloudGoToPage = useCallback(async (page) => {
    if (!selectedWordCloud?.word || wordCloudDetailsLoadingMore) return;
    if (!wordCloudDetailsTotalPages) return;
    const target = Math.min(Math.max(1, page), wordCloudDetailsTotalPages);
    if (target === wordCloudDetailsPage) return;
    setWordCloudDetailsLoadingMore(true);
    try {
      const offset = (target - 1) * WORDCLOUD_DETAILS_PAGE_SIZE;
      const payload = await fetchWordCloudDetails(selectedWordCloud.word, offset);
      setWordCloudDetails(payload);
      setWordCloudDetailsPage(target);
      setWordCloudDetailsError("");
    } catch (err) {
      setWordCloudDetailsError(err?.message || "Falha ao carregar comentários.");
    } finally {
      setWordCloudDetailsLoadingMore(false);
    }
  }, [selectedWordCloud?.word, wordCloudDetailsLoadingMore, wordCloudDetailsTotalPages, wordCloudDetailsPage, fetchWordCloudDetails]);

  const handleWordCloudNextPage = useCallback(() => {
    if (!wordCloudCanGoNext || wordCloudDetailsLoadingMore) return;
    handleWordCloudGoToPage(wordCloudDetailsPage + 1);
  }, [wordCloudCanGoNext, wordCloudDetailsLoadingMore, handleWordCloudGoToPage, wordCloudDetailsPage]);

  const handleWordCloudPrevPage = useCallback(() => {
    if (!wordCloudCanGoPrev || wordCloudDetailsLoadingMore) return;
    handleWordCloudGoToPage(wordCloudDetailsPage - 1);
  }, [wordCloudCanGoPrev, wordCloudDetailsLoadingMore, handleWordCloudGoToPage, wordCloudDetailsPage]);

  const formatWordCloudDetailDate = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  };

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

  // Variáveis para visualização detalhada de Seguidores (usadas no painel direito)
  const followersGainedDisplay = followersGainedValue != null
    ? `+${formatNumber(followersGainedValue)}`
    : "--";
  const followersGrowthPctDisplay = followersGrowthPct != null
    ? `${followersGrowthPct > 0 ? "+" : ""}${followersGrowthPct.toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}%`
    : "--";
  const floatingNotices = useMemo(
    () => [metricsNotice, postsNotice].filter(Boolean),
    [metricsNotice, postsNotice],
  );

  return (
    <div className="instagram-dashboard instagram-dashboard--clean">
      {metricsError && <div className="alert alert--error">{metricsError}</div>}
      {postsError && <div className="alert alert--error">{postsError}</div>}
      {floatingNotices.length > 0 && (
        <div className="ig-floating-notice" role="status" aria-live="polite">
          {floatingNotices.map((notice, index) => (
            <div key={`ig-floating-notice-${index}`} className="ig-floating-notice__item">
              <span className="ig-floating-notice__dot" aria-hidden="true" />
              <span>{notice}</span>
            </div>
          ))}
        </div>
      )}

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

        <div className="ig-clean-title-row">
          <h2 className="ig-clean-title">Visão geral</h2>
          <DateRangeIndicator />
        </div>

        {/* Grid Principal */}
          <div className="ig-clean-grid" style={(showDetailedView || showFollowersDetail || showInteractionsDetail || showPostsDetail || showWordCloudDetail || showCitiesDetail) ? { display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '24px' } : {}}>
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
                    <DataState state="loading" label="Carregando capa..." size="sm" className="data-state--overlay" />
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
                    {!metricsLoading && reachDeltaDisplay && reachDeltaDirection && (
                      <div className={`ig-overview-stat__trend ig-overview-stat__trend--${reachDeltaDirection}`}>
                        {reachDeltaDirection === "down" ? (
                          <TrendingDown size={12} aria-hidden="true" />
                        ) : reachDeltaDirection === "up" ? (
                          <TrendingUp size={12} aria-hidden="true" />
                        ) : (
                          <span className="ig-overview-stat__trend-flat" aria-hidden="true">-</span>
                        )}
                        <span>{reachDeltaDisplay}</span>
                      </div>
                    )}
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
                    {!metricsLoading && interactionsDeltaDisplay && interactionsDeltaDirection && (
                      <div className={`ig-overview-stat__trend ig-overview-stat__trend--${interactionsDeltaDirection}`}>
                        {interactionsDeltaDirection === "down" ? (
                          <TrendingDown size={12} aria-hidden="true" />
                        ) : interactionsDeltaDirection === "up" ? (
                          <TrendingUp size={12} aria-hidden="true" />
                        ) : (
                          <span className="ig-overview-stat__trend-flat" aria-hidden="true">-</span>
                        )}
                        <span>{interactionsDeltaDisplay}</span>
                      </div>
                    )}
                    <div className="ig-overview-stat__value">
                      {metricsLoading ? (
                        <span className="ig-skeleton ig-skeleton--stat" aria-hidden="true" />
                      ) : (
                        formatNumber(overviewMetrics.interactionsTotal ?? null)
                      )}
                    </div>
                    <div className="ig-overview-stat__label">Interações totais</div>
                  </div>
                </div>

                <div className="ig-profile-vertical__divider" />

                <div className="ig-profile-vertical__engagement">
                  <h4>Engajamento por conteúdo</h4>
                  {metricsLoading || loadingPosts ? (
                    <DataState state="loading" label="Carregando engajamento..." size="sm" />
                  ) : (postsError || metricsError) ? (
                    <DataState state="error" label="Falha ao carregar engajamento." size="sm" />
                  ) : contentBreakdown.length ? (
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
                            <Tooltip
                              content={(
                                <CustomChartTooltip
                                  variant="pie"
                                  valueFormatter={formatTooltipNumber}
                                  showPercent={false}
                                />
                              )}
                            />
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
                            <span className="ig-engagement-legend__label">
                              {`${slice.name}: ${formatPercent(slice.percentage || 0)}`}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="ig-engagement-summary">
                        <div className="ig-engagement-summary__value">{engagementRateDisplay}</div>
                        <div className="ig-engagement-summary__label">Taxa de engajamento</div>
                      </div>

                      <div className="ig-engagement-mini-grid" style={{ display: 'flex', gap: '12px' }}>
                        <div className="ig-engagement-mini-card ig-engagement-mini-card--teal" style={{ flex: 1 }}>
                          <span className="ig-engagement-mini-card__label">Melhor horário para postar</span>
                          <span className="ig-engagement-mini-card__value" style={{ whiteSpace: 'nowrap' }}>{bestTimes.bestTimeRange || "--"}</span>
                        </div>
                        <div className="ig-engagement-mini-card ig-engagement-mini-card--pink" style={{ flex: 1 }}>
                          <span className="ig-engagement-mini-card__label">Melhor dia</span>
                          <span className="ig-engagement-mini-card__value" style={{ whiteSpace: 'nowrap' }}>{bestTimes.bestDay || "--"}</span>
                        </div>
                      </div>
                      <p className="ig-best-time-caption">{bestTimesCaption}</p>
                    </>
                  ) : (
                    <DataState state="empty" label="Sem dados de engajamento." size="sm" />
                  )}
                </div>

                {/* Posts em Destaque */}
                <div className="ig-profile-vertical__divider" />
                <div className="ig-profile-vertical__top-posts">
                  <h4>Melhores posts</h4>
                  <div className="ig-top-posts-list">
                    {loadingPosts && !topPosts.length ? (
                      <DataState state="loading" label="Carregando posts..." size="sm" />
                    ) : postsError && !topPosts.length ? (
                      <DataState state="error" label="Falha ao carregar posts." size="sm" />
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
                          setSelectedPost(post);
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
                      <DataState state="empty" label="Nenhum post disponivel." size="sm" />
                    )}
                  </div>

                  {/* Botão Ver mais centralizado no final */}
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
                    <button
                      onClick={() => {
                        closeWordCloudDetail();
                        setShowPostsDetail(true);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      style={{
                        padding: '10px 24px',
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
                </div>
              </div>
            </section>

            {/* Hashtags mais usadas - Coluna Esquerda */}
            <section className="ig-card-white" style={{ marginTop: '20px' }}>
              <div className="ig-analytics-card__header" style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#111827', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  Hashtags mais usadas
                  <InfoTooltip text="Hashtags que aparecem com maior frequência nas publicações." />
                </h4>
              </div>
              <div style={{ padding: '16px' }}>
                {hashtagList.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={hashtagList.slice(0, 8)} layout="vertical" margin={{ left: 8, right: 8, top: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fill: '#6b7280', fontSize: 11 }}
                        allowDecimals={false}
                        tickFormatter={(value) => formatCompactNumber(value)}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fill: '#374151', fontSize: 12 }}
                        width={90}
                        tickFormatter={(value) => value.length > 12 ? value.substring(0, 12) + '...' : value}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(236, 72, 153, 0.1)' }}
                        content={(
                          <CustomChartTooltip
                            labelFormatter={(value) => String(value || "")}
                            labelMap={{ value: "Ocorrências" }}
                            valueFormatter={(v) => `: ${formatTooltipNumber(v)}`}
                          />
                        )}
                      />
                      <Bar dataKey="value" fill="#ec4899" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '200px',
                    color: '#9ca3af',
                    fontSize: '14px'
                  }}>
                    Sem hashtags registradas no período.
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="ig-clean-grid__right">
            {/* DESATIVADO TEMPORARIAMENTE — Crescimento de Seguidores detail */}
            {false && showFollowersDetail ? (
              /* Conteúdo detalhado de Crescimento de Seguidores */
              <div className="ig-followers-detail-panel">
                {/* Header com botão voltar */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '24px',
                  padding: '16px 20px',
                  background: 'linear-gradient(135deg, #c084fc 0%, #a855f7 100%)',
                  borderRadius: '16px',
                  color: 'white'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      onClick={() => setShowFollowersDetail(false)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        background: 'rgba(255, 255, 255, 0.2)',
                        border: 'none',
                        color: 'white',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Crescimento de seguidores</h3>
                      <p style={{ margin: 0, fontSize: '13px', opacity: 0.9 }}>Análise detalhada</p>
                    </div>
                  </div>
                </div>

                {/* KPIs */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '16px',
                  marginBottom: '24px'
                }}>
                  <div className="ig-card-white" style={{ padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827' }}>
                      {formatNumber(totalFollowers ?? 0)}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Total de Seguidores</div>
                  </div>
                  <div className="ig-card-white" style={{ padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#10b981' }}>
                      {followersGainedDisplay}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Novos Seguidores</div>
                  </div>
                  <div className="ig-card-white" style={{ padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#a855f7' }}>
                      {followersGrowthPctDisplay}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Crescimento</div>
                  </div>
                </div>

                {/* Gráfico de Crescimento */}
                <section className="ig-card-white" style={{ marginBottom: '24px' }}>
                  <div style={{ padding: '20px', borderBottom: '1px solid #e5e7eb' }}>
                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#111827' }}>
                      Crescimento ao longo do período
                    </h4>
                  </div>
                  <div style={{ padding: '20px', height: 320 }}>
                    {followerGrowthChartData.length ? (
                      <ResponsiveContainer>
                        <AreaChart
                          data={followerGrowthChartData}
                          margin={{ top: 16, right: 16, bottom: 32, left: 0 }}
                        >
                          <defs>
                            <linearGradient id="followerDetailLinePanel" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#c084fc" stopOpacity={0.4} />
                              <stop offset="100%" stopColor="#c084fc" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 11, fill: '#6b7280' }}
                            axisLine={{ stroke: '#e5e7eb' }}
                            tickLine={false}
                            interval="preserveStartEnd"
                            minTickGap={50}
                            tickFormatter={formatAxisDate}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: '#6b7280' }}
                            axisLine={{ stroke: '#e5e7eb' }}
                            tickLine={false}
                            tickFormatter={(value) => formatCompactNumber(value)}
                          />
                          <Tooltip
                            cursor={{ stroke: '#c084fc', strokeWidth: 1, strokeDasharray: '4 4' }}
                            content={(props) => {
                              const tooltipDate = props?.payload?.[0]?.payload?.tooltipDate || props?.label;
                              return (
                                <CustomChartTooltip
                                  {...props}
                                  labelFormatter={() => String(tooltipDate || "")}
                                  labelMap={{ value: "Seguidores ganhos" }}
                                  valueFormatter={(v) => `: ${formatTooltipNumber(v)}`}
                                />
                              );
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="value"
                            stroke="#a855f7"
                            strokeWidth={2.5}
                            fill="url(#followerDetailLinePanel)"
                            dot={false}
                            activeDot={{ r: 5, fill: '#a855f7', stroke: '#fff', strokeWidth: 2 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="ig-empty-state">Sem dados disponíveis.</div>
                    )}
                  </div>
                </section>

                {/* Grid com Gênero e Faixa Etária */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '24px' }}>
                  {/* Gênero */}
                  <section className="ig-card-white">
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
                      <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#111827' }}>
                        Gênero dos seguidores
                      </h4>
                    </div>
                    <div style={{ padding: '20px', height: 220 }}>
                      {audienceGenderSeries.length ? (
                        <ResponsiveContainer>
                          <PieChart>
                            <Pie
                              data={audienceGenderSeries}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={50}
                              outerRadius={80}
                              paddingAngle={2}
                              stroke="none"
                            >
                              {audienceGenderSeries.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              content={(
                                <CustomChartTooltip
                                  variant="pie"
                                  unit="%"
                                  valueFormatter={formatPercent}
                                  showPercent={false}
                                />
                              )}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <DataState state={audienceStatusState} label={audienceStatusMessage} size="sm" />
                      )}
                    </div>
                  </section>

                  {/* Faixa Etária */}
                  <section className="ig-card-white">
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
                      <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#111827' }}>
                        Faixa etária
                      </h4>
                    </div>
                    <div style={{ padding: '20px', height: 220 }}>
                      {audienceAgeSeries.length ? (
                        <ResponsiveContainer>
                          <BarChart
                            data={audienceAgeSeries}
                            layout="vertical"
                            margin={{ left: 0, right: 16, top: 8, bottom: 8 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                            <XAxis
                              type="number"
                              tick={{ fontSize: 10, fill: '#6b7280' }}
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(value) => `${value}%`}
                            />
                            <YAxis
                              type="category"
                              dataKey="name"
                              tick={{ fontSize: 11, fill: '#111827' }}
                              axisLine={false}
                              tickLine={false}
                              width={50}
                            />
                            <Tooltip
                              content={(
                                <CustomChartTooltip
                                  labelFormatter={(value) => String(value || "")}
                                  labelMap={{ value: "Percentual" }}
                                  unit="%"
                                  valueFormatter={(v) => `: ${formatPercent(v)}`}
                                  showPercent={false}
                                />
                              )}
                            />
                            <Bar dataKey="value" fill="#6366f1" radius={[0, 6, 6, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <DataState state={audienceStatusState} label={audienceStatusMessage} size="sm" />
                      )}
                    </div>
                  </section>
                </div>

                {/* Principais Cidades */}
                <section className="ig-card-white">
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#111827' }}>
                      Principais cidades
                    </h4>
                  </div>
                  <div style={{ padding: '16px', maxHeight: '300px', overflowY: 'auto' }}>
                    {audienceCities.length ? (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                            <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: '11px', fontWeight: 600, color: '#6b7280' }}>Cidade</th>
                            <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: '11px', fontWeight: 600, color: '#6b7280' }}>Seguidores</th>
                            <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: '11px', fontWeight: 600, color: '#6b7280' }}>%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {audienceCities.slice(0, 8).map((city, index) => {
                            const nameValue = String(city.name || "");
                            const parts = nameValue.split(",").map((part) => part.trim()).filter(Boolean);
                            const cityName = parts[0] || nameValue;
                            const percentageValue = city.percentage != null
                              ? city.percentage
                              : audienceCitiesTotal > 0
                                ? (city.value / audienceCitiesTotal) * 100
                                : null;
                            const percentageDisplay = percentageValue != null ? formatPercent(percentageValue) : "--";
                            return (
                              <tr key={city.name || index} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                <td style={{ padding: '10px 12px', fontSize: '13px', color: '#111827' }}>{cityName}</td>
                                <td style={{ padding: '10px 12px', fontSize: '13px', color: '#111827', textAlign: 'right', fontWeight: 500 }}>
                                  {formatNumber(city.value)}
                                </td>
                                <td style={{ padding: '10px 12px', fontSize: '13px', textAlign: 'right' }}>
                                  <span style={{
                                    display: 'inline-block',
                                    padding: '2px 8px',
                                    borderRadius: '10px',
                                    background: 'rgba(16, 185, 129, 0.1)',
                                    color: '#10b981',
                                    fontWeight: 600,
                                    fontSize: '12px'
                                  }}>
                                    {percentageDisplay}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <DataState state={audienceStatusState} label={audienceStatusMessage} size="sm" />
                    )}
                  </div>
                </section>
              </div>
            ) : showDetailedView ? (
              /* Conteúdo detalhado de Visualizações */
              <div className="ig-views-detail-panel">
                {/* Header com botão voltar */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '24px',
                  padding: '16px 20px',
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  borderRadius: '16px',
                  color: 'white'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      onClick={() => setShowDetailedView(false)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        background: 'rgba(255, 255, 255, 0.2)',
                        border: 'none',
                        color: 'white',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Visualizações</h3>
                      <p style={{ margin: 0, fontSize: '13px', opacity: 0.9 }}>Análise detalhada</p>
                    </div>
                  </div>
                </div>

                {/* KPIs */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '16px',
                  marginBottom: '24px'
                }}>
                  <div className="ig-card-white" style={{ padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#6366f1' }}>
                      {formatNumber(profileViewsTotal ?? 0)}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Total no período</div>
                  </div>
                  <div className="ig-card-white" style={{ padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#8b5cf6' }}>
                      {profileViewsAverage != null ? formatNumber(Math.round(profileViewsAverage)) : '--'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Média diária</div>
                  </div>
                  <div className="ig-card-white" style={{ padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#a855f7' }}>
                      {profileViewsPeak != null ? formatNumber(profileViewsPeak) : '--'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Pico diário</div>
                  </div>
                  <div className="ig-card-white" style={{ padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#0ea5e9' }}>
                      {videoAvgWatchTimeDisplay}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Tempo médio assistido</div>
                  </div>
                </div>

                {/* Gráfico de Tendência */}
                <section className="ig-card-white" style={{ marginBottom: '24px' }}>
                  <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h4 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                      Tendência de visualizações
                    </h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        width: '12px',
                        height: '12px',
                        borderRadius: '3px',
                        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                      }} />
                      <span style={{ fontSize: '13px', color: '#6b7280', fontWeight: 500 }}>Visualizações</span>
                    </div>
                  </div>
                  <div style={{ padding: '20px', height: 320 }}>
                    {profileViewsChartData.length ? (
                      <ResponsiveContainer>
                        <AreaChart
                          data={profileViewsChartData}
                          margin={{ top: 16, right: 16, bottom: 32, left: 0 }}
                        >
                          <defs>
                            <linearGradient id="viewsDetailPanelGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                              <stop offset="100%" stopColor="#6366f1" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 11, fill: '#6b7280' }}
                            axisLine={{ stroke: '#e5e7eb' }}
                            tickLine={false}
                            interval="preserveStartEnd"
                            minTickGap={50}
                            tickFormatter={formatAxisDate}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: '#6b7280' }}
                            axisLine={{ stroke: '#e5e7eb' }}
                            tickLine={false}
                            tickFormatter={(value) => formatCompactNumber(value)}
                          />
                          <Tooltip
                            cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }}
                            content={(props) => {
                              const tooltipDate = props?.payload?.[0]?.payload?.tooltipDate || props?.label;
                              return (
                                <CustomChartTooltip
                                  {...props}
                                  labelFormatter={() => String(tooltipDate || "")}
                                  labelMap={{ value: "Visualizações" }}
                                  valueFormatter={(v) => `: ${formatTooltipNumber(v)}`}
                                />
                              );
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="value"
                            stroke="#6366f1"
                            strokeWidth={2.5}
                            fill="url(#viewsDetailPanelGradient)"
                            dot={false}
                            connectNulls
                            activeDot={{ r: 5, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="ig-empty-state">Sem dados disponíveis.</div>
                    )}
                  </div>
                </section>

                {/* Por tipo de conteúdo */}
                <section className="ig-card-white" style={{ marginBottom: '24px' }}>
                  <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb' }}>
                    <h4 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                      Por tipo de conteúdo
                    </h4>
                  </div>
                  <div style={{ padding: '20px 24px' }}>
                    {viewsByContentType.some((item) => item.raw > 0) ? (
                      viewsByContentType.map((item) => (
                        <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                          <span style={{ width: '70px', fontSize: '14px', fontWeight: 600, color: '#374151', flexShrink: 0 }}>
                            {item.name}
                          </span>
                          <div style={{ flex: 1, height: '10px', borderRadius: '6px', background: '#e5e7eb', overflow: 'hidden', position: 'relative' }}>
                            <div style={{
                              width: `${item.value}%`,
                              height: '100%',
                              borderRadius: '6px',
                              background: `linear-gradient(90deg, ${item.fill}99 0%, ${item.fill} 100%)`,
                              transition: 'width 0.5s ease'
                            }} />
                          </div>
                          <span style={{ width: '52px', textAlign: 'right', fontSize: '14px', fontWeight: 600, color: '#6b7280', flexShrink: 0 }}>
                            {item.value.toFixed(1)}%
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="ig-empty-state">Sem dados disponíveis.</div>
                    )}
                  </div>
                </section>

                {/* Top Posts por Visualizações */}
                <section className="ig-card-white">
                  <div style={{ padding: '20px', borderBottom: '1px solid #e5e7eb' }}>
                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#111827' }}>
                      Posts mais visualizados
                    </h4>
                  </div>
                  <div style={{ padding: '16px' }}>
                    {(topPostsByViews || []).length > 0 ? (
                      <div style={{ display: 'flex', gap: '14px', overflowX: 'auto', paddingBottom: '8px' }}>
                        {(topPostsByViews || []).slice(0, 5).map((post, idx) => {
                          const previewUrl = [
                            post.previewUrl,
                            post.preview_url,
                            post.thumbnailUrl,
                            post.thumbnail_url,
                            post.mediaUrl,
                            post.media_url,
                            post.thumbnail,
                          ].find((url) => url && !/\.(mp4|mov)$/i.test(url));
                          const views = resolvePostViews(post);
                          return (
                            <div
                              key={post.id || idx}
                              style={{
                                flexShrink: 0,
                                width: '132px',
                                borderRadius: '12px',
                                overflow: 'hidden',
                                background: 'white',
                                border: '1px solid #e5e7eb',
                                cursor: 'pointer',
                                transition: 'transform 0.2s'
                              }}
                              onClick={() => setSelectedPost(post)}
                            >
                              <div style={{ width: '132px', height: '236px', background: '#f3f4f6', position: 'relative' }}>
                                {previewUrl ? (
                                  <img src={previewUrl} alt="Post" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
                                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                                  background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
                                  padding: '24px 10px 10px',
                                  color: 'white'
                                }}>
                                  <div style={{ fontSize: '15px', fontWeight: 700 }}>{formatNumber(views)}</div>
                                  <div style={{ fontSize: '11px', opacity: 0.9 }}>visualizações</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="ig-empty-state">Sem posts disponíveis.</div>
                    )}
                  </div>
                </section>
              </div>
            ) : showInteractionsDetail ? (
              /* Conteúdo detalhado de Interações */
              <div className="ig-interactions-detail-panel">
                {/* Header com botão voltar */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '24px',
                  padding: '16px 20px',
                  background: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
                  borderRadius: '16px',
                  color: 'white'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      onClick={() => setShowInteractionsDetail(false)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        background: 'rgba(255, 255, 255, 0.2)',
                        border: 'none',
                        color: 'white',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Interações</h3>
                      <p style={{ margin: 0, fontSize: '13px', opacity: 0.9 }}>Análise detalhada</p>
                    </div>
                  </div>
                </div>

                {/* KPIs */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '16px',
                  marginBottom: '24px'
                }}>
                  <div className="ig-card-white" style={{ padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#ec4899' }}>
                      {formatNumber(interactionsBreakdown.total)}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Total de Interações</div>
                  </div>
                  <div className="ig-card-white" style={{ padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#f472b6' }}>
                      {interactionsBreakdown.total > 0 && profileReachTotal > 0
                        ? `${((interactionsBreakdown.total / profileReachTotal) * 100).toFixed(2)}%`
                        : '--'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Taxa de Engajamento</div>
                  </div>
                </div>

                {/* Breakdown de Interações */}
                <section className="ig-card-white" style={{ marginBottom: '24px' }}>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#111827' }}>
                      Detalhamento por tipo
                    </h4>
                  </div>
                  <div style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                      <div style={{ padding: '12px', background: '#fef2f2', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Heart size={18} color="#ef4444" />
                        </div>
                        <div>
                          <div style={{ fontSize: '20px', fontWeight: 700, color: '#ef4444', lineHeight: 1.2 }}>
                            {formatNumber(interactionsBreakdown.likes)}
                          </div>
                          <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>Curtidas</div>
                        </div>
                      </div>
                      <div style={{ padding: '12px', background: '#eff6ff', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <MessageCircle size={18} color="#3b82f6" />
                        </div>
                        <div>
                          <div style={{ fontSize: '20px', fontWeight: 700, color: '#3b82f6', lineHeight: 1.2 }}>
                            {formatNumber(interactionsBreakdown.comments)}
                          </div>
                          <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>Comentários</div>
                        </div>
                      </div>
                      <div style={{ padding: '12px', background: '#f0fdf4', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(34, 197, 94, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Share2 size={18} color="#22c55e" />
                        </div>
                        <div>
                          <div style={{ fontSize: '20px', fontWeight: 700, color: '#22c55e', lineHeight: 1.2 }}>
                            {formatNumber(interactionsBreakdown.shares)}
                          </div>
                          <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>Compartilhamentos</div>
                        </div>
                      </div>
                      <div style={{ padding: '12px', background: '#faf5ff', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(168, 85, 247, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Bookmark size={18} color="#a855f7" />
                        </div>
                        <div>
                          <div style={{ fontSize: '20px', fontWeight: 700, color: '#a855f7', lineHeight: 1.2 }}>
                            {formatNumber(interactionsBreakdown.saves)}
                          </div>
                          <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>Salvos</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Gráfico de Interações por Tempo */}
                <section className="ig-card-white" style={{ marginBottom: '24px' }}>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#111827' }}>
                      Interações por tempo
                    </h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#6366f1' }} />
                        <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}>Interações</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: '20px', height: 240 }}>
                    {interactionsChartData.length ? (
                      <ResponsiveContainer>
                        <AreaChart
                          data={interactionsChartData}
                          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="interactionsGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                          <XAxis
                            dataKey="date"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#9ca3af', fontSize: 11 }}
                            interval="preserveStartEnd"
                            minTickGap={40}
                            tickFormatter={formatAxisDate}
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#9ca3af', fontSize: 11 }}
                            tickFormatter={(value) => formatCompactNumber(value)}
                          />
                          <Tooltip
                            cursor={{ stroke: 'rgba(17, 24, 39, 0.2)', strokeDasharray: '4 4' }}
                            content={(props) => {
                              const value = props?.payload?.[0]?.value;
                              if (value == null) return null;
                              const tooltipDate = props?.payload?.[0]?.payload?.tooltipDate || props?.label;
                              return (
                                <CustomChartTooltip
                                  {...props}
                                  labelFormatter={() => String(tooltipDate || "")}
                                  labelMap={{ value: "Interações" }}
                                  valueFormatter={(v) => `: ${formatTooltipNumber(v)}`}
                                />
                              );
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="value"
                            stroke="#6366f1"
                            strokeWidth={2.5}
                            fill="url(#interactionsGradient)"
                            dot={false}
                            activeDot={{ r: 5, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="ig-empty-state">Sem dados disponíveis.</div>
                    )}
                  </div>
                </section>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                  {/* Gráfico de Pizza */}
                  <section className="ig-card-white">
                    <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                      <h4 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                        Distribuição de interações
                      </h4>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#ef4444' }} />
                          <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}>Curtidas</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#3b82f6' }} />
                          <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}>Comentários</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#22c55e' }} />
                          <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}>Compartilhamentos</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#a855f7' }} />
                          <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}>Salvos</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ padding: '20px', height: 280 }}>
                      {interactionsBreakdown.total > 0 ? (
                        <ResponsiveContainer>
                          <PieChart>
                            <Pie
                              data={[
                                { name: 'Curtidas', value: interactionsBreakdown.likes, color: '#ef4444' },
                                { name: 'Comentários', value: interactionsBreakdown.comments, color: '#3b82f6' },
                                { name: 'Compartilhamentos', value: interactionsBreakdown.shares, color: '#22c55e' },
                                { name: 'Salvos', value: interactionsBreakdown.saves, color: '#a855f7' }
                              ].filter(item => item.value > 0)}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={50}
                              outerRadius={90}
                              paddingAngle={2}
                            >
                              {[
                                { name: 'Curtidas', value: interactionsBreakdown.likes, color: '#ef4444' },
                                { name: 'Comentários', value: interactionsBreakdown.comments, color: '#3b82f6' },
                                { name: 'Compartilhamentos', value: interactionsBreakdown.shares, color: '#22c55e' },
                                { name: 'Salvos', value: interactionsBreakdown.saves, color: '#a855f7' }
                              ].filter(item => item.value > 0).map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              content={(
                                <CustomChartTooltip
                                  variant="pie"
                                  valueFormatter={(v) => `: ${formatNumber(v)}`}
                                />
                              )}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="ig-empty-state">Sem dados disponíveis.</div>
                      )}
                    </div>
                  </section>

                  {/* Por tipo de conteúdo (Interações) */}
                  <section className="ig-card-white">
                    <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb' }}>
                      <h4 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                        Por tipo de conteúdo
                      </h4>
                    </div>
                    <div style={{ padding: '20px 24px' }}>
                      {interactionsByContentType.some((item) => item.raw > 0) ? (
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart
                            data={interactionsByContentType}
                            margin={{ top: 10, right: 10, left: 0, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                            <XAxis
                              dataKey="name"
                              tick={{ fontSize: 13, fontWeight: 600, fill: '#374151' }}
                              axisLine={{ stroke: '#e5e7eb' }}
                              tickLine={false}
                            />
                            <YAxis
                              tick={{ fontSize: 12, fill: '#9ca3af' }}
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(v) => `${v}%`}
                            />
                            <Tooltip
                              formatter={(value, name, props) => [`${value.toFixed(1)}% (${formatNumber(props.payload.raw)})`, 'Interações']}
                              contentStyle={{ borderRadius: '10px', border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                              cursor={{ fill: 'rgba(99, 102, 241, 0.06)' }}
                            />
                            <Bar
                              dataKey="value"
                              radius={[6, 6, 0, 0]}
                              maxBarSize={56}
                            >
                              {interactionsByContentType.map((entry) => (
                                <Cell key={entry.key} fill={entry.fill} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="ig-empty-state">Sem dados disponíveis.</div>
                      )}
                    </div>
                  </section>
                </div>

                {/* Top Posts por Engajamento */}
                <section className="ig-card-white">
                  <div style={{ padding: '20px', borderBottom: '1px solid #e5e7eb' }}>
                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#111827' }}>
                      Posts com maior engajamento
                    </h4>
                  </div>
                  <div style={{ padding: '16px' }}>
                    {(topPosts || []).length > 0 ? (
                      <div style={{ display: 'flex', gap: '14px', overflowX: 'auto', paddingBottom: '8px' }}>
                        {(topPosts || []).slice(0, 5).map((post, idx) => {
                          const previewUrl = [
                            post.previewUrl,
                            post.preview_url,
                            post.thumbnailUrl,
                            post.thumbnail_url,
                            post.mediaUrl,
                            post.media_url,
                            post.thumbnail,
                          ].find((url) => url && !/\.(mp4|mov)$/i.test(url));
                          const engagement = sumInteractions(post);
                          return (
                            <div
                              key={post.id || idx}
                              style={{
                                flexShrink: 0,
                                width: '132px',
                                borderRadius: '12px',
                                overflow: 'hidden',
                                background: 'white',
                                border: '1px solid #e5e7eb',
                                cursor: 'pointer',
                                transition: 'transform 0.2s'
                              }}
                              onClick={() => setSelectedPost(post)}
                            >
                              <div style={{ width: '132px', height: '236px', background: '#f3f4f6', position: 'relative' }}>
                                {previewUrl ? (
                                  <img src={previewUrl} alt="Post" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
                                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                                  background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
                                  padding: '24px 10px 10px',
                                  color: 'white'
                                }}>
                                  <div style={{ fontSize: '15px', fontWeight: 700 }}>{formatNumber(engagement)}</div>
                                  <div style={{ fontSize: '11px', opacity: 0.9 }}>interações</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="ig-empty-state">Sem posts disponíveis.</div>
                    )}
                  </div>
                </section>
              </div>
            ) : showPostsDetail ? (
              /* Conteúdo detalhado de Posts */
              <div className="ig-posts-detail-panel">
                {/* Header com botão voltar */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '24px',
                  padding: '16px 20px',
                  background: 'linear-gradient(135deg, #f97316 0%, #fb923c 100%)',
                  borderRadius: '16px',
                  color: 'white'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      onClick={() => setShowPostsDetail(false)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        background: 'rgba(255, 255, 255, 0.2)',
                        border: 'none',
                        color: 'white',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Posts</h3>
                      <p style={{ margin: 0, fontSize: '13px', opacity: 0.9 }}>Análise detalhada</p>
                    </div>
                  </div>
                </div>

                {/* KPIs de Posts */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '12px',
                  marginBottom: '24px'
                }}>
                  <div className="ig-card-white" style={{ padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#f97316' }}>
                      {recentPosts?.length || 0}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>Total de Posts</div>
                  </div>
                  <div className="ig-card-white" style={{ padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#fb923c' }}>
                      {formatNumber(
                        recentPosts?.length > 0
                          ? Math.round(recentPosts.reduce((sum, p) => sum + (resolvePostMetric(p, 'likes', 0) + resolvePostMetric(p, 'comments', 0)), 0) / recentPosts.length)
                          : 0
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>Média Engajamento</div>
                  </div>
                  <div className="ig-card-white" style={{ padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#fdba74' }}>
                      {formatNumber(
                        recentPosts?.length > 0
                          ? Math.max(...recentPosts.map(p => resolvePostMetric(p, 'likes', 0) + resolvePostMetric(p, 'comments', 0)))
                          : 0
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>Maior Engajamento</div>
                  </div>
                </div>

                {/* Tabela de Posts Recentes */}
                <section className="ig-card-white">
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#111827' }}>
                      Posts Recentes
                    </h4>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6b7280' }}>
                      Publicações mais recentes no período filtrado
                      {recentPostsFetching && !recentPostsLoading ? (
                        <span style={{ marginLeft: '8px', fontWeight: 600, color: '#9ca3af' }}>Atualizando...</span>
                      ) : null}
                    </p>
                  </div>
                  <div style={{ padding: 0 }}>
                    <PostsTable
                      posts={recentPosts.slice(0, RECENT_POSTS_TABLE_LIMIT)}
                      loading={recentPostsLoading}
                      error={recentPostsError}
                    />
                  </div>
                </section>
              </div>
            ) : showWordCloudDetail ? (
              /* Conteúdo detalhado de Palavras-chave */
              <div className="ig-wordcloud-detail-panel">
                {/* Header com botão voltar */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '24px',
                  padding: '16px 20px',
                  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  borderRadius: '16px',
                  color: 'white'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      onClick={closeWordCloudDetail}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        background: 'rgba(255, 255, 255, 0.2)',
                        border: 'none',
                        color: 'white',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Comentários com "{selectedWordCloud?.word}"</h3>
                      <p style={{ margin: 0, fontSize: '13px', opacity: 0.9 }}>
                        {wordCloudDetails && !wordCloudDetailsLoading && !wordCloudDetailsError
                          ? `${wordCloudDetails.total_occurrences} ocorrência${wordCloudDetails.total_occurrences === 1 ? '' : 's'} em ${wordCloudDetails.total_comments} comentário${wordCloudDetails.total_comments === 1 ? '' : 's'}`
                          : 'Buscando ocorrências...'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* KPIs */}
                {wordCloudDetails && !wordCloudDetailsLoading && !wordCloudDetailsError && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '16px',
                    marginBottom: '24px'
                  }}>
                    <div className="ig-card-white" style={{ padding: '20px', textAlign: 'center' }}>
                      <div style={{ fontSize: '28px', fontWeight: 700, color: '#dc2626' }}>
                        {wordCloudDetails.total_occurrences?.toLocaleString('pt-BR') || 0}
                      </div>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Ocorrências</div>
                    </div>
                    <div className="ig-card-white" style={{ padding: '20px', textAlign: 'center' }}>
                      <div style={{ fontSize: '28px', fontWeight: 700, color: '#f87171' }}>
                        {wordCloudDetails.total_comments?.toLocaleString('pt-BR') || 0}
                      </div>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Comentários</div>
                    </div>
                  </div>
                )}

                {/* Lista de comentários */}
                <section className="ig-card-white" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#111827', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      Comentários encontrados
                    </h4>
                  </div>
                  <div style={{ padding: '16px 20px', flex: 1 }}>
                    {wordCloudDetailsLoading ? (
                      <DataState state="loading" label="Carregando comentários..." size="sm" />
                    ) : wordCloudDetailsError ? (
                      <DataState state="error" label="Falha ao carregar comentários." hint={wordCloudDetailsError} size="sm" />
                    ) : wordCloudDetails && Array.isArray(wordCloudDetails.comments) && wordCloudDetails.comments.length ? (
                      <>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {wordCloudDetails.comments.map((comment) => (
                            <li key={comment.id || `${comment.text}-${comment.timestamp}`} style={{
                              padding: '12px 16px',
                              background: '#f9fafb',
                              borderRadius: '10px',
                              border: '1px solid #e5e7eb'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                <span style={{ fontWeight: 600, fontSize: '13px', color: '#111827' }}>
                                  {comment.username ? `@${comment.username}` : 'Comentário'}
                                </span>
                                {comment.timestamp && (
                                  <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                                    {formatWordCloudDetailDate(comment.timestamp)}
                                  </span>
                                )}
                                {comment.occurrences > 1 && (
                                  <span style={{
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    color: '#ef4444',
                                    background: '#fef2f2',
                                    padding: '2px 8px',
                                    borderRadius: '10px'
                                  }}>
                                    {comment.occurrences}x
                                  </span>
                                )}
                              </div>
                              <p style={{ margin: 0, fontSize: '14px', color: '#374151', lineHeight: 1.5 }}>
                                {comment.text}
                              </p>
                            </li>
                          ))}
                        </ul>
                        {wordCloudDetailsTotalPages > 1 && (
                          <div className="ig-word-detail-pagination">
                            <button
                              type="button"
                              className="ig-word-detail-pagination__btn ig-word-detail-pagination__arrow"
                              onClick={handleWordCloudPrevPage}
                              disabled={!wordCloudCanGoPrev || wordCloudDetailsLoadingMore}
                              aria-label="PÃ¡gina anterior"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="15 18 9 12 15 6" />
                              </svg>
                            </button>
                            <div className="ig-word-detail-pagination__pages">
                              {wordCloudDetailsLoadingMore ? (
                                <span className="ig-word-detail-pagination__loading">Carregando...</span>
                              ) : (
                                wordCloudPageNumbers.map((page, index) => (
                                  page === "..." ? (
                                    <span key={`ellipsis-${index}`} className="ig-word-detail-pagination__ellipsis">...</span>
                                  ) : (
                                    <button
                                      key={page}
                                      type="button"
                                      className={`ig-word-detail-pagination__page ${wordCloudDetailsPage === page ? 'ig-word-detail-pagination__page--active' : ''}`}
                                      onClick={() => handleWordCloudGoToPage(page)}
                                      disabled={wordCloudDetailsLoadingMore}
                                    >
                                      {page}
                                    </button>
                                  )
                                ))
                              )}
                            </div>
                            <button
                              type="button"
                              className="ig-word-detail-pagination__btn ig-word-detail-pagination__arrow"
                              onClick={handleWordCloudNextPage}
                              disabled={!wordCloudCanGoNext || wordCloudDetailsLoadingMore}
                              aria-label="PrÃ³xima pÃ¡gina"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <DataState state="empty" label="Nenhum comentário encontrado com essa palavra." size="sm" />
                    )}
                  </div>
                </section>
              </div>
            ) : showCitiesDetail ? (
              /* Conteúdo detalhado de Top Cidades */
              <div className="ig-cities-detail-panel">
                {/* Header com botão voltar */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '24px',
                  padding: '16px 20px',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
                  borderRadius: '16px',
                  color: 'white'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      onClick={() => setShowCitiesDetail(false)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        background: 'rgba(255, 255, 255, 0.2)',
                        border: 'none',
                        color: 'white',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Top Cidades</h3>
                      <p style={{ margin: 0, fontSize: '13px', opacity: 0.9 }}>
                        Distribuição geográfica do público · {audienceTimeframeLabel}
                      </p>
                    </div>
                  </div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                      <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    {audienceCities.length} cidades
                  </div>
                </div>

                {/* KPIs de Resumo */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '16px',
                  marginBottom: '24px'
                }}>
                  <div className="ig-card-white" style={{ padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#3b82f6' }}>
                      {audienceCities.length}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Total de Cidades</div>
                  </div>
                  <div className="ig-card-white" style={{ padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#6366f1' }}>
                      {formatNumber(audienceCitiesTotal)}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Total de Seguidores</div>
                  </div>
                  <div className="ig-card-white" style={{ padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#8b5cf6' }}>
                      {audienceTopCity?.cityName || '--'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Cidade Principal</div>
                  </div>
                </div>

                {/* Mapa do Brasil com Cidades */}
                <section className="ig-card-white" style={{ marginBottom: '24px' }}>
                  <div style={{ padding: '20px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h4 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                      Mapa de distribuição
                    </h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#3b82f6' }} />
                        <span style={{ fontSize: '12px', color: '#6b7280' }}>Menor</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '16px', height: '16px', borderRadius: '50%', background: '#6366f1' }} />
                        <span style={{ fontSize: '12px', color: '#6b7280' }}>Médio</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#8b5cf6' }} />
                        <span style={{ fontSize: '12px', color: '#6b7280' }}>Maior</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: '20px', height: 420, position: 'relative' }}>
                    {audienceCities.length > 0 ? (
                      <ComposableMap
                        projection="geoMercator"
                        projectionConfig={{
                          scale: 650,
                          center: [-52, -15]
                        }}
                        style={{ width: '100%', height: '100%' }}
                      >
                        <ZoomableGroup center={[-52, -15]} zoom={1}>
                          <Geographies geography="https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson">
                            {({ geographies }) =>
                              geographies.map((geo) => (
                                <Geography
                                  key={geo.rsmKey}
                                  geography={geo}
                                  fill="#e5e7eb"
                                  stroke="#fff"
                                  strokeWidth={0.5}
                                  style={{
                                    default: { outline: 'none' },
                                    hover: { fill: '#d1d5db', outline: 'none' },
                                    pressed: { outline: 'none' }
                                  }}
                                />
                              ))
                            }
                          </Geographies>
                          {/* Marcadores das cidades */}
                          {(() => {
                            // Coordenadas das principais cidades brasileiras
                            const cityCoordinates = {
                              'São Paulo': [-46.6333, -23.5505],
                              'Sao Paulo': [-46.6333, -23.5505],
                              'Rio de Janeiro': [-43.1729, -22.9068],
                              'Brasília': [-47.9292, -15.7801],
                              'Brasilia': [-47.9292, -15.7801],
                              'Salvador': [-38.5016, -12.9714],
                              'Fortaleza': [-38.5434, -3.7172],
                              'Belo Horizonte': [-43.9378, -19.9167],
                              'Manaus': [-60.0217, -3.1190],
                              'Curitiba': [-49.2654, -25.4290],
                              'Recife': [-34.8813, -8.0476],
                              'Porto Alegre': [-51.2177, -30.0346],
                              'Belém': [-48.5044, -1.4558],
                              'Belem': [-48.5044, -1.4558],
                              'Goiânia': [-49.2533, -16.6869],
                              'Goiania': [-49.2533, -16.6869],
                              'Guarulhos': [-46.5333, -23.4628],
                              'Campinas': [-47.0608, -22.9099],
                              'São Luís': [-44.3028, -2.5297],
                              'Sao Luis': [-44.3028, -2.5297],
                              'São Gonçalo': [-43.0347, -22.8268],
                              'Sao Goncalo': [-43.0347, -22.8268],
                              'Maceió': [-35.7353, -9.6498],
                              'Maceio': [-35.7353, -9.6498],
                              'Duque de Caxias': [-43.3115, -22.7858],
                              'Natal': [-35.2091, -5.7945],
                              'Teresina': [-42.8019, -5.0892],
                              'Campo Grande': [-54.6464, -20.4697],
                              'São Bernardo do Campo': [-46.5650, -23.6914],
                              'Sao Bernardo do Campo': [-46.5650, -23.6914],
                              'João Pessoa': [-34.8631, -7.1195],
                              'Joao Pessoa': [-34.8631, -7.1195],
                              'Santo André': [-46.5322, -23.6639],
                              'Santo Andre': [-46.5322, -23.6639],
                              'Osasco': [-46.7917, -23.5325],
                              'Ribeirão Preto': [-47.8103, -21.1775],
                              'Ribeirao Preto': [-47.8103, -21.1775],
                              'Uberlândia': [-48.2891, -18.9186],
                              'Uberlandia': [-48.2891, -18.9186],
                              'Sorocaba': [-47.4581, -23.5015],
                              'Contagem': [-44.0539, -19.9319],
                              'Aracaju': [-37.0731, -10.9472],
                              'Feira de Santana': [-38.9663, -12.2664],
                              'Cuiabá': [-56.0974, -15.6014],
                              'Cuiaba': [-56.0974, -15.6014],
                              'Joinville': [-48.8488, -26.3045],
                              'Juiz de Fora': [-43.3503, -21.7642],
                              'Londrina': [-51.1628, -23.3103],
                              'Aparecida de Goiânia': [-49.2469, -16.8198],
                              'Aparecida de Goiania': [-49.2469, -16.8198],
                              'Niterói': [-43.1036, -22.8833],
                              'Niteroi': [-43.1036, -22.8833],
                              'Porto Velho': [-63.8999, -8.7612],
                              'Florianópolis': [-48.5482, -27.5954],
                              'Florianopolis': [-48.5482, -27.5954],
                              'Serra': [-40.3078, -20.1281],
                              'Caxias do Sul': [-51.1792, -29.1634],
                              'Vitória': [-40.2976, -20.3155],
                              'Vitoria': [-40.2976, -20.3155],
                              'Macapá': [-51.0669, 0.0349],
                              'Macapa': [-51.0669, 0.0349],
                              'Boa Vista': [-60.6753, 2.8235],
                              'Rio Branco': [-67.8076, -9.9754],
                              'Palmas': [-48.3558, -10.1689],
                              'Santos': [-46.3289, -23.9608],
                              'Mogi das Cruzes': [-46.1897, -23.5225],
                              'Betim': [-44.1983, -19.9678],
                              'Diadema': [-46.6228, -23.6814],
                              'Jundiaí': [-46.8822, -23.1864],
                              'Jundiai': [-46.8822, -23.1864],
                              'Piracicaba': [-47.6494, -22.7256],
                              'Carapicuíba': [-46.8406, -23.5225],
                              'Carapicuiba': [-46.8406, -23.5225],
                              'Olinda': [-34.8558, -8.0089],
                              'Montes Claros': [-43.8617, -16.7350],
                              'Anápolis': [-48.9528, -16.3281],
                              'Anapolis': [-48.9528, -16.3281],
                              'São José dos Campos': [-45.8864, -23.1896],
                              'Sao Jose dos Campos': [-45.8864, -23.1896],
                              'Maringá': [-51.9333, -23.4253],
                              'Maringa': [-51.9333, -23.4253],
                              'Blumenau': [-49.0661, -26.9194],
                              'Bauru': [-49.0606, -22.3147],
                              'Ponta Grossa': [-50.1619, -25.0994],
                              'Cascavel': [-53.4550, -24.9578],
                              'Pelotas': [-52.3425, -31.7654],
                              'Canoas': [-51.1739, -29.9178],
                              'Franca': [-47.4008, -20.5389],
                              'Itaquaquecetuba': [-46.3486, -23.4867],
                              'Praia Grande': [-46.4022, -24.0058],
                              'Petrolina': [-40.5008, -9.3986],
                              'Petrópolis': [-43.1786, -22.5050],
                              'Petropolis': [-43.1786, -22.5050],
                              'Limeira': [-47.4017, -22.5642],
                              'São José do Rio Preto': [-49.3794, -20.8197],
                              'Sao Jose do Rio Preto': [-49.3794, -20.8197],
                              'Foz do Iguaçu': [-54.5853, -25.5478],
                              'Foz do Iguacu': [-54.5853, -25.5478],
                              'Taubaté': [-45.5556, -23.0261],
                              'Taubate': [-45.5556, -23.0261],
                              'Chapecó': [-52.6186, -27.1006],
                              'Chapeco': [-52.6186, -27.1006],
                              'Novo Hamburgo': [-51.1308, -29.6783],
                              'Santa Maria': [-53.8008, -29.6868],
                              'Suzano': [-46.3106, -23.5425],
                              'Governador Valadares': [-41.9489, -18.8511],
                              'Volta Redonda': [-44.1042, -22.5231],
                              'Gravataí': [-50.9919, -29.9436],
                              'Gravatai': [-50.9919, -29.9436],
                              'Mossoró': [-37.3442, -5.1878],
                              'Mossoro': [-37.3442, -5.1878],
                              'Americana': [-47.3331, -22.7392],
                              'Várzea Grande': [-56.1325, -15.6469],
                              'Varzea Grande': [-56.1325, -15.6469],
                              'Imperatriz': [-47.4919, -5.5264],
                              'Caruaru': [-35.9761, -8.2850],
                              'Dourados': [-54.8056, -22.2211],
                              'Rondonópolis': [-54.6372, -16.4703],
                              'Rondonopolis': [-54.6372, -16.4703],
                              'Itajaí': [-48.6617, -26.9078],
                              'Itajai': [-48.6617, -26.9078],
                              'Marabá': [-49.1178, -5.3686],
                              'Maraba': [-49.1178, -5.3686],
                              'São José': [-48.6361, -27.6136],
                              'Sao Jose': [-48.6361, -27.6136],
                              'Uberaba': [-47.9319, -19.7478],
                              'Rio Grande': [-52.0986, -32.0350],
                              'Caucaia': [-38.6531, -3.7361],
                              'Itabuna': [-39.2803, -14.7856],
                              'Parnaíba': [-41.7769, -2.9053],
                              'Parnaiba': [-41.7769, -2.9053],
                              'Juazeiro do Norte': [-39.3153, -7.2131],
                              'Sobral': [-40.3481, -3.6897],
                              'Vitória da Conquista': [-40.8394, -14.8619],
                              'Vitoria da Conquista': [-40.8394, -14.8619],
                              'Ilhéus': [-39.0464, -14.7936],
                              'Ilheus': [-39.0464, -14.7936],
                              'Juazeiro': [-40.5003, -9.4164],
                              'Lages': [-50.3258, -27.8161],
                              'Criciúma': [-49.3694, -28.6775],
                              'Criciuma': [-49.3694, -28.6775],
                              'Passo Fundo': [-52.4067, -28.2622],
                              'Divinópolis': [-44.8836, -20.1389],
                              'Divinopolis': [-44.8836, -20.1389],
                              'Sete Lagoas': [-44.2469, -19.4658],
                              'Ipatinga': [-42.5361, -19.4686],
                              'Santarém': [-54.7081, -2.4431],
                              'Santarem': [-54.7081, -2.4431],
                              'Camaçari': [-38.3247, -12.6975],
                              'Camacari': [-38.3247, -12.6975],
                              'Sinop': [-55.5033, -11.8642],
                              'Rio Verde': [-50.9281, -17.7928],
                              'Patos de Minas': [-46.5181, -18.5789]
                            };

                            const maxValue = audienceCities[0]?.value || 1;

                            return audienceCities.slice(0, 20).map((city, index) => {
                              const nameValue = String(city.name || "");
                              const parts = nameValue.split(",").map((part) => part.trim()).filter(Boolean);
                              const cityName = parts[0] || nameValue;

                              // Procura coordenadas
                              const coords = cityCoordinates[cityName];
                              if (!coords) return null;

                              // Calcula tamanho do marcador baseado no valor
                              const ratio = city.value / maxValue;
                              const minSize = 6;
                              const maxSize = 20;
                              const size = minSize + (ratio * (maxSize - minSize));

                              // Cor baseada no ranking
                              const colors = ['#8b5cf6', '#6366f1', '#3b82f6', '#60a5fa', '#93c5fd'];
                              const color = colors[Math.min(index, colors.length - 1)];
                              const pct = audienceCitiesTotal > 0 ? ((city.value / audienceCitiesTotal) * 100).toFixed(1) : 0;

                              return (
                                <Marker key={cityName} coordinates={coords}>
                                  <circle
                                    r={size}
                                    fill={color}
                                    fillOpacity={0.8}
                                    stroke="#fff"
                                    strokeWidth={1.5}
                                    style={{ cursor: 'pointer' }}
                                  />
                                  <title>{`${cityName}: ${pct}% (${formatNumber(city.value)} seguidores)`}</title>
                                </Marker>
                              );
                            }).filter(Boolean);
                          })()}
                        </ZoomableGroup>
                      </ComposableMap>
                    ) : (
                      <div className="ig-empty-state">Sem dados disponíveis para o mapa.</div>
                    )}
                  </div>
                  {/* Lista das top 5 cidades no mapa */}
                  <div style={{
                    padding: '16px 20px',
                    borderTop: '1px solid #e5e7eb',
                    display: 'flex',
                    gap: '16px',
                    flexWrap: 'wrap',
                    justifyContent: 'center'
                  }}>
                    {audienceCities.slice(0, 5).map((city, index) => {
                      const nameValue = String(city.name || "");
                      const parts = nameValue.split(",").map((part) => part.trim()).filter(Boolean);
                      const cityName = parts[0] || nameValue;
                      const pct = audienceCitiesTotal > 0 ? ((city.value / audienceCitiesTotal) * 100).toFixed(1) : 0;
                      const colors = ['#8b5cf6', '#6366f1', '#3b82f6', '#60a5fa', '#93c5fd'];

                      return (
                        <div key={cityName} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px 12px',
                          background: '#f9fafb',
                          borderRadius: '8px',
                          border: '1px solid #e5e7eb'
                        }}>
                          <span style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            background: colors[index]
                          }} />
                          <span style={{ fontSize: '13px', fontWeight: 500, color: '#374151' }}>{cityName}</span>
                          <span style={{ fontSize: '12px', color: '#6b7280' }}>{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Gráfico de Barras Horizontal */}
                <section className="ig-card-white" style={{ marginBottom: '24px' }}>
                  <div style={{ padding: '20px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h4 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                      Distribuição por cidade
                    </h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)' }} />
                      <span style={{ fontSize: '13px', color: '#6b7280', fontWeight: 500 }}>Seguidores</span>
                    </div>
                  </div>
                  <div style={{ padding: '20px', height: 400 }}>
                    {audienceCities.length > 0 ? (
                      <ResponsiveContainer>
                        <BarChart
                          data={audienceCities.slice(0, 15).map(city => {
                            const nameValue = String(city.name || "");
                            const parts = nameValue.split(",").map((part) => part.trim()).filter(Boolean);
                            const cityName = parts[0] || nameValue;
                            const pct = audienceCitiesTotal > 0 ? ((city.value / audienceCitiesTotal) * 100) : 0;
                            return {
                              name: cityName.length > 15 ? cityName.substring(0, 15) + '...' : cityName,
                              fullName: cityName,
                              value: city.value,
                              percentage: pct
                            };
                          })}
                          layout="vertical"
                          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                          <XAxis
                            type="number"
                            tick={{ fill: '#6b7280', fontSize: 11 }}
                            axisLine={{ stroke: '#e5e7eb' }}
                            tickLine={false}
                            tickFormatter={(value) => `${value.toFixed(0)}%`}
                          />
                          <YAxis
                            type="category"
                            dataKey="name"
                            tick={{ fill: '#374151', fontSize: 12 }}
                            axisLine={{ stroke: '#e5e7eb' }}
                            tickLine={false}
                            width={120}
                          />
                          <Tooltip
                            cursor={{ fill: 'rgba(59, 130, 246, 0.1)' }}
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const data = payload[0].payload;
                              return (
                                <div className="ig-tooltip">
                                  <span className="ig-tooltip__title">{data.fullName}</span>
                                  <div className="ig-tooltip__row">
                                    <span>Seguidores</span>
                                    <strong>: {formatNumber(data.value)}</strong>
                                  </div>
                                  <div className="ig-tooltip__row">
                                    <span>Percentual</span>
                                    <strong>: {data.percentage.toFixed(2)}%</strong>
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Bar
                            dataKey="percentage"
                            fill="url(#citiesGradient)"
                            radius={[0, 6, 6, 0]}
                          />
                          <defs>
                            <linearGradient id="citiesGradient" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="#3b82f6" />
                              <stop offset="100%" stopColor="#6366f1" />
                            </linearGradient>
                          </defs>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="ig-empty-state">Sem dados disponíveis.</div>
                    )}
                  </div>
                </section>

                {/* Lista Completa de Cidades */}
                <section className="ig-card-white">
                  <div style={{ padding: '20px', borderBottom: '1px solid #e5e7eb' }}>
                    <h4 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                      Ranking completo de cidades
                    </h4>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6b7280' }}>
                      Todas as cidades ordenadas por número de seguidores
                    </p>
                  </div>
                  <div style={{ padding: '16px', maxHeight: '400px', overflowY: 'auto' }}>
                    {audienceCities.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {audienceCities.map((city, index) => {
                          const nameValue = String(city.name || "");
                          const parts = nameValue.split(",").map((part) => part.trim()).filter(Boolean);
                          const cityName = parts[0] || nameValue;
                          const regionName = parts.length > 1 ? parts.slice(1).join(", ") : "";
                          const pct = audienceCitiesTotal > 0 ? ((city.value / audienceCitiesTotal) * 100) : 0;
                          const colors = ["#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#c084fc"];
                          const color = colors[index % colors.length];
                          const maxPct = audienceCitiesTotal > 0 ? ((audienceCities[0]?.value / audienceCitiesTotal) * 100) : 1;
                          const barWidth = maxPct > 0 ? Math.round((pct / maxPct) * 100) : 0;

                          return (
                            <div
                              key={`${city.name}-${index}`}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '12px 16px',
                                background: index < 3 ? 'rgba(59, 130, 246, 0.05)' : '#f9fafb',
                                borderRadius: '10px',
                                border: index < 3 ? '1px solid rgba(59, 130, 246, 0.15)' : '1px solid #e5e7eb'
                              }}
                            >
                              <div style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                background: index < 3 ? `linear-gradient(135deg, ${color} 0%, ${colors[(index + 1) % colors.length]} 100%)` : '#e5e7eb',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: index < 3 ? 'white' : '#6b7280',
                                fontSize: '13px',
                                fontWeight: 700,
                                flexShrink: 0
                              }}>
                                {index + 1}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {cityName}
                                </div>
                                {regionName && (
                                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {regionName}
                                  </div>
                                )}
                                <div style={{ marginTop: '6px', height: '4px', background: '#e5e7eb', borderRadius: '2px', overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${barWidth}%`, background: `linear-gradient(90deg, ${color} 0%, ${colors[(index + 1) % colors.length]} 100%)`, borderRadius: '2px' }} />
                                </div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <div style={{ fontSize: '15px', fontWeight: 700, color: color }}>
                                  {pct.toFixed(1)}%
                                </div>
                                <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                                  {formatNumber(city.value)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="ig-empty-state">Sem cidades disponíveis.</div>
                    )}
                  </div>
                </section>
              </div>
            ) : (
              <>
            {/* Card de Crescimento do Perfil */}
            <section className="ig-growth-clean">
              <header className="ig-card-header">
                <div>
                  <h3>
                    Crescimento do perfil
                    <InfoTooltip text="Número de contas únicas alcançadas no período selecionado." />
                  </h3>
                  <p className="ig-card-subtitle">Alcance</p>
                </div>
              </header>

              <div className="ig-chart-area">
                {metricsLoading ? (
                  <div className="ig-chart-skeleton ig-chart-skeleton--tall" aria-hidden="true" />
                ) : profileReachData.length ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart
                      data={profileReachData}
                      margin={{ top: 16, right: 28, left: 12, bottom: 8 }}
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
                        dataKey="dateKey"
                        tick={{ fill: '#6b7280', fontFamily: 'Lato, sans-serif' }}
                        fontSize={12}
                        tickLine={false}
                        axisLine={{ stroke: '#e5e7eb' }}
                        interval="preserveStartEnd"
                        minTickGap={48}
                        angle={0}
                        padding={{ left: 8, right: 8 }}
                        tickFormatter={formatReachAxisTick}
                      />
                      <YAxis
                        tick={{ fill: '#6b7280', fontFamily: 'Lato, sans-serif' }}
                        fontSize={12}
                        tickLine={false}
                        axisLine={{ stroke: '#e5e7eb' }}
                        tickFormatter={(value) => formatCompactNumber(value)}
                        domain={['dataMin', (dataMax) => (Number.isFinite(dataMax) ? Math.ceil(dataMax * 1.1) : dataMax)]}
                      />
                      <Tooltip
                        cursor={{ stroke: 'rgba(17, 24, 39, 0.2)', strokeDasharray: '4 4' }}
                        content={(props) => {
                          if (!props?.active || !props?.payload?.length) return null;
                          const item = props.payload[0]?.payload;
                          const numericValue = Number(props.payload[0]?.value ?? item?.value ?? 0);
                          const labelValue = formatReachTooltipLabel(item?.dateKey || item?.label);
                          const isPeak =
                            !!peakReachPoint &&
                            item?.dateKey === peakReachPoint.dateKey &&
                            numericValue === peakReachPoint.value;
                          const footer = isPeak ? (
                            <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
                              Pico do periodo
                            </div>
                          ) : null;
                          return (
                            <CustomChartTooltip
                              {...props}
                              payload={props.payload.slice(0, 1)}
                              labelFormatter={() => labelValue}
                              labelMap={{ value: "Contas alcancadas" }}
                              valueFormatter={(value) => `: ${formatTooltipNumber(value)}`}
                              footer={footer}
                            />
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
                            x={peakReachPoint.dateKey || peakReachPoint.label}
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
                            x={peakReachPoint.dateKey || peakReachPoint.label}
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

            {/* DESATIVADO TEMPORARIAMENTE — Card de Crescimento de Seguidores
            <section className="ig-growth-clean ig-growth-followers ig-follower-growth-card">
              ... conteúdo original preservado no código para reativação futura ...
            </section>
            */}

            {/* Card de Interações por dia */}
            <section className="ig-growth-clean ig-growth-followers ig-follower-growth-card">
              <header className="ig-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h3>
                    Interações por dia
                    <InfoTooltip text="Total de curtidas, comentários, compartilhamentos e salvamentos por dia no período." />
                  </h3>
                  <p className="ig-card-subtitle">Curtidas, comentários, compartilhamentos e salvamentos</p>
                </div>
                <button
                  onClick={() => {
                    closeWordCloudDetail();
                    setShowInteractionsDetail(true);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
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
              </header>

              <div className="ig-chart-area">
                {metricsLoading ? (
                  <div className="ig-chart-skeleton ig-chart-skeleton--compact" aria-hidden="true" />
                ) : interactionsChartData.length ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart
                      data={interactionsChartData}
                      margin={{ top: 14, right: 16, bottom: 8, left: 0 }}
                    >
                        <defs>
                          <linearGradient id="igInteractionsDailyLine" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 8" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: "#9ca3af", fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
                          interval="preserveStartEnd"
                          height={32}
                          minTickGap={50}
                          tickFormatter={formatAxisDate}
                        />
                        <YAxis
                          tick={{ fill: "#9ca3af", fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(value) => formatCompactNumber(value)}
                        />
                        <Tooltip
                          cursor={{ stroke: "#6366f1", strokeWidth: 1, strokeDasharray: "4 4" }}
                          content={(props) => {
                            if (!props?.active || !props?.payload?.length) return null;
                            const tooltipDate = props?.payload?.[0]?.payload?.tooltipDate || props?.label;
                            const value = props?.payload?.[0]?.value;
                            return (
                              <div className="ig-tooltip">
                                <span className="ig-tooltip__title">{tooltipDate}</span>
                                <div className="ig-tooltip__row">
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#6366f1" }} />
                                    Interações
                                  </span>
                                  <strong>: {formatTooltipNumber(value)}</strong>
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke="#6366f1"
                          strokeWidth={2.5}
                          fill="url(#igInteractionsDailyLine)"
                          dot={false}
                          activeDot={{ r: 5, fill: "#6366f1", stroke: "#fff", strokeWidth: 2 }}
                          connectNulls
                          isAnimationActive={false}
                        />
                      </AreaChart>
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
              <div>
                <h4 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#111827' }}>
                  Visualizações
                  <InfoTooltip text="Soma de todas as reproduções de Reels, Feed e Stories no período." />
                </h4>
                <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px', marginBottom: 0 }}>Total de reproduções (Reels, Feed e Stories)</p>
              </div>
              <button
                onClick={() => {
                  closeWordCloudDetail();
                  setShowDetailedView(true);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
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
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '20px',
                padding: '16px 16px 16px'
              }}>
                {/* Valor principal à esquerda */}
                <div style={{ textAlign: 'center', flexShrink: 0 }}>
                  <div style={{
                    fontSize: '32px',
                    fontWeight: 800,
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    lineHeight: 1
                  }}>
                    {formatNumber(profileViewsTotal ?? null)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px', fontWeight: 500 }}>
                    Visualizações
                  </div>
                </div>

                {/* Grid de métricas à direita */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gridTemplateRows: 'repeat(2, 1fr)',
                  gap: '8px',
                  flex: 1
                }}>
                  <div style={{
                    padding: '8px 8px',
                    borderRadius: '8px',
                    background: 'rgba(139, 92, 246, 0.05)',
                    border: '1px solid rgba(139, 92, 246, 0.1)',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gridRow: 'span 2'
                  }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#8b5cf6', marginBottom: '2px' }}>
                      {profileViewsAverage != null ? formatNumber(Math.round(profileViewsAverage)) : '--'}
                    </div>
                    <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 500 }}>Média diária</div>
                  </div>
                  <div style={{
                    padding: '8px 8px',
                    borderRadius: '8px',
                    background: 'rgba(168, 85, 247, 0.05)',
                    border: '1px solid rgba(168, 85, 247, 0.1)',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gridRow: 'span 2'
                  }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#a855f7', marginBottom: '2px' }}>
                      {profileViewsPeak != null ? formatNumber(profileViewsPeak) : '--'}
                    </div>
                    <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 500 }}>Pico diário</div>
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
              gap: '12px'
            }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#111827' }}>
                  Interações
                  <InfoTooltip text="Soma de curtidas, comentários, salvamentos e compartilhamentos." />
                </h4>
                <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px', marginBottom: 0 }}>Total de engajamento do público</p>
              </div>
              <button
                onClick={() => {
                  closeWordCloudDetail();
                  setShowInteractionsDetail(true);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
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
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '20px',
                padding: '16px 16px 16px'
              }}>
                {/* Valor principal à esquerda */}
                <div style={{ textAlign: 'center', flexShrink: 0 }}>
                  <div style={{
                    fontSize: '32px',
                    fontWeight: 800,
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    lineHeight: 1
                  }}>
                    {formatNumber(interactionsBreakdown.total)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px', fontWeight: 500 }}>
                    Interações
                  </div>
                </div>

                {/* Grid 2x2 de métricas à direita */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '8px',
                  flex: 1
                }}>
                  <div style={{
                    padding: '8px 8px',
                    borderRadius: '8px',
                    background: 'rgba(139, 92, 246, 0.05)',
                    border: '1px solid rgba(139, 92, 246, 0.1)',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#8b5cf6', marginBottom: '2px' }}>
                      {formatNumber(interactionsBreakdown.likes)}
                    </div>
                    <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 500 }}>Curtidas</div>
                  </div>
                  <div style={{
                    padding: '8px 8px',
                    borderRadius: '8px',
                    background: 'rgba(168, 85, 247, 0.05)',
                    border: '1px solid rgba(168, 85, 247, 0.1)',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#a855f7', marginBottom: '2px' }}>
                      {formatNumber(interactionsBreakdown.comments)}
                    </div>
                    <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 500 }}>Comentários</div>
                  </div>
                  <div style={{
                    padding: '8px 8px',
                    borderRadius: '8px',
                    background: 'rgba(139, 92, 246, 0.05)',
                    border: '1px solid rgba(139, 92, 246, 0.1)',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#8b5cf6', marginBottom: '2px' }}>
                      {formatNumber(interactionsBreakdown.saves)}
                    </div>
                    <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 500 }}>Salvamentos</div>
                  </div>
                  <div style={{
                    padding: '8px 8px',
                    borderRadius: '8px',
                    background: 'rgba(168, 85, 247, 0.05)',
                    border: '1px solid rgba(168, 85, 247, 0.1)',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#a855f7', marginBottom: '2px' }}>
                      {formatNumber(interactionsBreakdown.shares)}
                    </div>
                    <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 500 }}>Compartilhamentos</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="ig-analytics-grid ig-analytics-grid--pair">
          <section className="ig-card-white ig-analytics-card">
            <div className="ig-analytics-card__header">
              <div>
                <h4>
                  Quantidade de publicações por dia
                  <InfoTooltip text="Calendário visual mostrando quantas publicações foram feitas em cada dia do mês." />
                </h4>
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

          <section className="ig-card-white ig-analytics-card">
            <div className="ig-analytics-card__header">
              <h4>
                Top cidades
                <InfoTooltip text="Cidades com maior número de seguidores ou público alcançado." />
              </h4>
            </div>
            {audienceCities.length ? (
              <div className="ig-top-cities-content">
                {/* Hero - Cidade Principal */}
                {audienceTopCity && (
                  <div className="ig-top-cities__hero">
                    <div className="ig-top-cities__hero-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                      </svg>
                    </div>
                    <div className="ig-top-cities__hero-content">
                      <div className="ig-top-cities__hero-value">
                        {audienceCitiesTotal > 0 ? `${((audienceTopCity.value / audienceCitiesTotal) * 100).toFixed(1)}%` : '--'}
                      </div>
                      <div className="ig-top-cities__hero-label">
                        <span className="ig-top-cities__hero-name">
                          {audienceTopCity.cityName}
                        </span>
                        <span className="ig-top-cities__hero-badge">
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 3 L13 9 L3 9 Z" />
                          </svg>
                          #1
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Lista de Cidades */}
                <div className="ig-top-cities__table">
                  {audienceTopCityRows.map((city, index) => {
                    const color = index === 0 ? '#22c55e' : '#6366f1';
                    const cityPercentage = audienceCitiesTotal > 0 ? ((city.value / audienceCitiesTotal) * 100) : 0;
                    const maxPercentage = audienceCitiesTotal > 0 ? ((audienceTopCityRows[0]?.value / audienceCitiesTotal) * 100) : 1;
                    const barWidth = maxPercentage > 0 ? Math.round((cityPercentage / maxPercentage) * 100) : 0;
                    const rankNum = index + 1;
                    const rankClass = rankNum <= 3 ? `ig-top-city-row__rank--${rankNum}` : 'ig-top-city-row__rank--default';
                    return (
                      <div className="ig-top-city-row" key={`${city.name || city.cityName}-${index}`}>
                        <span className={`ig-top-city-row__rank ${rankClass}`}>
                          {rankNum}
                        </span>
                        <div className="ig-top-city-row__left">
                          <span className="ig-top-city-row__icon" style={{ backgroundColor: color }}></span>
                          <span className="ig-top-city-row__name">{city.cityName || '--'}</span>
                        </div>
                        <div className="ig-top-city-row__bar">
                          <div
                            className="ig-top-city-row__bar-fill"
                            style={{
                              width: `${barWidth}%`,
                              background: `linear-gradient(90deg, ${color}99 0%, ${color} 100%)`
                            }}
                          />
                        </div>
                        <span className="ig-top-city-row__value">{cityPercentage.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>

                {/* Botão Ver mais */}
                <div style={{ padding: '16px', borderTop: '1px solid #e5e7eb' }}>
                  <button
                    onClick={handleShowCitiesDetail}
                    style={{
                      width: '100%',
                      padding: '10px 16px',
                      background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      boxShadow: '0 2px 8px rgba(59, 130, 246, 0.25)'
                    }}
                  >
                    Ver mais
                  </button>
                </div>
              </div>
            ) : (
              <div className="ig-analytics-card__body">
                <DataState state={audienceStatusState} label={audienceStatusMessage} size="sm" />
              </div>
            )}
          </section>
        </div>

        {/* Palavras-chave e Hashtags - Largura Total */}
        <div className="ig-analytics-grid ig-analytics-grid--stack">
          <section className="ig-card-white ig-analytics-card ig-analytics-card--large">
            <div className="ig-analytics-card__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <h4 style={{ margin: 0 }}>
                Palavras chaves mais comentadas
                <InfoTooltip text="Palavras mais frequentes nos comentários das publicações." />
              </h4>
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
                  externalPanelMode={true}
                  onWordClick={handleWordCloudWordClick}
                />
            </div>
          </section>
        </div>
              </>
            )}
          </div>
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
                  <XAxis
                    type="number"
                    tick={{ fill: '#111827' }}
                    allowDecimals={false}
                    tickFormatter={(value) => formatCompactNumber(value)}
                  />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fill: '#111827' }} />
                  <Tooltip
                    content={(
                      <CustomChartTooltip
                        labelFormatter={(value) => String(value || "")}
                        labelMap={{ value: "Ocorrências" }}
                        valueFormatter={(v) => `: ${formatTooltipNumber(v)}`}
                      />
                    )}
                  />
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

      {/* Modal de visualização de post */}
      <InstagramPostModal
        post={selectedPost}
        onClose={() => setSelectedPost(null)}
        accountInfo={accountInfo}
      />
    </div>
  );
}
