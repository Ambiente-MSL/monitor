import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link, useLocation, useOutletContext } from "react-router-dom";
import { differenceInCalendarDays, endOfDay, startOfDay, subDays } from "date-fns";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  Sector,
} from "recharts";
import {
  BarChart3,
  FileText,
  Facebook,
  Instagram as InstagramIcon,
  Heart,
  MessageCircle,
  Share2,
  X,
  Settings,
  Shield,
  Users,
  ThumbsUp,
  UserCheck,
  Newspaper,
  TrendingDown,
  TrendingUp,
  Hash,
} from "lucide-react";
import useQueryState from "../hooks/useQueryState";
import { useAccounts } from "../context/AccountsContext";
import { useAuth } from "../context/AuthContext";
import {
  getDashboardCache,
  invalidateCacheForAccount,
  makeCacheKey,
  mergeDashboardCache,
  setDashboardCache,
} from "../lib/dashboardCache";
import DataState from "../components/DataState";
import CustomChartTooltip from "../components/CustomChartTooltip";
import WordCloudCard from "../components/WordCloudCard";
import DateRangeIndicator from "../components/DateRangeIndicator";
import InfoTooltip from "../components/InfoTooltip";
import { fetchWithTimeout, isTimeoutError } from "../lib/fetchWithTimeout";
import { formatChartDate, formatCompactNumber, formatTooltipNumber } from "../lib/chartFormatters";
import { normalizeSyncInfo } from "../lib/syncInfo";
const API_BASE_URL = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");

const FB_TOPBAR_PRESETS = [
  { id: "7d", label: "7 dias", days: 7 },
  { id: "1m", label: "30 dias", days: 30 },
  { id: "3m", label: "90 dias", days: 90 },
  { id: "6m", label: "180 dias", days: 180 },
  { id: "1y", label: "365 dias", days: 365 },
];
const DEFAULT_FACEBOOK_RANGE_DAYS = 7;
const FB_METRICS_TIMEOUT_MS = 20000;
const FB_METRICS_RETRY_TIMEOUT_MS = 30000;
const WORDCLOUD_DETAILS_PAGE_SIZE = 10;
const FB_DEFAULT_TIMEOUT_MS = 15000;
const FB_POSTS_INITIAL_LIMIT = 8;
const FB_POSTS_DEFER_MS = 400;
const FB_AUDIENCE_DEFER_MS = 1000;
const FB_WORDCLOUD_DEFER_MS = 1600;
const FB_FOLLOWERS_DEFER_MS = 1200;

const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];
const DEFAULT_WEEKLY_FOLLOWERS = [3, 4, 5, 6, 7, 5, 4];
const DEFAULT_WEEKLY_POSTS = [2, 3, 4, 5, 6, 4, 3];


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
const formatAxisDate = (value) => formatChartDate(value, "short");

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

