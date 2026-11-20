import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AcentaController } from "./controller";
import {
  AnnexPrintClient,
  annexErrorMessage,
  humanizePrintError,
  type PrintJob,
  type PrintSettings,
} from "./annex-api";
import { Logo, UiIcon, type UiIconName } from "./ui";
import "./annexes.css";

type QueueFilter = "all" | "pending" | "sent" | "errors";

const COPY_PRESETS = [1, 15, 25, 30] as const;

const statusLabel: Record<PrintJob["status"], string> = {
  pending: "Pendiente",
  sending: "Enviando…",
  sent: "Enviado",
  failed: "Error",
  cancelled: "Cancelado",
};

const EMPTY_QUEUE_STATE: Record<
  QueueFilter,
  { icon: UiIconName; title: string; copy: string }
> = {
  all: {
    icon: "printer",
    title: "Cola sin envíos todavía",
    copy: "Todavía no has enviado hojas a imprimir. Prueba con «Enviar hoja de prueba» o aprueba un anexo.",
  },
  pending: {
    icon: "clock",
    title: "Sin pendientes",
    copy: "No hay trabajos pendientes en este momento.",
  },
  sent: {
    icon: "check",
    title: "Sin envíos completados",
    copy: "Aún no se ha enviado ningún trabajo.",
  },
  errors: {
    icon: "check",
    title: "Cola sin errores",
    copy: "No hay errores en la cola. ¡Todo está al día!",
  },
};

function clampCopies(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(50, Math.round(value)));
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function matchesFilter(job: PrintJob, filter: QueueFilter): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return job.status === "pending" || job.status === "sending";
  if (filter === "sent") return job.status === "sent";
  return job.status === "failed" || job.status === "cancelled";
}

