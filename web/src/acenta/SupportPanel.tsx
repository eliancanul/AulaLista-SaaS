import { useState } from "react";
import type { AcentaApi } from "./api";
import type { DebugBundle } from "./debug-telemetry";
import type { CapturedScreenshot } from "./screen-capture";
import { createSupportTicket, type SupportTicketSummary } from "./support-api";

function deriveSummary(message: string): string {
  const singleLine = message.replace(/\s+/g, " ").trim();
  if (singleLine.length <= 120) return singleLine;
  return `${singleLine.slice(0, 117).trimEnd()}…`;
}

export function SupportPanel({
  api,
  viewName,
  initialScreenshot,
  initialDebugBundle,
  onClose,
}: {
  api: AcentaApi;
  viewName: string;
  initialScreenshot: CapturedScreenshot | null;
  initialDebugBundle: DebugBundle;
  onClose?: () => void;
}) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdTicket, setCreatedTicket] =
    useState<SupportTicketSummary | null>(null);

  const trimmed = message.trim();
  const canSubmit = trimmed.length >= 3 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const saved = await createSupportTicket(api, {
        category: "bug",
        severity: "medium",
        summary: deriveSummary(trimmed),
        description: trimmed,
        view_name: viewName,
        route_url: initialDebugBundle.route,
        screenshot_data_url: initialScreenshot?.dataUrl ?? null,
        debug_bundle: initialDebugBundle,
      });
      setCreatedTicket(saved);
      setMessage("");
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? `No se pudo enviar tu reporte (${err.message}).`
          : "No se pudo enviar tu reporte. Intenta de nuevo.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="support-simple-shell" data-support-overlay="true">
      {createdTicket ? (
        <div className="support-simple-done" role="status">
          <p className="support-simple-done-title">¡Listo! Recibimos tu reporte.</p>
          <p className="support-simple-note">
            Lo revisaremos pronto. Si necesitas agregar algo más, puedes enviarnos
            otro mensaje.
          </p>
          <div className="support-simple-actions">
            <button
              type="button"
              className="support-btn-secondary"
              onClick={() => setCreatedTicket(null)}
            >
              Enviar otro
            </button>
            {onClose && (
              <button
                type="button"
                className="support-btn-primary"
                onClick={onClose}
              >
                Cerrar
              </button>
            )}
          </div>
        </div>
      ) : (
        <form
          className="support-simple-form"
          onSubmit={(e) => void handleSubmit(e)}
        >
          <label className="support-simple-label" htmlFor="support-message-input">
            <span>¿Qué pasó?</span>
            <textarea
              id="support-message-input"
              autoFocus
              required
              minLength={3}
              maxLength={4000}
              rows={4}
              placeholder="Cuéntanos brevemente qué pasó o qué no funcionó como esperabas…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <p className="support-simple-note">
            Guardamos automáticamente una captura y datos técnicos para ayudarte
            más rápido.
          </p>
          {submitError && (
            <p className="support-error" role="alert">
              {submitError}
            </p>
          )}
          <div className="support-simple-actions">
            {onClose && (
              <button
                type="button"
                className="support-btn-secondary"
                disabled={submitting}
                onClick={onClose}
              >
                Cancelar
              </button>
            )}
            <button
              type="submit"
              className="support-btn-primary"
              disabled={!canSubmit}
            >
              {submitting ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
