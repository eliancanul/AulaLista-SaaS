import { EditorRecovery, uncertainPurgeNotice } from "./editor-recovery";
import { AcentaApi, ApiError, isUuid, type Transport } from "./api";
import { AcentaController } from "./controller";

export interface AuthSession {
  principal_id: string;
  scope_id: string;
  csrf_token: string;
  recovery_context_id: string | null;
}
export interface Bootstrap {
  csrf_token: string;
  google_nonce: string;
  google_client_id: string | null;
  email_available: boolean;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function parseSession(v: unknown): AuthSession {
  if (
    !object(v) ||
    !isUuid(v.principal_id) ||
    !isUuid(v.scope_id) ||
    typeof v.csrf_token !== "string" ||
    !v.csrf_token ||
    !(v.recovery_context_id === undefined || v.recovery_context_id === null || isUuid(v.recovery_context_id))
  )
    throw new ApiError(0, "invalid_response");
  return {
    principal_id: v.principal_id,
    scope_id: v.scope_id,
    csrf_token: v.csrf_token,
    recovery_context_id: (v.recovery_context_id as string | null | undefined) ?? null,
  };
}
export class AuthApi {
  constructor(
    readonly transport: Transport = (input, init) =>
      globalThis.fetch(input, init),
  ) {}
  private async request(
    path: string,
    csrf?: string,
    body?: unknown,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(`/auth/${path}`, {
        method: csrf === undefined ? "GET" : "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers:
          csrf === undefined
            ? {}
            : {
                "X-CSRF-Token": csrf,
                ...(body === undefined
                  ? {}
                  : { "Content-Type": "application/json" }),
              },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ApiError(0, "unavailable");
    }
    if (response.status === 204) return null;
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ApiError(response.ok ? 0 : response.status, "invalid_response");
    }
    if (!response.ok)
      throw new ApiError(
        response.status,
        object(value) && typeof value.detail === "string"
          ? value.detail
          : "unavailable",
      );
    return value;
  }
  async bootstrap(): Promise<Bootstrap> {
    const v = await this.request("bootstrap");
    if (
      !object(v) ||
      typeof v.csrf_token !== "string" ||
      !v.csrf_token ||
      typeof v.google_nonce !== "string" ||
      !v.google_nonce ||
      !(
        v.google_client_id === null ||
        (typeof v.google_client_id === "string" && !!v.google_client_id)
      ) ||
      typeof v.email_available !== "boolean"
    )
      throw new ApiError(0, "invalid_response");
    return v as unknown as Bootstrap;
  }
  async session() {
    return parseSession(await this.request("session"));
  }
  async google(credential: string, csrf: string) {
    return parseSession(await this.request("google", csrf, { credential }));
  }
  async requestCode(email: string, csrf: string) {
    const v = await this.request("email/request", csrf, { email });
    if (
      !object(v) ||
      typeof v.challenge_id !== "string" ||
      !v.challenge_id ||
      typeof v.message !== "string"
    )
      throw new ApiError(0, "invalid_response");
    return { challenge_id: v.challenge_id, message: v.message };
  }
  async verifyCode(challenge_id: string, code: string, csrf: string) {
    return parseSession(
      await this.request("email/verify", csrf, { challenge_id, code }),
    );
  }
  async logout(csrf: string) {
    await this.request("logout", csrf);
  }
}
export function authMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "invalid_code")
      return "El código no es válido o ha caducado. Revísalo o solicita otro.";
    if (error.status === 429)
      return "Demasiados intentos. Espera antes de volver a intentarlo.";
    if (error.status === 401 || error.status === 403)
      return "El acceso ha caducado. Vuelve a intentarlo.";
    if (error.status === 422)
      return "Revisa el correo o el código e inténtalo de nuevo.";
  }
  return "El acceso no está disponible ahora. Vuelve a intentarlo.";
}
interface AuthState {
  workspaceVersion: number;
  phase: "loading" | "access" | "ready" | "suspended" | "logout-error";
  bootstrap: Bootstrap | null;
  controller: AcentaController | null;
  busy: boolean;
  challenge: { challenge_id: string; message: string } | null;
  error: string;
  recoveryWarning: string;
}
/** Owns authority and the private-view gate. Credentials never enter browser storage. */
export class AuthController {
  private state: AuthState = {
    workspaceVersion: 0,
    phase: "loading",
    bootstrap: null,
    controller: null,
    busy: false,
    challenge: null,
    error: "",
    recoveryWarning: "",
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private session: AuthSession | null = null;
  private logoutSession: AuthSession | null = null;
  private checking = false;
  private recovering = false;
  private inactive = false;
  private visibilityEpoch = 0;
  constructor(readonly api = new AuthApi(), readonly recovery = new EditorRecovery()) {}
  snapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit(patch: Partial<AuthState>) {
    this.state = { ...this.state, ...patch, recoveryWarning: this.recovery.warning };
    for (const fn of this.listeners) fn();
  }
  private clear(purge = true) {
    this.state.controller?.closeSession();
    if (purge) this.recovery.purge();
    this.recovering = false;
    this.session = null;
    this.emit({ controller: null, bootstrap: null, challenge: null });
  }
  private async accept(session: AuthSession, generation: number, restore = false) {
    const uncertain = !!this.state.controller?.snapshot().editor?.pending || !!this.recovery.candidate?.pending;
    this.clear(!restore);
    this.session = session;
    const transport: Transport = async (input, init) => {
      if (this.session !== session) throw new ApiError(401, "unauthorized");
      if (this.state.phase !== "ready" && !(this.recovering && (!init?.method || init.method === "GET")))
        throw new ApiError(0, "session_unconfirmed");
      const epoch=this.generation;
      const headers = new Headers(init?.headers);
      if (init?.method && init.method !== "GET") headers.set("X-CSRF-Token", session.csrf_token);
      const response = await this.api.transport(input, { ...init, headers });
      if (epoch !== this.generation || this.session !== session) throw new ApiError(0,"session_unconfirmed");
      if (response.status === 401 || response.status === 403) void this.expire();
      return response;
    };
    this.recovery.admit(session, restore);
    if (uncertain) this.recovery.warning = [this.recovery.warning, uncertainPurgeNotice].filter(Boolean).join(" ");
    const controller=new AcentaController(new AcentaApi({actorId:session.principal_id,scopeId:session.scope_id},transport),null,crypto.randomUUID(),this.recovery);
    this.emit({phase:"loading", controller, workspaceVersion:this.state.workspaceVersion+1, busy:true, error:""});
    this.recovering=true;
    await controller.restoreRecovery();
    if (generation !== this.generation || this.session !== session) return;
    this.recovering=false;
    this.emit({phase:"ready",busy:false});
  }
  private async acceptLogin(session: AuthSession, generation: number, visibilityEpoch: number) {
    if (this.inactive || visibilityEpoch !== this.visibilityEpoch) {
      // A login may finish while the email app is open. Keep its authority gated
      // until a fresh session check, without repeating the single-use submission.
      this.clear();
      this.session = session;
      this.emit({ phase: "suspended", busy: false, error: "Comprueba tu sesión para continuar." });
      if (!this.inactive) await this.revalidate(true);
      return;
    }
    await this.accept(session, generation);
  }
  async start() {
    if (this.logoutSession) return;
    if (this.session) {
      await this.revalidate();
      return;
    }
    const generation = ++this.generation;
    this.clear(false);
    this.checking=true;
    this.emit({ phase: "loading", busy: true, error: "" });
    try {
      const session = await this.api.session();
      if (generation === this.generation) await this.accept(session, generation, true);
    } catch (error) {
      if (generation !== this.generation) return;
      if (!(error instanceof ApiError) || ![401,403].includes(error.status)) {
        this.emit({ phase: "access", busy: false, error: authMessage(error) });
        return;
      }
      this.recovery.purge(true);
      await this.prepare(generation);
    } finally { if (generation === this.generation) this.checking=false; }
  }
  private async prepare(generation: number) {
    try {
      const bootstrap = await this.api.bootstrap();
      if (generation === this.generation)
        this.emit({ phase: "access", bootstrap, busy: false });
    } catch (error) {
      if (generation === this.generation)
        this.emit({ phase: "access", busy: false, error: authMessage(error) });
    }
  }
  async expire() {
    this.checking=false;
    const generation = ++this.generation;
    this.clear();
    this.emit({
      phase: "access",
      busy: true,
      error: `Tu sesión ha terminado. Vuelve a entrar. ${uncertainPurgeNotice}`,
    });
    await this.prepare(generation);
  }
  suspend() {
    this.inactive = true;
    this.visibilityEpoch++;
    if (this.logoutSession) return; // Already hidden; do not interrupt revocation confirmation.
    if (!["ready","suspended","loading"].includes(this.state.phase)) return;
    this.generation++;
    this.checking=false;
    this.recovering=false;
    this.state.controller?.suspend();
    this.emit({phase:"suspended",busy:false,error:"Comprueba tu sesión para continuar."});
  }
  async revalidate(activation = false) {
    if (this.logoutSession) return;
    if (activation && this.state.phase === "ready") this.suspend();
    this.inactive = false;
    if (this.checking) return;
    if (!this.session) {
      if (["loading","suspended"].includes(this.state.phase)) await this.start();
      return;
    }
    if (!["ready","suspended"].includes(this.state.phase)) return;
    this.checking=true;
    const session=this.session, generation=this.generation;
    // Activation closes the gate; periodic observation keeps a confirmed workspace mounted.
    if (this.state.phase === "suspended") this.emit({error:"Comprobando tu sesión…"});
    try {
      const current=await this.api.session();
      if (this.session !== session || generation !== this.generation) return;
      if (!this.state.controller || current.principal_id !== session.principal_id || current.scope_id !== session.scope_id || current.csrf_token !== session.csrf_token || current.recovery_context_id !== session.recovery_context_id) {
        await this.accept(current,generation);
      } else if (this.state.phase === "ready") {
        this.emit({error:""});
      } else {
        const controller=this.state.controller;
        controller?.resume();
        this.recovering=true;
        await controller?.restoreRecovery();
        if (this.session !== session || generation !== this.generation) return;
        this.recovering=false;
        this.emit({phase:"ready",error:"",busy:false});
      }
    } catch(error) {
      if (this.session !== session || generation !== this.generation) return;
      if (error instanceof ApiError && [401,403].includes(error.status)) await this.expire();
      else {
        this.suspend();
        this.emit({phase:"suspended",busy:false,error:"No pudimos comprobar tu sesión. Conservamos tu trabajo pendiente en esta pestaña; vuelve a intentarlo sin recargarla."});
      }
    } finally { if (generation === this.generation) { this.checking=false; this.recovering=false; } }
  }
  async requestCode(email: string) {
    const bootstrap = this.state.bootstrap;
    if (this.state.busy || !bootstrap?.email_available) return;
    const generation = this.generation;
    this.emit({ busy: true, error: "", challenge: null });
    try {
      const challenge = await this.api.requestCode(email, bootstrap.csrf_token);
      if (generation === this.generation) this.emit({ challenge });
    } catch (error) {
      if (generation !== this.generation) return;
      this.emit({ error: authMessage(error) });
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        this.emit({ bootstrap: null });
        await this.prepare(generation);
      }
    } finally {
      if (generation === this.generation) this.emit({ busy: false });
    }
  }
  async login(method: "google" | "code", value: string) {
    const { bootstrap, challenge, busy } = this.state;
    if (
      busy ||
      !bootstrap ||
      (method === "code" && !challenge) ||
      (method === "google" && !bootstrap.google_client_id)
    )
      return;
    const generation = this.generation, visibilityEpoch = this.visibilityEpoch;
    this.emit({ busy: true, error: "" });
    try {
      const session =
        method === "google"
          ? await this.api.google(value, bootstrap.csrf_token)
          : await this.api.verifyCode(
              challenge!.challenge_id,
              value,
              bootstrap.csrf_token,
            );
      if (generation === this.generation) await this.acceptLogin(session, generation, visibilityEpoch);
    } catch (error) {
      if (generation !== this.generation) return;
      // A lost login response can still have installed the HttpOnly session cookie.
      // Reconcile through the server before allowing another single-use submission.
      if (error instanceof ApiError && error.uncertain) {
        try {
          const session = await this.api.session();
          if (generation === this.generation) await this.acceptLogin(session, generation, visibilityEpoch);
          return;
        } catch {
          /* Remain anonymous if the server cannot confirm authority. */
        }
      }
      if (generation !== this.generation) return;
      this.emit({ error: authMessage(error) });
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        this.emit({ bootstrap: null, challenge: null });
        await this.prepare(generation);
      }
    } finally {
      if (generation === this.generation) this.emit({ busy: false });
    }
  }
  resetChallenge() {
    if (!this.state.busy) this.emit({ challenge: null, error: "" });
  }
  async logout() {
    const session = this.session ?? this.logoutSession;
    if (this.state.busy || !session) return;
    const uncertain = !!this.state.controller?.snapshot().editor?.pending || !!this.recovery.candidate?.pending;
    this.logoutSession = session;
    this.session = null;
    const generation = ++this.generation;
    this.state.controller?.closeSession();
    this.recovery.purge(uncertain);
    this.recovering=false;
    this.checking=false;
    this.emit({
      phase: "loading",
      controller: null,
      bootstrap: null,
      challenge: null,
      busy: true,
      error: "",
    });
    try {
      await this.api.logout(session.csrf_token);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        this.emit({
          phase: "logout-error",
          busy: false,
          error:
            "No pudimos confirmar el cierre de sesión. Vuelve a intentarlo antes de cambiar de cuenta.",
        });
        return;
      }
    }
    this.logoutSession = null;
    await this.prepare(generation);
  }
}
