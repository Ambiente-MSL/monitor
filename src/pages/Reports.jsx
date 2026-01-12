// src/pages/Reports.jsx
import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FileText } from "lucide-react";
import NavigationHero from "../components/NavigationHero";
import useQueryState from "../hooks/useQueryState";
import { useAuth } from "../context/AuthContext";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import Papa from "papaparse";
import { utils as XLSXutils, writeFile as XLSXwriteFile } from "xlsx";
import { unwrapApiData } from "../lib/apiEnvelope";
import DataState from "../components/DataState";
import { fetchWithTimeout, isTimeoutError } from "../lib/fetchWithTimeout";

const API_BASE_URL = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");

export default function Reports() {
  const outletContext = useOutletContext() || {};
  const { setTopbarConfig, resetTopbarConfig } = outletContext;
  const [get] = useQueryState();

  useEffect(() => {
    if (!setTopbarConfig) return undefined;
    setTopbarConfig({ title: "Relatorios", showFilters: false });
    return () => resetTopbarConfig?.();
  }, [setTopbarConfig, resetTopbarConfig]);

  const { apiFetch } = useAuth();
  const account = get("account");
  const since = get("since");
  const until = get("until");

  const [templates, setTemplates] = useState([]);
  const [reports, setReports] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [fetchingData, setFetchingData] = useState(false);
  const [dataError, setDataError] = useState("");
  const previewRef = useRef();

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      setFetchingData(true);
      setDataError("");
      try {
        const [templatesPayload, reportsPayload] = await Promise.all([
          apiFetch("/api/report-templates"),
          apiFetch("/api/reports"),
        ]);
        if (!active) return;
        setTemplates(Array.isArray(templatesPayload?.templates) ? templatesPayload.templates : []);
        setReports(Array.isArray(reportsPayload?.reports) ? reportsPayload.reports : []);
      } catch (err) {
        if (!active) return;
        console.error("Erro ao carregar relatórios do Postgres.", err);
        setDataError(err?.message || "Erro ao carregar dados de relatórios.");
      } finally {
        if (active) {
          setFetchingData(false);
        }
      }
    };

    loadData();

    return () => {
      active = false;
    };
  }, [apiFetch]);

  // ---------------------
  // DATA PIPELINE
  // ---------------------
  const call = async (path, params) => {
    const url = new URL(`${API_BASE_URL}${path}`);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v != null && v !== "") url.searchParams.set(k, v);
    });
    let r;
    try {
      r = await fetchWithTimeout(url.toString());
    } catch (err) {
      if (isTimeoutError(err)) {
        throw new Error("Tempo esgotado ao carregar dados.");
      }
      throw err;
    }
    const t = await r.text();
    try {
      return unwrapApiData(t ? JSON.parse(t) : {}, {});
    } catch {
      return {};
    }
  };

  const getFacebookData = async () => {
    // orgAnico + pago (ads)
    const pageId = account ? undefined : undefined; // jA vem do backend pela env se nAo enviar
    const [org, ads] = await Promise.all([
      call("/api/facebook/metrics", { pageId, since, until }),
      call("/api/ads/highlights", { since: toIso(since), until: toIso(until) }),
    ]);
    return { org, ads };
  };

  const getInstagramData = async () => {
    const [insights, organic] = await Promise.all([
      call("/api/instagram/metrics", { since, until }),
      call("/api/instagram/organic", { since, until }),
    ]);
    return { insights, organic };
  };

  const getDataForScope = async () => {
    const [fb, ig] = await Promise.all([getFacebookData(), getInstagramData()]);
    return { facebook: fb, instagram: ig };
  };

  const toIso = (v) => {
    if (!v) return undefined;
    const n = Number(v);
    const ms = n > 1_000_000_000_000 ? n : n * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  };

  const resolveScope = (report) => {
    const source =
      (report?.params && (report.params.scope || report.params.platform)) ||
      report?.platform ||
      "";
    const normalized = String(source || "").toLowerCase();
    if (normalized.includes("facebook") && normalized.includes("instagram")) return "ambos";
    if (normalized.includes("facebook")) return "facebook";
    if (normalized.includes("instagram")) return "instagram";
    if (normalized.includes("ambos") || normalized.includes("both")) return "ambos";
    return "ambos";
  };

  const resolveChannels = (report) => {
    const scopeLabel = resolveScope(report);
    if (scopeLabel === "facebook") return ["facebook"];
    if (scopeLabel === "instagram") return ["instagram"];
    return ["facebook", "instagram"];
  };

  // ---------------------
  // EXPORTS
  // ---------------------
  const onExport = async (format, report = reports[0]) => {
    setExporting(true);
    try {
      const data = await getDataForScope();
      if (format === "csv") {
        exportCSV(report, data);
      } else if (format === "xlsx") {
        exportXLSX(report, data);
      } else if (format === "pdf") {
        await exportPDF(report, data);
      } else if (format === "print") {
        window.print();
      }
    } finally {
      setExporting(false);
    }
  };

  const exportCSV = (report, data) => {
    // monta uma tabela simples com pares chave-valor do resumo
    const rows = flattenForTable(data);
    const csv = Papa.unparse(rows);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${report?.name || "relatorio"}.csv`);
  };

  const exportXLSX = (report, data) => {
    const rows = flattenForTable(data);
    const sheet = XLSXutils.json_to_sheet(rows);
    const wb = XLSXutils.book_new();
    XLSXutils.book_append_sheet(wb, sheet, "Relatório");
    XLSXwriteFile(wb, `${report?.name || "relatorio"}.xlsx`);
  };

  const exportPDF = async (report, data) => {
    // renderiza um preview simples do relatA3rio no DOM ainvisAvela e captura em PDF
    const el = previewRef.current;
    if (el) {
      el.innerHTML = renderHtmlPreview(report, data);
      await new Promise((res) => setTimeout(res, 50)); // deixa o browser pintar
    }
    const rootStyles = getComputedStyle(document.documentElement);
    const backgroundColor = rootStyles.getPropertyValue("--bg")?.trim() || "transparent";
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: [canvas.width, canvas.height],
    });
    pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
    const blob = pdf.output("blob");
    downloadBlob(blob, `${report?.name || "relatorio"}.pdf`);

    // opcional: subir para Storage
    // await uploadExportToStorage(blob, `${report?.id || "tmp"}.pdf`);
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const flattenForTable = (data) => {
    // transforma o objeto grande em linhas {grupo, metrica, valor}
    const rows = [];
    const walk = (obj, path = []) => {
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        Object.entries(obj).forEach(([k, v]) => walk(v, path.concat(k)));
      } else {
        rows.push({ grupo: path.slice(0, -1).join(" / "), metrica: path[path.length - 1], valor: obj });
      }
    };
    walk(data);
    return rows;
  };

  const renderHtmlPreview = (report, data) => {
    // preview simples; personalize com HTML/CSS do seu template
    return `
      <div style="padding:24px;color:var(--fg);font-family:'Lato',system-ui,Arial;background:var(--bg);width:900px">
        <h2 style="margin:0 0 8px 0">${report?.name || "RelatA3rio"}</h2>
        <p style="margin:0 0 24px 0;opacity:.75">Conta: ${account || "PadrAo"} | PerAodo: ${since || "-"} a ${until || "-"}</p>
        <h3>Resumo</h3>
        <pre style="white-space:pre-wrap;background:var(--panel);border:1px solid var(--stroke);border-radius:12px;padding:12px;color:var(--fg)">${JSON.stringify(data, null, 2)}</pre>
      </div>
    `;
  };

  return (
    <div className="instagram-dashboard--clean">
      <div className="ig-clean-container">
        {/* Navigation Hero - mantém o hero de navegação */}
        <NavigationHero title="Relatórios" icon={FileText} showGradient={false} />

        <div className="reports-container">
        {/* Header */}
        <div className="reports-header">
          <div className="reports-title-section">
            <FileText size={32} className="reports-icon" />
            <h1 className="reports-title">MEUS RELATÓRIOS</h1>
            <p className="reports-subtitle">
              aqui você pode verificar os relatórios que você já gerou e exportou
              <span style={{ marginLeft: 8, fontWeight: 500 }}>Modelos ativos: {templates.length}</span>
            </p>
          </div>

          <button className="btn-new-report">
            <FileText size={20} />
            NOVO MODELO DE RELATÓRIO
          </button>
        </div>

        {/* Instruções */}
        <div className="reports-instructions">
          <div className="instruction-item">
            <span className="instruction-icon">📝</span>
            Alterar logo nos relatórios
          </div>
        </div>

        {/* Tabela de Relatórios */}
        <div className="reports-table-container">
          <table className="reports-table">
            <thead>
              <tr>
                <th className="col-tipo">TIPO</th>
                <th className="col-nome">NOME</th>
                <th className="col-canais">CANAIS</th>
                <th className="col-data">
                  DATA
                  <span className="sort-icon">▲</span>
                </th>
                <th className="col-acoes"></th>
              </tr>
            </thead>
            <tbody>
              {fetchingData ? (
                <tr>
                  <td colSpan="5" className="empty-state"><DataState state="loading" label="Carregando relatorios..." size="sm" inline /></td>
                </tr>
              ) : dataError ? (
                <tr>
                  <td colSpan="5" className="empty-state"><DataState state="error" label={dataError} size="sm" inline /></td>
                </tr>
              ) : reports.length === 0 ? (
                <tr>
                  <td colSpan="5" className="empty-state"><DataState state="empty" label="Nenhum relatorio encontrado." size="sm" inline /></td>
                </tr>
              ) : (
                reports.map((report, idx) => {
                  const channels = resolveChannels(report);
                  return (
                    <tr key={report.id || idx}>
                      <td className="col-tipo">
                        <FileText size={24} className="report-type-icon" />
                      </td>
                      <td className="col-nome">{report.name || report.title || "Relatório sem nome"}</td>
                      <td className="col-canais">
                        <div className="channel-icons">
                          {channels.includes("instagram") && (
                            <div className="channel-icon instagram">
                              <span>📷</span>
                            </div>
                          )}
                          {channels.includes("facebook") && (
                            <div className="channel-icon facebook">
                              <span>f</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="col-data">
                        {report.created_at
                          ? new Date(report.created_at).toLocaleDateString("pt-BR")
                          : "-"}
                      </td>
                      <td className="col-acoes">
                        <button
                          className="btn-action"
                          title="Exportar PDF"
                          onClick={() => onExport("pdf", report)}
                          disabled={exporting}
                        >
                          PDF
                        </button>
                        <button
                          className="btn-action"
                          title="Exportar CSV"
                          onClick={() => onExport("csv", report)}
                          disabled={exporting}
                        >
                          CSV
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Preview invisível para PDF */}
        <div ref={previewRef} style={{ position: "absolute", left: -99999, top: -99999 }} />
        </div>
      </div>
    </div>
  );
}

