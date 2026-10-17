import type {
  Session,
  SourceReceipt,
  PlanningRequest,
  PlanningDocument,
  EditRequest,
  CopyRequest,
  DraftRequest,
  DraftDocument,
  Page,
  Result,
} from "./contracts";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
  get uncertain() {
    return this.status === 0 || this.status >= 500;
  }
}
export type Transport = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && uuid.test(v);
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
const positive = (v: unknown) =>
  Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 2147483647;
const date = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const sha = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function assert(ok: unknown): asserts ok {
  if (!ok) throw new ApiError(0, "invalid_response");
}
function statement(q: Record<string, unknown>) {
  return (
    q.contract_version === 1 &&
    typeof q.text === "string" &&
    q.text.trim() &&
    [...q.text].length <= 1000 &&
    typeof q.resource_key === "string" &&
    typeof q.element_key === "string"
  );
}
function origin(v: unknown) {
  return (
    object(v) &&
    isUuid(v.planning_id) &&
    isUuid(v.revision_id) &&
    positive(v.revision)
  );
}
export function parseResult(v: unknown): Result {
  assert(
    object(v) &&
      v.provenance === "synthetic-fixture-v1" &&
      typeof v.title === "string" &&
      typeof v.notice === "string",
  );
  assert(
    Array.isArray(v.activities) &&
      v.activities.every(
        (a) =>
          object(a) &&
          typeof a.statement === "string" &&
          Number.isInteger(a.minutes) &&
          Number(a.minutes) >= 0 &&
          (a.title === undefined || typeof a.title === "string") &&
          (a.key === undefined || typeof a.key === "string") &&
          (a.previous_minutes === undefined ||
            Number.isInteger(a.previous_minutes)),
      ),
  );
  assert(
    v.context === undefined ||
      (object(v.context) &&
        ["level", "group", "subject"].every(
          (k) => typeof (v.context as Record<string, unknown>)[k] === "string",
        )),
  );
  assert(
    v.materials === undefined ||
      (Array.isArray(v.materials) &&
        v.materials.every((m) => typeof m === "string")),
  );
  assert(
    v.resources === undefined ||
      (Array.isArray(v.resources) &&
        v.resources.every(
          (r) =>
            object(r) &&
            typeof r.key === "string" &&
            typeof r.title === "string" &&
            r.audience === "students" &&
            Array.isArray(r.elements) &&
            r.elements.every(
              (e) =>
                object(e) &&
                typeof e.key === "string" &&
                ["statement", "question"].includes(String(e.kind)) &&
                typeof e.text === "string" &&
                typeof e.editable === "boolean" &&
                (e.lines === undefined ||
                  (Number.isInteger(e.lines) && Number(e.lines) >= 0)),
            ),
        )),
  );
  return v as unknown as Result;
}
export function parseSource(v: unknown): SourceReceipt {
  assert(
    object(v) &&
      ["source_id", "version_id", "scope_id", "actor_id", "operation_id"].every(
        (k) => isUuid(v[k]),
      ) &&
      positive(v.number) &&
      sha(v.sha256) &&
      Number.isInteger(v.size) &&
      Number(v.size) >= 0 &&
      date(v.created_at),
  );
  return v as unknown as SourceReceipt;
}
export function parsePlanning(v: unknown): PlanningDocument {
  assert(object(v) && object(v.receipt) && object(v.request));
  const r = v.receipt,
    q = v.request;
  assert(
    r.contract_version === 1 &&
      r.namespace === "planning-v1" &&
      [
        "planning_id",
        "revision_id",
        "scope_id",
        "actor_id",
        "operation_id",
        "source_id",
        "source_version_id",
      ].every((k) => isUuid(r[k])) &&
      positive(r.revision) &&
      positive(r.source_version) &&
      date(r.created_at) &&
      sha(r.source_sha256),
  );
  if (q.kind === "edit" || q.kind === "copy") {
    assert(
      statement(q) &&
        positive(q.kind === "edit" ? q.expected_revision : q.base_revision),
    );
    assert(q.kind !== "edit" || r.revision === Number(q.expected_revision) + 1);
    assert(q.kind !== "copy" || (r.revision === 1 && origin(v.origin)));
  } else
    assert(
      q.contract_version === 1 &&
        typeof q.prompt === "string" &&
        q.source_id === r.source_id &&
        q.expected_source_version === r.source_version &&
        ["timing-example-v1", "water-observation-v1"].includes(
          String(q.fixture_context),
        ),
    );
  assert(v.origin === undefined || origin(v.origin));
  if (v.initial_request !== undefined) {
    const q = v.initial_request;
    assert(
      object(q) &&
        q.contract_version === 1 &&
        typeof q.prompt === "string" &&
        q.source_id === r.source_id &&
        q.expected_source_version === r.source_version &&
        ["timing-example-v1", "water-observation-v1"].includes(
          String(q.fixture_context),
        ),
    );
  }
  parseResult(v.result);
  return v as unknown as PlanningDocument;
}
export function parseDraft(v: unknown): DraftDocument {
  assert(object(v) && object(v.receipt) && object(v.request));
  const r = v.receipt,
    q = v.request;
  assert(
    r.contract_version === 1 &&
      r.namespace === "planning-draft-v1" &&
      [
        "draft_id",
        "revision_id",
        "planning_id",
        "base_revision_id",
        "scope_id",
        "actor_id",
        "operation_id",
      ].every((k) => isUuid(r[k])) &&
      positive(r.draft_revision) &&
      positive(r.base_revision) &&
      date(r.created_at),
  );
  assert(
    statement(q) &&
      q.base_revision === r.base_revision &&
      Number.isInteger(q.expected_draft_revision) &&
      Number(q.expected_draft_revision) >= 0 &&
      r.draft_revision === Number(q.expected_draft_revision) + 1,
  );
  const result = parseResult(v.result);
  assert(
    result.resources?.some(
      (r) =>
        r.key === q.resource_key &&
        r.elements.some(
          (e) => e.key === q.element_key && e.text === q.text && e.editable,
        ),
    ),
  );
  return v as unknown as DraftDocument;
}
/** Every request remains subject to server require_actor. No identity headers or runtime demo session. */
export class AcentaApi {
  constructor(
    readonly session: Session,
    private transport: Transport = (input, init) =>
      globalThis.fetch(input, init),
  ) {
    if (!isUuid(session.actorId) || !isUuid(session.scopeId))
      throw new Error("Invalid session identity");
  }
  private id(value: string) {
    if (!isUuid(value)) throw new ApiError(422, "invalid_request");
    return value;
  }
  private async request(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
    binary = false,
    limit = 8192,
  ): Promise<unknown> {
    if (key !== undefined) this.id(key);
    const headers: Record<string, string> = {};
    if (key) headers["Idempotency-Key"] = key;
    if (body !== undefined)
      headers["Content-Type"] = binary
        ? "application/octet-stream"
        : "application/json";
    const payload =
      body === undefined
        ? undefined
        : binary
          ? String(body)
          : JSON.stringify(body);
    if (!binary && payload && new TextEncoder().encode(payload).length > limit)
      throw new ApiError(413, "content_too_large");
    let response: Response;
    try {
      response = await this.transport(
        `/scopes/${this.session.scopeId}/${path}`,
        {
          method,
          headers,
          body: payload,
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch {
      throw new ApiError(0, "unconfirmed");
    }
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
  private scoped<T extends { scope_id: string; actor_id: string }>(receipt: T) {
    assert(
      receipt.scope_id === this.session.scopeId &&
        receipt.actor_id === this.session.actorId,
    );
  }
  private planning(value: unknown) {
    const doc = parsePlanning(value);
    this.scoped(doc.receipt);
    return doc;
  }
  private draftDocument(value: unknown) {
    const doc = parseDraft(value);
    this.scoped(doc.receipt);
    return doc;
  }
  private source(value: unknown, key: string) {
    const source = parseSource(value);
    this.scoped(source);
    assert(source.operation_id === key);
    return source;
  }
  async createSource(bytes: string, key: string) {
    return this.source(
      await this.request("sources", "POST", bytes, key, true),
      key,
    );
  }
  async sourceOperation(key: string) {
    return this.source(await this.request(`operations/${this.id(key)}`), key);
  }
  async create(payload: PlanningRequest, key: string) {
    return this.planning(
      await this.request("plannings", "POST", payload, key, false, 4096),
    );
  }
  async read(id: string, revision?: number) {
    const doc = this.planning(
      await this.request(
        `plannings/${this.id(id)}${revision ? `/revisions/${revision}` : ""}`,
      ),
    );
    assert(
      doc.receipt.planning_id === id &&
        (!revision || doc.receipt.revision === revision),
    );
    return doc;
  }
  async operation(key: string) {
    const doc = this.planning(
      await this.request(`planning-operations/${this.id(key)}`),
    );
    assert(doc.receipt.operation_id === key);
    return doc;
  }
  async save(id: string, payload: EditRequest, key: string) {
    return this.planning(
      await this.request(
        `plannings/${this.id(id)}/revisions`,
        "POST",
        payload,
        key,
      ),
    );
  }
  async copy(id: string, payload: CopyRequest, key: string) {
    return this.planning(
      await this.request(
        `plannings/${this.id(id)}/copies`,
        "POST",
        payload,
        key,
      ),
    );
  }
  async list(cursor?: string): Promise<Page<PlanningDocument>> {
    const v = await this.request(
      `plannings${cursor ? `?after=${this.id(cursor)}` : ""}`,
    );
    assert(
      object(v) &&
        Array.isArray(v.items) &&
        (v.next_cursor === null || isUuid(v.next_cursor)),
    );
    return {
      items: v.items.map((d) => this.planning(d)),
      next_cursor: v.next_cursor,
    };
  }
  async draft(id: string, draftId: string, payload: DraftRequest, key: string) {
    return this.draftDocument(
      await this.request(
        `plannings/${this.id(id)}/drafts/${this.id(draftId)}`,
        "PUT",
        payload,
        key,
      ),
    );
  }
  async readDraft(id: string) {
    const d = this.draftDocument(
      await this.request(`planning-drafts/${this.id(id)}`),
    );
    assert(d.receipt.draft_id === id);
    return d;
  }
  async draftOperation(key: string) {
    const d = this.draftDocument(
      await this.request(`planning-draft-operations/${this.id(key)}`),
    );
    assert(d.receipt.operation_id === key);
    return d;
  }
  async listDrafts(cursor?: string): Promise<Page<DraftDocument>> {
    const v = await this.request(
      `planning-drafts${cursor ? `?after=${this.id(cursor)}` : ""}`,
    );
    assert(
      object(v) &&
        Array.isArray(v.items) &&
        (v.next_cursor === null || isUuid(v.next_cursor)),
    );
    return {
      items: v.items.map((d) => this.draftDocument(d)),
      next_cursor: v.next_cursor,
    };
  }
}
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError))
    return "No se pudo completar la operación. Tu trabajo sigue aquí.";
  if (error.status === 401)
    return "La sesión no está disponible. Conservamos el trabajo pendiente.";
  if (error.status === 409)
    return "Hay una versión o petición diferente. Conservamos tu texto; revisa el estado antes de continuar.";
  if (error.status === 422 && error.code === "unsupported_fixture")
    return "Este corte sólo admite el ejemplo y la petición de ajuste indicados. No genera respuestas libres.";
  if (error.status === 404)
    return "No pudimos recuperar este elemento. Su estado puede seguir pendiente.";
  if (error.status === 413)
    return "El contenido supera el límite de este ejemplo.";
  if (error.status === 415) return "Este formato de envío no está admitido.";
  if (error.status === 422)
    return "Revisa los datos del ejemplo antes de continuar.";
  return "No pudimos confirmar la operación. Tu trabajo sigue aquí. Comprueba su estado antes de reintentar.";
}
