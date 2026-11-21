import { useEffect, useMemo, useState } from "react";
import type { AcentaController } from "./controller";
import {
  AnnexPrintClient,
  annexErrorMessage,
  type PrintJob,
  type PrintSettings,
} from "./annex-api";
import { Logo } from "./ui";
import "./annexes.css";

const statusLabel: Record<PrintJob["status"], string> = {
  pending: "Pendiente",
  sending: "Enviando…",
  sent: "Enviado",
  failed: "Error",
  cancelled: "Cancelado",
};

export function PrintSettingsView({ controller }: { controller: AcentaController }) {
  const client = useMemo(() => new AnnexPrintClient(controller.api), [controller.api]);
  const [settings, setSettings] = useState<PrintSettings | null>(null);
  const [printerEmail, setPrinterEmail] = useState("");
  const [defaultCopies, setDefaultCopies] = useState(25);
  const [defaultTime, setDefaultTime] = useState("06:30");
  const [timezone, setTimezone] = useState("America/Mexico_City");
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("saving");
    setError("");
    setNotice("");
    try {
      const saved = await client.savePrintSettings({
        printer_email: printerEmail.trim() || null,
        default_copies: defaultCopies,
        default_print_time: defaultTime,
        timezone,
      });
      setSettings(saved);
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
        setError(`No se pudo enviar la hoja de prueba (${job.last_error ?? "error_smtp"}).`);
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
    try {
      const updated = await client.cancelPrintJob(jobId);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
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
        setError(`El reintento falló (${updated.last_error ?? "error_smtp"}).`);
      }
    } catch (err) {
      setError(annexErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="printer-page">
      <header className="printer-header">
        <div>
          <Logo />
          <h1>Impresora Epson (Email Print)</h1>
          <p className="field-hint">
            Configura el correo de tu Epson L3250, envía una hoja de prueba y revisa la cola de impresión.
          </p>
        </div>
        <div className="annexes-header-actions">
          <button type="button" className="primary" onClick={() => controller.navigate("annexes")}>
            Ir a Anexos
          </button>
          <button type="button" onClick={() => controller.navigate("home")}>
            Volver al inicio
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="annex-alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="annex-status">
          {notice}
        </p>
      )}

      <form className="annex-card" onSubmit={(e) => void handleSave(e)}>
        <div className="annex-section-top">
          <h2>Configuración del docente</h2>
          <span
            className={`annex-badge ${settings?.smtp_configured ? "sent" : "pending"}`}
          >
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
          />
          <p className="field-hint">
            Recuerda agregar tu correo remitente SMTP a la Lista de remitentes aprobados en Epson Connect y desactivar la impresión del cuerpo del correo.
          </p>
        </div>

        <div className="annex-pair">
          <div className="annex-field">
            <label htmlFor="default-copies">Copias por defecto (alumnos)</label>
            <input
              id="default-copies"
              type="number"
              min={1}
              max={50}
              value={defaultCopies}
              onChange={(e) =>
                setDefaultCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
              }
            />
          </div>
          <div className="annex-field">
            <label htmlFor="default-time">Hora sugerida de impresión</label>
            <input
              id="default-time"
              type="time"
              value={defaultTime}
              onChange={(e) => setDefaultTime(e.target.value)}
            />
          </div>
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

        <div className="annex-actions-bar">
          <button type="submit" className="primary" disabled={busy !== null}>
            {busy === "saving" ? "Guardando…" : "Guardar configuración"}
          </button>
          <button
            type="button"
            disabled={busy !== null || !printerEmail.trim()}
            onClick={() => void handleTestPage()}
          >
            {busy === "test" ? "Enviando prueba…" : "Enviar hoja de prueba"}
          </button>
        </div>
      </form>

      <section className="annex-card">
        <div className="annex-section-top">
          <h2>Cola de impresión ({jobs.length})</h2>
          <button type="button" onClick={() => void load()}>
            Actualizar cola
          </button>
        </div>

        {!jobs.length && (
          <p className="field-hint">
            Aún no hay envíos a la impresora. Prueba con "Enviar hoja de prueba" o aprueba un anexo.
          </p>
        )}

        <div className="print-jobs-list">
          {jobs.map((job) => (
            <article key={job.id} className="print-job-row">
              <div className="print-job-meta">
                <strong>
                  {job.annex_title} ({job.copies}{" "}
                  {job.copies === 1 ? "copia" : "copias"})
                </strong>
                <span className="field-hint">
                  Destino: {job.printer_email} · Programado:{" "}
                  {new Date(job.scheduled_for).toLocaleString("es-MX")}
                </span>
                {job.sent_at && (
                  <span className="field-hint">
                    Enviado: {new Date(job.sent_at).toLocaleString("es-MX")}
                  </span>
                )}
                {job.last_error && (
                  <span className="field-hint" style={{ color: "#8f1d14" }}>
                    Detalle: {job.last_error}
                  </span>
                )}
              </div>

              <div className="annex-actions-bar">
                <span className={`annex-badge ${job.status}`}>
                  {statusLabel[job.status]}
                </span>
                {job.status === "pending" && (
                  <button
                    type="button"
                    disabled={busy === job.id}
                    onClick={() => void handleCancel(job.id)}
                  >
                    Cancelar
                  </button>
                )}
                {job.status === "failed" && (
                  <button
                    type="button"
                    disabled={busy === job.id}
                    onClick={() => void handleRetry(job.id)}
                  >
                    Reintentar
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
