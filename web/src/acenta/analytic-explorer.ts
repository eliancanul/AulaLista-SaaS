import { AcentaApi, ApiError } from "./api";
import type { AnalyticSectionDocument, AnalyticSectionFilters } from "./analytic-sections";

export interface AnalyticExplorerState {
  open: boolean;
  status: "idle" | "loading" | "ready" | "error";
  filters: AnalyticSectionFilters;
  items: AnalyticSectionDocument[];
  selected: AnalyticSectionDocument | null;
  pageIndex: number;
  nextCursor: string | null;
  error: string;
}
const fresh = (): AnalyticExplorerState => ({
  open: false, status: "idle", filters: {}, items: [], selected: null,
  pageIndex: 0, nextCursor: null, error: "",
});

/** Query state only: selecting a revision does not edit it or create a class. */
export class AnalyticExplorerController {
  private state = fresh();
  private listeners = new Set<() => void>();
  private generation = 0;
  private cursors: (string | undefined)[] = [undefined];
  private suspended = false;
  private disposed = false;
  constructor(private api: AcentaApi) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private emit(patch: Partial<AnalyticExplorerState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private available() { return !this.suspended && !this.disposed; }
  async open() {
    if (!this.available()) return;
    this.cursors = [undefined];
    this.emit({ ...fresh(), open: true });
    await this.load(0, {});
  }
  async search(filters: AnalyticSectionFilters) {
    if (!this.available() || !this.state.open) return;
    this.cursors = [undefined];
    await this.load(0, { ...filters });
  }
  async next() {
    if (!this.available() || !this.state.open || this.state.status !== "ready" || !this.state.nextCursor) return;
    const next = this.state.pageIndex + 1;
    this.cursors = [...this.cursors.slice(0, next), this.state.nextCursor];
    await this.load(next, this.state.filters);
  }
  async previous() {
    if (!this.available() || !this.state.open || this.state.status === "loading" || this.state.pageIndex === 0) return;
    await this.load(this.state.pageIndex - 1, this.state.filters);
  }
  async retry() {
    if (!this.available() || !this.state.open || this.state.status !== "error") return;
    await this.load(this.state.pageIndex, this.state.filters);
  }
  select(id: string) {
    if (!this.available() || !this.state.open || this.state.status !== "ready") return false;
    const selected = this.state.items.find(doc => doc.receipt.section_id === id);
    if (!selected) return false;
    this.emit({ selected });
    return true;
  }
  private async load(pageIndex: number, filters: AnalyticSectionFilters) {
    const generation = ++this.generation;
    // Invalidate selection immediately; a different query cannot apply an old row.
    this.emit({ status: "loading", filters: { ...filters }, pageIndex, items: [], selected: null, nextCursor: null, error: "" });
    try {
      const page = await this.api.listAnalyticSections(this.cursors[pageIndex], 6, filters);
      if (!this.active(generation)) return;
      this.emit({ status: "ready", items: page.items, selected: page.items[0] ?? null, nextCursor: page.next_cursor });
    } catch (error) {
      if (!this.active(generation)) return;
      const message = error instanceof ApiError && [401, 403].includes(error.status)
        ? "La sesión no está disponible. Vuelve a acceder para consultar tus apartados."
        : error instanceof ApiError && error.status === 422
          ? "Revisa la búsqueda y los filtros antes de volver a consultar."
          : "No pudimos consultar los apartados. Puedes reintentar sin cambiar tus datos.";
      this.emit({ status: "error", error: message });
    }
  }
  private active(generation: number) {
    return this.available() && this.state.open && this.generation === generation;
  }
  close() {
    this.generation++;
    this.cursors = [undefined];
    this.emit(fresh());
  }
  suspend() { this.suspended = true; this.close(); }
  resume() { if (!this.disposed) this.suspended = false; }
  dispose() { this.disposed = true; this.close(); this.listeners.clear(); }
}
