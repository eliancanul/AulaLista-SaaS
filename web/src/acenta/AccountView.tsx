import { useEffect, useState } from "react";
import type { AcentaApi } from "./api";
import {
  getAccount,
  requestEmailLink,
  updateAccountPreferences,
  verifyEmailLink,
  type AccountDocument,
} from "./support-api";

export function AccountView({
  api,
  onOpenSupport,
}: {
  api: AcentaApi;
  onOpenSupport: () => void;
}) {
  const [account, setAccount] = useState<AccountDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingConsent, setSavingConsent] = useState(false);

  const [linkEmail, setLinkEmail] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [linkStatus, setLinkStatus] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setAccount(await getAccount(api));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar tu cuenta.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [api.session.scopeId]);

  async function toggleConsent(next: boolean) {
    setSavingConsent(true);
    setError(null);
    try {
      setAccount(await updateAccountPreferences(api, next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar tu preferencia.");
    } finally {
      setSavingConsent(false);
    }
  }

  async function handleRequestLink(e: React.FormEvent) {
    e.preventDefault();
    if (!linkEmail.trim() || linking) return;
    setLinking(true);
    setError(null);
    setLinkStatus(null);
    try {
      const res = await requestEmailLink(api, linkEmail.trim());
      setChallengeId(res.challenge_id);
      setLinkStatus(res.message);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message === "identity_conflict"
            ? "Este correo ya está vinculado a otra cuenta."
            : err.message === "identity_already_linked"
              ? "Este correo ya está vinculado a tu cuenta."
              : err.message === "email_sender_unavailable"
                ? "El envío de códigos OTP por SMTP no está habilitado en este entorno."
                : `No se pudo enviar el código (${err.message}).`
          : "No se pudo enviar el código.",
      );
    } finally {
      setLinking(false);
    }
  }

  async function handleVerifyLink(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeId || otpCode.length !== 8 || linking) return;
    setLinking(true);
    setError(null);
    try {
      const updated = await verifyEmailLink(api, challengeId, otpCode);
      setAccount(updated);
      setChallengeId(null);
      setLinkEmail("");
      setOtpCode("");
      setLinkStatus("Correo vinculado correctamente a tu cuenta.");
    } catch (err) {
      setError(
        err instanceof Error && err.message === "invalid_code"
          ? "Código inválido o expirado. Intenta nuevamente."
          : "No se pudo verificar el código.",
      );
    } finally {
      setLinking(false);
    }
  }

  return (
    <section className="account-studio-view" aria-label="Mi cuenta">
      <header className="account-studio-header">
        <div>
          <h1>Mi cuenta y acceso</h1>
          <p className="support-muted">
            Administra tus métodos de inicio de sesión, consentimiento de avisos y canal de soporte.
          </p>
        </div>
        <button type="button" className="support-btn-secondary" onClick={onOpenSupport}>
          Abrir soporte y debug
        </button>
      </header>

      {loading && <p className="support-muted">Cargando configuración de cuenta…</p>}
      {error && (
        <p className="support-error" role="alert">
          {error}
        </p>
      )}

      {account && (
        <div className="account-cards-grid">
          <article className="account-card">
            <h2>Métodos de acceso vinculados</h2>
            <p className="support-muted">
              Puedes vincular Google y correo con código OTP bajo la misma cuenta docente.
            </p>
            {account.identities.length ? (
              <ul className="account-identity-list">
                {account.identities.map((id) => (
                  <li key={id.id} className="account-identity-row">
                    <div>
                      <strong>
                        {id.provider === "google" ? "Google" : "Correo OTP"}
                      </strong>
                      <span>{id.email}</span>
                    </div>
                    <span className="support-badge is-status-resolved">
                      {id.email_verified ? "Verificado" : "Pendiente"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="support-muted">
                Sesión de desarrollo local activa (principal <code>{account.principal_id.slice(0, 8)}</code>).
              </p>
            )}

            <div className="account-link-box">
              <h3>Vincular acceso por correo (OTP)</h3>
              {!challengeId ? (
                <form className="account-inline-form" onSubmit={(e) => void handleRequestLink(e)}>
                  <input
                    type="email"
                    required
                    placeholder="docente@escuela.mx"
                    value={linkEmail}
                    onChange={(e) => setLinkEmail(e.target.value)}
                  />
                  <button type="submit" className="support-btn-primary" disabled={linking}>
                    {linking ? "Enviando…" : "Enviar código OTP"}
                  </button>
                </form>
              ) : (
                <form className="account-inline-form" onSubmit={(e) => void handleVerifyLink(e)}>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{8}"
                    maxLength={8}
                    required
                    placeholder="Código de 8 dígitos"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  />
                  <button type="submit" className="support-btn-primary" disabled={linking}>
                    {linking ? "Verificando…" : "Confirmar vínculo"}
                  </button>
                  <button
                    type="button"
                    className="support-btn-secondary"
                    onClick={() => {
                      setChallengeId(null);
                      setOtpCode("");
                    }}
                  >
                    Cancelar
                  </button>
                </form>
              )}
              {linkStatus && <p className="support-muted">{linkStatus}</p>}
            </div>
          </article>

          <article className="account-card">
            <h2>Consentimiento promocional opcional</h2>
            <p className="support-muted">
              Acenta nunca te enviará novedades o invitaciones comerciales sin tu permiso expreso. Puedes revocarlo en cualquier momento.
            </p>
            <label className="account-consent-toggle">
              <input
                type="checkbox"
                checked={account.promotional_consent}
                disabled={savingConsent}
                onChange={(e) => void toggleConsent(e.target.checked)}
              />
              <span>
                {account.promotional_consent
                  ? "Acepto recibir novedades y mejoras de Acenta por correo"
                  : "No deseo recibir correos promocionales (sólo correos esenciales)"}
              </span>
            </label>
            {account.promotional_consent_updated_at && (
              <p className="support-muted">
                Último cambio:{" "}
                {new Date(account.promotional_consent_updated_at).toLocaleString("es-MX")}
              </p>
            )}
            {account.consent_history.length > 0 && (
              <details className="support-debug-section">
                <summary>Historial de consentimiento ({account.consent_history.length})</summary>
                <ul className="account-consent-history">
                  {[...account.consent_history].reverse().map((h, i) => (
                    <li key={`${h.at}-${i}`}>
                      {h.promotional_consent ? "Activado" : "Revocado"} ·{" "}
                      {new Date(h.at).toLocaleString("es-MX")} ({h.source})
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
