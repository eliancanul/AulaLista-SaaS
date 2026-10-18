import { AcentaApi, ApiError, sameJson } from "./api";
import type { AnalyticSectionData, AnalyticSectionDocument } from "./analytic-sections";

export const emptyAnalyticSection = (): AnalyticSectionData => ({
  contract_version: 1, name: "", grade: "", period: "", context: null, situation: "",
  entries: [{ content: "", pda: "" }], formative_field: null, articulating_axes: [],
  language: "es", reference: null,
});
export interface AnalyticSectionIntent {
  readonly key: string;
  readonly sectionId: string | null;
  readonly expectedRevision: number;
  readonly data: AnalyticSectionData;
}
export interface AnalyticSectionState {
  data: AnalyticSectionData;
  document: AnalyticSectionDocument | null;
  status: "clean" | "dirty" | "saving" | "saved" | "error" | "unknown" | "conflict";
  pending: AnalyticSectionIntent | null;
  error: string;
  loading: boolean;
}
const fresh = (): AnalyticSectionState => ({
  data: emptyAnalyticSection(), document: null, status: "clean", pending: null, error: "", loading: false,
});
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function message(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 409) return "El apartado cambió en otra operación. Conservamos tus cambios; carga la versión guardada sólo después de descartarlos.";
    if (error.status === 413) return "El apartado supera el límite de tamaño. Reduce el contenido; tus cambios siguen aquí.";
    if (error.status === 422) return "Revisa los campos del apartado. Tus cambios siguen aquí.";
    if (error.status === 404) return "El apartado o su referencia no están disponibles. Tus cambios siguen aquí.";
    if (error.status === 401 || error.status === 403) return "La sesión no está disponible. Vuelve a acceder para consultar lo guardado.";
  }
  return "No pudimos confirmar el guardado. Comprueba su estado antes de continuar.";
}

/** A manual section has its own buffer and operation; it never enters the planning editor. */
export class AnalyticSectionController {
  private state = fresh();
  private listeners = new Set<() => void>();
  private busy = false;
  private epoch = 0;
  private suspended = false;
  private closed = false;
  constructor(private api: AcentaApi) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private emit(patch: Partial<AnalyticSectionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  hasUnsavedChanges() {
    return !!this.state.pending || !sameJson(this.state.data, this.state.document?.data ?? emptyAnalyticSection());
  }
  setData(data: AnalyticSectionData) {
    if (this.closed || this.suspended || this.state.loading || this.state.pending) return false;
    this.emit({ data: structuredClone(data), status: sameJson(data, this.state.document?.data ?? emptyAnalyticSection()) ? "clean" : "dirty", error: "" });
    return true;
  }
  async save(): Promise<boolean> {
    if (this.closed || this.suspended || this.state.loading || this.busy) return false;
    if (this.state.pending) return this.recover();
    if (!this.hasUnsavedChanges()) return this.state.document !== null;
    const base = this.state.document;
    const intent = freeze({ key: crypto.randomUUID(), sectionId: base?.receipt.section_id ?? null,
      expectedRevision: base?.receipt.revision ?? 0, data: structuredClone(this.state.data) });
    return this.run(intent, false);
  }
  private write(intent: AnalyticSectionIntent) {
    return intent.sectionId
      ? this.api.saveAnalyticSection(intent.sectionId, intent.expectedRevision, intent.data, intent.key)
      : this.api.createAnalyticSection(intent.data, intent.key);
  }
  private async run(intent: AnalyticSectionIntent, recover: boolean) {
    const epoch = this.epoch;
    let replayed = false;
    this.busy = true;
    this.emit({ status: "saving", pending: intent, error: "" });
    try {
      if (!this.active(epoch)) return false;
      let document: AnalyticSectionDocument;
      if (recover) {
        try { document = await this.api.analyticSectionOperation(intent.key); }
        catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
          if (!this.active(epoch)) return false;
          replayed = true;
          document = await this.write(intent);
        }
      } else document = await this.write(intent);
      if (!this.active(epoch) || this.state.pending?.key !== intent.key) return false;
      if (document.receipt.operation_id !== intent.key ||
        document.receipt.revision !== intent.expectedRevision + 1 ||
        (intent.sectionId !== null && document.receipt.section_id !== intent.sectionId) ||
        !sameJson(document.data, intent.data)) throw new ApiError(0, "invalid_response");
      this.emit({ document, data: structuredClone(document.data), status: "saved", pending: null });
      return true;
    } catch (error) {
      if (!this.active(epoch)) return false;
      // The server checks an existing operation before CAS and unchanged_text.
      // Preflight/transport failures after a recovery attempt cannot prove absence.
      const certain = error instanceof ApiError && ((!recover && !error.uncertain) ||
        (replayed && (error.status === 409 || (intent.sectionId !== null && error.status === 422 && error.code === "unchanged_text"))));
      this.emit({ status: certain ? error.status === 409 ? "conflict" : "error" : "unknown",
        pending: certain ? null : intent, error: message(error) });
      return false;
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  async recover(): Promise<boolean> {
    return !this.closed && !this.suspended && !this.busy && this.state.pending ? this.run(this.state.pending, true) : false;
  }
  async open(id: string): Promise<boolean> {
    if (this.closed || this.suspended || this.state.loading || this.hasUnsavedChanges()) return false;
    const epoch = this.epoch;
    this.emit({ loading: true, error: "" });
    try {
      if (!this.active(epoch)) return false;
      const document = await this.api.readAnalyticSection(id);
      if (!this.active(epoch)) return false;
      this.emit({ document, data: structuredClone(document.data), status: "clean", loading: false });
      return true;
    } catch (error) {
      if (this.active(epoch)) this.emit({ loading: false, status: "error", error: message(error) });
      return false;
    }
  }
  reset() {
    if (this.closed || this.suspended || this.state.loading || this.hasUnsavedChanges()) return false;
    this.emit(fresh());
    return true;
  }
  /** Explicit discard only; an uncertain operation cannot be dismissed as unsaved. */
  discardChanges() {
    if (this.closed || this.suspended || this.state.loading || this.state.pending) return false;
    this.emit({ data: structuredClone(this.state.document?.data ?? emptyAnalyticSection()), status: "clean", error: "" });
    return true;
  }
  private active(epoch: number) {
    return !this.closed && !this.suspended && epoch === this.epoch;
  }
  suspend() {
    if (this.closed) return;
    this.suspended = true;
    this.epoch++;
    this.busy = false;
    this.emit({ loading: false, ...(this.state.pending ? { status: "unknown" as const } : {}) });
  }
  resume() {
    if (!this.closed) this.suspended = false;
  }
  close() {
    this.closed = true;
    this.epoch++;
    this.busy = false;
    this.emit(fresh());
  }
}
