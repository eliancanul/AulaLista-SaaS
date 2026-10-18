import { isUuid, parseGeneratedRequest } from "./api";
import type { EditorIntent, EditorState, BackupStore, CreateIntent } from "./controller";
import type { GeneratedPlanningRequest } from "./contracts";

export const RECOVERY_KEY = "acenta:editor-recovery:v1";
export const RECOVERY_TTL = 86_400_000;
const MAX_BYTES = 16_384;
const tombstone = '{"schema":1,"cleared":true}';
export interface RecoveryIdentity {
  principal_id: string;
  scope_id: string;
  recovery_context_id: string | null;
}
export interface RecoveryEnvelope extends RecoveryIdentity {
  schema: 1;
  recovery_context_id: string;
  workspace_id: string;
  created_at_ms: number;
  expires_at_ms: number;
  base: { planning_id: string; revision: number; revision_id: string; resource_key: string; element_key: string };
  buffer: { text: string; generation: number; draft_id: string; draft_revision: number };
  pending: EditorIntent | null;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function exact(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!record(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw Error("invalid recovery fields");
}
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const key = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const text = (v: unknown): v is string => typeof v === "string" && [...v].length <= 1000 && !/[\u0000\uD800-\uDFFF]/u.test(v);
export function parseRecovery(raw: string, now = Date.now()): RecoveryEnvelope | null {
  if (new TextEncoder().encode(raw).length > MAX_BYTES) throw Error("oversize recovery");
  const e: unknown = JSON.parse(raw);
  if (record(e) && e.cleared === true) { exact(e, ["schema", "cleared"]); if(e.schema !== 1) throw Error("schema"); return null; }
  exact(e, ["schema", "principal_id", "scope_id", "recovery_context_id", "workspace_id", "created_at_ms", "expires_at_ms", "base", "buffer", "pending"]);
  if (e.schema !== 1 || ![e.principal_id,e.scope_id,e.recovery_context_id,e.workspace_id].every(isUuid) || !integer(e.created_at_ms) || !integer(e.expires_at_ms) || e.expires_at_ms - e.created_at_ms !== RECOVERY_TTL) throw Error("invalid recovery identity or time");
  if (!Number.isFinite(now) || now < e.created_at_ms || now >= e.expires_at_ms) throw Error("expired recovery");
  exact(e.base, ["planning_id", "revision", "revision_id", "resource_key", "element_key"]);
  const b=e.base;
  if (!isUuid(b.planning_id) || !isUuid(b.revision_id) || !integer(b.revision,1,2147483646) || !key(b.resource_key) || !key(b.element_key)) throw Error("invalid recovery base");
  exact(e.buffer,["text", "generation", "draft_id", "draft_revision"]);
  const buffer=e.buffer;
  if (!text(buffer.text) || !integer(buffer.generation) || !isUuid(buffer.draft_id) || !integer(buffer.draft_revision,0,2147483646)) throw Error("invalid recovery buffer");
  if (e.pending !== null) {
    const p=e.pending;
    if (!record(p) || !["edit","copy","draft"].includes(String(p.kind))) throw Error("invalid recovery intent");
    exact(p,["kind","key","planningId","generation","payload", ...(p.kind === "draft" ? ["draftId"]:[])]);
    if (!isUuid(p.key) || p.planningId !== b.planning_id || !integer(p.generation,0,buffer.generation)) throw Error("invalid recovery intent identity");
    exact(p.payload,["contract_version","resource_key","element_key","text", p.kind === "edit" ? "expected_revision":"base_revision", ...(p.kind === "draft" ? ["expected_draft_revision"]:[])]);
    const payload=p.payload;
    if (payload.contract_version !== 1 || payload.resource_key !== b.resource_key || payload.element_key !== b.element_key || !text(payload.text) || !payload.text.trim() || payload[p.kind === "edit" ? "expected_revision":"base_revision"] !== b.revision || (p.generation === buffer.generation && payload.text !== buffer.text) || (p.kind === "draft" && (p.draftId !== buffer.draft_id || payload.expected_draft_revision !== buffer.draft_revision))) throw Error("inconsistent recovery intent");
  }
  return e as unknown as RecoveryEnvelope;
}
export const recoveryUnavailable = "El respaldo de este navegador no está disponible. Mantén esta pestaña abierta hasta confirmar el guardado.";
export const uncertainPurgeNotice = "Si había un guardado sin confirmar, pudo completarse; revisa la biblioteca antes de repetirlo.";
export const cleanupUnavailable = "No pudimos confirmar la limpieza del respaldo. Puede quedar texto en este navegador; si es compartido, borra los datos de este sitio.";
/** One bounded slot. The UUID is a discriminator, never a credential or encryption. */
export class EditorRecovery {
  readonly generations: GenerationRecovery;
  warning = "";
  candidate: RecoveryEnvelope | null = null;
  private identity: RecoveryIdentity | null = null;
  private workspace: string = crypto.randomUUID();
  private episode: {created_at_ms:number; expires_at_ms:number} | null = null;
  private blocked = false;
  private writeFailed = false;
  constructor(private storage: () => BackupStore = () => globalThis.sessionStorage, private clock = () => Date.now()) {
    this.generations = new GenerationRecovery(storage, clock);
  }
  get enabled() { return !!this.identity?.recovery_context_id; }
  purge(uncertain = false) {
    this.candidate = null;
    this.episode = null;
    this.blocked = false;
    this.writeFailed = false;
    try { this.storage().removeItem(RECOVERY_KEY); this.warning = uncertain ? uncertainPurgeNotice : ""; return true; }
    catch {
      // A tombstone stops application recovery, but does not prove physical erasure.
      try { this.storage().setItem(RECOVERY_KEY,tombstone); } catch { /* Observable residual below. */ }
      this.warning = cleanupUnavailable + (uncertain ? ` ${uncertainPurgeNotice}` : "");
      return false;
    }
  }
  expire() {
    const cleared = this.purge();
    this.blocked = true;
    this.warning = "El respaldo ha caducado. Una operación pendiente pudo guardarse; revisa la biblioteca antes de crear otra." +
      (cleared ? "" : ` ${cleanupUnavailable}`);
  }
  admit(identity: RecoveryIdentity, restore = true) {
    this.identity = {principal_id:identity.principal_id,scope_id:identity.scope_id,recovery_context_id:identity.recovery_context_id};
    this.blocked = false;
    this.writeFailed = false;
    if (!identity.recovery_context_id) { this.purge(); return null; }
    if (!restore) return null;
    try {
      const raw=this.storage().getItem(RECOVERY_KEY);
      if (!raw) return null;
      const e=parseRecovery(raw,this.clock());
      if (!e) { this.purge(); return null; }
      if (e.principal_id !== identity.principal_id || e.scope_id !== identity.scope_id || e.recovery_context_id !== identity.recovery_context_id) { this.purge(true); return null; }
      this.workspace=e.workspace_id;
      this.episode={created_at_ms:e.created_at_ms,expires_at_ms:e.expires_at_ms};
      this.candidate=e;
      this.blocked=true; // Never overwrite a candidate whose base has not been authenticated.
      return e;
    } catch (error) {
      if (error instanceof Error && error.message === "expired recovery") {
        this.expire();
        return null;
      }
      this.blocked=true;
      this.warning="No pudimos utilizar el respaldo de este navegador. No se ha reemplazado. Puedes descartarlo y continuar.";
      return null;
    }
  }
  valid(e: RecoveryEnvelope) {
    try { return !!parseRecovery(JSON.stringify(e),this.clock()); } catch { return false; }
  }
  adopted() { this.candidate=null; this.blocked=false; }
  save(editor: EditorState | null) {
    if (!this.identity?.recovery_context_id || this.blocked) return;
    if (!editor || (!editor.pending && (editor.text === editor.baseline || editor.draftSaved))) {
      if (this.episode) this.purge();
      return;
    }
    const now=this.clock();
    this.episode ??= {created_at_ms:now, expires_at_ms:now+RECOVERY_TTL};
    if (now < this.episode.created_at_ms || now >= this.episode.expires_at_ms) {
      this.expire();
      return;
    }
    if (this.writeFailed) return; // No quota retry loop on each keystroke.
    const receipt=editor.document.receipt;
    const e: RecoveryEnvelope={schema:1,...this.identity,recovery_context_id:this.identity.recovery_context_id,workspace_id:this.workspace,...this.episode,
      base:{planning_id:receipt.planning_id,revision:receipt.revision,revision_id:receipt.revision_id,resource_key:editor.resourceKey,element_key:editor.elementKey},
      buffer:{text:editor.text,generation:editor.generation,draft_id:editor.draftId,draft_revision:editor.draftRevision},pending:editor.pending};
    try { const raw=JSON.stringify(e); parseRecovery(raw,now); this.storage().setItem(RECOVERY_KEY,raw); this.warning=""; }
    catch { this.writeFailed=true; this.warning=recoveryUnavailable; }
  }
}

export const GENERATION_RECOVERY_KEY = "acenta:generation-recovery:v1";
interface GenerationEnvelope extends RecoveryIdentity {
  schema: 1;
  recovery_context_id: string;
  workspace_id: string;
  created_at_ms: number;
  expires_at_ms: number;
  pending: CreateIntent & { payload: GeneratedPlanningRequest };
}
function parseGenerationRecovery(raw: string, now: number): GenerationEnvelope | null {
  if (new TextEncoder().encode(raw).length > 8192) throw Error("oversize generation recovery");
  const e: unknown = JSON.parse(raw);
  if (record(e) && e.cleared === true) { exact(e, ["schema", "cleared"]); if (e.schema !== 1) throw Error("schema"); return null; }
  exact(e, ["schema", "principal_id", "scope_id", "recovery_context_id", "workspace_id", "created_at_ms", "expires_at_ms", "pending"]);
  if (e.schema !== 1 || ![e.principal_id,e.scope_id,e.recovery_context_id,e.workspace_id].every(isUuid) ||
    !integer(e.created_at_ms) || !integer(e.expires_at_ms) || e.expires_at_ms - e.created_at_ms !== RECOVERY_TTL) throw Error("invalid generation identity");
  if (!Number.isFinite(now) || now < e.created_at_ms || now >= e.expires_at_ms) throw Error("expired recovery");
  exact(e.pending, ["kind", "key", "payload", "navigation"]);
  if (e.pending.kind !== "create" || !isUuid(e.pending.key) || !integer(e.pending.navigation)) throw Error("invalid generation intent");
  parseGeneratedRequest(e.pending.payload);
  return e as unknown as GenerationEnvelope;
}
/** Independent bounded slot because an editor buffer and generation may coexist. */
class GenerationRecovery {
  warning = "";
  candidate: GenerationEnvelope | null = null;
  private identity: RecoveryIdentity | null = null;
  private envelope: GenerationEnvelope | null = null;
  private blocked = false;
  constructor(private storage: () => BackupStore, private clock: () => number) {}
  purge() {
    this.candidate = null; this.envelope = null; this.blocked = false;
    try { this.storage().removeItem(GENERATION_RECOVERY_KEY); this.warning = ""; return true; }
    catch {
      try { this.storage().setItem(GENERATION_RECOVERY_KEY, tombstone); } catch { /* Do not promise physical deletion. */ }
      this.warning = cleanupUnavailable; return false;
    }
  }
  admit(identity: RecoveryIdentity, restore: boolean) {
    this.identity = { principal_id: identity.principal_id, scope_id: identity.scope_id, recovery_context_id: identity.recovery_context_id };
    this.candidate = null; this.envelope = null; this.blocked = false; this.warning = "";
    if (!identity.recovery_context_id) { this.purge(); return; }
    if (!restore) return;
    try {
      const raw = this.storage().getItem(GENERATION_RECOVERY_KEY);
      if (!raw) return;
      const e = parseGenerationRecovery(raw, this.clock());
      if (!e) { this.purge(); return; }
      if (e.principal_id !== identity.principal_id || e.scope_id !== identity.scope_id || e.recovery_context_id !== identity.recovery_context_id) {
        this.purge(); this.warning = [this.warning, uncertainPurgeNotice].filter(Boolean).join(" "); return;
      }
      this.candidate = this.envelope = e;
    } catch (error) {
      if (error instanceof Error && error.message === "expired recovery") {
        this.purge(); this.warning = ["El respaldo de la generación ha caducado. Revisa la biblioteca antes de crear otra.", this.warning].filter(Boolean).join(" ");
      } else this.warning = "No pudimos utilizar el respaldo de la generación. Se conserva sin reemplazar; no se iniciará otra generación.";
      this.blocked = true;
    }
  }
  take() {
    const e = this.candidate;
    if (!e) return null;
    try { parseGenerationRecovery(JSON.stringify(e), this.clock()); }
    catch { this.purge(); this.blocked = true; this.warning = "El respaldo de la generación ha caducado. Revisa la biblioteca antes de crear otra."; return null; }
    this.candidate = null;
    return e;
  }
  save(pending: CreateIntent | null) {
    if (pending?.payload.contract_version !== 3) {
      if (this.envelope) this.purge();
      return true;
    }
    if (!this.identity?.recovery_context_id || this.blocked) {
      this.warning ||= recoveryUnavailable; return false;
    }
    const now = this.clock();
    const prior = this.envelope;
    const e: GenerationEnvelope = {
      schema: 1, ...this.identity, recovery_context_id: this.identity.recovery_context_id,
      workspace_id: prior?.workspace_id ?? crypto.randomUUID(),
      created_at_ms: prior?.created_at_ms ?? now, expires_at_ms: prior?.expires_at_ms ?? now + RECOVERY_TTL,
      pending: pending as GenerationEnvelope["pending"],
    };
    try {
      const raw = JSON.stringify(e); parseGenerationRecovery(raw, now);
      this.storage().setItem(GENERATION_RECOVERY_KEY, raw); this.envelope = e; this.warning = ""; return true;
    } catch { this.blocked = true; this.warning = recoveryUnavailable; return false; }
  }
}