export function PrintSettingsView({ controller }: { controller: AcentaController }) {
  const client = useMemo(() => new AnnexPrintClient(controller.api), [controller.api]);
  const [settings, setSettings] = useState<PrintSettings | null>(null);
  const [printerEmail, setPrinterEmail] = useState("");
  const [defaultCopies, setDefaultCopies] = useState(25);
  const [defaultTime, setDefaultTime] = useState("06:30");
  const [timezone, setTimezone] = useState("America/Mexico_City");
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const pendingCount = jobs.filter(
    (j) => j.status === "pending" || j.status === "sending",
  ).length;
  const sentCount = jobs.filter((j) => j.status === "sent").length;
  const failedCount = jobs.filter((j) => j.status === "failed").length;
  const errorTabCount = jobs.filter(
    (j) => j.status === "failed" || j.status === "cancelled",
  ).length;
  const deletableCount = jobs.filter((j) => j.status !== "sending").length;
  const filteredJobs = jobs.filter((j) => matchesFilter(j, queueFilter));

  const isReady = Boolean(settings?.printer_email && settings?.smtp_configured);
  const readinessLabel = isReady
    ? "Lista para imprimir"
    : settings?.smtp_configured
      ? "Falta correo de impresora"
      : "SMTP pendiente en servidor";
  const readinessDescription = isReady
    ? "Tu Epson L3250 está vinculada y lista para recibir anexos PDF por correo."
    : settings?.smtp_configured
      ? "Guarda la dirección @print.epsonconnect.com de tu impresora y envía una hoja de prueba."
      : "El servidor todavía necesita configurar el envío de correo (SMTP) para imprimir automáticamente.";

  const queueSummary =
    pendingCount > 0 || failedCount > 0
      ? `${pendingCount} ${pendingCount === 1 ? "pendiente" : "pendientes"} · ${failedCount} ${failedCount === 1 ? "error" : "errores"}`
      : sentCount > 0
        ? `${sentCount} ${sentCount === 1 ? "enviado" : "enviados"}`
        : "Sin envíos aún";

  const load = async () => {
    try {
      const [s, list] = await Promise.all([
        client.getPrintSettings(),
        client.listPrintJobs(),
      ]);
      setSettings(s);
      setPrinterEmail(s.printer_email ?? "");
      setDefaultCopies(s.default_copies);
      setDefaultTime(s.default_print_time);
      setTimezone(s.timezone);
      setJobs(list);
    } catch (err) {
      setError(annexErrorMessage(err));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const handleRefresh = async () => {
    setBusy("refresh");
    setError("");
    try {
      await load();
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("saving");
    setError("");
    setNotice("");
    try {
      const saved = await client.savePrintSettings({
        printer_email: printerEmail.trim() || null,
        default_copies: clampCopies(defaultCopies),
        default_print_time: defaultTime,
        timezone,
      });
      setSettings(saved);
      setPrinterEmail(saved.printer_email ?? "");
      setDefaultCopies(saved.default_copies);
      setDefaultTime(saved.default_print_time);
      setTimezone(saved.timezone);
      setNotice("Configuración de impresora guardada.");
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleTestPage = async () => {
    setBusy("test");
    setError("");
    setNotice("");
    try {
      const job = await client.sendTestPage(printerEmail.trim() || null);
      setJobs((prev) => [job, ...prev]);
      if (job.status === "sent") {
        setNotice(`Hoja de prueba enviada a ${job.printer_email}. Revisa tu Epson L3250.`);
      } else {
        setError(humanizePrintError(job.last_error));
      }
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async (jobId: string) => {
    setBusy(jobId);
    setError("");
    setNotice("");
    try {
      const updated = await client.cancelPrintJob(jobId);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      setNotice("Envío programado cancelado.");
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleRetry = async (jobId: string) => {
    setBusy(jobId);
    setError("");
    setNotice("");
    try {
      const updated = await client.retryPrintJob(jobId);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      if (updated.status === "sent") {
        setNotice(`Trabajo reenviado a ${updated.printer_email}.`);
      } else {
        setError(humanizePrintError(updated.last_error));
      }
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    setBusy(jobId);
    setError("");
    setNotice("");
    try {
      await client.deletePrintJob(jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      setNotice("Trabajo eliminado de la cola.");
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleClearQueue = async (status: "all" | "failed") => {
    setBusy(`clear-${status}`);
    setError("");
    setNotice("");
    try {
      const result = await client.clearPrintJobs(status);
      setConfirmClear(false);
      await load();
      if (result.deleted === 0 && result.skipped_sending === 0) {
        setNotice("No había trabajos por eliminar.");
      } else if (result.skipped_sending > 0) {
        setNotice(
          `Se eliminaron ${result.deleted} ${result.deleted === 1 ? "trabajo" : "trabajos"}. ${result.skipped_sending} en curso se conservaron.`,
        );
      } else {
        setNotice(
          status === "failed"
            ? `Se limpiaron ${result.deleted} ${result.deleted === 1 ? "error" : "errores"} de la cola.`
            : `Cola vaciada (${result.deleted} ${result.deleted === 1 ? "trabajo eliminado" : "trabajos eliminados"}).`,
        );
      }
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const filterTabs: { id: QueueFilter; label: string; count: number }[] = [
    { id: "all", label: "Todos", count: jobs.length },
    { id: "pending", label: "Pendientes", count: pendingCount },
    { id: "sent", label: "Enviados", count: sentCount },
    { id: "errors", label: "Errores", count: errorTabCount },
  ];

  return (
    <section className="printer-page">
      <header className="studio-header">
        <div className="studio-header-title">
          <Logo />
          <h1>Impresora Epson (Email Print)</h1>
          <p className="field-hint">
            Vincula tu Epson L3250, envía una hoja de prueba y supervisa tus envíos a impresión.
          </p>
        </div>
        <div className="studio-header-actions">
          <button
            type="button"
            className="primary"
            onClick={() => controller.navigate("annexes")}
          >
            <UiIcon name="worksheet" size={18} />
            <span>Ir a Anexos</span>
          </button>
          <button type="button" onClick={() => controller.navigate("home")}>
            Volver al inicio
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="ac-banner is-error">
          <UiIcon name="alert" size={18} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div role="status" className="ac-banner is-success">
          <UiIcon name="check" size={18} />
          <span>{notice}</span>
        </div>
      )}

      <section
        className={`printer-hero ${isReady ? "is-ready" : "is-warning"}`}
        aria-label="Estado de la impresora"
      >
        <div className="printer-hero-head">
          <span className={`ac-badge ${isReady ? "ready" : "pending"}`}>
            {readinessLabel}
          </span>
          <p className="printer-hero-copy">{readinessDescription}</p>
        </div>
        <div className="printer-metrics">
          <div className="printer-metric">
            <span className="printer-metric-label">CORREO EPSON</span>
            <strong className="printer-metric-value">
              {settings?.printer_email || "Sin configurar"}
            </strong>
          </div>
          <div className="printer-metric">
            <span className="printer-metric-label">AJUSTES POR DEFECTO</span>
            <strong className="printer-metric-value ac-num">
              {defaultCopies} {defaultCopies === 1 ? "copia" : "copias"} · {defaultTime}
            </strong>
          </div>
          <div className="printer-metric">
            <span className="printer-metric-label">COLA DE IMPRESIÓN</span>
            <strong className="printer-metric-value ac-num">{queueSummary}</strong>
          </div>
        </div>
      </section>

      <div className="printer-grid">
        <form className="annex-card" onSubmit={(e) => void handleSave(e)}>
          <div className="annex-card-header">
            <h2 className="annex-card-title">
              <UiIcon name="printer" size={18} />
              <span>Configuración Epson L3250</span>
            </h2>
            <span className={`ac-badge ${settings?.smtp_configured ? "ready" : "pending"}`}>
              {settings?.smtp_configured ? "SMTP activo" : "SMTP pendiente en servidor"}
            </span>
          </div>

          <div className="annex-field">
            <label htmlFor="printer-email">Correo de Epson Email Print</label>
            <input
              id="printer-email"
              type="email"
              value={printerEmail}
              onChange={(e) => setPrinterEmail(e.target.value)}
              placeholder="ej. mi-impresora@print.epsonconnect.com"
              autoComplete="email"
            />
            <p className="field-hint">
              Los anexos aprobados se enviarán como PDF adjunto a esta dirección.
            </p>
          </div>

          <div className="annex-field">
            <label htmlFor="default-copies">Copias por defecto (alumnos)</label>
            <div className="copy-control-row">
              <div className="copy-stepper">
                <button
                  type="button"
                  className="btn-icon"
                  aria-label="Menos copias"
                  disabled={defaultCopies <= 1}
                  onClick={() => setDefaultCopies((prev) => clampCopies(prev - 1))}
                >
                  <UiIcon name="minus" size={16} />
                </button>
                <input
                  id="default-copies"
                  type="number"
                  min={1}
                  max={50}
                  value={defaultCopies}
                  onChange={(e) => setDefaultCopies(clampCopies(Number(e.target.value)))}
                />
                <button
                  type="button"
                  className="btn-icon"
                  aria-label="Más copias"
                  disabled={defaultCopies >= 50}
                  onClick={() => setDefaultCopies((prev) => clampCopies(prev + 1))}
                >
                  <UiIcon name="plus" size={16} />
                </button>
              </div>
              <div className="copy-presets" role="group" aria-label="Copias rápidas por grupo">
                {COPY_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`copy-preset-btn ac-num${defaultCopies === preset ? " is-active" : ""}`}
                    aria-pressed={defaultCopies === preset}
                    onClick={() => setDefaultCopies(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="annex-pair">
            <div className="annex-field">
              <label htmlFor="default-time">Hora sugerida de impresión</label>
              <input
                id="default-time"
                type="time"
                value={defaultTime}
                onChange={(e) => setDefaultTime(e.target.value)}
              />
            </div>
            <div className="annex-field">
              <label htmlFor="printer-tz">Zona horaria</label>
              <select
                id="printer-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                <option value="America/Mexico_City">Ciudad de México / Centro</option>
                <option value="America/Cancun">Cancún / Sureste</option>
                <option value="America/Monterrey">Monterrey</option>
                <option value="America/Hermosillo">Sonora / Pacífico</option>
                <option value="America/Tijuana">Tijuana / Noroeste</option>
              </select>
            </div>
          </div>

          <details className="printer-guide">
            <summary>
              <UiIcon name="chevron-down" size={16} />
              <span>¿Cómo encuentro el correo de mi Epson L3250?</span>
            </summary>
            <ol className="printer-guide-steps">
              <li>
                En <strong>Epson Connect</strong>, activa <strong>Email Print</strong> y copia la
                dirección <code>@print.epsonconnect.com</code>.
              </li>
              <li>
                En <strong>Lista de remitentes aprobados</strong>, agrega tu correo remitente SMTP
                (el mismo configurado en el servidor).
              </li>
              <li>
                Desactiva <strong>Imprimir el cuerpo del correo</strong> para que solo salga el
                anexo PDF limpio.
              </li>
            </ol>
          </details>

          <div className="annex-actions-bar">
            <button type="submit" className="primary" disabled={busy !== null}>
              {busy === "saving" ? "Guardando…" : "Guardar configuración"}
            </button>
            <button
              type="button"
              disabled={busy !== null || !printerEmail.trim()}
              onClick={() => void handleTestPage()}
            >
              <UiIcon name="printer" size={18} />
              <span>{busy === "test" ? "Enviando prueba…" : "Enviar hoja de prueba"}</span>
            </button>
          </div>
        </form>

        <section className="annex-card" aria-label="Cola de impresión">
          <div className="annex-card-header">
            <h2 className="annex-card-title">
              <span>Cola de impresión</span>
              <span className="ac-num">({jobs.length})</span>
            </h2>
            <div className="annex-actions-bar">
              <button
                type="button"
                className="btn-sm"
                disabled={busy !== null}
                onClick={() => void handleRefresh()}
              >
                <UiIcon name="refresh" size={16} />
                <span>{busy === "refresh" ? "Actualizando…" : "Actualizar"}</span>
              </button>
              {failedCount > 0 && (
                <button
                  type="button"
                  className="btn-sm"
                  disabled={busy !== null}
                  onClick={() => void handleClearQueue("failed")}
                >
                  {busy === "clear-failed" ? "Limpiando…" : `Limpiar errores (${failedCount})`}
                </button>
              )}
              {deletableCount > 0 && !confirmClear && (
                <button
                  type="button"
                  className="btn-danger-subtle btn-sm"
                  disabled={busy !== null}
                  onClick={() => setConfirmClear(true)}
                >
                  <UiIcon name="trash" size={15} />
                  <span>Vaciar cola</span>
                </button>
              )}
            </div>
          </div>

          {confirmClear && deletableCount > 0 && (
            <div
              className="inline-confirm-bar"
              role="region"
              aria-label="Confirmar vaciado de cola"
            >
              <p>
                <strong>
                  ¿Eliminar{" "}
                  {deletableCount === 1
                    ? "el trabajo"
                    : `los ${deletableCount} trabajos`}{" "}
                  de la cola?
                </strong>{" "}
                Se borrarán el historial y los envíos pendientes (los envíos en curso no se
                interrumpen).
              </p>
              <div className="annex-actions-bar">
                <button
                  type="button"
                  className="primary btn-sm"
                  disabled={busy !== null}
                  onClick={() => void handleClearQueue("all")}
                >
                  {busy === "clear-all" ? "Vaciando…" : "Sí, vaciar cola"}
                </button>
                <button
                  type="button"
                  className="btn-sm"
                  disabled={busy !== null}
                  onClick={() => setConfirmClear(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div
            className="filter-pills"
            role="tablist"
            aria-label="Filtrar cola de impresión"
          >
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={queueFilter === tab.id}
                className={`filter-pill${queueFilter === tab.id ? " is-active" : ""}`}
                onClick={() => setQueueFilter(tab.id)}
              >
                <span>{tab.label}</span>
                <span className="filter-pill-count ac-num">{tab.count}</span>
              </button>
            ))}
          </div>

          {!filteredJobs.length ? (
            <div className="empty-state-card">
              <UiIcon name={EMPTY_QUEUE_STATE[queueFilter].icon} size={28} />
              <h3>{EMPTY_QUEUE_STATE[queueFilter].title}</h3>
              <p>{EMPTY_QUEUE_STATE[queueFilter].copy}</p>
            </div>
          ) : (
            <div className="print-jobs-list">
              {filteredJobs.map((job) => (
                <article key={job.id} className="print-job-row">
                  <div className="print-job-top">
                    <div className="print-job-title-row">
                      <strong>{job.annex_title}</strong>
                      <span className="print-job-copies ac-num">
                        {job.copies} {job.copies === 1 ? "copia" : "copias"}
                      </span>
                    </div>
                    <span className={`ac-badge ${job.status}`}>
                      {statusLabel[job.status]}
                    </span>
                  </div>

                  <div className="print-job-meta">
                    <span>Destino: {job.printer_email}</span>
                    <span>
                      Programado:{" "}
                      <time dateTime={job.scheduled_for}>
                        {formatDateTime(job.scheduled_for)}
                      </time>
                    </span>
                    {job.sent_at && (
                      <span>
                        Enviado:{" "}
                        <time dateTime={job.sent_at}>
                          {formatDateTime(job.sent_at)}
                        </time>
                      </span>
                    )}
                    {job.attempts > 1 && (
                      <span className="ac-num">Intentos: {job.attempts}</span>
                    )}
                  </div>

                  {(job.status === "failed" ||
                    (job.status !== "sent" && Boolean(job.last_error))) && (
                    <div className="print-job-error">
                      <UiIcon name="alert" size={16} />
                      <span>{humanizePrintError(job.last_error)}</span>
                    </div>
                  )}

                  <div className="print-job-actions">
                    {job.status === "pending" && (
                      <button
                        type="button"
                        className="btn-sm"
                        disabled={busy !== null}
                        onClick={() => void handleCancel(job.id)}
                      >
                        Cancelar
                      </button>
                    )}
                    {job.status === "failed" && (
                      <button
                        type="button"
                        className="btn-sm"
                        disabled={busy !== null}
                        onClick={() => void handleRetry(job.id)}
                      >
                        <UiIcon name="refresh" size={15} />
                        <span>Reintentar</span>
                      </button>
                    )}
                    {job.status !== "sending" && (
                      <button
                        type="button"
                        className="btn-danger-subtle btn-sm"
                        aria-label={`Eliminar trabajo ${job.annex_title}`}
                        disabled={busy !== null}
                        onClick={() => void handleDeleteJob(job.id)}
                      >
                        <UiIcon name="trash" size={15} />
                        <span>Eliminar</span>
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
