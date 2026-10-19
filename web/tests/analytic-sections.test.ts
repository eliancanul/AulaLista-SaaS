import { describe, expect, it, vi } from "vitest";
import { AcentaApi, ApiError, parseAnalyticSection, parseDraft, parsePlanning, type Transport } from "../src/acenta/api";
import { isAnalyticSectionData, prefillAnalyticPlanning, type AnalyticSectionDocument } from "../src/acenta/analytic-sections";
import { json, session, source } from "./acenta-fixtures";
import { guidedDraft, guidedPlanning, guidedRevised } from "./guided-fixtures";

const section = (): AnalyticSectionDocument => ({
  receipt: {
    contract_version: 1, namespace: "analytic-section-v1", section_id: crypto.randomUUID(),
    revision_id: crypto.randomUUID(), revision: 1, scope_id: session.scopeId, actor_id: session.actorId,
    operation_id: crypto.randomUUID(), created_at: "2026-10-18T13:00:00+00:00",
    source_id: null, source_version_id: null, source_version: null, source_sha256: null,
  },
  data: {
    contract_version: 1, name: "El cuidado del agua en la comunidad", grade: "3.º de primaria",
    period: "Octubre", context: { text: " Comunidad imaginaria sin datos personales. ", hypothetical: true },
    situation: " Situación hipotética sobre el uso del agua. ",
    entries: [{ content: " Usos cotidianos del agua. ", pda: " Describir acciones de cuidado. " }],
    formative_field: "Campo manual", articulating_axes: ["Eje manual"], language: "es", reference: null,
  },
  provenance: "manual-v1",
});
const derived = (origin = section(), key = crypto.randomUUID()) => ({
  ...guidedPlanning(key, { ...prefillAnalyticPlanning(origin), subject: "Ciencias naturales" }),
  analytic_origin: structuredClone(origin),
});
const transportFor = (value: unknown) => vi.fn<Transport>(async () => json(value));
// Wire mutations intentionally bypass compile-time DTO validation.
type Wire = Record<string, any>;
const wire = (value: unknown): Wire => structuredClone(value) as Wire;

describe("manual analytic section contract", () => {
  it("retains exact manual pairs, whitespace, absence and hypothetical context", () => {
    const doc = section();
    expect(parseAnalyticSection(doc)).toEqual(doc);
    expect(isAnalyticSectionData(doc.data)).toBe(true);
    expect(doc.data.reference).toBeNull();
    expect(doc.provenance).toBe("manual-v1");
  });
  it("prefills independently without presenting PDA as learning objectives", () => {
    const original = section(), before = structuredClone(original), form = prefillAnalyticPlanning(original);
    expect(form).toMatchObject({ subject: "", duration_minutes: 50, topic: original.data.name, learning_objectives: [] });
    expect(form.context).toEqual(original.data.context);
    form.context!.text = "Cambio para la clase";
    form.articulating_axes.push("Otro eje");
    expect(original).toEqual(before);
  });
  it("preserves the chosen exact admitted reference", () => {
    const doc = section();
    doc.data.reference = { source_id: source.source_id, source_version: source.number };
    Object.assign(doc.receipt, { source_id: source.source_id, source_version_id: source.version_id, source_version: source.number, source_sha256: source.sha256 });
    expect(parseAnalyticSection(doc)).toEqual(doc);
    const form = prefillAnalyticPlanning(doc);
    form.reference!.source_version++;
    expect(doc.data.reference.source_version).toBe(source.number);
    const bad = structuredClone(doc); bad.receipt.source_version!++;
    expect(() => parseAnalyticSection(bad)).toThrow(ApiError);
  });
  it.each([
    ["blank name", (d: Wire) => { d.data.name = "  "; }],
    ["oversized situation", (d: Wire) => { d.data.situation = "x".repeat(1001); }],
    ["missing period", (d: Wire) => { delete d.data.period; }],
    ["no pairs", (d: Wire) => { d.data.entries = []; }],
    ["too many pairs", (d: Wire) => { d.data.entries = Array(9).fill(d.data.entries[0]); }],
    ["missing PDA", (d: Wire) => { delete d.data.entries[0].pda; }],
    ["invented official authority", (d: Wire) => { d.data.entries[0].official = true; }],
    ["oversized content", (d: Wire) => { d.data.entries[0].content = "x".repeat(501); }],
    ["invalid Unicode", (d: Wire) => { d.data.name = "\ud800"; }],
    ["null character", (d: Wire) => { d.data.name = "a\0b"; }],
    ["missing hypothetical marker", (d: Wire) => { delete d.data.context.hypothetical; }],
    ["unexpected authority field", (d: Wire) => { d.data.official_source = "SEP"; }],
    ["wrong provenance", (d: Wire) => { d.provenance = "official"; }],
    ["partial reference", (d: Wire) => { d.receipt.source_id = source.source_id; }],
    ["wrong namespace", (d: Wire) => { d.receipt.namespace = "planning-v1"; }],
    ["malformed revision ID", (d: Wire) => { d.receipt.revision_id = "invalid"; }],
  ] as const)("rejects %s before creating an editable buffer", (_, mutate) => {
    const doc = wire(section()); mutate(doc);
    expect(() => parseAnalyticSection(doc)).toThrow(ApiError);
  });
});

