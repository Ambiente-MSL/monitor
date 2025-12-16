import { useState, useMemo, useEffect } from "react";
import { Link, useLocation, useOutletContext } from "react-router-dom";
import { differenceInCalendarDays, endOfDay, startOfDay, subDays } from "date-fns";
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
  Info,
} from "lucide-react";
import { useAccounts } from "../context/AccountsContext";
import { DEFAULT_ACCOUNTS } from "../data/accounts";
import { useAuth } from "../context/AuthContext";
import useQueryState from "../hooks/useQueryState";

const API_BASE_URL = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");

// Hero Tabs
const HERO_TABS = [
  { id: "instagram", label: "Instagram", href: "/instagram", icon: InstagramIcon },
  { id: "facebook", label: "Facebook", href: "/facebook", icon: Facebook },
  { id: "ads", label: "Ads", href: "/ads", icon: BarChart3 },
  { id: "reports", label: "Relatórios", href: "/relatorios", icon: FileText },
  { id: "settings", label: "Configurações", href: "/configuracoes", icon: Settings },
  { id: "admin", label: "Admin", href: "/admin", icon: Shield },
];

const MOCK_SPEND_SERIES = [
  { date: "01/02", value: 1580 },
  { date: "02/02", value: 1720 },
  { date: "03/02", value: 1650 },
  { date: "04/02", value: 1890 },
  { date: "05/02", value: 1950 },
  { date: "06/02", value: 1820 },
  { date: "07/02", value: 2100 },
  { date: "08/02", value: 1980 },
  { date: "09/02", value: 2250 },
  { date: "10/02", value: 2100 },
];

const MOCK_PERFORMANCE_SERIES = [
  { date: "01/02", impressions: 65000, clicks: 1800, conversions: 145 },
  { date: "02/02", impressions: 72000, clicks: 2050, conversions: 168 },
  { date: "03/02", impressions: 68000, clicks: 1920, conversions: 152 },
  { date: "04/02", impressions: 78000, clicks: 2200, conversions: 189 },
  { date: "05/02", impressions: 82000, clicks: 2350, conversions: 205 },
  { date: "06/02", impressions: 75000, clicks: 2100, conversions: 178 },
  { date: "07/02", impressions: 88000, clicks: 2500, conversions: 225 },
];

const MOCK_AGE_DISTRIBUTION = [
  { range: "18-24", value: 15, color: "#6366f1" },
  { range: "25-34", value: 35, color: "#8b5cf6" },
  { range: "35-44", value: 28, color: "#a855f7" },
  { range: "45-54", value: 15, color: "#c084fc" },
  { range: "55+", value: 7, color: "#d8b4fe" },
];

const MOCK_GENDER_DISTRIBUTION = [
  { name: "Homens", value: 45 },
  { name: "Mulheres", value: 55 },
];

const MOCK_TOP_CAMPAIGNS = [
  {
    id: "1",
    name: "Campanha Verão 2025",
    objective: "Conversões",
    impressions: 125000,
    clicks: 3200,
    ctr: 2.56,
    spend: 4500,
    conversions: 380,
    cpa: 11.84,
  },
  {
    id: "2",
    name: "Lançamento Produto X",
    objective: "Tráfego",
    impressions: 98000,
    clicks: 2800,
    ctr: 2.86,
    spend: 3800,
    conversions: 290,
    cpa: 13.1,
  },
  {
    id: "3",
    name: "Promoção Relâmpago",
    objective: "Awareness",
    impressions: 87000,
    clicks: 2500,
    ctr: 2.87,
    spend: 3200,
    conversions: 245,
    cpa: 13.06,
  },
  {
    id: "4",
    name: "Engajamento Stories",
    objective: "Engajamento",
    impressions: 65000,
    clicks: 1950,
    ctr: 3.0,
    spend: 2100,
    conversions: 180,
    cpa: 11.67,
  },
];

const MOCK_DETAILED_CAMPAIGNS = [
  {
    id: "c1",
    name: "Prefeito 2025 - 1ª fase",
    objective: "Conversões",
    spend: 3500,
    impressions: 250000,
    clicks: 5200,
    ctr: 2.1,
    conversions: 220,
    cpa: 15.90,
    status: "active",
    statusLabel: "Ativa"
  },
  {
    id: "c2",
    name: "Tráfego Instagram",
    objective: "Tráfego",
    spend: 1800,
    impressions: 180000,
    clicks: 2400,
    ctr: 1.3,
    conversions: 80,
    cpa: 22.50,
    status: "paused",
    statusLabel: "Pausada"
  },
];

const MOCK_CREATIVES = [
  {
    id: "cr1",
    name: "imagem1.jpg",
    type: "Imagem",
    preview: "📷",
    clicks: 2300,
    ctr: 2.9,
    cpc: 0.85,
    conversions: 145,
    cpa: 14.20,
    roas: 3.2
  },
  {
    id: "cr2",
    name: "video1.mp4",
    type: "Vídeo",
    preview: "🎥",
    clicks: 1100,
    ctr: 1.8,
    cpc: 1.10,
    conversions: 70,
    cpa: 15.70,
    roas: 2.9
  },
  {
    id: "cr3",
    name: "carrossel1.jpg",
    type: "Carrossel",
    preview: "🎨",
    clicks: 1800,
    ctr: 2.4,
    cpc: 0.95,
    conversions: 110,
    cpa: 16.36,
    roas: 2.7
  },
];

const MOCK_AGE_GENDER_DATA = [
  { age: "18-24", male: 850, female: 1200 },
  { age: "25-34", male: 1500, female: 1800 },
  { age: "35-44", male: 1100, female: 950 },
  { age: "45-54", male: 600, female: 700 },
  { age: "55+", male: 400, female: 500 },
];

