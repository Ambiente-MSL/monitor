import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Download, FileText, RefreshCcw } from "lucide-react";
import { jsPDF } from "jspdf";
import Papa from "papaparse";
import NavigationHero from "../components/NavigationHero";
import DataState from "../components/DataState";
import { useAuth } from "../context/AuthContext";
import { useAccounts } from "../context/AccountsContext";
import useQueryState from "../hooks/useQueryState";
import { unwrapApiData } from "../lib/apiEnvelope";

const NETWORK_OPTIONS = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "ads", label: "Ads" },
];

const NETWORK_LABEL = {
  instagram: "Instagram",
  facebook: "Facebook",
  ads: "Ads",
};

const METRIC_CATALOG = {
  instagram: [
    { key: "followers_total", label: "Seguidores" },
    { key: "reach", label: "Alcance" },
    { key: "video_views", label: "Visualizacoes" },
    { key: "profile_views", label: "Visitas ao perfil" },
    { key: "interactions", label: "Interacoes" },
    { key: "likes", label: "Curtidas" },
    { key: "comments", label: "Comentarios" },
    { key: "shares", label: "Compartilhamentos" },
    { key: "saves", label: "Salvamentos" },
    { key: "engagement_rate", label: "Taxa de engajamento" },
    { key: "video_avg_watch_time", label: "Tempo medio assistido (s)" },
    { key: "follower_growth", label: "Crescimento de seguidores" },
  ],
  facebook: [
    { key: "reach", label: "Alcance organico" },
    { key: "post_engagement_total", label: "Engajamento post" },
    { key: "engaged_users", label: "Usuarios engajados" },
    { key: "page_views", label: "Visualizacoes da pagina" },
    { key: "content_activity", label: "Interacoes totais" },
    { key: "cta_clicks", label: "Cliques em CTA" },
    { key: "post_clicks", label: "Cliques em posts" },
    { key: "followers_total", label: "Seguidores da pagina" },
    { key: "followers_gained", label: "Novos seguidores" },
    { key: "followers_lost", label: "Deixaram de seguir" },
    { key: "net_followers", label: "Crescimento liquido" },
    { key: "video_views_total", label: "Video views" },
    { key: "video_engagement_total", label: "Engajamento de video" },
    { key: "video_watch_time_total", label: "Tempo total assistido (s)" },
  ],
  ads: [
    { key: "spend", label: "Investimento" },
    { key: "impressions", label: "Impressoes" },
    { key: "reach", label: "Alcance" },
    { key: "clicks", label: "Cliques" },
    { key: "ctr", label: "CTR" },
    { key: "cpc", label: "CPC" },
    { key: "cpm", label: "CPM" },
    { key: "frequency", label: "Frequencia" },
    { key: "actions_total", label: "Acoes totais" },
    { key: "campaign_count", label: "Campanhas ativas" },
  ],
};

const CURRENCY_KEYS = new Set(["spend", "cpc", "cpm", "cpa"]);
const PERCENT_KEYS = new Set(["ctr", "engagement_rate"]);
const SECONDS_KEYS = new Set(["video_avg_watch_time", "video_watch_time_total"]);

const numberFormatter = new Intl.NumberFormat("pt-BR");
const decimalFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const pad2 = (value) => String(value).padStart(2, "0");

const dateToInputValue = (date) => {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
};

const getInitialDateRange = () => {
  const until = new Date();
  const since = new Date(until);
  since.setDate(until.getDate() - 29);
  return {
    since: dateToInputValue(since),
    until: dateToInputValue(until),
  };
};

