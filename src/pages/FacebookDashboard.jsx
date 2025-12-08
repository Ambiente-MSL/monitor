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

const FOLLOWER_GROWTH_SERIES = [
  { label: "01/Out", tooltipDate: "01 de Outubro", value: 45 },
  { label: "02/Out", tooltipDate: "02 de Outubro", value: 52 },
  { label: "03/Out", tooltipDate: "03 de Outubro", value: 38 },
  { label: "04/Out", tooltipDate: "04 de Outubro", value: 67 },
  { label: "05/Out", tooltipDate: "05 de Outubro", value: 55 },
  { label: "06/Out", tooltipDate: "06 de Outubro", value: 41 },
  { label: "07/Out", tooltipDate: "07 de Outubro", value: 73 },
  { label: "08/Out", tooltipDate: "08 de Outubro", value: 89 },
  { label: "09/Out", tooltipDate: "09 de Outubro", value: 62 },
  { label: "10/Out", tooltipDate: "10 de Outubro", value: 58 },
  { label: "11/Out", tooltipDate: "11 de Outubro", value: 76 },
  { label: "12/Out", tooltipDate: "12 de Outubro", value: 91 },
  { label: "13/Out", tooltipDate: "13 de Outubro", value: 44 },
  { label: "14/Out", tooltipDate: "14 de Outubro", value: 69 },
  { label: "15/Out", tooltipDate: "15 de Outubro", value: 83 },
  { label: "16/Out", tooltipDate: "16 de Outubro", value: 71 },
  { label: "17/Out", tooltipDate: "17 de Outubro", value: 56 },
  { label: "18/Out", tooltipDate: "18 de Outubro", value: 48 },
  { label: "19/Out", tooltipDate: "19 de Outubro", value: 95 },
  { label: "20/Out", tooltipDate: "20 de Outubro", value: 102 },
  { label: "21/Out", tooltipDate: "21 de Outubro", value: 78 },
  { label: "22/Out", tooltipDate: "22 de Outubro", value: 88 },
  { label: "23/Out", tooltipDate: "23 de Outubro", value: 64 },
  { label: "24/Out", tooltipDate: "24 de Outubro", value: 92 },
  { label: "25/Out", tooltipDate: "25 de Outubro", value: 108 },
  { label: "26/Out", tooltipDate: "26 de Outubro", value: 85 },
  { label: "27/Out", tooltipDate: "27 de Outubro", value: 97 },
  { label: "28/Out", tooltipDate: "28 de Outubro", value: 74 },
  { label: "29/Out", tooltipDate: "29 de Outubro", value: 86 },
  { label: "30/Out", tooltipDate: "30 de Outubro", value: 115 },
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
    setPageMetrics([]);
    setNetFollowersSeries([]);
    setReachSeries([]);
    setOverviewSnapshot(null);
    setOverviewSource(null);
    setOverviewLoading(false);
    setPageError("");
    setPageInfo(null);
    setCoverImage(null);
    setCoverError("");
    setFollowersOverride(null);
    setFbPosts([]);
    setFbPostsError("");
    setFbPostsLoading(false);
  }, [accountSnapshotKey]);

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

    let cancelled = false;
    const loadPageInfo = async () => {
      try {
        const resp = await apiFetch(`/api/facebook/page-info?pageId=${encodeURIComponent(accountConfig.facebookPageId)}`);
        if (cancelled) return;
        setPageInfo(resp?.page || null);
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
        setCoverImage(resp?.cover?.url || resp?.cover?.storage_url || null);
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
          setFollowersOverride(Number(val));
        }
      } catch (err) {
        if (cancelled) return;
        // keep existing counts if fetch fails
      }
    };

    loadPageInfo();
    loadCover();
    loadFollowers();

    if (!sinceParam || !untilParam) {
      setOverviewSource(null);
      setOverviewLoading(true);
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
        params.set("force", "true");
        const url = `${API_BASE_URL}/api/facebook/metrics?${params.toString()}`;
        const response = await fetch(url, { signal: controller.signal });
        const raw = await response.text();
        const json = safeParseJson(raw) || {};
        if (!response.ok) {
          throw new Error(describeApiError(json, "Falha ao carregar métricas do Facebook."));
        }
        if (cancelled) return;
        setPageMetrics(Array.isArray(json.metrics) ? json.metrics : []);
        setNetFollowersSeries(Array.isArray(json.net_followers_series) ? json.net_followers_series : []);
        const reachSeriesPayload = Array.isArray(json.reach_timeseries)
          ? json.reach_timeseries
          : Array.isArray(json.page_overview?.reach_timeseries)
            ? json.page_overview.reach_timeseries
            : [];
        setReachSeries(reachSeriesPayload);
        setOverviewSource(json);
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
  }, [accountConfig?.facebookPageId, sinceParam, untilParam, apiFetch]);

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
  }, [accountConfig?.facebookPageId, apiFetch, sinceParam, untilParam]);
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
      setCoverImage(resp?.cover?.url || resp?.cover?.storage_url || dataUrl);
    } catch (err) {
      setCoverError(err?.message || "Não foi possível salvar a capa.");
    } finally {
      setCoverLoading(false);
    }
  }, [accountConfig?.facebookPageId, apiFetch]);

  const handleCoverRemove = useCallback(async () => {
    if (!accountConfig?.facebookPageId) return;
    setCoverLoading(true);
    setCoverError("");
    try {
      await apiFetch(`/api/covers?platform=facebook&account_id=${encodeURIComponent(accountConfig.facebookPageId)}`, {
        method: "DELETE",
      });
      setCoverImage(null);
    } catch (err) {
      setCoverError(err?.message || "Não foi possível remover a capa.");
    } finally {
      setCoverLoading(false);
    }
  }, [accountConfig?.facebookPageId, apiFetch]);

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
                              <Cell fill="#1877F2" />
                              <Cell fill="#0A66C2" />
                              <Cell fill="#42A5F5" />
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
                              style={{ backgroundColor: index === 0 ? "#1877F2" : index === 1 ? "#0A66C2" : "#42A5F5" }}
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
                {FOLLOWER_GROWTH_SERIES.length ? (
                  <ResponsiveContainer width="100%" height={FOLLOWER_GROWTH_SERIES.length > 15 ? 380 : 280}>
                    <BarChart
                      data={FOLLOWER_GROWTH_SERIES}
                      margin={{ top: 16, right: 16, bottom: FOLLOWER_GROWTH_SERIES.length > 15 ? 70 : 32, left: 0 }}
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
                        interval={FOLLOWER_GROWTH_SERIES.length > 15 ? "preserveEnd" : 0}
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
                        {FOLLOWER_GROWTH_SERIES.map((entry, index) => (
                          <Cell
                            key={entry.label}
                            fill={
                              index === FOLLOWER_GROWTH_SERIES.length - 1
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

            <div className="ig-analytics-grid fb-analytics-grid--pair">
              <section className="ig-card-white fb-analytics-card">
                <div className="ig-analytics-card__header">
                  <h4>Estatística por gênero</h4>
                </div>
                <div className="ig-analytics-card__body">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      {/* Blue circle (background) */}
                      <Pie
                        data={[{ value: 100 }]}
                        dataKey="value"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        innerRadius={0}
                        fill="#1877F2"
                        stroke="none"
                        isAnimationActive={false}
                      />
                      {/* Light blue circle (foreground - overlapping) */}
                      <Pie
                        data={genderStatsSeries}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        innerRadius={0}
                        startAngle={90}
                        endAngle={90 + (genderStatsSeries[0]?.value || 0) * 3.6}
                        fill="#42A5F5"
                        stroke="none"
                        paddingAngle={0}
                      />
                      <Tooltip content={(props) => <BubbleTooltip {...props} suffix="%" />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="ig-analytics-legend">
                    {genderStatsSeries.map((slice, index) => (
                      <div key={slice.name || index} className="ig-analytics-legend__item">
                        <span
                          className="ig-analytics-legend__swatch"
                          style={{ backgroundColor: index === 0 ? "#42A5F5" : "#1877F2" }}
                        />
                        <span className="ig-analytics-legend__label">{slice.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="ig-card-white fb-analytics-card">
                <div className="ig-analytics-card__header">
                  <h4>Top 10 Cidades</h4>
                </div>
                <div className="ig-top-cities-new-layout">
                  <div className="ig-top-cities-new-layout__left">
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ fontSize: '32px', fontWeight: '700', color: '#1f2937', lineHeight: '1', marginBottom: '8px' }}>
                        2.100
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="ig-top-city-row__icon" style={{ backgroundColor: "#1877F2", width: '12px', height: '12px', borderRadius: '3px' }}></span>
                        <span style={{ fontSize: '13px', fontWeight: '500', color: '#374151' }}>Fortaleza</span>
                        <svg width="14" height="14" viewBox="0 0 16 16">
                          <path d="M8 3 L13 9 L3 9 Z" fill="#10b981" />
                        </svg>
                      </div>
                    </div>

                    <div className="ig-top-cities__table">
                      <div className="ig-top-city-row">
                        <div className="ig-top-city-row__left">
                          <span className="ig-top-city-row__icon" style={{ backgroundColor: "#1877F2" }}></span>
                          <span className="ig-top-city-row__name">São Paulo</span>
                        </div>
                        <span className="ig-top-city-row__value">1.850</span>
                      </div>
                      <div className="ig-top-city-row">
                        <div className="ig-top-city-row__left">
                          <span className="ig-top-city-row__icon" style={{ backgroundColor: "#42A5F5" }}></span>
                          <span className="ig-top-city-row__name">Rio de Janeiro</span>
                        </div>
                        <span className="ig-top-city-row__value">1.620</span>
                      </div>
                      <div className="ig-top-city-row">
                        <div className="ig-top-city-row__left">
                          <span className="ig-top-city-row__icon" style={{ backgroundColor: "#0A66C2" }}></span>
                          <span className="ig-top-city-row__name">Brasília</span>
                        </div>
                        <span className="ig-top-city-row__value">1.340</span>
                      </div>
                      <div className="ig-top-city-row">
                        <div className="ig-top-city-row__left">
                          <span className="ig-top-city-row__icon" style={{ backgroundColor: "#1976D2" }}></span>
                          <span className="ig-top-city-row__name">Belo Horizonte</span>
                        </div>
                        <span className="ig-top-city-row__value">980</span>
                      </div>
                    </div>
                  </div>

                  <div className="ig-top-cities-new-layout__right">
                    <ResponsiveContainer width="100%" height={120}>
                      <ComposedChart
                        data={[
                          { name: '26', value: 1800 },
                          { name: '27', value: 1920 },
                          { name: '28', value: 1950 },
                          { name: '29', value: 2050 },
                          { name: '30', value: 2020 },
                          { name: '31', value: 2080 },
                          { name: '01', value: 2100 }
                        ]}
                        margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
                      >
                        <defs>
                          <linearGradient id="fbCityGrowthGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#1877F2" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#1877F2" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke="#1877F2"
                          strokeWidth={2}
                          fill="url(#fbCityGrowthGradient)"
                          dot={false}
                          animationDuration={800}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </section>
            </div>

            <div className="ig-analytics-grid fb-analytics-grid--pair">
              <section className="ig-card-white fb-analytics-card">
                <div className="ig-analytics-card__header">
                  <h4>Comparativo em Gráfico</h4>
                </div>
                <div className="ig-analytics-card__body">
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{
                      width: '100%',
                      borderCollapse: 'separate',
                      borderSpacing: '0',
                      fontSize: '13px',
                      minWidth: '500px'
                    }}>
                      <thead>
                        <tr style={{
                          background: 'linear-gradient(135deg, #1877F2 0%, #0A66C2 100%)',
                          color: 'white'
                        }}>
                          <th style={{
                            padding: '12px 16px',
                            textAlign: 'left',
                            fontWeight: '600',
                            borderTopLeftRadius: '8px'
                          }}>Tema</th>
                          <th style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            fontWeight: '600'
                          }}>Posts</th>
                          <th style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            fontWeight: '600'
                          }}>Alcance Médio</th>
                          <th style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            fontWeight: '600'
                          }}>Eng. Médio</th>
                          <th style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            fontWeight: '600',
                            borderTopRightRadius: '8px'
                          }}>Compartilhamentos</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{
                          background: 'rgba(24, 119, 242, 0.05)',
                          borderBottom: '1px solid rgba(24, 119, 242, 0.1)'
                        }}>
                          <td style={{
                            padding: '12px 16px',
                            fontWeight: '600',
                            color: '#1f2937'
                          }}>Saúde</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            color: '#374151'
                          }}>15</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            color: '#374151'
                          }}>8.500</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            color: '#374151'
                          }}>320</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            fontWeight: '600',
                            color: '#1877F2'
                          }}>45</td>
                        </tr>
                        <tr style={{
                          background: 'white',
                          borderBottom: '1px solid rgba(24, 119, 242, 0.1)'
                        }}>
                          <td style={{
                            padding: '12px 16px',
                            fontWeight: '600',
                            color: '#1f2937'
                          }}>Segurança</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            color: '#374151'
                          }}>12</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            color: '#374151'
                          }}>12.000</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            color: '#374151'
                          }}>480</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            fontWeight: '600',
                            color: '#1877F2'
                          }}>89</td>
                        </tr>
                        <tr style={{
                          background: 'rgba(24, 119, 242, 0.05)',
                          borderBottom: '1px solid rgba(24, 119, 242, 0.1)'
                        }}>
                          <td style={{
                            padding: '12px 16px',
                            fontWeight: '600',
                            color: '#1f2937'
                          }}>Educação</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            color: '#374151'
                          }}>18</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            color: '#374151'
                          }}>6.200</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            color: '#374151'
                          }}>245</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            fontWeight: '600',
                            color: '#1877F2'
                          }}>32</td>
                        </tr>
                        <tr style={{
                          background: 'white'
                        }}>
                          <td style={{
                            padding: '12px 16px',
                            fontWeight: '600',
                            color: '#1f2937',
                            borderBottomLeftRadius: '8px'
                          }}>Entretenimento</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            color: '#374151'
                          }}>20</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            color: '#374151'
                          }}>15.800</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            color: '#374151'
                          }}>680</td>
                          <td style={{
                            padding: '12px 16px',
                            textAlign: 'center',
                            fontWeight: '600',
                            color: '#1877F2',
                            borderBottomRightRadius: '8px'
                          }}>124</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              <section className="ig-card-white fb-analytics-card">
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
                      margin={{ left: 0, right: 0, top: 5, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tick={{ fill: '#111827' }} fontSize={12} />
                      <YAxis type="category" dataKey="age" tick={{ fill: '#111827' }} fontSize={12} width={60} />
                      <Tooltip
                        cursor={{ fill: 'rgba(24, 119, 242, 0.1)' }}
                        formatter={(value) => Number(value).toLocaleString("pt-BR")}
                      />
                      <Bar dataKey="male" fill="#1877F2" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="female" fill="#42A5F5" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
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
