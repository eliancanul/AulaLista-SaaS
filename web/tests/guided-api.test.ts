import { describe, expect, it, vi } from "vitest";
import { AcentaApi, ApiError, parseDraft, parsePlanning, parseResult, type Transport } from "../src/acenta/api";
import type { CopyRequest, EditRequest, PlanningRequest } from "../src/acenta/contracts";
import { json, planning, session, source } from "./acenta-fixtures";
import { guidedDraft, guidedPlanning, guidedRequest, guidedRevised } from "./guided-fixtures";

// Deliberately untyped wire values test rejection, rather than static DTO checking.
type Wire = Record<string, any>;
const wire = (value: unknown): Wire => JSON.parse(JSON.stringify(value));
const referenced = () => guidedPlanning(undefined, guidedRequest({ reference: { source_id: source.source_id, source_version: source.number } }));
const invalid = (value: unknown) => expect(() => parsePlanning(value)).toThrowError(ApiError);
const transportFor = (value: unknown) => vi.fn<Transport>(async () => json(value));

describe("guided result and planning parser", () => {
  it("round-trips the Python fixture without a source or duplicated resources", () => {
    const doc = guidedPlanning(), before = structuredClone(doc);
    expect(parsePlanning(wire(doc))).toEqual(before);
    expect(parseResult(wire(doc.result))).toEqual(doc.result);
    expect(doc).toEqual(before);
    expect(doc.receipt).toMatchObject({ source_id: null, source_version_id: null, source_version: null, source_sha256: null });
    expect(doc.result).not.toHaveProperty("resources");
    expect(doc.request).not.toHaveProperty("source_id");
  });
  it.each([15, 30, 50, 73, 100, 120, 150, 180])("accepts coherent creation of %i minutes", duration => {
    const doc = guidedPlanning(undefined, guidedRequest({ duration_minutes: duration }));
    expect(parsePlanning(doc)).toEqual(doc);
    expect(doc.result.activities.reduce((sum, a) => sum + a.minutes, 0)).toBe(duration);
  });
  it.each([true, false, null])("preserves manual inputs and hypothetical condition %s", hypothetical => {
    const input = guidedRequest({
      context: hypothetical === null ? null : { text: "  Contexto manual sin datos reales.  ", hypothetical },
      learning_objectives: ["  Objetivo propio.  "], formative_field: "  Campo manual.  ", articulating_axes: ["  Eje manual.  "],
    });
    expect(parsePlanning(guidedPlanning(undefined, input)).request).toEqual(input);
  });
  it("retains an admitted exact reference and original hash", () => {
    const doc = referenced();
    expect(parsePlanning(doc)).toEqual(doc);
    expect(doc.receipt).toMatchObject({ source_id: source.source_id, source_version_id: source.version_id, source_version: source.number, source_sha256: source.sha256 });
  });
  const malformed: [string, (d: Wire) => void][] = [
    ["missing guided kind", d => { delete d.result.kind; }],
    ["unknown kind", d => { d.result.kind = "universal-planning"; }],
    ["missing purpose", d => { delete d.result.purpose; }],
    ["blank purpose", d => { d.result.purpose = " "; }],
    ["missing assessment", d => { delete d.result.formative_assessment; }],
    ["blank assessment", d => { d.result.formative_assessment = " "; }],
    ["blank title", d => { d.result.title = " "; }],
    ["blank notice", d => { d.result.notice = " "; }],
    ["missing materials", d => { delete d.result.materials; }],
    ["null materials", d => { d.result.materials = null; }],
    ["empty materials", d => { d.result.materials = []; }],
    ["blank material", d => { d.result.materials[0] = " "; }],
    ["empty activities", d => { d.result.activities = []; d.result.duration_minutes = 0; }],
    ["missing activity", d => { d.result.duration_minutes -= d.result.activities.pop().minutes; }],
    ["extra activity", d => { d.result.activities.push({ key: "fourth", title: "Otro", statement: "Otro", minutes: 1 }); d.result.duration_minutes++; }],
    ["unknown activity key", d => { d.result.activities[0].key = "other"; }],
    ["duplicate activity key", d => { d.result.activities[1].key = "introduction"; }],
    ["wrong activity order", d => { d.result.activities.reverse(); }],
    ["blank activity title", d => { d.result.activities[0].title = " "; }],
    ["blank activity statement", d => { d.result.activities[0].statement = " "; }],
    ["zero minutes", d => { d.result.duration_minutes -= d.result.activities[0].minutes; d.result.activities[0].minutes = 0; }],
    ["minutes beyond edit limit", d => { d.result.duration_minutes += 181 - d.result.activities[0].minutes; d.result.activities[0].minutes = 181; }],
    ["string minutes", d => { d.result.activities[0].minutes = "10"; }],
    ["fractional minutes", d => { d.result.activities[0].minutes = 10.5; d.result.duration_minutes = 50.5; }],
    ["duration sum mismatch", d => { d.result.duration_minutes++; }],
    ["initial duration mismatch", d => { d.request.duration_minutes = 30; }],
    ["unexpected creation revision", d => { d.receipt.revision = 2; }],
    ["duplicate resource representation", d => { d.result.resources = planning().result.resources; }],
    ["legacy result context on guided result", d => { d.result.context = { level: "Primaria", group: "Real", subject: "Ciencias" }; }],
    ["manual context without condition", d => { delete d.request.context.hypothetical; }],
    ["manual context with string condition", d => { d.request.context.hypothetical = "true"; }],
    ["empty manual context", d => { d.request.context.text = " "; }],
    ["overlong manual context", d => { d.request.context.text = "x".repeat(1001); }],
    ["invalid Unicode context", d => { d.request.context.text = "\ud800"; }],
    ["NULL character in context", d => { d.request.context.text = "a\0b"; }],
    ["empty objective", d => { d.request.learning_objectives = [" "]; }],
    ["too many objectives", d => { d.request.learning_objectives = Array(6).fill("x"); }],
    ["empty manual field", d => { d.request.formative_field = ""; }],
    ["too many axes", d => { d.request.articulating_axes = Array(8).fill("x"); }],
    ["unsupported version", d => { d.request.contract_version = 3; }],
    ["invalid fixture", d => { d.request.fixture_context = "universal"; }],
    ["missing duration", d => { delete d.request.duration_minutes; }],
    ["string duration", d => { d.request.duration_minutes = "50"; }],
    ["duration below interval", d => { d.request.duration_minutes = 14; }],
    ["duration above interval", d => { d.request.duration_minutes = 181; }],
  ];
  it.each(malformed)("rejects %s", (_, mutate) => { const doc = wire(guidedPlanning()); mutate(doc); invalid(doc); });
  it.each(["source_id", "source_version_id", "source_version", "source_sha256"])("rejects partially missing reference field %s", field => {
    const doc = wire(referenced()); doc.receipt[field] = null; invalid(doc);
  });
  it.each([
    ["different source", (d: Wire) => { d.request.reference.source_id = crypto.randomUUID(); }],
    ["different version", (d: Wire) => { d.request.reference.source_version++; }],
    ["absent reference", (d: Wire) => { d.request.reference = null; }],
    ["invalid hash", (d: Wire) => { d.receipt.source_sha256 = "fake"; }],
    ["version beyond backend bound", (d: Wire) => { d.request.reference.source_version = 2147483647; d.receipt.source_version = 2147483647; }],
  ] as const)("rejects incoherent reference: %s", (_, mutate) => { const doc = wire(referenced()); mutate(doc); invalid(doc); });
  it("rejects a guided result under legacy creation metadata", () => {
    const doc = planning(); doc.result = guidedPlanning().result; invalid(doc);
  });
});