const extractNumber = (value, fallback = 0) => {
  if (value === null || value === undefined) return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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

const formatDurationSeconds = (seconds) => {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return "00:00:00";
  const rounded = Math.round(total);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
};

const buildWeeklyPattern = (values) => {
  const max = Math.max(...values, 0);
  return values.map((value, index) => ({
    label: WEEKDAY_LABELS[index] || "",
    value,
    percentage: max > 0 ? Math.round((value / max) * 100) : 0,
    active: max > 0 && value === max,
  }));
};

const parseQueryDate = (value) => {
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toLocalDateString = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return undefined;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const renderActiveEngagementShape = (props) => {
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
        style={{ filter: 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15))', transition: 'all 0.3s ease' }}
      />
    </g>
  );
};

export default function FacebookDashboard() {
  const outlet = useOutletContext() || {};
  const { setTopbarConfig, resetTopbarConfig } = outlet;
  const location = useLocation();
  const { apiFetch, token } = useAuth();
  const { accounts, loading: accountsLoading } = useAccounts();
  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  );
  const availableAccounts = accounts;
  const [getQuery, setQuery] = useQueryState({ account: "" });
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
    () => accountConfig?.facebookPageId || accountConfig?.id || "",
    [accountConfig?.id, accountConfig?.facebookPageId],
  );

  const [coverImage, setCoverImage] = useState(null);
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverError, setCoverError] = useState("");
  const [pageInfo, setPageInfo] = useState(null);
  const [followersOverride, setFollowersOverride] = useState(null);

  const sinceParam = getQuery("since");
  const untilParam = getQuery("until");
  const pageCacheKey = useMemo(
    () => makeCacheKey({
      page: "facebook",
      endpoint: "page-info",
      accountId: accountSnapshotKey || "none",
      since: sinceParam || "auto",
      until: untilParam || "auto",
    }),
    [accountSnapshotKey, sinceParam, untilParam],
  );
  const overviewCacheKey = useMemo(
    () => makeCacheKey({
      page: "facebook",
      endpoint: "overview",
      accountId: accountSnapshotKey || "none",
      since: sinceParam || "auto",
      until: untilParam || "auto",
    }),
    [accountSnapshotKey, sinceParam, untilParam],
  );
  const fbPostsCacheKey = useMemo(
    () => makeCacheKey({
      page: "facebook",
      endpoint: "posts",
      accountId: accountSnapshotKey || "none",
      since: sinceParam || "auto",
      until: untilParam || "auto",
      extra: { limit: FB_POSTS_INITIAL_LIMIT },
    }),
    [accountSnapshotKey, sinceParam, untilParam],
  );
  const followersCacheKey = useMemo(
    () => makeCacheKey({
      page: "facebook",
      endpoint: "followers",
      accountId: accountSnapshotKey || "none",
    }),
    [accountSnapshotKey],
  );
  const audienceCacheKey = useMemo(
    () => makeCacheKey({
      page: "facebook",
      endpoint: "audience",
      accountId: accountSnapshotKey || "none",
    }),
    [accountSnapshotKey],
  );
  const sinceDate = useMemo(() => parseQueryDate(sinceParam), [sinceParam]);
  const untilDate = useMemo(() => parseQueryDate(untilParam), [untilParam]);
  const now = useMemo(() => new Date(), []);
  const defaultEnd = useMemo(() => endOfDay(subDays(startOfDay(now), 1)), [now]);

  const activePreset = useMemo(() => {
    if (!sinceDate || !untilDate) return "custom";
    const diff = differenceInCalendarDays(endOfDay(untilDate), startOfDay(sinceDate)) + 1;
    const preset = FB_TOPBAR_PRESETS.find((item) => item.days === diff);
    return preset?.id ?? "custom";
  }, [sinceDate, untilDate]);

  const handlePresetSelect = useCallback(
    (presetId) => {
      const preset = FB_TOPBAR_PRESETS.find((item) => item.id === presetId);
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

  const selectedRange = useMemo(() => {
    const until = untilDate ? endOfDay(untilDate) : defaultEnd;
    const since = sinceDate
      ? startOfDay(sinceDate)
      : startOfDay(subDays(until, DEFAULT_FACEBOOK_RANGE_DAYS - 1));
    return { since, until };
  }, [defaultEnd, sinceDate, untilDate]);
  const sinceIso = useMemo(() => toLocalDateString(selectedRange.since), [selectedRange.since]);
  const untilIso = useMemo(() => toLocalDateString(selectedRange.until), [selectedRange.until]);

  useEffect(() => {
    if (sinceParam && untilParam) return;
    const defaultPreset = FB_TOPBAR_PRESETS.find((preset) => preset.id === "7d") || FB_TOPBAR_PRESETS[0];
    const endDate = defaultEnd;
    const startDate = startOfDay(subDays(endDate, (defaultPreset?.days ?? DEFAULT_FACEBOOK_RANGE_DAYS) - 1));
    setQuery({
      since: toUnixSeconds(startDate),
      until: toUnixSeconds(endDate),
    });
  }, [defaultEnd, setQuery, sinceParam, untilParam]);

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

  const [overviewSync, setOverviewSync] = useState(() => normalizeSyncInfo(null));
  const [activeEngagementIndex, setActiveEngagementIndex] = useState(-1);
  const [showContentDetails, setShowContentDetails] = useState(false);
  const [showWordCloudDetail, setShowWordCloudDetail] = useState(false);
  const [selectedWordCloud, setSelectedWordCloud] = useState(null);
  const [wordCloudDetails, setWordCloudDetails] = useState(null);
  const [wordCloudDetailsLoading, setWordCloudDetailsLoading] = useState(false);
  const [wordCloudDetailsError, setWordCloudDetailsError] = useState("");
  const [wordCloudDetailsLoadingMore, setWordCloudDetailsLoadingMore] = useState(false);
  const [wordCloudDetailsPage, setWordCloudDetailsPage] = useState(1);

  useEffect(() => {
    if (!setTopbarConfig) return undefined;
    setTopbarConfig({
      hidden: false,
      presets: FB_TOPBAR_PRESETS,
      selectedPreset: activePreset,
      onPresetSelect: handlePresetSelect,
      onDateChange: handleDateChange,
    });
    return () => resetTopbarConfig?.();
  }, [
    activePreset,
    handleDateChange,
    handlePresetSelect,
    overviewSync,
    resetTopbarConfig,
    setTopbarConfig,
  ]);

  // Painel de detalhes agora é inline (não overlay), não precisa bloquear scroll

  // --- WordCloud detail panel logic (same pattern as Instagram) ---
  const buildFbWordCloudDetailsUrl = useCallback((word, offset = 0) => {
    if (!accountConfig?.facebookPageId || !word) return null;
    const params = new URLSearchParams({
      pageId: accountConfig.facebookPageId,
      word,
      limit: String(WORDCLOUD_DETAILS_PAGE_SIZE),
      offset: String(offset),
    });
    if (sinceIso) params.set("since", sinceIso);
    if (untilIso) params.set("until", untilIso);
    return `${API_BASE_URL}/api/facebook/comments/search?${params.toString()}`;
  }, [accountConfig?.facebookPageId, sinceIso, untilIso]);

  const fetchWordCloudDetails = useCallback(async (word, offset = 0) => {
    const url = buildFbWordCloudDetailsUrl(word, offset);
    if (!url) return null;
    return apiFetch(url);
  }, [apiFetch, buildFbWordCloudDetailsUrl]);

  const handleWordCloudWordClick = useCallback((word, count) => {
    setShowContentDetails(false);
    setSelectedWordCloud({ word, count });
    setShowWordCloudDetail(true);
    setWordCloudDetails(null);
    setWordCloudDetailsError("");
    setWordCloudDetailsLoading(true);
    setWordCloudDetailsLoadingMore(false);
    setWordCloudDetailsPage(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });

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
    for (let i = current - 1; i <= current + 1; i++) pages.push(i);
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

  const buildFacebookProfileUrl = (username) => {
    const normalized = String(username || "").trim().replace(/^@+/, "");
    if (!normalized) return null;
    return `https://www.facebook.com/${encodeURIComponent(normalized)}`;
  };

  const handleOpenContentDetails = useCallback(() => {
    closeWordCloudDetail();
    setShowContentDetails(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [closeWordCloudDetail]);

  const [pageMetrics, setPageMetrics] = useState([]);
  const [pageError, setPageError] = useState("");
  const [netFollowersSeries, setNetFollowersSeries] = useState([]);
  const [reachSeries, setReachSeries] = useState([]);
  const [contentGrowthSeries, setContentGrowthSeries] = useState([]);
  const [wordCloudEnabled, setWordCloudEnabled] = useState(false);

  const [overviewSnapshot, setOverviewSnapshot] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewFetching, setOverviewFetching] = useState(false);
  const [overviewSource, setOverviewSource] = useState(null);
  const [fbPosts, setFbPosts] = useState([]);
  const [fbPostsLoading, setFbPostsLoading] = useState(false);
  const [fbPostsFetching, setFbPostsFetching] = useState(false);
  const [fbPostsError, setFbPostsError] = useState("");
  const [audienceData, setAudienceData] = useState(null);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audienceFetching, setAudienceFetching] = useState(false);
  const [audienceError, setAudienceError] = useState("");
  const overviewRequestIdRef = useRef(0);
  const postsRequestIdRef = useRef(0);
  const followersRequestIdRef = useRef(0);
  const audienceRequestIdRef = useRef(0);
  const lastCacheAccountKeyRef = useRef("");

  const activeSnapshot = useMemo(
    () => (overviewSnapshot?.accountId === accountSnapshotKey && accountSnapshotKey ? overviewSnapshot : null),
    [accountSnapshotKey, overviewSnapshot],
  );

  useEffect(() => {
    setWordCloudEnabled(false);
    if (!accountConfig?.facebookPageId || !sinceIso || !untilIso) {
      return () => {};
    }
    const timer = setTimeout(() => {
      setWordCloudEnabled(true);
    }, FB_WORDCLOUD_DEFER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [accountConfig?.facebookPageId, sinceIso, untilIso]);

  useEffect(() => {
    const previousKey = lastCacheAccountKeyRef.current;
    if (previousKey && previousKey !== accountSnapshotKey) {
      invalidateCacheForAccount(previousKey, "facebook");
    }
    lastCacheAccountKeyRef.current = accountSnapshotKey || "";
  }, [accountSnapshotKey]);

  useEffect(() => {
    const cachedPage = getDashboardCache(pageCacheKey);
    if (cachedPage) {
      setPageInfo(cachedPage.pageInfo || null);
      setCoverImage(cachedPage.coverImage ?? null);
      setCoverError("");
      setCoverLoading(false);
    } else {
      setPageInfo(null);
      setCoverImage(null);
      setCoverError("");
      setCoverLoading(false);
    }

    const cachedFollowers = getDashboardCache(followersCacheKey);
    if (cachedFollowers && cachedFollowers.value !== undefined) {
      setFollowersOverride(cachedFollowers.value);
    } else {
      setFollowersOverride(null);
    }

    const cachedOverview = getDashboardCache(overviewCacheKey);
    if (cachedOverview) {
      setPageMetrics(Array.isArray(cachedOverview.pageMetrics) ? cachedOverview.pageMetrics : []);
      setNetFollowersSeries(Array.isArray(cachedOverview.netFollowersSeries) ? cachedOverview.netFollowersSeries : []);
      setReachSeries(Array.isArray(cachedOverview.reachSeries) ? cachedOverview.reachSeries : []);
      setContentGrowthSeries(
        Array.isArray(cachedOverview.contentGrowthSeries) ? cachedOverview.contentGrowthSeries : [],
      );
      setOverviewSnapshot(null);
      setOverviewSource(cachedOverview.overviewSource || null);
      setOverviewLoading(false);
      setPageError("");
    } else {
      setPageMetrics([]);
      setNetFollowersSeries([]);
      setReachSeries([]);
      setContentGrowthSeries([]);
      setOverviewSnapshot(null);
      setOverviewSource(null);
      setOverviewLoading(false);
      setPageError("");
    }

    const cachedPosts = getDashboardCache(fbPostsCacheKey);
    if (cachedPosts) {
      setFbPosts(Array.isArray(cachedPosts.posts) ? cachedPosts.posts : []);
      setFbPostsError("");
      setFbPostsLoading(false);
    } else {
      setFbPosts([]);
      setFbPostsError("");
      setFbPostsLoading(false);
    }

    const cachedAudience = getDashboardCache(audienceCacheKey);
    if (cachedAudience) {
      setAudienceData(cachedAudience);
      setAudienceError("");
      setAudienceLoading(false);
    } else {
      setAudienceData(null);
      setAudienceError("");
      setAudienceLoading(false);
    }
  }, [pageCacheKey, overviewCacheKey, fbPostsCacheKey, followersCacheKey, audienceCacheKey]);

  useEffect(() => {
    setOverviewSync(normalizeSyncInfo(null));
    if (!accountConfig?.facebookPageId) {
      setPageMetrics([]);
      setNetFollowersSeries([]);
      setReachSeries([]);
      setContentGrowthSeries([]);
      setOverviewSource(null);
      setOverviewLoading(false);
      setOverviewFetching(false);
      setPageError("Pagina do Facebook nao configurada.");
      return () => {};
    }

    const requestId = (overviewRequestIdRef.current || 0) + 1;
    overviewRequestIdRef.current = requestId;

    const cachedPage = getDashboardCache(pageCacheKey);
    const cachedOverview = sinceParam && untilParam ? getDashboardCache(overviewCacheKey) : null;
    const hasCachedOverview = Boolean(cachedOverview);
    if (cachedOverview?.sync) {
      setOverviewSync(cachedOverview.sync);
    }

    let cancelled = false;
    const isStale = () => cancelled || overviewRequestIdRef.current !== requestId;

    const loadPageInfo = async () => {
      try {
        const resp = await apiFetch(
          `/api/facebook/page-info?pageId=${encodeURIComponent(accountConfig.facebookPageId)}`,
          { timeoutMs: FB_DEFAULT_TIMEOUT_MS },
        );
        if (isStale()) return;
        setPageInfo(resp?.page || null);
        mergeDashboardCache(pageCacheKey, { pageInfo: resp?.page || null });
      } catch (err) {
        if (isStale()) return;
        setPageInfo(null);
      }
    };
    const loadCover = async () => {
      setCoverLoading(true);
      setCoverError("");
      try {
        const resp = await apiFetch(
          `/api/covers?platform=facebook&account_id=${encodeURIComponent(accountConfig.facebookPageId)}`,
          { timeoutMs: FB_DEFAULT_TIMEOUT_MS },
        );
        if (isStale()) return;
        const cover = resp?.cover?.url || resp?.cover?.storage_url || null;
        setCoverImage(cover);
        mergeDashboardCache(pageCacheKey, { coverImage: cover });
      } catch (err) {
        if (isStale()) return;
        setCoverImage(null);
        setCoverError(err?.message || "Nao foi possivel carregar a capa.");
      } finally {
        if (!isStale()) {
          setCoverLoading(false);
        }
      }
    };

    const shouldLoadPageInfo = !cachedPage || cachedPage.pageInfo === undefined;
    const shouldLoadCover = !cachedPage || cachedPage.coverImage === undefined;
    if (shouldLoadPageInfo) {
      loadPageInfo();
    }
    if (shouldLoadCover) {
      loadCover();
    }

    if (!sinceParam || !untilParam) {
      setOverviewSource(null);
      setOverviewLoading(true);
      setOverviewFetching(false);
      return () => { cancelled = true; };
    }

    if (cachedOverview) {
      setPageMetrics(Array.isArray(cachedOverview.pageMetrics) ? cachedOverview.pageMetrics : []);
      setNetFollowersSeries(Array.isArray(cachedOverview.netFollowersSeries) ? cachedOverview.netFollowersSeries : []);
      setReachSeries(Array.isArray(cachedOverview.reachSeries) ? cachedOverview.reachSeries : []);
      setContentGrowthSeries(
        Array.isArray(cachedOverview.contentGrowthSeries) ? cachedOverview.contentGrowthSeries : [],
      );
      setOverviewSource(cachedOverview.overviewSource || null);
      setOverviewLoading(false);
      setPageError("");
    }

    const controller = new AbortController();
    const shouldBlockUi = !hasCachedOverview;

    const loadOverviewMetrics = async () => {
      if (shouldBlockUi) {
        setOverviewLoading(true);
      } else {
        setOverviewLoading(false);
      }
      setOverviewFetching(true);
      setPageError("");
      try {
        const params = new URLSearchParams();
        params.set("pageId", accountConfig.facebookPageId);
        params.set("since", sinceParam);
        params.set("until", untilParam);
        params.set("lite", "1");
        const url = `${API_BASE_URL}/api/facebook/metrics?${params.toString()}`;
        const fetchMetrics = async (timeoutMs) => {
          const response = await fetchWithTimeout(
            url,
            { signal: controller.signal, headers: authHeaders },
            timeoutMs,
          );
          const raw = await response.text();
          const json = safeParseJson(raw) || {};
          if (!response.ok) {
            throw new Error(describeApiError(json, "Falha ao carregar metricas do Facebook."));
          }
          return json;
        };
        let json;
        try {
          json = await fetchMetrics(FB_METRICS_TIMEOUT_MS);
        } catch (err) {
          if (isTimeoutError(err) && !controller.signal.aborted) {
            json = await fetchMetrics(FB_METRICS_RETRY_TIMEOUT_MS);
          } else {
            throw err;
          }
        }
        if (isStale()) return;
        const syncInfo = normalizeSyncInfo(json.meta || null);
        setOverviewSync(syncInfo);
        const fetchedMetrics = Array.isArray(json.metrics) ? json.metrics : [];
        const fetchedFollowersSeries = Array.isArray(json.net_followers_series) ? json.net_followers_series : [];
        const reachSeriesPayload = Array.isArray(json.reach_timeseries)
          ? json.reach_timeseries
          : Array.isArray(json.page_overview?.reach_timeseries)
            ? json.page_overview.reach_timeseries
            : [];
        const contentGrowthSeriesPayload = Array.isArray(json.engagement_timeseries)
          ? json.engagement_timeseries
          : Array.isArray(json.page_overview?.engagement_timeseries)
            ? json.page_overview.engagement_timeseries
            : [];
        setPageMetrics(fetchedMetrics);
        setNetFollowersSeries(fetchedFollowersSeries);
        setReachSeries(reachSeriesPayload);
        setContentGrowthSeries(contentGrowthSeriesPayload);
        setOverviewSource(json);
        mergeDashboardCache(overviewCacheKey, {
          pageMetrics: fetchedMetrics,
          netFollowersSeries: fetchedFollowersSeries,
          reachSeries: reachSeriesPayload,
          contentGrowthSeries: contentGrowthSeriesPayload,
          overviewSource: json,
          followersOverride,
          sync: syncInfo,
        });
      } catch (err) {
        if (controller.signal.aborted || isStale()) return;
        console.error(err);
        if (shouldBlockUi) {
          setPageMetrics([]);
          setNetFollowersSeries([]);
          setReachSeries([]);
          setContentGrowthSeries([]);
          setOverviewSource(null);
          setPageError(
            isTimeoutError(err)
              ? "Tempo esgotado ao carregar metricas do Facebook."
              : err.message || "Nao foi possivel carregar as metricas do Facebook.",
          );
        } else {
          setPageError("");
        }
      } finally {
        if (isStale()) return;
        setOverviewLoading(false);
        setOverviewFetching(false);
      }
    };

    loadOverviewMetrics();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accountConfig?.facebookPageId, sinceParam, untilParam, apiFetch, pageCacheKey, overviewCacheKey, authHeaders]);

  useEffect(() => {
    if (!accountConfig?.facebookPageId) {
      setFollowersOverride(null);
      return () => {};
    }

    const hasFollowersMetric = Array.isArray(pageMetrics)
      && pageMetrics.some((metric) => (
        metric?.key === "followers_total" && Number.isFinite(Number(metric?.value))
      ));
    if (hasFollowersMetric) {
      return () => {};
    }

    const cachedFollowers = getDashboardCache(followersCacheKey);
    if (cachedFollowers && cachedFollowers.value !== undefined && cachedFollowers.value !== null) {
      return () => {};
    }

    const requestId = (followersRequestIdRef.current || 0) + 1;
    followersRequestIdRef.current = requestId;
    let cancelled = false;
    const isStale = () => cancelled || followersRequestIdRef.current !== requestId;

    const loadFollowers = async () => {
      try {
        const params = new URLSearchParams();
        params.set("pageId", accountConfig.facebookPageId);
        const resp = await apiFetch(
          `/api/facebook/followers?${params.toString()}`,
          { timeoutMs: FB_DEFAULT_TIMEOUT_MS },
        );
        if (isStale()) return;
        const val = resp?.followers?.value;
        if (val !== undefined && val !== null) {
          const followersValue = Number(val);
          setFollowersOverride(followersValue);
          setDashboardCache(followersCacheKey, { value: followersValue });
        }
      } catch (err) {
        if (isStale()) return;
        // keep existing counts if fetch fails
      }
    };

    const delayTimer = setTimeout(() => {
      if (isStale()) return;
      loadFollowers();
    }, FB_FOLLOWERS_DEFER_MS);

    return () => {
      cancelled = true;
      clearTimeout(delayTimer);
    };
  }, [accountConfig?.facebookPageId, apiFetch, followersCacheKey, pageMetrics]);

  useEffect(() => {
    if (!accountConfig?.facebookPageId) {
      setFbPosts([]);
      setFbPostsLoading(false);
      setFbPostsFetching(false);
      setFbPostsError("Pagina do Facebook nao configurada.");
      return () => {};
    }
    if (!sinceParam || !untilParam) {
      setFbPosts([]);
      setFbPostsLoading(false);
      setFbPostsFetching(false);
      return () => {};
    }

    const cachedPosts = getDashboardCache(fbPostsCacheKey);
    const hasCachedPosts = Boolean(cachedPosts);
    if (cachedPosts) {
      setFbPosts(Array.isArray(cachedPosts.posts) ? cachedPosts.posts : []);
      setFbPostsLoading(false);
      setFbPostsError("");
    }

    const requestId = (postsRequestIdRef.current || 0) + 1;
    postsRequestIdRef.current = requestId;
    let cancelled = false;
    const shouldBlockUi = !hasCachedPosts;
    const requestLimit = FB_POSTS_INITIAL_LIMIT;

    const loadPosts = async () => {
      if (shouldBlockUi) {
        setFbPostsLoading(true);
      } else {
        setFbPostsLoading(false);
      }
      setFbPostsFetching(true);
      setFbPostsError("");
      try {
        const params = new URLSearchParams();
        params.set("pageId", accountConfig.facebookPageId);
        params.set("since", sinceParam);
        params.set("until", untilParam);
        params.set("limit", String(requestLimit));
        const resp = await apiFetch(
          `/api/facebook/posts?${params.toString()}`,
          { timeoutMs: FB_DEFAULT_TIMEOUT_MS },
        );
        if (cancelled || postsRequestIdRef.current !== requestId) return;
        const posts = Array.isArray(resp?.posts) ? resp.posts : [];
        setFbPosts(posts);
        setDashboardCache(fbPostsCacheKey, { posts });
      } catch (err) {
        if (cancelled || postsRequestIdRef.current !== requestId) return;
        if (shouldBlockUi) {
          setFbPosts([]);
        }
        const rawMessage = err?.message || "";
        const friendlyMessage = rawMessage.includes("<")
          ? "Nao foi possivel carregar os posts (erro 502)."
          : rawMessage;
        setFbPostsError(friendlyMessage || "Nao foi possivel carregar os posts.");
      } finally {
        if (cancelled || postsRequestIdRef.current !== requestId) return;
        setFbPostsLoading(false);
        setFbPostsFetching(false);
      }
    };

    const delayTimer = setTimeout(() => {
      if (cancelled || postsRequestIdRef.current !== requestId) return;
      loadPosts();
    }, hasCachedPosts ? FB_POSTS_DEFER_MS : 0);

    return () => {
      cancelled = true;
      clearTimeout(delayTimer);
    };
  }, [accountConfig?.facebookPageId, apiFetch, sinceParam, untilParam, fbPostsCacheKey]);

  useEffect(() => {
    if (!accountConfig?.facebookPageId) {
      setAudienceData(null);
      setAudienceError("Pagina do Facebook nao configurada.");
      setAudienceLoading(false);
      setAudienceFetching(false);
      return () => {};
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
    const shouldBlockUi = !hasCached;
    let cancelled = false;

    if (shouldBlockUi) {
      setAudienceData(null);
      setAudienceLoading(true);
    } else {
      setAudienceLoading(false);
    }
    setAudienceError("");

    const params = new URLSearchParams();
    params.set("pageId", accountConfig.facebookPageId);
    const url = `${API_BASE_URL}/api/facebook/audience?${params.toString()}`;

    const runFetch = async () => {
      if (cancelled || audienceRequestIdRef.current !== requestId) return;
      setAudienceFetching(true);
      try {
        const resp = await fetchWithTimeout(
          url,
          { signal: controller.signal, headers: authHeaders },
          FB_DEFAULT_TIMEOUT_MS,
        );
        const text = await resp.text();
        const json = safeParseJson(text) || {};
        if (!resp.ok) {
          throw new Error(describeApiError(json, "Nao foi possivel carregar a audiencia."));
        }
        if (cancelled || audienceRequestIdRef.current !== requestId) return;
        setAudienceData(json);
        setDashboardCache(audienceCacheKey, json);
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
        setAudienceLoading(false);
        setAudienceFetching(false);
      }
    };

    const delayTimer = setTimeout(
      runFetch,
      hasCached ? FB_AUDIENCE_DEFER_MS : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(delayTimer);
      controller.abort();
    };
  }, [accountConfig?.facebookPageId, audienceCacheKey, authHeaders]);
  const avatarUrl = useMemo(
    () => pageInfo?.picture_url || accountConfig?.profilePictureUrl || accountConfig?.pagePictureUrl || "",
    [pageInfo?.picture_url, accountConfig?.pagePictureUrl, accountConfig?.profilePictureUrl],
  );

  // Cover style is now inline in the JSX (same pattern as Instagram)

  const handleCoverUpload = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file || !accountConfig?.facebookPageId) return;
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

      const resp = await apiFetch("/api/covers", {
        method: "POST",
        body: {
          platform: "facebook",
          account_id: accountConfig.facebookPageId,
          data_url: dataUrl,
          content_type: file.type,
          size_bytes: file.size,
        },
      });
      const newCover = resp?.cover?.url || resp?.cover?.storage_url || dataUrl;
      setCoverImage(newCover);
      mergeDashboardCache(pageCacheKey, { coverImage: newCover });
    } catch (err) {
      setCoverError(err?.message || "Não foi possível salvar a capa.");
    } finally {
      setCoverLoading(false);
    }
  }, [accountConfig?.facebookPageId, apiFetch, pageCacheKey]);

  const handleCoverRemove = useCallback(async () => {
    if (!accountConfig?.facebookPageId) return;
    setCoverLoading(true);
    setCoverError("");
    try {
      await apiFetch(`/api/covers?platform=facebook&account_id=${encodeURIComponent(accountConfig.facebookPageId)}`, {
        method: "DELETE",
      });
      setCoverImage(null);
      mergeDashboardCache(pageCacheKey, { coverImage: null });
    } catch (err) {
      setCoverError(err?.message || "Não foi possível remover a capa.");
    } finally {
      setCoverLoading(false);
    }
  }, [accountConfig?.facebookPageId, apiFetch, pageCacheKey]);

  const pageMetricsByKey = useMemo(() => {
    const map = {};
    pageMetrics.forEach((metric) => {
      if (metric?.key) map[metric.key] = metric;
    });
    return map;
  }, [pageMetrics]);

  // Calculate overview metrics
  const totalFollowers = Number.isFinite(followersOverride) ? followersOverride : null;
  const reachValue = extractNumber(
    pageMetricsByKey.reach?.value,
    extractNumber(overviewSource?.reach, null),
  );
  const newFollowers = extractNumber(
    pageMetricsByKey.followers_gained?.value,
    extractNumber(overviewSource?.page_overview?.followers_gained, 0),
  );
  const postsCount = extractNumber(
    pageMetricsByKey.content_activity?.value,
    extractNumber(overviewSource?.page_overview?.content_activity, 0),
  );
  const engagementValue = extractNumber(
    pageMetricsByKey.post_engagement_total?.value,
    extractNumber(overviewSource?.engagement?.total, 0),
  );
  const pageViewsValue = extractNumber(
    pageMetricsByKey.page_views?.value,
    extractNumber(overviewSource?.page_overview?.page_views, 0),
  );
  const clicksValue = extractNumber(
    pageMetricsByKey.cta_clicks?.value ?? pageMetricsByKey.post_clicks?.value,
    extractNumber(overviewSource?.page_overview?.cta_clicks, 0),
  );
  const reachMetricValue = reachValue;
  const followersMetricValue = totalFollowers;

  const overviewMetrics = useMemo(
    () => ({
      followers: followersMetricValue ?? activeSnapshot?.followers ?? 0,
      reach: activeSnapshot?.reach ?? reachMetricValue ?? 0,
      engagement: engagementValue ?? 0,
      pageViews: pageViewsValue ?? 0,
    }),
    [
      activeSnapshot,
      clicksValue,
      engagementValue,
      followersMetricValue,
      pageViewsValue,
      reachMetricValue,
    ],
  );
  const reachDeltaPct = useMemo(
    () => extractNumber(pageMetricsByKey.reach?.deltaPct, null),
    [pageMetricsByKey.reach?.deltaPct],
  );
  const reachDeltaDirection = useMemo(() => getTrendDirection(reachDeltaPct), [reachDeltaPct]);
  const reachDeltaDisplay = useMemo(() => formatDeltaPercent(reachDeltaPct), [reachDeltaPct]);
  const engagementDeltaPct = useMemo(
    () => extractNumber(pageMetricsByKey.post_engagement_total?.deltaPct, null),
    [pageMetricsByKey.post_engagement_total?.deltaPct],
  );
  const engagementDeltaDirection = useMemo(() => getTrendDirection(engagementDeltaPct), [engagementDeltaPct]);
  const engagementDeltaDisplay = useMemo(() => formatDeltaPercent(engagementDeltaPct), [engagementDeltaPct]);
  const pageViewsDeltaPct = useMemo(
    () => extractNumber(pageMetricsByKey.page_views?.deltaPct, null),
    [pageMetricsByKey.page_views?.deltaPct],
  );
  const pageViewsDeltaDirection = useMemo(() => getTrendDirection(pageViewsDeltaPct), [pageViewsDeltaPct]);
  const pageViewsDeltaDisplay = useMemo(() => formatDeltaPercent(pageViewsDeltaPct), [pageViewsDeltaPct]);

  const fbTopPosts = useMemo(() => {
    if (!Array.isArray(fbPosts) || !fbPosts.length) return [];
    return [...fbPosts]
      .sort((a, b) => {
        const aTime = a?.timestamp ? new Date(a.timestamp).getTime() : 0;
        const bTime = b?.timestamp ? new Date(b.timestamp).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 6);
  }, [fbPosts]);

  const reachPeriodLabel = "Alcance";

  const followersDailyDisplay = useMemo(() => (
    Number.isFinite(overviewMetrics.followersDaily)
      ? overviewMetrics.followersDaily.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      : "--"
  ), [overviewMetrics.followersDaily]);

  const engagementRateValue = useMemo(() => {
    if (!Number.isFinite(engagementValue) || engagementValue <= 0) return null;
    if (!Number.isFinite(reachMetricValue) || reachMetricValue <= 0) return null;
    return (engagementValue / reachMetricValue) * 100;
  }, [engagementValue, reachMetricValue]);
  const engagementRateDisplay = useMemo(() => (
    engagementRateValue != null
      ? `${engagementRateValue.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}%`
      : "--"
  ), [engagementRateValue]);

  const engagedUsersValue = extractNumber(
    pageMetricsByKey.engaged_users?.value ?? pageMetricsByKey.post_engaged_users?.value,
    extractNumber(overviewSource?.post_engaged, null),
  );
  const reactionsTotalValue = extractNumber(
    pageMetricsByKey.post_engagement_total?.breakdown?.reactions
      ?? overviewSource?.breakdowns?.engagement?.reactions,
    null,
  );
  const totalFansValue = extractNumber(
    pageMetricsByKey.followers_total?.value,
    extractNumber(overviewSource?.page_overview?.followers_total, followersOverride),
  );
  const netFollowersMetricValue = extractNumber(
    pageMetricsByKey.net_followers?.value,
    extractNumber(overviewSource?.page_overview?.net_followers, null),
  );
  const unfollowedMetricValue = extractNumber(
    pageMetricsByKey.followers_lost?.value,
    extractNumber(overviewSource?.page_overview?.followers_lost, null),
  );
  // Engagement breakdown por tipo de interacao
  const engagementBreakdown = useMemo(() => {
    const metric = pageMetricsByKey.post_engagement_total;
    const metricBreakdown = metric?.breakdown || {};
    const payloadBreakdown = overviewSource?.breakdowns?.engagement || {};
    const overviewEngagement = overviewSource?.engagement || {};
    const postsSource = Array.isArray(fbPosts) ? fbPosts : [];

    const postsTotals = postsSource.reduce(
      (acc, post) => ({
        reactions: acc.reactions + extractNumber(post?.reactions, 0),
        shares: acc.shares + extractNumber(post?.shares, 0),
        comments: acc.comments + extractNumber(post?.comments, 0),
      }),
      { reactions: 0, shares: 0, comments: 0 },
    );

    const pickFirstMeaningful = (...candidates) => {
      let fallbackValue = null;
      for (const candidate of candidates) {
        if (candidate === null || candidate === undefined) continue;
        const numeric = Number(candidate);
        if (!Number.isFinite(numeric)) continue;
        if (numeric > 0) return numeric;
        if (fallbackValue === null) fallbackValue = numeric;
      }
      return fallbackValue;
    };

    const reactionsValue = pickFirstMeaningful(
      metricBreakdown.reactions,
      payloadBreakdown.reactions,
      overviewEngagement.reactions,
      pageMetricsByKey.reactions?.value,
      postsSource.length ? postsTotals.reactions : null,
    );
    const sharesValue = pickFirstMeaningful(
      metricBreakdown.shares,
      payloadBreakdown.shares,
      overviewEngagement.shares,
      pageMetricsByKey.shares?.value,
      postsSource.length ? postsTotals.shares : null,
    );
    const commentsValue = pickFirstMeaningful(
      metricBreakdown.comments,
      payloadBreakdown.comments,
      overviewEngagement.comments,
      pageMetricsByKey.comments?.value,
      postsSource.length ? postsTotals.comments : null,
    );

    const rows = [
      {
        key: "reactions",
        name: "Reações",
        color: "#3b82f6",
        value: Math.max(0, Math.round(extractNumber(reactionsValue, 0))),
      },
      {
        key: "shares",
        name: "Compartilhamentos",
        color: "#10b981",
        value: Math.max(0, Math.round(extractNumber(sharesValue, 0))),
      },
      {
        key: "comments",
        name: "Comentários",
        color: "#fbbf24",
        value: Math.max(0, Math.round(extractNumber(commentsValue, 0))),
      },
    ];

    const total = rows.reduce((sum, item) => sum + item.value, 0);
    return total > 0 ? rows : [];
  }, [fbPosts, overviewSource, pageMetricsByKey]);

  const videoWatchStats = useMemo(() => {
    const pageVideo = overviewSource?.page_overview || {};
    const videoData = overviewSource?.video || {};
    const avgWatchSec = extractNumber(videoData.avg_watch_time ?? pageVideo.avg_watch_time, null);

    return {
      avgWatchSec,
    };
  }, [overviewSource]);

  const hasVideoWatchData = useMemo(
    () => Number.isFinite(videoWatchStats.avgWatchSec) && videoWatchStats.avgWatchSec >= 0,
    [videoWatchStats],
  );

  // Reach timeline
  const reachTimelineData = useMemo(() => {
    const source = Array.isArray(reachSeries) ? reachSeries : [];
    if (!source.length) return [];

    return [...source]
      .map((entry) => {
        const dateStr = entry.date || entry.dateKey || "";
        const parsedDate = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
        return {
          dateKey: dateStr,
          label: SHORT_DATE_FORMATTER.format(parsedDate),
          value: extractNumber(entry.value ?? entry.reach ?? entry.impressions, 0),
        };
      })
      .filter((item) => Number.isFinite(item.value))
      .sort((a, b) => (a.dateKey > b.dateKey ? 1 : -1));
  }, [reachSeries]);

  const contentGrowthTimelineData = useMemo(() => {
    const source = Array.isArray(contentGrowthSeries) ? contentGrowthSeries : [];
    if (!source.length) return [];

    return [...source]
      .map((entry) => {
        const dateStr = entry.date || entry.dateKey || "";
        const parsedDate = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
        return {
          dateKey: dateStr,
          label: SHORT_DATE_FORMATTER.format(parsedDate),
          value: extractNumber(entry.value ?? entry.engagement ?? entry.total, 0),
        };
      })
      .filter((item) => Number.isFinite(item.value))
      .sort((a, b) => (a.dateKey > b.dateKey ? 1 : -1));
  }, [contentGrowthSeries]);

  const followerGrowthSeries = useMemo(() => {
    const source = Array.isArray(netFollowersSeries) ? netFollowersSeries : [];
    if (source.length) {
      return [...source]
        .map((entry) => {
          const dateStr = entry.date || entry.dateKey || "";
          const parsedDate = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
          const adds = extractNumber(entry.adds, null);
          const removes = extractNumber(entry.removes, 0);
          const net = extractNumber(entry.net ?? entry.value, 0);
          const gains = Number.isFinite(adds) ? adds : (net > 0 ? net : 0);
          return {
            dateKey: dateStr,
            label: SHORT_DATE_FORMATTER.format(parsedDate),
            tooltipDate: parsedDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }),
            value: Math.max(0, gains),
            adds: Math.max(0, Number.isFinite(adds) ? adds : gains),
            removes: Math.max(0, removes),
            net,
          };
        })
        .filter((item) => Number.isFinite(item.value))
        .sort((a, b) => (a.dateKey > b.dateKey ? 1 : -1));
    }

    const fallbackGain = extractNumber(
      pageMetricsByKey.followers_gained?.value,
      extractNumber(overviewSource?.page_overview?.followers_gained, null),
    );
    if (Number.isFinite(fallbackGain) && fallbackGain !== 0) {
      const startLabel = sinceDate ? SHORT_DATE_FORMATTER.format(sinceDate) : "";
      const endLabel = untilDate ? SHORT_DATE_FORMATTER.format(untilDate) : "";
      const tooltipDate =
        startLabel && endLabel && startLabel !== endLabel
          ? `${startLabel} a ${endLabel}`
          : startLabel || endLabel || "Período";
      return [
        {
          dateKey: "period",
          label: tooltipDate,
          tooltipDate,
          value: Math.max(0, fallbackGain),
          adds: Math.max(0, fallbackGain),
          removes: 0,
          net: fallbackGain,
        },
      ];
    }

    return [];
  }, [netFollowersSeries, pageMetricsByKey.followers_gained?.value, overviewSource?.page_overview?.followers_gained, sinceDate, untilDate]);

  const peakReachPoint = useMemo(() => {
    if (!reachTimelineData.length) return null;
    return reachTimelineData.reduce(
      (currentMax, entry) => (entry.value > currentMax.value ? entry : currentMax),
      reachTimelineData[0],
    );
  }, [reachTimelineData]);

  const peakContentGrowthPoint = useMemo(() => {
    if (!contentGrowthTimelineData.length) return null;
    return contentGrowthTimelineData.reduce(
      (currentMax, entry) => (entry.value > currentMax.value ? entry : currentMax),
      contentGrowthTimelineData[0],
    );
  }, [contentGrowthTimelineData]);

  const postsForDetails = useMemo(() => {
    if (!Array.isArray(fbPosts) || !fbPosts.length) return [];
    return [...fbPosts]
      .sort((a, b) => extractNumber(b?.engagementTotal, 0) - extractNumber(a?.engagementTotal, 0))
      .slice(0, 8);
  }, [fbPosts]);

  const formatPostDate = (timestamp) => {
    if (!timestamp) return "";
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  };

  const accountInitial = (accountConfig?.label || accountConfig?.name || "FB").charAt(0).toUpperCase();
  const overviewIsLoading = overviewLoading;
  const isRefreshing =
    (overviewFetching && !overviewLoading) ||
    (fbPostsFetching && !fbPostsLoading) ||
    (audienceFetching && !audienceLoading);

  return (
    <div className="facebook-dashboard facebook-dashboard--clean">
      {pageError && <div className="alert alert--error">{pageError}</div>}

      {/* Container Limpo (fundo branco) */}
      <div className="ig-clean-container">
        <div className="ig-hero-gradient" aria-hidden="true" />
        {/* Header com Logo Facebook e Tabs */}
        <div className="ig-clean-header fb-topbar">
          <div className="ig-clean-header__brand">
            <div className="ig-clean-header__logo">
              <Facebook size={32} color="#1877F2" fill="#1877F2" />
            </div>
            <h1>Facebook</h1>
          </div>

          <nav className="ig-clean-tabs">
            {HERO_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.href ? location.pathname === tab.href : tab.id === "facebook";
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

        {/* Grid Principal - Layout 2 Colunas (mesmo padrão do Instagram) */}
        <div
          className="ig-clean-grid"
          style={(showWordCloudDetail || showContentDetails)
            ? {
              display: 'grid',
              gridTemplateColumns: showContentDetails ? '1fr 1.55fr' : '1fr 2fr',
              gap: '24px',
            }
            : {}}
        >
          {/* Coluna Esquerda */}
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
                  backgroundImage: coverImage ? `url(${coverImage})` : "linear-gradient(135deg, #dbeafe 0%, #93c5fd 100%)",
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
                    <Facebook size={32} />
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
                    htmlFor="fb-cover-upload"
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
                    id="fb-cover-upload"
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleCoverUpload}
                  />
                </div>
              </div>

              <div className="ig-profile-vertical__avatar-wrapper">
                <div className="ig-profile-vertical__avatar">
                  {avatarUrl ? <img src={avatarUrl} alt="Profile" /> : <span>{accountInitial}</span>}
                </div>
              </div>

              <div className="ig-profile-vertical__body">
                <h3 className="ig-profile-vertical__username" style={{ marginTop: '-10px' }}>
                  {accountConfig?.label || accountConfig?.name || "Página Facebook"}
                </h3>

                <div className="ig-profile-vertical__stats-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', marginTop: '20px' }}>
                  <div className="ig-overview-stat" style={{ paddingBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
                    <div className="ig-overview-stat__trend" style={{ visibility: 'hidden' }}>
                      <span>&nbsp;</span>
                    </div>
                    <div className="ig-overview-stat__value">
                      {overviewIsLoading ? (
                        <span className="ig-skeleton ig-skeleton--stat" aria-hidden="true" />
                      ) : (
                        formatNumber(overviewMetrics.followers)
                      )}
                    </div>
                    <div className="ig-overview-stat__label">Total de seguidores</div>
                  </div>
                  <div className="ig-overview-stat" style={{ paddingBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
                    <div
                      className={`ig-overview-stat__trend ${!overviewIsLoading && reachDeltaDisplay && reachDeltaDirection ? `ig-overview-stat__trend--${reachDeltaDirection}` : ''}`}
                      style={!overviewIsLoading && reachDeltaDisplay && reachDeltaDirection ? {} : { visibility: 'hidden' }}
                    >
                      {reachDeltaDirection === "down" ? (
                        <TrendingDown size={12} aria-hidden="true" />
                      ) : reachDeltaDirection === "up" ? (
                        <TrendingUp size={12} aria-hidden="true" />
                      ) : (
                        <span className="ig-overview-stat__trend-flat" aria-hidden="true">-</span>
                      )}
                      <span>{reachDeltaDisplay || '\u00A0'}</span>
                    </div>
                    <div className="ig-overview-stat__value">
                      {overviewIsLoading ? (
                        <span className="ig-skeleton ig-skeleton--stat" aria-hidden="true" />
                      ) : (
                        formatNumber(overviewMetrics.reach)
                      )}
                    </div>
                    <div className="ig-overview-stat__label">{reachPeriodLabel}</div>
                  </div>
                  <div className="ig-overview-stat" style={{ paddingTop: '16px' }}>
                    <div
                      className={`ig-overview-stat__trend ${!overviewIsLoading && engagementDeltaDisplay && engagementDeltaDirection ? `ig-overview-stat__trend--${engagementDeltaDirection}` : ''}`}
                      style={!overviewIsLoading && engagementDeltaDisplay && engagementDeltaDirection ? {} : { visibility: 'hidden' }}
                    >
                      {engagementDeltaDirection === "down" ? (
                        <TrendingDown size={12} aria-hidden="true" />
                      ) : engagementDeltaDirection === "up" ? (
                        <TrendingUp size={12} aria-hidden="true" />
                      ) : (
                        <span className="ig-overview-stat__trend-flat" aria-hidden="true">-</span>
                      )}
                      <span>{engagementDeltaDisplay || '\u00A0'}</span>
                    </div>
                    <div className="ig-overview-stat__value">
                      {overviewIsLoading ? (
                        <span className="ig-skeleton ig-skeleton--stat" aria-hidden="true" />
                      ) : (
                        formatNumber(overviewMetrics.engagement || 0)
                      )}
                    </div>
                    <div className="ig-overview-stat__label">Engajamento total</div>
                  </div>
                  <div className="ig-overview-stat" style={{ paddingTop: '16px' }}>
                    <div
                      className={`ig-overview-stat__trend ${!overviewIsLoading && pageViewsDeltaDisplay && pageViewsDeltaDirection ? `ig-overview-stat__trend--${pageViewsDeltaDirection}` : ''}`}
                      style={!overviewIsLoading && pageViewsDeltaDisplay && pageViewsDeltaDirection ? {} : { visibility: 'hidden' }}
                    >
                      {pageViewsDeltaDirection === "down" ? (
                        <TrendingDown size={12} aria-hidden="true" />
                      ) : pageViewsDeltaDirection === "up" ? (
                        <TrendingUp size={12} aria-hidden="true" />
                      ) : (
                        <span className="ig-overview-stat__trend-flat" aria-hidden="true">-</span>
                      )}
                      <span>{pageViewsDeltaDisplay || '\u00A0'}</span>
                    </div>
                    <div className="ig-overview-stat__value">
                      {overviewIsLoading ? (
                        <span className="ig-skeleton ig-skeleton--stat" aria-hidden="true" />
                      ) : (
                        formatNumber(overviewMetrics.pageViews || 0)
                      )}
                    </div>
                    <div className="ig-overview-stat__label">Visualizações de página</div>
                  </div>
                </div>

                <div className="ig-profile-vertical__divider" />

                <div className="ig-profile-vertical__engagement">
                  <h4>Engajamento por conteúdo</h4>
                  {overviewIsLoading ? (
                    <DataState state="loading" label="Carregando engajamento..." size="sm" />
                  ) : pageError ? (
                    <DataState state="error" label="Falha ao carregar engajamento." size="sm" />
                  ) : engagementBreakdown.length ? (
                    <>
                      <div className="ig-profile-vertical__engagement-chart">
                        <ResponsiveContainer width="100%" height={260}>
                          <PieChart>
                            <Pie
                              data={engagementBreakdown}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={65}
                              outerRadius={100}
                              paddingAngle={3}
                              stroke="none"
                              activeIndex={activeEngagementIndex}
                              activeShape={renderActiveEngagementShape}
                              onMouseEnter={(_, index) => setActiveEngagementIndex(index)}
                              onMouseLeave={() => setActiveEngagementIndex(-1)}
                            >
                              {engagementBreakdown.map((entry) => (
                                <Cell key={entry.key || entry.name} fill={entry.color || "#3b82f6"} />
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
                        {engagementBreakdown.map((slice, index) => {
                          const total = engagementBreakdown.reduce((sum, item) => sum + item.value, 0);
                          const pct = total > 0 ? ((slice.value / total) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0,0";
                          return (
                            <div key={slice.key || slice.name || index} className="ig-engagement-legend__item" style={{ fontSize: '15px' }}>
                              <span
                                className="ig-engagement-legend__swatch"
                                style={{ backgroundColor: slice.color || "#3b82f6", width: '14px', height: '14px' }}
                              />
                              <span className="ig-engagement-legend__label">
                                {`${slice.name}: ${pct}%`}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <div className="ig-engagement-summary">
                        <div className="ig-engagement-summary__value">{engagementRateDisplay}</div>
                        <div className="ig-engagement-summary__label">Taxa de engajamento</div>
                      </div>
                    </>
                  ) : (
                    <DataState state="empty" label="Sem dados de engajamento." size="sm" />
                  )}
                </div>

                {/* Tempo médio de visualização */}
                <div className="ig-profile-vertical__divider" />
                <div className="ig-profile-vertical__engagement">
                  <h4>Tempo médio de visualização</h4>
                  {overviewIsLoading ? (
                    <DataState state="loading" label="Carregando dados..." size="sm" />
                  ) : pageError ? (
                    <DataState state="error" label={pageError} size="sm" />
                  ) : hasVideoWatchData ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", padding: "16px 0" }}>
                      <div style={{ fontSize: "32px", fontWeight: 700, color: "#111827" }}>
                        {formatDurationSeconds(videoWatchStats.avgWatchSec)}
                      </div>
                      <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: 600 }}>
                        Retenção de audiência no período
                      </div>
                    </div>
                  ) : (
                    <DataState state="empty" label="Sem dados de vídeo para o período." size="sm" />
                  )}
                </div>

              </div>
            </section>
          </div>

          {/* Coluna Direita */}
          <div className="ig-clean-grid__right">
            {showWordCloudDetail ? (
              /* Painel detalhado de Palavras-chave (mesmo layout do Instagram) */
              <div className="ig-wordcloud-detail-panel" style={{ width: '100%', maxWidth: '1060px', margin: '0 auto' }}>
                {/* Header com botão voltar */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '24px',
                  padding: '16px 20px',
                  background: 'linear-gradient(135deg, #1877f2 0%, #1565d8 100%)',
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
                    <div className="ig-card-white ig-kpi-hover" style={{ padding: '20px', textAlign: 'center' }}>
                      <div className="ig-kpi-icon" style={{ background: 'rgba(24, 119, 242, 0.12)', margin: '0 auto 10px' }}>
                        <Hash size={20} color="#1877f2" />
                      </div>
                      <div style={{ fontSize: '28px', fontWeight: 700, color: '#1877f2' }}>
                        {wordCloudDetails.total_occurrences?.toLocaleString('pt-BR') || 0}
                      </div>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Ocorrências</div>
                    </div>
                    <div className="ig-card-white ig-kpi-hover" style={{ padding: '20px', textAlign: 'center' }}>
                      <div className="ig-kpi-icon" style={{ background: 'rgba(59, 130, 246, 0.12)', margin: '0 auto 10px' }}>
                        <MessageCircle size={20} color="#3b82f6" />
                      </div>
                      <div style={{ fontSize: '28px', fontWeight: 700, color: '#3b82f6' }}>
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
                                {comment.username ? (
                                  <a
                                    href={buildFacebookProfileUrl(comment.username)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                      fontWeight: 600,
                                      fontSize: '13px',
                                      color: '#111827',
                                      textDecoration: 'underline',
                                      textUnderlineOffset: '2px',
                                    }}
                                  >
                                    @{String(comment.username).replace(/^@+/, "")}
                                  </a>
                                ) : (
                                  <span style={{ fontWeight: 600, fontSize: '13px', color: '#111827' }}>
                                    Comentário
                                  </span>
                                )}
                                {comment.timestamp && (
                                  <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                                    {formatWordCloudDetailDate(comment.timestamp)}
                                  </span>
                                )}
                                {comment.occurrences > 1 && (
                                  <span style={{
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    color: '#1877f2',
                                    background: '#eff6ff',
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
                              aria-label="Página anterior"
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
                              aria-label="Próxima página"
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
            ) : showContentDetails ? (
              /* Painel detalhado de Crescimento do conteúdo (inline, mesmo padrão do Instagram) */
              <div className="ig-wordcloud-detail-panel" style={{ width: '100%', maxWidth: '1060px', margin: '0 auto' }}>
                {/* Header com botão voltar */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '24px',
                  padding: '16px 20px',
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  borderRadius: '16px',
                  color: 'white'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      onClick={() => setShowContentDetails(false)}
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
                      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Detalhes do conteúdo</h3>
                      <p style={{ margin: 0, fontSize: '13px', opacity: 0.9 }}>Engajamento, audiência e posts no período</p>
                    </div>
                  </div>
                </div>

                {/* KPIs */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '16px',
                  marginBottom: '24px'
                }}>
                  <div className="ig-card-white" style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(34, 197, 94, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Users size={20} color="#22c55e" />
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#22c55e' }}>
                      {formatNumber(engagedUsersValue)}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>Usuários engajados</div>
                  </div>
                  <div className="ig-card-white" style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(22, 163, 74, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ThumbsUp size={20} color="#16a34a" />
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#16a34a' }}>
                      {formatNumber(reactionsTotalValue)}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>Reações totais</div>
                  </div>
                  <div className="ig-card-white" style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(22, 163, 74, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <UserCheck size={20} color="#16a34a" />
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#16a34a' }}>
                      {formatNumber(totalFansValue)}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>Fãs totais</div>
                  </div>
                </div>

                {/* Posts e engajamento */}
                <section className="ig-card-white" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Newspaper size={18} color="#1877F2" />
                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#111827' }}>Posts e engajamento</h4>
                  </div>
                  <div style={{ padding: '16px 20px', flex: 1, overflow: 'auto' }}>
                    {fbPostsLoading ? (
                      <DataState state="loading" label="Carregando posts..." size="sm" />
                    ) : fbPostsError ? (
                      <DataState state="error" label={fbPostsError} size="sm" />
                    ) : postsForDetails.length ? (
                      <div className="fb-detail-posts">
                        {postsForDetails.map((post) => {
                          const title = post?.message || "Post sem texto";
                          return (
                            <a
                              key={post?.id || title}
                              className="fb-detail-post"
                              href={post?.permalink || "#"}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <div className="fb-detail-post__thumb">
                                {post?.previewUrl ? (
                                  <img src={post.previewUrl} alt="" loading="lazy" />
                                ) : (
                                  <div className="fb-detail-post__thumb--empty">Sem imagem</div>
                                )}
                              </div>
                              <div className="fb-detail-post__content">
                                <div className="fb-detail-post__title truncate">{title}</div>
                                <div className="fb-detail-post__date">{formatPostDate(post?.timestamp)}</div>
                                <div className="fb-detail-post__metrics">
                                  <span><Heart size={14} /> {formatNumber(post?.reactions)}</span>
                                  <span><MessageCircle size={14} /> {formatNumber(post?.comments)}</span>
                                  <span><Share2 size={14} /> {formatNumber(post?.shares)}</span>
                                </div>
                              </div>
                              <div className="fb-detail-post__engagement">
                                {formatNumber(post?.engagementTotal)}
                              </div>
                            </a>
                          );
                        })}
                      </div>
                    ) : (
                      <DataState state="empty" label="Sem posts no período." size="sm" />
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
                {reachTimelineData.length ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart
                      data={reachTimelineData}
                      margin={{ top: 16, right: 28, left: 12, bottom: 8 }}
                    >
                      <defs>
                        <linearGradient id="fbReachGradient" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#1877F2" />
                          <stop offset="100%" stopColor="#0A66C2" />
                        </linearGradient>
                        <linearGradient id="fbReachGlow" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="rgba(24, 119, 242, 0.32)" />
                          <stop offset="100%" stopColor="rgba(10, 102, 194, 0)" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} strokeDasharray="4 8" stroke="#f3f4f6" />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#111827' }}
                        fontSize={12}
                        tickLine={false}
                        axisLine={{ stroke: '#e5e7eb' }}
                        interval="preserveStartEnd"
                        minTickGap={50}
                        tickFormatter={formatAxisDate}
                      />
                      <YAxis
                        tick={{ fill: '#111827' }}
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
                          const labelValue = item?.label || props.label || "Período";
                          const isPeak =
                            !!peakReachPoint &&
                            item?.dateKey === peakReachPoint.dateKey &&
                            numericValue === peakReachPoint.value;
                          const footer = isPeak ? (
                            <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
                              Pico do período
                            </div>
                          ) : null;
                          return (
                            <CustomChartTooltip
                              {...props}
                              payload={props.payload.slice(0, 1)}
                              labelFormatter={() => labelValue}
                              labelMap={{ value: "Contas alcançadas" }}
                              valueFormatter={(value) => `: ${formatTooltipNumber(value)}`}
                              footer={footer}
                            />
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        fill="url(#fbReachGlow)"
                        stroke="none"
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="url(#fbReachGradient)"
                        strokeWidth={7}
                        strokeOpacity={0.2}
                        dot={false}
                        isAnimationActive={false}
                        activeDot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="url(#fbReachGradient)"
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 6, fill: '#ffffff', stroke: '#1877F2', strokeWidth: 2 }}
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

            {/* Card de Crescimento do Conteudo */}
            <section className="ig-growth-clean">
              <header className="ig-card-header">
                <div>
                  <h3>
                    Crescimento do conteúdo
                    <InfoTooltip text="Engajamento total acumulado no período selecionado." />
                  </h3>
                  <p className="ig-card-subtitle">Engajamento</p>
                </div>
                <button
                  onClick={handleOpenContentDetails}
                  style={{
                    padding: '8px 20px',
                    background: 'linear-gradient(135deg, #1877F2 0%, #0A66C2 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    boxShadow: '0 2px 8px rgba(24, 119, 242, 0.25)',
                    whiteSpace: 'nowrap'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(24, 119, 242, 0.35)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(24, 119, 242, 0.25)';
                  }}
                >
                  Ver mais
                </button>
              </header>

              <div className="ig-chart-area">
                {contentGrowthTimelineData.length ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart
                      data={contentGrowthTimelineData}
                      margin={{ top: 16, right: 28, left: 12, bottom: 8 }}
                    >
                      <defs>
                        <linearGradient id="fbContentGradient" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#22c55e" />
                          <stop offset="100%" stopColor="#16a34a" />
                        </linearGradient>
                        <linearGradient id="fbContentGlow" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="rgba(34, 197, 94, 0.32)" />
                          <stop offset="100%" stopColor="rgba(22, 163, 74, 0)" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} strokeDasharray="4 8" stroke="#f3f4f6" />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "#111827" }}
                        fontSize={12}
                        tickLine={false}
                        axisLine={{ stroke: "#e5e7eb" }}
                        interval="preserveStartEnd"
                        minTickGap={50}
                        tickFormatter={formatAxisDate}
                      />
                      <YAxis
                        tick={{ fill: "#111827" }}
                        fontSize={12}
                        tickLine={false}
                        axisLine={{ stroke: "#e5e7eb" }}
                        tickFormatter={(value) => formatCompactNumber(value)}
                        domain={["dataMin", (dataMax) => (Number.isFinite(dataMax) ? Math.ceil(dataMax * 1.1) : dataMax)]}
                      />
                      <Tooltip
                        cursor={{ stroke: "rgba(17, 24, 39, 0.2)", strokeDasharray: "4 4" }}
                        content={(props) => {
                          if (!props?.active || !props?.payload?.length) return null;
                          const item = props.payload[0]?.payload;
                          const numericValue = Number(props.payload[0]?.value ?? item?.value ?? 0);
                          const labelValue = item?.label || props.label || "Período";
                          const isPeak =
                            !!peakContentGrowthPoint &&
                            item?.dateKey === peakContentGrowthPoint.dateKey &&
                            numericValue === peakContentGrowthPoint.value;
                          const footer = isPeak ? (
                            <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                              Pico do período
                            </div>
                          ) : null;
                          return (
                            <CustomChartTooltip
                              {...props}
                              payload={props.payload.slice(0, 1)}
                              labelFormatter={() => labelValue}
                              labelMap={{ value: "Engajamento" }}
                              valueFormatter={(value) => `: ${formatTooltipNumber(value)}`}
                              footer={footer}
                            />
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        fill="url(#fbContentGlow)"
                        stroke="none"
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="url(#fbContentGradient)"
                        strokeWidth={7}
                        strokeOpacity={0.2}
                        dot={false}
                        isAnimationActive={false}
                        activeDot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="url(#fbContentGradient)"
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 6, fill: "#ffffff", stroke: "#22c55e", strokeWidth: 2 }}
                      />
                      {peakContentGrowthPoint ? (
                        <>
                          <ReferenceLine
                            x={peakContentGrowthPoint.label}
                            stroke="#111827"
                            strokeDasharray="4 4"
                            strokeOpacity={0.45}
                          />
                          <ReferenceLine
                            y={peakContentGrowthPoint.value}
                            stroke="#111827"
                            strokeDasharray="4 4"
                            strokeOpacity={0.45}
                          />
                          <ReferenceDot
                            x={peakContentGrowthPoint.label}
                            y={peakContentGrowthPoint.value}
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
                  <div className="ig-empty-state">Sem dados disponiveis</div>
                )}
              </div>
            </section>

            {/* DESATIVADO TEMPORARIAMENTE -- Card de Crescimento de Seguidores */}

            {/* Cards de alcance removidos */}

            {/* Posts recentes */}
            <section className="ig-growth-clean">
              <header className="ig-card-header">
                <div>
                  <h3>Posts recentes</h3>
                  <p className="ig-card-subtitle">Publicações recentes da página</p>
                </div>
              </header>

              <div style={{ marginTop: '16px' }}>
                {fbPostsLoading ? (
                  <DataState state="loading" label="Carregando posts..." size="sm" />
                ) : fbPostsError ? (
                  <DataState state="error" label={fbPostsError} size="sm" />
                ) : fbTopPosts.length ? (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '16px'
                  }}>
                    {fbTopPosts.map((post) => (
                      <a
                        key={post?.id}
                        href={post?.permalink || '#'}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          background: 'white',
                          borderRadius: '12px',
                          border: '1px solid #e5e7eb',
                          overflow: 'hidden',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                          textDecoration: 'none',
                          color: 'inherit',
                          display: 'block'
                        }}
                      >
                        <div style={{
                          height: '220px',
                          background: '#f8fafc',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '10px'
                        }}>
                          <div style={{
                            width: '124px',
                            maxWidth: '100%',
                            height: '196px',
                            borderRadius: '14px',
                            border: '1px solid #e5e7eb',
                            background: post?.previewUrl
                              ? `url(${post.previewUrl}) center/cover no-repeat`
                              : 'linear-gradient(135deg, #1877f2 0%, #0b3d91 100%)',
                            boxShadow: '0 6px 16px rgba(15, 23, 42, 0.22)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            {!post?.previewUrl && (
                              <Facebook size={40} color="rgba(255,255,255,0.6)" />
                            )}
                          </div>
                        </div>
                        <div style={{ padding: '14px' }}>
                          <p style={{ fontSize: '13px', color: '#374151', marginBottom: '12px', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {post?.message || 'Post sem texto'}
                          </p>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: '12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Heart size={14} color="#ef4444" fill="#ef4444" />
                                <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>{formatNumber(post?.reactions)}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <MessageCircle size={14} color="#3b82f6" />
                                <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>{formatNumber(post?.comments)}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Share2 size={14} color="#10b981" />
                                <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>{formatNumber(post?.shares)}</span>
                              </div>
                            </div>
                            <span style={{ fontSize: '11px', color: '#9ca3af' }}>{formatPostDate(post?.timestamp)}</span>
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                ) : (
                  <DataState state="empty" label="Sem posts no periodo." size="sm" />
                )}
              </div>
            </section>

            <section className="ig-card-white ig-analytics-card ig-analytics-card--large">
              <div className="ig-analytics-card__header">
                <h4>Palavras-chave mais comentadas</h4>
              </div>
              <div className="ig-analytics-card__body">
                {!accountConfig?.facebookPageId ? (
                  <DataState state="empty" label="Pagina do Facebook nao configurada." size="sm" />
                ) : !wordCloudEnabled ? (
                  <DataState
                    state="loading"
                    label="Preparando nuvem de palavras..."
                    hint="Carregando apos os principais indicadores."
                    size="sm"
                  />
                ) : (
                  <WordCloudCard
                    apiBaseUrl={API_BASE_URL}
                    platform="facebook"
                    pageId={accountConfig?.facebookPageId}
                    since={sinceIso}
                    until={untilIso}
                    top={120}
                    showCommentsCount={false}
                    externalPanelMode={true}
                    onWordClick={handleWordCloudWordClick}
                  />
                )}
              </div>
            </section>

            {/* Card de Performance de Conteúdo - ESCONDIDO */}
            <section className="ig-growth-clean fb-content-performance" style={{ display: "none" }}>
              <header className="ig-card-header">
                <div>
                  <h3>Performance de Conteúdo</h3>
                  <p className="ig-card-subtitle">Tipos de mídia mais engajados</p>
                </div>
              </header>

              <div className="fb-content-grid">
                <DataState state="empty" label="Sem dados de performance de conteúdo." size="sm" />
              </div>
            </section>


            </>
            )}
          </div>
        </div>

      </div>

      {/* Painel de detalhes de conteúdo agora é inline na coluna direita */}
    </div>
  );
}

