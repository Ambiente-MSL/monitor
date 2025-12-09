import { useEffect, useMemo, useState, useCallback } from "react";
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
  ReferenceDot,
  ReferenceLine,
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
import { getDashboardCache, makeDashboardCacheKey, mergeDashboardCache, setDashboardCache } from "../lib/dashboardCache";
const API_BASE_URL = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");
const FALLBACK_ACCOUNT_ID = DEFAULT_ACCOUNTS[0]?.id || "";

const FB_TOPBAR_PRESETS = [
  { id: "7d", label: "7 dias", days: 7 },
  { id: "1m", label: "1 mês", days: 30 },
  { id: "3m", label: "3 meses", days: 90 },
  { id: "6m", label: "6 meses", days: 180 },
  { id: "1y", label: "1 ano", days: 365 },
];
const DEFAULT_FACEBOOK_RANGE_DAYS = 7;

const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];
const DEFAULT_WEEKLY_FOLLOWERS = [3, 4, 5, 6, 7, 5, 4];
const DEFAULT_WEEKLY_POSTS = [2, 3, 4, 5, 6, 4, 3];

const DEFAULT_GENDER_STATS = [
  { name: "Homens", value: 40 },
  { name: "Mulheres", value: 60 },
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

const formatShortNumber = (value) => {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString("pt-BR");
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
    () => makeDashboardCacheKey("facebook-page", accountSnapshotKey || "none"),
    [accountSnapshotKey],
  );
  const overviewCacheKey = useMemo(
    () => makeDashboardCacheKey("facebook-overview", accountSnapshotKey || "none", sinceParam || "auto", untilParam || "auto"),
    [accountSnapshotKey, sinceParam, untilParam],
  );
  const fbPostsCacheKey = useMemo(
    () => makeDashboardCacheKey("facebook-posts", accountSnapshotKey || "none", sinceParam || "auto", untilParam || "auto"),
    [accountSnapshotKey, sinceParam, untilParam],
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
    resetTopbarConfig,
    setTopbarConfig,
  ]);

  const [pageMetrics, setPageMetrics] = useState([]);
  const [pageError, setPageError] = useState("");
  const [netFollowersSeries, setNetFollowersSeries] = useState([]);
  const [reachSeries, setReachSeries] = useState([]);

  const [overviewSnapshot, setOverviewSnapshot] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewSource, setOverviewSource] = useState(null);
  const [fbPosts, setFbPosts] = useState([]);
  const [fbPostsLoading, setFbPostsLoading] = useState(false);
  const [fbPostsError, setFbPostsError] = useState("");

  const activeSnapshot = useMemo(
    () => (overviewSnapshot?.accountId === accountSnapshotKey && accountSnapshotKey ? overviewSnapshot : null),
    [accountSnapshotKey, overviewSnapshot],
  );

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

    const cachedOverview = getDashboardCache(overviewCacheKey);
    if (cachedOverview) {
      setPageMetrics(Array.isArray(cachedOverview.pageMetrics) ? cachedOverview.pageMetrics : []);
      setNetFollowersSeries(Array.isArray(cachedOverview.netFollowersSeries) ? cachedOverview.netFollowersSeries : []);
      setReachSeries(Array.isArray(cachedOverview.reachSeries) ? cachedOverview.reachSeries : []);
      setOverviewSnapshot(null);
      setOverviewSource(cachedOverview.overviewSource || null);
      setOverviewLoading(false);
      setPageError("");
      setFollowersOverride(
        cachedOverview.followersOverride !== undefined ? cachedOverview.followersOverride : null,
      );
    } else {
      setPageMetrics([]);
      setNetFollowersSeries([]);
      setReachSeries([]);
      setOverviewSnapshot(null);
      setOverviewSource(null);
      setOverviewLoading(false);
      setPageError("");
      setFollowersOverride(null);
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
  }, [pageCacheKey, overviewCacheKey, fbPostsCacheKey]);

  useEffect(() => {
    if (!accountConfig?.facebookPageId) {
      setPageMetrics([]);
      setNetFollowersSeries([]);
      setReachSeries([]);
      setOverviewSource(null);
      setOverviewLoading(false);
      setPageError("Página do Facebook não configurada.");
      return () => {};
    }

    const cachedPage = getDashboardCache(pageCacheKey);
    const cachedOverview = sinceParam && untilParam ? getDashboardCache(overviewCacheKey) : null;

    let cancelled = false;
    const loadPageInfo = async () => {
      try {
        const resp = await apiFetch(`/api/facebook/page-info?pageId=${encodeURIComponent(accountConfig.facebookPageId)}`);
        if (cancelled) return;
        setPageInfo(resp?.page || null);
        mergeDashboardCache(pageCacheKey, { pageInfo: resp?.page || null });
      } catch (err) {
        if (cancelled) return;
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
        if (cancelled) return;
        const cover = resp?.cover?.url || resp?.cover?.storage_url || null;
        setCoverImage(cover);
        mergeDashboardCache(pageCacheKey, { coverImage: cover });
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

    const loadFollowers = async () => {
      if (!accountConfig?.facebookPageId) return;
      try {
        const params = new URLSearchParams();
        params.set("pageId", accountConfig.facebookPageId);
        if (sinceParam) params.set("since", sinceParam);
        if (untilParam) params.set("until", untilParam);
        const resp = await apiFetch(`/api/facebook/followers?${params.toString()}`);
        if (cancelled) return;
        const val = resp?.followers?.value;
        if (val !== undefined && val !== null) {
          const followersValue = Number(val);
          setFollowersOverride(followersValue);
          mergeDashboardCache(overviewCacheKey, { followersOverride: followersValue });
        }
      } catch (err) {
        if (cancelled) return;
        // keep existing counts if fetch fails
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
    if (!cachedOverview || cachedOverview.followersOverride === undefined) {
      loadFollowers();
    } else if (cachedOverview.followersOverride !== undefined) {
      setFollowersOverride(cachedOverview.followersOverride);
    }

    if (!sinceParam || !untilParam) {
      setOverviewSource(null);
      setOverviewLoading(true);
      return () => { cancelled = true; };
    }

    if (cachedOverview) {
      setPageMetrics(Array.isArray(cachedOverview.pageMetrics) ? cachedOverview.pageMetrics : []);
      setNetFollowersSeries(Array.isArray(cachedOverview.netFollowersSeries) ? cachedOverview.netFollowersSeries : []);
      setReachSeries(Array.isArray(cachedOverview.reachSeries) ? cachedOverview.reachSeries : []);
      setOverviewSource(cachedOverview.overviewSource || null);
      setOverviewLoading(false);
      setPageError("");
      return () => { cancelled = true; };
    }

    const controller = new AbortController();
    cancelled = false;

    const loadOverviewMetrics = async () => {
      setOverviewLoading(true);
      setPageError("");
      try {
        const params = new URLSearchParams();
        params.set("pageId", accountConfig.facebookPageId);
        params.set("since", sinceParam);
        params.set("until", untilParam);
        const url = `${API_BASE_URL}/api/facebook/metrics?${params.toString()}`;
        const response = await fetch(url, { signal: controller.signal });
        const raw = await response.text();
        const json = safeParseJson(raw) || {};
        if (!response.ok) {
          throw new Error(describeApiError(json, "Falha ao carregar métricas do Facebook."));
        }
        if (cancelled) return;
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
        });
      } catch (err) {
        if (controller.signal.aborted || cancelled) return;
        console.error(err);
        setPageMetrics([]);
        setNetFollowersSeries([]);
        setReachSeries([]);
        setOverviewSource(null);
        setPageError(err.message || "Não foi possível carregar as métricas do Facebook.");
      } finally {
        if (!cancelled) {
          setOverviewLoading(false);
        }
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
      setFbPosts([]);
      setFbPostsLoading(false);
      setFbPostsError("Página do Facebook não configurada.");
      return () => {};
    }
    if (!sinceParam || !untilParam) {
      setFbPosts([]);
      return () => {};
    }

    const cachedPosts = getDashboardCache(fbPostsCacheKey);
    if (cachedPosts) {
      setFbPosts(Array.isArray(cachedPosts.posts) ? cachedPosts.posts : []);
      setFbPostsLoading(false);
      setFbPostsError("");
      return () => {};
    }

    let cancelled = false;
    const loadPosts = async () => {
      setFbPostsLoading(true);
      setFbPostsError("");
      try {
        const params = new URLSearchParams();
        params.set("pageId", accountConfig.facebookPageId);
        params.set("since", sinceParam);
        params.set("until", untilParam);
        params.set("limit", "8");
        const resp = await apiFetch(`/api/facebook/posts?${params.toString()}`);
        if (cancelled) return;
        const posts = Array.isArray(resp?.posts) ? resp.posts : [];
        setFbPosts(posts);
        setDashboardCache(fbPostsCacheKey, { posts });
      } catch (err) {
        if (cancelled) return;
        setFbPosts([]);
        const rawMessage = err?.message || "";
        const friendlyMessage = rawMessage.includes("<") ? "Não foi possível carregar os posts (erro 502)." : rawMessage;
        setFbPostsError(friendlyMessage || "Não foi possível carregar os posts.");
      } finally {
        if (!cancelled) {
          setFbPostsLoading(false);
        }
      }
    };

    loadPosts();
    return () => {
      cancelled = true;
    };
  }, [accountConfig?.facebookPageId, apiFetch, sinceParam, untilParam, fbPostsCacheKey]);
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

  // Facebook metrics no longer trigger full API calls; only reach uses the backend.

  const pageMetricsByKey = useMemo(() => {
    const map = {};
    pageMetrics.forEach((metric) => {
      if (metric?.key) map[metric.key] = metric;
    });
    return map;
  }, [pageMetrics]);

  // Calculate overview metrics
  const followersFallback = extractNumber(
    followersOverride,
    extractNumber(overviewSource?.page_overview?.followers_total, 0)
  );
  const totalFollowers = extractNumber(pageMetricsByKey.followers_total?.value, followersFallback);
  const reachValue = extractNumber(
    pageMetricsByKey.reach?.value,
    extractNumber(overviewSource?.reach, 0),
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
  const impressionsValue = extractNumber(overviewSource?.impressions, 0);
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
    return {
      views3s,
      views10s,
      views30s,
      avgWatchSec,
    };
  }, [overviewSource]);

  const hasVideoWatchData = useMemo(
    () => [videoWatchStats.views3s, videoWatchStats.views10s, videoWatchStats.views30s, videoWatchStats.avgWatchSec]
      .some((val) => Number.isFinite(val) && val >= 0),
    [videoWatchStats],
  );

  // Gender distribution (placeholder since Facebook API calls were removed)
  const genderStatsSeries = DEFAULT_GENDER_STATS;

  // Reach timeline
  const reachTimelineData = useMemo(() => {
    const source = Array.isArray(reachSeries) ? reachSeries : [];
    if (!source.length) {
      // Default mock data
      return [
        { dateKey: "2025-01-29", label: "29/01", value: 12000 },
        { dateKey: "2025-01-30", label: "30/01", value: 28000 },
        { dateKey: "2025-01-31", label: "31/01", value: 78000 },
        { dateKey: "2025-02-01", label: "01/02", value: 36000 },
        { dateKey: "2025-02-02", label: "02/02", value: 42000 },
        { dateKey: "2025-02-03", label: "03/02", value: 48000 },
        { dateKey: "2025-02-04", label: "04/02", value: 32000 },
      ];
    }

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
          const net = extractNumber(entry.net, adds - removes);
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
                    Carregando capa...
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
                      {overviewIsLoading ? "..." : formatNumber(overviewMetrics.followers)}
                    </div>
                    <div className="ig-overview-stat__label">Total de seguidores</div>
                  </div>
                  <div className="ig-overview-stat">
                    <div className="ig-overview-stat__value">
                      {overviewIsLoading ? "..." : formatNumber(overviewMetrics.reach)}
                    </div>
                    <div className="ig-overview-stat__label">
                      {overviewIsLoading ? "Alcance (carregando)" : reachPeriodLabel}
                    </div>
                  </div>
                </div>

                <div className="ig-overview-activity" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                  <div className="ig-overview-stat">
                    <div className="ig-overview-stat__value">{formatNumber(overviewMetrics.engagement || 0)}</div>
                    <div className="ig-overview-stat__label">Engajamento total</div>
                  </div>

                  <div className="ig-overview-stat">
                    <div className="ig-overview-stat__value">{formatNumber(overviewMetrics.pageViews || 0)}</div>
                    <div className="ig-overview-stat__label">Visualizações de página</div>
                  </div>

                </div>

                <div className="ig-profile-vertical__divider" />

                <div className="ig-profile-vertical__engagement">
                  <h4>Engajamento por Conteúdo</h4>
                  {engagementBreakdown.length ? (
                    <>
                      <div className="ig-profile-vertical__engagement-chart">
                        <ResponsiveContainer width="100%" height={220}>
                          <PieChart>
                            <Pie
                              data={engagementBreakdown}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={55}
                              outerRadius={85}
                              paddingAngle={3}
                              stroke="none"
                            >
                              <Cell fill="#3b82f6" />
                              <Cell fill="#fbbf24" />
                              <Cell fill="#10b981" />
                            </Pie>
                            <Tooltip formatter={(value, name) => [Number(value).toLocaleString("pt-BR"), name]} />
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
                            <span className="ig-engagement-legend__label">{slice.name}</span>
                          </div>
                        ))}
                      </div>

                      <div className="ig-engagement-summary">
                        <div className="ig-engagement-summary__value">{engagementRateDisplay}</div>
                        <div className="ig-engagement-summary__label">Total de engajamento do período</div>
                      </div>
                    </>
                  ) : (
                    <div className="ig-empty-state">Sem dados</div>
                  )}
                </div>

                {/* Posts em Destaque - Placeholder */}
                <div className="ig-profile-vertical__divider" />
                <div className="ig-profile-vertical__top-posts">
                  <h4>Top posts</h4>
                  <div className="ig-top-posts-list">
                    {fbPostsLoading && !fbTopPosts.length ? (
                      <div className="ig-empty-state">Carregando...</div>
                    ) : fbPostsError ? (
                      <div className="ig-empty-state">{fbPostsError}</div>
                    ) : fbTopPosts.length ? (
                      fbTopPosts.map((post) => {
                        const preview = post.previewUrl || post.full_picture || post.mediaUrl || post.media_url;
                        const captionRaw = post.message || "Sem legenda";
                        const caption = captionRaw.length > 140 ? `${captionRaw.slice(0, 140)}…` : captionRaw;
                        const postDate = post.timestamp ? new Date(post.timestamp) : null;
                        const dateLabel = postDate
                          ? `${postDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })} ${postDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                          : "";
                        const permalink = post.permalink;
                        const openPost = () => {
                          if (permalink) window.open(permalink, "_blank", "noopener,noreferrer");
                        };
                        return (
                          <div key={post.id || post.timestamp} className="ig-top-post-compact">
                            <div className="ig-top-post-compact__main">
                              <div className="ig-top-post-compact__left">
                                <div
                                  className="ig-top-post-compact__thumb"
                                  onClick={openPost}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      openPost();
                                    }
                                  }}
                                >
                                  {preview ? (
                                    <img src={preview} alt="Post do Facebook" />
                                  ) : (
                                    <div className="ig-empty-thumb">Sem imagem</div>
                                  )}
                                </div>
                                <div className="ig-top-post-compact__datetime">{dateLabel}</div>
                              </div>
                              <div className="ig-top-post-compact__right">
                                <div className="ig-top-post-compact__metrics-column">
                                  <span className="ig-metric ig-metric--like">
                                    <Heart size={18} fill="#ef4444" color="#ef4444" />
                                    <span className="ig-metric__value">{formatShortNumber(post.reactions ?? 0)}</span>
                                  </span>
                                  <span className="ig-metric ig-metric--comment">
                                    <MessageCircle size={18} color="#6366f1" />
                                    <span className="ig-metric__value">{formatShortNumber(post.comments ?? 0)}</span>
                                  </span>
                                  <span className="ig-metric ig-metric--share">
                                    <Share2 size={18} color="#f97316" />
                                    <span className="ig-metric__value">{formatShortNumber(post.shares ?? 0)}</span>
                                  </span>
                                  <span className="ig-metric ig-metric--reach">
                                    <BarChart3 size={18} color="#0ea5e9" />
                                    <span className="ig-metric__value">{formatShortNumber(post.reach ?? post.impressions ?? 0)}</span>
                                  </span>
                                </div>
                                <div className="ig-top-post-compact__caption">
                                  {caption}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="ig-empty-state">Sem posts no período selecionado.</div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="ig-card" style={{ marginTop: 12 }}>
              <header className="ig-card-header">
                <div>
                  <h3 className="ig-clean-title2">Visão de vídeos</h3>
                  <p className="ig-card-subtitle">Views por duração (período filtrado)</p>
                </div>
              </header>
              {overviewIsLoading ? (
                <div className="ig-empty-state">Carregando...</div>
              ) : hasVideoWatchData ? (
                <div
                  className="ig-overview-activity"
                  style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}
                >
                  <div className="ig-overview-stat">
                    <div className="ig-overview-stat__value">{formatNumber(videoWatchStats.views3s)}</div>
                    <div className="ig-overview-stat__label">Views 3s</div>
                  </div>
                  <div className="ig-overview-stat">
                    <div className="ig-overview-stat__value">{formatNumber(videoWatchStats.views10s)}</div>
                    <div className="ig-overview-stat__label">Views 10s</div>
                  </div>
                  <div className="ig-overview-stat">
                    <div className="ig-overview-stat__value">{formatNumber(videoWatchStats.views30s)}</div>
                    <div className="ig-overview-stat__label">Views 30s</div>
                  </div>
                  <div className="ig-overview-stat">
                    <div className="ig-overview-stat__value">{formatDurationSeconds(videoWatchStats.avgWatchSec)}</div>
                    <div className="ig-overview-stat__label">Tempo médio assistido</div>
                  </div>
                </div>
              ) : (
                <div className="ig-empty-state">Sem dados de vídeo para o período</div>
              )}
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
                {reachTimelineData.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart
                      data={reachTimelineData}
                      margin={{ top: 24, right: 28, left: 12, bottom: 12 }}
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
                      />
                      <YAxis
                        tick={{ fill: '#111827' }}
                        fontSize={12}
                        tickLine={false}
                        axisLine={{ stroke: '#e5e7eb' }}
                        tickFormatter={(value) => formatShortNumber(value)}
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

            {/* Card de Crescimento de Seguidores */}
            <section className="ig-growth-clean fb-growth-followers fb-follower-growth-card">
              <header className="ig-card-header">
                <div>
                  <h3>Crescimento de Seguidores</h3>
                  <p className="ig-card-subtitle">Evolução mensal</p>
                </div>
              </header>

              <div className="ig-chart-area">
                {followerGrowthSeries.length ? (
                  <ResponsiveContainer width="100%" height={followerGrowthSeries.length > 15 ? 380 : 280}>
                    <BarChart
                      data={followerGrowthSeries}
                      margin={{ top: 16, right: 16, bottom: followerGrowthSeries.length > 15 ? 70 : 32, left: 0 }}
                      barCategoryGap="35%"
                    >
                      <defs>
                        <linearGradient id="fbFollowerGrowthBar" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1877F2" />
                          <stop offset="100%" stopColor="#0A66C2" />
                        </linearGradient>
                        <linearGradient id="fbFollowerGrowthBarActive" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#42A5F5" />
                          <stop offset="45%" stopColor="#1877F2" />
                          <stop offset="100%" stopColor="#0A66C2" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 8" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fill: "#9ca3af", fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
                          interval={followerGrowthSeries.length > 15 ? "preserveEnd" : 0}
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
                      />
                        <Tooltip
                          cursor={{ fill: "rgba(24, 119, 242, 0.25)" }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const dataPoint = payload[0];
                            const tooltipValue = dataPoint.value?.toLocaleString('pt-BR');
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
                      <Bar
                        dataKey="value"
                        radius={[8, 8, 0, 0]}
                        barSize={36}
                        maxBarSize={48}
                      >
                        {followerGrowthSeries.map((entry, index) => (
                          <Cell
                            key={entry.label}
                            fill={
                              index === followerGrowthSeries.length - 1
                                ? "url(#fbFollowerGrowthBarActive)"
                                : "url(#fbFollowerGrowthBar)"
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="ig-empty-state">Sem histórico recente.</div>
                )}
              </div>
            </section>

            {/* Card de Performance de Conteúdo */}
            <section className="ig-growth-clean fb-content-performance">
              <header className="ig-card-header">
                <div>
                  <h3>Performance de Conteúdo</h3>
                  <p className="ig-card-subtitle">Tipos de mídia mais engajados</p>
                </div>
              </header>

              <div className="fb-content-grid">
                <div className="fb-content-type-card fb-content-type-card--video">
                  <div className="fb-content-type-card__icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </div>
                  <div className="fb-content-type-card__stats">
                    <div className="fb-content-type-card__value">12.4k</div>
                    <div className="fb-content-type-card__label">Vídeos</div>
                    <div className="fb-content-type-card__metric">
                      <span className="fb-content-type-card__badge fb-content-type-card__badge--up">+18%</span>
                      <span>vs. período anterior</span>
                    </div>
                  </div>
                </div>

                <div className="fb-content-type-card fb-content-type-card--image">
                  <div className="fb-content-type-card__icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </div>
                  <div className="fb-content-type-card__stats">
                    <div className="fb-content-type-card__value">8.2k</div>
                    <div className="fb-content-type-card__label">Imagens</div>
                    <div className="fb-content-type-card__metric">
                      <span className="fb-content-type-card__badge fb-content-type-card__badge--up">+12%</span>
                      <span>vs. período anterior</span>
                    </div>
                  </div>
                </div>

                <div className="fb-content-type-card fb-content-type-card--text">
                  <div className="fb-content-type-card__icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                  </div>
                  <div className="fb-content-type-card__stats">
                    <div className="fb-content-type-card__value">5.6k</div>
                    <div className="fb-content-type-card__label">Texto</div>
                    <div className="fb-content-type-card__metric">
                      <span className="fb-content-type-card__badge fb-content-type-card__badge--down">-5%</span>
                      <span>vs. período anterior</span>
                    </div>
                  </div>
                </div>

                <div className="fb-content-type-card fb-content-type-card--link">
                  <div className="fb-content-type-card__icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  </div>
                  <div className="fb-content-type-card__stats">
                    <div className="fb-content-type-card__value">3.1k</div>
                    <div className="fb-content-type-card__label">Links</div>
                    <div className="fb-content-type-card__metric">
                      <span className="fb-content-type-card__badge fb-content-type-card__badge--up">+8%</span>
                      <span>vs. período anterior</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Card de Engajamento por Horário */}
            <section className="ig-growth-clean fb-engagement-timing">
              <header className="ig-card-header">
                <div>
                  <h3>Melhor Horário para Publicar</h3>
                  <p className="ig-card-subtitle">Engajamento por hora do dia</p>
                </div>
              </header>

              <div className="fb-heatmap-container">
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart
                    data={[
                      { hour: '0h', engagement: 120 },
                      { hour: '3h', engagement: 80 },
                      { hour: '6h', engagement: 180 },
                      { hour: '9h', engagement: 420 },
                      { hour: '12h', engagement: 680 },
                      { hour: '15h', engagement: 520 },
                      { hour: '18h', engagement: 850 },
                      { hour: '21h', engagement: 720 },
                      { hour: '24h', engagement: 280 },
                    ]}
                    margin={{ top: 20, right: 20, left: 0, bottom: 20 }}
                  >
                    <defs>
                      <linearGradient id="fbEngagementGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1877F2" stopOpacity={0.8} />
                        <stop offset="50%" stopColor="#42A5F5" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#1877F2" stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis
                      dataKey="hour"
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) => formatShortNumber(value)}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const item = payload[0];
                        return (
                          <div className="ig-tooltip">
                            <span className="ig-tooltip__title">{item.payload.hour}</span>
                            <div className="ig-tooltip__row">
                              <span>Engajamento</span>
                              <strong>{formatNumber(item.value)}</strong>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="engagement"
                      stroke="#1877F2"
                      strokeWidth={3}
                      fill="url(#fbEngagementGradient)"
                      dot={{ fill: '#1877F2', strokeWidth: 2, r: 5 }}
                      activeDot={{ r: 7, fill: '#ffffff', stroke: '#1877F2', strokeWidth: 3 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>

                <div className="fb-best-time-highlight">
                  <div className="fb-best-time-highlight__icon">⭐</div>
                  <div className="fb-best-time-highlight__content">
                    <div className="fb-best-time-highlight__label">Melhor horário</div>
                    <div className="fb-best-time-highlight__value">18:00 - 21:00</div>
                    <div className="fb-best-time-highlight__desc">850 engajamentos médios</div>
                  </div>
                </div>
              </div>
            </section>

            {/* Cards de Alcance e Sentimento */}
            <div className="ig-analytics-grid fb-analytics-grid--pair">
              <section className="ig-card-white fb-analytics-card fb-reach-sources">
                <div className="ig-analytics-card__header">
                  <h4>Fontes de Alcance</h4>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Origem do alcance total</p>
                </div>
                <div className="ig-analytics-card__body">
                  <div className="fb-reach-sources-grid">
                    <div className="fb-reach-source-item">
                      <div className="fb-reach-source-item__header">
                        <div className="fb-reach-source-item__icon fb-reach-source-item__icon--organic">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                          </svg>
                        </div>
                        <span className="fb-reach-source-item__label">Orgânico</span>
                      </div>
                      <div className="fb-reach-source-item__value">64.2k</div>
                      <div className="fb-reach-source-item__bar">
                        <div className="fb-reach-source-item__bar-fill" style={{ width: '85%', background: 'linear-gradient(90deg, #1877F2 0%, #42A5F5 100%)' }} />
                      </div>
                      <div className="fb-reach-source-item__percentage">85%</div>
                    </div>

                    <div className="fb-reach-source-item">
                      <div className="fb-reach-source-item__header">
                        <div className="fb-reach-source-item__icon fb-reach-source-item__icon--paid">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="12" y1="1" x2="12" y2="23" />
                            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                          </svg>
                        </div>
                        <span className="fb-reach-source-item__label">Pago</span>
                      </div>
                      <div className="fb-reach-source-item__value">11.5k</div>
                      <div className="fb-reach-source-item__bar">
                        <div className="fb-reach-source-item__bar-fill" style={{ width: '15%', background: 'linear-gradient(90deg, #10b981 0%, #34d399 100%)' }} />
                      </div>
                      <div className="fb-reach-source-item__percentage">15%</div>
                    </div>
                  </div>

                  <div className="fb-reach-total">
                    <div className="fb-reach-total__label">Alcance Total</div>
                    <div className="fb-reach-total__value">75.7k</div>
                  </div>
                </div>
              </section>

              <section className="ig-card-white fb-analytics-card fb-sentiment-card">
                <div className="ig-analytics-card__header">
                  <h4>Sentimento dos Comentários</h4>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Análise de sentimento</p>
                </div>
                <div className="ig-analytics-card__body">
                  <div className="fb-sentiment-grid">
                    <div className="fb-sentiment-item fb-sentiment-item--positive">
                      <div className="fb-sentiment-item__emoji">😊</div>
                      <div className="fb-sentiment-item__label">Positivo</div>
                      <div className="fb-sentiment-item__value">72%</div>
                      <div className="fb-sentiment-item__count">1.8k comentários</div>
                    </div>

                    <div className="fb-sentiment-item fb-sentiment-item--neutral">
                      <div className="fb-sentiment-item__emoji">😐</div>
                      <div className="fb-sentiment-item__label">Neutro</div>
                      <div className="fb-sentiment-item__value">18%</div>
                      <div className="fb-sentiment-item__count">450 comentários</div>
                    </div>

                    <div className="fb-sentiment-item fb-sentiment-item--negative">
                      <div className="fb-sentiment-item__emoji">😞</div>
                      <div className="fb-sentiment-item__label">Negativo</div>
                      <div className="fb-sentiment-item__value">10%</div>
                      <div className="fb-sentiment-item__count">250 comentários</div>
                    </div>
                  </div>

                  <div className="fb-sentiment-summary">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>Recepção muito positiva da audiência</span>
                  </div>
                </div>
              </section>
            </div>

            {/* Cards de Demografia */}
            <div className="ig-analytics-grid fb-analytics-grid--pair">
              <section className="ig-card-white fb-analytics-card fb-demographics-card">
                <div className="ig-analytics-card__header">
                  <h4>Top 5 Cidades</h4>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Principais localizações da audiência</p>
                </div>
                <div className="ig-analytics-card__body">
                  <div className="fb-cities-list">
                    <div className="fb-city-item fb-city-item--1">
                      <div className="fb-city-item__rank">1</div>
                      <div className="fb-city-item__info">
                        <div className="fb-city-item__name">Fortaleza - CE</div>
                        <div className="fb-city-item__bar">
                          <div className="fb-city-item__bar-fill" style={{ width: '100%' }} />
                        </div>
                      </div>
                      <div className="fb-city-item__value">12.5k</div>
                    </div>

                    <div className="fb-city-item fb-city-item--2">
                      <div className="fb-city-item__rank">2</div>
                      <div className="fb-city-item__info">
                        <div className="fb-city-item__name">São Paulo - SP</div>
                        <div className="fb-city-item__bar">
                          <div className="fb-city-item__bar-fill" style={{ width: '85%' }} />
                        </div>
                      </div>
                      <div className="fb-city-item__value">10.2k</div>
                    </div>

                    <div className="fb-city-item fb-city-item--3">
                      <div className="fb-city-item__rank">3</div>
                      <div className="fb-city-item__info">
                        <div className="fb-city-item__name">Brasília - DF</div>
                        <div className="fb-city-item__bar">
                          <div className="fb-city-item__bar-fill" style={{ width: '70%' }} />
                        </div>
                      </div>
                      <div className="fb-city-item__value">8.8k</div>
                    </div>

                    <div className="fb-city-item">
                      <div className="fb-city-item__rank">4</div>
                      <div className="fb-city-item__info">
                        <div className="fb-city-item__name">Rio de Janeiro - RJ</div>
                        <div className="fb-city-item__bar">
                          <div className="fb-city-item__bar-fill" style={{ width: '60%' }} />
                        </div>
                      </div>
                      <div className="fb-city-item__value">7.5k</div>
                    </div>

                    <div className="fb-city-item">
                      <div className="fb-city-item__rank">5</div>
                      <div className="fb-city-item__info">
                        <div className="fb-city-item__name">Belo Horizonte - MG</div>
                        <div className="fb-city-item__bar">
                          <div className="fb-city-item__bar-fill" style={{ width: '45%' }} />
                        </div>
                      </div>
                      <div className="fb-city-item__value">5.6k</div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="ig-card-white fb-analytics-card fb-age-gender-card">
                <div className="ig-analytics-card__header">
                  <h4>Distribuição por Idade e Gênero</h4>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Demografia da audiência</p>
                </div>
                <div className="ig-analytics-card__body">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart
                      data={[
                        { age: "13-17", male: 150, female: 220 },
                        { age: "18-24", male: 680, female: 820 },
                        { age: "25-34", male: 1240, female: 1380 },
                        { age: "35-44", male: 980, female: 850 },
                        { age: "45-54", male: 640, female: 520 },
                        { age: "55+", male: 420, female: 380 },
                      ]}
                      layout="vertical"
                      margin={{ left: 0, right: 20, top: 10, bottom: 10 }}
                    >
                      <defs>
                        <linearGradient id="fbMaleGradient" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#1877F2" />
                          <stop offset="100%" stopColor="#0A66C2" />
                        </linearGradient>
                        <linearGradient id="fbFemaleGradient" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#42A5F5" />
                          <stop offset="100%" stopColor="#64B5F6" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fill: '#6b7280', fontSize: 11 }}
                        tickFormatter={(value) => formatShortNumber(value)}
                      />
                      <YAxis
                        type="category"
                        dataKey="age"
                        tick={{ fill: '#374151', fontSize: 12, fontWeight: 600 }}
                        width={55}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(24, 119, 242, 0.08)' }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          return (
                            <div className="ig-tooltip">
                              <span className="ig-tooltip__title">{payload[0].payload.age} anos</span>
                              <div className="ig-tooltip__row">
                                <span>Masculino</span>
                                <strong>{formatNumber(payload[0].value)}</strong>
                              </div>
                              <div className="ig-tooltip__row">
                                <span>Feminino</span>
                                <strong>{formatNumber(payload[1].value)}</strong>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="male" fill="url(#fbMaleGradient)" radius={[0, 6, 6, 0]} name="Masculino" />
                      <Bar dataKey="female" fill="url(#fbFemaleGradient)" radius={[0, 6, 6, 0]} name="Feminino" />
                    </BarChart>
                  </ResponsiveContainer>

                  <div className="fb-gender-legend">
                    <div className="fb-gender-legend__item">
                      <div className="fb-gender-legend__dot" style={{ background: 'linear-gradient(90deg, #1877F2, #0A66C2)' }} />
                      <span>Masculino (48%)</span>
                    </div>
                    <div className="fb-gender-legend__item">
                      <div className="fb-gender-legend__dot" style={{ background: 'linear-gradient(90deg, #42A5F5, #64B5F6)' }} />
                      <span>Feminino (52%)</span>
                    </div>
                  </div>
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
              <div className="ig-word-cloud fb-word-cloud--large">
                <span className="ig-word-cloud__word fb-word-cloud__word--xl" style={{ color: '#1877F2' }}>eventos</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--lg" style={{ color: '#0A66C2' }}>negócios</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--lg" style={{ color: '#42A5F5' }}>comunidade</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--md" style={{ color: '#1976D2' }}>produtos</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--md" style={{ color: '#0A66C2' }}>ofertas</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--sm" style={{ color: '#42A5F5' }}>promoção</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--md" style={{ color: '#1877F2' }}>família</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--sm" style={{ color: '#42A5F5' }}>vida</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--xl" style={{ color: '#0A66C2' }}>amigos</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--sm" style={{ color: '#1976D2' }}>grupo</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--md" style={{ color: '#1877F2' }}>curtir</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--lg" style={{ color: '#42A5F5' }}>compartilhar</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--sm" style={{ color: '#0A66C2' }}>seguir</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--md" style={{ color: '#1976D2' }}>página</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--sm" style={{ color: '#1877F2' }}>post</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--md" style={{ color: '#0A66C2' }}>conteúdo</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--sm" style={{ color: '#42A5F5' }}>notícias</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--lg" style={{ color: '#1877F2' }}>atualização</span>
                <span className="ig-word-cloud__word fb-word-cloud__word--sm" style={{ color: '#1976D2' }}>novidade</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
