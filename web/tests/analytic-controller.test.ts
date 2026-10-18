import { describe, expect, it } from "vitest";
import { AcentaApi, type Transport } from "../src/acenta/api";
import { AnalyticSectionController } from "../src/acenta/analytic-controller";
import type { AnalyticSectionData, AnalyticSectionDocument } from "../src/acenta/analytic-sections";
import { json, session } from "./acenta-fixtures";

const sectionId = "70000000-0000-4000-8000-000000000007";
const data = (): AnalyticSectionData => ({
  contract_version: 1, name: "El cuidado del agua", grade: "3.º de primaria", period: "Octubre",
  context: { text: " Comunidad hipotética. ", hypothetical: true }, situation: " Cuidado cotidiano del agua. ",
  entries: [{ content: " Usos del agua. ", pda: " Proponer acciones. " }],
  formative_field: null, articulating_axes: [], language: "es", reference: null,
});
const document = (value: AnalyticSectionData, key: string, revision = 1, id = sectionId): AnalyticSectionDocument => ({
  receipt: {
    contract_version: 1, namespace: "analytic-section-v1", section_id: id,
    revision_id: crypto.randomUUID(), revision, scope_id: session.scopeId, actor_id: session.actorId,
    operation_id: key, created_at: "2026-10-18T13:00:00+00:00",
    source_id: null, source_version_id: null, source_version: null, source_sha256: null,
  },
  data: structuredClone(value), provenance: "manual-v1",
});
interface Call { path: string; method: string; key: string | null; body: unknown }
function setup(response: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const transport: Transport = async (input, init = {}) => {
    const call = {
      path: String(input).split(`/scopes/${session.scopeId}/`)[1], method: init.method ?? "GET",
      key: new Headers(init.headers).get("Idempotency-Key"),
      body: init.body ? JSON.parse(String(init.body)) as unknown : null,
    };
    calls.push(call);
    return response(call);
  };
  return { controller: new AnalyticSectionController(new AcentaApi(session, transport)), calls };
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}

