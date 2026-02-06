import { useEffect, useMemo, useState, useCallback } from 'react';

import { Facebook, Instagram } from 'lucide-react';
import { useOutletContext, Link, useLocation } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

import Section from '../components/Section';

import AccountSelect from '../components/AccountSelect';
import DataState from '../components/DataState';

import useQueryState from '../hooks/useQueryState';

import { useAccounts } from '../context/AccountsContext';
import { useAuth } from '../context/AuthContext';

import { DEFAULT_ACCOUNTS } from '../data/accounts';
import { getApiErrorMessage, unwrapApiData } from '../lib/apiEnvelope';
import { fetchWithTimeout, isTimeoutError } from '../lib/fetchWithTimeout';



const API_BASE_URL = (process.env.REACT_APP_API_URL || '').replace(/\/$/, '');

const FALLBACK_ACCOUNT_ID = DEFAULT_ACCOUNTS[0]?.id || '';

const FACEBOOK_FEATURE_ENABLED = false;



const safeNumber = (value) => {

  const num = Number(value);

  return Number.isFinite(num) ? num : 0;

};



const parseFiniteNumber = (value) => {

  if (value == null || value === '') return null;

  const num = Number(value);

  return Number.isFinite(num) ? num : null;

};



const formatNumber = (value, fallback = 'N/A') => {

  if (value == null) return fallback;

  const num = Number(value);

  if (!Number.isFinite(num)) return fallback;

  return num.toLocaleString('pt-BR');

};







const formatDateTime = (iso) => {

  if (!iso) return 'N/A';

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return 'N/A';

  return new Intl.DateTimeFormat('pt-BR', {

    dateStyle: 'short',

    timeStyle: 'short',

  }).format(date);

};



const toIsoDate = (value) => {

  if (!value) return null;

  const num = Number(value);

  if (!Number.isFinite(num)) return null;

  const ms = num > 1_000_000_000_000 ? num : num * 1000;

  return new Date(ms).toISOString().slice(0, 10);

};



const getMetric = (payload, key) => payload?.metrics?.find((item) => item.key === key) || null;