const MOCK_LOCATION_DATA = [
  { name: "São Paulo", value: 2800, color: "#6366f1" },
  { name: "Rio de Janeiro", value: 1900, color: "#8b5cf6" },
  { name: "Brasília", value: 1200, color: "#a855f7" },
  { name: "Belo Horizonte", value: 950, color: "#c084fc" },
  { name: "Outros", value: 1150, color: "#d8b4fe" },
];

const MOCK_PLACEMENT_DATA = [
  { name: "Feed Instagram", value: 3200, percent: 40 },
  { name: "Stories Instagram", value: 2400, percent: 30 },
  { name: "Feed Facebook", value: 1600, percent: 20 },
  { name: "Reels", value: 800, percent: 10 },
];

const MOCK_FOLLOWERS_PER_CAMPAIGN = [
  { id: "1", name: "Campanha Verao 2025", followers: 1250 },
  { id: "2", name: "Lancamento Produto X", followers: 980 },
  { id: "3", name: "Promocao Relampago", followers: 760 },
  { id: "4", name: "Engajamento Stories", followers: 540 },
  { id: "5", name: "Campanha Retargeting", followers: 420 },
];

const MOCK_INSIGHTS = [
  {
    id: "i1",
    type: "warning",
    icon: "⚠️",
    message: "Custo por resultado ↑ 18% esta semana.",
    color: "#f59e0b"
  },
  {
    id: "i2",
    type: "success",
    icon: "🔥",
    message: "Criativo \"Vídeo 02\" performa 2x melhor que \"Imagem 03\".",
    color: "#10b981"
  },
  {
    id: "i3",
    type: "info",
    icon: "💡",
    message: "Melhor horário para anúncios: 18h-21h (CTR +35%).",
    color: "#3b82f6"
  },
];

const MOCK_CAMPAIGN_PERFORMANCE = [
  { name: "Conversão", value: 35, color: "#6366f1" },
  { name: "Tráfego", value: 28, color: "#8b5cf6" },
  { name: "Reconhecimento", value: 22, color: "#a855f7" },
  { name: "Engajamento", value: 15, color: "#c084fc" },
];

const IG_DONUT_COLORS = ["#6366f1", "#f97316", "#a855f7", "#c084fc", "#d8b4fe"];

const ADS_TOPBAR_PRESETS = [
  { id: "7d", label: "7 dias", days: 7 },
  { id: "1m", label: "1 mês", days: 30 },
  { id: "3m", label: "3 meses", days: 90 },
];

const DEFAULT_ADS_RANGE_DAYS = 7;

const translateObjective = (value) => {
  if (!value) return "";
  const upper = String(value).toUpperCase();
  if (upper === "CONVERSIONS") return "Conversão";
  if (upper === "TRAFFIC" || upper === "LINK_CLICKS") return "Tráfego";
  if (upper === "ENGAGEMENT" || upper === "OUTCOME_ENGAGEMENT") return "Engajamento";
  if (upper === "AWARENESS" || upper === "BRAND_AWARENESS" || upper === "OUTCOME_AWARENESS") return "Reconhecimento";
  return value;
};