describe("exact analytic origin on planning and B3", () => {
  it("retains the origin through independent editing, copying and drafting", () => {
    const base = derived(), original = structuredClone(base.analytic_origin);
    expect(parsePlanning(base)).toEqual(base);
    const edited = { ...guidedRevised(base, "Propósito corregido."), analytic_origin: original };
    const copy = { ...guidedRevised(edited, "Corrección de la copia.", undefined, true), analytic_origin: original };
    const draft = { ...guidedDraft(base, "Borrador propio."), analytic_origin: original };
    expect(parsePlanning(edited).analytic_origin).toEqual(original);
    expect(parsePlanning(copy).analytic_origin).toEqual(original);
    expect(parseDraft(draft).analytic_origin).toEqual(original);
    expect(copy.origin?.planning_id).toBe(base.receipt.planning_id);
    const newRevision = structuredClone(original);
    newRevision.receipt.revision++;
    newRevision.data.entries[0].pda = "Otro PDA manual";
    expect(base.analytic_origin).toEqual(original);
    expect(edited.analytic_origin).toEqual(original);
  });
  it.each(["grade", "topic", "language", "context", "learning_objectives", "formative_field", "articulating_axes", "reference"] as const)("rejects copied %s inconsistent with its exact origin", field => {
    const doc = wire(derived());
    doc.request[field] = field === "context" || field === "reference" ? null : field === "learning_objectives" || field === "articulating_axes" ? ["Otro"] : "Otro";
    if (field === "reference") doc.analytic_origin.data.reference = { source_id: source.source_id, source_version: 1 };
    expect(() => parsePlanning(doc)).toThrow(ApiError);
  });
  it.each(["scope_id", "actor_id"])("rejects another owner's %s in the origin", field => {
    const doc = wire(derived()); doc.analytic_origin.receipt[field] = crypto.randomUUID();
    expect(() => parsePlanning(doc)).toThrow(ApiError);
  });
  it("rejects an origin attached to a draft with incoherent initial fields", () => {
    const base = derived(), draft = { ...guidedDraft(base, "Borrador."), analytic_origin: base.analytic_origin };
    draft.analytic_origin = structuredClone(draft.analytic_origin);
    draft.analytic_origin.data.context!.hypothetical = false;
    expect(() => parseDraft(draft)).toThrow(ApiError);
  });
});