describe("guided B3 parser", () => {
  it.each([
    ["planning", "purpose", "Propósito editado."], ["planning", "formative_assessment", "Evaluación editada."],
    ["planning", "material-0", "Material editado."], ["activity:introduction", "statement", "Actividad editada."],
    ["activity:exploration", "minutes", "45"],
  ])("retains initial metadata for canonical target %s/%s", (resource, element, text) => {
    const base = guidedPlanning(), edited = guidedRevised(base, text, undefined, false, resource, element);
    expect(parsePlanning(edited)).toEqual(edited);
    expect(edited.initial_request).toEqual(base.request);
    expect(wire(edited.request).initial_request).toEqual(base.request);
    expect(base.result.duration_minutes).toBe(50);
  });
  it("compares repeated metadata semantically regardless of JSON object key order", () => {
    const doc = wire(guidedRevised(referenced(), "Propósito editado."));
    doc.request.initial_request = Object.fromEntries(Object.entries(doc.request.initial_request).reverse());
    doc.request.initial_request.context = Object.fromEntries(Object.entries(doc.request.initial_request.context).reverse());
    expect(parsePlanning(doc)).toEqual(doc);
  });
  it("allows edited duration to differ from original form, at both edit bounds", () => {
    const initial = guidedPlanning(); let current = initial;
    for (const minutes of ["1", "180"]) for (const key of ["introduction", "exploration", "closure"]) {
      current = guidedRevised(current, minutes, undefined, false, `activity:${key}`, "minutes");
      expect(parsePlanning(current)).toEqual(current);
      expect(current.initial_request).toEqual(initial.request);
    }
    expect(current.result.duration_minutes).toBe(540);
  });
  it.each([false, true])("retains copy origin and manual context with reference=%s", reference => {
    const base = reference ? referenced() : guidedPlanning(), edited = guidedRevised(base, "Primero.");
    const copy = guidedRevised(edited, "Copia.", undefined, true);
    expect(parsePlanning(copy)).toEqual(copy);
    expect(copy.receipt.planning_id).not.toBe(base.receipt.planning_id);
    expect(copy.origin).toEqual({ planning_id: edited.receipt.planning_id, revision_id: edited.receipt.revision_id, revision: edited.receipt.revision });
    expect(copy.initial_request).toEqual(base.request);
    expect(parsePlanning(guidedRevised(copy, "Corrección de copia."))).toMatchObject({ origin: copy.origin });
  });
  const incoherent: [string, (d: Wire) => void][] = [
    ["missing initial request", d => { delete d.initial_request; delete d.request.initial_request; }],
    ["malformed initial context", d => { d.initial_request.context.hypothetical = "true"; }],
    ["mismatched nested context", d => { d.request.initial_request.context.hypothetical = false; }],
    ["mismatched patch text", d => { d.result.purpose = "Otro texto."; }],
    ["unknown resource", d => { d.request.resource_key = "made-up"; }],
    ["unknown element", d => { d.request.element_key = "made-up"; }],
    ["incorrect CAS revision", d => { d.receipt.revision++; }],
  ];
  it.each(incoherent)("rejects referenced edit with %s", (_, mutate) => {
    const doc = wire(guidedRevised(referenced(), "Propósito editado.")); mutate(doc); invalid(doc);
  });
  it.each([
    ["different origin revision", (d: Wire) => { d.origin.revision++; }],
    ["different nested origin", (d: Wire) => { d.request.origin.revision_id = crypto.randomUUID(); }],
  ] as const)("rejects copy with %s", (_, mutate) => {
    const doc = wire(guidedRevised(guidedPlanning(), "Copia.", undefined, true)); mutate(doc); invalid(doc);
  });
  it.each([false, true])("reads guided draft with metadata and reference=%s", reference => {
    const base = reference ? referenced() : guidedPlanning(), draft = guidedDraft(base, "Borrador manual.");
    expect(parseDraft(draft)).toEqual(draft);
    expect(draft.initial_request).toEqual(base.request);
    const wrong = wire(draft); wrong.result.purpose = "Otra propuesta.";
    expect(() => parseDraft(wrong)).toThrowError(ApiError);
  });
});