export default function DashboardHome() {

  const outletContext = useOutletContext() || {};
const { setTopbarConfig, resetTopbarConfig } = outletContext;
  const { search } = useLocation();
  const buildLink = (pathname) => (search ? { pathname, search } : pathname);

  const { token } = useAuth();
  const { accounts, loading: accountsLoading } = useAccounts();

  const availableAccounts = accounts.length ? accounts : DEFAULT_ACCOUNTS;

  const topbarAccountControl = useMemo(() => <AccountSelect />, []);

  useEffect(() => {
    if (!setTopbarConfig) return undefined;
    setTopbarConfig({
      title: "Visao Geral",
      showFilters: false,
      rightExtras: topbarAccountControl,
    });
    return () => resetTopbarConfig?.();
  }, [setTopbarConfig, resetTopbarConfig, topbarAccountControl]);

  const [get, setQuery] = useQueryState({ account: FALLBACK_ACCOUNT_ID });

  const accountIdQuery = get('account');



  useEffect(() => {
    if (!availableAccounts.length) return;
    if (!accountIdQuery) {
      setQuery({ account: availableAccounts[0].id });
      return;
    }
    if (!accountsLoading && !availableAccounts.some((account) => account.id === accountIdQuery)) {
      setQuery({ account: availableAccounts[0].id });
    }
  }, [availableAccounts, accountIdQuery, setQuery, accountsLoading]);



  const accountId = accountIdQuery && availableAccounts.some((account) => account.id === accountIdQuery)

    ? accountIdQuery

    : availableAccounts[0]?.id || '';



  const accountConfig = useMemo(

    () => availableAccounts.find((item) => item.id === accountId) || null,

    [availableAccounts, accountId],

  );



  const since = get('since');

  const until = get('until');
  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  );
  const fetchJson = useCallback(async (url) => {
    let response;
    try {
      response = await fetchWithTimeout(url, { headers: authHeaders });
    } catch (err) {
      if (isTimeoutError(err)) {
        throw new Error("Tempo esgotado ao carregar dados.");
      }
      throw err;
    }
    const raw = await response.text();
    let json = {};
    if (raw) {
      try {
        json = JSON.parse(raw);
      } catch (err) {
        json = {};
      }
    }
    if (!response.ok) {
      throw new Error(getApiErrorMessage(json, `HTTP ${response.status}`));
    }
    return unwrapApiData(json, {});
  }, [authHeaders]);

  const [instagramReach30d, setInstagramReach30d] = useState({ value: null, cacheAt: null });




  useEffect(() => {

    if (!get('since') || !get('until')) {

      const now = Math.floor(Date.now() / 1000);

      const defaultUntil = now;

      const defaultSince = now - 6 * 86400;

      setQuery({

        since: String(defaultSince),

        until: String(defaultUntil),

      });

    }

  }, [get, setQuery]);



  const [loading, setLoading] = useState(true);

  const [error, setError] = useState(null);

  const [facebookSummary, setFacebookSummary] = useState(null);

  const [instagramSummary, setInstagramSummary] = useState(null);

  const [adsSummary, setAdsSummary] = useState(null);




  useEffect(() => {

    let active = true;

    const accountKey = accountConfig?.id || null;



    const loadOverview = async () => {

      setLoading(true);

      setError(null);



      const warnings = [];

      let nextFacebook = null;

      let nextInstagram = null;

      let nextAds = null;




      if (FACEBOOK_FEATURE_ENABLED && accountConfig?.facebookPageId) {

        try {

          const params = new URLSearchParams();

          params.set('pageId', accountConfig.facebookPageId);

          if (since) params.set('since', since);

          if (until) params.set('until', until);



          const data = await fetchJson(`${API_BASE_URL}/api/facebook/metrics?${params.toString()}`);

          const reachMetric = getMetric(data, 'reach');

          const engagementMetric = getMetric(data, 'post_engagement_total');

          const pageViewsMetric = getMetric(data, 'page_views');

          const followersMetric = getMetric(data, 'followers_total');

          const followerNet = safeNumber(data.page_overview?.net_followers);

          const followersTotal = safeNumber(followersMetric?.value ?? data.page_overview?.followers_total);



          nextFacebook = {

            accountId: accountKey,

            reach: safeNumber(reachMetric?.value),

            reachGrowth: reachMetric?.deltaPct,

            engagement: safeNumber(engagementMetric?.value),

            engagementGrowth: engagementMetric?.deltaPct,

            pageViews: safeNumber(pageViewsMetric?.value),

            followersNet: followerNet,

            followersTotal,

            cacheAt: data.cache?.fetched_at || null,

          };

        } catch (err) {

          warnings.push(`Facebook: ${err.message}`);

        }

      }



      if (accountConfig?.instagramUserId) {

        try {

          const params = new URLSearchParams();

          params.set('igUserId', accountConfig.instagramUserId);

          if (since) params.set('since', since);

          if (until) params.set('until', until);



          const data = await fetchJson(`${API_BASE_URL}/api/instagram/metrics?${params.toString()}`);

          const reachMetric = getMetric(data, 'reach');

          const interactionsMetric = getMetric(data, 'interactions');

          const profileViewsMetric = getMetric(data, 'profile_views');

          const followerMetric = getMetric(data, 'followers_total');

          const followerCountsRaw = data.follower_counts || {};

          const followersTotal =

            parseFiniteNumber(followerCountsRaw?.end) ?? parseFiniteNumber(followerMetric?.value);

          const followerCounts = {

            start: parseFiniteNumber(followerCountsRaw?.start),

            end: parseFiniteNumber(followerCountsRaw?.end),

            follows: parseFiniteNumber(followerCountsRaw?.follows),

            unfollows: parseFiniteNumber(followerCountsRaw?.unfollows),

          };

          let accountFollowers = null;

          try {

            const postsParams = new URLSearchParams({

              igUserId: accountConfig.instagramUserId,

              limit: '1',

            });

            const postsData = await fetchJson(`${API_BASE_URL}/api/instagram/posts?${postsParams.toString()}`);

            accountFollowers = parseFiniteNumber(postsData?.account?.followers_count);

          } catch (err) {

            warnings.push(`Instagram account: ${err.message}`);

          }

          const resolvedFollowersTotal = accountFollowers ?? followersTotal ?? null;

          if (resolvedFollowersTotal != null && followerCounts.end == null) {

            followerCounts.end = resolvedFollowersTotal;

          }



          nextInstagram = {

            accountId: accountKey,

            reach: safeNumber(reachMetric?.value),

            reachGrowth: reachMetric?.deltaPct,

            engagement: safeNumber(interactionsMetric?.value),

            engagementGrowth: interactionsMetric?.deltaPct,

            profileViews: safeNumber(profileViewsMetric?.value),

            followersTotal: resolvedFollowersTotal,

            followerCounts,

            cacheAt: data.cache?.fetched_at || null,

          };

        } catch (err) {

          warnings.push(`Instagram: ${err.message}`);

        }

      }



      if (accountConfig?.adAccountId) {

        try {

          const params = new URLSearchParams({ actId: accountConfig.adAccountId });

          const isoSince = toIsoDate(since);

          const isoUntil = toIsoDate(until);

          if (isoSince) params.set('since', isoSince);

          if (isoUntil) params.set('until', isoUntil);



          const data = await fetchJson(`${API_BASE_URL}/api/ads/highlights?${params.toString()}`);

          nextAds = {

            accountId: accountKey,

            spend: safeNumber(data.totals?.spend),

            clicks: safeNumber(data.totals?.clicks),

            reach: safeNumber(data.totals?.reach),

            bestAd: data.best_ad || null,

            cacheAt: data.cache?.fetched_at || null,

          };

        } catch (err) {

          warnings.push(`Ads: ${err.message}`);

        }

      }



      if (active) {

        setFacebookSummary(nextFacebook);

        setInstagramSummary(nextInstagram);

        setAdsSummary(nextAds);

        setError(warnings.length ? warnings.join(' - ') : null);

        setLoading(false);

      }

    };



    loadOverview();



    return () => {

      active = false;

    };

  }, [

    accountConfig?.id,

    accountConfig?.facebookPageId,

    accountConfig?.instagramUserId,

    accountConfig?.adAccountId,

    since,

    until,

    fetchJson,
  ]);




  useEffect(() => {

    let active = true;

    const igUserId = accountConfig?.instagramUserId;

    if (!igUserId) {

      setInstagramReach30d({ value: null, cacheAt: null });

      return () => {

        active = false;

      };

    }

    const loadReach30Days = async () => {

      try {

        const nowSec = Math.floor(Date.now() / 1000);

        const thirtyDaysSec = 30 * 86400;

        const untilTs = nowSec;

        const sinceTs = Math.max(0, untilTs - thirtyDaysSec);

        const params = new URLSearchParams();

        params.set('igUserId', igUserId);

        params.set('since', String(sinceTs));

        params.set('until', String(untilTs));

        const data = await fetchJson(`${API_BASE_URL}/api/instagram/metrics?${params.toString()}`);

        if (!active) return;

        const reachMetric = getMetric(data, 'reach');

        setInstagramReach30d({

          value: safeNumber(reachMetric?.value),

          cacheAt: data.cache?.fetched_at || null,

        });

      } catch (err) {

        if (!active) return;

        console.warn(`Instagram 30 dias: ${err.message}`);

        setInstagramReach30d({ value: null, cacheAt: null });

      }

    };

    loadReach30Days();

    return () => {

      active = false;

    };

  }, [accountConfig?.instagramUserId, fetchJson]);

  const currentAccountId = accountConfig?.id;

  const currentFacebookSummary =

    facebookSummary?.accountId === currentAccountId ? facebookSummary : null;

  const currentInstagramSummary = useMemo(
    () => {
      if (instagramSummary?.accountId !== currentAccountId) return null;
      return {
        ...instagramSummary,
        reach30Days: instagramReach30d?.value ?? null,
        reach30DaysCacheAt: instagramReach30d?.cacheAt ?? null,
      };
    },
    [instagramSummary, currentAccountId, instagramReach30d],
  );


  const currentAdsSummary = adsSummary?.accountId === currentAccountId ? adsSummary : null;

  const lastSyncAt = useMemo(() => {

    const timestamps = [

      currentFacebookSummary?.cacheAt,

      currentInstagramSummary?.cacheAt,

      currentAdsSummary?.cacheAt,

    ]

      .map((value) => {

        if (!value) return null;

        const time = Date.parse(value);

        return Number.isFinite(time) ? time : null;

      })

      .filter((value) => value != null);

    if (!timestamps.length) return null;

    return new Date(Math.max(...timestamps)).toISOString();

  }, [

    currentFacebookSummary?.cacheAt,

    currentInstagramSummary?.cacheAt,

    currentAdsSummary?.cacheAt,

  ]);
  const reachByPlatformData = useMemo(() => {

    const data = [];



    if (currentFacebookSummary?.reach != null && currentFacebookSummary.reach > 0) {

      data.push({

        name: 'Facebook',

        value: currentFacebookSummary.reach,

        color: '#1877F2',

      });

    }



    if (currentInstagramSummary?.reach != null && currentInstagramSummary.reach > 0) {

      data.push({

        name: 'Instagram',

        value: currentInstagramSummary.reach,

        color: '#E4405F',

      });

    }



    return data;

  }, [currentFacebookSummary?.reach, currentInstagramSummary?.reach]);



  return (

    <>
      <div className="page-content">

        {lastSyncAt && (

          <div className="overview-meta">

            <span className="overview-meta__label">Ultima atualizacao:</span>

            <time dateTime={lastSyncAt}>{formatDateTime(lastSyncAt)}</time>

          </div>

        )}

        {error && (

          <div className="overview-alert">

            <strong>Algumas fontes nao retornaram dados:</strong> {error}

          </div>

        )}



        <Section

          title="Resumo geral da conta"

          description="Principais indicadores da pÃ¡gina e perfil selecionados."

          right={<span className="overview-current-account">{accountConfig?.label}</span>}>

          {loading && !currentFacebookSummary && !currentInstagramSummary ? (

            <DataState state="loading" label="Carregando visao geral..." size="sm" />

          ) : (

            <div className="overview-highlight">

              <Link to={buildLink("/instagram")} className="overview-highlight-card overview-highlight-card--instagram">

                <span className="overview-highlight-label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Instagram size={18} /> Seguidores no Instagram
                </span>

                <span className="overview-highlight-value">

                  {formatNumber(currentInstagramSummary?.followersTotal)}

                </span>

                <span className="overview-highlight-extra">

                  Alcance (30 dias): {formatNumber(currentInstagramSummary?.reach30Days)}

                </span>

                <span className="overview-highlight-foot">

                  Atualizado em {formatDateTime(currentInstagramSummary?.reach30DaysCacheAt || currentInstagramSummary?.cacheAt)}

                </span>

              </Link>

              {FACEBOOK_FEATURE_ENABLED ? (
                <Link to={buildLink("/facebook")} className="overview-highlight-card overview-highlight-card--facebook">
                  <span className="overview-highlight-label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Facebook size={18} /> Curtidas da pagina
                  </span>
                  <span className="overview-highlight-value">
                    {formatNumber(currentFacebookSummary?.followersTotal)}
                  </span>
                  <span className="overview-highlight-foot">
                    Atualizado em {formatDateTime(currentFacebookSummary?.cacheAt)}
                  </span>
                </Link>
              ) : null}

            </div>

          )}

        </Section>

        <Section

          title="Alcance por Plataforma"

          description="Comparativo de alcance entre Facebook e Instagram dos Ãºltimos 30 dias.">

          {loading && !currentFacebookSummary && !currentInstagramSummary ? (

            <DataState state="loading" label="Carregando dados..." size="sm" />

          ) : reachByPlatformData.length === 0 ? (

            <DataState state="empty" label="Nenhum dado de alcance disponivel para o periodo selecionado." size="sm" />

          ) : (

            <div className="dashboard-chart">

              <ResponsiveContainer width="100%" height={200}>

                <BarChart

                  data={reachByPlatformData}

                  layout="vertical"

                  margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>

                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />

                  <XAxis type="number" stroke="#888" />

                  <YAxis dataKey="name" type="category" stroke="#888" width={100} />

                  <Tooltip

                    contentStyle={{

                      backgroundColor: 'rgba(0,0,0,0.9)',

                      border: '1px solid rgba(255,255,255,0.2)',

                      borderRadius: '8px',

                    }}

                    formatter={(value) => [formatNumber(value), 'Alcance']}

                    labelFormatter={(label) => label}

                  />

                  <Bar dataKey="value" radius={[0, 8, 8, 0]}>

                    {reachByPlatformData.map((entry, index) => (

                      <Cell key={`cell-${index}`} fill={entry.color} />

                    ))}

                  </Bar>

                </BarChart>

              </ResponsiveContainer>

            </div>

          )}

        </Section>

      </div>

    </>

  );

}



