import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AuthController } from "./auth";
interface GoogleIdentity {
  initialize(options: {
    client_id: string;
    nonce: string;
    callback: (response: { credential: string }) => void;
    auto_select: boolean;
  }): void;
  renderButton(
    element: HTMLElement,
    options: {
      type: string;
      theme: string;
      size: string;
      text: string;
      locale: string;
    },
  ): void;
  cancel(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } };
  }
}
let googleScript: Promise<GoogleIdentity> | undefined;
function loadGoogle(): Promise<GoogleIdentity> {
  if (window.google?.accounts.id)
    return Promise.resolve(window.google.accounts.id);
  if (!googleScript)
    googleScript = new Promise<GoogleIdentity>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      const timer = window.setTimeout(() => {
        script.remove();
        reject(new Error("unavailable"));
      }, 15000);
      script.onload = () => {
        clearTimeout(timer);
        if (window.google?.accounts.id) resolve(window.google.accounts.id);
        else reject(new Error("unavailable"));
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        reject(new Error("unavailable"));
      };
      document.head.append(script);
    }).catch((error) => {
      googleScript = undefined;
      throw error;
    });
  return googleScript;
}
function GoogleButton({
  auth,
  clientId,
  nonce,
}: {
  auth: AuthController;
  clientId: string;
  nonce: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let identity: GoogleIdentity | undefined;
    void loadGoogle()
      .then((google) => {
        if (!active || !ref.current) return;
        identity = google;
        google.initialize({
          client_id: clientId,
          nonce,
          auto_select: false,
          callback: (response) => {
            if (active && typeof response.credential === "string")
              void auth.login("google", response.credential);
          },
        });
        google.renderButton(ref.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          locale: "es",
        });
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      identity?.cancel();
      ref.current?.replaceChildren();
    };
  }, [auth, clientId, nonce]);
  return error ? (
    <p role="status">
      Google no está disponible ahora. Inténtalo de nuevo más tarde.
    </p>
  ) : (
    <div ref={ref} aria-label="Continuar con Google" />
  );
}
export function AuthAccessView({ auth }: { auth: AuthController }) {
  const state = useSyncExternalStore(auth.subscribe, auth.snapshot);
  const [view, setView] = useState<"select" | "email" | "legal">("select");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [invalid, setInvalid] = useState("");
  const change = (next: typeof view) => {
    if (!state.busy) {
      setView(next);
      setInvalid("");
      setCode("");
      auth.resetChallenge();
    }
  };
  return (
    <main className="access">
      <div className="access-left">
        <div className="access-brand">
          <img
            className="logo large"
            src="/acenta/acenta-logo-reconstruido-tinta.svg"
            alt="Acenta"
          />
        </div>
        {view === "legal" ? (
          <section className="access-form">
            <h1>Documentos en preparación</h1>
            <p>
              Los Términos y condiciones y el Aviso de privacidad de Acenta
              están pendientes de redacción y revisión.
            </p>
            <p>Esta vista no registra aceptación.</p>
            <button onClick={() => change("select")}>Volver</button>
          </section>
        ) : (
          <section
            className={view === "select" ? "access-selector" : "access-form"}
          >
            <h1>
              {view === "select"
                ? "Bienvenido"
                : state.challenge
                  ? "Revisa tu correo"
                  : "Continúa con tu correo"}
            </h1>
            {state.phase === "loading" && (
              <p role="status">Comprobando sesión…</p>
            )}
            {state.error && <p role="alert">{state.error}</p>}
            {state.phase === "suspended" ? (
              <>
                <button onClick={() => void auth.revalidate()}>
                  Reintentar sesión
                </button>
                <button onClick={() => void auth.logout()}>
                  Cerrar sesión
                </button>
              </>
            ) : state.phase === "logout-error" ? (
              <button onClick={() => void auth.logout()} disabled={state.busy}>
                Reintentar cierre de sesión
              </button>
            ) : (
              state.phase !== "loading" && (
                <>
                  {view === "select" ? (
                    <>
                      {state.bootstrap?.google_client_id ? (
                        <GoogleButton
                          auth={auth}
                          clientId={state.bootstrap.google_client_id}
                          nonce={state.bootstrap.google_nonce}
                        />
                      ) : (
                        <>
                          <button className="google" disabled>
                            <img
                              src="/acenta/google-g-oficial.svg"
                              alt=""
                              width="20"
                              height="20"
                            />
                            Continuar con Google
                          </button>
                          <p className="field-hint">
                            Google no está configurado en este entorno.
                          </p>
                        </>
                      )}
                      <button
                        className="text-action"
                        disabled={
                          state.busy || !state.bootstrap?.email_available
                        }
                        onClick={() => change("email")}
                      >
                        Continuar con correo
                      </button>
                      {!state.bootstrap?.email_available && (
                        <p className="field-hint">
                          El acceso por correo no está disponible en este
                          entorno.
                        </p>
                      )}
                      {!state.bootstrap && (
                        <button
                          disabled={state.busy}
                          onClick={() => void auth.start()}
                        >
                          Reintentar acceso
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        className="text-action small-text"
                        disabled={state.busy}
                        onClick={() => change("select")}
                      >
                        Volver
                      </button>
                      {state.challenge ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (!/^\d{8}$/.test(code)) {
                              setInvalid("Escribe el código de 8 dígitos.");
                              return;
                            }
                            setInvalid("");
                            void auth.login("code", code);
                          }}
                        >
                          <p role="status">{state.challenge.message}</p>
                          <label htmlFor="auth-code">Código de un uso</label>
                          <input
                            id="auth-code"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={8}
                            value={code}
                            onChange={(event) => {
                              setCode(event.target.value);
                              setInvalid("");
                            }}
                            aria-invalid={!!invalid}
                            aria-describedby="auth-help"
                            disabled={state.busy}
                          />
                          <p className="field-hint">
                            El código caduca en 10 minutos.
                          </p>
                          <button
                            className="primary wide"
                            disabled={state.busy}
                            type="submit"
                          >
                            {state.busy ? "Comprobando…" : "Verificar código"}
                          </button>
                          <button
                            className="text-action"
                            disabled={state.busy}
                            type="button"
                            onClick={() => {
                              setCode("");
                              setInvalid("");
                              void auth.requestCode(email);
                            }}
                          >
                            Solicitar otro código
                          </button>
                          <button
                            className="text-action"
                            disabled={state.busy}
                            type="button"
                            onClick={() => {
                              setCode("");
                              auth.resetChallenge();
                            }}
                          >
                            Cambiar correo
                          </button>
                        </form>
                      ) : (
                        <form
                          noValidate
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                              setInvalid(
                                "Escribe un correo válido para continuar.",
                              );
                              return;
                            }
                            setInvalid("");
                            void auth.requestCode(email);
                          }}
                        >
                          <p className="secondary">
                            Entra o crea tu cuenta con un código de un uso.
                          </p>
                          <label htmlFor="auth-email">Correo electrónico</label>
                          <input
                            id="auth-email"
                            type="email"
                            autoComplete="email"
                            value={email}
                            placeholder="nombre@ejemplo.com"
                            onChange={(event) => {
                              setEmail(event.target.value);
                              setInvalid("");
                            }}
                            aria-invalid={!!invalid}
                            aria-describedby="auth-help"
                            disabled={state.busy}
                          />
                          <button
                            className="primary wide"
                            type="submit"
                            disabled={
                              state.busy || !state.bootstrap?.email_available
                            }
                          >
                            {state.busy ? "Solicitando…" : "Enviar código"}
                          </button>
                        </form>
                      )}
                      <p
                        id="auth-help"
                        className="validation"
                        role={invalid ? "alert" : undefined}
                      >
                        {invalid}
                      </p>
                      <p className="field-hint">
                        Google y correo pueden crear cuentas separadas. Usa
                        siempre el mismo método para recuperar tus recursos.
                      </p>
                    </>
                  )}
                </>
              )
            )}
          </section>
        )}
        {view !== "legal" && (
          <footer className="access-legal">
            <button disabled={state.busy} onClick={() => change("legal")}>
              Términos y condiciones
            </button>
            <button disabled={state.busy} onClick={() => change("legal")}>
              Aviso de privacidad
            </button>
          </footer>
        )}
      </div>
      <div className="access-photo">
        <img
          src="/acenta/foto-aprobada-recorte.png"
          alt="Docente preparando su clase junto a una computadora y un cuaderno"
        />
      </div>
    </main>
  );
}
