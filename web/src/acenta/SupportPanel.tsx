import { useEffect, useState } from "react";
import type { AcentaApi } from "./api";
import type { DebugBundle } from "./debug-telemetry";
import type { CapturedScreenshot } from "./screen-capture";
import {
  createSupportTicket,
  getSupportTicket,
  listSupportTickets,
  supportBacklogDownloadUrl,
  updateSupportTicket,
  type SupportBacklogList,
  type SupportCategory,
  type SupportSeverity,
  type SupportStatus,
  type SupportTicketSummary,
} from "./support-api";

const CATEGORY_LABELS: Record<SupportCategory, string> = {
  bug: "Error / Bug",
  ui: "Diseño / Pantalla",
  impresion: "Impresora Epson",
  ia: "Chat / IA Luna",
  cuenta: "Cuenta / Acceso",
  sugerencia: "Sugerencia",
};

const SEVERITY_LABELS: Record<SupportSeverity, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};

const STATUS_LABELS: Record<SupportStatus, string> = {
  open: "Abierto",
  investigating: "En revisión",
  resolved: "Resuelto",
  wontfix: "Descartado",
};

export function SupportPanel({
  api,
  viewName,
  initialScreenshot,
  initialDebugBundle,
  onRecapture,
  onClose,
}: {
  api: AcentaApi;
  viewName: string;
  initialScreenshot: CapturedScreenshot | null;
  initialDebugBundle: DebugBundle;
  onRecapture: () => Promise<{
    screenshot: CapturedScreenshot | null;
    bundle: DebugBundle;
  }>;
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<"report" | "backlog">("report");
  const [screenshot, setScreenshot] = useState<CapturedScreenshot | null>(initialScreenshot);
  const [bundle, setBundle] = useState<DebugBundle>(initialDebugBundle);
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [showDebugPreview, setShowDebugPreview] = useState(false);

  const [category, setCategory] = useState<SupportCategory>("bug");
  const [severity, setSeverity] = useState<SupportSeverity>("medium");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recapturing, setRecapturing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdTicket, setCreatedTicket] = useState<SupportTicketSummary | null>(null);

  const [backlog, setBacklog] = useState<SupportBacklogList | null>(null);
  const [statusFilter, setStatusFilter] = useState<SupportStatus | "">("");
  const [loadingBacklog, setLoadingBacklog] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicketSummary | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [triageStatus, setTriageStatus] = useState<SupportStatus>("open");
  const [triageNotes, setTriageNotes] = useState("");
  const [savingTriage, setSavingTriage] = useState(false);

  useEffect(() => {
    setScreenshot(initialScreenshot);
    setBundle(initialDebugBundle);
  }, [initialScreenshot, initialDebugBundle]);

  async function refreshBacklog(filter: SupportStatus | "" = statusFilter) {
    setLoadingBacklog(true);
    try {
      const data = await listSupportTickets(api, { status: filter });
      setBacklog(data);
    } catch {
      // keep existing state on transient error
    } finally {
      setLoadingBacklog(false);
    }
  }

  useEffect(() => {
    void refreshBacklog(statusFilter);
  }, [api.session.scopeId, statusFilter]);

  async function handleRecapture() {
    setRecapturing(true);
    try {
      const fresh = await onRecapture();
      setScreenshot(fresh.screenshot);
      setBundle(fresh.bundle);
    } finally {
      setRecapturing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!summary.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const saved = await createSupportTicket(api, {
        category,
        severity,
        summary: summary.trim(),
        description: description.trim(),
        view_name: viewName,
        route_url: bundle.route,
        screenshot_data_url: includeScreenshot ? screenshot?.dataUrl ?? null : null,
        debug_bundle: bundle,
      });
      setCreatedTicket(saved);
      setSummary("");
      setDescription("");
      await refreshBacklog(statusFilter);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? `No se pudo guardar el reporte (${err.message}).`
          : "No se pudo guardar el reporte.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function inspectTicket(ticketId: string) {
    setLoadingDetail(true);
    try {
      const full = await getSupportTicket(api, ticketId);
      setSelectedTicket(full);
      setTriageStatus(full.status);
      setTriageNotes(full.triage_notes || "");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function saveTriage() {
    if (!selectedTicket || savingTriage) return;
    setSavingTriage(true);
    try {
      const updated = await updateSupportTicket(api, selectedTicket.id, {
        status: triageStatus,
        triage_notes: triageNotes,
      });
      setSelectedTicket(updated);
      await refreshBacklog(statusFilter);
    } finally {
      setSavingTriage(false);
    }
  }

  const failedRequests = bundle.networkLog.filter((n) => !n.ok || n.status >= 400);

  return (
    <div className="support-debug-shell" data-support-overlay="true">
      <div className="support-tabs" role="tablist" aria-label="Soporte y debug">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "report"}
          className={`support-tab${tab === "report" ? " is-active" : ""}`}
          onClick={() => setTab("report")}
        >
          Reportar problema
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "backlog"}
          className={`support-tab${tab === "backlog" ? " is-active" : ""}`}
          onClick={() => {
            setTab("backlog");
            void refreshBacklog(statusFilter);
          }}
        >
          Backlog de debug ({backlog?.total ?? 0})
        </button>
        {onClose && (
          <button
            type="button"
            className="support-close-inline"
            onClick={onClose}
            aria-label="Cerrar soporte"
          >
            Cerrar
          </button>
        )}
      </div>

      {tab === "report" ? (
        <div className="support-report-view">
          <div className="support-capture-card">
            <div className="support-capture-header">
              <div>
                <strong>Captura automática de pantalla</strong>
                <p className="support-muted">
                  Vista: <code>{viewName}</code> · {bundle.viewport.width}×{bundle.viewport.height} ·{" "}
                  {bundle.consoleErrors.length} error(es) consola · {failedRequests.length} error(es) red
                </p>
              </div>
              <button
                type="button"
                className="support-btn-secondary"
                disabled={recapturing}
                onClick={() => void handleRecapture()}
              >
                {recapturing ? "Capturando…" : "Recapturar pantalla"}
              </button>
            </div>
            {screenshot ? (
              <div className="support-screenshot-preview">
                <img
                  src={screenshot.dataUrl}
                  alt="Captura automática de la pantalla actual"
                />
              </div>
            ) : (
              <p className="support-muted">
                No se pudo generar captura visual en este entorno; el paquete de debug de red y consola sí se adjuntará.
              </p>
            )}
            <label className="support-checkbox">
              <input
                type="checkbox"
                checked={includeScreenshot}
                onChange={(e) => setIncludeScreenshot(e.target.checked)}
              />
              <span>Guardar esta captura de pantalla junto con el backlog de debug</span>
            </label>
          </div>

          {createdTicket && (
            <div className="support-success-banner" role="status">
              <strong>Reporte guardado en el backlog de debug</strong>
              <p>
                Folio <code>{createdTicket.id.slice(0, 8)}</code> ·{" "}
                {createdTicket.has_screenshot
                  ? `Captura PNG (${Math.round(createdTicket.screenshot_bytes / 1024)} KB) + logs guardados.`
                  : "Logs de debug guardados."}
              </p>
              <button
                type="button"
                className="support-btn-secondary"
                onClick={() => {
                  setTab("backlog");
                  void inspectTicket(createdTicket.id);
                }}
              >
                Inspeccionar en backlog
              </button>
            </div>
          )}

          <form className="support-form" onSubmit={(e) => void handleSubmit(e)}>
            <div className="support-row-2">
              <label>
                <span>Categoría</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as SupportCategory)}
                >
                  {(Object.keys(CATEGORY_LABELS) as SupportCategory[]).map((k) => (
                    <option key={k} value={k}>
                      {CATEGORY_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Gravedad</span>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as SupportSeverity)}
                >
                  {(Object.keys(SEVERITY_LABELS) as SupportSeverity[]).map((k) => (
                    <option key={k} value={k}>
                      {SEVERITY_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              <span>¿Qué pasó o qué se vio raro?</span>
              <input
                type="text"
                required
                minLength={3}
                maxLength={200}
                placeholder="Ej. Al pulsar imprimir el botón no respondió…"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </label>

            <label>
              <span>Detalles adicionales (opcional)</span>
              <textarea
                rows={3}
                maxLength={4000}
                placeholder="Pasos para reproducirlo, qué esperabas ver…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            <div className="support-debug-disclosure">
              <button
                type="button"
                className="support-link-btn"
                onClick={() => setShowDebugPreview((v) => !v)}
              >
                {showDebugPreview
                  ? "Ocultar paquete de debug técnico"
                  : `Inspeccionar paquete de debug (${bundle.consoleErrors.length} errores, ${bundle.networkLog.length} peticiones, ${bundle.breadcrumbs.length} acciones)`}
              </button>
              {showDebugPreview && (
                <pre className="support-debug-json">
                  {JSON.stringify(
                    {
                      route: bundle.route,
                      viewport: bundle.viewport,
                      appState: bundle.appState,
                      consoleErrors: bundle.consoleErrors.slice(-10),
                      failedRequests: failedRequests.slice(-10),
                      recentBreadcrumbs: bundle.breadcrumbs.slice(-12),
                    },
                    null,
                    2,
                  )}
                </pre>
              )}
            </div>

            {submitError && (
              <p className="support-error" role="alert">
                {submitError}
              </p>
            )}

            <button
              type="submit"
              className="support-btn-primary"
              disabled={submitting || summary.trim().length < 3}
            >
              {submitting ? "Guardando captura y debug…" : "Enviar a soporte y guardar en backlog"}
            </button>
          </form>
        </div>
      ) : (
        <div className="support-backlog-view">
          <div className="support-backlog-toolbar">
            <div className="support-filter-pills">
              {(["", "open", "investigating", "resolved"] as const).map((st) => (
                <button
                  key={st || "all"}
                  type="button"
                  className={`support-pill${statusFilter === st ? " is-active" : ""}`}
                  onClick={() => setStatusFilter(st)}
                >
                  {st === ""
                    ? `Todos (${backlog?.total ?? 0})`
                    : `${STATUS_LABELS[st]} (${backlog?.counts_by_status[st] ?? 0})`}
                </button>
              ))}
            </div>
            <a
              className="support-btn-secondary"
              href={supportBacklogDownloadUrl(api)}
              download="acenta-debug-backlog.json"
            >
              Exportar backlog JSON
            </a>
          </div>

          {loadingBacklog && <p className="support-muted">Cargando backlog de debug…</p>}

          {selectedTicket ? (
            <div className="support-ticket-inspector">
              <button
                type="button"
                className="support-link-btn"
                onClick={() => setSelectedTicket(null)}
              >
                ← Volver al listado
              </button>
              <div className="support-inspector-header">
                <h3>{selectedTicket.summary}</h3>
                <span className={`support-badge is-${selectedTicket.severity}`}>
                  {SEVERITY_LABELS[selectedTicket.severity]}
                </span>
                <span className={`support-badge is-status-${selectedTicket.status}`}>
                  {STATUS_LABELS[selectedTicket.status]}
                </span>
              </div>
              <p className="support-muted">
                Folio <code>{selectedTicket.id}</code> · Vista <code>{selectedTicket.view_name || "—"}</code> ·{" "}
                {new Date(selectedTicket.created_at).toLocaleString("es-MX")}
              </p>
              {selectedTicket.description && <p>{selectedTicket.description}</p>}

              {selectedTicket.screenshot_url && (
                <div className="support-screenshot-full">
                  <img
                    src={selectedTicket.screenshot_url}
                    alt={`Captura del reporte ${selectedTicket.summary}`}
                  />
                  <a
                    href={selectedTicket.screenshot_url}
                    target="_blank"
                    rel="noreferrer"
                    className="support-link-btn"
                  >
                    Abrir captura completa ({Math.round(selectedTicket.screenshot_bytes / 1024)} KB)
                  </a>
                </div>
              )}

              <div className="support-triage-box">
                <label>
                  <span>Estado de triage</span>
                  <select
                    value={triageStatus}
                    onChange={(e) => setTriageStatus(e.target.value as SupportStatus)}
                  >
                    {(Object.keys(STATUS_LABELS) as SupportStatus[]).map((st) => (
                      <option key={st} value={st}>
                        {STATUS_LABELS[st]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Notas de diagnóstico / resolución</span>
                  <textarea
                    rows={2}
                    value={triageNotes}
                    onChange={(e) => setTriageNotes(e.target.value)}
                    placeholder="Causa raíz, PR que lo corrige…"
                  />
                </label>
                <button
                  type="button"
                  className="support-btn-primary"
                  disabled={savingTriage}
                  onClick={() => void saveTriage()}
                >
                  {savingTriage ? "Guardando…" : "Guardar triage"}
                </button>
              </div>

              <details open className="support-debug-section">
                <summary>Diagnóstico del cliente (consola, red, breadcrumbs, estado)</summary>
                <pre className="support-debug-json">
                  {JSON.stringify(selectedTicket.debug_bundle ?? {}, null, 2)}
                </pre>
              </details>
              <details className="support-debug-section">
                <summary>Diagnóstico del servidor (flags, revisión DB, errores HTTP recientes)</summary>
                <pre className="support-debug-json">
                  {JSON.stringify(selectedTicket.server_diagnostics ?? {}, null, 2)}
                </pre>
              </details>
            </div>
          ) : (
            <div className="support-backlog-list">
              {!backlog?.items.length && !loadingBacklog && (
                <p className="support-muted">
                  Aún no hay reportes en el backlog. Cuando alguien reporte un bug desde Soporte, aquí aparecerá con su captura y diagnóstico completo.
                </p>
              )}
              {backlog?.items.map((item) => (
                <article
                  key={item.id}
                  className="support-backlog-card"
                  onClick={() => void inspectTicket(item.id)}
                >
                  {item.screenshot_url && (
                    <img
                      className="support-backlog-thumb"
                      src={item.screenshot_url}
                      alt=""
                    />
                  )}
                  <div className="support-backlog-meta">
                    <div className="support-backlog-badges">
                      <span className={`support-badge is-${item.severity}`}>
                        {SEVERITY_LABELS[item.severity]}
                      </span>
                      <span className={`support-badge is-status-${item.status}`}>
                        {STATUS_LABELS[item.status]}
                      </span>
                      <span className="support-muted">{CATEGORY_LABELS[item.category]}</span>
                    </div>
                    <strong>{item.summary}</strong>
                    <p className="support-muted">
                      Vista: {item.view_name || "—"} · {item.console_error_count} err consola ·{" "}
                      {item.failed_request_count} err red ·{" "}
                      {new Date(item.created_at).toLocaleString("es-MX")}
                    </p>
                  </div>
                </article>
              ))}
              {loadingDetail && <p className="support-muted">Cargando detalle del reporte…</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
