import type { PlanningDocument } from "./contracts";
import type { View, EditorState } from "./controller";

export interface NavigationLocation {
  view: View;
  result: PlanningDocument | null;
  chatId?: string | null;
}
export interface NavigationPosition {
  x: number;
  y: number;
  focus: string | null;
  panelY?: number;
  panelReturn?: { x: number; y: number; focus: string | null };
}
interface NavigationHost {
  snapshot(): NavigationLocation & { closed: boolean; editor?: EditorState | null };
  subscribe(listener: () => void): () => void;
  restoreNavigation(location: NavigationLocation): void;
}
export interface HistoryPort {
  replaceState(data: unknown, title: string): void;
  pushState(data: unknown, title: string): void;
}
interface Entry {
  token: string;
  location: NavigationLocation;
  position: NavigationPosition | null;
}
const locationOf = (state: NavigationLocation): NavigationLocation => ({
  view: state.view,
  result: state.view === "result" ? state.result : null,
  chatId: state.view === "chat" ? state.chatId ?? null : null,
});
const sameLocation = (a: NavigationLocation, b: NavigationLocation) =>
  a.view === b.view &&
  a.chatId === b.chatId &&
  a.result?.receipt.planning_id === b.result?.receipt.planning_id;

/** Documents never enter the URL or browser history: only this tab's opaque marker does. */
export class AcentaNavigation {
  private readonly session = crypto.randomUUID();
  private entries: Entry[];
  private index = 0;
  private restoring = false;
  private pendingCopy: { key: string; planningId: string } | null = null;
  private unsubscribe: () => void;
  constructor(
    private host: NavigationHost,
    private history: HistoryPort,
    private capture: () => NavigationPosition,
    private changed: (position: NavigationPosition | null) => void,
  ) {
    const pending = host.snapshot().editor?.pending;
    this.pendingCopy = pending?.kind === "copy" ? pending : null;
    this.entries = [{ token: crypto.randomUUID(), location: locationOf(host.snapshot()), position: null }];
    history.replaceState(this.marker(), "");
    this.unsubscribe = host.subscribe(() => this.update());
  }
  private marker() {
    return { acentaNavigation: { session: this.session, index: this.index, token: this.entries[this.index].token } };
  }
  private update() {
    const state = this.host.snapshot();
    const copy = this.pendingCopy;
    this.pendingCopy = state.editor?.pending?.kind === "copy" ? state.editor.pending : null;
    if (state.closed) {
      this.entries = [];
      this.history.replaceState(null, "");
      return;
    }
    if (this.restoring || !this.entries.length) return;
    const location = locationOf(state);
    const current = this.entries[this.index];
    const confirmedCopy = location.view === "result" && copy &&
      copy.key === location.result?.receipt.operation_id &&
      copy.planningId === current.location.result?.receipt.planning_id &&
      location.result?.origin?.revision_id === current.location.result?.receipt.revision_id &&
      state.editor?.document.receipt.planning_id === location.result?.receipt.planning_id;
    if (sameLocation(current.location, location) || confirmedCopy) {
      // Revision/copy confirmation continues the open editor, not a navigation gesture.
      current.location = location;
      return;
    }
    current.position = this.capture();
    this.entries.splice(this.index + 1);
    this.entries.push({ token: crypto.randomUUID(), location, position: null });
    this.index++;
    this.history.pushState(this.marker(), "");
    this.changed(null);
  }
  restore(value: unknown) {
    if (!value || typeof value !== "object" || this.host.snapshot().closed)
      return;
    const marker = (value as Record<string, unknown>).acentaNavigation;
    if (!marker || typeof marker !== "object") return;
    const { session, index, token } = marker as Record<string, unknown>;
    if (
      session !== this.session ||
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.entries.length ||
      index === this.index ||
      token !== this.entries[index].token
    )
      return;
    this.entries[this.index].position = this.capture();
    this.index = index;
    const entry = this.entries[index];
    this.restoring = true;
    try {
      this.host.restoreNavigation(entry.location);
    } finally {
      this.restoring = false;
    }
    this.changed(entry.position);
  }
  dispose() {
    this.unsubscribe();
    this.entries = [];
    this.pendingCopy = null;
  }
}