describe("guided AcentaApi", () => {
  it("sends v2 to its endpoint with safe transport and no source upload", async () => {
    const key = crypto.randomUUID(), input = guidedRequest(), doc = guidedPlanning(key, input), transport = transportFor(doc);
    expect(await new AcentaApi(session, transport).create(input, key)).toEqual(doc);
    expect(transport).toHaveBeenCalledTimes(1);
    const [path, init] = transport.mock.calls[0];
    expect(path).toBe(`/scopes/${session.scopeId}/guided-plannings`);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init!.headers).get("Idempotency-Key")).toBe(key);
    expect(JSON.parse(String(init!.body))).toEqual(input);
    expect(Object.keys(init!.headers!)).toEqual(["Idempotency-Key", "Content-Type"]);
  });
  it("keeps the legacy v1 creation endpoint", async () => {
    const doc = planning(), transport = transportFor(doc);
    await new AcentaApi(session, transport).create(doc.request as PlanningRequest, doc.receipt.operation_id);
    expect(transport.mock.calls[0][0]).toBe(`/scopes/${session.scopeId}/plannings`);
  });
  it.each([false, true])("reads and recovers exact saved planning with reference=%s", async reference => {
    const doc = reference ? referenced() : guidedPlanning(), transport = transportFor(doc), api = new AcentaApi(session, transport);
    expect(await api.read(doc.receipt.planning_id)).toEqual(doc);
    expect(await api.read(doc.receipt.planning_id, 1)).toEqual(doc);
    expect(await api.operation(doc.receipt.operation_id)).toEqual(doc);
    expect(transport.mock.calls.map(call => call[0])).toEqual([
      `/scopes/${session.scopeId}/plannings/${doc.receipt.planning_id}`,
      `/scopes/${session.scopeId}/plannings/${doc.receipt.planning_id}/revisions/1`,
      `/scopes/${session.scopeId}/planning-operations/${doc.receipt.operation_id}`,
    ]);
  });
  it("lists both guided variants beside B2", async () => {
    const items = [guidedPlanning(), referenced(), planning()];
    expect(await new AcentaApi(session, async () => json({ items, next_cursor: null })).list()).toEqual({ items, next_cursor: null });
  });
  it.each(["scope_id", "actor_id"])("rejects foreign %s for source-less planning", async field => {
    const doc = wire(guidedPlanning()); doc.receipt[field] = crypto.randomUUID();
    await expect(new AcentaApi(session, async () => json(doc)).read(doc.receipt.planning_id)).rejects.toThrowError(ApiError);
    await expect(new AcentaApi(session, async () => json({ items: [doc], next_cursor: null })).list()).rejects.toThrowError(ApiError);
  });
  it("rejects wrong read identity, revision and recovery operation", async () => {
    const doc = guidedPlanning(), api = new AcentaApi(session, async () => json(doc));
    await expect(api.read(crypto.randomUUID())).rejects.toThrowError(ApiError);
    await expect(api.read(doc.receipt.planning_id, 2)).rejects.toThrowError(ApiError);
    await expect(api.operation(crypto.randomUUID())).rejects.toThrowError(ApiError);
  });
  it("rejects more than 4096 UTF-8 bytes before transport", async () => {
    const input = guidedRequest({ context: { text: "🧪".repeat(950), hypothetical: true } }), transport = transportFor(guidedPlanning());
    expect(new TextEncoder().encode(JSON.stringify(input)).length).toBeGreaterThan(4096);
    await expect(new AcentaApi(session, transport).create(input, crypto.randomUUID())).rejects.toMatchObject({ status: 413, code: "content_too_large" });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([401, 404, 409, 413, 422, 503])("retains HTTP %i and the submitted form", async status => {
    const input = guidedRequest(), before = structuredClone(input);
    const api = new AcentaApi(session, async () => json({ detail: status === 422 ? "unsupported_fixture" : "unavailable" }, status));
    await expect(api.create(input, crypto.randomUUID())).rejects.toMatchObject({ status });
    expect(input).toEqual(before);
  });
  it("keeps network loss uncertain and recovers the same operation", async () => {
    const input = guidedRequest(), key = crypto.randomUUID(), saved = guidedPlanning(key, input);
    const transport = vi.fn<Transport>(async path => {
      if (String(path).endsWith("guided-plannings")) throw new Error("synthetic transport loss");
      return json(saved);
    });
    const api = new AcentaApi(session, transport);
    await expect(api.create(input, key)).rejects.toMatchObject({ status: 0, code: "unconfirmed", uncertain: true });
    expect(await api.operation(key)).toEqual(saved);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("uses existing edit/copy/draft routes and accepts durable guided replies", async () => {
    const base = guidedPlanning(), edited = guidedRevised(base, "Editado."), copy = guidedRevised(base, "Copiado.", undefined, true), draft = guidedDraft(base, "Borrador.");
    const responses: unknown[] = [edited, copy, draft, draft, draft, { items: [draft], next_cursor: null }];
    const api = new AcentaApi(session, async () => json(responses.shift()));
    const editInput: EditRequest = { contract_version: 1, expected_revision: 1, resource_key: "planning", element_key: "purpose", text: "Editado." };
    const copyInput: CopyRequest = { contract_version: 1, base_revision: 1, resource_key: "planning", element_key: "purpose", text: "Copiado." };
    expect(await api.save(base.receipt.planning_id, editInput, edited.receipt.operation_id)).toEqual(edited);
    expect(await api.copy(base.receipt.planning_id, copyInput, copy.receipt.operation_id)).toEqual(copy);
    expect(await api.draft(base.receipt.planning_id, draft.receipt.draft_id, draft.request, draft.receipt.operation_id)).toEqual(draft);
    expect(await api.readDraft(draft.receipt.draft_id)).toEqual(draft);
    expect(await api.draftOperation(draft.receipt.operation_id)).toEqual(draft);
    expect(await api.listDrafts()).toEqual({ items: [draft], next_cursor: null });
  });
});
