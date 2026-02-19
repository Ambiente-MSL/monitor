import { useState, useMemo, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { differenceInCalendarDays, endOfDay, format, startOfDay, subDays } from "date-fns";
import {
  ResponsiveContainer,
  AreaChart,
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
  LineChart,
  Line,
  ReferenceLine,
  ReferenceDot,
  Brush,
} from "recharts";
import {
  TrendingUp,
  DollarSign,
  Eye,
  MousePointerClick,
  Users,
  Target,
  Activity,
  BarChart3,
  FileText,
  Facebook,
  Instagram as InstagramIcon,
  Settings,
  Shield,
  Image,
  Play,
} from "lucide-react";
import DataState from "../components/DataState";
import CustomChartTooltip from "../components/CustomChartTooltip";
import DateRangeIndicator from "../components/DateRangeIndicator";
import { useAccounts } from "../context/AccountsContext";
import { useAuth } from "../context/AuthContext";
import useQueryState from "../hooks/useQueryState";
import { isApiEnvelope, unwrapApiData } from "../lib/apiEnvelope";
import { formatChartDate, formatCompactNumber, formatTooltipNumber } from "../lib/chartFormatters";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { normalizeSyncInfo } from "../lib/syncInfo";

const API_BASE_URL = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");

// Hero Tabs
const HERO_TABS = [
  { id: "instagram", label: "Instagram", href: "/instagram", icon: InstagramIcon, iconClass: "hero-icon-instagram" },
  { id: "facebook", label: "Facebook", href: "/facebook", icon: Facebook, iconClass: "hero-icon-facebook" },
  { id: "ads", label: "Ads", href: "/ads", icon: BarChart3, iconClass: "hero-icon-ads" },
  { id: "reports", label: "Relatórios", href: "/relatorios", icon: FileText, iconClass: "hero-icon-reports" },
  { id: "settings", label: "Configurações", href: "/configuracoes", icon: Settings, iconClass: "hero-icon-settings" },
  { id: "admin", label: "Admin", href: "/admin", icon: Shield, iconClass: "hero-icon-admin" },
];

const IG_DONUT_COLORS = ["#6366f1", "#f97316", "#a855f7", "#c084fc", "#d8b4fe"];
const VIDEO_ADS_GROWTH_COLORS = ["#6366f1", "#10b981", "#f97316", "#ec4899"];

const ADS_TOPBAR_PRESETS = [
  { id: "7d", label: "7 dias", days: 7 },
  { id: "1m", label: "30 dias", days: 30 },
  { id: "3m", label: "90 dias", days: 90 },
  { id: "6m", label: "180 dias", days: 180 },
  { id: "1y", label: "365 dias", days: 365 },
];


const DEFAULT_ADS_RANGE_DAYS = 7;

const translateObjective = (value) => {
  if (!value) return "";
  const upper = String(value).toUpperCase();
  if (upper === "CONVERSIONS") return "Conversão";
  if (upper === "LINK_CLICKS") return "Cliques";
  if (upper === "TRAFFIC") return "Tráfego";
  if (upper === "ENGAGEMENT" || upper === "OUTCOME_ENGAGEMENT") return "Engajamento";
  if (upper === "AWARENESS" || upper === "BRAND_AWARENESS" || upper === "OUTCOME_AWARENESS") return "Reconhecimento";
  return value;
};

const parseAdsHighlightsResponse = (resp) => {
  if (isApiEnvelope(resp)) {
    return {
      envelope: resp,
      data: resp.data ?? null,
      error: resp.error ?? null,
    };
  }
  const legacyError =
    resp && typeof resp === "object" && resp.error
      ? { code: "INTEGRATION_ERROR", message: String(resp.error) }
      : null;
  return {
    envelope: null,
    data: resp || null,
    error: legacyError,
  };
};

export default function AdsDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { setTopbarConfig, resetTopbarConfig } = outletContext;
  const { accounts, loading: accountsLoading } = useAccounts();
  const { apiFetch, token } = useAuth();
  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  );
  const availableAccounts = useMemo(() => accounts, [accounts]);
  const [getQuery, setQuery] = useQueryState({ account: availableAccounts[0]?.id || "" });
  const queryAccountId = getQuery("account");
  const selectedAccount = useMemo(() => {
    if (!availableAccounts.length) return {};
    return availableAccounts.find((acc) => acc.id === queryAccountId) || availableAccounts[0];
  }, [availableAccounts, queryAccountId]);

  const [activeSpendBar, setActiveSpendBar] = useState(-1);
  const [activeCampaignIndex, setActiveCampaignIndex] = useState(-1);
  const [adsEnvelope, setAdsEnvelope] = useState(null);
  const [adsData, setAdsData] = useState(null);
  const [adsComparisonData, setAdsComparisonData] = useState(null);
  const [adsError, setAdsError] = useState(null);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsReloadKey, setAdsReloadKey] = useState(0);
  const adsRequestIdRef = useRef(0);
  const [instagramProfileData, setInstagramProfileData] = useState(null);
  const adAccountId = useMemo(() => {
    if (!selectedAccount) return "";
    if (selectedAccount.adAccountId) return selectedAccount.adAccountId;
    if (Array.isArray(selectedAccount.adAccounts) && selectedAccount.adAccounts.length > 0) {
      return selectedAccount.adAccounts[0]?.id || "";
    }
    return "";
  }, [selectedAccount]);
  const actParam = adAccountId
    ? (adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`)
    : "";

  useEffect(() => {
    if (!availableAccounts.length) return;
    if (!queryAccountId) {
      setQuery({ account: availableAccounts[0].id });
      return;
    }
    if (!accountsLoading && !availableAccounts.some((acc) => acc.id === queryAccountId)) {
      setQuery({ account: availableAccounts[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableAccounts.length, queryAccountId, accountsLoading]);

  const now = useMemo(() => new Date(), []);
  const defaultEnd = useMemo(() => endOfDay(subDays(startOfDay(now), 1)), [now]);
  const sinceParam = getQuery("since");
  const untilParam = getQuery("until");
  const sinceDate = useMemo(() => {
    if (!sinceParam) return null;
    const numeric = Number(sinceParam);
    if (!Number.isFinite(numeric)) return null;
    const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [sinceParam]);
  const untilDate = useMemo(() => {
    if (!untilParam) return null;
    const numeric = Number(untilParam);
    if (!Number.isFinite(numeric)) return null;
    const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [untilParam]);

  const activePreset = useMemo(() => {
    if (!sinceDate || !untilDate) return "custom";
    const diff = differenceInCalendarDays(endOfDay(untilDate), startOfDay(sinceDate)) + 1;
    const preset = ADS_TOPBAR_PRESETS.find((item) => item.days === diff);
    return preset?.id ?? "custom";
  }, [sinceDate, untilDate]);

  const [adsSyncInfo, setAdsSyncInfo] = useState(() => normalizeSyncInfo(null));

  // Configure Topbar
  useEffect(() => {
    if (!setTopbarConfig) return undefined;
    setTopbarConfig({
      title: "Anúncios",
      showFilters: true,
      presets: ADS_TOPBAR_PRESETS,
      selectedPreset: activePreset,
      onPresetSelect: (presetId) => {
        const preset = ADS_TOPBAR_PRESETS.find((item) => item.id === presetId);
        if (!preset?.days || preset.days <= 0) return;
        const endDate = defaultEnd;
        const startDate = startOfDay(subDays(endDate, preset.days - 1));
        setQuery({
          since: Math.floor(startDate.getTime() / 1000),
          until: Math.floor(endDate.getTime() / 1000),
        });
      },
      onDateChange: (start, end) => {
        if (!start || !end) return;
        const normalizedStart = startOfDay(start);
        const normalizedEnd = endOfDay(end);
        setQuery({
          since: Math.floor(normalizedStart.getTime() / 1000),
          until: Math.floor(normalizedEnd.getTime() / 1000),
        });
      },
    });
    return () => resetTopbarConfig?.();
  }, [setTopbarConfig, resetTopbarConfig, activePreset, adsSyncInfo, defaultEnd, setQuery]);

  useEffect(() => {
    if (sinceDate && untilDate) return;
    const preset = ADS_TOPBAR_PRESETS.find((item) => item.id === "7d") || ADS_TOPBAR_PRESETS[0];
    const endDate = defaultEnd;
    const startDate = startOfDay(subDays(endDate, (preset?.days ?? DEFAULT_ADS_RANGE_DAYS) - 1));
    setQuery({
      since: Math.floor(startDate.getTime() / 1000),
      until: Math.floor(endDate.getTime() / 1000),
    });
  }, [defaultEnd, sinceDate, untilDate, setQuery]);

  // reset quando trocar conta ou range para evitar exibir dados da conta anterior
  useEffect(() => {
    setAdsData(null);
    setAdsComparisonData(null);
    setAdsEnvelope(null);
    setAdsError(null);
  }, [queryAccountId, adAccountId, sinceDate?.getTime?.(), untilDate?.getTime?.()]);

  useEffect(() => {
    const requestId = (adsRequestIdRef.current || 0) + 1;
    adsRequestIdRef.current = requestId;
    let cancelled = false;
    const isStale = () => cancelled || adsRequestIdRef.current !== requestId;
    const loadAds = async () => {
      setAdsLoading(true);
      setAdsError(
        actParam
          ? null
          : { code: "INTEGRATION_ERROR", message: "Conta selecionada nao possui adAccountId configurado." },
      );
      setAdsEnvelope(null);
      if (!actParam) {
        setAdsData(null);
        setAdsComparisonData(null);
        setAdsLoading(false);
        return;
      }
      try {
        const currentSince = sinceDate ? startOfDay(sinceDate) : null;
        const currentUntil = untilDate ? startOfDay(untilDate) : null;

        const currentParams = new URLSearchParams();
        currentParams.set("actId", actParam);
        if (currentSince) currentParams.set("since", format(currentSince, "yyyy-MM-dd"));
        if (currentUntil) currentParams.set("until", format(currentUntil, "yyyy-MM-dd"));

        let previousQuery = null;
        if (currentSince && currentUntil && currentSince <= currentUntil) {
          const periodDays = Math.max(1, differenceInCalendarDays(currentUntil, currentSince) + 1);
          const previousUntil = subDays(currentSince, 1);
          const previousSince = subDays(previousUntil, periodDays - 1);
          const previousParams = new URLSearchParams();
          previousParams.set("actId", actParam);
          previousParams.set("since", format(previousSince, "yyyy-MM-dd"));
          previousParams.set("until", format(previousUntil, "yyyy-MM-dd"));
          previousQuery = previousParams.toString();
        }

        const [currentResp, previousResp] = await Promise.all([
          apiFetch(`/api/ads/highlights?${currentParams.toString()}`),
          previousQuery ? apiFetch(`/api/ads/highlights?${previousQuery}`) : Promise.resolve(null),
        ]);

        if (isStale()) return;

        const currentParsed = parseAdsHighlightsResponse(currentResp);
        const previousParsed = previousResp ? parseAdsHighlightsResponse(previousResp) : null;

        setAdsEnvelope(currentParsed.envelope);
        setAdsData(currentParsed.data);
        setAdsError(currentParsed.error);
        setAdsComparisonData(previousParsed?.data ?? null);
      } catch (err) {
        if (isStale()) return;
        setAdsData(null);
        setAdsComparisonData(null);
        setAdsEnvelope(null);
        setAdsError({
          code: "INTEGRATION_ERROR",
          message: err?.message || "Nao foi possivel carregar dados de anuncios.",
        });
      } finally {
        if (!isStale()) {
          setAdsLoading(false);
        }
      }
    };
    loadAds();
    return () => {
      cancelled = true;
    };
  }, [adAccountId, apiFetch, sinceDate, untilDate, adsReloadKey]);

  // Fetch Instagram profile picture
  useEffect(() => {
    const fetchInstagramProfile = async () => {
      if (!selectedAccount?.instagramUserId) return;

      try {
        const params = new URLSearchParams({ igUserId: selectedAccount.instagramUserId, limit: "1" });
        const url = `${API_BASE_URL}/api/instagram/posts?${params.toString()}`;
        const resp = await fetchWithTimeout(url, { headers: authHeaders });
        const json = unwrapApiData(await resp.json(), {});

        if (json.account) {
          setInstagramProfileData({
            username: json.account.username || json.account.name,
            profilePicture: json.account.profile_picture_url,
          });
        }
      } catch (err) {
        console.warn(`Falha ao carregar foto de perfil do Instagram.`, err);
      }
    };

    fetchInstagramProfile();
  }, [selectedAccount?.instagramUserId, authHeaders]);

  const formatNumber = (num) => {
    if (typeof num !== "number") return num;
    return new Intl.NumberFormat("pt-BR").format(num);
  };

  const formatCurrency = (num) => {
    if (typeof num !== "number") return num;
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(num);
  };

  const formatPercentage = (num) => {
    if (!Number.isFinite(num)) return num;
    return num.toFixed(2);
  };

  const getFiniteNumber = (value, fallback = null) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    return fallback;
  };

  const computeDeltaPercentage = (current, previous) => {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
      return null;
    }
    return ((current - previous) / previous) * 100;
  };

  const getDeltaMeta = (delta, invert = false) => {
    if (!Number.isFinite(delta)) {
      return { text: "—", color: "#9ca3af" };
    }
    const rounded = Number(formatPercentage(Number(delta)));
    const isPositive = rounded > 0;
    const isNegative = rounded < 0;
    let color = "#6b7280";
    if (invert) {
      if (isPositive) color = "#ef4444";
      else if (isNegative) color = "#10b981";
    } else if (isPositive) {
      color = "#10b981";
    } else if (isNegative) {
      color = "#ef4444";
    }
    const prefix = rounded > 0 ? "+" : "";
    return { text: `${prefix}${formatPercentage(rounded)}%`, color };
  };

  const resolveConversionsTotal = (actionsList) => {
    if (!Array.isArray(actionsList) || !actionsList.length) return 0;
    const targetTypes = [
      "offsite_conversion",
      "onsite_conversion.purchase",
      "purchase",
      "lead",
      "complete_registration",
    ];
    for (const target of targetTypes) {
      const found = actionsList.find((action) => (action?.type || "").includes(target));
      if (found?.value != null) return Number(found.value) || 0;
    }
    return 0;
  };

  const formatDuration = (seconds) => {
    if (!Number.isFinite(seconds)) return "--";
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds - mins * 60);
    if (secs <= 0) return `${mins}m`;
    return `${mins}m ${secs}s`;
  };

  const formatShortDate = (value) => formatChartDate(value, "short");
  const formatTooltipDate = (value) => formatChartDate(value, "medium");

  const normalizeAdsError = (err) => {
    if (!err) return null;
    if (typeof err === "string") {
      return { code: "INTEGRATION_ERROR", message: err };
    }
    if (typeof err === "object") {
      const code = err.code ? String(err.code).toUpperCase() : null;
      const message = err.message || err.error || "";
      return {
        code: code || "INTEGRATION_ERROR",
        message: message || "Falha ao carregar dados.",
      };
    }
    return { code: "INTEGRATION_ERROR", message: String(err) };
  };

  const adsErrorInfo = useMemo(() => normalizeAdsError(adsError), [adsError]);
  const adsErrorCode = adsErrorInfo?.code || null;
  const retryAds = () => setAdsReloadKey((value) => value + 1);
  const reconnectAccount = () => navigate("/configuracoes/contas");

  const formatCacheDate = (value) => {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    return format(parsed, "dd/MM HH:mm");
  };

  const adsMeta = useMemo(() => {
    if (adsEnvelope && typeof adsEnvelope === "object" && adsEnvelope.meta) {
      return adsEnvelope.meta;
    }
    if (adsData && typeof adsData === "object" && adsData.cache) {
      return {
        status: adsData.cache.source,
        fetched_at: adsData.cache.fetched_at,
      };
    }
    return null;
  }, [adsEnvelope, adsData]);

  useEffect(() => {
    setAdsSyncInfo(normalizeSyncInfo(adsMeta));
  }, [adsMeta]);

  const cacheNotice = useMemo(() => {
    if (!adsMeta || typeof adsMeta !== "object") return "";
    const status = adsMeta.status || adsMeta.source;
    if (!status || !["cache", "stale", "cache-fallback"].includes(status)) return "";
    const suffix = status === "stale" ? " (desatualizado)" : status === "cache-fallback" ? " (fallback)" : "";
    const fetchedAt = formatCacheDate(adsMeta.fetched_at);
    if (fetchedAt) {
      return `Dados em cache${suffix} - Atualizado em ${fetchedAt}`;
    }
    return `Dados em cache${suffix}`;
  }, [adsMeta]);

  const totals = adsData?.totals || {};
  const averages = adsData?.averages || {};
  const actions = Array.isArray(adsData?.actions) ? adsData.actions : [];
  const previousTotals = adsComparisonData?.totals || {};
  const previousAverages = adsComparisonData?.averages || {};
  const previousActions = Array.isArray(adsComparisonData?.actions) ? adsComparisonData.actions : [];

  const conversions = useMemo(() => resolveConversionsTotal(actions), [actions]);
  const previousConversions = useMemo(() => resolveConversionsTotal(previousActions), [previousActions]);

  const spendValue = getFiniteNumber(totals.spend, 0);
  const previousSpendValue = getFiniteNumber(previousTotals.spend, null);
  const impressionsValue = getFiniteNumber(totals.impressions, 0);
  const previousImpressionsValue = getFiniteNumber(previousTotals.impressions, null);
  const reachValue = getFiniteNumber(totals.reach, 0);
  const previousReachValue = getFiniteNumber(previousTotals.reach, null);
  const clicksValue = getFiniteNumber(totals.clicks, 0);
  const previousClicksValue = getFiniteNumber(previousTotals.clicks, null);
  const ctrValue = getFiniteNumber(averages.ctr, 0);
  const previousCtrValue = getFiniteNumber(previousAverages.ctr, null);
  const cpcValue = getFiniteNumber(averages.cpc, 0);
  const previousCpcValue = getFiniteNumber(previousAverages.cpc, null);
  const cpaValue = conversions > 0 ? spendValue / conversions : 0;
  const previousCpaValue = previousConversions > 0
    ? (getFiniteNumber(previousTotals.spend, 0) / previousConversions)
    : null;

  const overviewStats = {
    spend: {
      value: spendValue,
      delta: computeDeltaPercentage(spendValue, previousSpendValue),
      label: "Investimento Total",
    },
    impressions: {
      value: impressionsValue,
      delta: computeDeltaPercentage(impressionsValue, previousImpressionsValue),
      label: "Impressões",
    },
    reach: {
      value: reachValue,
      delta: computeDeltaPercentage(reachValue, previousReachValue),
      label: "Alcance",
    },
    clicks: {
      value: clicksValue,
      delta: computeDeltaPercentage(clicksValue, previousClicksValue),
      label: "Cliques",
    },
    ctr: {
      value: ctrValue,
      delta: computeDeltaPercentage(ctrValue, previousCtrValue),
      label: "CTR (taxa de cliques)",
      suffix: "%",
    },
    cpc: {
      value: cpcValue,
      delta: computeDeltaPercentage(cpcValue, previousCpcValue),
      label: "CPC (custo por clique)",
      prefix: "R$",
    },
    cpa: {
      value: cpaValue,
      delta: computeDeltaPercentage(cpaValue, previousCpaValue),
      label: "CPA",
      prefix: "R$",
    },
  };
  const overviewDeltaMeta = {
    spend: getDeltaMeta(overviewStats.spend.delta),
    reach: getDeltaMeta(overviewStats.reach.delta),
    impressions: getDeltaMeta(overviewStats.impressions.delta),
    clicks: getDeltaMeta(overviewStats.clicks.delta),
    ctr: getDeltaMeta(overviewStats.ctr.delta),
    cpc: getDeltaMeta(overviewStats.cpc.delta, true),
  };

  const videoSummary = adsData?.video_summary || {};
  const videoAdsSummary = adsData?.video_ads_summary || null;
  const videoAds = Array.isArray(adsData?.video_ads) ? adsData.video_ads : [];
  const videoAdsTimeseries = Array.isArray(adsData?.video_ads_timeseries) ? adsData.video_ads_timeseries : [];
  const useAdLevelVideoTotals = (videoAdsSummary?.ads_with_views ?? 0) > 0;
  const videoFromActions = useMemo(() => {
    const fallback = {
      views3s: null,
      views10s: null,
      views15s: null,
      views30s: null,
      avgTime: null,
      pct: {},
      thruplay: 0,
      video_play: 0
    };
    actions.forEach((action) => {
      const type = (action?.type || "").toString().toLowerCase();
      const value = Number(action?.value || 0);
      if (!type) return;
      if (type === "video_view" || type === "video_views") {
        fallback.views3s = (fallback.views3s || 0) + value;
      }
      if (type === "video_3_sec_watched_actions" || type === "video_view_3s") {
        fallback.views3s = (fallback.views3s || 0) + value;
      } else if (type === "video_10_sec_watched_actions" || type === "video_view_10s") {
        fallback.views10s = (fallback.views10s || 0) + value;
      } else if (["thruplay", "video_15_sec_watched_actions"].includes(type)) {
        fallback.views15s = (fallback.views15s || 0) + value;
        fallback.thruplay = (fallback.thruplay || 0) + value;
      } else if (type === "video_play_actions" || type === "video_play") {
        fallback.video_play = (fallback.video_play || 0) + value;
      } else if (type === "video_30_sec_watched_actions" || type === "video_view_30s") {
        fallback.views30s = (fallback.views30s || 0) + value;
      } else if (type === "video_avg_time_watched_actions") {
        fallback.avgTime = value;
      } else if (type === "video_p25_watched_actions" || type === "video_view_25p") {
        fallback.pct.p25 = (fallback.pct.p25 || 0) + value;
      } else if (type === "video_p50_watched_actions" || type === "video_view_50p") {
        fallback.pct.p50 = (fallback.pct.p50 || 0) + value;
      } else if (type === "video_p75_watched_actions" || type === "video_view_75p") {
        fallback.pct.p75 = (fallback.pct.p75 || 0) + value;
      } else if (type === "video_p100_watched_actions" || type === "video_view_100p") {
        fallback.pct.p100 = (fallback.pct.p100 || 0) + value;
      }
    });
    return fallback;
  }, [actions]);

  const videoViews3s = Number(
    useAdLevelVideoTotals
      ? (videoAdsSummary?.views_3s ?? 0)
      : (videoSummary.video_views_3s ?? videoFromActions.views3s ?? 0),
  );
  const videoViews10s = Number(
    useAdLevelVideoTotals
      ? (videoAdsSummary?.views_10s ?? 0)
      : (videoSummary.video_views_10s ?? videoFromActions.views10s ?? 0),
  );
  const videoViews15s = Number(
    useAdLevelVideoTotals
      ? (videoAdsSummary?.views_15s ?? 0)
      : (videoSummary.video_views_15s ?? videoSummary.thruplays ?? videoFromActions.views15s ?? 0),
  );
  const videoViews30s = Number(
    useAdLevelVideoTotals
      ? (videoAdsSummary?.views_30s ?? 0)
      : (videoSummary.video_views_30s ?? videoFromActions.views30s ?? 0),
  );
  const adAvgWatchTime = videoAdsSummary?.avg_watch_time;
  const videoAvgTime = Number(
    useAdLevelVideoTotals && adAvgWatchTime != null
      ? adAvgWatchTime
      : videoSummary.video_avg_time_watched != null
        ? videoSummary.video_avg_time_watched
        : videoFromActions.avgTime != null
          ? videoFromActions.avgTime
          : NaN,
  );

  // Métricas de vídeo
  const adVideoPlays = useAdLevelVideoTotals ? Number(videoAdsSummary?.video_play ?? 0) : 0;
  const videoPlays = Number(
    adVideoPlays > 0
      ? adVideoPlays
      : (videoSummary.video_play_actions ?? videoFromActions.video_play ?? 0),
  );
  const videoDropOff = useMemo(() => {
    if (Array.isArray(videoSummary.drop_off_points) && videoSummary.drop_off_points.length) {
      return videoSummary.drop_off_points;
    }
    const pct = videoFromActions.pct || {};
    const entries = [
      { bucket: "25%", quartil: "25%", views: Number(pct.p25 || 0), percentage: 25 },
      { bucket: "50%", quartil: "50%", views: Number(pct.p50 || 0), percentage: 50 },
      { bucket: "75%", quartil: "75%", views: Number(pct.p75 || 0), percentage: 75 },
      { bucket: "100%", quartil: "100%", views: Number(pct.p100 || 0), percentage: 100 },
    ].filter((item) => item.views > 0);
    return entries;
  }, [videoSummary.drop_off_points, videoFromActions.pct]);

  const avgVideoViews = useMemo(() => {
    if (videoAdsSummary && Number.isFinite(videoAdsSummary.avg_views_3s)) {
      return Number(videoAdsSummary.avg_views_3s);
    }
    if (!videoAds.length) return 0;
    const total = videoAds.reduce((sum, ad) => sum + Number(ad?.views_3s || 0), 0);
    const count = videoAds.reduce((sum, ad) => sum + (Number(ad?.views_3s || 0) > 0 ? 1 : 0), 0);
    return count ? total / count : 0;
  }, [videoAds, videoAdsSummary]);

  const videoAdsGrowth = useMemo(() => {
    if (!videoAdsTimeseries.length) return { data: [], lines: [] };
    const ranked = videoAdsTimeseries
      .map((entry) => {
        const series = Array.isArray(entry?.series) ? entry.series : [];
        const total = series.reduce((sum, point) => sum + Number(point?.views_3s || 0), 0);
        return {
          id: entry?.ad_id || entry?.adId || entry?.id,
          name: entry?.ad_name || entry?.adName || entry?.name,
          series,
          total,
        };
      })
      .filter((entry) => entry.id);
    ranked.sort((a, b) => b.total - a.total);
    const topAds = ranked.filter((entry) => entry.total > 0).slice(0, 3);
    if (!topAds.length) return { data: [], lines: [] };
    const dateSet = new Set();
    const seriesMap = new Map();
    topAds.forEach((entry) => {
      const dateMap = new Map();
      entry.series.forEach((point) => {
        const date = point?.date;
        if (!date) return;
        const value = Number(point?.views_3s || 0);
        if (!Number.isFinite(value)) return;
        dateMap.set(date, (dateMap.get(date) || 0) + value);
        dateSet.add(date);
      });
      seriesMap.set(entry.id, dateMap);
    });
    const dates = Array.from(dateSet).sort();
    const data = dates.map((date) => {
      const row = { date };
      topAds.forEach((entry) => {
        const dateMap = seriesMap.get(entry.id);
        row[entry.id] = dateMap ? dateMap.get(date) || 0 : 0;
      });
      return row;
    });
    const lines = topAds.map((entry, index) => ({
      key: entry.id,
      name: entry.name || entry.id,
      color: VIDEO_ADS_GROWTH_COLORS[index % VIDEO_ADS_GROWTH_COLORS.length],
    }));
    return { data, lines };
  }, [videoAdsTimeseries]);

  const videoAdsLabelMap = useMemo(() => {
    const map = {};
    videoAdsGrowth.lines.forEach((line) => {
      if (line?.key) map[line.key] = line.name || line.key;
    });
    return map;
  }, [videoAdsGrowth.lines]);

  const avgVideoViewsDisplay = avgVideoViews > 0 ? formatNumber(Math.round(avgVideoViews)) : "--";

  const videoViewSeries = useMemo(() => {
    const base = [
      { label: "3s", value: videoViews3s },
      { label: "10s", value: videoViews10s },
      { label: "15s", value: videoViews15s },
      { label: "30s", value: videoViews30s },
    ];
    return base.map((item) => ({
      ...item,
      value: Number.isFinite(item.value) ? item.value : 0,
    }));
  }, [videoViews10s, videoViews15s, videoViews30s, videoViews3s]);

  const hasVideoMetrics = useMemo(
    () =>
      videoViewSeries.some((item) => Number.isFinite(item.value) && item.value > 0)
      || Number.isFinite(videoAvgTime)
      || (videoDropOff && videoDropOff.length > 0)
      || videoAdsGrowth.data.length > 0
      || avgVideoViews > 0,
    [videoAvgTime, videoDropOff, videoViewSeries, videoAdsGrowth.data.length, avgVideoViews],
  );

  const spendSeries = useMemo(() => {
    if (Array.isArray(adsData?.spend_series)) return adsData.spend_series;
    return [];
  }, [adsData]);

  const adsHasData = useMemo(() => {
    if (adsErrorCode === "NO_DATA") return false;
    if (!adsData || typeof adsData !== "object") return false;
    const totalsPresent = ["spend", "impressions", "reach", "clicks"].some(
      (key) => Number(totals?.[key] || 0) > 0,
    );
    const hasCampaigns = Array.isArray(adsData.campaigns) && adsData.campaigns.length > 0;
    const hasSpendSeries = Array.isArray(adsData.spend_series) && adsData.spend_series.length > 0;
    const hasCreatives = Array.isArray(adsData.creatives) && adsData.creatives.length > 0;
    const hasActions = Array.isArray(adsData.actions) && adsData.actions.length > 0;
    const hasVideoAds = Array.isArray(adsData.video_ads) && adsData.video_ads.length > 0;
    const hasRegion = Array.isArray(adsData.spend_by_region) && adsData.spend_by_region.length > 0;
    const hasCity = Array.isArray(adsData.spend_by_city) && adsData.spend_by_city.length > 0;
    const demographics = adsData.demographics || {};
    const hasDemographics = [demographics.byGender, demographics.byAge, demographics.byAgeGender, demographics.topSegments]
      .some((entry) => Array.isArray(entry) && entry.length > 0);
    return (
      totalsPresent
      || hasCampaigns
      || hasSpendSeries
      || hasCreatives
      || hasActions
      || hasVideoAds
      || hasRegion
      || hasCity
      || hasDemographics
    );
  }, [adsData, adsErrorCode, totals]);

  const adsFallbackState = useMemo(() => {
    if (adsLoading) return "loading";
    if (!adsHasData) {
      if (!adsErrorCode || adsErrorCode === "NO_DATA") return "empty";
      return "error";
    }
    return "ready";
  }, [adsLoading, adsHasData, adsErrorCode]);

  const adsFallbackProps = useMemo(() => {
    if (adsFallbackState === "loading") {
      return { state: "loading", label: "Carregando anuncios pagos..." };
    }
    if (adsFallbackState === "empty") {
      return {
        state: "empty",
        label: "Nenhum dado disponivel para este periodo",
        hint: "Tente outro periodo ou conta",
      };
    }
    if (adsFallbackState === "error") {
      if (adsErrorCode === "PERMISSION_DENIED") {
        return {
          state: "error",
          label: "Permissao necessaria para acessar estes dados",
          actionLabel: "Reconectar conta",
          onAction: reconnectAccount,
        };
      }
      if (adsErrorCode === "RATE_LIMIT" || adsErrorCode === "INTEGRATION_ERROR") {
        return {
          state: "error",
          label: "Nao foi possivel carregar os dados no momento",
          actionLabel: "Tentar novamente",
          onAction: retryAds,
        };
      }
      return {
        state: "error",
        label: adsErrorInfo?.message || "Nao foi possivel carregar os dados no momento",
        actionLabel: "Tentar novamente",
        onAction: retryAds,
      };
    }
    return null;
  }, [adsFallbackState, adsErrorCode, adsErrorInfo, retryAds, reconnectAccount]);

  const shouldShowAdsFallback = adsFallbackState !== "ready";

  const adsWarningProps = useMemo(() => {
    if (!adsHasData || !adsErrorCode || adsErrorCode === "NO_DATA") return null;
    if (adsErrorCode === "PERMISSION_DENIED") {
      return {
        label: "Permissao necessaria para acessar estes dados",
        actionLabel: "Reconectar conta",
        onAction: reconnectAccount,
      };
    }
    if (adsErrorCode === "RATE_LIMIT" || adsErrorCode === "INTEGRATION_ERROR") {
      return {
        label: "Nao foi possivel atualizar os dados no momento",
        actionLabel: "Tentar novamente",
        onAction: retryAds,
      };
    }
    return {
      label: adsErrorInfo?.message || "Nao foi possivel atualizar os dados no momento",
      actionLabel: "Tentar novamente",
      onAction: retryAds,
    };
  }, [adsHasData, adsErrorCode, adsErrorInfo, retryAds, reconnectAccount]);

  const spendByCity = useMemo(() => {
    const source = Array.isArray(adsData?.spend_by_city)
      ? adsData.spend_by_city
      : Array.isArray(adsData?.spend_by_region)
        ? adsData.spend_by_region
        : [];
    if (!source.length) return [];
    return source
      .filter((item) => Number(item?.spend) > 0 && item?.name)
      .map((item) => ({
        name: item.name,
        value: Number(item.spend) || 0,
        reach: Number(item.reach) || 0,
        impressions: Number(item.impressions) || 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [adsData?.spend_by_city, adsData?.spend_by_region]);

  const topCities = useMemo(() => spendByCity.slice(0, 10), [spendByCity]);
  const topCitiesHeight = useMemo(() => Math.max(220, topCities.length * 32), [topCities.length]);
  const allCitiesHeight = useMemo(() => Math.max(240, spendByCity.length * 28), [spendByCity.length]);

  const audienceAgeGenderData = useMemo(() => {
    const raw = Array.isArray(adsData?.demographics?.byAgeGender)
      ? adsData.demographics.byAgeGender
      : Array.isArray(adsData?.demographics?.topSegments)
        ? adsData.demographics.topSegments
        : [];

    if (!raw.length) return [];

    const normalizeGender = (value) => {
      const text = String(value || "").toLowerCase();
      if (text.startsWith("m")) return "male";
      if (text.startsWith("f")) return "female";
      return "unknown";
    };

    const bucket = new Map();
    raw.forEach((item) => {
      const age = item.age || item.segment || "Desconhecido";
      const gender = normalizeGender(item.gender || item.segment);
      const reach = Number(item.reach || 0);
      const current = bucket.get(age) || { age, male: 0, female: 0, unknown: 0 };
      current[gender] += reach;
      bucket.set(age, current);
    });

    const data = Array.from(bucket.values()).map((entry) => ({
      age: entry.age,
      male: Math.round(entry.male || 0),
      female: Math.round(entry.female || 0),
      unknown: Math.round(entry.unknown || 0),
    }));

    const ageOrder = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
    data.sort((a, b) => {
      const ai = ageOrder.indexOf(a.age);
      const bi = ageOrder.indexOf(b.age);
      if (ai === -1 && bi === -1) return String(a.age).localeCompare(String(b.age));
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    return data;
  }, [adsData?.demographics?.byAgeGender, adsData?.demographics?.topSegments]);

  const hasAudienceAgeGender = useMemo(
    () => audienceAgeGenderData.some((item) => item.male > 0 || item.female > 0 || item.unknown > 0),
    [audienceAgeGenderData],
  );

  const hasUnknownAudienceGender = useMemo(
    () => audienceAgeGenderData.some((item) => item.unknown > 0),
    [audienceAgeGenderData],
  );

  const audienceLocationData = useMemo(() => {
    if (!Array.isArray(adsData?.spend_by_region)) return [];
    const palette = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#0ea5e9", "#f97316", "#84cc16"];
    const raw = adsData.spend_by_region
      .map((item) => {
        const reachValue = Number(item.reach || 0);
        const impressionsValue = Number(item.impressions || 0);
        const value = reachValue > 0 ? reachValue : impressionsValue;
        return {
          name: item.name || "Desconhecido",
          value,
        };
      })
      .filter((item) => item.value > 0);

    if (!raw.length) return [];

    raw.sort((a, b) => b.value - a.value);
    const maxItems = 5;
    const top = raw.slice(0, maxItems);
    const rest = raw.slice(maxItems);
    const restValue = rest.reduce((sum, item) => sum + item.value, 0);
    if (restValue > 0) {
      top.push({ name: "Outros", value: restValue });
    }

    return top.map((item, index) => ({
      ...item,
      color: palette[index % palette.length],
    }));
  }, [adsData?.spend_by_region]);

  const audienceGenderReachData = useMemo(() => {
    if (!Array.isArray(adsData?.demographics?.byGender)) return [];
    const palette = {
      Masculino: "#6366f1",
      Feminino: "#ec4899",
      Indefinido: "#94a3b8",
    };
    const order = ["Masculino", "Feminino", "Indefinido"];
    const normalize = (value) => {
      const text = String(value || "").toLowerCase();
      if (text.startsWith("m")) return "Masculino";
      if (text.startsWith("f")) return "Feminino";
      return "Indefinido";
    };
    const data = adsData.demographics.byGender
      .map((item) => {
        const key = normalize(item.segment || item.gender);
        const label = key === "Masculino" ? "Homens" : key === "Feminino" ? "Mulheres" : "Indefinido";
        return {
          key,
          label,
          value: Math.round(Number(item.reach || 0)),
          color: palette[key] || "#94a3b8",
        };
      })
      .filter((item) => item.value > 0);

    data.sort((a, b) => {
      const ai = order.indexOf(a.key);
      const bi = order.indexOf(b.key);
      if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    return data;
  }, [adsData?.demographics?.byGender]);

  const audienceTopSegments = useMemo(() => {
    if (!Array.isArray(adsData?.demographics?.topSegments)) return [];
    const segments = adsData.demographics.topSegments;
    if (!segments.length) return [];
    const totalReach = Array.isArray(adsData?.demographics?.byAgeGender)
      ? adsData.demographics.byAgeGender.reduce((sum, item) => sum + Number(item.reach || 0), 0)
      : segments.reduce((sum, item) => sum + Number(item.reach || 0), 0);
    return segments.map((segment) => ({
      name: `${segment.age || "N/A"} / ${segment.gender || "Indefinido"}`,
      value: Number(segment.reach || 0),
      percent: totalReach > 0 ? Math.round((Number(segment.reach || 0) / totalReach) * 100) : 0,
    }));
  }, [adsData?.demographics?.topSegments, adsData?.demographics?.byAgeGender]);

  const peakSpendPoint = useMemo(() => {
    const series = spendSeries;
    if (!series.length) return null;
    return series.reduce(
      (acc, point, index) => {
        if (point.value > acc.value) {
          return { value: point.value, index, date: point.date };
        }
        return acc;
      },
      { value: series[0].value, index: 0, date: series[0].date }
    );
  }, [spendSeries]);

  const topCampaigns = useMemo(() => {
    if (Array.isArray(adsData?.campaigns)) {
      // Filtra apenas campanhas ativas, mas considera campanhas sem status como ativas
      return adsData.campaigns
        .filter((campaign) => {
          const status = campaign.effective_status || campaign.status || "";
          if (!status) return true;
          return status.toUpperCase() === "ACTIVE";
        })
        .map((campaign) => ({
          ...campaign,
          objectiveLabel: translateObjective(campaign.objective),
        }));
    }
    return [];
  }, [adsData]);

  const objectivePerformance = useMemo(() => {
    if (!Array.isArray(adsData?.campaigns) || !adsData.campaigns.length) {
      return [];
    }

    const totals = new Map();
    adsData.campaigns.forEach((campaign) => {
      const rawObjective = (campaign.objective || "").toString();
      if (!rawObjective) return;
      const label = translateObjective(rawObjective);

      const prev = totals.get(label) || 0;
      totals.set(label, prev + Number(campaign.spend || 0));
    });

    const entries = Array.from(totals.entries());
    const totalSpend = entries.reduce((sum, [, value]) => sum + value, 0);
    if (!totalSpend) {
      return [];
    }

    const palette = IG_DONUT_COLORS;
    return entries.map(([name, value], index) => ({
      name,
      value: Math.round((value / totalSpend) * 100),
      color: palette[index % palette.length],
    }));
  }, [adsData]);

  const performanceSeries = useMemo(() => {
    if (!adsData || !spendSeries.length) return [];

    const totalImpressions = Number(totals.impressions || 0);
    const totalReach = Number(totals.reach || 0);
    const totalSpend = Number(totals.spend || 0);

    if (totalSpend === 0 || spendSeries.length === 0) {
      return [];
    }

    return spendSeries.map((day) => {
      const proportion = day.value / totalSpend;
      return {
        date: day.date,
        impressions: Math.round(totalImpressions * proportion),
        reach: Math.round(totalReach * proportion),
      };
    });
  }, [adsData, spendSeries, totals.impressions, totals.reach, totals.spend]);

  const topCreatives = useMemo(() => {
    if (Array.isArray(adsData?.creatives) && adsData.creatives.length) {
      return [...adsData.creatives]
        .map((creative) => ({
          id: creative.id || creative.ad_id,
          name: creative.name || creative.ad_name || creative.ad_id || "Anúncio",
          campaign: creative.campaign_name || creative.campaign || "",
          impressions: Number(creative.impressions || 0),
          reach: Number(creative.reach || 0),
          clicks: Number(creative.clicks || 0),
          ctr: Number.isFinite(creative.ctr) ? creative.ctr : Number(creative.ctr || 0),
          spend: Number(creative.spend || 0),
          cpc: Number.isFinite(creative.cpc) ? creative.cpc : Number(creative.cpc || 0),
          conversions: Number(creative.conversions || 0),
          cpa: Number.isFinite(creative.cpa) ? creative.cpa : null,
          followers: Number(creative.followers || creative.followers_gained || creative.new_followers || 0),
          previewUrl: creative.preview_url || creative.thumbnail_url || creative.image_url,
        }))
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 8);
    }
    return [];
  }, [adsData?.creatives]);
  const videoCreativeIds = useMemo(() => {
    const ids = new Set();
    videoAds.forEach((entry) => {
      const id = entry?.ad_id || entry?.id;
      if (id) ids.add(String(id));
    });
    return ids;
  }, [videoAds]);
  const recentPosts = useMemo(
    () => topCreatives.slice(0, 6).map((item, index) => ({
      ...item,
      mediaType: videoCreativeIds.has(String(item.id || "")) ? "video" : "image",
      rankLabel: `${index + 1}º no período`,
    })),
    [topCreatives, videoCreativeIds],
  );
  const adsInsights = useMemo(() => {
    const tones = {
      warning: { icon: "!", color: "#f59e0b" },
      success: { icon: "+", color: "#10b981" },
      info: { icon: "i", color: "#3b82f6" },
    };
    const items = [];
    const addInsight = (type, message) => {
      if (!message || items.length >= 3) return;
      const tone = tones[type] || tones.info;
      items.push({
        id: `insight-${items.length + 1}`,
        type,
        icon: tone.icon,
        color: tone.color,
        message,
      });
    };
    const formatDelta = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return null;
      const sign = numeric > 0 ? "+" : "";
      return `${sign}${formatPercentage(numeric)}%`;
    };

    const cpcDelta = overviewStats?.cpc?.delta;
    const cpcDeltaLabel = formatDelta(cpcDelta);
    if (cpcDeltaLabel) {
      if (cpcDelta >= 5) {
        addInsight("warning", `CPC subiu ${cpcDeltaLabel} vs período anterior.`);
      } else if (cpcDelta <= -5) {
        addInsight("success", `CPC caiu ${cpcDeltaLabel} vs período anterior, com melhor eficiência.`);
      }
    }

    const ctrDelta = overviewStats?.ctr?.delta;
    const ctrDeltaLabel = formatDelta(ctrDelta);
    if (ctrDeltaLabel) {
      if (ctrDelta >= 5) {
        addInsight("success", `CTR subiu ${ctrDeltaLabel} vs período anterior.`);
      } else if (ctrDelta <= -5) {
        addInsight("warning", `CTR caiu ${ctrDeltaLabel} vs período anterior.`);
      }
    }

    const bestCreative = [...topCreatives]
      .filter((item) => Number(item?.clicks || 0) > 0 && Number.isFinite(Number(item?.ctr)))
      .sort((a, b) => (Number(b.ctr || 0) - Number(a.ctr || 0)) || (Number(b.clicks || 0) - Number(a.clicks || 0)))[0];
    if (bestCreative) {
      addInsight(
        "info",
        `Criativo ${bestCreative.name} lidera o CTR com ${formatPercentage(Number(bestCreative.ctr || 0))}% e ${formatNumber(Number(bestCreative.clicks || 0))} cliques.`,
      );
    }

    const strongestCampaign = [...topCampaigns]
      .sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0))[0];
    if (strongestCampaign) {
      addInsight(
        "info",
        `Maior investimento do período: ${strongestCampaign.name} (${formatCurrency(Number(strongestCampaign.spend || 0))}).`,
      );
    }

    if (!items.length && spendValue > 0) {
      addInsight(
        "info",
        `No período, o investimento foi ${formatCurrency(spendValue)} para ${formatNumber(clicksValue)} cliques.`,
      );
    }
    return items;
  }, [overviewStats, topCreatives, topCampaigns, spendValue, clicksValue]);
  const highlightedSpendIndex = activeSpendBar >= 0 ? activeSpendBar : peakSpendPoint?.index ?? -1;
  const highlightedSpendPoint = highlightedSpendIndex >= 0 ? spendSeries[highlightedSpendIndex] : null;

  return (
    <div className="instagram-dashboard instagram-dashboard--clean">
      {/* Container Limpo */}
      <div className="ig-clean-container">
        {/* Hero Gradient - Oxford Blue */}
        <div
          className="ig-hero-gradient"
          aria-hidden="true"
          style={{
            background: 'linear-gradient(180deg, rgba(0, 33, 71, 0.85) 0%, rgba(0, 33, 71, 0.70) 50%, rgba(0, 33, 71, 0.55) 100%)'
          }}
        />

        {/* Header com Logo e Tabs */}
        <div className="ig-clean-header">
          <div className="ig-clean-header__brand">
            <div className="ig-clean-header__logo" style={{ background: 'linear-gradient(135deg, #002147 0%, #002d52 100%)' }}>
              <TrendingUp size={32} color="white" />
            </div>
            <h1>Anúncios</h1>
          </div>

          <nav className="ig-clean-tabs">
            {HERO_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.href ? location.pathname === tab.href : tab.id === "ads";
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

        {adsWarningProps ? (
          <div style={{ marginBottom: "16px" }}>
            <DataState
              state="error"
              inline
              size="sm"
              label={adsWarningProps.label}
              actionLabel={adsWarningProps.actionLabel}
              onAction={adsWarningProps.onAction}
            />
          </div>
        ) : null}

        {/* Grid Principal */}
        <div className="ig-clean-grid">
          {/* Left Column - Overview Card */}
          <div className="ig-clean-grid__left" style={{ gap: 0 }}>
            <section className="ig-profile-vertical" style={{ borderRadius: '16px 16px 0 0' }}>
              {/* Cover com gradiente Ads */}
              <div
                className="ig-profile-vertical__cover"
                style={{
                  background: 'linear-gradient(135deg, #002147 0%, #1e3a5f 50%, #002d52 100%)',
                  minHeight: '120px',
                  borderRadius: '16px 16px 0 0',
                }}
              />

              {/* Avatar */}
              <div className="ig-profile-vertical__avatar-wrapper">
                <div className="ig-profile-vertical__avatar">
                  {instagramProfileData?.profilePicture ? (
                    <img
                      src={instagramProfileData.profilePicture}
                      alt={selectedAccount?.label || 'Perfil'}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <span style={{ display: instagramProfileData?.profilePicture ? 'none' : 'flex' }}>
                    {selectedAccount?.label?.charAt(0)?.toUpperCase() || 'A'}
                  </span>
                </div>
              </div>

              {/* Nome da conta */}
              <div className="ig-profile-vertical__body">
                <h3 className="ig-profile-vertical__username" style={{ marginTop: '-10px' }}>
                  {selectedAccount?.label || 'Conta de Anúncios'}
                </h3>
              </div>

              {/* Grid 3x3 de Métricas */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: '10px',
                padding: '4px 20px 16px'
              }}>
                {shouldShowAdsFallback && adsFallbackProps ? (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <DataState
                      state={adsFallbackProps.state}
                      label={adsFallbackProps.label}
                      hint={adsFallbackProps.hint}
                      size="sm"
                      actionLabel={adsFallbackProps.actionLabel}
                      onAction={adsFallbackProps.onAction}
                    />
                  </div>
                ) : (
                  <>
                {/* Investimento */}
                <div style={{
                  padding: '14px',
                  background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(139, 92, 246, 0.08) 100%)',
                  borderRadius: '12px',
                  border: '1px solid rgba(99, 102, 241, 0.2)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <div style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '6px',
                      background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <DollarSign size={12} color="white" strokeWidth={2.5} />
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#1f2937', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      Investimento
                    </span>
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827', marginBottom: '2px' }}>
                    {formatCurrency(overviewStats.spend.value)}
                  </div>
                  <div style={{ fontSize: '11px', color: overviewDeltaMeta.spend.color, fontWeight: 600 }}>
                    {overviewDeltaMeta.spend.text}
                  </div>
                </div>

                {/* Alcance */}
                <div style={{
                  padding: '14px',
                  background: 'rgba(255, 255, 255, 0.6)',
                  borderRadius: '12px',
                  border: '1px solid rgba(0, 0, 0, 0.08)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <div style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '6px',
                      background: 'rgba(139, 92, 246, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Users size={12} color="#8b5cf6" strokeWidth={2.5} />
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#1f2937', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      Alcance
                    </span>
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827', marginBottom: '2px' }}>
                    {formatNumber(overviewStats.reach.value)}
                  </div>
                  <div style={{ fontSize: '11px', color: overviewDeltaMeta.reach.color, fontWeight: 600 }}>
                    {overviewDeltaMeta.reach.text}
                  </div>
                </div>

                {/* Impressões */}
                <div style={{
                  padding: '14px',
                  background: 'rgba(255, 255, 255, 0.6)',
                  borderRadius: '12px',
                  border: '1px solid rgba(0, 0, 0, 0.08)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <div style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '6px',
                      background: 'rgba(192, 132, 252, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Eye size={12} color="#c084fc" strokeWidth={2.5} />
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#1f2937', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      Impressões
                    </span>
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827', marginBottom: '2px' }}>
                    {formatNumber(overviewStats.impressions.value)}
                  </div>
                  <div style={{ fontSize: '11px', color: overviewDeltaMeta.impressions.color, fontWeight: 600 }}>
                    {overviewDeltaMeta.impressions.text}
                  </div>
                </div>

                {/* Cliques */}
                <div style={{
                  padding: '14px',
                  background: 'rgba(255, 255, 255, 0.6)',
                  borderRadius: '12px',
                  border: '1px solid rgba(0, 0, 0, 0.08)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <div style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '6px',
                      background: 'rgba(216, 180, 254, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <MousePointerClick size={12} color="#d8b4fe" strokeWidth={2.5} />
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#1f2937', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      Cliques
                    </span>
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827', marginBottom: '2px' }}>
                    {formatNumber(overviewStats.clicks.value)}
                  </div>
                  <div style={{ fontSize: '11px', color: overviewDeltaMeta.clicks.color, fontWeight: 600 }}>
                    {overviewDeltaMeta.clicks.text}
                  </div>
                </div>

                {/* CTR */}
                <div style={{
                  padding: '14px',
                  background: 'rgba(255, 255, 255, 0.6)',
                  borderRadius: '12px',
                  border: '1px solid rgba(0, 0, 0, 0.08)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <div style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '6px',
                      background: 'rgba(139, 92, 246, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Target size={12} color="#8b5cf6" strokeWidth={2.5} />
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#1f2937', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      CTR (taxa de cliques)
                    </span>
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827', marginBottom: '2px' }}>
                    {formatPercentage(overviewStats.ctr.value)}%
                  </div>
                  <div style={{ fontSize: '11px', color: overviewDeltaMeta.ctr.color, fontWeight: 600 }}>
                    {overviewDeltaMeta.ctr.text}
                  </div>
                </div>

                {/* CPC */}
                <div style={{
                  padding: '14px',
                  background: 'rgba(255, 255, 255, 0.6)',
                  borderRadius: '12px',
                  border: '1px solid rgba(0, 0, 0, 0.08)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <div style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '6px',
                      background: 'rgba(168, 85, 247, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Activity size={12} color="#a855f7" strokeWidth={2.5} />
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#1f2937', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      CPC (custo por clique)
                    </span>
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827', marginBottom: '2px' }}>
                    {formatCurrency(overviewStats.cpc.value)}
                  </div>
                  <div style={{ fontSize: '11px', color: overviewDeltaMeta.cpc.color, fontWeight: 600 }}>
                    {overviewDeltaMeta.cpc.text}
                  </div>
                </div>

                  </>
                )}
              </div>

              <div className="ig-profile-vertical__divider" />

              <div className="ig-profile-vertical__engagement" style={{ position: "relative" }}>
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Performance de Vídeos</h4>
                  <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Visualizações e retenção</p>
                </div>

                {shouldShowAdsFallback && adsFallbackProps ? (
                  <DataState
                    state={adsFallbackProps.state}
                    label={adsFallbackProps.label}
                    hint={adsFallbackProps.hint}
                    size="sm"
                    actionLabel={adsFallbackProps.actionLabel}
                    onAction={adsFallbackProps.onAction}
                  />
                ) : hasVideoMetrics ? (
                  <div style={{ display: "grid", gap: 20 }}>
                    {/* Card Visualização de 3s com Retenção */}
                    <div style={{
                      background: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: 16,
                      padding: 24,
                      boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                      position: "relative",
                      overflow: "hidden"
                    }}>
                      <div style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 4,
                        background: "linear-gradient(90deg, #0ea5e9, #06b6d4)"
                      }} />
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 13, color: "#6b7280", fontWeight: 600, marginBottom: 8 }}>
                            Visualização de 3s
                          </div>
                          <div style={{ fontSize: 36, fontWeight: 800, color: "#111827" }}>
                            {formatNumber(videoViews3s)}
                          </div>
                        </div>
                        <div style={{
                          background: "linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)",
                          borderRadius: 12,
                          padding: "12px 20px",
                          color: "white",
                          textAlign: "center"
                        }}>
                          <div style={{ fontSize: 11, opacity: 0.9, marginBottom: 2 }}>Retenção</div>
                          <div style={{ fontSize: 24, fontWeight: 800 }}>
                            {videoViews3s > 0 && videoViews10s > 0
                              ? `${((videoViews10s / videoViews3s) * 100).toFixed(1)}%`
                              : "100%"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <DataState
                    state="empty"
                    label="Sem dados de video"
                    hint="Nenhum anuncio de video encontrado para o periodo/conta selecionados"
                    size="sm"
                  />
                )}
              </div>
            </section>

            {/* INSIGHTS AUTOMÁTICOS - ALERTAS IMPORTANTES */}
            <section className="ig-growth-clean" style={{ borderRadius: 0, borderTop: '1px solid #e5e7eb' }}>
              <header className="ig-card-header">
                <div>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>💡</span>
                    INSIGHTS AUTOMÁTICOS
                  </h3>
                  <p className="ig-card-subtitle">Alertas e recomendações inteligentes</p>
                </div>
              </header>

              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {shouldShowAdsFallback && adsFallbackProps ? (
                  <DataState
                    state={adsFallbackProps.state}
                    label={adsFallbackProps.label}
                    hint={adsFallbackProps.hint}
                    size="sm"
                    actionLabel={adsFallbackProps.actionLabel}
                    onAction={adsFallbackProps.onAction}
                  />
                ) : adsInsights.length ? (
                  adsInsights.map((insight) => (
                    <div
                      key={insight.id}
                      style={{
                        background: 'rgba(255, 255, 255, 0.9)',
                        border: `1px solid ${insight.color}30`,
                        borderLeft: `4px solid ${insight.color}`,
                        borderRadius: '8px',
                        padding: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateX(4px)';
                        e.currentTarget.style.boxShadow = `0 4px 12px ${insight.color}20`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateX(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <span style={{ fontSize: '24px' }}>{insight.icon}</span>
                      <span style={{ fontSize: '14px', color: '#374151', fontWeight: 500 }}>
                        {insight.message}
                      </span>
                    </div>
                  ))
                ) : (
                  <DataState
                    state="empty"
                    label="Sem insights relevantes para este período"
                    hint="Aumente a janela do período para identificar tendências"
                    size="sm"
                  />
                )}
              </div>
            </section>

            {/* Performance por Objetivo - Pie Chart */}
            <section className="ig-growth-clean" style={{ borderRadius: '0 0 16px 16px', borderTop: '1px solid #e5e7eb' }}>
              <header className="ig-card-header">
                <div>
                  <h3>Performance por Objetivo</h3>
                  <p className="ig-card-subtitle">Distribuição de investimento</p>
                </div>
              </header>

              <div className="ig-chart-area">
                {shouldShowAdsFallback && adsFallbackProps ? (
                  <DataState
                    state={adsFallbackProps.state}
                    label={adsFallbackProps.label}
                    hint={adsFallbackProps.hint}
                    size="sm"
                    actionLabel={adsFallbackProps.actionLabel}
                    onAction={adsFallbackProps.onAction}
                  />
                ) : objectivePerformance.length === 0 ? (
                  <DataState
                    state="empty"
                    label="Nenhum dado de objetivo para este periodo"
                    hint="Tente outro periodo ou conta"
                    size="sm"
                  />
                ) : (
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={objectivePerformance}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, value }) => `${name}: ${value}%`}
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                          onMouseEnter={(_, index) => setActiveCampaignIndex(index)}
                          onMouseLeave={() => setActiveCampaignIndex(-1)}
                        >
                          {objectivePerformance.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.color}
                              opacity={activeCampaignIndex === -1 || activeCampaignIndex === index ? 1 : 0.5}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          content={(
                            <CustomChartTooltip
                              variant="pie"
                              unit="%"
                              valueFormatter={(v) => `: ${formatTooltipNumber(v)}`}
                              showPercent={false}
                            />
                          )}
                        />
                      </PieChart>
                    </ResponsiveContainer>

                    {/* Legenda personalizada */}
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '12px',
                      justifyContent: 'center',
                      marginTop: '16px',
                      padding: '0 16px'
                    }}>
                      {objectivePerformance.map((entry, index) => (
                        <div
                          key={`legend-${index}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '12px',
                            cursor: 'pointer',
                            opacity: activeCampaignIndex === -1 || activeCampaignIndex === index ? 1 : 0.5,
                            transition: 'opacity 0.2s ease'
                          }}
                          onMouseEnter={() => setActiveCampaignIndex(index)}
                          onMouseLeave={() => setActiveCampaignIndex(-1)}
                        >
                          <span style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '3px',
                            background: entry.color
                          }}></span>
                          <span style={{ color: '#111827', fontWeight: 600 }}>{entry.name}</span>
                          <span style={{ color: '#4b5563' }}>({entry.value}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Right Column - Charts */}
          <div className="ig-clean-grid__right">
            {/* 1. Investimento Chart - PRIORIDADE MÁXIMA */}
            <section className="ig-growth-clean">
              <header className="ig-card-header">
                <div>
                  <h3>Investimento ao longo do tempo</h3>
                  <p className="ig-card-subtitle">Gastos diários em campanhas</p>
                </div>
              </header>

              <div className="ig-chart-area">
                {shouldShowAdsFallback && adsFallbackProps ? (
                  <DataState
                    state={adsFallbackProps.state}
                    label={adsFallbackProps.label}
                    hint={adsFallbackProps.hint}
                    size="md"
                    actionLabel={adsFallbackProps.actionLabel}
                    onAction={adsFallbackProps.onAction}
                  />
                ) : spendSeries.length ? (
                <>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={spendSeries}
                    margin={{ top: 16, right: 28, left: 12, bottom: 8 }}
                    barCategoryGap="35%"
                  >
                        <defs>
                          <linearGradient id="spendBar" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" />
                            <stop offset="100%" stopColor="#8b5cf6" />
                          </linearGradient>
                          <linearGradient id="spendBarActive" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" />
                            <stop offset="100%" stopColor="#8b5cf6" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 8" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: "#9ca3af", fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
                          interval="preserveStartEnd"
                          minTickGap={50}
                          tickFormatter={formatShortDate}
                        />
                        <YAxis
                          tick={{ fill: "#9ca3af", fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(value) => `R$ ${formatCompactNumber(value)}`}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(99, 102, 241, 0.1)" }}
                          content={(
                            <CustomChartTooltip
                              labelFormatter={formatTooltipDate}
                              labelMap={{ value: "Investimento" }}
                              valueFormatter={(value) => `: ${formatCurrency(Number(value))}`}
                            />
                          )}
                        />
                        {highlightedSpendPoint && (
                          <>
                            <ReferenceLine
                              x={highlightedSpendPoint.date}
                              stroke="#111827"
                              strokeDasharray="4 4"
                              strokeOpacity={0.3}
                            />
                            <ReferenceLine
                              y={highlightedSpendPoint.value}
                              stroke="#111827"
                              strokeDasharray="4 4"
                              strokeOpacity={0.35}
                            />
                            <ReferenceDot
                              x={highlightedSpendPoint.date}
                              y={highlightedSpendPoint.value}
                              r={6}
                              fill="#111827"
                              stroke="#ffffff"
                              strokeWidth={2}
                            />
                          </>
                        )}
                        <Bar
                          dataKey="value"
                          radius={[12, 12, 0, 0]}
                          barSize={spendSeries.length > 15 ? 30 : 36}
                          onMouseEnter={(_, index) => setActiveSpendBar(index)}
                          onMouseLeave={() => setActiveSpendBar(-1)}
                          name="Investimento"
                        >
                          {spendSeries.map((entry, index) => (
                            <Cell
                              key={entry.date}
                              fill={index === highlightedSpendIndex ? "url(#spendBarActive)" : "url(#spendBar)"}
                            />
                          ))}
                        </Bar>
                        {spendSeries.length > 15 && (
                          <Brush
                            dataKey="date"
                            height={40}
                            stroke="#8b5cf6"
                            fill="transparent"
                            startIndex={0}
                            endIndex={Math.min(14, spendSeries.length - 1)}
                            travellerWidth={14}
                            y={280}
                          >
                            <BarChart>
                              <Bar dataKey="value" fill="#ddd6fe" radius={[3, 3, 0, 0]} />
                            </BarChart>
                          </Brush>
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                        <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#6366f1' }}></span>
                        <span style={{ color: '#111827', fontWeight: 600 }}>Investimento (R$)</span>
                      </div>
                    </div>
                </>
                ) : (
                  <DataState
                    state="empty"
                    label="Sem dados de investimento no periodo"
                    hint="Tente outro periodo ou conta"
                    size="sm"
                  />
                )}

              </div>
            </section>

            {/* 2. Performance Metrics Chart - KPIs PRINCIPAIS */}
            <section className="ig-growth-clean">
              <header className="ig-card-header">
                <div>
                  <h3>Performance de Métricas</h3>
                  <p className="ig-card-subtitle">Impressões e Alcance ao longo do tempo</p>
                </div>
              </header>

              <div className="ig-chart-area">
                {shouldShowAdsFallback && adsFallbackProps ? (
                  <DataState
                    state={adsFallbackProps.state}
                    label={adsFallbackProps.label}
                    hint={adsFallbackProps.hint}
                    size="md"
                    actionLabel={adsFallbackProps.actionLabel}
                    onAction={adsFallbackProps.onAction}
                  />
                ) : performanceSeries.length ? (
                <>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart
                    data={performanceSeries}
                    margin={{ top: 16, right: 28, left: 12, bottom: 8 }}
                  >
                    <defs>
                      <linearGradient id="impressionsGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 8" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "#9ca3af", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={50}
                      tickFormatter={formatShortDate}
                    />
                    <YAxis
                      tick={{ fill: "#9ca3af", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) => formatCompactNumber(value)}
                    />
                    <Tooltip
                      content={(
                        <CustomChartTooltip
                          labelFormatter={formatTooltipDate}
                          labelMap={{ impressions: "Impressões", reach: "Alcance" }}
                          valueFormatter={(v) => `: ${formatTooltipNumber(v)}`}
                        />
                      )}
                    />
                    <Area
                      type="monotone"
                      dataKey="impressions"
                      stroke="#6366f1"
                      strokeWidth={2}
                      fill="url(#impressionsGradient)"
                    />
                    <Line type="monotone" dataKey="reach" stroke="#f97316" strokeWidth={2} dot={false} />
                    {performanceSeries.length > 15 && (
                      <Brush
                        dataKey="date"
                        height={40}
                        stroke="#6366f1"
                        fill="transparent"
                        startIndex={0}
                        endIndex={Math.min(14, performanceSeries.length - 1)}
                        travellerWidth={14}
                        y={280}
                      >
                        <ComposedChart>
                          <Area dataKey="impressions" fill="#ddd6fe" stroke="none" />
                          <Line dataKey="reach" stroke="#fb923c" strokeWidth={1} dot={false} />
                        </ComposedChart>
                      </Brush>
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#6366f1' }}></span>
                    <span style={{ color: '#111827', fontWeight: 600 }}>Impressões</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#f97316' }}></span>
                    <span style={{ color: '#111827', fontWeight: 600 }}>Alcance</span>
                  </div>
                </div>
                </>
                ) : (
                  <DataState
                    state="empty"
                    label="Sem dados de performance no periodo"
                    hint="Tente outro periodo ou conta"
                    size="sm"
                  />
                )}

              </div>
            </section>

            {/* 2.3 Posts Recentes */}
            <section className="ig-growth-clean">
              <header className="ig-card-header">
                <div>
                  <h3>Posts recentes</h3>
                  <p className="ig-card-subtitle">Últimas publicações da conta</p>
                </div>
              </header>

              <div style={{ marginTop: "16px" }}>
                {shouldShowAdsFallback && adsFallbackProps ? (
                  <DataState
                    state={adsFallbackProps.state}
                    label={adsFallbackProps.label}
                    hint={adsFallbackProps.hint}
                    size="sm"
                    actionLabel={adsFallbackProps.actionLabel}
                    onAction={adsFallbackProps.onAction}
                  />
                ) : recentPosts.length ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                      gap: "16px",
                    }}
                  >
                    {recentPosts.map((post) => {
                      const isVideo = post.mediaType === "video";
                      const mediaLabel = isVideo ? "Video" : "Imagem";
                      return (
                        <div
                          key={post.id || post.name}
                          style={{
                            background: "white",
                            borderRadius: "12px",
                            border: "1px solid #e5e7eb",
                            overflow: "hidden",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                          }}
                        >
                          <div
                            style={{
                              height: "160px",
                              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              position: "relative",
                            }}
                          >
                            {post.previewUrl ? (
                              <img
                                src={post.previewUrl}
                                alt={post.name}
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                            ) : (
                              isVideo ? (
                                <Play size={40} color="rgba(255,255,255,0.8)" fill="rgba(255,255,255,0.55)" />
                              ) : (
                                <Image size={40} color="rgba(255,255,255,0.6)" />
                              )
                            )}
                            {isVideo && post.previewUrl ? (
                              <span
                                style={{
                                  position: "absolute",
                                  left: "50%",
                                  top: "50%",
                                  transform: "translate(-50%, -50%)",
                                  width: "42px",
                                  height: "42px",
                                  borderRadius: "999px",
                                  background: "rgba(17, 24, 39, 0.45)",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <Play size={18} color="#ffffff" fill="#ffffff" />
                              </span>
                            ) : null}
                            <span
                              style={{
                                position: "absolute",
                                top: "8px",
                                right: "8px",
                                background: "rgba(0,0,0,0.6)",
                                color: "white",
                                padding: "4px 8px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: 600,
                              }}
                            >
                              {mediaLabel}
                            </span>
                          </div>
                          <div style={{ padding: "14px" }}>
                            <p
                              style={{
                                fontSize: "13px",
                                color: "#374151",
                                marginBottom: "12px",
                                lineHeight: 1.4,
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              }}
                            >
                              {post.name}
                            </p>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                                gap: "8px 12px",
                                marginBottom: "8px",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "5px", minWidth: 0 }}>
                                <Eye size={13} color="#8b5cf6" />
                                <span style={{ fontSize: "12px", fontWeight: 600, color: "#374151" }}>
                                  {formatNumber(post.impressions || 0)}
                                </span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "5px", minWidth: 0 }}>
                                <MousePointerClick size={13} color="#0ea5e9" />
                                <span style={{ fontSize: "12px", fontWeight: 600, color: "#374151" }}>
                                  {formatNumber(post.clicks || 0)}
                                </span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "5px", minWidth: 0 }}>
                                <Target size={13} color="#10b981" />
                                <span style={{ fontSize: "12px", fontWeight: 600, color: "#374151" }}>
                                  {Number.isFinite(post.ctr) ? `${formatPercentage(post.ctr)}%` : "—"}
                                </span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "5px", minWidth: 0 }}>
                                <DollarSign size={13} color="#f59e0b" />
                                <span style={{ fontSize: "12px", fontWeight: 600, color: "#374151" }}>
                                  {formatCurrency(post.spend || 0)}
                                </span>
                              </div>
                            </div>
                            <div style={{ fontSize: "11px", color: "#9ca3af", fontWeight: 600 }}>
                              {post.rankLabel}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <DataState
                    state="empty"
                    label="Sem posts recentes no período"
                    hint="Tente outro período ou conta"
                    size="sm"
                  />
                )}
              </div>
            </section>

            {/* 2.5 Top Anúncios - Ranking de criativos */}
            <section className="ig-growth-clean">
              <header className="ig-card-header">
                <div>
                  <h3>Top anúncios</h3>
                  <p className="ig-card-subtitle">Criativos com melhor desempenho no período selecionado</p>
                </div>
              </header>

              <div style={{ marginTop: "16px", overflowX: "auto" }}>
                {shouldShowAdsFallback && adsFallbackProps ? (
                  <DataState
                    state={adsFallbackProps.state}
                    label={adsFallbackProps.label}
                    hint={adsFallbackProps.hint}
                    size="sm"
                    actionLabel={adsFallbackProps.actionLabel}
                    onAction={adsFallbackProps.onAction}
                  />
                ) : topCreatives.length ? (
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "separate",
                      borderSpacing: "0 8px",
                      minWidth: "720px",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          background: "transparent",
                          fontSize: "11px",
                          fontWeight: "600",
                          color: "#6b7280",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        <th style={{ textAlign: "left", padding: "8px 12px", width: "28%" }}>Anúncio</th>
                        <th style={{ textAlign: "left", padding: "8px 12px", width: "22%" }}>Campanha</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", width: "10%" }}>Impressões</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", width: "10%" }}>Cliques</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", width: "8%" }}>CTR</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", width: "10%" }}>Investimento</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", width: "10%" }}>CPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topCreatives.map((item) => (
                        <tr
                          key={item.id || item.name}
                          style={{
                            background: "white",
                            boxShadow: "0 8px 24px rgba(0,0,0,0.04)",
                            borderRadius: "12px",
                          }}
                        >
                          <td style={{ padding: "14px 12px", borderTopLeftRadius: "12px", borderBottomLeftRadius: "12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                              <div
                                style={{
                                  width: 80,
                                  height: 80,
                                  borderRadius: 12,
                                  overflow: "hidden",
                                  background: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
                                  boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
                                  flexShrink: 0,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#fff",
                                  fontWeight: 700,
                                  fontSize: "24px",
                                }}
                              >
                                {item.previewUrl ? (
                                  <img
                                    src={item.previewUrl}
                                    alt={item.name}
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                  />
                                ) : (
                                  (item.name || "A").slice(0, 1).toUpperCase()
                                )}
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontWeight: 700, color: "#111827", fontSize: "15px", overflow: "hidden", textOverflow: "ellipsis", marginBottom: "6px" }}>
                                  {item.name}
                                </div>
                                {item.campaign ? (
                                  <div style={{ fontSize: "13px", color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {item.campaign}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: "14px 12px", color: "#374151", fontSize: "13px" }}>{item.campaign || "—"}</td>
                          <td style={{ padding: "14px 12px", textAlign: "right", fontWeight: 600, color: "#111827" }}>
                            {formatNumber(item.impressions)}
                          </td>
                          <td style={{ padding: "14px 12px", textAlign: "right", fontWeight: 600, color: "#111827" }}>
                            {formatNumber(item.clicks)}
                          </td>
                          <td style={{ padding: "14px 12px", textAlign: "right", fontWeight: 700, color: "#0ea5e9" }}>
                            {item.ctr != null ? `${formatPercentage(item.ctr)}%` : "—"}
                          </td>
                          <td style={{ padding: "14px 12px", textAlign: "right", fontWeight: 700, color: "#111827" }}>
                            {formatCurrency(item.spend)}
                          </td>
                          <td style={{ padding: "14px 12px", textAlign: "right", fontWeight: 700, color: "#10b981" }}>
                            {Number.isFinite(item.cpa) ? formatCurrency(item.cpa) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <DataState
                    state="empty"
                    label="Sem criativos registrados para o periodo"
                    hint="Tente outro periodo ou conta"
                    size="sm"
                  />
                )}
              </div>
            </section>

            {/* 3. Top Campaigns Table - IDENTIFICAR O QUE FUNCIONA */}
            <section className="ig-growth-clean">
              <header className="ig-card-header">
                <div>
                  <h3>Campanhas Ativas</h3>
                  <p className="ig-card-subtitle">Ranking por investimento no período filtrado</p>
                </div>
              </header>

              <div style={{ marginTop: "16px", overflowX: "auto" }}>
                {shouldShowAdsFallback && adsFallbackProps ? (
                  <DataState
                    state={adsFallbackProps.state}
                    label={adsFallbackProps.label}
                    hint={adsFallbackProps.hint}
                    size="sm"
                    actionLabel={adsFallbackProps.actionLabel}
                    onAction={adsFallbackProps.onAction}
                  />
                ) : topCampaigns.length ? (
                <table style={{
                  width: "100%",
                  borderCollapse: "separate",
                  borderSpacing: "0 8px",
                  minWidth: "600px"
                }}>
                  <thead>
                    <tr style={{
                      background: "transparent",
                      fontSize: "11px",
                      fontWeight: "600",
                      color: "#6b7280",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em"
                    }}>
                      <th style={{
                        textAlign: "left",
                        padding: "8px 16px",
                        width: "30%",
                        minWidth: "200px",
                        resize: "horizontal",
                        overflow: "hidden"
                      }}>Nome da Campanha</th>
                      <th style={{
                        textAlign: "left",
                        padding: "8px 16px",
                        width: "15%",
                        minWidth: "120px",
                        resize: "horizontal",
                        overflow: "hidden"
                      }}>Objetivo</th>
                      <th style={{
                        textAlign: "right",
                        padding: "8px 16px",
                        width: "15%",
                        minWidth: "100px",
                        resize: "horizontal",
                        overflow: "hidden"
                      }}>Impressões</th>
                      <th style={{
                        textAlign: "right",
                        padding: "8px 16px",
                        width: "12%",
                        minWidth: "90px",
                        resize: "horizontal",
                        overflow: "hidden"
                      }}>Cliques</th>
                      <th style={{
                        textAlign: "right",
                        padding: "8px 16px",
                        width: "10%",
                        minWidth: "70px",
                        resize: "horizontal",
                        overflow: "hidden"
                      }}>CTR</th>
                      <th style={{
                        textAlign: "right",
                        padding: "8px 16px",
                        width: "18%",
                        minWidth: "120px",
                        resize: "horizontal",
                        overflow: "hidden"
                      }}>Investimento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCampaigns.map((campaign, index) => {
                      const objectiveLabel = campaign.objectiveLabel || translateObjective(campaign.objective) || "—";
                      const isConversionObjective = objectiveLabel === "Conversão";
                      const isTrafficObjective = objectiveLabel === "Tráfego" || objectiveLabel === "Cliques";
                      const isAwarenessObjective = objectiveLabel === "Reconhecimento";

                      return (
                      <tr key={campaign.id || campaign.name} style={{
                        background: "linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.85) 100%)",
                        border: "1px solid rgba(0, 0, 0, 0.06)",
                        borderRadius: "10px",
                        transition: "all 0.2s ease",
                        cursor: "pointer"
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "translateY(-2px)";
                        e.currentTarget.style.boxShadow = "0 4px 12px rgba(99, 102, 241, 0.15)";
                        e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.3)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.boxShadow = "none";
                        e.currentTarget.style.borderColor = "rgba(0, 0, 0, 0.06)";
                      }}>
                        <td style={{
                          padding: "16px",
                          fontWeight: "600",
                          fontSize: "14px",
                          color: "#111827",
                          borderTopLeftRadius: "10px",
                          borderBottomLeftRadius: "10px",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: "300px"
                        }} title={campaign.name}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <span style={{
                              width: "32px",
                              height: "32px",
                              borderRadius: "8px",
                              background: `linear-gradient(135deg, ${index % 2 === 0 ? "#6366f1" : "#8b5cf6"} 0%, ${index % 2 === 0 ? "#8b5cf6" : "#a855f7"} 100%)`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "white",
                              fontSize: "13px",
                              fontWeight: "700",
                              flexShrink: 0
                            }}>
                              #{index + 1}
                            </span>
                            <span>{campaign.name || "—"}</span>
                          </div>
                        </td>
                        <td style={{
                          padding: "16px",
                          fontSize: "13px",
                          color: "#6b7280"
                        }}>
                          <span style={{
                            padding: "4px 10px",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: "600",
                            background: isConversionObjective ? "#dbeafe" :
                                       isTrafficObjective ? "#fce7f3" :
                                       isAwarenessObjective ? "#e0e7ff" : "#f3f4f6",
                            color: isConversionObjective ? "#1e40af" :
                                  isTrafficObjective ? "#9f1239" :
                                  isAwarenessObjective ? "#3730a3" : "#374151",
                            whiteSpace: "nowrap"
                          }}>
                            {objectiveLabel}
                          </span>
                        </td>
                        <td style={{
                          padding: "16px",
                          textAlign: "right",
                          fontSize: "14px",
                          fontWeight: "600",
                          color: "#374151"
                        }}>
                          {formatNumber(Number(campaign.impressions || 0))}
                        </td>
                        <td style={{
                          padding: "16px",
                          textAlign: "right",
                          fontSize: "14px",
                          fontWeight: "600",
                          color: "#374151"
                        }}>
                          {formatNumber(Number(campaign.clicks || 0))}
                        </td>
                        <td style={{
                          padding: "16px",
                          textAlign: "right",
                          fontSize: "14px",
                          fontWeight: "700",
                          color: "#6366f1"
                        }}>
                          {campaign.ctr != null ? `${formatPercentage(Number(campaign.ctr))}%` : "—"}
                        </td>
                        <td style={{
                          padding: "16px",
                          textAlign: "right",
                          fontSize: "15px",
                          fontWeight: "700",
                          color: "#111827",
                          borderTopRightRadius: "10px",
                          borderBottomRightRadius: "10px"
                        }}>
                          {formatCurrency(Number(campaign.spend || 0))}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                ) : (
                  <DataState
                    state="empty"
                    label="Sem campanhas ativas no periodo"
                    hint="Tente outro periodo ou conta"
                    size="sm"
                  />
                )}

              </div>
            </section>

            {/* 8. AUDIÊNCIA - DEMOGRAFIA COMPLETA */}
            <section className="ig-growth-clean">
              <header className="ig-card-header">
                <div>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}></span>
                    Audiência
                  </h3>
                  <p className="ig-card-subtitle">Distribuição demográfica e de alcance</p>
                </div>
              </header>

              <div className="ig-audience-grid">
                {shouldShowAdsFallback && adsFallbackProps ? (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <DataState
                      state={adsFallbackProps.state}
                      label={adsFallbackProps.label}
                      hint={adsFallbackProps.hint}
                      size="sm"
                      actionLabel={adsFallbackProps.actionLabel}
                      onAction={adsFallbackProps.onAction}
                    />
                  </div>
                ) : (
                  <>
                {/* Gráfico Idade x Gênero - full width */}
                <div style={{
                  gridColumn: '1 / -1',
                  background: 'rgba(255, 255, 255, 0.9)',
                  border: '1px solid rgba(0, 0, 0, 0.08)',
                  borderRadius: '12px',
                  padding: '20px'
                }}>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '16px' }}>
                    Idade × Gênero
                  </h4>
                  {hasAudienceAgeGender ? (
                    <>
                      <ResponsiveContainer width="100%" height={320}>
                        <BarChart
                          data={audienceAgeGenderData}
                          layout="vertical"
                          margin={{ left: 4, right: 20, top: 8, bottom: 8 }}
                          barGap={3}
                          barCategoryGap="25%"
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                          <XAxis
                            type="number"
                            tick={{ fill: '#6b7280', fontSize: 12 }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(value) => formatCompactNumber(value)}
                          />
                          <YAxis
                            type="category"
                            dataKey="age"
                            tick={{ fill: '#374151', fontSize: 13, fontWeight: 600 }}
                            width={55}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip
                            cursor={{ fill: 'rgba(99, 102, 241, 0.08)' }}
                            content={(
                              <CustomChartTooltip
                                labelFormatter={(value) => `Faixa ${String(value || "")}`}
                                valueFormatter={(v) => `: ${formatTooltipNumber(v)}`}
                              />
                            )}
                          />
                          <Bar dataKey="male" fill="#6366f1" radius={[0, 6, 6, 0]} barSize={14} name="Homens" />
                          <Bar dataKey="female" fill="#ec4899" radius={[0, 6, 6, 0]} barSize={14} name="Mulheres" />
                          {hasUnknownAudienceGender && (
                            <Bar dataKey="unknown" fill="#94a3b8" radius={[0, 6, 6, 0]} barSize={14} name="Indefinido" />
                          )}
                        </BarChart>
                      </ResponsiveContainer>
                      <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '8px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                          <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#6366f1' }}></span>
                          <span style={{ color: '#111827', fontWeight: 600 }}>Homens</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                          <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#ec4899' }}></span>
                          <span style={{ color: '#111827', fontWeight: 600 }}>Mulheres</span>
                        </div>
                        {hasUnknownAudienceGender && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                            <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#94a3b8' }}></span>
                            <span style={{ color: '#111827', fontWeight: 600 }}>Indefinido</span>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <DataState
                      state="empty"
                      label="Sem dados de audiencia por idade e genero"
                      hint="Tente outro periodo ou conta"
                      size="sm"
                    />
                  )}
                </div>

                {/* Gráfico Alcance por gênero - full width, below */}
                <div style={{
                  gridColumn: '1 / -1',
                  background: 'rgba(255, 255, 255, 0.9)',
                  border: '1px solid rgba(0, 0, 0, 0.08)',
                  borderRadius: '12px',
                  padding: '20px'
                }}>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '16px' }}>
                    Alcance Homens x Mulheres
                  </h4>
                  {audienceGenderReachData.length === 0 ? (
                    <DataState
                      state="empty"
                      label="Sem dados de alcance por genero"
                      hint="Tente outro periodo ou conta"
                      size="sm"
                    />
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart
                        data={audienceGenderReachData}
                        layout="vertical"
                        margin={{ left: 4, right: 20, top: 5, bottom: 5 }}
                        barGap={6}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                        <XAxis
                          type="number"
                          tick={{ fill: '#6b7280', fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(value) => formatCompactNumber(value)}
                        />
                        <YAxis
                          type="category"
                          dataKey="label"
                          tick={{ fill: '#374151', fontSize: 13, fontWeight: 600 }}
                          width={75}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          cursor={{ fill: 'rgba(99, 102, 241, 0.08)' }}
                          content={(
                            <CustomChartTooltip
                              labelFormatter={(value) => String(value || "")}
                              labelMap={{ value: "Alcance" }}
                              valueFormatter={(v) => `: ${formatTooltipNumber(v)}`}
                            />
                          )}
                        />
                        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>
                          {audienceGenderReachData.map((entry, index) => (
                            <Cell key={`${entry.label}-${index}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Gráfico Localização */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.9)',
                  border: '1px solid rgba(0, 0, 0, 0.08)',
                  borderRadius: '12px',
                  padding: '20px'
                }}>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '16px' }}>
                    Localização (alcance)
                  </h4>
                  {audienceLocationData.length === 0 ? (
                    <DataState
                      state="empty"
                      label="Sem dados de localizacao no periodo"
                      hint="Tente outro periodo ou conta"
                      size="sm"
                    />
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie
                            data={audienceLocationData}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={70}
                            paddingAngle={4}
                            dataKey="value"
                          >
                            {audienceLocationData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
                        {audienceLocationData.map((item) => (
                          <div key={item.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: item.color }}></span>
                              <span style={{ fontSize: '12px', color: '#111827', fontWeight: 600 }}>{item.name}</span>
                            </div>
                            <span style={{ fontSize: '12px', color: '#111827', fontWeight: 600 }}>
                              {formatNumber(item.value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Top segmentos de audiência */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.9)',
                  border: '1px solid rgba(0, 0, 0, 0.08)',
                  borderRadius: '12px',
                  padding: '20px'
                }}>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '16px' }}>
                    Top segmentos da audiência
                  </h4>
                  {audienceTopSegments.length === 0 ? (
                    <DataState
                      state="empty"
                      label="Sem dados de segmentos para o periodo"
                      hint="Tente outro periodo ou conta"
                      size="sm"
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {audienceTopSegments.map((segment) => (
                        <div key={segment.name}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
                              {segment.name}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1' }}>
                                {segment.percent}%
                              </span>
                              <span style={{ fontSize: '12px', color: '#6b7280' }}>
                                ({formatNumber(segment.value)})
                              </span>
                            </div>
                          </div>
                          <div style={{
                            height: '8px',
                            background: '#e5e7eb',
                            borderRadius: '4px',
                            overflow: 'hidden'
                          }}>
                            <div style={{
                              width: `${segment.percent}%`,
                              height: '100%',
                              background: 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)',
                              borderRadius: '4px',
                              transition: 'width 0.6s ease'
                            }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
