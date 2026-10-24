import type {
  SourceReference,
  OriginalContent,
  Session,
  SourceReceipt,
  CreationRequest,
  ManualPlanningRequest,
  GeneratedPlanningRequest,
  PlanningDocument,
  EditRequest,
  CopyRequest,
  DraftRequest,
  DraftDocument,
  Page,
  Result,
} from "./contracts";

import { guidedResources, validateGuidedRequest } from "./guided-planning";
import { chatTextError, chatContextError, parseChatDocument, parseChatContextReceipt, parseChatContextRevision, parseConversationSummary, type ChatDocument, type ChatContextReceipt, type ChatContextRevision, type ConversationSummary } from "./chat-contracts";
import {
  isAnalyticSectionData,
  MAX_ANALYTIC_DATA_BYTES,
  prefillAnalyticPlanning,
  type AnalyticSectionData,
  type AnalyticSectionDocument,
  type AnalyticSectionFilters,
  type DeriveAnalyticPlanningRequest,
} from "./analytic-sections";

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
const usefulText = (v: unknown): v is string => typeof v === "string" && !!v.trim() && !/[\u0000\uD800-\uDFFF]/u.test(v);
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
/** JSON object order is not semantic (PostgreSQL JSONB may reorder keys). */
export function sameJson(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((x, i) => sameJson(x, right[i]));
  if (object(left) || object(right)) return object(left) && object(right) && Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(k => Object.hasOwn(right, k) && sameJson(left[k], right[k]));
  return left === right;
}
export function parseResult(v: unknown): Result {
  assert(
    object(v) &&
      (v.provenance === "synthetic-fixture-v1" || v.provenance === "openai-guided-v1") &&
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
  if (v.kind !== undefined) {
    assert(v.kind === "guided-planning-v1" && [v.title, v.notice, v.purpose, v.formative_assessment].every(usefulText) &&
      Number.isInteger(v.duration_minutes) && Array.isArray(v.materials) && v.materials.length > 0 &&
      v.materials.every(usefulText) &&
      JSON.stringify((v.activities as Record<string, unknown>[]).map(a => a.key)) === JSON.stringify(["introduction", "exploration", "closure"]) &&
      v.resources === undefined && v.context === undefined &&
      (v.activities as Record<string, unknown>[]).every(a => typeof a.key === "string" && usefulText(a.title) &&
        usefulText(a.statement) && Number(a.minutes) >= 1 && Number(a.minutes) <= 180) &&
      new Set((v.activities as Record<string, unknown>[]).map(a => a.key)).size === (v.activities as unknown[]).length &&
      (v.activities as Record<string, unknown>[]).reduce((sum, a) => sum + Number(a.minutes), 0) === v.duration_minutes);
  } else assert(v.provenance === "synthetic-fixture-v1" && v.purpose === undefined && v.formative_assessment === undefined && v.duration_minutes === undefined);
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
function guidedRequest(q: Record<string, unknown>): q is Record<string, unknown> & ManualPlanningRequest {
  if (!(q.contract_version === 2 ? q.fixture_context === "guided-water-v1" : q.contract_version === 3 && !Object.hasOwn(q, "fixture_context")) ||
    !["subject", "grade", "topic", "method", "language"].every(k => typeof q[k] === "string") ||
    !Number.isInteger(q.duration_minutes) ||
    !(q.context === null || (object(q.context) && typeof q.context.text === "string" && typeof q.context.hypothetical === "boolean")) ||
    !(q.formative_field === null || typeof q.formative_field === "string") ||
    !["learning_objectives", "articulating_axes"].every(k => Array.isArray(q[k]) && (q[k] as unknown[]).every(v => typeof v === "string")) ||
    !(q.reference === null || (object(q.reference) && isUuid(q.reference.source_id) && positive(q.reference.source_version) && Number(q.reference.source_version) <= 2147483646))) return false;
  return Object.keys(validateGuidedRequest(q as unknown as ManualPlanningRequest)).length === 0;
}
function initialRequest(q: unknown, r: Record<string, unknown>) {
  if (!object(q)) return false;
  if (q.contract_version === 2 || q.contract_version === 3) return guidedRequest(q) &&
    (q.reference === null ? r.source_id === null :
      q.reference.source_id === r.source_id && q.reference.source_version === r.source_version);
  return q.contract_version === 1 && typeof q.prompt === "string" &&
    q.source_id === r.source_id && q.expected_source_version === r.source_version &&
    ["timing-example-v1", "water-observation-v1"].includes(String(q.fixture_context));
}
/** The recovery slot accepts only the bounded, explicit generation DTO. */
export function parseGeneratedRequest(q: unknown): GeneratedPlanningRequest {
  const fields = ["contract_version", "subject", "grade", "topic", "duration_minutes", "method", "language", "context", "learning_objectives", "formative_field", "articulating_axes", "reference"];
  assert(object(q) && q.contract_version === 3 && Object.keys(q).length === fields.length && fields.every(k => Object.hasOwn(q, k)) && guidedRequest(q));
  assert(q.context === null || (object(q.context) && Object.keys(q.context).length === 2));
  assert(q.reference === null || (object(q.reference) && Object.keys(q.reference).length === 2));
  assert(new TextEncoder().encode(JSON.stringify(q)).length <= 4096);
  return q as unknown as GeneratedPlanningRequest;
}
export function parseAnalyticSection(v: unknown): AnalyticSectionDocument {
  assert(object(v) && object(v.receipt) && isAnalyticSectionData(v.data) && v.provenance === "manual-v1");
  const r = v.receipt, reference = v.data.reference;
  assert(r.contract_version === 1 && r.namespace === "analytic-section-v1" &&
    ["section_id", "revision_id", "scope_id", "actor_id", "operation_id"].every(k => isUuid(r[k])) &&
    positive(r.revision) && date(r.created_at));
  assert(reference === null
    ? r.source_id === null && r.source_version_id === null && r.source_version === null && r.source_sha256 === null
    : r.source_id === reference.source_id && r.source_version === reference.source_version && isUuid(r.source_version_id) && sha(r.source_sha256));
  return v as unknown as AnalyticSectionDocument;
}
function validateAnalyticOrigin(v: Record<string, unknown>, initial: unknown) {
  if (v.analytic_origin === undefined) return;
  const section = parseAnalyticSection(v.analytic_origin);
  assert(object(v.receipt) && object(initial) && initial.contract_version === 2 &&
    section.receipt.scope_id === v.receipt.scope_id && section.receipt.actor_id === v.receipt.actor_id);
  const expected = prefillAnalyticPlanning(section);
  for (const key of ["grade", "topic", "language", "context", "learning_objectives", "formative_field", "articulating_axes", "reference"] as const)
    assert(sameJson(initial[key], expected[key]));
  if (v.receipt.namespace === "planning-v1") {
    for (const key of ["source_id", "source_version_id", "source_version", "source_sha256"] as const)
      assert(v.receipt[key] === section.receipt[key]);
  }
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
      ].every((k) => isUuid(r[k])) &&
      positive(r.revision) &&
      date(r.created_at) &&
      ((r.source_id === null && r.source_version_id === null && r.source_version === null && r.source_sha256 === null) ||
        (isUuid(r.source_id) && isUuid(r.source_version_id) && positive(r.source_version) && sha(r.source_sha256))),
  );
  if (q.kind === "edit" || q.kind === "copy") {
    assert(
      statement(q) &&
        positive(q.kind === "edit" ? q.expected_revision : q.base_revision),
    );
    assert(q.kind !== "edit" || r.revision === Number(q.expected_revision) + 1);
    assert(q.kind !== "copy" || (r.revision === 1 && origin(v.origin)));
  } else assert(initialRequest(q, r));
  assert(v.origin === undefined || origin(v.origin));
  if (v.initial_request !== undefined) assert(initialRequest(v.initial_request, r));
  const initial = v.initial_request ?? q;
  validateAnalyticOrigin(v, initial);
  assert(object(v.result));
  assert((object(initial) && (initial.contract_version === 2 || initial.contract_version === 3)) === (v.result.kind === "guided-planning-v1"));
  assert((object(initial) && initial.contract_version === 3) === (v.result.provenance === "openai-guided-v1"));
  if (v.result.kind === "guided-planning-v1") {
    if (q.kind === "edit" || q.kind === "copy") {
      assert(sameJson(q.initial_request, v.initial_request));
      assert(sameJson(q.origin, v.origin));
      assert(q.kind !== "copy" || (object(v.origin) && v.origin.revision === q.base_revision));
      const target = guidedResources(parseResult(v.result)).find(x => x.key === q.resource_key)?.elements.find(x => x.key === q.element_key);
      assert(target && target.text === q.text);
    } else {
      assert(r.revision === 1 && v.result.duration_minutes === q.duration_minutes);
      assert(v.initial_request === undefined || sameJson(v.initial_request, q));
    }
  }
  assert(r.source_id !== null || (object(initial) && (initial.contract_version === 2 || initial.contract_version === 3)));
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
  validateAnalyticOrigin(v, v.initial_request);
  if (result.kind === "guided-planning-v1") assert(object(v.initial_request) && guidedRequest(v.initial_request));
  assert((object(v.initial_request) && v.initial_request.contract_version === 3) === (result.provenance === "openai-guided-v1"));
  assert(
    guidedResources(result).some(
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
  private analyticSection(value: unknown) {
    const doc = parseAnalyticSection(value);
    this.scoped(doc.receipt);
    return doc;
  }
  private checkAnalyticData(data: AnalyticSectionData) {
    if (!isAnalyticSectionData(data)) throw new ApiError(422, "invalid_request");
    if (new TextEncoder().encode(JSON.stringify(data)).length > MAX_ANALYTIC_DATA_BYTES)
      throw new ApiError(413, "content_too_large");
  }
  async chatAvailable(): Promise<boolean> {
    const value = await this.request("chat-capability");
    assert(object(value) && typeof value.available === "boolean");
    return value.available;
  }
  async activeConversation(): Promise<ChatDocument> {
    const doc = parseChatDocument(await this.request("active-conversation"));
    assert(doc.conversation.active);
    return doc;
  }
  async createConversation(key: string): Promise<ChatDocument> {
    const doc = parseChatDocument(await this.request("conversations", "POST", {}, key));
    assert(doc.conversation.active);
    return doc;
  }
  async conversationOperation(key: string): Promise<ChatDocument> {
    const doc = parseChatDocument(await this.request(`conversation-operations/${this.id(key)}`));
    assert(doc.conversation.active);
    return doc;
  }
  async readConversation(id: string, cursor?: string): Promise<ChatDocument> {
    if (cursor !== undefined && (!/^[1-9]\d*$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))) throw new ApiError(422, "invalid_request");
    const query = cursor === undefined ? "" : `?cursor=${cursor}&limit=20`;
    const doc = parseChatDocument(await this.request(`conversations/${this.id(id)}${query}`));
    assert(doc.conversation.id === id && (cursor === undefined || doc.turns.every(turn => turn.number < Number(cursor))));
    return doc;
  }
  async sendChatTurn(id: string, text: string, expected: number, key: string, contextRevision: number): Promise<ChatDocument> {
    if (chatTextError(text) || !Number.isInteger(expected) || expected < 0 || expected >= 2147483647 || !Number.isInteger(contextRevision) || contextRevision < 0)
      throw new ApiError(422, "invalid_request");
    const doc = parseChatDocument(await this.request(`conversations/${this.id(id)}/turns`, "POST", {text, expected_version: expected, expected_context_revision: contextRevision}, key, false, 32768));
    this.matchChatTurn(doc, id, key, text, expected, contextRevision);
    return doc;
  }
  async chatTurnOperation(id: string, key: string, text?: string, expected?: number, contextRevision?: number): Promise<ChatDocument> {
    const doc = parseChatDocument(await this.request(`conversations/${this.id(id)}/operations/${this.id(key)}`));
    this.matchChatTurn(doc, id, key, text, expected, contextRevision);
    return doc;
  }
  private matchChatTurn(doc: ChatDocument, id: string, key: string, text?: string, expected?: number, contextRevision?: number) {
    const turn = doc.turns[0];
    assert(doc.conversation.id === id && doc.turns.length === 1 && doc.next_cursor === null && turn.operation_id === key &&
      (text === undefined || turn.user_text === text) && (expected === undefined || turn.number === expected + 1) &&
      (contextRevision === undefined || turn.context_revision === contextRevision));
  }
  async readChatContextRevision(id: string, revision: number): Promise<ChatContextRevision> {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > 2147483647) throw new ApiError(422, "invalid_request");
    const receipt = parseChatContextRevision(await this.request(`conversations/${this.id(id)}/context-revisions/${revision}`));
    assert(receipt.conversation.id === id && receipt.context.revision === revision);
    return receipt;
  }
  async updateChatContext(id: string, notes: string, expected: number, contextRevision: number, key: string): Promise<ChatContextReceipt> {
    if (chatContextError(notes) || !Number.isInteger(expected) || expected < 0 || !Number.isInteger(contextRevision) || contextRevision < 0)
      throw new ApiError(422, "invalid_request");
    const receipt = parseChatContextReceipt(await this.request(`conversations/${this.id(id)}/context`, "POST",
      {notes, expected_version: expected, expected_context_revision: contextRevision}, key, false, 32768));
    this.matchChatContext(receipt, id, notes, expected, contextRevision, key);
    return receipt;
  }
  async chatContextOperation(id: string, notes: string, expected: number, contextRevision: number, key: string): Promise<ChatContextReceipt> {
    const receipt = parseChatContextReceipt(await this.request(`conversations/${this.id(id)}/context-operations/${this.id(key)}`));
    this.matchChatContext(receipt, id, notes, expected, contextRevision, key);
    return receipt;
  }
  private matchChatContext(receipt: ChatContextReceipt, id: string, notes: string, expected: number, contextRevision: number, key: string) {
    assert(receipt.conversation.id === id && receipt.context.operation_id === key && receipt.context.notes === notes &&
      receipt.context.through_turn === expected && receipt.context.previous_revision === contextRevision && receipt.context.revision === contextRevision + 1);
  }
  async listConversations(cursor?: string, limit = 50): Promise<Page<ConversationSummary>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ApiError(422, "invalid_request");
    const params = new URLSearchParams({limit: String(limit)});
    if (cursor !== undefined) params.set("cursor", this.id(cursor));
    const value = await this.request(`conversations?${params}`);
    assert(object(value) && Array.isArray(value.items) && value.items.length <= limit && (value.next_cursor === null || isUuid(value.next_cursor)));
    let previous = cursor?.toLowerCase() ?? "";
    const items = value.items.map(item => {
      const summary = parseConversationSummary(item), id = summary.id.toLowerCase();
      assert(id > previous);
      previous = id;
      return summary;
    });
    assert(value.next_cursor === null || (items.length > 0 && value.next_cursor === items.at(-1)!.id));
    return {items, next_cursor: value.next_cursor};
  }
  async createAnalyticSection(data: AnalyticSectionData, key: string) {
    this.checkAnalyticData(data);
    const doc = this.analyticSection(await this.request("analytic-sections", "POST", data, key));
    assert(doc.receipt.operation_id === key && doc.receipt.revision === 1 && sameJson(doc.data, data));
    return doc;
  }
  async saveAnalyticSection(id: string, expected: number, data: AnalyticSectionData, key: string) {
    this.checkAnalyticData(data);
    if (!positive(expected) || expected >= 2147483647) throw new ApiError(422, "invalid_request");
    const doc = this.analyticSection(await this.request(`analytic-sections/${this.id(id)}/revisions`, "POST", { contract_version: 1, expected_revision: expected, data }, key));
    assert(doc.receipt.section_id === id && doc.receipt.revision === expected + 1 && doc.receipt.operation_id === key && sameJson(doc.data, data));
    return doc;
  }
  async readAnalyticSection(id: string, revision?: number) {
    if (revision !== undefined && !positive(revision)) throw new ApiError(422, "invalid_request");
    const doc = this.analyticSection(await this.request(`analytic-sections/${this.id(id)}${revision === undefined ? "" : `/revisions/${revision}`}`));
    assert(doc.receipt.section_id === id && (revision === undefined || doc.receipt.revision === revision));
    return doc;
  }
  async analyticSectionOperation(key: string) {
    const doc = this.analyticSection(await this.request(`analytic-section-operations/${this.id(key)}`));
    assert(doc.receipt.operation_id === key);
    return doc;
  }
  async listAnalyticSections(cursor?: string, limit = 50, filters: AnalyticSectionFilters = {}): Promise<Page<AnalyticSectionDocument>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(422, "invalid_request");
    const params = new URLSearchParams();
    if (cursor !== undefined) params.set("after", this.id(cursor));
    params.set("limit", String(limit));
    for (const field of ["q", "grade", "formative_field"] as const) {
      const value = filters[field], maximum = { q: 200, grade: 80, formative_field: 120 }[field];
      if (value === undefined) continue;
      if (typeof value !== "string" || [...value].length > maximum || /[\u0000\uD800-\uDFFF]/u.test(value) || (field !== "q" && !value.trim()))
        throw new ApiError(422, "invalid_request");
      params.set(field, value);
    }
    const v = await this.request(`analytic-sections?${params}`);
    assert(object(v) && Array.isArray(v.items) && v.items.length <= limit && (v.next_cursor === null || isUuid(v.next_cursor)));
    let previous = cursor?.toLowerCase() ?? "";
    const items = v.items.map(value => {
      const doc = this.analyticSection(value), id = doc.receipt.section_id.toLowerCase();
      assert(id > previous);
      previous = id;
      return doc;
    });
    assert(v.next_cursor === null || (items.length > 0 && v.next_cursor === items.at(-1)!.receipt.section_id));
    return { items, next_cursor: v.next_cursor };
  }
  async deriveAnalyticPlanning(section: AnalyticSectionDocument, data: DeriveAnalyticPlanningRequest, key: string) {
    const { section_id: id, revision } = section.receipt;
    this.scoped(section.receipt);
    if (!positive(revision)) throw new ApiError(422, "invalid_request");
    const doc = this.planning(await this.request(`analytic-sections/${this.id(id)}/revisions/${revision}/plannings`, "POST", data, key, false, 4096));
    assert(doc.receipt.operation_id === key && doc.receipt.revision === 1 && sameJson(doc.analytic_origin, section) &&
      doc.request.contract_version === 2 && doc.request.subject === data.subject &&
      doc.request.duration_minutes === data.duration_minutes && doc.request.method === data.method);
    return doc;
  }
  async createSource(bytes: string, key: string) {
    return this.source(
      await this.request("sources", "POST", bytes, key, true),
      key,
    );
  }
  async reviseSource(
    sourceId: string,
    expected: number,
    bytes: string,
    key: string,
  ) {
    assert(positive(expected));
    const result = this.source(
      await this.request(
        `sources/${this.id(sourceId)}/versions?expected_version=${expected}`,
        "POST",
        bytes,
        key,
        true,
      ),
      key,
    );
    assert(result.source_id === sourceId && result.number === expected + 1);
    return result;
  }
  async original(ref: SourceReference): Promise<OriginalContent> {
    assert(positive(ref.number) && sha(ref.sha256));
    let response: Response;
    try {
      response = await this.transport(
        `/scopes/${this.session.scopeId}/sources/${this.id(ref.source_id)}/versions/${ref.number}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch {
      throw new ApiError(0, "original_read_failed");
    }
    if (!response.ok)
      throw new ApiError(response.status, "original_unavailable");
    const size = Number(response.headers.get("X-Content-Size"));
    assert(
      response.headers.get("X-Source-Id") === ref.source_id &&
        response.headers.get("X-Version") === String(ref.number) &&
        response.headers.get("X-Content-SHA256") === ref.sha256 &&
        response.headers.get("X-Actor-Id") === this.session.actorId &&
        Number.isInteger(size) &&
        size > 0 &&
        size <= 65536 &&
        (ref.size === undefined || ref.size === size),
    );
    const bytes = new Uint8Array(size);
    const reader = response.body?.getReader();
    assert(reader);
    let offset = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.length > size - offset) {
          await reader.cancel();
          throw new ApiError(0, "invalid_response");
        }
        bytes.set(value, offset);
        offset += value.length;
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, "original_read_failed");
    } finally {
      reader.releaseLock();
    }
    assert(offset === size);
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    assert(bytes.length === size && digest === ref.sha256);
    try {
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        size,
        sha256: digest,
      };
    } catch {
      throw new ApiError(0, "original_view_failed");
    }
  }
  async sourceOperation(key: string) {
    return this.source(await this.request(`operations/${this.id(key)}`), key);
  }
  async listSources(cursor?: string, limit = 50): Promise<Page<SourceReceipt>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ApiError(422, "invalid_request");
    const v = await this.request(
      `sources?${cursor === undefined ? "" : `after=${this.id(cursor)}&`}limit=${limit}`,
    );
    assert(
      object(v) && Array.isArray(v.items) && v.items.length <= limit &&
      (v.next_cursor === null || isUuid(v.next_cursor)),
    );
    let previous = cursor?.toLowerCase() ?? "";
    const items = v.items.map((value) => {
      const receipt = parseSource(value);
      this.scoped(receipt);
      assert(receipt.size > 0 && receipt.size <= 65536);
      // Source UUID order is the backend keyset contract, not creation-date order.
      const id = receipt.source_id.toLowerCase();
      assert(id > previous);
      previous = id;
      return receipt;
    });
    assert(v.next_cursor === null ||
      (items.length > 0 && v.next_cursor === items.at(-1)!.source_id));
    return { items, next_cursor: v.next_cursor };
  }
  async generationAvailable(): Promise<boolean> {
    const value = await this.request("planning-generation");
    assert(object(value) && typeof value.available === "boolean");
    return value.available;
  }
  async create(payload: CreationRequest, key: string) {
    return this.planning(
      await this.request(payload.contract_version === 3 ? "generated-plannings" : payload.contract_version === 2 ? "guided-plannings" : "plannings", "POST", payload, key, false, 4096),
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
  if (error.code === "generation_unavailable")
    return "La generación con IA no está disponible. No se inició un intento. Tus datos siguen aquí.";
  if (error.code === "generation_input_not_approved")
    return "Estos datos todavía no están habilitados para generar con IA. No se inició un intento. Tus datos siguen aquí.";
  if (error.code === "generation_budget_exhausted")
    return "No hay presupuesto disponible para esta generación. No se inició un intento. Tus datos siguen aquí.";
  if (error.code === "generation_busy")
    return "La generación con IA está en pausa. No se inició este intento. Tus datos siguen aquí.";
  if (error.code === "generation_pending")
    return "La generación sigue pendiente. Consulta su estado; no se enviará otro intento.";
  if (error.code === "generation_uncertain")
    return "No se pudo confirmar el resultado de la generación. Consulta su estado; no se enviará otro intento.";
  if (error.code === "generation_failed")
    return "La generación terminó sin un resultado utilizable. Tus datos siguen aquí. Puedes iniciar una nueva creación de forma explícita.";
  if (error.status === 409)
    return "Hay una versión o petición diferente. Conservamos tu texto; revisa el estado antes de continuar.";
  if (error.status === 422 && error.code === "unsupported_fixture")
    return "Este corte sólo admite el ejemplo y la petición de ajuste indicados. No genera respuestas libres.";
  if (error.status === 404)
    return "No pudimos recuperar este elemento. Su estado puede seguir pendiente.";
  if (error.status === 413)
    return "El contenido supera el límite permitido para esta petición. Tus datos siguen aquí.";
  if (error.status === 415) return "Este formato de envío no está admitido.";
  if (error.status === 422)
    return "Revisa los datos del ejemplo antes de continuar.";
  return "No pudimos confirmar la operación. Tu trabajo sigue aquí. Comprueba su estado antes de reintentar.";
}
