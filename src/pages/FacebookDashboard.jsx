import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link, useLocation, useOutletContext } from "react-router-dom";
import { differenceInCalendarDays, endOfDay, startOfDay, subDays } from "date-fns";
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
  Settings,
  Shield,
} from "lucide-react";
import useQueryState from "../hooks/useQueryState";
import { useAccounts } from "../context/AccountsContext";
import { DEFAULT_ACCOUNTS } from "../data/accounts";
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
import { fetchWithTimeout, isTimeoutError } from "../lib/fetchWithTimeout";
import { formatChartDate, formatCompactNumber, formatTooltipNumber } from "../lib/chartFormatters";
import { normalizeSyncInfo } from "../lib/syncInfo";
const API_BASE_URL = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");
const FALLBACK_ACCOUNT_ID = DEFAULT_ACCOUNTS[0]?.id || "";

const FB_TOPBAR_PRESETS = [
  { id: "7d", label: "7 dias", days: 7 },
  { id: "1m", label: "30 dias", days: 30 },
  { id: "3m", label: "90 dias", days: 90 },
  { id: "6m", label: "180 dias", days: 180 },
  { id: "1y", label: "365 dias", days: 365 },
];
const DEFAULT_FACEBOOK_RANGE_DAYS = 7;
const FB_METRICS_TIMEOUT_MS = 60000;
const FB_METRICS_RETRY_TIMEOUT_MS = 90000;

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