describe("analytic API transport and confirmation", () => {
  it("uses scoped same-origin creation with stable operation and exact confirmation", async () => {
    const doc = section(), transport = transportFor(doc), api = new AcentaApi(session, transport);
    expect(await api.createAnalyticSection(doc.data, doc.receipt.operation_id)).toEqual(doc);
    const [path, init] = transport.mock.calls[0];
    expect(path).toBe(`/scopes/${session.scopeId}/analytic-sections`);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    expect(new Headers(init!.headers).get("Idempotency-Key")).toBe(doc.receipt.operation_id);
    expect(JSON.parse(String(init!.body))).toEqual(doc.data);
    const wrong = structuredClone(doc); wrong.data.entries[0].pda = "Otro";
    await expect(new AcentaApi(session, transportFor(wrong)).createAnalyticSection(doc.data, doc.receipt.operation_id)).rejects.toThrow(ApiError);
  });
  it("sends CAS and restores the exact historical operation receipt", async () => {
    const doc = section(); doc.receipt.revision = 2;
    const transport = transportFor(doc), api = new AcentaApi(session, transport);
    await api.saveAnalyticSection(doc.receipt.section_id, 1, doc.data, doc.receipt.operation_id);
    expect(JSON.parse(String(transport.mock.calls[0][1]!.body))).toEqual({ contract_version: 1, expected_revision: 1, data: doc.data });
    expect(await api.analyticSectionOperation(doc.receipt.operation_id)).toEqual(doc);
    await expect(api.saveAnalyticSection(doc.receipt.section_id, 2, doc.data, doc.receipt.operation_id)).rejects.toThrow(ApiError);
  });
  it("requests the chosen revision and refuses a substituted current revision", async () => {
    const doc = section(), transport = transportFor(doc), api = new AcentaApi(session, transport);
    expect(await api.readAnalyticSection(doc.receipt.section_id, 1)).toEqual(doc);
    expect(transport.mock.calls[0][0]).toBe(`/scopes/${session.scopeId}/analytic-sections/${doc.receipt.section_id}/revisions/1`);
    await expect(api.readAnalyticSection(doc.receipt.section_id, 2)).rejects.toThrow(ApiError);
  });
  it("validates pagination, scope and cursor without admitting repeated sections", async () => {
    const doc = section();
    const api = new AcentaApi(session, transportFor({ items: [doc], next_cursor: doc.receipt.section_id }));
    expect((await api.listAnalyticSections()).items).toEqual([doc]);
    await expect(api.listAnalyticSections(doc.receipt.section_id)).rejects.toThrow(ApiError);
    const foreign = structuredClone(doc); foreign.receipt.scope_id = crypto.randomUUID();
    await expect(new AcentaApi(session, transportFor({ items: [foreign], next_cursor: null })).listAnalyticSections()).rejects.toThrow(ApiError);
  });
  it("derives through the origin endpoint with only class-specific missing fields", async () => {
    const original = section(), doc = derived(original), transport = transportFor(doc), api = new AcentaApi(session, transport);
    const request = { contract_version: 1 as const, subject: "Ciencias naturales", duration_minutes: 50, method: "active-learning" };
    expect(await api.deriveAnalyticPlanning(original, request, doc.receipt.operation_id)).toEqual(doc);
    expect(transport.mock.calls[0][0]).toBe(`/scopes/${session.scopeId}/analytic-sections/${original.receipt.section_id}/revisions/1/plannings`);
    expect(JSON.parse(String(transport.mock.calls[0][1]!.body))).toEqual(request);
    const substituted = structuredClone(doc); substituted.analytic_origin.receipt.revision++;
    await expect(new AcentaApi(session, transportFor(substituted)).deriveAnalyticPlanning(original, request, doc.receipt.operation_id)).rejects.toThrow(ApiError);
  });
  it("rejects oversized UTF-8 data before transport", async () => {
    const doc = section(), transport = transportFor(doc);
    doc.data.entries = Array.from({ length: 8 }, () => ({ content: "😀".repeat(500), pda: "😀".repeat(500) }));
    expect(isAnalyticSectionData(doc.data)).toBe(true);
    await expect(new AcentaApi(session, transport).createAnalyticSection(doc.data, doc.receipt.operation_id)).rejects.toMatchObject({ status: 413 });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([8000, 8001])("uses the same %i-byte data budget for creation and revision envelopes", async size => {
    const doc = section();
    doc.data.entries = Array.from({ length: 8 }, () => ({ content: "x".repeat(450), pda: "x".repeat(450) }));
    doc.data.situation = "x";
    const baseline = new TextEncoder().encode(JSON.stringify(doc.data)).length;
    doc.data.situation = "x".repeat(size - baseline + 1);
    expect(isAnalyticSectionData(doc.data)).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(doc.data)).length).toBe(size);
    const next = structuredClone(doc); next.receipt.revision = 2;
    next.receipt.operation_id = crypto.randomUUID();
    next.data.situation = "y".repeat(doc.data.situation.length);
    const transport = vi.fn<Transport>().mockResolvedValueOnce(json(doc)).mockResolvedValueOnce(json(next));
    const api = new AcentaApi(session, transport);
    if (size === 8000) {
      expect(await api.createAnalyticSection(doc.data, doc.receipt.operation_id)).toEqual(doc);
      expect(await api.saveAnalyticSection(doc.receipt.section_id, 1, next.data, next.receipt.operation_id)).toEqual(next);
      expect(new TextEncoder().encode(String(transport.mock.calls[1][1]!.body)).length).toBeLessThanOrEqual(8192);
    } else {
      await expect(api.createAnalyticSection(doc.data, doc.receipt.operation_id)).rejects.toMatchObject({ status: 413 });
      await expect(api.saveAnalyticSection(doc.receipt.section_id, 1, doc.data, doc.receipt.operation_id)).rejects.toMatchObject({ status: 413 });
      expect(transport).not.toHaveBeenCalled();
    }
  });
  it("preserves uncertainty after a lost save response and uses the same operation to recover", async () => {
    const doc = section(), transport = vi.fn<Transport>()
      .mockRejectedValueOnce(new Error("connection lost after commit"))
      .mockResolvedValueOnce(json(doc));
    const api = new AcentaApi(session, transport);
    await expect(api.createAnalyticSection(doc.data, doc.receipt.operation_id)).rejects.toMatchObject({ status: 0, uncertain: true });
    expect(await api.analyticSectionOperation(doc.receipt.operation_id)).toEqual(doc);
    expect(transport.mock.calls[1][0]).toBe(`/scopes/${session.scopeId}/analytic-section-operations/${doc.receipt.operation_id}`);
  });
});