export default function AdsDashboard() {
  const location = useLocation();
  const outletContext = useOutletContext() || {};
  const { setTopbarConfig, resetTopbarConfig } = outletContext;
  const { accounts, loading: accountsLoading } = useAccounts();
  const { apiFetch } = useAuth();
  const availableAccounts = useMemo(
    () => (accounts.length ? accounts : DEFAULT_ACCOUNTS),
    [accounts],
  );
  const [getQuery, setQuery] = useQueryState({ account: availableAccounts[0]?.id || "" });
  const queryAccountId = getQuery("account");
  const selectedAccount = useMemo(() => {
    if (!availableAccounts.length) return {};
    return availableAccounts.find((acc) => acc.id === queryAccountId) || availableAccounts[0];
  }, [availableAccounts, queryAccountId]);

  const [activeSpendBar, setActiveSpendBar] = useState(-1);
  const [activeCampaignIndex, setActiveCampaignIndex] = useState(-1);
  const [adsData, setAdsData] = useState(null);
  const [adsError, setAdsError] = useState("");
  const [adsLoading, setAdsLoading] = useState(false);
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
  }, [setTopbarConfig, resetTopbarConfig, activePreset, defaultEnd, setQuery]);

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
    setAdsError("");
  }, [queryAccountId, adAccountId, sinceDate?.getTime?.(), untilDate?.getTime?.()]);

  useEffect(() => {
    let cancelled = false;
    const loadAds = async () => {
      setAdsLoading(true);
      setAdsError(actParam ? "" : "A conta selecionada não possui adAccountId configurado.");
      if (!actParam) {
        setAdsData(null);
        setAdsLoading(false);
        return;
      }
      try {
        const params = new URLSearchParams();
        params.set("actId", actParam);
        if (sinceDate) params.set("since", startOfDay(sinceDate).toISOString());
        if (untilDate) params.set("until", endOfDay(untilDate).toISOString());
        const resp = await apiFetch(`/api/ads/highlights?${params.toString()}`);
        if (cancelled) return;
        setAdsData(resp || {});
      } catch (err) {
        if (cancelled) return;
        setAdsData(null);
        setAdsError(err?.message || "Não foi possível carregar dados de anúncios.");
      } finally {
        if (!cancelled) {
          setAdsLoading(false);
        }
      }
    };
    loadAds();
    return () => {
      cancelled = true;
    };
  }, [adAccountId, apiFetch, sinceDate, untilDate]);

  // Fetch Instagram profile picture
  useEffect(() => {
    const fetchInstagramProfile = async () => {
      if (!selectedAccount?.instagramUserId) return;

      try {
        const params = new URLSearchParams({ igUserId: selectedAccount.instagramUserId, limit: "1" });
        const url = `${API_BASE_URL}/api/instagram/posts?${params.toString()}`;
        const resp = await fetch(url);
        const json = await resp.json();

        if (json.account) {
          setInstagramProfileData({
            username: json.account.username || json.account.name,
            profilePicture: json.account.profile_picture_url,
          });
        }
      } catch (err) {
        console.warn(`Falha ao carregar foto de perfil do Instagram`, err);
      }
    };

    fetchInstagramProfile();
  }, [selectedAccount?.instagramUserId]);

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

  const formatDuration = (seconds) => {
    if (!Number.isFinite(seconds)) return "--";
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds - mins * 60);
    if (secs <= 0) return `${mins}m`;
    return `${mins}m ${secs}s`;
  };

  const totals = adsData?.totals || {};
  const averages = adsData?.averages || {};
  const actions = Array.isArray(adsData?.actions) ? adsData.actions : [];

  const conversions = useMemo(() => {
    if (!actions.length) return 0;
    const targetTypes = [
      "offsite_conversion",
      "onsite_conversion.purchase",
      "purchase",
      "lead",
      "complete_registration",
    ];
    for (const target of targetTypes) {
      const found = actions.find((action) => (action?.type || "").includes(target));
      if (found?.value != null) return Number(found.value) || 0;
    }
    return 0;
  }, [actions]);

  const ctrValue = Number(averages.ctr) || 0;
  const cpcValue = Number(averages.cpc) || 0;
  const cpaValue = conversions > 0 ? (totals.spend || 0) / conversions : 0;

  const overviewStats = {
    spend: { value: Number(totals.spend || 0), delta: 0, label: "Investimento Total" },
    impressions: { value: Number(totals.impressions || 0), delta: 0, label: "Impressões" },
    reach: { value: Number(totals.reach || 0), delta: 0, label: "Alcance" },
    clicks: { value: Number(totals.clicks || 0), delta: 0, label: "Cliques" },
    ctr: { value: ctrValue, delta: 0, label: "CTR (taxa de cliques)", suffix: "%" },
    cpc: { value: cpcValue, delta: 0, label: "CPC (custo por clique)", prefix: "R$" },
  };

  const videoSummary = adsData?.video_summary || {};
  const videoFromActions = useMemo(() => {
    const fallback = { views3s: null, views10s: null, views15s: null, views30s: null, avgTime: null, pct: {} };
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
      } else if (["thruplay", "video_15_sec_watched_actions", "video_play_actions"].includes(type)) {
        fallback.views15s = (fallback.views15s || 0) + value;
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
      } else if (type === "video_p95_watched_actions" || type === "video_view_95p") {
        fallback.pct.p95 = (fallback.pct.p95 || 0) + value;
      }
    });
    return fallback;
  }, [actions]);

  const videoViews3s = Number(videoSummary.video_views_3s ?? videoFromActions.views3s ?? 0);
  const videoViews10s = Number(videoSummary.video_views_10s ?? videoFromActions.views10s ?? 0);
  const videoViews15s = Number(videoSummary.video_views_15s ?? videoSummary.thruplays ?? videoFromActions.views15s ?? 0);
  const videoViews30s = Number(videoSummary.video_views_30s ?? videoFromActions.views30s ?? 0);
  const videoAvgTime = Number(
    videoSummary.video_avg_time_watched != null
      ? videoSummary.video_avg_time_watched
      : videoFromActions.avgTime != null
        ? videoFromActions.avgTime
        : NaN,
  );
  const videoDropOff = useMemo(() => {
    if (Array.isArray(videoSummary.drop_off_points) && videoSummary.drop_off_points.length) {
      return videoSummary.drop_off_points;
    }
    const pct = videoFromActions.pct || {};
    const entries = [
      { bucket: "25%", views: Number(pct.p25 || 0) },
      { bucket: "50%", views: Number(pct.p50 || 0) },
      { bucket: "75%", views: Number(pct.p75 || 0) },
      { bucket: "95%", views: Number(pct.p95 || 0) },
    ].filter((item) => item.views > 0);
    return entries;
  }, [videoSummary.drop_off_points, videoFromActions.pct]);

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
      || (videoDropOff && videoDropOff.length > 0),
    [videoAvgTime, videoDropOff, videoViewSeries],
  );

  // manter compatibilidade com seções que ainda usam o nome antigo
  const MOCK_OVERVIEW_STATS = overviewStats;

  const spendSeries = useMemo(() => {
    if (Array.isArray(adsData?.spend_series)) return adsData.spend_series;
    if (adsData) return [];
    return MOCK_SPEND_SERIES;
  }, [adsData]);

  const spendByRegion = useMemo(() => {
    if (Array.isArray(adsData?.spend_by_region)) {
      return adsData.spend_by_region
        .filter((item) => Number(item?.spend) > 0 && item?.name)
        .map((item) => ({
          name: item.name,
          value: Number(item.spend) || 0,
          reach: Number(item.reach) || 0,
          impressions: Number(item.impressions) || 0,
        }));
    }
    return [];
  }, [adsData]);

  const regionChartHeight = useMemo(() => {
    if (!spendByRegion.length) return 200;
    const base = 180;
    const perItem = 32;
    const padding = 60;
    const max = 420;
    return Math.min(max, Math.max(base, spendByRegion.length * perItem + padding));
  }, [spendByRegion.length]);

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
    if (adsData) return [];
    return MOCK_TOP_CAMPAIGNS;
  }, [adsData]);

  const activeCampaigns = useMemo(() => {
    if (Array.isArray(adsData?.campaigns)) {
      const onlyActive = adsData.campaigns.filter((campaign) => {
        const status = campaign.effective_status || campaign.status || "";
        if (!status) return true; // se backend não retornar status, assume ativo para não esconder dados
        return status.toUpperCase() === "ACTIVE";
      });
      return onlyActive.map((campaign) => ({
        id: campaign.id || campaign.campaign_id || campaign.name,
        name: campaign.name || campaign.campaign_name || "Campanha",
        objective: translateObjective(campaign.objective),
        spend: Number(campaign.spend || 0),
        impressions: Number(campaign.impressions || 0),
        clicks: Number(campaign.clicks || 0),
        ctr: Number.isFinite(campaign.ctr) ? campaign.ctr : Number(campaign.ctr || 0),
        conversions: Number(campaign.conversions || 0),
        cpa: Number.isFinite(campaign.cpa) ? campaign.cpa : null,
        status: (campaign.effective_status || campaign.status || "ACTIVE").toUpperCase(),
      }));
    }
    if (adsData) return [];
    return MOCK_DETAILED_CAMPAIGNS;
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

  // Gera série temporal de impressões e alcance baseada nos dados reais
  const followersPerCampaign = useMemo(() => {
    if (Array.isArray(adsData?.campaigns)) {
      const normalized = adsData.campaigns
        .map((campaign) => {
          const rawFollowers = campaign.followers_gained
            ?? campaign.followers
            ?? campaign.new_followers
            ?? campaign.followersAdded
            ?? campaign.followers_delta;
          const followersValue = Number(rawFollowers);
          return {
            id: campaign.id || campaign.campaign_id || campaign.name,
            name: campaign.name || campaign.campaign_name || "Campanha",
            followers: Number.isFinite(followersValue) ? followersValue : 0,
          };
        })
        .filter((item) => item.id);

      if (normalized.some((item) => item.followers > 0)) {
        return normalized
          .filter((item) => item.followers > 0)
          .sort((a, b) => b.followers - a.followers);
      }
      return [];
    }

    if (adsData) return [];
    return MOCK_FOLLOWERS_PER_CAMPAIGN;
  }, [adsData]);

  const followersPerCampaignTotal = useMemo(
    () => followersPerCampaign.reduce((sum, item) => sum + Number(item.followers || 0), 0),
    [followersPerCampaign]
  );

  const maxFollowersPerCampaign = useMemo(
    () => followersPerCampaign.reduce((max, item) => Math.max(max, Number(item.followers || 0)), 0),
    [followersPerCampaign]
  );

  const performanceSeries = useMemo(() => {
    // Se não temos dados reais, usa o mock
    if (!adsData || !spendSeries.length) {
      return MOCK_PERFORMANCE_SERIES;
    }

    const totalImpressions = Number(totals.impressions || 0);
    const totalReach = Number(totals.reach || 0);
    const totalSpend = Number(totals.spend || 0);

    // Se não temos totais, retorna array vazio
    if (totalSpend === 0 || spendSeries.length === 0) {
      return [];
    }

    // Distribui impressões e alcance proporcionalmente ao spend de cada dia
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

        {/* Título com Foto de Perfil e Nome da Conta */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          marginBottom: '24px'
        }}>
          {/* Foto de Perfil do Instagram */}
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            overflow: 'hidden',
            border: '2px solid rgba(99, 102, 241, 0.2)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
            flexShrink: 0
          }}>
            {instagramProfileData?.profilePicture ? (
              <img
                src={instagramProfileData.profilePicture}
                alt={selectedAccount.label || 'Perfil'}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
            ) : null}
            <div style={{
              width: '100%',
              height: '100%',
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              display: instagramProfileData?.profilePicture ? 'none' : 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '18px',
              fontWeight: 700
            }}>
              {selectedAccount?.label?.charAt(0)?.toUpperCase() || 'A'}
            </div>
          </div>

          {/* Título e Nome da Conta */}
          <div style={{ flex: 1 }}>
            <h2 className="ig-clean-title" style={{ margin: 0, lineHeight: 1.2 }}>Visão Geral</h2>
            {selectedAccount?.label && (
              <p style={{
                margin: '4px 0 0 0',
                fontSize: '14px',
                color: 'white',
                fontWeight: 500
              }}>
                {selectedAccount.label}
              </p>
            )}
          </div>
        </div>

        {/* Grid Principal */}
        <div className="ig-clean-grid">
          {/* Left Column - Overview Card */}
          <div className="ig-clean-grid__left">
            <section className="ig-profile-vertical">
              {/* Grid 3x3 de Métricas */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: '12px',
                padding: '20px 24px'
              }}>
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
                    {formatCurrency(MOCK_OVERVIEW_STATS.spend.value)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>
                    +{MOCK_OVERVIEW_STATS.spend.delta}%
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
                    {formatNumber(MOCK_OVERVIEW_STATS.reach.value)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>
                    +{MOCK_OVERVIEW_STATS.reach.delta}%
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
                    {formatNumber(MOCK_OVERVIEW_STATS.impressions.value)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>
                    +{MOCK_OVERVIEW_STATS.impressions.delta}%
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
                    {formatNumber(MOCK_OVERVIEW_STATS.clicks.value)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>
                    +{MOCK_OVERVIEW_STATS.clicks.delta}%
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
                    {formatPercentage(MOCK_OVERVIEW_STATS.ctr.value)}%
                  </div>
                  <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>
                    +{MOCK_OVERVIEW_STATS.ctr.delta}%
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
                    {formatCurrency(MOCK_OVERVIEW_STATS.cpc.value)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#ef4444', fontWeight: 600 }}>
                    {MOCK_OVERVIEW_STATS.cpc.delta}%
                  </div>
                </div>

              </div>

              <div className="ig-profile-vertical__divider" />

              {/* Mapa do Brasil - Investimento por Região */}
              <div
                className="ig-profile-vertical__engagement"
                style={{ minHeight: 500 }}
              >
                <h4>Investimento por região</h4>
                {spendByRegion.length ? (
                  <>
                    {/* Container do Mapa e Legenda */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: '20px', marginTop: '16px' }}>
                      {/* Mapa do Brasil SVG */}
                      <div style={{ position: 'relative', width: '100%', minHeight: '400px' }}>
                        <svg viewBox="0 0 500 550" style={{ width: '100%', height: 'auto', maxHeight: '450px' }}>
                          {/* Região Norte */}
                          <path d="M150,80 L180,60 L220,70 L240,50 L260,60 L270,90 L250,110 L230,100 L200,120 L170,110 Z"
                            fill={spendByRegion.find(r => r.name.toLowerCase().includes('norte') || r.name === 'Norte')? '#6366f1' : '#e5e7eb'}
                            stroke="#fff" strokeWidth="2" opacity="0.85">
                            <title>Norte</title>
                          </path>

                          {/* Região Nordeste */}
                          <path d="M270,90 L300,80 L330,90 L350,110 L360,140 L340,160 L320,150 L300,130 L280,140 L260,120 Z"
                            fill={spendByRegion.find(r => r.name.toLowerCase().includes('nordeste') || r.name === 'Nordeste')? '#8b5cf6' : '#e5e7eb'}
                            stroke="#fff" strokeWidth="2" opacity="0.85">
                            <title>Nordeste</title>
                          </path>

                          {/* Região Centro-Oeste */}
                          <path d="M170,180 L200,160 L230,170 L250,190 L240,220 L210,230 L180,210 Z"
                            fill={spendByRegion.find(r => r.name.toLowerCase().includes('centro') || r.name === 'Centro-Oeste')? '#ec4899' : '#e5e7eb'}
                            stroke="#fff" strokeWidth="2" opacity="0.85">
                            <title>Centro-Oeste</title>
                          </path>

                          {/* Região Sudeste */}
                          <path d="M230,240 L260,230 L280,250 L290,280 L270,300 L240,290 L220,270 Z"
                            fill={spendByRegion.find(r => r.name.toLowerCase().includes('sudeste') || r.name === 'Sudeste')? '#f59e0b' : '#e5e7eb'}
                            stroke="#fff" strokeWidth="2" opacity="0.85">
                            <title>Sudeste</title>
                          </path>

                          {/* Região Sul */}
                          <path d="M180,310 L210,300 L240,310 L250,340 L230,360 L200,350 L170,330 Z"
                            fill={spendByRegion.find(r => r.name.toLowerCase().includes('sul') || r.name === 'Sul')? '#10b981' : '#e5e7eb'}
                            stroke="#fff" strokeWidth="2" opacity="0.85">
                            <title>Sul</title>
                          </path>

                          {/* Mapa do Brasil mais detalhado */}
                          <g transform="translate(100, 30)">
                            {/* Acre */}
                            <path id="AC" d="M50,150 L70,140 L80,150 L75,165 L60,170 L50,160 Z"
                              fill={spendByRegion.find(r => r.name === 'Acre' || r.name === 'AC')? '#6366f1' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Amazonas */}
                            <path id="AM" d="M80,150 L120,130 L150,140 L160,160 L140,180 L100,170 L75,165 Z"
                              fill={spendByRegion.find(r => r.name === 'Amazonas' || r.name === 'AM')? '#6366f1' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Roraima */}
                            <path id="RR" d="M120,100 L140,90 L155,100 L150,120 L130,125 L120,110 Z"
                              fill={spendByRegion.find(r => r.name === 'Roraima' || r.name === 'RR')? '#6366f1' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Pará */}
                            <path id="PA" d="M160,160 L200,150 L230,160 L240,180 L220,200 L180,195 L160,185 Z"
                              fill={spendByRegion.find(r => r.name === 'Pará' || r.name === 'PA')? '#6366f1' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Maranhão */}
                            <path id="MA" d="M240,180 L270,175 L285,190 L280,210 L260,215 L245,205 Z"
                              fill={spendByRegion.find(r => r.name === 'Maranhão' || r.name === 'MA')? '#8b5cf6' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Piauí */}
                            <path id="PI" d="M280,210 L295,205 L305,220 L300,235 L285,238 L275,225 Z"
                              fill={spendByRegion.find(r => r.name === 'Piauí' || r.name === 'PI')? '#8b5cf6' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Ceará */}
                            <path id="CE" d="M295,205 L315,198 L325,210 L320,225 L305,220 Z"
                              fill={spendByRegion.find(r => r.name === 'Ceará' || r.name === 'CE')? '#8b5cf6' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Rio Grande do Norte */}
                            <path id="RN" d="M325,210 L340,208 L345,218 L340,225 L325,223 Z"
                              fill={spendByRegion.find(r => r.name === 'Rio Grande do Norte' || r.name === 'RN')? '#8b5cf6' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Paraíba */}
                            <path id="PB" d="M340,225 L350,224 L353,232 L348,238 L338,236 Z"
                              fill={spendByRegion.find(r => r.name === 'Paraíba' || r.name === 'PB')? '#8b5cf6' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Pernambuco */}
                            <path id="PE" d="M320,238 L345,235 L355,248 L345,258 L325,255 Z"
                              fill={spendByRegion.find(r => r.name === 'Pernambuco' || r.name === 'PE')? '#8b5cf6' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Bahia */}
                            <path id="BA" d="M260,245 L300,240 L325,255 L330,280 L310,300 L280,295 L265,275 Z"
                              fill={spendByRegion.find(r => r.name === 'Bahia' || r.name === 'BA')? '#8b5cf6' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Mato Grosso */}
                            <path id="MT" d="M140,220 L180,210 L200,230 L195,260 L165,265 L145,245 Z"
                              fill={spendByRegion.find(r => r.name === 'Mato Grosso' || r.name === 'MT')? '#ec4899' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Goiás */}
                            <path id="GO" d="M200,260 L230,255 L245,275 L240,295 L215,295 L200,280 Z"
                              fill={spendByRegion.find(r => r.name === 'Goiás' || r.name === 'GO')? '#ec4899' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Mato Grosso do Sul */}
                            <path id="MS" d="M165,280 L195,275 L210,295 L205,320 L180,320 L170,300 Z"
                              fill={spendByRegion.find(r => r.name === 'Mato Grosso do Sul' || r.name === 'MS')? '#ec4899' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* São Paulo */}
                            <path id="SP" d="M215,310 L245,305 L260,325 L250,345 L225,340 L210,325 Z"
                              fill={spendByRegion.find(r => r.name === 'São Paulo' || r.name === 'SP')? '#f59e0b' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Rio de Janeiro */}
                            <path id="RJ" d="M260,325 L275,323 L280,335 L272,345 L260,343 Z"
                              fill={spendByRegion.find(r => r.name === 'Rio de Janeiro' || r.name === 'RJ')? '#f59e0b' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Minas Gerais */}
                            <path id="MG" d="M240,275 L280,270 L300,285 L295,310 L270,315 L245,305 Z"
                              fill={spendByRegion.find(r => r.name === 'Minas Gerais' || r.name === 'MG')? '#f59e0b' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Paraná */}
                            <path id="PR" d="M205,345 L235,340 L245,360 L230,375 L205,370 Z"
                              fill={spendByRegion.find(r => r.name === 'Paraná' || r.name === 'PR')? '#10b981' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Santa Catarina */}
                            <path id="SC" d="M205,375 L230,372 L240,385 L225,395 L205,390 Z"
                              fill={spendByRegion.find(r => r.name === 'Santa Catarina' || r.name === 'SC')? '#10b981' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />

                            {/* Rio Grande do Sul */}
                            <path id="RS" d="M180,390 L210,385 L225,405 L215,430 L185,425 L175,410 Z"
                              fill={spendByRegion.find(r => r.name === 'Rio Grande do Sul' || r.name === 'RS')? '#10b981' : '#f3f4f6'}
                              stroke="#9ca3af" strokeWidth="0.5" opacity="0.9" />
                          </g>
                        </svg>
                      </div>

                      {/* Legenda */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#6b7280',
                          marginBottom: '8px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px'
                        }}>
                          Regiões
                        </div>
                        {spendByRegion.slice(0, 5).map((region, index) => {
                          const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'];
                          return (
                            <div key={region.name} style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '10px 12px',
                              borderRadius: '10px',
                              background: `${colors[index]}08`,
                              border: `1px solid ${colors[index]}20`,
                              transition: 'all 0.2s ease'
                            }}>
                              <div style={{
                                width: '16px',
                                height: '16px',
                                borderRadius: '4px',
                                background: colors[index],
                                flexShrink: 0
                              }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  color: '#111827',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {region.name}
                                </div>
                                <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                                  {formatCurrency(region.value)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="ig-empty-state">Sem dados regionais para o período.</div>
                )}
              </div>

              <div className="ig-profile-vertical__divider" />

              <div className="ig-profile-vertical__engagement" style={{ position: "relative" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h4 style={{ margin: 0 }}>Views de vídeos pagos</h4>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#6b7280", fontSize: 12 }}>
                    <Info size={14} />
                    <span>Dados de todos os vídeos em anúncios pagos</span>
                  </div>
                </div>

                <div
                  style={{
                    padding: "12px",
                    borderRadius: "14px",
                    background: "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(14,165,233,0.12))",
                    border: "1px solid rgba(59,130,246,0.15)",
                  }}
                >
                  {adsLoading ? (
                    <div className="ig-empty-state">Carregando...</div>
                  ) : hasVideoMetrics ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px" }}>
                      <div style={{ height: 220 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={videoViewSeries}
                            layout="vertical"
                            margin={{ top: 10, right: 20, bottom: 10, left: 30 }}
                            barCategoryGap={14}
                          >
                            <defs>
                              <linearGradient id="adsVideoBar" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor="#0ea5e9" />
                                <stop offset="50%" stopColor="#6366f1" />
                                <stop offset="100%" stopColor="#a855f7" />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 6" horizontal={false} stroke="#e5e7eb" />
                            <XAxis
                              type="number"
                              tick={{ fill: "#6b7280", fontSize: 11 }}
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(value) => formatNumber(value)}
                            />
                            <YAxis
                              type="category"
                              dataKey="label"
                              width={32}
                              tick={{ fill: "#111827", fontWeight: 700, fontSize: 12 }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              cursor={{ fill: "rgba(14,165,233,0.08)" }}
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const item = payload[0]?.payload;
                                return (
                                  <div className="ig-tooltip">
                                    <span className="ig-tooltip__title">{`Views ${item?.label}`}</span>
                                    <div className="ig-tooltip__row">
                                      <span>Total</span>
                                      <strong>{formatNumber(item?.value || 0)}</strong>
                                    </div>
                                  </div>
                                );
                              }}
                            />
                            <Bar dataKey="value" radius={[6, 6, 6, 6]} fill="url(#adsVideoBar)" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
                        <div
                          className="ig-overview-stat"
                          style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "12px" }}
                        >
                          <div className="ig-overview-stat__value">{formatNumber(videoViews15s)}</div>
                          <div className="ig-overview-stat__label">Views 15s (thruplays)</div>
                        </div>
                        <div
                          className="ig-overview-stat"
                          style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "12px" }}
                        >
                          <div className="ig-overview-stat__value">{formatDuration(videoAvgTime)}</div>
                          <div className="ig-overview-stat__label">Tempo médio assistido</div>
                        </div>
                      </div>
                      {videoDropOff?.length ? (
                        <div
                          style={{
                            background: "white",
                            border: "1px solid #e5e7eb",
                            borderRadius: "12px",
                            padding: "12px",
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                            gap: "8px",
                          }}
                        >
                          {videoDropOff.map((item) => (
                            <div
                              key={item.bucket}
                              style={{
                                background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(14,165,233,0.08))",
                                border: "1px solid rgba(99,102,241,0.15)",
                                borderRadius: "10px",
                                padding: "10px",
                                display: "flex",
                                flexDirection: "column",
                                gap: "4px",
                              }}
                            >
                              <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Queda {item.bucket}</span>
                              <span style={{ fontSize: 18, fontWeight: 700, color: "#0ea5e9" }}>
                                {formatNumber(item.views || 0)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="ig-empty-state">Sem dados de vídeo para o período/conta selecionados</div>
                  )}
                </div>
              </div>
            </section>

            {/* INSIGHTS AUTOMÁTICOS - ALERTAS IMPORTANTES */}
            <section className="ig-growth-clean">
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
                {MOCK_INSIGHTS.map((insight) => (
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
                ))}
              </div>
            </section>

            {/* Performance por Objetivo - Pie Chart */}
            <section className="ig-growth-clean">
              <header className="ig-card-header">
                <div>
                  <h3>Performance por Objetivo</h3>
                  <p className="ig-card-subtitle">Distribuição de investimento</p>
                </div>
              </header>

              <div className="ig-chart-area">
                {objectivePerformance.length === 0 ? (
                  <div style={{ padding: "16px", fontSize: "13px", color: "#6b7280" }}>
                    Não encontramos campanhas com objetivo configurado para este período e conta selecionada.
                  </div>
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
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            return (
                              <div className="ig-follower-tooltip">
                                <div className="ig-follower-tooltip__label">{payload[0].payload.name}</div>
                                <div className="ig-follower-tooltip__date">{payload[0].value}%</div>
                              </div>
                            );
                          }}
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
                          <span style={{ color: '#374151', fontWeight: 500 }}>{entry.name}</span>
                          <span style={{ color: '#6b7280' }}>({entry.value}%)</span>
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
                <ResponsiveContainer width="100%" height={spendSeries.length > 15 ? 380 : 280}>
                  <BarChart
                    data={spendSeries}
                    margin={{ top: 16, right: 16, bottom: spendSeries.length > 15 ? 70 : 32, left: 0 }}
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
                        />
                        <YAxis
                          tick={{ fill: "#9ca3af", fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(value) => `R$ ${formatNumber(value)}`}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(99, 102, 241, 0.1)" }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            return (
                              <div className="ig-follower-tooltip">
                                <div className="ig-follower-tooltip__label">
                                  Investimento: {formatCurrency(payload[0].value)}
                                </div>
                                <div className="ig-follower-tooltip__date">{payload[0].payload.date}</div>
                              </div>
                            );
                          }}
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
                <ResponsiveContainer width="100%" height={performanceSeries.length > 15 ? 380 : 280}>
                  <ComposedChart
                    data={performanceSeries}
                    margin={{ top: 16, right: 16, bottom: performanceSeries.length > 15 ? 70 : 32, left: 0 }}
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
                    />
                    <YAxis
                      tick={{ fill: "#9ca3af", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) => {
                        if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                        if (value >= 1000) return `${Math.round(value / 1000)}k`;
                        return value;
                      }}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="ig-follower-tooltip">
                            <div className="ig-follower-tooltip__date">{payload[0].payload.date}</div>
                            <div className="ig-follower-tooltip__label">
                              Impressões: {formatNumber(payload[0].payload.impressions)}
                            </div>
                            <div className="ig-follower-tooltip__label">
                              Alcance: {formatNumber(payload[0].payload.reach)}
                            </div>
                          </div>
                        );
                      }}
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
                {topCreatives.length ? (
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
                        <th style={{ textAlign: "right", padding: "8px 12px", width: "10%" }}>Seguidores</th>
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
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <div
                                style={{
                                  width: 48,
                                  height: 48,
                                  borderRadius: 10,
                                  overflow: "hidden",
                                  background: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
                                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                                  flexShrink: 0,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#fff",
                                  fontWeight: 700,
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
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 700, color: "#111827", fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {item.name}
                                </div>
                                {item.campaign ? (
                                  <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px", overflow: "hidden", textOverflow: "ellipsis" }}>
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
                          <td style={{ padding: "14px 12px", textAlign: "right", fontWeight: 700, color: "#10b981" }}>
                            {formatNumber(item.followers || 0)}
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
                  <div className="ig-empty-state" style={{ padding: "20px" }}>
                    Sem criativos registrados para o período/conta selecionados.
                  </div>
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
                    {topCampaigns.map((campaign, index) => (
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
                            background: campaign.objective === "Conversões" ? "#dbeafe" :
                                       campaign.objective === "Tráfego" ? "#fce7f3" :
                                       campaign.objectiveLabel === "Reconhecimento" ? "#e0e7ff" : "#f3f4f6",
                            color: campaign.objective === "Conversões" ? "#1e40af" :
                                  campaign.objective === "Tráfego" ? "#9f1239" :
                                  campaign.objectiveLabel === "Reconhecimento" ? "#3730a3" : "#374151",
                            whiteSpace: "nowrap"
                          }}>
                            {campaign.objective || "—"}
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
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 8. SEGMENTAÇÃO E PÚBLICO - DEMOGRAFIA COMPLETA */}
            <section className="ig-growth-clean">
              <header className="ig-card-header">
                <div>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>🧭</span>
                    Segmentação e público
                  </h3>
                  <p className="ig-card-subtitle">Distribuição demográfica e comportamental</p>
                </div>
              </header>

              <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
                {/* Gráfico Idade x Gênero */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.9)',
                  border: '1px solid rgba(0, 0, 0, 0.08)',
                  borderRadius: '12px',
                  padding: '20px'
                }}>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '16px' }}>
                    Idade × Gênero
                  </h4>
                  <div style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden' }}>
                    <div style={{ minWidth: Math.max(MOCK_AGE_GENDER_DATA.length * 60, 100) + '%' }}>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart
                          data={MOCK_AGE_GENDER_DATA}
                          layout="vertical"
                          margin={{ left: 0, right: 10, top: 5, bottom: 5 }}
                          barGap={4}
                          barCategoryGap="20%"
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                          <XAxis
                            type="number"
                            tick={{ fill: '#6b7280', fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            type="category"
                            dataKey="age"
                            tick={{ fill: '#374151', fontSize: 12, fontWeight: 600 }}
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
                              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                              fontSize: '12px'
                            }}
                          />
                          <Bar dataKey="male" fill="#6366f1" radius={[0, 6, 6, 0]} barSize={12} name="Homens" />
                          <Bar dataKey="female" fill="#ec4899" radius={[0, 6, 6, 0]} barSize={12} name="Mulheres" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                      <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#6366f1' }}></span>
                      <span style={{ color: '#6b7280', fontWeight: 500 }}>Homens</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                      <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#ec4899' }}></span>
                      <span style={{ color: '#6b7280', fontWeight: 500 }}>Mulheres</span>
                    </div>
                  </div>
                </div>

                {/* Gráfico Localização */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.9)',
                  border: '1px solid rgba(0, 0, 0, 0.08)',
                  borderRadius: '12px',
                  padding: '20px'
                }}>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '16px' }}>
                    Localização
                  </h4>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={MOCK_LOCATION_DATA}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {MOCK_LOCATION_DATA.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => Number(value).toLocaleString("pt-BR")}
                        contentStyle={{
                          backgroundColor: 'white',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                          fontSize: '12px'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
                    {MOCK_LOCATION_DATA.map((item) => (
                      <div key={item.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: item.color }}></span>
                          <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}>{item.name}</span>
                        </div>
                        <span style={{ fontSize: '12px', color: '#111827', fontWeight: 600 }}>
                          {formatNumber(item.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Seguidores ganhos por campanha */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.9)',
                  border: '1px solid rgba(0, 0, 0, 0.08)',
                  borderRadius: '12px',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                    <div>
                      <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
                        Seguidores ganhos por campanha
                      </h4>
                      <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>
                        Crescimento atribuido ao periodo filtrado
                      </p>
                    </div>
                    <div style={{
                      padding: '10px 12px',
                      borderRadius: '10px',
                      background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 50%, #a855f7 100%)',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: '12px',
                      boxShadow: '0 6px 16px rgba(99, 102, 241, 0.2)',
                      whiteSpace: 'nowrap'
                    }}>
                      {formatNumber(followersPerCampaignTotal || 0)} seguidores
                    </div>
                  </div>

                  {followersPerCampaign.length === 0 ? (
                    <div
                      className="ig-empty-state"
                      style={{ minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}
                    >
                      Sem dados de seguidores para o periodo/conta selecionados.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {followersPerCampaign.slice(0, 6).map((campaign, index) => {
                        const followersValue = Number(campaign.followers || 0);
                        const barWidth = maxFollowersPerCampaign > 0
                          ? Math.min(100, (followersValue / maxFollowersPerCampaign) * 100)
                          : 0;
                        const percentShare = followersPerCampaignTotal > 0
                          ? Math.round((followersValue / followersPerCampaignTotal) * 100)
                          : 0;

                        return (
                          <div key={campaign.id || index} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                <span style={{
                                  width: '22px',
                                  height: '22px',
                                  borderRadius: '6px',
                                  background: '#eef2ff',
                                  color: '#4338ca',
                                  fontWeight: 700,
                                  fontSize: '12px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0
                                }}>
                                  {index + 1}
                                </span>
                                <span style={{
                                  fontSize: '13px',
                                  color: '#111827',
                                  fontWeight: 600,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {campaign.name}
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                                <span style={{ fontWeight: 700, color: '#0f172a' }}>{formatNumber(followersValue)}</span>
                                <span style={{ color: '#6b7280', fontWeight: 600 }}>+{percentShare}%</span>
                              </div>
                            </div>
                            <div style={{ height: '8px', background: '#f3f4f6', borderRadius: '999px', overflow: 'hidden' }}>
                              <div style={{
                                width: `${barWidth}%`,
                                height: '100%',
                                background: 'linear-gradient(90deg, #0ea5e9 0%, #6366f1 50%, #a855f7 100%)',
                                borderRadius: '999px',
                                transition: 'width 0.4s ease'
                              }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Gráfico Posicionamento */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.9)',
                  border: '1px solid rgba(0, 0, 0, 0.08)',
                  borderRadius: '12px',
                  padding: '20px'
                }}>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '16px' }}>
                    Posicionamento
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {MOCK_PLACEMENT_DATA.map((placement) => (
                      <div key={placement.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
                            {placement.name}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1' }}>
                              {placement.percent}%
                            </span>
                            <span style={{ fontSize: '12px', color: '#6b7280' }}>
                              ({formatNumber(placement.value)})
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
                            width: `${placement.percent}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)',
                            borderRadius: '4px',
                            transition: 'width 0.6s ease'
                          }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* 9. EXPORTAR - AÇÃO FINAL */}
            <section className="ig-growth-clean">
              <header className="ig-card-header">
                <div>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>📥</span>
                    EXPORTAR
                  </h3>
                  <p className="ig-card-subtitle">Última atualização: 10/11/2025 às 03:00</p>
                </div>
              </header>

              <div style={{ marginTop: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <button
                  style={{
                    padding: '12px 24px',
                    background: 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 2px 8px rgba(220, 38, 38, 0.25)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(220, 38, 38, 0.35)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(220, 38, 38, 0.25)';
                  }}
                >
                  <FileText size={16} />
                  Exportar PDF
                </button>

                <button
                  style={{
                    padding: '12px 24px',
                    background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 2px 8px rgba(5, 150, 105, 0.25)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(5, 150, 105, 0.35)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(5, 150, 105, 0.25)';
                  }}
                >
                  <BarChart3 size={16} />
                  Exportar CSV
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