const formatDurationSeconds = (seconds) => {
  if (!Number.isFinite(seconds)) return "--";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds - minutes * 60);
  if (remaining <= 0) return `${minutes}m`;
  return `${minutes}m ${remaining}s`;
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
      extra: { limit: 20 },
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

  const [pageMetrics, setPageMetrics] = useState([]);
  const [pageError, setPageError] = useState("");
  const [netFollowersSeries, setNetFollowersSeries] = useState([]);
  const [reachSeries, setReachSeries] = useState([]);

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
      setOverviewSnapshot(null);
      setOverviewSource(cachedOverview.overviewSource || null);
      setOverviewLoading(false);
      setPageError("");
    } else {
      setPageMetrics([]);
      setNetFollowersSeries([]);
      setReachSeries([]);
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
        const resp = await apiFetch(`/api/facebook/page-info?pageId=${encodeURIComponent(accountConfig.facebookPageId)}`);
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
          const response = await fetchWithTimeout(url, { signal: controller.signal }, timeoutMs);
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
        setPageMetrics(fetchedMetrics);
        setNetFollowersSeries(fetchedFollowersSeries);
        setReachSeries(reachSeriesPayload);
        setOverviewSource(json);
        mergeDashboardCache(overviewCacheKey, {
          pageMetrics: fetchedMetrics,
          netFollowersSeries: fetchedFollowersSeries,
          reachSeries: reachSeriesPayload,
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
  }, [accountConfig?.facebookPageId, sinceParam, untilParam, apiFetch, pageCacheKey, overviewCacheKey]);

  useEffect(() => {
    if (!accountConfig?.facebookPageId) {
      setFollowersOverride(null);
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
        const resp = await apiFetch(`/api/facebook/followers?${params.toString()}`);
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

    loadFollowers();
    return () => {
      cancelled = true;
    };
  }, [accountConfig?.facebookPageId, apiFetch, followersCacheKey]);

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
        params.set("limit", "8");
        const resp = await apiFetch(`/api/facebook/posts?${params.toString()}`);
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

    loadPosts();
    return () => {
      cancelled = true;
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

    const params = new URLSearchParams();
    params.set("pageId", accountConfig.facebookPageId);
    const url = `${API_BASE_URL}/api/facebook/audience?${params.toString()}`;

    (async () => {
      try {
        const resp = await fetch(url, { signal: controller.signal });
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
  }, [accountConfig?.facebookPageId, audienceCacheKey]);
  const avatarUrl = useMemo(
    () => pageInfo?.picture_url || accountConfig?.profilePictureUrl || accountConfig?.pagePictureUrl || "",
    [pageInfo?.picture_url, accountConfig?.pagePictureUrl, accountConfig?.profilePictureUrl],
  );

  const heroCoverStyle = useMemo(() => ({
    position: "relative",
    backgroundImage: coverImage
      ? `linear-gradient(180deg, rgba(15,23,42,0.35) 0%, rgba(15,23,42,0.65) 100%), url(${coverImage})`
      : "linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 100%)",
    backgroundSize: "cover",
    backgroundPosition: "center",
    minHeight: "120px",
    borderRadius: "16px",
  }), [coverImage]);

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
  const impressionsValue = extractNumber(overviewSource?.impressions, null);
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

  const reachPeriodLabel = useMemo(() => {
    if (!selectedRange.since || !selectedRange.until) return "Alcance";
    const sinceLabel = SHORT_DATE_FORMATTER.format(selectedRange.since);
    const untilLabel = SHORT_DATE_FORMATTER.format(selectedRange.until);
    return sinceLabel === untilLabel ? `Alcance (${sinceLabel})` : `Alcance (${sinceLabel} - ${untilLabel})`;
  }, [selectedRange.since, selectedRange.until]);

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

  const reachDisplay = useMemo(
    () => (reachMetricValue != null ? formatNumber(reachMetricValue) : "--"),
    [reachMetricValue],
  );
  const impressionsDisplay = useMemo(
    () => (impressionsValue != null ? formatNumber(impressionsValue) : "--"),
    [impressionsValue],
  );
  const frequencyValue = useMemo(() => {
    if (!Number.isFinite(impressionsValue) || !Number.isFinite(reachMetricValue)) return null;
    if (reachMetricValue <= 0) return null;
    return impressionsValue / reachMetricValue;
  }, [impressionsValue, reachMetricValue]);
  const frequencyDisplay = useMemo(() => (
    frequencyValue != null
      ? frequencyValue.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 1 })
      : "--"
  ), [frequencyValue]);

  const reachBreakdown = useMemo(() => {
    const raw = overviewSource?.reach_breakdown || overviewSource?.breakdowns?.reach || null;
    if (!raw || typeof raw !== "object") return null;
    const organic = extractNumber(raw.organic ?? raw.organic_reach ?? raw.organicReach, null);
    const paid = extractNumber(raw.paid ?? raw.paid_reach ?? raw.paidReach, null);
    if (!Number.isFinite(organic) && !Number.isFinite(paid)) return null;
    const safeOrganic = Number.isFinite(organic) ? organic : 0;
    const safePaid = Number.isFinite(paid) ? paid : 0;
    return {
      organic: safeOrganic,
      paid: safePaid,
      total: safeOrganic + safePaid,
    };
  }, [overviewSource]);

  const audienceCities = useMemo(() => (
    Array.isArray(audienceData?.cities) ? audienceData.cities.slice(0, 5) : []
  ), [audienceData]);
  const maxAudienceCity = useMemo(
    () => audienceCities.reduce((max, entry) => Math.max(max, extractNumber(entry?.value, 0)), 0),
    [audienceCities],
  );
  const audienceAgeData = useMemo(() => (
    Array.isArray(audienceData?.ages)
      ? audienceData.ages
        .map((entry) => ({
          age: entry?.range || "",
          value: extractNumber(entry?.value, null),
        }))
        .filter((entry) => entry.age && Number.isFinite(entry.value))
      : []
  ), [audienceData]);
  const audienceGenderItems = useMemo(() => {
    if (!Array.isArray(audienceData?.gender)) return [];
    const items = audienceData.gender.filter((entry) => Number.isFinite(entry?.percentage));
    const male = items.find((entry) => entry.key === "male" || /mascul/i.test(entry.label || ""));
    const female = items.find((entry) => entry.key === "female" || /femin/i.test(entry.label || ""));
    const ordered = [male, female].filter(Boolean);
    if (ordered.length) return ordered;
    return items;
  }, [audienceData]);

  // Engagement breakdown
  const engagementBreakdown = useMemo(() => {
    const metric = pageMetricsByKey.post_engagement_total;
    const breakdown = metric?.breakdown || overviewSource?.engagement || {};

    return [
      {
        name: "Reações",
        value: extractNumber(breakdown.reactions, 0),
      },
      {
        name: "Comentários",
        value: extractNumber(breakdown.comments, 0),
      },
      {
        name: "Compartilhamentos",
        value: extractNumber(breakdown.shares, 0),
      },
    ].filter(item => item.value > 0);
  }, [overviewSource, pageMetricsByKey]);

  const videoWatchStats = useMemo(() => {
    const pageVideo = overviewSource?.page_overview || {};
    const videoData = overviewSource?.video || {};
    const views3s = extractNumber(pageVideo.video_views_3s, null);
    const views10s = extractNumber(videoData.views_10s ?? pageVideo.video_views_10s, null);
    const views30s = extractNumber(videoData.views_30s ?? pageVideo.video_views_30s, null);
    const avgWatchSec = extractNumber(videoData.avg_watch_time ?? pageVideo.avg_watch_time, null);

    // Calcular porcentagens de retenção baseado em views3s como base (100%)
    const retention10s = views3s > 0 && views10s !== null ? Math.round((views10s / views3s) * 100) : null;
    const retention30s = views3s > 0 && views30s !== null ? Math.round((views30s / views3s) * 100) : null;

    return {
      views3s,
      views10s,
      views30s,
      avgWatchSec,
      retention10s,
      retention30s,
    };
  }, [overviewSource]);

  const hasVideoWatchData = useMemo(
    () => [videoWatchStats.views3s, videoWatchStats.views10s, videoWatchStats.views30s, videoWatchStats.avgWatchSec]
      .some((val) => Number.isFinite(val) && val >= 0),
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

  const followerGrowthSeries = useMemo(() => {
    const source = Array.isArray(netFollowersSeries) ? netFollowersSeries : [];
    if (source.length) {
      return [...source]
        .map((entry) => {
          const dateStr = entry.date || entry.dateKey || "";
          const parsedDate = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
          const adds = extractNumber(entry.adds, 0);
          const removes = extractNumber(entry.removes, 0);
          const net = extractNumber(entry.net ?? entry.value, adds - removes);
          return {
            dateKey: dateStr,
            label: SHORT_DATE_FORMATTER.format(parsedDate),
            tooltipDate: parsedDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }),
            value: net,
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
          value: fallbackGain,
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

        {/* Grid Principal - Layout 2 Colunas */}
        <div className="fb-main-grid">
          {/* Coluna Esquerda - Fixa ~320px */}
          <div className="fb-left-column">
            <section className="ig-profile-vertical">
              <div className="ig-profile-vertical__cover" style={heroCoverStyle}>
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

                <div className="ig-profile-vertical__stats-grid">
                  <div className="ig-overview-stat">
                    <div className="ig-overview-stat__value">
                      {overviewIsLoading ? (
                        <span className="ig-skeleton ig-skeleton--stat" aria-hidden="true" />
                      ) : (
                        formatNumber(overviewMetrics.followers)
                      )}
                    </div>
                    <div className="ig-overview-stat__label">Total de seguidores</div>
                  </div>
                  <div className="ig-overview-stat">
                    <div className="ig-overview-stat__value">
                      {overviewIsLoading ? (
                        <span className="ig-skeleton ig-skeleton--stat" aria-hidden="true" />
                      ) : (
                        formatNumber(overviewMetrics.reach)
                      )}
                    </div>
                    <div className="ig-overview-stat__label">{reachPeriodLabel}</div>
                  </div>
                </div>

                <div className="fb-stats-grid fb-stats-grid--two-cols">
                  <div className="ig-overview-stat">
                    <div className="ig-overview-stat__value">
                      {overviewIsLoading ? (
                        <span className="ig-skeleton ig-skeleton--stat" aria-hidden="true" />
                      ) : (
                        formatNumber(overviewMetrics.engagement || 0)
                      )}
                    </div>
                    <div className="ig-overview-stat__label">Engajamento total</div>
                  </div>

                  <div className="ig-overview-stat">
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
                        <ResponsiveContainer width="100%" height={240}>
                          <PieChart>
                            <Pie
                              data={engagementBreakdown}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={60}
                              outerRadius={90}
                              paddingAngle={3}
                              stroke="none"
                              activeIndex={activeEngagementIndex}
                              activeShape={renderActiveEngagementShape}
                              onMouseEnter={(_, index) => setActiveEngagementIndex(index)}
                              onMouseLeave={() => setActiveEngagementIndex(-1)}
                            >
                              <Cell fill="#3b82f6" />
                              <Cell fill="#fbbf24" />
                              <Cell fill="#10b981" />
                            </Pie>
                            <Tooltip
                              content={(
                                <CustomChartTooltip
                                  variant="pie"
                                  valueFormatter={(v) => `: ${formatTooltipNumber(v)}`}
                                />
                              )}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="ig-engagement-legend">
                        {engagementBreakdown.map((slice, index) => (
                          <div key={slice.name || index} className="ig-engagement-legend__item">
                            <span
                              className="ig-engagement-legend__swatch"
                              style={{ backgroundColor: index === 0 ? "#3b82f6" : index === 1 ? "#fbbf24" : "#10b981" }}
                            />
                            <span className="ig-engagement-legend__label" style={{ color: '#111827', fontWeight: 600 }}>{slice.name}</span>
                          </div>
                        ))}
                      </div>

                      <div className="ig-engagement-summary">
                        <div className="ig-engagement-summary__value">{engagementRateDisplay}</div>
                        <div className="ig-engagement-summary__label">Total de engajamento do período</div>
                      </div>
                    </>
                  ) : (
                    <DataState state="empty" label="Sem dados de engajamento." size="sm" />
                  )}
                </div>
              </div>
            </section>

            <section className="ig-card fb-video-stats-card">
              <header className="ig-card-header">
                <div>
                  <h3 className="ig-clean-title2">Desempenho de Vídeos</h3>
                  <p className="ig-card-subtitle">Retenção de audiência no período</p>
                </div>
              </header>
              {overviewIsLoading ? (
                <DataState state="loading" label="Carregando dados..." size="sm" />
              ) : pageError ? (
                <DataState state="error" label={pageError} size="sm" />
              ) : hasVideoWatchData ? (
                <div className="fb-video-stats">
                  {/* Tempo médio em destaque */}
                  <div className="fb-video-stats__highlight">
                    <div className="fb-video-stats__highlight-value">
                      {formatDurationSeconds(videoWatchStats.avgWatchSec)}
                    </div>
                    <div className="fb-video-stats__highlight-label">Tempo médio assistido</div>
                  </div>

                  {/* Funil de retenção */}
                  <div className="fb-video-stats__funnel">
                    <div className="fb-video-stats__funnel-item fb-video-stats__funnel-item--base">
                      <div className="fb-video-stats__funnel-bar" style={{ width: '100%' }}>
                        <span className="fb-video-stats__funnel-value">{formatNumber(videoWatchStats.views3s)}</span>
                      </div>
                      <div className="fb-video-stats__funnel-info">
                        <span className="fb-video-stats__funnel-label">Views 3s</span>
                        <span className="fb-video-stats__funnel-percent">100%</span>
                      </div>
                    </div>

                    <div className="fb-video-stats__funnel-item">
                      <div
                        className="fb-video-stats__funnel-bar"
                        style={{ width: `${videoWatchStats.retention10s || 0}%` }}
                      >
                        <span className="fb-video-stats__funnel-value">{formatNumber(videoWatchStats.views10s)}</span>
                      </div>
                      <div className="fb-video-stats__funnel-info">
                        <span className="fb-video-stats__funnel-label">Views 10s</span>
                        <span className="fb-video-stats__funnel-percent">
                          {videoWatchStats.retention10s !== null ? `${videoWatchStats.retention10s}%` : '-'}
                        </span>
                      </div>
                    </div>

                    <div className="fb-video-stats__funnel-item">
                      <div
                        className="fb-video-stats__funnel-bar"
                        style={{ width: `${videoWatchStats.retention30s || 0}%` }}
                      >
                        <span className="fb-video-stats__funnel-value">{formatNumber(videoWatchStats.views30s)}</span>
                      </div>
                      <div className="fb-video-stats__funnel-info">
                        <span className="fb-video-stats__funnel-label">Views 30s</span>
                        <span className="fb-video-stats__funnel-percent">
                          {videoWatchStats.retention30s !== null ? `${videoWatchStats.retention30s}%` : '-'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <DataState state="empty" label="Sem dados de vídeo para o período." size="sm" />
              )}
            </section>
          </div>

          {/* Coluna Direita - Flex */}
          <div className="fb-right-column">
            {/* Card de Crescimento do Perfil */}
            <section className="ig-growth-clean">
              <header className="ig-card-header">
                <div>
                  <h2 className="ig-clean-title2">Crescimento do perfil</h2>
                  <h3>Alcance</h3>
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
                          const labelValue = item?.label || props.label || "Periodo";
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

            {/* Card de Crescimento de Seguidores - logo abaixo de Crescimento do perfil */}
            <section className="ig-growth-clean">
              <header className="ig-card-header">
                <div>
                  <h3 className="ig-clean-title2">Crescimento de seguidores</h3>
                  <p className="ig-card-subtitle">Evolução diária</p>
                </div>
              </header>

              <div className="ig-chart-area">
                {followerGrowthSeries.length ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart
                      data={followerGrowthSeries}
                      margin={{ top: 16, right: 28, left: 12, bottom: 8 }}
                    >
                      <defs>
                        <linearGradient id="fbFollowersAreaGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1877F2" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#1877F2" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#6b7280', fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: '#e5e7eb' }}
                        minTickGap={30}
                        interval="preserveStartEnd"
                        tickFormatter={formatAxisDate}
                      />
                      <YAxis
                        tick={{ fill: '#6b7280', fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: '#e5e7eb' }}
                        tickFormatter={(val) => formatCompactNumber(val)}
                        domain={['dataMin - 50', 'dataMax + 50']}
                      />
                      <Tooltip
                        cursor={{ stroke: '#1877F2', strokeWidth: 1, strokeDasharray: '4 4' }}
                        content={(props) => {
                          if (!props?.active || !props?.payload?.length) return null;
                          const tooltipDate = props?.payload?.[0]?.payload?.tooltipDate || props?.label || "";
                          return (
                            <CustomChartTooltip
                              {...props}
                              labelFormatter={() => tooltipDate}
                              labelMap={{ value: "Crescimento líquido" }}
                              valueFormatter={(v) => `: ${formatTooltipNumber(v)}`}
                            />
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        fill="url(#fbFollowersAreaGradient)"
                        stroke="none"
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#1877F2"
                        strokeWidth={3}
                        dot={{ fill: '#ffffff', stroke: '#1877F2', strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 6, fill: '#ffffff', stroke: '#1877F2', strokeWidth: 3 }}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="ig-empty-state">Sem dados disponíveis</div>
                )}
              </div>
            </section>

            {/* NOVA SEÇÃO: Alcance (MOCK) */}
            <div className="fb-followers-section">
              {/* Card C: Alcance no período */}
              <section className="ig-card">
                <header className="ig-card-header">
                  <div>
                    <h3 className="ig-clean-title2">Alcance no período</h3>
                    <p className="ig-card-subtitle">Principais métricas</p>
                  </div>
                </header>

                <div className="fb-card-body">
                  <div className="fb-reach-kpis">
                    {/* Alcance total */}
                    <div className="fb-reach-kpi fb-reach-kpi--primary">
                      <div className="fb-reach-kpi__value">{reachDisplay}</div>
                      <div className="fb-reach-kpi__label">Alcance total</div>
                    </div>

                    {/* Impressões */}
                    <div className="fb-reach-kpi">
                      <div className="fb-reach-kpi__value">{impressionsDisplay}</div>
                      <div className="fb-reach-kpi__label">Impressões</div>
                    </div>

                    {/* Frequência média */}
                    <div className="fb-reach-kpi">
                      <div className="fb-reach-kpi__value">{frequencyDisplay}</div>
                      <div className="fb-reach-kpi__label">Frequência média</div>
                    </div>
                  </div>

                  {/* Mini sparkline */}
                  <div className="fb-reach-sparkline">
                    {reachTimelineData.length ? (
                      <ResponsiveContainer width="100%" height={60}>
                        <LineChart
                          data={reachTimelineData}
                          margin={{ top: 5, right: 0, left: 0, bottom: 5 }}
                        >
                          <Tooltip
                            content={(
                              <CustomChartTooltip
                                hideLabel
                                labelMap={{ value: "Alcance" }}
                                valueFormatter={(v) => `: ${formatTooltipNumber(v)}`}
                              />
                            )}
                          />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke="#1877F2"
                            strokeWidth={2}
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="ig-empty-state">Sem dados no período</div>
                    )}
                  </div>
                </div>
              </section>

              {/* Card D: Detalhamento do Alcance */}
              <section className="ig-card">
                <header className="ig-card-header">
                  <div>
                    <h3 className="ig-clean-title2">Detalhamento do alcance</h3>
                    <p className="ig-card-subtitle">Origem do alcance</p>
                  </div>
                </header>

                <div className="fb-card-body">
                  {reachBreakdown ? (
                    <>
                      <div className="fb-reach-details">
                        <div className="fb-reach-detail-item">
                          <div className="fb-reach-detail-item__header">
                            <span className="fb-reach-detail-item__label">Orgânico</span>
                            <span className="fb-reach-detail-item__value">{formatNumber(reachBreakdown.organic)}</span>
                          </div>
                          <div className="fb-reach-detail-item__bar">
                            <div
                              className="fb-reach-detail-item__bar-fill fb-reach-detail-item__bar-fill--organic"
                              style={{
                                width: reachBreakdown.total > 0
                                  ? `${Math.round((reachBreakdown.organic / reachBreakdown.total) * 100)}%`
                                  : "0%",
                              }}
                            />
                          </div>
                          <div className="fb-reach-detail-item__percentage">
                            {reachBreakdown.total > 0
                              ? `${Math.round((reachBreakdown.organic / reachBreakdown.total) * 100)}%`
                              : "0%"}
                          </div>
                        </div>

                        <div className="fb-reach-detail-item">
                          <div className="fb-reach-detail-item__header">
                            <span className="fb-reach-detail-item__label">Pago</span>
                            <span className="fb-reach-detail-item__value">{formatNumber(reachBreakdown.paid)}</span>
                          </div>
                          <div className="fb-reach-detail-item__bar">
                            <div
                              className="fb-reach-detail-item__bar-fill fb-reach-detail-item__bar-fill--paid"
                              style={{
                                width: reachBreakdown.total > 0
                                  ? `${Math.round((reachBreakdown.paid / reachBreakdown.total) * 100)}%`
                                  : "0%",
                              }}
                            />
                          </div>
                          <div className="fb-reach-detail-item__percentage">
                            {reachBreakdown.total > 0
                              ? `${Math.round((reachBreakdown.paid / reachBreakdown.total) * 100)}%`
                              : "0%"}
                          </div>
                        </div>
                      </div>

                      <div className="fb-reach-detail-total">
                        <span className="fb-reach-detail-total__label">Total</span>
                        <span className="fb-reach-detail-total__value">{formatNumber(reachBreakdown.total)}</span>
                      </div>
                    </>
                  ) : (
                    <DataState
                      state={overviewLoading ? "loading" : "empty"}
                      label={overviewLoading ? "Carregando dados..." : "Sem dados de alcance orgânico/pago."}
                      size="sm"
                    />
                  )}
                </div>
              </section>
            </div>

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


            {/* Cards de Demografia */}
            <div className="ig-analytics-grid fb-analytics-grid--pair">
              <section className="ig-card-white fb-analytics-card fb-demographics-card">
                <div className="ig-analytics-card__header">
                  <h4>Top 5 Cidades</h4>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Principais localizações da audiência</p>
                </div>
                <div className="ig-analytics-card__body">
                  {audienceLoading ? (
                    <DataState state="loading" label="Carregando cidades..." size="sm" />
                  ) : audienceError ? (
                    <DataState state="error" label={audienceError} size="sm" />
                  ) : audienceCities.length ? (
                    <div className="fb-cities-list">
                      {audienceCities.map((city, index) => {
                        const rank = index + 1;
                        const value = extractNumber(city?.value, 0);
                        const width = maxAudienceCity > 0 ? Math.round((value / maxAudienceCity) * 100) : 0;
                        const itemClass = rank <= 3 ? `fb-city-item fb-city-item--${rank}` : "fb-city-item";
                        return (
                          <div className={itemClass} key={`${city?.name || "city"}-${rank}`}>
                            <div className="fb-city-item__rank">{rank}</div>
                            <div className="fb-city-item__info">
                              <div className="fb-city-item__name">{city?.name || "--"}</div>
                              <div className="fb-city-item__bar">
                                <div className="fb-city-item__bar-fill" style={{ width: `${width}%` }} />
                              </div>
                            </div>
                            <div className="fb-city-item__value">{formatNumber(value)}</div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <DataState state="empty" label="Sem dados de cidades." size="sm" />
                  )}
                </div>
              </section>

              <section className="ig-card-white fb-analytics-card fb-age-gender-card">
                <div className="ig-analytics-card__header">
                  <h4>Distribuição por Idade e Gênero</h4>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Demografia da audiência</p>
                </div>
                <div className="ig-analytics-card__body">
                  {audienceLoading ? (
                    <DataState state="loading" label="Carregando demografia..." size="sm" />
                  ) : audienceError ? (
                    <DataState state="error" label={audienceError} size="sm" />
                  ) : audienceAgeData.length ? (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart
                        data={audienceAgeData}
                        layout="vertical"
                        margin={{ left: 0, right: 20, top: 10, bottom: 10 }}
                      >
                        <defs>
                          <linearGradient id="fbAgeGradient" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#1877F2" />
                            <stop offset="100%" stopColor="#0A66C2" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                        <XAxis
                          type="number"
                          tick={{ fill: '#6b7280', fontSize: 11 }}
                          tickFormatter={(value) => formatCompactNumber(value)}
                        />
                        <YAxis
                          type="category"
                          dataKey="age"
                          tick={{ fill: '#374151', fontSize: 12, fontWeight: 600 }}
                          width={55}
                        />
                        <Tooltip
                          cursor={{ fill: 'rgba(24, 119, 242, 0.08)' }}
                          content={(props) => {
                            const age = props?.payload?.[0]?.payload?.age;
                            return (
                              <CustomChartTooltip
                                {...props}
                                labelFormatter={() => (age ? `${age} anos` : "")}
                                valueFormatter={(v) => `: ${formatTooltipNumber(v)}`}
                              />
                            );
                          }}
                        />
                        <Bar dataKey="value" fill="url(#fbAgeGradient)" radius={[0, 6, 6, 0]} name="Público" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <DataState state="empty" label="Sem dados de idade." size="sm" />
                  )}

                  {audienceGenderItems.length ? (
                    <div className="fb-gender-legend">
                      {audienceGenderItems.map((entry) => {
                        const label = entry?.label || "Gênero";
                        const pct = Number.isFinite(entry?.percentage)
                          ? entry.percentage.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })
                          : null;
                        const isMale = entry?.key === "male" || /mascul/i.test(label);
                        const isFemale = entry?.key === "female" || /femin/i.test(label);
                        const color = isMale
                          ? "linear-gradient(90deg, #1877F2, #0A66C2)"
                          : isFemale
                            ? "linear-gradient(90deg, #42A5F5, #64B5F6)"
                            : "linear-gradient(90deg, #94a3b8, #cbd5e1)";
                        return (
                          <div className="fb-gender-legend__item" key={entry?.key || label}>
                            <div className="fb-gender-legend__dot" style={{ background: color }} />
                            <span style={{ color: '#111827', fontWeight: 600 }}>
                              {pct ? `${label} (${pct}%)` : label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </div>

        {/* Palavras-chave - Largura Total */}
        <div className="ig-analytics-grid">
          <section className="ig-card-white fb-analytics-card" style={{ gridColumn: '1 / -1' }}>
            <div className="ig-analytics-card__header">
              <h4>Palavras chaves mais comentadas</h4>
            </div>
            <div className="ig-analytics-card__body">
              <WordCloudCard
                apiBaseUrl={API_BASE_URL}
                platform="facebook"
                pageId={accountConfig?.facebookPageId}
                since={sinceIso}
                until={untilIso}
                top={120}
                showCommentsCount={false}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
