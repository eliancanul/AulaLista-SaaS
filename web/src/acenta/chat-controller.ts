import { AcentaApi, ApiError } from "./api";
import { chatAdmissionRejected, chatContextError, chatErrorMessage, chatTextError, type ChatDocument, type ChatContextReceipt, type ConversationSummary } from "./chat-contracts";

type Pending = {kind: "create"; key: string; text: string} |
  {kind: "turn"; key: string; text: string; expected: number; contextRevision: number; id: string} |
  {kind: "context"; key: string; notes: string; expected: number; contextRevision: number; id: string};
export interface ChatThread {
  document: ChatDocument | null;
  draft: string;
  contextDraft: string | null;
  contextNotice: string;
  pending: Pending | null;
  status: "idle" | "loading" | "sending" | "unknown" | "error";
  error: string;
  needsRefresh: boolean;
}
interface ChatState {
  activeId: string | null;
  primaryId: string | null;
  activeLoaded: boolean;
  threads: Record<string, ChatThread>;
  items: ConversationSummary[];
  cursor: string | null;
  listStatus: "idle" | "loading" | "ready" | "error";
  listError: string;
  availability: "idle" | "loading" | "available" | "unavailable";
}
const emptyThread = (): ChatThread => ({document: null, draft: "", contextDraft: null, contextNotice: "", pending: null, status: "idle", error: "", needsRefresh: false});
const fresh = (): ChatState => ({activeId: null, primaryId: null, activeLoaded: false, threads: {new: emptyThread()}, items: [], cursor: null, listStatus: "idle", listError: "", availability: "idle"});
const slot = (id: string | null) => id ?? "new";
const contextDirty = (thread: ChatThread) => thread.contextDraft !== null && thread.contextDraft !== thread.document?.context.notes;
/** Only this session's memory holds drafts. The server owns the single active chat. */
export class ChatController {
  private state = fresh();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private readGeneration = new Map<string, number>();
  private activeGeneration = 0;
  private listGeneration = 0;
  private capabilityGeneration = 0;
  private suspended = false;
  private closed = false;
  constructor(private api: AcentaApi, private created: (id: string) => void = () => {}) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  current() { return this.state.threads[slot(this.state.activeId)] ?? emptyThread(); }
  isArchive() { return this.current().document?.conversation.active === false; }
  private emit(patch: Partial<ChatState>) { this.state = {...this.state, ...patch}; for (const listener of this.listeners) listener(); }
  private thread(key: string, patch: Partial<ChatThread>) {
    this.emit({threads: {...this.state.threads, [key]: {...(this.state.threads[key] ?? emptyThread()), ...patch}}});
  }
  private live(epoch = this.epoch) { return !this.closed && !this.suspended && epoch === this.epoch; }
  hasUnsavedChanges() { return Object.values(this.state.threads).some(thread => !!thread.draft || !!thread.pending || contextDirty(thread)); }
  hasPending() { return Object.values(this.state.threads).some(thread => !!thread.pending); }
  discardDrafts() {
    if (!this.live() || this.hasPending()) return false;
    this.emit({threads: Object.fromEntries(Object.entries(this.state.threads).map(([key, thread]) => [key, {...thread, draft: "", contextDraft: null, error: ""}]))});
    return true;
  }
  async openActive() {
    if (!this.live()) return;
    this.emit({activeId: this.state.primaryId});
    if (this.state.activeLoaded) return;
    const epoch = this.epoch, generation = ++this.activeGeneration;
    this.thread("new", {status: "loading", error: ""});
    try {
      const doc = await this.api.activeConversation();
      if (!this.live(epoch) || generation !== this.activeGeneration) return;
      this.adopt(doc);
      this.emit({activeLoaded: true});
    } catch (error) {
      if (!this.live(epoch) || generation !== this.activeGeneration) return;
      const absent = error instanceof ApiError && error.status === 404;
      this.emit({activeLoaded: absent});
      this.thread("new", {status: absent ? "idle" : "error", error: absent ? "" : "No pudimos recuperar tu chat. Vuelve a consultar antes de enviar."});
    }
  }
  setDraft(draft: string) {
    if (!this.live() || this.isArchive() || this.current().pending) return false;
    if ([...draft].length > 4096 || new TextEncoder().encode(draft).length > 8192 || /[\u0000\uD800-\uDFFF]/u.test(draft)) {
      this.thread(slot(this.state.activeId), {error: chatTextError(draft)});
      return false;
    }
    this.thread(slot(this.state.activeId), {draft, error: ""});
    return true;
  }
  setContextDraft(notes: string) {
    if (!this.live() || this.isArchive() || !this.current().document || this.current().pending) return false;
    // Whitespace is a valid editing intermediate; admission validates completed notes.
    if ([...notes].length > 4096 || new TextEncoder().encode(notes).length > 8192 || /[\u0000\uD800-\uDFFF]/u.test(notes)) {
      this.thread(slot(this.state.activeId), {error: chatContextError(notes)}); return false;
    }
    this.thread(slot(this.state.activeId), {contextDraft: notes, contextNotice: "", error: ""});
    return true;
  }
  discardContextDraft() {
    if (this.live() && !this.current().pending) this.thread(slot(this.state.activeId), {contextDraft: null, error: ""});
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
        this.emit({listStatus: "error", listError: "No pudimos recuperar el archivo. Vuelve a consultar."});
    }
  }
  async open(id: string) {
    if (!this.live()) return;
    this.emit({activeId: id});
    await this.refresh(id);
  }
  async refresh(id = this.state.activeId, earlier = false) {
    if (!this.live() || !id || this.state.threads[id]?.status === "sending") return;
    const cursor = earlier ? this.state.threads[id]?.document?.next_cursor ?? undefined : undefined;
    if (earlier && !cursor) return;
    const epoch = this.epoch, generation = (this.readGeneration.get(id) ?? 0) + 1;
    this.readGeneration.set(id, generation);
    this.thread(id, {status: "loading", error: ""});
    try {
      const doc = await this.api.readConversation(id, cursor);
      if (this.live(epoch) && this.readGeneration.get(id) === generation) this.accept(id, doc, earlier ? "earlier" : "latest");
    } catch {
      if (this.live(epoch) && this.readGeneration.get(id) === generation)
        this.thread(id, {status: "error", error: "No pudimos recuperar el historial. Tu texto sigue aquí. Actualiza para continuar.", needsRefresh: true});
    }
  }
  private adopt(document: ChatDocument) {
    const id = document.conversation.id, selected = this.state.activeId === null;
    // Loading/opening the singleton transfers the draft, never to an archived chat.
    const retained = this.state.threads.new;
    this.emit({primaryId: id, ...(selected ? {activeId: id} : {}), threads: {...this.state.threads,
      new: emptyThread(), [id]: this.state.threads[id] ?? {...retained, pending: null}}});
    this.accept(id, document, "latest", null);
  }
  private accept(key: string, incoming: ChatDocument, _source: "latest" | "earlier" | "receipt", pending = this.state.threads[key]?.pending ?? null) {
    const current = this.state.threads[key] ?? emptyThread(), old = current.document;
    const turns = new Map((old?.turns ?? []).map(turn => [turn.number, turn]));
    for (const turn of incoming.turns) {
      const previous = turns.get(turn.number);
      if (previous && previous.operation_id !== turn.operation_id) throw new ApiError(0, "invalid_response");
      // Terminal state cannot regress when an older GET arrives after confirmation.
      if (!previous || previous.state === "generating" || previous.state === turn.state) turns.set(turn.number, {
        ...turn, usage: {
          input_tokens: previous?.usage.input_tokens ?? turn.usage.input_tokens,
          output_tokens: previous?.usage.output_tokens ?? turn.usage.output_tokens,
          estimated_cost_usd: previous?.usage.estimated_cost_usd ?? turn.usage.estimated_cost_usd,
          reserved_usd: previous?.usage.reserved_usd ?? turn.usage.reserved_usd,
        },
      });
    }
    const newerHeader = !old || incoming.conversation.version >= old.conversation.version && incoming.conversation.context_revision >= old.conversation.context_revision;
    const context = !old || incoming.context.revision >= old.context.revision ? incoming.context : old.context;
    const ordered = [...turns.values()].sort((a, b) => a.number - b.number);
    // The cursor tracks the latest contiguous range. A refresh/receipt can jump
    // over unloaded turns; retaining the oldest cursor would hide that gap.
    let earliest = ordered.at(-1)?.number ?? 0;
    for (let index = ordered.length - 2; index >= 0 && ordered[index].number === earliest - 1; index--) earliest--;
    const document: ChatDocument = {conversation: newerHeader ? incoming.conversation : old!.conversation,
      context, turns: ordered, next_cursor: earliest > 1 ? String(earliest) : null};
    const operation = pending?.kind === "turn" ? pending.key : null;
    const turn = operation ? document.turns.find(turn => turn.operation_id === operation) : null;
    let draft = current.draft, error = "", status: ChatThread["status"] = "idle";
    if (turn?.state === "succeeded") { if (pending?.kind === "turn" && draft === pending.text) draft = ""; pending = null; }
    else if (turn?.state === "failed") { pending = null; status = "error"; error = "El turno falló de forma definitiva. Conservamos tu texto; puedes editarlo y decidir si envías un nuevo intento."; }
    const unresolved = document.conversation.active && document.turns.find(turn => turn.state === "generating" || turn.state === "uncertain");
    if (unresolved && (!pending || (pending.kind === "turn" && pending.key === unresolved.operation_id))) {
      pending = {kind: "turn", id: document.conversation.id, key: unresolved.operation_id, text: unresolved.user_text, expected: unresolved.number - 1, contextRevision: unresolved.context_revision};
      status = "unknown";
      error = chatErrorMessage(new ApiError(409, unresolved.state === "generating" ? "chat_pending" : "chat_uncertain"));
    } else if (pending) { status = "unknown"; error = "La operación sigue sin confirmar. Consulta su estado antes de continuar."; }
    this.thread(key, {document, draft, pending, status, error, needsRefresh: document.context.revision !== document.conversation.context_revision || (document.turns.at(-1)?.number ?? 0) < document.conversation.version});
    this.emit({...(document.conversation.active ? {primaryId: key, activeLoaded: true} : {}),
      items: this.state.items.map(item => item.id === document.conversation.id ? document.conversation : item)});
  }
  async submit() {
    if (!this.live() || this.isArchive() || !this.state.activeLoaded) return;
    const key = slot(this.state.activeId), current = this.current();
    if (current.pending || current.status === "loading" || current.needsRefresh) return;
    const error = chatTextError(current.draft);
    if (error) { this.thread(key, {error, status: "error"}); return; }
    if (this.state.availability !== "available") { this.thread(key, {error: chatErrorMessage(new ApiError(503, "chat_unavailable")), status: "error"}); return; }
    if (this.state.activeId) {
      if (!current.document) return;
      await this.run(key, {kind: "turn", key: crypto.randomUUID(), text: current.draft, expected: current.document.conversation.version, contextRevision: current.document.context.revision, id: this.state.activeId}, false);
    } else await this.run("new", {kind: "create", key: crypto.randomUUID(), text: current.draft}, false);
  }
  async updateContext(reset = false) {
    if (!this.live() || this.isArchive()) return;
    const current = this.current(), doc = current.document;
    if (!doc || current.pending || current.status === "loading" || current.needsRefresh) return;
    const notes = reset ? "" : current.contextDraft;
    if (notes === null || chatContextError(notes)) return;
    await this.run(doc.conversation.id, {kind: "context", key: crypto.randomUUID(), id: doc.conversation.id,
      notes, expected: doc.conversation.version, contextRevision: doc.context.revision}, false);
  }
  async recover() {
    const key = slot(this.state.activeId), current = this.current();
    if (!this.live() || !current.pending || ["sending", "loading"].includes(current.status)) return;
    await this.run(key, current.pending, true);
  }
  private acceptContext(key: string, receipt: ChatContextReceipt, intent: Extract<Pending, {kind: "context"}>) {
    const current = this.state.threads[key], old = current.document!;
    const context = receipt.context.revision >= old.context.revision ? receipt.context : old.context;
    const conversation = receipt.conversation.version >= old.conversation.version && receipt.conversation.context_revision >= old.conversation.context_revision ? receipt.conversation : old.conversation;
    this.thread(key, {document: {...old, conversation, context}, pending: null, status: "idle", error: "",
      contextDraft: current.contextDraft === intent.notes ? null : current.contextDraft,
      contextNotice: `Contexto guardado: revisión ${receipt.context.revision}. El historial y los recursos se conservan.`,
      needsRefresh: conversation.context_revision !== context.revision || (old.turns.at(-1)?.number ?? 0) < conversation.version});
  }
  private async run(key: string, intent: Pending, recover: boolean) {
    const epoch = this.epoch;
    this.readGeneration.set(key, (this.readGeneration.get(key) ?? 0) + 1);
    this.thread(key, {pending: intent, status: "sending", error: "", contextNotice: ""});
    try {
      if (intent.kind === "context") {
        const receipt = await (recover ? this.api.chatContextOperation(intent.id, intent.notes, intent.expected, intent.contextRevision, intent.key) : this.api.updateChatContext(intent.id, intent.notes, intent.expected, intent.contextRevision, intent.key));
        if (this.live(epoch) && this.state.threads[key]?.pending === intent) this.acceptContext(key, receipt, intent);
        return;
      }
      const doc = intent.kind === "create"
        ? await (recover ? this.api.conversationOperation(intent.key) : this.api.createConversation(intent.key))
        : await (recover ? this.api.chatTurnOperation(intent.id, intent.key, intent.text, intent.expected, intent.contextRevision) : this.api.sendChatTurn(intent.id, intent.text, intent.expected, intent.key, intent.contextRevision));
      if (!this.live(epoch) || this.state.threads[key]?.pending !== intent) return;
      if (intent.kind === "create") {
        const selected = this.state.activeId === null;
        this.adopt(doc);
        this.emit({activeLoaded: true});
        if (selected) this.created(doc.conversation.id);
        // A recovered creation never automatically sends or spends on the retained draft.
        if (!recover && !this.state.threads[doc.conversation.id].pending)
          await this.run(doc.conversation.id, {kind: "turn", id: doc.conversation.id, key: crypto.randomUUID(), text: intent.text, expected: doc.conversation.version, contextRevision: doc.context.revision}, false);
      } else this.accept(key, doc, "receipt", intent);
    } catch (error) {
      if (!this.live(epoch) || this.state.threads[key]?.pending !== intent) return;
      const rejected = !recover && chatAdmissionRejected(error);
      const message = intent.kind === "context"
        ? rejected ? "No se aplicó el cambio de contexto. Conservamos tus textos. Actualiza el historial y revisa la versión antes de volver a guardar." : "El cambio de contexto sigue sin confirmar. Conservamos tus textos; consulta su estado sin reenviarlo."
        : chatErrorMessage(error);
      this.thread(key, {pending: rejected ? null : intent, status: rejected ? "error" : "unknown", error: message,
        needsRefresh: rejected && error instanceof ApiError && ["conflict", "chat_archived", "chat_busy"].includes(error.code)});
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
