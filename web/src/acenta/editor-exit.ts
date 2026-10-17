import type { AcentaController, EditorState } from "./controller";

export function needsEditorGuard(editor: EditorState | null) {
  return !!editor && (
    !!editor.pending || (editor.text !== editor.baseline && !editor.draftSaved)
  );
}

/** Explicit exit intent, separate from the possibly still-running server write. */
export class EditorExitGuard {
  private state = { open: false, busy: false };
  private generation = 0;
  private disposed = false;
  private completed = false;
  private listeners = new Set<() => void>();
  constructor(private controller: AcentaController, private exit: () => void) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private emit(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  request() {
    if (this.disposed || this.completed || this.controller.snapshot().closed) return;
    if (needsEditorGuard(this.controller.snapshot().editor)) this.emit({ open: true });
    else this.finish();
  }
  cancel() {
    this.generation++;
    this.emit({ open: false });
  }
  dispose() {
    this.disposed = true;
    this.cancel();
  }
  private finish() {
    this.completed = true;
    this.exit();
    this.emit({ open: false });
  }
  async preserve() {
    const before = this.controller.snapshot().editor;
    if (
      this.disposed || this.completed || !this.state.open ||
      this.state.busy || !before
    ) return;
    const generation = ++this.generation;
    this.emit({ busy: true });
    try {
      // Existing uncertain work keeps its kind/key. A confirmed draft needs no new revision.
      if (!before.draftSaved || before.pending) await this.controller.preserveDraft();
      const current = this.controller.snapshot();
      // A no-op, cancellation, new editor or newer edit is not permission to leave.
      // draftSaved is set only by the controller's validated, exact draft receipt.
      if (
        generation === this.generation && !this.disposed && !current.closed &&
        current.editor?.generation === before.generation &&
        current.editor.text === before.text &&
        current.editor.draftId === before.draftId &&
        current.editor.document.receipt.planning_id === before.document.receipt.planning_id &&
        current.editor.document.receipt.revision_id === before.document.receipt.revision_id &&
        current.editor.resourceKey === before.resourceKey &&
        current.editor.elementKey === before.elementKey &&
        current.editor.draftSaved && !needsEditorGuard(current.editor)
      ) this.finish();
    } finally {
      this.emit({ busy: false });
    }
  }
}
