import { AcentaApi, ApiError } from "./api";
import { chatAdmissionRejected, chatErrorMessage, chatTextError, type ChatDocument, type ConversationSummary } from "./chat-contracts";

type Pending = {kind: "create"; key: string; text: string} |
  {kind: "turn"; key: string; text: string; expected: number; id: string};
export interface ChatThread {
  document: ChatDocument | null;
  draft: string;
  pending: Pending | null;
  status: "idle" | "loading" | "sending" | "unknown" | "error";
  error: string;
  needsRefresh: boolean;
}
interface ChatState {
  activeId: string | null;
  threads: Record<string, ChatThread>;
  items: ConversationSummary[];
  cursor: string | null;
  listStatus: "idle" | "loading" | "ready" | "error";
  listError: string;
  availability: "idle" | "loading" | "available" | "unavailable";
}
const emptyThread = (): ChatThread => ({document: null, draft: "", pending: null, status: "idle", error: "", needsRefresh: false});
const fresh = (): ChatState => ({activeId: null, threads: {new: emptyThread()}, items: [], cursor: null, listStatus: "idle", listError: "", availability: "idle"});
const slot = (id: string | null) => id ?? "new";
/** Private text exists only in this session's memory. The server owns confirmed history. */
export class ChatController {
  private state = fresh();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private readGeneration = new Map<string, number>();
  private listGeneration = 0;
  private capabilityGeneration = 0;
  private suspended = false;
  private closed = false;
  constructor(private api: AcentaApi, private created: (id: string) => void = () => {}) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  current() { return this.state.threads[slot(this.state.activeId)] ?? emptyThread(); }
  private emit(patch: Partial<ChatState>) { this.state = {...this.state, ...patch}; for (const listener of this.listeners) listener(); }
  private thread(key: string, patch: Partial<ChatThread>) {
    this.emit({threads: {...this.state.threads, [key]: {...(this.state.threads[key] ?? emptyThread()), ...patch}}});
  }
  private live(epoch = this.epoch) { return !this.closed && !this.suspended && epoch === this.epoch; }
  hasUnsavedChanges() { return Object.values(this.state.threads).some(thread => !!thread.draft || !!thread.pending); }
  hasPending() { return Object.values(this.state.threads).some(thread => !!thread.pending); }
  pendingDrafts() {
    return Object.entries(this.state.threads).filter(([, thread]) => !!thread.draft || !!thread.pending)
      .map(([key, thread]) => ({id: key === "new" ? null : key, title: thread.document?.conversation.title || "Nueva conversación"}));
  }
  discardDrafts() {
    if (!this.live() || this.hasPending()) return false;
    this.emit({threads: Object.fromEntries(Object.entries(this.state.threads).map(([key, thread]) => [key, {...thread, draft: "", error: ""}]))});
    return true;
  }
  newConversation() {
    if (!this.live()) return;
    this.emit({activeId: null});
  }
  setDraft(draft: string) {
    if (!this.live() || this.current().pending) return false;
    if ([...draft].length > 4096 || new TextEncoder().encode(draft).length > 8192 || /[\u0000\uD800-\uDFFF]/u.test(draft)) {
      this.thread(slot(this.state.activeId), {error: chatTextError(draft)});
      return false;
    }
    this.thread(slot(this.state.activeId), {draft, error: ""});
    return true;
  }
  async loadAvailability() {
    if (!this.live()) return;
    const epoch = this.epoch, generation = ++this.capabilityGeneration;
    this.emit({availability: "loading"});
    let available = false;
    try { available = await this.api.chatAvailable(); } catch { /* Fail closed; history remains readable. */ }
    if (this.live(epoch) && generation === this.capabilityGeneration) this.emit({availability: available ? "available" : "unavailable"});
  }
  async list(more = false) {
    if (!this.live() || this.state.listStatus === "loading" || (more && !this.state.cursor)) return;
    const epoch = this.epoch, generation = ++this.listGeneration;
    const cursor = more ? this.state.cursor! : undefined;
    this.emit({listStatus: "loading", listError: ""});
    try {
      const page = await this.api.listConversations(cursor);
      if (this.live(epoch) && generation === this.listGeneration) {
        const entries = new Map((more ? this.state.items : []).map(item => [item.id, item]));
        page.items.forEach(item => entries.set(item.id, item));
        this.emit({items: [...entries.values()], cursor: page.next_cursor, listStatus: "ready"});
      }
    } catch {
      if (this.live(epoch) && generation === this.listGeneration)
        this.emit({listStatus: "error", listError: "No pudimos recuperar tus conversaciones. Vuelve a consultar el listado."});
    }
  }
  async open(id: string) {
    if (!this.live()) return;
    this.emit({activeId: id});
    await this.refresh(id);
  }
  async refresh(id = this.state.activeId) {
    if (!this.live() || !id || this.state.threads[id]?.status === "sending") return;
    const epoch = this.epoch, generation = (this.readGeneration.get(id) ?? 0) + 1;
    this.readGeneration.set(id, generation);
    this.thread(id, {status: "loading", error: ""});
    try {
      const doc = await this.api.readConversation(id);
      if (this.live(epoch) && this.readGeneration.get(id) === generation) this.accept(id, doc);
    } catch {
      if (this.live(epoch) && this.readGeneration.get(id) === generation)
        this.thread(id, {status: "error", error: "No pudimos recuperar la conversación. Tu texto sigue aquí. Actualiza el historial para continuar.", needsRefresh: true});
    }
  }
  private accept(key: string, document: ChatDocument, pending = this.state.threads[key]?.pending ?? null) {
    const current = this.state.threads[key] ?? emptyThread();
    // A GET begun before a newer turn cannot roll confirmed history back.
    if (current.document && current.document.conversation.version > document.conversation.version) return;
    const operation = pending?.kind === "turn" ? pending.key : null;
    const turn = operation ? document.turns.find(turn => turn.operation_id === operation) : null;
    let draft = current.draft, error = "", status: ChatThread["status"] = "idle";
    if (turn?.state === "succeeded") { if (draft === pending?.text) draft = ""; pending = null; }
    else if (turn?.state === "failed") { pending = null; status = "error"; error = "El turno falló de forma definitiva. Conservamos tu texto; puedes editarlo y decidir si envías un nuevo intento."; }
    const unresolved = document.turns.find(turn => turn.state === "generating" || turn.state === "uncertain");
    if (unresolved && (!pending || (pending.kind === "turn" && pending.key === unresolved.operation_id))) {
      pending = {kind: "turn", id: document.conversation.id, key: unresolved.operation_id, text: unresolved.user_text, expected: unresolved.number - 1};
      status = "unknown";
      error = chatErrorMessage(new ApiError(409, unresolved.state === "generating" ? "chat_pending" : "chat_uncertain"));
    } else if (pending) { status = "unknown"; error = "El envío sigue sin confirmar. Consulta su estado antes de enviar otro mensaje."; }
    this.thread(key, {document, draft, pending, status, error, needsRefresh: false});
    this.emit({items: this.state.items.map(item => item.id === document.conversation.id ? document.conversation : item)});
  }
  async submit() {
    if (!this.live()) return;
    const key = slot(this.state.activeId), current = this.current();
    if (current.pending || current.status === "loading" || current.needsRefresh) return;
    const error = chatTextError(current.draft);
    if (error) { this.thread(key, {error, status: "error"}); return; }
    if (this.state.availability !== "available") { this.thread(key, {error: chatErrorMessage(new ApiError(503, "chat_unavailable")), status: "error"}); return; }
    if (this.state.activeId) {
      if (!current.document) return;
      const intent: Pending = {kind: "turn", key: crypto.randomUUID(), text: current.draft, expected: current.document.conversation.version, id: this.state.activeId};
      await this.run(key, intent, false);
    } else {
      await this.run("new", {kind: "create", key: crypto.randomUUID(), text: current.draft}, false);
    }
  }
  async recover() {
    const key = slot(this.state.activeId), current = this.current();
    if (!this.live() || !current.pending || ["sending", "loading"].includes(current.status)) return;
    await this.run(key, current.pending, true);
  }
  private async run(key: string, intent: Pending, recover: boolean) {
    const epoch = this.epoch;
    this.readGeneration.set(key, (this.readGeneration.get(key) ?? 0) + 1);
    this.thread(key, {pending: intent, status: "sending", error: ""});
    try {
      const doc = intent.kind === "create"
        ? await (recover ? this.api.conversationOperation(intent.key) : this.api.createConversation(intent.key))
        : await (recover ? this.api.chatTurnOperation(intent.id, intent.key, intent.text, intent.expected) : this.api.sendChatTurn(intent.id, intent.text, intent.expected, intent.key));
      if (!this.live(epoch) || this.state.threads[key]?.pending !== intent) return;
      if (intent.kind === "create") {
        const id = doc.conversation.id, active = this.state.activeId === null;
        const thread = {...this.state.threads.new, document: doc, pending: null, status: "idle" as const};
        this.emit({threads: {...this.state.threads, new: emptyThread(), [id]: thread}, ...(active ? {activeId: id} : {})});
        this.accept(id, doc, null);
        if (active) this.created(id);
        // Recovery is read-only. The teacher chooses whether to send the retained text.
        if (!recover) await this.run(id, {kind: "turn", id, key: crypto.randomUUID(), text: intent.text, expected: doc.conversation.version}, false);
      } else this.accept(key, doc, intent);
    } catch (error) {
      if (!this.live(epoch) || this.state.threads[key]?.pending !== intent) return;
      const rejected = !recover && chatAdmissionRejected(error);
      this.thread(key, {pending: rejected ? null : intent, status: rejected ? "error" : "unknown", error: chatErrorMessage(error),
        needsRefresh: rejected && error instanceof ApiError && error.code === "conflict"});
    }
  }
  suspend() {
    if (this.closed) return;
    this.suspended = true;
    this.epoch++;
    this.emit({listStatus: this.state.listStatus === "loading" ? "idle" : this.state.listStatus,
      availability: this.state.availability === "loading" ? "idle" : this.state.availability,
      threads: Object.fromEntries(Object.entries(this.state.threads).map(([key, thread]) => [key, {...thread,
        status: thread.pending ? "unknown" : thread.status === "loading" ? "idle" : thread.status}]))});
  }
  resume() { if (!this.closed) this.suspended = false; }
  close() { this.closed = true; this.epoch++; this.readGeneration.clear(); this.emit(fresh()); }
}
