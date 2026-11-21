import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import type { AcentaController } from "./controller";
import {
  AnnexPrintClient,
  annexErrorMessage,
  humanizePrintError,
  type PrintJob,
  type PrintSettings,
} from "./annex-api";
import { UiIcon, type UiIconName } from "./ui";
import "./annexes.css";

type QueueFilter = "all" | "pending" | "sent" | "errors";

const statusLabel: Record<PrintJob["status"], string> = {
  pending: "Programado",
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
    title: "Sin envíos todavía",
    copy: "Cuando imprimas una ficha desde Anexos o envíes una hoja de prueba, aparecerá aquí.",
  },
  pending: {
    icon: "clock",
    title: "Sin envíos programados",
    copy: "No hay trabajos pendientes en cola.",
  },
  sent: {
    icon: "check",
    title: "Sin envíos completados",
    copy: "Aún no se ha enviado ningún trabajo.",
  },
  errors: {
    icon: "check",
    title: "Sin errores",
    copy: "Todo está al día.",
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
  if (filter === "pending")
    return job.status === "pending" || job.status === "sending";
  if (filter === "sent") return job.status === "sent";
  return job.status === "failed" || job.status === "cancelled";
}

export function PrintSettingsView({
  controller,
  initialSettings,
  initialJobs,
}: {
  controller: AcentaController;
  initialSettings?: PrintSettings | null;
  initialJobs?: PrintJob[];
}) {
  const client = useMemo(
    () => new AnnexPrintClient(controller.api),
    [controller.api],
  );
  useSyncExternalStore(controller.schools.subscribe, controller.schools.snapshot);
  const activeSchool = controller.schools.getActiveSchool();

  const [settings, setSettings] = useState<PrintSettings | null>(
    initialSettings ?? null,
  );
  const [printerEmail, setPrinterEmail] = useState(
    initialSettings?.printer_email ?? "",
  );
  const [defaultCopies, setDefaultCopies] = useState(
    initialSettings?.default_copies ?? 25,
  );
  const [defaultTime, setDefaultTime] = useState(
    initialSettings?.default_print_time ?? "06:30",
  );
  const [timezone, setTimezone] = useState(
    initialSettings?.timezone ?? "America/Mexico_City",
  );
  const [jobs, setJobs] = useState<PrintJob[]>(initialJobs ?? []);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const syncDot = (list: PrintJob[]) => {
    controller.schools.setHasScheduledPrint(
      list.some((job) => job.status === "pending" || job.status === "sending"),
    );
  };

  const pendingCount = jobs.filter(
    (j) => j.status === "pending" || j.status === "sending",
  ).length;
  const failedCount = jobs.filter((j) => j.status === "failed").length;
  const deletableCount = jobs.filter((j) => j.status !== "sending").length;
  const filteredJobs = jobs.filter((j) => matchesFilter(j, queueFilter));

  const isReady = Boolean(settings?.printer_email && settings?.smtp_configured);
  const readinessLabel = isReady
    ? "Epson conectada"
    : settings?.smtp_configured
      ? "Falta correo Epson"
      : "SMTP pendiente en servidor";

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
      syncDot(list);
    } catch (err) {
      setError(annexErrorMessage(err));
    }
  };

  useEffect(() => {
    if (initialSettings !== undefined || initialJobs !== undefined) return;
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
      setNotice("Configuración guardada.");
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
      setJobs((prev) => {
        const next = [job, ...prev];
        syncDot(next);
        return next;
      });
      if (job.status === "sent") {
        setNotice(`Hoja de prueba enviada a ${job.printer_email}.`);
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
      setJobs((prev) => {
        const next = prev.map((j) => (j.id === jobId ? updated : j));
        syncDot(next);
        return next;
      });
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
      setJobs((prev) => {
        const next = prev.map((j) => (j.id === jobId ? updated : j));
        syncDot(next);
        return next;
      });
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
      setJobs((prev) => {
        const next = prev.filter((j) => j.id !== jobId);
        syncDot(next);
        return next;
      });
      setNotice("Trabajo eliminado.");
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
            ? `Se limpiaron ${result.deleted} ${result.deleted === 1 ? "error" : "errores"}.`
            : `Cola vaciada (${result.deleted} ${result.deleted === 1 ? "trabajo" : "trabajos"}).`,
        );
      }
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const filterTabs: { id: QueueFilter; label: string }[] = [
    { id: "all", label: "Todos" },
    { id: "pending", label: "Programados" },
    { id: "sent", label: "Enviados" },
    { id: "errors", label: "Errores" },
  ];

  return (
    <section className="printer-view minimal-printer-page">
      <div className="printer-inner">
        <header className="page-header">
          <div>
            <p className="minimal-studio-kicker minimal-printer-kicker">
              <span>
                {activeSchool.shortName} · {activeSchool.grade}
              </span>
              <span className="minimal-kicker-sep" aria-hidden="true">
                ·
              </span>
              <span
                className={`minimal-status-dot ${isReady ? "is-ready" : "is-pending"}`}
                aria-hidden="true"
              />
              <span>{readinessLabel}</span>
            </p>
            <h1>Impresora</h1>
          </div>
          <div className="topbar-right">
            <button
              type="button"
              className="glass-btn-sm"
              onClick={() => controller.navigate("annexes")}
            >
              <UiIcon name="worksheet" size={14} />
              <span>Anexos</span>
            </button>
            <button
              type="button"
              className="minimal-ghost-btn"
              onClick={() => controller.navigate("home")}
            >
              Volver al chat
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

        <form
          className="glass-card minimal-printer-card"
          onSubmit={(e) => void handleSave(e)}
        >
          <div className="printer-summary-row">
            <div className="printer-id">
              <div className="printer-icon-badge" aria-hidden="true">
                <UiIcon name="printer" size={20} />
              </div>
              <div>
                <h2>Epson Email Print</h2>
                <p className="minimal-save-whisper">
                  {settings?.smtp_configured ? "SMTP listo" : "SMTP pendiente"}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="glass-btn-sm"
              disabled={busy !== null || !printerEmail.trim()}
              onClick={() => void handleTestPage()}
            >
              <UiIcon name="printer" size={14} />
              <span>{busy === "test" ? "Enviando…" : "Hoja de prueba"}</span>
            </button>
          </div>

          <div className="annex-field">
            <label htmlFor="printer-email">Correo de tu impresora</label>
            <input
              id="printer-email"
              type="email"
              value={printerEmail}
              onChange={(e) => setPrinterEmail(e.target.value)}
              placeholder="mi-impresora@print.epsonconnect.com"
              autoComplete="email"
            />
          </div>

          <div className="minimal-printer-defaults">
            <div className="annex-field">
              <label htmlFor="default-copies">Copias por defecto</label>
              <div className="minimal-copies-pill">
                <button
                  type="button"
                  aria-label="Menos copias"
                  disabled={defaultCopies <= 1}
                  onClick={() =>
                    setDefaultCopies((prev) => clampCopies(prev - 1))
                  }
                >
                  <UiIcon name="minus" size={14} />
                </button>
                <input
                  id="default-copies"
                  type="number"
                  min={1}
                  max={50}
                  value={defaultCopies}
                  onChange={(e) =>
                    setDefaultCopies(clampCopies(Number(e.target.value)))
                  }
                />
                <button
                  type="button"
                  aria-label="Más copias"
                  disabled={defaultCopies >= 50}
                  onClick={() =>
                    setDefaultCopies((prev) => clampCopies(prev + 1))
                  }
                >
                  <UiIcon name="plus" size={14} />
                </button>
              </div>
            </div>

            <div className="annex-field">
              <label htmlFor="default-time">Hora programada</label>
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
                <option value="America/Mexico_City">
                  Ciudad de México / Centro
                </option>
                <option value="America/Cancun">Cancún / Sureste</option>
                <option value="America/Monterrey">Monterrey</option>
                <option value="America/Hermosillo">Sonora / Pacífico</option>
                <option value="America/Tijuana">Tijuana / Noroeste</option>
              </select>
            </div>
          </div>

          <details className="printer-guide minimal-printer-guide">
            <summary>
              <UiIcon name="chevron-down" size={15} />
              <span>Cómo encontrar el correo Epson</span>
            </summary>
            <ol className="printer-guide-steps">
              <li>
                En <strong>Epson Connect</strong>, activa{" "}
                <strong>Email Print</strong> y copia tu dirección{" "}
                <code>@print.epsonconnect.com</code>.
              </li>
              <li>
                Agrega tu remitente SMTP en la lista de remitentes aprobados.
              </li>
              <li>
                Desactiva <strong>Imprimir el cuerpo del correo</strong> para
                que salga solo la ficha PDF.
              </li>
            </ol>
          </details>

          <div className="minimal-printer-actions">
            <button
              type="submit"
              className="btn-accent-pill"
              disabled={busy !== null}
            >
              {busy === "saving" ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>

        <section
          className="glass-card minimal-queue-panel"
          aria-label="Cola de impresión"
        >
          <div className="minimal-queue-header">
            <div className="minimal-queue-title">
              <h2>Cola de impresión</h2>
              {pendingCount > 0 && (
                <span className="minimal-save-whisper">
                  {pendingCount}{" "}
                  {pendingCount === 1 ? "programado" : "programados"}
                </span>
              )}
            </div>
            <div className="minimal-canvas-icons">
              <button
                type="button"
                className="minimal-icon-btn"
                aria-label="Actualizar cola"
                title="Actualizar cola"
                disabled={busy !== null}
                onClick={() => void handleRefresh()}
              >
                <UiIcon name="refresh" size={16} />
              </button>
              {failedCount > 0 && (
                <button
                  type="button"
                  className="minimal-ghost-btn"
                  disabled={busy !== null}
                  onClick={() => void handleClearQueue("failed")}
                >
                  {busy === "clear-failed" ? "Limpiando…" : "Limpiar errores"}
                </button>
              )}
              {deletableCount > 0 && !confirmClear && (
                <button
                  type="button"
                  className="minimal-icon-btn is-danger"
                  aria-label="Vaciar cola"
                  title="Vaciar cola"
                  disabled={busy !== null}
                  onClick={() => setConfirmClear(true)}
                >
                  <UiIcon name="trash" size={16} />
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
              <span>
                ¿Vaciar{" "}
                {deletableCount === 1
                  ? "el trabajo"
                  : `los ${deletableCount} trabajos`}{" "}
                de la cola?
              </span>
              <div className="annex-actions-bar">
                <button
                  type="button"
                  className="btn-danger-subtle btn-sm"
                  disabled={busy !== null}
                  onClick={() => void handleClearQueue("all")}
                >
                  {busy === "clear-all" ? "Vaciando…" : "Sí, vaciar"}
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
            className="segmented-glass minimal-queue-tabs"
            role="tablist"
            aria-label="Filtrar cola de impresión"
          >
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={queueFilter === tab.id}
                className={queueFilter === tab.id ? "active" : ""}
                onClick={() => setQueueFilter(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {!filteredJobs.length ? (
            <div className="minimal-queue-empty">
              <UiIcon name={EMPTY_QUEUE_STATE[queueFilter].icon} size={22} />
              <h3>{EMPTY_QUEUE_STATE[queueFilter].title}</h3>
              <p>{EMPTY_QUEUE_STATE[queueFilter].copy}</p>
            </div>
          ) : (
            <ul className="minimal-queue-list">
              {filteredJobs.map((job) => (
                <li key={job.id} className="minimal-queue-row">
                  <div className="minimal-queue-row-main">
                    <div className="minimal-queue-row-title">
                      <span
                        className={`minimal-job-dot is-${job.status}`}
                        aria-hidden="true"
                      />
                      <strong>{job.annex_title}</strong>
                    </div>
                    <p className="minimal-queue-row-meta">
                      <span>
                        {job.copies} {job.copies === 1 ? "copia" : "copias"}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{statusLabel[job.status]}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={job.sent_at ?? job.scheduled_for}>
                        {formatDateTime(job.sent_at ?? job.scheduled_for)}
                      </time>
                    </p>
                    {(job.status === "failed" ||
                      (job.status !== "sent" && Boolean(job.last_error))) && (
                      <p className="minimal-queue-row-error" role="alert">
                        {humanizePrintError(job.last_error)}
                      </p>
                    )}
                  </div>
                  <div className="minimal-queue-row-actions">
                    {job.status === "pending" && (
                      <button
                        type="button"
                        className="minimal-ghost-btn"
                        disabled={busy !== null}
                        onClick={() => void handleCancel(job.id)}
                      >
                        Cancelar
                      </button>
                    )}
                    {job.status === "failed" && (
                      <button
                        type="button"
                        className="minimal-ghost-btn"
                        disabled={busy !== null}
                        onClick={() => void handleRetry(job.id)}
                      >
                        Reintentar
                      </button>
                    )}
                    {job.status !== "sending" && (
                      <button
                        type="button"
                        className="minimal-icon-btn is-danger"
                        aria-label={`Eliminar trabajo ${job.annex_title}`}
                        title="Eliminar"
                        disabled={busy !== null}
                        onClick={() => void handleDeleteJob(job.id)}
                      >
                        <UiIcon name="trash" size={15} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
