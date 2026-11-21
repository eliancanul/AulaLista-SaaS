import { EditorRecovery } from "./editor-recovery";
import {
  AcentaApi,
  ApiError,
  errorMessage,
  parsePlanning,
  parseDraft,
  parseSource,
  isUuid,
  sameJson,
} from "./api";
import {
  waterPrompt,
  waterSource,
  sourceSamples,
  type SourceReference,
  type OriginalContent,
  type PlanningDocument,
  type CreationRequest,
  type GuidedPlanningRequest,
  type GeneratedPlanningRequest,
  type ManualPlanningRequest,
  type SourceReceipt,
  type EditRequest,
  type CopyRequest,
  type DraftRequest,
  type DraftDocument,
  type Resource,
} from "./contracts";
import { emptyGuidedRequest, guidedResources, isGuided, validateGuidedRequest } from "./guided-planning";
import { AnalyticSectionController } from "./analytic-controller";
import { AnalyticExplorerController } from "./analytic-explorer";
import { AnalyticDerivationController } from "./analytic-derivation";
import type { AnalyticSectionDocument } from "./analytic-sections";
import { ChatController } from "./chat-controller";
import { SchoolContextStore } from "./school-context";

export type SaveState =
  | "clean"
  | "dirty"
  | "saving"
  | "saved"
  | "error"
  | "unknown"
  | "conflict";
