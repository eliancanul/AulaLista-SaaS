import { AcentaApi, ApiError, sameJson } from "./api";
import { prefillAnalyticPlanning, type AnalyticSectionDocument, type DeriveAnalyticPlanningRequest } from "./analytic-sections";
import type { PlanningDocument } from "./contracts";

interface DerivationIntent {
  readonly key: string;
  readonly origin: AnalyticSectionDocument;
  readonly data: DeriveAnalyticPlanningRequest;
}
export interface AnalyticDerivationState {
  origin: AnalyticSectionDocument | null;
  data: DeriveAnalyticPlanningRequest;
  status: "idle" | "sending" | "unknown" | "error" | "saved";
  pending: DerivationIntent | null;
  document: PlanningDocument | null;
  error: string;
}
const fresh = (): AnalyticDerivationState => ({
  origin: null, data: { contract_version: 1, subject: "", duration_minutes: 50, method: "active-learning" },
  status: "idle", pending: null, document: null, error: "",
});
function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
export function validateDerivedClass(data: DeriveAnalyticPlanningRequest) {
  const errors: Record<string, string> = {};
  for (const field of ["subject", "method"] as const) {
    const value = data[field], limit = field === "subject" ? 120 : 80;
    if (!value.trim() || [...value].length > limit || /[\u0000\uD800-\uDFFF]/u.test(value))
      errors[field] = field === "subject" ? "Escribe una asignatura válida." : "Selecciona un método válido.";
  }
  if (!Number.isInteger(data.duration_minutes) || data.duration_minutes < 15 || data.duration_minutes > 180)
    errors.duration_minutes = "Elige entre 15 y 180 minutos enteros.";
  return errors;
}

/** The source and operation stay in this tab; no expanded recovery/storage contract. */
export class AnalyticDerivationController {
  private state = fresh();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private busy = false;
  private suspended = false;
  private closed = false;
  constructor(private api: AcentaApi) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private emit(patch: Partial<AnalyticDerivationState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private available() { return !this.closed && !this.suspended; }
  hasUnsavedChanges() { return !!this.state.pending || (!!this.state.origin && this.state.status !== "saved"); }
  choose(origin: AnalyticSectionDocument) {
    if (!this.available() || this.state.pending) return false;
    this.emit({ origin: immutable(structuredClone(origin)), status: "idle", document: null, error: "" });
    return true;
  }
  setData(data: DeriveAnalyticPlanningRequest) {
    if (!this.available() || this.state.pending || !this.state.origin) return false;
    this.emit({ data: structuredClone(data), status: "idle", document: null, error: "" });
    return true;
  }
  cancel() {
    if (!this.available() || this.state.pending) return false;
    this.emit(fresh());
    return true;
  }
  async submit(): Promise<PlanningDocument | null> {
    if (!this.available() || this.busy || !this.state.origin || this.state.status === "saved") return null;
    if (this.state.pending) return this.recover();
    if (Object.keys(validateDerivedClass(this.state.data)).length) {
      this.emit({ status: "error", error: "Revisa los datos de clase. El apartado original no ha cambiado." });
      return null;
    }
    const intent = immutable({ key: crypto.randomUUID(), origin: structuredClone(this.state.origin), data: structuredClone(this.state.data) });
    return this.run(intent, false);
  }
  async recover(): Promise<PlanningDocument | null> {
    return this.available() && !this.busy && this.state.pending ? this.run(this.state.pending, true) : null;
  }
  private async run(intent: DerivationIntent, recover: boolean) {
    const epoch = this.epoch;
    this.busy = true;
    this.emit({ pending: intent, status: "sending", error: "" });
    let replayed = false;
    try {
      if (!this.active(epoch)) return null;
      let document: PlanningDocument;
      if (recover) {
        try { document = await this.api.operation(intent.key); }
        catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
          if (!this.active(epoch)) return null;
          replayed = true;
          document = await this.api.deriveAnalyticPlanning(intent.origin, intent.data, intent.key);
        }
      } else document = await this.api.deriveAnalyticPlanning(intent.origin, intent.data, intent.key);
      if (!this.active(epoch) || this.state.pending?.key !== intent.key) return null;
      const { contract_version: _, ...classData } = intent.data;
      const expected = { ...prefillAnalyticPlanning(intent.origin), ...classData };
      if (document.receipt.operation_id !== intent.key || document.receipt.revision !== 1 ||
        !sameJson(document.analytic_origin, intent.origin) || !sameJson(document.request, expected))
        throw new ApiError(0, "invalid_response");
      this.emit({ document, pending: null, status: "saved" });
      return document;
    } catch (error) {
      if (!this.active(epoch)) return null;
      const certain = error instanceof ApiError && ((!recover && !error.uncertain) ||
        (replayed && (error.status === 409 || (error.status === 422 && error.code === "unsupported_fixture"))));
      const message = error instanceof ApiError && error.code === "unsupported_fixture"
        ? "El ejemplo sólo admite Ciencias naturales, 3.º de primaria, el cuidado del agua en la comunidad, aprendizaje activo y español. Tu preparación se conserva."
        : certain ? "No pudimos crear la clase. Revisa los datos o la disponibilidad del apartado y su referencia; tu preparación se conserva."
          : "No pudimos confirmar la creación. Comprueba su estado antes de cambiar o descartar la preparación.";
      this.emit({ pending: certain ? null : intent, status: certain ? "error" : "unknown", error: message });
      return null;
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private active(epoch: number) { return this.available() && epoch === this.epoch; }
  suspend() {
    this.suspended = true;
    this.epoch++;
    this.busy = false;
    if (this.state.pending) this.emit({ status: "unknown" });
  }
  resume() { if (!this.closed) this.suspended = false; }
  close() { this.closed = true; this.epoch++; this.busy = false; this.emit(fresh()); }
}