const parseDateInput = (value, withEndOfDay = false) => {
  if (!value) return null;
  const suffix = withEndOfDay ? "T23:59:59" : "T00:00:00";
  const parsed = new Date(`${value}${suffix}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toUnixSeconds = (date) => Math.floor(date.getTime() / 1000);

const sanitizeFilename = (value) => {
  const normalized = String(value || "relatorio")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const cleaned = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "relatorio";
};

const toNumberOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const formatMetricValue = (key, value) => {
  const numeric = toNumberOrNull(value);
  if (numeric == null) return "-";
  if (CURRENCY_KEYS.has(key)) return currencyFormatter.format(numeric);
  if (PERCENT_KEYS.has(key)) return `${decimalFormatter.format(numeric)}%`;
  if (SECONDS_KEYS.has(key)) return `${decimalFormatter.format(numeric)} s`;
  if (Number.isInteger(numeric)) return numberFormatter.format(numeric);
  return decimalFormatter.format(numeric);
};

const formatDelta = (value) => {
  const numeric = toNumberOrNull(value);
  if (numeric == null) return "-";
  const prefix = numeric > 0 ? "+" : "";
  return `${prefix}${decimalFormatter.format(numeric)}%`;
};

const defaultMetricKeys = (network) => {
  const catalog = METRIC_CATALOG[network] || [];
  return catalog.slice(0, Math.min(6, catalog.length)).map((item) => item.key);
};

const buildMetricRowsFromList = (metrics, network) => {
  const catalog = METRIC_CATALOG[network] || [];
  const map = new Map();

  if (Array.isArray(metrics)) {
    metrics.forEach((metric) => {
      const key = String(metric?.key || "").trim();
      if (!key) return;
      map.set(key, {
        key,
        label: metric?.label || key,
        value: metric?.value,
        deltaPct: metric?.deltaPct,
      });
    });
  }

  catalog.forEach((item) => {
    if (!map.has(item.key)) {
      map.set(item.key, {
        key: item.key,
        label: item.label,
        value: null,
        deltaPct: null,
      });
    } else {
      const existing = map.get(item.key);
      if (existing && !existing.label) {
        existing.label = item.label;
      }
    }
  });

  return Array.from(map.values());
};

const buildAdsMetricRows = (payload) => {
  const totals = payload?.totals || {};
  const averages = payload?.averages || {};
  const actions = Array.isArray(payload?.actions) ? payload.actions : [];
  const campaigns = Array.isArray(payload?.campaigns) ? payload.campaigns : [];

  const actionsTotal = actions.reduce((sum, action) => {
    const value = toNumberOrNull(action?.value);
    if (value == null) return sum;
    return sum + value;
  }, 0);

  return [
    { key: "spend", label: "Investimento", value: totals.spend, deltaPct: null },
    { key: "impressions", label: "Impressoes", value: totals.impressions, deltaPct: null },
    { key: "reach", label: "Alcance", value: totals.reach, deltaPct: null },
    { key: "clicks", label: "Cliques", value: totals.clicks, deltaPct: null },
    { key: "ctr", label: "CTR", value: averages.ctr, deltaPct: null },
    { key: "cpc", label: "CPC", value: averages.cpc, deltaPct: null },
    { key: "cpm", label: "CPM", value: averages.cpm, deltaPct: null },
    { key: "frequency", label: "Frequencia", value: averages.frequency, deltaPct: null },
    { key: "actions_total", label: "Acoes totais", value: actionsTotal, deltaPct: null },
    { key: "campaign_count", label: "Campanhas ativas", value: campaigns.length, deltaPct: null },
  ];
};

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const rowsToCsv = (report) =>
  report.rows.map((row) => ({
    metrica: row.label,
    valor: row.formattedValue,
    variacao: formatDelta(row.deltaPct),
    chave: row.key,
  }));

const reportToPdf = (report) => {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const left = 40;
  const right = pageWidth - 40;
  let y = 44;

  doc.setFontSize(18);
  doc.text(report.name, left, y);
  y += 20;

  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(`Conta: ${report.accountLabel}`, left, y);
  y += 14;
  doc.text(`Rede: ${NETWORK_LABEL[report.network] || report.network}`, left, y);
  y += 14;
  doc.text(`Periodo: ${report.sinceDate} ate ${report.untilDate}`, left, y);
  y += 14;
  doc.text(`Gerado em: ${report.generatedAtLabel}`, left, y);
  y += 16;

  doc.setDrawColor(225, 225, 225);
  doc.line(left, y, right, y);
  y += 18;

  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text("Metrica", left, y);
  doc.text("Valor", left + 260, y);
  doc.text("Variacao", left + 420, y);
  y += 10;
  doc.line(left, y, right, y);
  y += 14;

  report.rows.forEach((row) => {
    if (y > 780) {
      doc.addPage();
      y = 44;
    }
    doc.setFontSize(10);
    doc.text(String(row.label || row.key), left, y, { maxWidth: 245 });
    doc.text(String(row.formattedValue || "-"), left + 260, y, { maxWidth: 145 });
    doc.text(formatDelta(row.deltaPct), left + 420, y, { maxWidth: 110 });
    y += 16;
  });

  return doc;
};

const getEnvelopeData = (payload) => {
  const data = unwrapApiData(payload, {});
  const hasData =
    data != null &&
    (typeof data !== "object" || Array.isArray(data) || Object.keys(data).length > 0);

  const errorPayload = payload?.error;
  if (errorPayload && !hasData) {
    if (typeof errorPayload === "string") {
      throw new Error(errorPayload);
    }
    if (typeof errorPayload === "object" && errorPayload.message) {
      throw new Error(String(errorPayload.message));
    }
    throw new Error("Falha ao carregar dados para o relatorio.");
  }

  return data || {};
};

export default function Reports() {
  const outletContext = useOutletContext() || {};
  const { setTopbarConfig, resetTopbarConfig } = outletContext;
  const { apiFetch } = useAuth();
  const { accounts, loading: accountsLoading } = useAccounts();
  const [get, set] = useQueryState({});

  const initialRange = useMemo(() => getInitialDateRange(), []);
  const [reportName, setReportName] = useState("");
  const [network, setNetwork] = useState("instagram");
  const [sinceDate, setSinceDate] = useState(initialRange.since);
  const [untilDate, setUntilDate] = useState(initialRange.until);
  const [selectedMetrics, setSelectedMetrics] = useState(() => defaultMetricKeys("instagram"));
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [reportResult, setReportResult] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!setTopbarConfig) return undefined;
    setTopbarConfig({ title: "Relatorios", showFilters: false });
    return () => resetTopbarConfig?.();
  }, [setTopbarConfig, resetTopbarConfig]);

  const accountFromQuery = get("account");
  const selectedAccountId = useMemo(() => {
    if (!accounts.length) return "";
    if (accountFromQuery && accounts.some((item) => item.id === accountFromQuery)) {
      return accountFromQuery;
    }
    return accounts[0].id;
  }, [accounts, accountFromQuery]);

  useEffect(() => {
    if (!accounts.length) return;
    if (!accountFromQuery || !accounts.some((item) => item.id === accountFromQuery)) {
      set({ account: accounts[0].id });
    }
  }, [accounts, accountFromQuery, set]);

  const selectedAccount = useMemo(
    () => accounts.find((item) => item.id === selectedAccountId) || null,
    [accounts, selectedAccountId],
  );

  const metricOptions = useMemo(() => METRIC_CATALOG[network] || [], [network]);

  useEffect(() => {
    const allowed = new Set(metricOptions.map((item) => item.key));
    setSelectedMetrics((previous) => {
      const kept = previous.filter((key) => allowed.has(key));
      if (kept.length) return kept;
      return defaultMetricKeys(network);
    });
  }, [network, metricOptions]);

  const accountNetworkIssue = useMemo(() => {
    if (!selectedAccount) return "Selecione uma conta para gerar o relatorio.";
    if (network === "instagram" && !selectedAccount.instagramUserId) {
      return "A conta selecionada nao possui Instagram User ID.";
    }
    if (network === "facebook" && !selectedAccount.facebookPageId) {
      return "A conta selecionada nao possui Facebook Page ID.";
    }
    if (network === "ads" && !selectedAccount.adAccountId) {
      return "A conta selecionada nao possui Ad Account ID.";
    }
    return "";
  }, [selectedAccount, network]);

  const toggleMetric = (metricKey) => {
    setSelectedMetrics((previous) => {
      if (previous.includes(metricKey)) {
        return previous.filter((item) => item !== metricKey);
      }
      return [...previous, metricKey];
    });
  };

  const selectAllMetrics = () => {
    setSelectedMetrics(metricOptions.map((item) => item.key));
  };

  const clearMetrics = () => {
    setSelectedMetrics([]);
  };

  const fetchData = async () => {
    const since = parseDateInput(sinceDate, false);
    const until = parseDateInput(untilDate, true);
    if (!since || !until) {
      throw new Error("Periodo invalido.");
    }
    if (since > until) {
      throw new Error("Data inicial nao pode ser maior que a data final.");
    }

    if (network === "instagram") {
      const params = {
        since: String(toUnixSeconds(since)),
        until: String(toUnixSeconds(until)),
      };
      if (selectedAccount?.instagramUserId) {
        params.igUserId = selectedAccount.instagramUserId;
      }
      const query = new URLSearchParams(params);
      const payload = await apiFetch(`/api/instagram/metrics?${query.toString()}`);
      const data = getEnvelopeData(payload);
      return buildMetricRowsFromList(data?.metrics, "instagram");
    }

    if (network === "facebook") {
      const params = {
        since: String(toUnixSeconds(since)),
        until: String(toUnixSeconds(until)),
      };
      if (selectedAccount?.facebookPageId) {
        params.pageId = selectedAccount.facebookPageId;
      }
      const query = new URLSearchParams(params);
      const payload = await apiFetch(`/api/facebook/metrics?${query.toString()}`);
      const data = getEnvelopeData(payload);
      return buildMetricRowsFromList(data?.metrics, "facebook");
    }

    const params = {
      since: sinceDate,
      until: untilDate,
    };
    if (selectedAccount?.adAccountId) {
      params.actId = selectedAccount.adAccountId;
    }
    const query = new URLSearchParams(params);
    const payload = await apiFetch(`/api/ads/highlights?${query.toString()}`);
    const data = getEnvelopeData(payload);
    return buildAdsMetricRows(data);
  };

  const handleGenerate = async () => {
    if (!selectedMetrics.length) {
      setGenerationError("Selecione ao menos uma metrica.");
      return;
    }
    if (accountNetworkIssue) {
      setGenerationError(accountNetworkIssue);
      return;
    }

    setIsGenerating(true);
    setGenerationError("");
    try {
      const rows = await fetchData();
      const selectedSet = new Set(selectedMetrics);
      const filteredRows = rows
        .filter((row) => selectedSet.has(row.key))
        .map((row) => ({
          ...row,
          formattedValue: formatMetricValue(row.key, row.value),
        }));

      if (!filteredRows.length) {
        throw new Error("Nao foi possivel montar o relatorio com as metricas selecionadas.");
      }

      const now = new Date();
      const networkLabel = NETWORK_LABEL[network] || network;
      const resolvedName =
        reportName.trim() ||
        `Relatorio ${networkLabel} ${sinceDate} a ${untilDate}`;
      const report = {
        id: String(now.getTime()),
        name: resolvedName,
        accountId: selectedAccount?.id || "",
        accountLabel: selectedAccount?.label || "Conta nao definida",
        network,
        sinceDate,
        untilDate,
        generatedAt: now.toISOString(),
        generatedAtLabel: now.toLocaleString("pt-BR"),
        rows: filteredRows,
      };

      setReportResult(report);
      setHistory((previous) => [report, ...previous].slice(0, 15));
    } catch (err) {
      setGenerationError(err?.message || "Falha ao gerar relatorio.");
      setReportResult(null);
    } finally {
      setIsGenerating(false);
    }
  };

  const exportCsv = (report = reportResult) => {
    if (!report) return;
    const csvRows = rowsToCsv(report);
    const csv = Papa.unparse(csvRows);
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const filename = `${sanitizeFilename(report.name)}.csv`;
    downloadBlob(blob, filename);
  };

  const exportPdf = (report = reportResult) => {
    if (!report) return;
    const doc = reportToPdf(report);
    const filename = `${sanitizeFilename(report.name)}.pdf`;
    doc.save(filename);
  };

  return (
    <div className="instagram-dashboard--clean">
      <div className="ig-clean-container">
        <NavigationHero title="Relatorios" icon={FileText} showGradient={false} />

        <div className="reports-container">
          <div className="reports-header">
            <div className="reports-title-section">
              <FileText size={32} className="reports-icon" />
              <h1 className="reports-title">Gerador de Relatorios</h1>
              <p className="reports-subtitle">
                Escolha conta, rede e metricas para gerar exportacoes em CSV e PDF.
              </p>
            </div>
          </div>

          <section className="reports-builder-card">
            <div className="reports-builder-grid">
              <div className="reports-field reports-field--wide">
                <label htmlFor="report-name-input">Nome do relatorio</label>
                <input
                  id="report-name-input"
                  type="text"
                  value={reportName}
                  onChange={(event) => setReportName(event.target.value)}
                  placeholder="Ex: Relatorio mensal de desempenho"
                />
              </div>

              <div className="reports-field">
                <label htmlFor="report-account-select">Conta</label>
                <select
                  id="report-account-select"
                  value={selectedAccountId}
                  onChange={(event) => set({ account: event.target.value })}
                  disabled={accountsLoading || !accounts.length}
                >
                  {accounts.length ? (
                    accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.label}
                      </option>
                    ))
                  ) : (
                    <option value="">Nenhuma conta disponivel</option>
                  )}
                </select>
              </div>

              <div className="reports-field">
                <label htmlFor="report-network-select">Rede social</label>
                <select
                  id="report-network-select"
                  value={network}
                  onChange={(event) => setNetwork(event.target.value)}
                >
                  {NETWORK_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="reports-field">
                <label htmlFor="report-since-date">Data inicial</label>
                <input
                  id="report-since-date"
                  type="date"
                  value={sinceDate}
                  onChange={(event) => setSinceDate(event.target.value)}
                />
              </div>

              <div className="reports-field">
                <label htmlFor="report-until-date">Data final</label>
                <input
                  id="report-until-date"
                  type="date"
                  value={untilDate}
                  onChange={(event) => setUntilDate(event.target.value)}
                />
              </div>
            </div>

            <div className="reports-field reports-field--block">
              <div className="reports-field__header">
                <label>Metricas do relatorio</label>
                <div className="reports-metric-actions">
                  <button type="button" className="reports-mini-btn" onClick={selectAllMetrics}>
                    Selecionar todas
                  </button>
                  <button type="button" className="reports-mini-btn" onClick={clearMetrics}>
                    Limpar
                  </button>
                </div>
              </div>

              <div className="reports-metrics-grid">
                {metricOptions.map((metric) => {
                  const checked = selectedMetrics.includes(metric.key);
                  return (
                    <label key={metric.key} className="reports-metric-option">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMetric(metric.key)}
                      />
                      <span>{metric.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {accountNetworkIssue ? (
              <p className="reports-inline-error">{accountNetworkIssue}</p>
            ) : null}

            <div className="reports-actions-row">
              <button
                type="button"
                className="reports-primary-btn"
                onClick={handleGenerate}
                disabled={
                  isGenerating
                  || !accounts.length
                  || !selectedMetrics.length
                  || Boolean(accountNetworkIssue)
                }
              >
                <RefreshCcw size={16} />
                <span>{isGenerating ? "Gerando..." : "Gerar relatorio"}</span>
              </button>
            </div>
          </section>

          <section className="reports-table-container">
            <div className="reports-preview-toolbar">
              <div>
                <h3 className="reports-preview-title">Preview do relatorio</h3>
                <p className="reports-preview-subtitle">
                  Revise as metricas antes de exportar.
                </p>
              </div>
              <div className="reports-export-actions">
                <button
                  type="button"
                  className="reports-export-btn"
                  onClick={() => exportCsv(reportResult)}
                  disabled={!reportResult}
                >
                  <Download size={15} />
                  CSV
                </button>
                <button
                  type="button"
                  className="reports-export-btn"
                  onClick={() => exportPdf(reportResult)}
                  disabled={!reportResult}
                >
                  <Download size={15} />
                  PDF
                </button>
              </div>
            </div>

            {isGenerating ? (
              <div className="empty-state">
                <DataState state="loading" label="Gerando relatorio..." size="sm" inline />
              </div>
            ) : generationError ? (
              <div className="empty-state">
                <DataState state="error" label={generationError} size="sm" inline />
              </div>
            ) : !reportResult ? (
              <div className="empty-state">
                <DataState
                  state="empty"
                  label="Defina os filtros e clique em Gerar relatorio."
                  size="sm"
                  inline
                />
              </div>
            ) : (
              <>
                <div className="reports-preview-meta">
                  <span><strong>Nome:</strong> {reportResult.name}</span>
                  <span><strong>Conta:</strong> {reportResult.accountLabel}</span>
                  <span><strong>Rede:</strong> {NETWORK_LABEL[reportResult.network] || reportResult.network}</span>
                  <span><strong>Periodo:</strong> {reportResult.sinceDate} ate {reportResult.untilDate}</span>
                  <span><strong>Gerado:</strong> {reportResult.generatedAtLabel}</span>
                </div>

                <table className="reports-preview-table">
                  <thead>
                    <tr>
                      <th>Metrica</th>
                      <th>Valor</th>
                      <th>Variacao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportResult.rows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.label || row.key}</td>
                        <td>{row.formattedValue}</td>
                        <td>{formatDelta(row.deltaPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

          <section className="reports-table-container reports-history">
            <div className="reports-preview-toolbar">
              <div>
                <h3 className="reports-preview-title">Relatorios gerados na sessao</h3>
                <p className="reports-preview-subtitle">
                  Historico rapido para novo download.
                </p>
              </div>
            </div>

            {!history.length ? (
              <div className="empty-state">
                <DataState state="empty" label="Nenhum relatorio gerado ainda." size="sm" inline />
              </div>
            ) : (
              <table className="reports-table">
                <thead>
                  <tr>
                    <th className="col-nome">Nome</th>
                    <th className="col-canais">Rede</th>
                    <th className="col-nome">Conta</th>
                    <th className="col-data">Periodo</th>
                    <th className="col-data">Gerado em</th>
                    <th className="col-acoes">Exportar</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.id}>
                      <td className="col-nome">{entry.name}</td>
                      <td className="col-canais">{NETWORK_LABEL[entry.network] || entry.network}</td>
                      <td className="col-nome">{entry.accountLabel}</td>
                      <td className="col-data">{entry.sinceDate} ate {entry.untilDate}</td>
                      <td className="col-data">{entry.generatedAtLabel}</td>
                      <td className="col-acoes">
                        <button
                          type="button"
                          className="reports-inline-action"
                          onClick={() => exportCsv(entry)}
                        >
                          CSV
                        </button>
                        <button
                          type="button"
                          className="reports-inline-action"
                          onClick={() => exportPdf(entry)}
                        >
                          PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