export type PanelView = "resources" | "tools" | "support" | "chat-context";
export type View = "home" | "chat" | "conversations" | "example" | "result" | "planning" | "analytic" | "annexes" | "printer" | PanelView;
export const isPanelView = (view: View): view is PanelView => ["resources", "tools", "support", "chat-context"].includes(view);
export type CreateIntent = {
  kind: "create";
  key: string;
  payload: CreationRequest;
  navigation: number;
};
type EditIntent = {
  kind: "edit" | "copy";
  key: string;
  planningId: string;
  payload: EditRequest | CopyRequest;
  generation: number;
};
type DraftIntent = {
  kind: "draft";
  key: string;
  planningId: string;
  draftId: string;
  payload: DraftRequest;
  generation: number;
};
export type EditorIntent = EditIntent | DraftIntent;
function rejectedReplay(
  error: unknown,
  kind: "source" | "create" | EditorIntent["kind"],
) {
  if (!(error instanceof ApiError)) return false;
  // These business errors occur after the backend serializes the key and checks replay.
  return (
    error.status === 409 ||
    (error.status === 422 &&
      ((kind === "create" && error.code === "unsupported_fixture") ||
        (["edit", "copy", "draft"].includes(kind) &&
          error.code === "unsupported_target") ||
        (kind === "edit" && error.code === "unchanged_text")))
  );
}
export interface EditorState {
  document: PlanningDocument;
  resourceKey: string;
  elementKey: string;
  text: string;
  baseline: string;
  generation: number;
  save: SaveState;
  latest: PlanningDocument | null;
  draftId: string;
  draftRevision: number;
  error: string;
  pending: EditorIntent | null;
  draftSaved: boolean;
}
export interface OriginalState {
  reference: SourceReference;
  status: "loading" | "ready" | "unavailable" | "error" | "viewer-error";
  content?: OriginalContent;
}
export interface State {
  original: OriginalState | null;
  sourceName: string;
  view: View;
  chatId: string | null;
  prompt: string;
  guided: GuidedPlanningRequest;
  generationAvailable: boolean;
  source: SourceReceipt | null;
  attaching: boolean;
  sourcePending: boolean;
  submit: "idle" | "sending" | "unknown" | "error";
  error: string;
  result: PlanningDocument | null;
  editor: EditorState | null;
  items: PlanningDocument[];
  drafts: DraftDocument[];
  sources: SourceReceipt[];
  listState: "idle" | "loading" | "ready" | "error";
  cursor: string | null;
  draftCursor: string | null;
  sourceCursor: string | null;
  pending: CreateIntent | null;
  backupError: boolean;
  recoveryWarning: string;
  generationRecoveryWarning: string;
  recoveryEnabled: boolean;
  recoveryAvailable: boolean;
  closed: boolean;
}
export interface BackupStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const fresh = (): State => ({
  original: null,
  sourceName: "Planeación de ciencias · ejemplo",
  view: "home",
  chatId: null,
  prompt: "",
  guided: emptyGuidedRequest(),
  generationAvailable: false,
  source: null,
  attaching: false,
  sourcePending: false,
  submit: "idle",
  error: "",
  result: null,
  editor: null,
  items: [],
  drafts: [],
  sources: [],
  listState: "idle",
  cursor: null,
  draftCursor: null,
  sourceCursor: null,
  pending: null,
  backupError: false,
  recoveryWarning: "",
  generationRecoveryWarning: "",
  recoveryEnabled: false,
  recoveryAvailable: false,
  closed: false,
});
export function editableResource(
  doc: PlanningDocument,
  key?: string,
): Resource | undefined {
  return guidedResources(doc.result).find(
    (r) => (!key || r.key === key) && r.elements.some((e) => e.editable),
  );
}
export class AcentaController {
  readonly chat: ChatController;
  readonly schools: SchoolContextStore;
  readonly analytic: AnalyticSectionController;
  readonly analyticExplorer: AnalyticExplorerController;
  readonly analyticDerivation: AnalyticDerivationController;
  state: State = fresh();
  private listeners = new Set<() => void>();
  private navigation = 0;
  private listGeneration = 0;
  private resourceRead: { generation: number; derived: PlanningDocument[] } | null = null;
  private listLoaded = false;
  private busy = false;
  private originalGeneration = 0;
  private availabilityGeneration = 0;
  private selections: Record<string, SourceReceipt> = {};
  private sourceIntent: {
    base?: SourceReceipt;
    key: string;
    bytes: string;
    cancelled?: boolean;
  } | null = null;
  private readonly backupKey: string;
  private epoch = 0;
  private suspended = false;
  private restoring = false;
  constructor(
    readonly api: AcentaApi,
    private storage: BackupStore | null = null,
    workspaceId: string = crypto.randomUUID(),
    private recovery: EditorRecovery | null = null,
  ) {
    if (!isUuid(workspaceId)) throw Error("Invalid workspace identity");
    this.chat = new ChatController(api, id => {
      if (this.state.view === "home" || this.state.view === "chat") this.emit({view: "chat", chatId: id});
    });
    this.schools = new SchoolContextStore();
    this.analytic = new AnalyticSectionController(api);
    this.analyticExplorer = new AnalyticExplorerController(api);
    this.analyticDerivation = new AnalyticDerivationController(api);
    this.backupKey = `acenta:work:v1:${api.session.actorId}:${api.session.scopeId}:${workspaceId}`;
    this.restore();
    this.state = {...this.state, ...this.recoveryWarnings(), recoveryEnabled:!!this.recovery?.enabled, recoveryAvailable:!!this.recovery?.candidate};
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.state;
  private recoveryWarnings() {
    return { recoveryWarning: this.recovery?.warning ?? "", generationRecoveryWarning: this.recovery?.generations.warning ?? "" };
  }
  private emit(patch: Partial<State> = {}) {
    const previous = this.state.editor;
    const previousPending = this.state.pending;
    this.state = { ...this.state, ...patch };
    this.persist();
    if (previous !== this.state.editor && !this.restoring && !this.suspended && !this.state.closed) this.recovery?.save(this.state.editor);
    if (previousPending !== this.state.pending && !this.suspended && !this.state.closed) this.recovery?.generations.save(this.state.pending);
    this.state = {...this.state, ...this.recoveryWarnings(), recoveryAvailable: !!this.recovery?.candidate};
    for (const fn of this.listeners) fn();
  }
  private persist() {
    if (!this.storage || this.state.closed) return;
    try {
      this.storage.setItem(
        this.backupKey,
        JSON.stringify({
          schema: 1,
          scope: this.api.session.scopeId,
          actor: this.api.session.actorId,
          navigation: this.navigation,
          view: this.state.view,
          prompt: this.state.prompt,
          guided: this.state.guided,
          source: this.state.source,
          result: this.state.result,
          editor: this.state.editor,
          pending: this.state.pending,
          sourceIntent: this.sourceIntent,
          selections: this.selections,
          sourceName: this.state.sourceName,
        }),
      );
      this.state = { ...this.state, backupError: false };
    } catch {
      this.state = { ...this.state, backupError: true };
    }
  }
  private restore() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.backupKey);
      if (!raw) return;
      if (raw.length > 200000) throw Error("oversize");
      const s = JSON.parse(raw);
      if (
        s.schema !== 1 ||
        s.scope !== this.api.session.scopeId ||
        s.actor !== this.api.session.actorId
      )
        throw Error("scope");
      const result = s.result ? parsePlanning(s.result) : null;
      const source = s.source ? parseSource(s.source) : null;
      if (
        source &&
        (source.scope_id !== s.scope || source.actor_id !== s.actor)
      )
        throw Error("source scope");
      const validStatement = (q: any) =>
        q &&
        q.contract_version === 1 &&
        typeof q.text === "string" &&
        q.text.length <= 4000 &&
        typeof q.resource_key === "string" &&
        typeof q.element_key === "string";
      const validIntent = (i: any) =>
        i &&
        isUuid(i.key) &&
        isUuid(i.planningId) &&
        Number.isInteger(i.generation) &&
        validStatement(i.payload) &&
        (i.kind === "edit"
          ? Number.isInteger(i.payload.expected_revision) &&
            i.payload.expected_revision >= 1
          : (i.kind === "copy" || i.kind === "draft") &&
            Number.isInteger(i.payload.base_revision) &&
            i.payload.base_revision >= 1 &&
            (i.kind !== "draft" ||
              (isUuid(i.draftId) &&
                Number.isInteger(i.payload.expected_draft_revision) &&
                i.payload.expected_draft_revision >= 0)));
      if (s.pending) {
        const q = s.pending.payload;
        if (s.pending.kind !== "create" || !isUuid(s.pending.key) || !Number.isInteger(s.pending.navigation) ||
          !(q?.contract_version === 2 || q?.contract_version === 3 ? this.validGuidedBackup(q) :
            q?.contract_version === 1 && q.fixture_context === "water-observation-v1" &&
            typeof q.prompt === "string" && isUuid(q.source_id) && Number.isInteger(q.expected_source_version)))
          throw Error("create intent");
      }
      if (s.guided !== undefined && !this.validGuidedBackup(s.guided, true)) throw Error("guided form");
      if (
        s.sourceIntent &&
        (!isUuid(s.sourceIntent.key) ||
          !sourceSamples.some(
            (sample) => sample.bytes === s.sourceIntent.bytes,
          ) ||
          (s.sourceIntent.cancelled !== undefined &&
            typeof s.sourceIntent.cancelled !== "boolean"))
      )
        throw Error("source intent");
      const editor = s.editor;
      if (editor) {
        const doc = parsePlanning(editor.document);
        if (
          doc.receipt.scope_id !== s.scope ||
          doc.receipt.actor_id !== s.actor ||
          typeof editor.text !== "string" ||
          editor.text.length > 16000 ||
          typeof editor.baseline !== "string" ||
          !Number.isInteger(editor.generation) ||
          !isUuid(editor.draftId) ||
          !Number.isInteger(editor.draftRevision) ||
          editor.draftRevision < 0 ||
          typeof editor.draftSaved !== "boolean" ||
          (editor.draftSaved && editor.draftRevision < 1) ||
          !editableResource(doc, editor.resourceKey)?.elements.some(
            (x) =>
              x.key === editor.elementKey &&
              x.editable &&
              x.text === editor.baseline,
          ) ||
          (editor.pending &&
            (!validIntent(editor.pending) ||
              editor.pending.planningId !== doc.receipt.planning_id))
        )
          throw Error("editor");
        editor.save = editor.pending
          ? "unknown"
          : editor.text === editor.baseline
            ? "clean"
            : "dirty";
      }
      if (
        result &&
        (result.receipt.scope_id !== s.scope ||
          result.receipt.actor_id !== s.actor)
      )
        throw Error("scope");
      for (const [id, receipt] of Object.entries(s.selections ?? {})) {
        if (!sourceSamples.some((sample) => sample.id === id))
          throw Error("sample");
        const saved = parseSource(receipt);
        if (saved.scope_id !== s.scope || saved.actor_id !== s.actor)
          throw Error("sample scope");
        this.selections[id] = saved;
      }
      if (s.sourceIntent?.base) {
        const base = parseSource(s.sourceIntent.base);
        if (base.scope_id !== s.scope || base.actor_id !== s.actor)
          throw Error("base scope");
      }
      this.sourceIntent = s.sourceIntent ?? null;
      this.navigation =
        Number.isInteger(s.navigation) && s.navigation >= 0
          ? s.navigation
          : s.pending
            ? s.pending.navigation +
              (s.pending.payload.contract_version === 1 && s.prompt !== s.pending.payload.prompt ? 1 : 0)
            : 0;
      this.state = {
        ...fresh(),
        prompt: typeof s.prompt === "string" ? s.prompt : "",
        guided: s.guided ?? emptyGuidedRequest(),
        source,
        sourceName:
          sourceSamples.find((sample) => sample.name === s.sourceName)?.name ??
          "Planeación de ciencias · ejemplo",
        sourcePending: !!this.sourceIntent,
        result,
        editor: editor ?? null,
        pending: s.pending ?? null,
        submit: s.pending ? "unknown" : "idle",
        view: ["home", "example", "resources", "planning"].includes(s.view)
          ? s.view
          : editor || result
            ? "result"
            : "home",
      };
    } catch {
      this.state = {
        ...fresh(),
        backupError: true,
        error:
          "No pudimos leer el respaldo local. No se han reemplazado los datos existentes.",
      };
      this.storage = null;
    }
  }
  private validGuidedBackup(value: unknown, allowEmpty = false): value is ManualPlanningRequest {
    if (!value || typeof value !== "object") return false;
    const q = value as ManualPlanningRequest;
    if (!(q.contract_version === 2 ? q.fixture_context === "guided-water-v1" :
      !allowEmpty && q.contract_version === 3 && !Object.hasOwn(q, "fixture_context")) ||
      ![q.subject, q.grade, q.topic, q.method, q.language].every(v => typeof v === "string") ||
      !Array.isArray(q.learning_objectives) || !q.learning_objectives.every(v => typeof v === "string") ||
      !Array.isArray(q.articulating_axes) || !q.articulating_axes.every(v => typeof v === "string") ||
      !(q.formative_field === null || typeof q.formative_field === "string") ||
      !(q.context === null || (typeof q.context?.text === "string" && typeof q.context?.hypothetical === "boolean")) ||
      !(q.reference === null || (isUuid(q.reference?.source_id) && Number.isInteger(q.reference?.source_version) && q.reference.source_version > 0))) return false;
    return allowEmpty || !Object.keys(validateGuidedRequest(q)).length;
  }
  setGuided(value: GuidedPlanningRequest) {
    if (this.state.closed || this.suspended) return;
    this.navigation++;
    this.emit({guided: value, error: ""});
  }
  async loadGenerationAvailability() {
    if (this.state.closed || this.suspended) return;
    const epoch = this.epoch, generation = ++this.availabilityGeneration;
    this.emit({generationAvailable: false});
    let available = false;
    try { available = await this.api.generationAvailable(); } catch { /* Unavailable or malformed capability stays closed. */ }
    if (epoch === this.epoch && generation === this.availabilityGeneration && !this.state.closed && !this.suspended)
      this.emit({generationAvailable: available});
  }
  async submitGuided(mode: "example" | "ai") {
    if (this.state.closed || this.suspended || this.busy) return;
    if (this.state.pending) return this.recoverCreate();
    if (mode === "ai" && !this.state.generationAvailable) {
      this.emit({error: "La generación con IA no está disponible. No se inició un intento. Tus datos siguen aquí."});
      return;
    }
    if (Object.keys(validateGuidedRequest(this.state.guided)).length) {
      this.emit({error: "Revisa los campos marcados antes de crear la planeación."});
      return;
    }
    const { fixture_context: _fixture, ...manual } = this.state.guided;
    const payload: GuidedPlanningRequest | GeneratedPlanningRequest = mode === "ai"
      ? {...manual, contract_version: 3} : this.state.guided;
    const intent: CreateIntent = {kind: "create", key: crypto.randomUUID(), navigation: this.navigation,
      payload: structuredClone(payload)};
    if (payload.contract_version === 3 && this.recovery && !this.recovery.generations.save(intent)) {
      this.emit({error: "No se inició la generación porque no pudimos conservar su operación para recuperarla. " + this.recovery.generations.warning});
      return;
    }
    this.emit({pending: intent, submit: "sending", error: ""});
    await this.runCreate(intent, false);
  }
  /** Suspend callback admission without deleting the in-memory buffer or its pending key. */
  suspend() {
    this.chat.suspend();
    this.analytic.suspend();
    this.analyticExplorer.suspend();
    this.analyticDerivation.suspend();
    this.resourceRead = null;
    this.suspended = true;
    this.epoch++;
    this.navigation++;
    this.listGeneration++;
    this.originalGeneration++;
    this.busy = false;
    this.restoring = false;
    if (this.state.attaching || this.state.listState === "loading" || this.state.submit === "sending" || this.state.editor?.save === "saving") this.state = {...this.state, attaching:false,
      listState:this.state.listState === "loading" ? "idle" : this.state.listState,
      submit:this.state.pending ? "unknown" : this.state.submit,
      editor:this.state.editor?.pending ? {...this.state.editor,save:"unknown"} : this.state.editor};
  }
  resume() { this.suspended = false; this.chat.resume(); this.analytic.resume(); this.analyticExplorer.resume(); this.analyticDerivation.resume(); }
  useAnalyticSection(section: AnalyticSectionDocument) {
    if (this.state.closed || this.suspended || this.state.pending || !this.analyticDerivation.choose(section)) return false;
    this.analyticExplorer.close();
    this.navigate("planning");
    return true;
  }
  async submitDerived(recover = false, openResult = true) {
    if (this.state.closed || this.suspended) return false;
    const navigation = this.navigation;
    const document = await (recover ? this.analyticDerivation.recover() : this.analyticDerivation.submit());
    if (!document || this.state.closed || this.suspended) return false;
    // Preserve this confirmation if a catalog snapshot started before the commit.
    if (this.resourceRead?.generation === this.listGeneration) this.resourceRead.derived.push(document);
    this.emit({ items: this.upsert(document),
      ...(openResult && this.navigation === navigation ? { result: document, view: "result" as const } : {}) });
    return true;
  }
  async restoreGenerationRecovery() {
    if (this.state.closed || this.suspended) return;
    const envelope = this.recovery?.generations.take();
    if (!envelope) return;
    this.navigation = envelope.pending.navigation;
    this.emit({ pending: envelope.pending, guided: {...envelope.pending.payload, contract_version: 2, fixture_context: "guided-water-v1"},
      view: "planning", submit: "unknown", error: "Consultando el estado de la generación pendiente." });
    await this.recoverCreate();
  }
  discardRecovery() {
    this.restoring = false;
    this.recovery?.purge();
    this.emit();
  }
  async restoreRecovery() {
    const envelope = this.recovery?.candidate;
    if (!envelope || this.restoring || this.state.closed || this.suspended) return;
    const epoch=this.epoch;
    this.restoring=true;
    try {
      const base=await this.api.read(envelope.base.planning_id,envelope.base.revision);
      const latest=await this.api.read(envelope.base.planning_id);
      let draft: DraftDocument | null=null;
      // A durable intent might be absent after a write failure. A residue is not proof
      // of unsaved work: reconcile current draft too, never invent a lost operation key.
      if (!envelope.pending) {
        try { draft=await this.api.readDraft(envelope.buffer.draft_id); }
        catch(error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; }
      }
      if (this.state.closed || epoch !== this.epoch || this.suspended || this.recovery?.candidate !== envelope) return;
      if (!this.recovery!.valid(envelope)) {
        this.recovery!.expire();
        this.emit();
        return;
      }
      const element=editableResource(base,envelope.base.resource_key)?.elements.find(e=>e.key===envelope.base.element_key && e.editable);
      if (!element || base.receipt.revision_id !== envelope.base.revision_id || (draft && (draft.receipt.planning_id !== envelope.base.planning_id))) throw new ApiError(0,"invalid_response");
      const changed=latest.receipt.revision_id !== base.receipt.revision_id || (!!draft && (draft.receipt.draft_revision !== envelope.buffer.draft_revision || draft.receipt.base_revision_id !== envelope.base.revision_id || draft.request.resource_key !== envelope.base.resource_key || draft.request.element_key !== envelope.base.element_key));
      this.recovery!.adopted();
      if (this.state.pending) this.navigation++; // A restored editor supersedes the generation's original view.
      this.emit({view:"result",result:base,editor:{document:base,resourceKey:envelope.base.resource_key,elementKey:envelope.base.element_key,
        text:envelope.buffer.text,baseline:element.text,generation:envelope.buffer.generation,
        draftId:envelope.buffer.draft_id,draftRevision:envelope.buffer.draft_revision,
        pending:envelope.pending,save:envelope.pending ? "unknown":changed ? "conflict":"dirty",latest:changed?latest:null,draftSaved:false,
        error:envelope.pending ? "Hay un guardado sin confirmar. Comprueba su estado antes de continuar." : changed ? "El estado guardado cambió. El respaldo puede ser un residuo de una operación completada; revisa la biblioteca antes de guardar como una acción nueva." : "Recuperamos el texto de esta pestaña; aún no confirma un guardado."},error:""});
    } catch(error) {
      if (!this.state.closed && epoch===this.epoch && !this.suspended && this.recovery?.candidate === envelope) this.emit({error: "No pudimos recuperar la edición. El respaldo no se ha enviado ni reemplazado. Comprueba tu sesión y vuelve a intentarlo."});
    } finally { if(epoch===this.epoch) this.restoring=false; }
  }
  async init() {
    if (this.state.view === "resources") void this.loadResources();
    const e = this.state.editor;
    if (!e) return;
    try {
      const latest = await this.api.read(e.document.receipt.planning_id);
      if (this.state.closed || this.state.editor !== e) return;
      if (latest.receipt.revision !== e.document.receipt.revision)
        this.emit({
          editor: {
            ...e,
            latest,
            save: e.pending ? "unknown" : "conflict",
            error: e.pending
              ? "Hay un guardado sin confirmar. Comprueba su estado antes de continuar."
              : "La revisión guardada cambió. Conservamos tu borrador.",
          },
        });
    } catch (error) {
      if (!this.state.closed) this.emit({ error: errorMessage(error) });
    }
  }
  setPrompt(prompt: string) {
    if (!this.state.closed) {
      if ([...prompt].length > 256) {
        this.emit({
          error:
            "La petición admite hasta 256 caracteres. Conservamos el texto anterior.",
        });
        return;
      }
      if (prompt !== this.state.prompt) this.navigation++;
      this.emit({ prompt, error: "" });
    }
  }
  useExample() {
    this.setPrompt(waterPrompt);
  }
  private leaveReads() {
    this.resourceRead = null;
    this.navigation++;
    this.listGeneration++;
    return this.state.listState === "loading"
      ? this.listLoaded ? "ready" as const : "idle" as const
      : this.state.listState;
  }
  navigate(view: View) {
    if (this.state.closed || this.suspended) return;
    if (view === "home" || isPanelView(view)) void this.chat.openActive();
    this.analyticExplorer.close();
    const listState = this.leaveReads();
    this.closeOriginal();
    this.emit({ view, listState, error: "", ...(view === "home" ? {chatId: null} : {}) });
    if (view === "resources" && listState === "idle") void this.loadResources();
  }
  openChat(id: string) {
    if (this.state.closed || this.suspended) return;
    this.analyticExplorer.close();
    const listState = this.leaveReads();
    this.closeOriginal();
    this.emit({view: "chat", chatId: id, listState, error: ""});
    void this.chat.open(id);
  }
  restoreNavigation(location: { view: View; result: PlanningDocument | null; chatId?: string | null }) {
    if (this.state.closed || this.suspended) return;
    this.analyticExplorer.close();
    const listState = this.leaveReads();
    this.closeOriginal();
    // Navigation never replaces the editor buffer or the next request's source.
    if (location.view === "home" || isPanelView(location.view)) void this.chat.openActive();
    if (location.view === "chat" && location.chatId) void this.chat.open(location.chatId);
    this.emit({ view: location.view, listState, error: "", chatId: location.chatId ?? null,
      ...(location.view === "result" ? { result: location.result } : {}) });
    if (location.view === "resources" && listState === "idle") void this.loadResources();
  }
  resumeEditor() {
    if (!this.state.editor || this.state.closed) return;
    const listState = this.leaveReads();
    this.emit({ view: "result", result: this.state.editor.document, listState, error: "" });
  }
  removeSource() {
    if (!this.state.closed) {
      this.cancelAttachment();
      this.navigation++;
      this.emit({ source: null, error: "" });
    }
  }
  cancelAttachment() {
    if (this.sourceIntent && !this.state.closed) {
      // Closing the picker cancels selection, not a possibly committed write.
      this.sourceIntent.cancelled = true;
      this.emit();
    }
  }
  async recoverAttachment() {
    return this.sourceIntent ? this.attach(this.sourceIntent.bytes) : false;
  }
  async attach(bytes: string): Promise<boolean> {
    const epoch = this.epoch;
    if (this.suspended || this.state.closed || this.state.attaching) return false;
    const sample = sourceSamples.find((sample) => sample.bytes === bytes);
    if (!sample) {
      this.emit({
        error: "Sólo puedes seleccionar la referencia de ejemplo incorporada.",
      });
      return false;
    }
    if (this.sourceIntent && this.sourceIntent.bytes !== bytes) {
      this.emit({
        error:
          "Comprueba primero la referencia pendiente antes de seleccionar otra.",
      });
      return false;
    }
    if (!this.sourceIntent) {
      if (this.state.source && !Object.keys(this.selections).length)
        this.selections.water = this.state.source;
      const cached = this.selections[sample.id];
      if (cached) {
        this.navigation++;
        this.emit({ source: cached, sourceName: sample.name, error: "" });
        return true;
      }
    }
    const recovering = !!this.sourceIntent;
    const base = sourceSamples
      .filter((s) => s.family === sample.family)
      .map((s) => this.selections[s.id])
      .filter((s): s is SourceReceipt => !!s)
      .sort((a, b) => b.number - a.number)[0];
    this.sourceIntent ??= { key: crypto.randomUUID(), bytes, base };
    const intent = this.sourceIntent;
    intent.cancelled = false;
    this.navigation++;
    this.emit({ attaching: true, sourcePending: true, error: "" });
    let replayed = false;
    try {
      let source: SourceReceipt;
      try {
        source = await this.api.sourceOperation(intent.key);
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 404) throw e;
        replayed = true;
        source = intent.base
          ? await this.api.reviseSource(
              intent.base.source_id,
              intent.base.number,
              intent.bytes,
              intent.key,
            )
          : await this.api.createSource(intent.bytes, intent.key);
      }
      if (epoch !== this.epoch || this.suspended || this.state.closed) return false;
      const content = new TextEncoder().encode(intent.bytes);
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", content)),
      )
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      if (epoch !== this.epoch || this.suspended || this.state.closed) return false;
      if (
        source.operation_id !== intent.key ||
        source.actor_id !== this.api.session.actorId ||
        source.size !== content.length ||
        source.sha256 !== digest ||
        (intent.base &&
          (source.source_id !== intent.base.source_id ||
            source.number !== intent.base.number + 1))
      )
        throw new ApiError(0, "invalid_response");
      const selected = !intent.cancelled;
      this.selections[sample.id] = source;
      this.sourceIntent = null;
      // A newly confirmed source must be discoverable even after an earlier empty visit.
      // Revisions do not invalidate the catalog: its existing cards stay pinned until refresh.
      if (!intent.base) {
        this.listGeneration++;
        this.listLoaded = false;
      }
      this.emit({
        sourceName: selected ? sample.name : this.state.sourceName,
        source: selected ? source : this.state.source,
        attaching: false,
        sourcePending: false,
        ...(!intent.base ? { listState: "idle" as const } : {}),
      });
      if (!intent.base && this.state.view === "resources") void this.loadResources();
      return selected;
    } catch (e) {
      if (epoch === this.epoch && !this.suspended && !this.state.closed) {
        if (
          (!recovering && e instanceof ApiError && !e.uncertain) ||
          (replayed && rejectedReplay(e, "source"))
        )
          this.sourceIntent = null;
        this.emit({
          attaching: false,
          sourcePending: !!this.sourceIntent,
          error: errorMessage(e),
        });
      }
      return false;
    }
  }
  closeOriginal() {
    this.originalGeneration++;
    this.emit({ original: null });
  }
  async openOriginal(reference: SourceReference) {
    if (this.state.closed) return;
    const generation = ++this.originalGeneration;
    const exact = { ...reference };
    this.emit({ original: { reference: exact, status: "loading" } });
    try {
      const content = await this.api.original(exact);
      if (this.state.closed || generation !== this.originalGeneration) return;
      this.emit({ original: { reference: exact, status: "ready", content } });
    } catch (error) {
      if (this.state.closed || generation !== this.originalGeneration) return;
      const status =
        error instanceof ApiError && error.status === 404
          ? "unavailable"
          : error instanceof ApiError &&
              ["invalid_response", "original_view_failed"].includes(error.code)
            ? "viewer-error"
            : "error";
      this.emit({ original: { reference: exact, status } });
    }
  }
  async submit() {
    if (this.state.closed || this.suspended || this.busy) return;
    if (this.state.pending) {
      await this.recoverCreate();
      return;
    }
    const { source, prompt } = this.state;
    if (!source || !prompt.trim()) {
      this.emit({
        error: "Escribe la petición y adjunta la referencia de ejemplo.",
      });
      return;
    }
    if ([...prompt].length > 256) {
      this.emit({ error: "La petición admite hasta 256 caracteres." });
      return;
    }
    const intent: CreateIntent = {
      kind: "create",
      key: crypto.randomUUID(),
      navigation: this.navigation,
      payload: {
        contract_version: 1,
        fixture_context: "water-observation-v1",
        prompt,
        source_id: source.source_id,
        expected_source_version: source.number,
      },
    };
    this.emit({ pending: intent, submit: "sending", error: "" });
    await this.runCreate(intent, false);
  }
  private async runCreate(intent: CreateIntent, recover: boolean) {
    const epoch = this.epoch;
    this.busy = true;
    let replayed = false;
    try {
      let doc: PlanningDocument;
      if (recover) {
        try {
          doc = await this.api.operation(intent.key);
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404) throw e;
          if (intent.payload.contract_version === 3) throw e;
          replayed = true;
          doc = await this.api.create(intent.payload, intent.key);
        }
      } else doc = await this.api.create(intent.payload, intent.key);
      if (epoch !== this.epoch || this.suspended || this.state.closed || this.state.pending?.key !== intent.key) return;
      if (
        doc.receipt.operation_id !== intent.key ||
        Object.entries(intent.payload).some(([k, value]) => !sameJson((doc.request as unknown as Record<string, unknown>)[k], value))
      )
        throw new ApiError(0, "invalid_response");
      this.emit({
        result: this.navigation === intent.navigation ? doc : this.state.result,
        pending: null,
        submit: "idle",
        view:
          this.navigation !== intent.navigation ? this.state.view : "result",
        items: this.upsert(doc),
      });
    } catch (e) {
      if (epoch !== this.epoch || this.suspended || this.state.closed) return;
      const generated = intent.payload.contract_version === 3;
      const generationPending = generated && e instanceof ApiError &&
        ["generation_pending", "generation_uncertain"].includes(e.code);
      const generationFailed = generated && e instanceof ApiError && e.code === "generation_failed";
      const unavailable = generated && !recover && e instanceof ApiError && e.code === "generation_unavailable";
      const certain = !generationPending && (generationFailed || unavailable ||
        (!recover && e instanceof ApiError && !e.uncertain) ||
        (replayed && rejectedReplay(e, "create")));
      this.emit({
        submit: certain ? "error" : "unknown",
        error: intent.payload.contract_version === 2 && e instanceof ApiError && e.code === "unsupported_fixture"
          ? "Este ejemplo sólo admite Ciencias naturales, 3.º de primaria, el cuidado del agua en la comunidad, aprendizaje activo y español. Tus datos siguen aquí para corregirlos." : errorMessage(e),
        pending: certain ? null : intent,
        ...(unavailable ? {generationAvailable: false} : {}),
      });
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  async recoverCreate() {
    const i = this.state.pending;
    if (!this.state.closed && !this.suspended && !this.busy && i) {
      this.emit({ submit: "sending", error: "" });
      await this.runCreate(i, true);
    }
  }
  private upsert(doc: PlanningDocument) {
    return [
      doc,
      ...this.state.items.filter(
        (d) => d.receipt.planning_id !== doc.receipt.planning_id,
      ),
    ];
  }
  openEditor(doc = this.state.result, resourceKey?: string, elementKey?: string) {
    if (this.state.closed || this.suspended || !doc) return;
    if (this.recovery?.candidate) { this.emit({error:"Recupera o descarta primero el respaldo pendiente."}); return; }
    this.navigation++;
    const resource = editableResource(doc, resourceKey),
      element = resource?.elements.find((e) => e.editable && (!elementKey || e.key === elementKey));
    if (!resource || !element) {
      this.emit({
        error: "Este resultado no tiene un campo editable disponible.",
      });
      return;
    }
    const old = this.state.editor;
    if (
      old &&
      old.document.receipt.planning_id === doc.receipt.planning_id &&
      old.document.receipt.revision === doc.receipt.revision &&
      old.resourceKey === resource.key && old.elementKey === element.key
    ) {
      this.emit({ view: "result", result: doc });
      return;
    }
    if (
      old &&
      (old.pending || (old.text !== old.baseline && !old.draftSaved))
    ) {
      this.emit({
        error: "Conserva el borrador abierto antes de editar otro recurso.",
      });
      return;
    }
    this.emit({
      result: doc,
      editor: {
        document: doc,
        resourceKey: resource.key,
        elementKey: element.key,
        text: element.text,
        baseline: element.text,
        generation: 0,
        save: "clean",
        latest: null,
        draftId: crypto.randomUUID(),
        draftRevision: 0,
        error: "",
        pending: null,
        draftSaved: false,
      },
    });
  }
  selectEditorTarget(resourceKey: string, elementKey: string) {
    const e = this.state.editor;
    if (!e || e.pending || e.text !== e.baseline || e.draftSaved) return;
    this.openEditor(e.document, resourceKey, elementKey);
  }
  edit(text: string) {
    const e = this.state.editor;
    if (!e || this.state.closed || this.suspended) return;
    this.navigation++;
    if ([...text].length > 1000) {
      this.emit({
        editor: {
          ...e,
          error:
            "El enunciado admite hasta 1000 caracteres. Conservamos el texto anterior.",
        },
      });
      return;
    }
    this.emit({
      editor: {
        ...e,
        text,
        generation: e.generation + 1,
        save: e.pending ? "unknown" : text === e.baseline ? "clean" : "dirty",
        error: "",
        draftSaved: false,
      },
    });
  }
  undo() {
    const e = this.state.editor;
    if (!e || e.pending || this.state.closed || this.suspended) return;
    this.emit({
      editor: {
        ...e,
        text: e.baseline,
        generation: e.generation + 1,
        save: "clean",
        error: "",
        draftSaved: false,
      },
    });
  }
  closeEditor() {
    const e = this.state.editor;
    if (!e) return true;
    if (e.pending || (e.text !== e.baseline && !e.draftSaved)) return false;
    this.emit({ editor: null });
    return true;
  }
  async save(copy = false) {
    const e = this.state.editor;
    if (!e || this.state.closed || this.suspended || this.busy) return;
    if (e.pending) {
      await this.recoverEditor();
      return;
    }
    if (e.text === e.baseline && !copy) return;
    if (!e.text.trim() || [...e.text].length > 1000) {
      this.emit({
        editor: {
          ...e,
          error: "El enunciado debe contener entre 1 y 1000 caracteres.",
        },
      });
      return;
    }
    const common = {
      contract_version: 1 as const,
      resource_key: e.resourceKey,
      element_key: e.elementKey,
      text: e.text,
    };
    const intent: EditIntent = {
      kind: copy ? "copy" : "edit",
      key: crypto.randomUUID(),
      planningId: e.document.receipt.planning_id,
      generation: e.generation,
      payload: copy
        ? { ...common, base_revision: e.document.receipt.revision }
        : { ...common, expected_revision: e.document.receipt.revision },
    };
    this.emit({ editor: { ...e, save: "saving", pending: intent, error: "" } });
    await this.runEditor(intent, false);
  }
  async preserveDraft() {
    const e = this.state.editor;
    if (!e || this.state.closed || this.suspended || this.busy) return;
    if (e.pending) {
      await this.recoverEditor();
      return;
    }
    if (!e.text.trim() || [...e.text].length > 1000) {
      this.emit({
        editor: {
          ...e,
          error: "El enunciado debe contener entre 1 y 1000 caracteres.",
        },
      });
      return;
    }
    const intent: DraftIntent = {
      kind: "draft",
      key: crypto.randomUUID(),
      planningId: e.document.receipt.planning_id,
      draftId: e.draftId,
      generation: e.generation,
      payload: {
        contract_version: 1,
        base_revision: e.document.receipt.revision,
        expected_draft_revision: e.draftRevision,
        resource_key: e.resourceKey,
        element_key: e.elementKey,
        text: e.text,
      },
    };
    this.emit({ editor: { ...e, save: "saving", pending: intent, error: "" } });
    await this.runEditor(intent, false);
  }
  private async runEditor(intent: EditorIntent, recover: boolean) {
    const epoch = this.epoch;
    this.busy = true;
    let replayed = false;
    try {
      const write = () =>
        intent.kind === "draft"
          ? this.api.draft(
              intent.planningId,
              intent.draftId,
              intent.payload,
              intent.key,
            )
          : intent.kind === "copy"
            ? this.api.copy(
                intent.planningId,
                intent.payload as CopyRequest,
                intent.key,
              )
            : this.api.save(
                intent.planningId,
                intent.payload as EditRequest,
                intent.key,
              );
      let raw: unknown;
      if (recover) {
        try {
          raw = await (intent.kind === "draft"
            ? this.api.draftOperation(intent.key)
            : this.api.operation(intent.key));
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404) throw e;
          replayed = true;
          raw = await write();
        }
      } else raw = await write();
      const current = this.state.editor;
      if (epoch !== this.epoch || this.suspended || this.state.closed || current?.pending?.key !== intent.key) return;
      const changed = current.generation !== intent.generation;
      if (intent.kind === "draft") {
        const d = parseDraft(raw);
        if (
          d.receipt.scope_id !== this.api.session.scopeId ||
          d.receipt.actor_id !== this.api.session.actorId ||
          d.receipt.operation_id !== intent.key ||
          d.receipt.draft_id !== intent.draftId ||
          d.receipt.planning_id !== intent.planningId ||
          d.receipt.base_revision_id !== current.document.receipt.revision_id ||
          Object.entries(intent.payload).some(
            ([k, v]) =>
              (d.request as unknown as Record<string, unknown>)[k] !== v,
          )
        )
          throw new ApiError(0, "invalid_response");
        this.emit({
          drafts: [
            d,
            ...this.state.drafts.filter(
              (x) => x.receipt.draft_id !== d.receipt.draft_id,
            ),
          ],
          editor: {
            ...current,
            pending: null,
            save: changed ? "dirty" : "clean",
            draftRevision: d.receipt.draft_revision,
            draftSaved: !changed,
            error: changed
              ? "Conservamos el borrador anterior; tu edición más reciente sigue pendiente."
              : "",
          },
        });
        return;
      }
      const doc = parsePlanning(raw);
      if (
        doc.receipt.operation_id !== intent.key ||
        doc.receipt.scope_id !== this.api.session.scopeId ||
        doc.receipt.actor_id !== this.api.session.actorId ||
        !("kind" in doc.request) ||
        doc.request.kind !== intent.kind ||
        Object.entries(intent.payload).some(
          ([k, v]) =>
            (doc.request as unknown as Record<string, unknown>)[k] !== v,
        ) ||
        (intent.kind === "edit" &&
          doc.receipt.planning_id !== intent.planningId) ||
        (intent.kind === "copy" &&
          (doc.receipt.planning_id === intent.planningId ||
            doc.origin?.planning_id !== intent.planningId ||
            doc.origin?.revision_id !== current.document.receipt.revision_id ||
            doc.origin?.revision !== current.document.receipt.revision)) ||
        (
          [
            "source_id",
            "source_version_id",
            "source_version",
            "source_sha256",
          ] as const
        ).some(
          (field) => doc.receipt[field] !== current.document.receipt[field],
        )
      )
        throw new ApiError(0, "invalid_response");
      const element = editableResource(doc, current.resourceKey)?.elements.find(
        (e) => e.key === current.elementKey,
      );
      if (!element || element.text !== intent.payload.text)
        throw new ApiError(0, "invalid_response");
      this.emit({
        result: this.state.result?.receipt.revision_id === current.document.receipt.revision_id
          ? doc : this.state.result,
        items: this.upsert(doc),
        editor: {
          ...current,
          document: doc,
          baseline: element.text,
          text: changed ? current.text : element.text,
          pending: null,
          save: changed ? "dirty" : "saved",
          latest: null,
          error: "",
          draftSaved: false,
          draftId:
            intent.kind === "copy" ? crypto.randomUUID() : current.draftId,
          draftRevision: intent.kind === "copy" ? 0 : current.draftRevision,
        },
      });
    } catch (error) {
      const current = this.state.editor;
      if (epoch !== this.epoch || this.suspended || this.state.closed || !current || current.pending?.key !== intent.key)
        return;
      const conflict = error instanceof ApiError && error.status === 409,
        certain =
          (!recover && error instanceof ApiError && !error.uncertain) ||
          (replayed && rejectedReplay(error, intent.kind));
      this.emit({
        editor: {
          ...current,
          save: conflict ? "conflict" : certain ? "error" : "unknown",
          error: errorMessage(error),
          pending: certain ? null : intent,
        },
      });
      if (conflict) {
        try {
          const latest = await this.api.read(intent.planningId),
            now = this.state.editor;
          if (
            epoch === this.epoch && !this.suspended && !this.state.closed &&
            now?.document.receipt.planning_id === intent.planningId
          )
            this.emit({ editor: { ...now, latest } });
        } catch {
          /* A failed refresh never destroys the base or draft. */
        }
      }
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  async recoverEditor() {
    const i = this.state.editor?.pending;
    if (!this.state.closed && !this.suspended && !this.busy && i) {
      this.emit({
        editor: { ...this.state.editor!, save: "saving", error: "" },
      });
      await this.runEditor(i, true);
    }
  }
  async open(id: string) {
    if (this.state.closed) return;
    if (
      this.state.editor &&
      (this.state.editor.pending ||
        (this.state.editor.text !== this.state.editor.baseline &&
          !this.state.editor.draftSaved))
    ) {
      this.emit({
        error: "Conserva el borrador abierto antes de editar otro recurso.",
      });
      return;
    }
    const listState = this.leaveReads();
    this.emit({ listState });
    const nav = this.navigation;
    try {
      const doc = await this.api.read(id);
      if (this.state.closed || nav !== this.navigation) return;
      this.emit({ result: doc, view: "result", error: "" });
      if (!isGuided(doc.result)) this.openEditor(doc);
    } catch (e) {
      if (!this.state.closed && nav === this.navigation)
        this.emit({ error: errorMessage(e) });
    }
  }
  async openDraft(id: string) {
    if (this.state.closed) return;
    if (
      this.state.editor &&
      (this.state.editor.pending ||
        (this.state.editor.text !== this.state.editor.baseline &&
          !this.state.editor.draftSaved))
    ) {
      this.emit({
        error: "Conserva el borrador abierto antes de recuperar otro.",
      });
      return;
    }
    const listState = this.leaveReads();
    this.emit({ listState });
    const nav = this.navigation;
    try {
      const draft = parseDraft(await this.api.readDraft(id));
      if (
        draft.receipt.scope_id !== this.api.session.scopeId ||
        draft.receipt.actor_id !== this.api.session.actorId
      )
        throw new ApiError(0, "invalid_response");
      const base = await this.api.read(
        draft.receipt.planning_id,
        draft.receipt.base_revision,
      );
      if (this.state.closed || nav !== this.navigation) return;
      this.openEditor(base, draft.request.resource_key, draft.request.element_key);
      const e = this.state.editor;
      if (
        e &&
        e.document.receipt.planning_id === base.receipt.planning_id &&
        e.document.receipt.revision === base.receipt.revision &&
        !e.pending &&
        e.text === e.baseline
      )
        this.emit({
          view: "result",
          editor: {
            ...e,
            text: draft.request.text,
            draftId: id,
            draftRevision: draft.receipt.draft_revision,
            draftSaved: true,
            save: "clean",
          },
        });
    } catch (e) {
      if (!this.state.closed && nav === this.navigation)
        this.emit({ error: errorMessage(e) });
    }
  }
  async loadResources(more = false) {
    if (this.state.closed || this.state.listState === "loading") return;
    const generation = ++this.listGeneration;
    const read = { generation, derived: [] as PlanningDocument[] };
    this.resourceRead = read;
    this.emit({ listState: "loading", error: "" });
    try {
      const [page, drafts, sources] = await Promise.all([
        more && !this.state.cursor
          ? Promise.resolve({ items: [], next_cursor: null })
          : this.api.list(more ? (this.state.cursor ?? undefined) : undefined),
        more && !this.state.draftCursor
          ? Promise.resolve({ items: [], next_cursor: null })
          : this.api.listDrafts(
              more ? (this.state.draftCursor ?? undefined) : undefined,
            ),
        more && !this.state.sourceCursor
          ? Promise.resolve({ items: [], next_cursor: null })
          : this.api.listSources(
              more ? (this.state.sourceCursor ?? undefined) : undefined,
            ),
      ]);
      if (this.state.closed || generation !== this.listGeneration) return;
      this.listLoaded = true;
      let items = more ? [...this.state.items, ...page.items] : page.items;
      if (more || read.derived.length) {
        const confirmed = new Map(read.derived.map(doc => [doc.receipt.planning_id, doc]));
        for (const doc of items) {
          const prior = confirmed.get(doc.receipt.planning_id);
          if (!prior || doc.receipt.revision > prior.receipt.revision) confirmed.set(doc.receipt.planning_id, doc);
        }
        items = [...confirmed.values()];
      }
      this.emit({
          items,
          drafts: more ? [...this.state.drafts, ...drafts.items] : drafts.items,
          sources: more ? [...this.state.sources, ...sources.items] : sources.items,
          cursor: page.next_cursor,
          draftCursor: drafts.next_cursor,
          sourceCursor: sources.next_cursor,
          listState: "ready",
        });
    } catch (e) {
      if (!this.state.closed && generation === this.listGeneration)
        this.emit({ listState: "error", error: errorMessage(e) });
    } finally {
      if (this.resourceRead === read) this.resourceRead = null;
    }
  }
  closeSession() {
    this.chat.close();
    this.schools.close();
    this.analytic.close();
    this.analyticExplorer.dispose();
    this.analyticDerivation.close();
    this.resourceRead = null;
    this.epoch++;
    this.navigation++;
    this.listGeneration++;
    this.originalGeneration++;
    this.sourceIntent = null;
    this.selections = {};
    this.listLoaded = false;
    // The narrow runtime recovery slot and any test/legacy store are purged.
    this.recovery?.purge();
    this.recovery?.generations.purge();
    try { this.storage?.removeItem(this.backupKey); } catch { /* Never retain visible private state if browser storage fails. */ }
    this.storage = null;
    this.state = { ...fresh(), closed: true };
    for (const fn of this.listeners) fn();
  }
}