describe("manual section editing through the public controller and HTTP client", () => {
  it("saves explicitly and submits a revision against the confirmed base", async () => {
    const { controller: c, calls } = setup(call => {
      const request = call.body as { expected_revision?: number; data?: AnalyticSectionData };
      return json(document(request.data ?? call.body as AnalyticSectionData, call.key!, request.expected_revision ? 2 : 1), 201);
    });
    c.setData(data());
    expect(calls).toHaveLength(0);
    expect(c.hasUnsavedChanges()).toBe(true);
    expect(await c.save()).toBe(true);
    expect(c.snapshot()).toMatchObject({ status: "saved", pending: null, document: { receipt: { revision: 1 } } });
    expect(c.hasUnsavedChanges()).toBe(false);
    c.setData({ ...c.snapshot().data, situation: "Otra situación manual." });
    expect(await c.save()).toBe(true);
    expect(calls[1]).toMatchObject({ path: `analytic-sections/${sectionId}/revisions`, body: { expected_revision: 1 } });
    expect(c.snapshot().document?.receipt.revision).toBe(2);
    expect(c.snapshot().data.context).toEqual({ text: " Comunidad hipotética. ", hypothetical: true });
  });
  it("keeps an uncertain save immutable and recovers its receipt before another write", async () => {
    let confirmed: AnalyticSectionDocument;
    const { controller: c, calls } = setup(call => {
      if (call.method === "POST") {
        confirmed = document(call.body as AnalyticSectionData, call.key!);
        throw Error("response lost after commit");
      }
      return json(confirmed);
    });
    c.setData(data());
    expect(await c.save()).toBe(false);
    const intent = c.snapshot().pending!;
    expect(c.snapshot().status).toBe("unknown");
    expect(c.setData({ ...data(), name: "Otro apartado" })).toBe(false);
    expect(Object.isFrozen(intent.data.entries[0])).toBe(true);
    expect(await c.recover()).toBe(true);
    expect(calls.map(call => call.path)).toEqual(["analytic-sections", `analytic-section-operations/${intent.key}`]);
    expect(c.snapshot().document?.receipt.operation_id).toBe(intent.key);
    expect(c.hasUnsavedChanges()).toBe(false);
  });
  it("replays only after an absent receipt using the identical key and payload", async () => {
    let first = true;
    const { controller: c, calls } = setup(call => {
      if (first) { first = false; throw Error("request never arrived"); }
      if (call.method === "GET") return json({ detail: "not_found" }, 404);
      return json(document(call.body as AnalyticSectionData, call.key!), 201);
    });
    c.setData(data());
    await c.save();
    expect(await c.recover()).toBe(true);
    expect(calls.map(call => call.method)).toEqual(["POST", "GET", "POST"]);
    expect(calls[2]).toEqual(calls[0]);
  });
  it.each([[413, "content_too_large", "error"], [422, "invalid_request", "error"], [409, "conflict", "conflict"]] as const)(
    "keeps changes and the original base on a certain %i rejection", async (status, code, expected) => {
      let reject = false;
      const { controller: c } = setup(call => reject ? json({ detail: code }, status)
        : json(document(call.body as AnalyticSectionData, call.key!), 201));
      c.setData(data());
      await c.save();
      const base = c.snapshot().document;
      c.setData({ ...data(), situation: "Texto que no debe perderse." });
      reject = true;
      expect(await c.save()).toBe(false);
      expect(c.snapshot()).toMatchObject({ status: expected, pending: null, data: { situation: "Texto que no debe perderse." } });
      expect(c.snapshot().document).toEqual(base);
      expect(c.hasUnsavedChanges()).toBe(true);
      expect(c.setData({ ...data(), situation: "Texto corregido." })).toBe(true);
    },
  );
  it.each(["suspend", "close"] as const)("rejects late save results and further work after %s", async action => {
    const gate = deferred();
    let confirmed: AnalyticSectionDocument;
    const { controller: c, calls } = setup(call => {
      if (call.method === "GET") return json(confirmed);
      confirmed = document(call.body as AnalyticSectionData, call.key!);
      return gate.promise;
    });
    c.setData(data());
    const saving = c.save();
    c[action]();
    gate.resolve(json(confirmed!, 201));
    expect(await saving).toBe(false);
    expect(c.snapshot().document).toBeNull();
    expect(c.setData(data())).toBe(false);
    expect(await c.save()).toBe(false);
    expect(await c.recover()).toBe(false);
    expect(calls).toHaveLength(1);
    if (action === "suspend") {
      expect(c.snapshot().status).toBe("unknown");
      expect(c.hasUnsavedChanges()).toBe(true);
      c.resume();
      expect(await c.recover()).toBe(true);
    } else {
      expect(c.hasUnsavedChanges()).toBe(false);
      c.resume();
      expect(c.setData(data())).toBe(false);
    }
  });
  it("opens confirmed sections without replacing dirty or uncertain work implicitly", async () => {
    const saved = document(data(), crypto.randomUUID(), 4);
    const { controller: c, calls } = setup(call => {
      if (call.method === "POST") throw Error("uncertain write");
      return json(saved);
    });
    expect(await c.open(sectionId)).toBe(true);
    expect(c.snapshot()).toMatchObject({ status: "clean", document: { receipt: { revision: 4 } } });
    c.setData({ ...data(), name: "Mi edición pendiente" });
    expect(c.reset()).toBe(false);
    expect(await c.open(sectionId)).toBe(false);
    expect(calls).toHaveLength(1);
    expect(c.snapshot().data.name).toBe("Mi edición pendiente");
    expect(c.discardChanges()).toBe(true);
    expect(await c.open(sectionId)).toBe(true);
    c.setData({ ...data(), name: "Intento sin confirmar" });
    await c.save();
    expect(c.discardChanges()).toBe(false);
    expect(c.reset()).toBe(false);
    expect(await c.open(sectionId)).toBe(false);
    expect(c.snapshot().data.name).toBe("Intento sin confirmar");
    expect(c.snapshot().pending).not.toBeNull();
  });
  it.each(["data", "section", "revision"] as const)("rejects a recovered receipt with substituted %s", async field => {
    let saved: AnalyticSectionDocument;
    const { controller: c } = setup(call => {
      if (call.path === "analytic-sections") return json(document(call.body as AnalyticSectionData, call.key!), 201);
      if (call.method === "POST") {
        saved = document((call.body as { data: AnalyticSectionData }).data, call.key!, 2);
        throw Error("response lost");
      }
      const wrong = structuredClone(saved);
      if (field === "data") wrong.data.name = "Respuesta de otra petición";
      if (field === "section") wrong.receipt.section_id = crypto.randomUUID();
      if (field === "revision") wrong.receipt.revision = 3;
      return json(wrong);
    });
    c.setData(data());
    await c.save();
    c.setData({ ...data(), name: "Mi revisión" });
    await c.save();
    const intent = c.snapshot().pending;
    expect(await c.recover()).toBe(false);
    expect(c.snapshot()).toMatchObject({ status: "unknown", pending: intent, document: { receipt: { revision: 1 } }, data: { name: "Mi revisión" } });
  });
  it("does not write twice when saving an unchanged confirmed section", async () => {
    const { controller: c, calls } = setup(call => json(document(call.body as AnalyticSectionData, call.key!), 201));
    c.setData(data());
    expect(await c.save()).toBe(true);
    expect(await c.save()).toBe(true);
    c.setData({ ...data(), name: "Cambio temporal" });
    c.setData(data());
    expect(c.snapshot().status).toBe("clean");
    expect(await c.save()).toBe(true);
    expect(calls).toHaveLength(1);
  });
  it.each([[409, "conflict", "conflict"], [422, "unchanged_text", "error"]] as const)(
    "releases uncertainty after a replay-first %i business rejection", async (status, code, expected) => {
      let attempt = 0;
      const saved = document(data(), crypto.randomUUID());
      const { controller: c, calls } = setup(call => {
        if (call.path === `analytic-sections/${sectionId}`) return json(saved);
        if (call.method === "GET") return json({ detail: "not_found" }, 404);
        if (++attempt === 1) throw Error("request not delivered");
        return json({ detail: code }, status);
      });
      await c.open(sectionId);
      c.setData({ ...data(), name: "Mi revisión" });
      await c.save();
      const key = c.snapshot().pending?.key;
      expect(await c.recover()).toBe(false);
      expect(c.snapshot()).toMatchObject({ status: expected, pending: null, data: { name: "Mi revisión" } });
      expect(calls.at(-1)?.key).toBe(key);
    },
  );
  it("serializes double submits and preserves the captured input", async () => {
    const gate = deferred();
    const { controller: c, calls } = setup(() => gate.promise);
    const input = data();
    c.setData(input);
    input.entries[0].pda = "Mutación posterior del llamador";
    const first = c.save();
    expect(await c.save()).toBe(false);
    expect(await c.recover()).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual(data());
    gate.resolve(json(document(data(), calls[0].key!), 201));
    expect(await first).toBe(true);
  });
  it.each([413, 422, 503])("keeps an existing uncertain operation after replay returns %i before confirmation", async status => {
    let first = true;
    const { controller: c, calls } = setup(call => {
      if (first) { first = false; throw Error("unknown delivery"); }
      if (call.method === "GET") return json({ detail: "not_found" }, 404);
      return json({ detail: "invalid_request" }, status);
    });
    c.setData(data());
    await c.save();
    const intent = c.snapshot().pending;
    expect(await c.recover()).toBe(false);
    expect(c.snapshot()).toMatchObject({ status: "unknown", pending: intent });
    expect(calls).toHaveLength(3);
  });
  it("does not replay when the receipt lookup itself is unavailable", async () => {
    const { controller: c, calls } = setup(() => json({ detail: "unavailable" }, 503));
    c.setData(data());
    await c.save();
    const intent = c.snapshot().pending;
    expect(await c.recover()).toBe(false);
    expect(c.snapshot().pending).toEqual(intent);
    expect(calls.map(call => call.method)).toEqual(["POST", "GET"]);
  });
  it("does not replay a missing receipt after session suspension", async () => {
    const gate = deferred();
    const { controller: c, calls } = setup(call => {
      if (call.method === "GET") return gate.promise;
      throw Error("unknown delivery");
    });
    c.setData(data());
    await c.save();
    const recovering = c.recover();
    c.suspend();
    gate.resolve(json({ detail: "not_found" }, 404));
    expect(await recovering).toBe(false);
    expect(calls.map(call => call.method)).toEqual(["POST", "GET"]);
    expect(c.snapshot().pending).not.toBeNull();
  });
  it.each(["invalid", "oversized"] as const)("keeps %s data editable after local validation without HTTP", async kind => {
    const { controller: c, calls } = setup(() => { throw Error("must not send"); });
    const input = data();
    if (kind === "invalid") input.name = " ";
    else input.entries = Array.from({ length: 8 }, () => ({ content: "😀".repeat(500), pda: "😀".repeat(500) }));
    c.setData(input);
    expect(await c.save()).toBe(false);
    expect(calls).toHaveLength(0);
    expect(c.snapshot()).toMatchObject({ status: "error", pending: null, data: input });
    expect(c.setData(data())).toBe(true);
  });
  it.each(["suspend", "close"] as const)("blocks buffer replacement during an open and rejects its result after %s", async action => {
    const gate = deferred();
    const { controller: c, calls } = setup(() => gate.promise);
    const opening = c.open(sectionId);
    expect(c.snapshot().loading).toBe(true);
    expect(c.setData(data())).toBe(false);
    expect(c.reset()).toBe(false);
    expect(await c.save()).toBe(false);
    c[action]();
    gate.resolve(json(document(data(), crypto.randomUUID())));
    expect(await opening).toBe(false);
    expect(c.snapshot().loading).toBe(false);
    expect(c.snapshot().document).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
