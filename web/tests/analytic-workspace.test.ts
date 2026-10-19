import { describe, expect, it } from "vitest";
import { AcentaController } from "../src/acenta/controller";
import { AcentaApi } from "../src/acenta/api";
import { json, session, workspaceId } from "./acenta-fixtures";
import { AnalyticServer } from "./analytic-server";
import { explorerSection } from "./analytic-explorer-fixtures";
import { guidedExample } from "../src/acenta/guided-planning";
import { guidedPlanning, guidedRevised } from "./guided-fixtures";

function setup() {
  const server = new AnalyticServer();
  const section = server.putSection(explorerSection(1, "El cuidado del agua en la comunidad"));
  const controller = new AcentaController(new AcentaApi(session, server.transport), null, workspaceId);
  return { server, section, controller };
}
function prepare(c: AcentaController) {
  c.analyticDerivation.setData({ contract_version: 1, subject: "Ciencias naturales", duration_minutes: 50, method: "active-learning" });
}
describe("analytic workspace integration", () => {
  it("keeps the independent guided form and manual editor when using an exact selected revision", async () => {
    const { controller: c, section } = setup();
    c.setGuided(guidedExample());
    c.analytic.setData({ ...section.data, name: "Unsaved independent text" });
    const manual = structuredClone(c.analytic.snapshot());
    const guided = structuredClone(c.snapshot().guided);
    await c.analyticExplorer.open();
    expect(c.useAnalyticSection(section)).toBe(true);
    expect(c.analyticExplorer.snapshot().open).toBe(false);
    expect(c.snapshot().view).toBe("planning");
    prepare(c);
    expect(await c.submitDerived()).toBe(true);
    expect(c.snapshot().result?.analytic_origin).toEqual(section);
    expect(c.snapshot().items).toHaveLength(1);
    expect(c.snapshot().view).toBe("result");
    expect(c.snapshot().guided).toEqual(guided);
    expect(c.analytic.snapshot()).toEqual(manual);
    expect(c.analyticDerivation.cancel()).toBe(true);
    expect(c.snapshot().guided).toEqual(guided);
  });
  it("does not jump back when confirmation arrives after explicit navigation", async () => {
    const { controller: c, server, section } = setup();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    server.after = async (call, response) => { if (call.path.endsWith("/plannings")) await gate; return response; };
    c.useAnalyticSection(section); prepare(c);
    const task = c.submitDerived();
    c.navigate("resources");
    release();
    expect(await task).toBe(true);
    expect(c.snapshot().view).toBe("resources");
    expect(c.snapshot().result).toBeNull();
    expect(c.snapshot().items[0].analytic_origin).toEqual(section);
  });
  it.each(["suspend", "closeSession"] as const)("rejects late derivation and clears private explorer on %s", async action => {
    const { controller: c, server, section } = setup();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    server.after = async (call, response) => { if (call.path.endsWith("/plannings")) await gate; return response; };
    c.useAnalyticSection(section); prepare(c);
    const task = c.submitDerived();
    await c.analyticExplorer.open();
    c[action]();
    release();
    expect(await task).toBe(false);
    expect(c.snapshot().items).toHaveLength(0);
    expect(c.analyticExplorer.snapshot().items).toEqual([]);
    expect(c.useAnalyticSection(section)).toBe(false);
    c.resume();
    if (action === "suspend") {
      expect(await c.submitDerived(true)).toBe(true);
      expect(c.snapshot().result?.analytic_origin).toEqual(section);
    } else expect(c.analyticDerivation.snapshot().origin).toBeNull();
  });
  it("preserves the exact origin through result edits, copies and private drafts", async () => {
    const { controller: c, server, section } = setup();
    c.useAnalyticSection(section); prepare(c);
    await c.submitDerived();
    const api = new AcentaApi(session, server.transport), doc = c.snapshot().result!;
    const edit = await api.save(doc.receipt.planning_id, { contract_version: 1, expected_revision: 1, resource_key: "planning", element_key: "purpose", text: "Changed class purpose" }, crypto.randomUUID());
    const copy = await api.copy(doc.receipt.planning_id, { contract_version: 1, base_revision: 2, resource_key: "planning", element_key: "purpose", text: "Copy purpose" }, crypto.randomUUID());
    const draft = await api.draft(doc.receipt.planning_id, crypto.randomUUID(), { contract_version: 1, base_revision: 2, expected_draft_revision: 0, resource_key: "planning", element_key: "purpose", text: "Private draft" }, crypto.randomUUID());
    for (const saved of [edit, copy, draft]) expect(saved.analytic_origin).toEqual(section);
    expect(server.sections.get(section.receipt.section_id)).toEqual(section);
  });
});

it("registers exit-guard recovery in a loaded library without navigating or resuming logout", async () => {
  const { controller: c, server, section } = setup();
  await c.loadResources();
  expect(c.snapshot()).toMatchObject({ listState: "ready", items: [] });
  c.useAnalyticSection(section); prepare(c);
  server.after = async (call, response) => { if (call.path.endsWith("/plannings") && call.method === "POST") throw Error("lost after commit"); return response; };
  expect(await c.submitDerived()).toBe(false);
  expect(server.docs.size).toBe(1);
  server.after = null;
  // The exit guard must retain its own explicit continuation and still register the document.
  expect(await c.submitDerived(true, false)).toBe(true);
  expect(c.snapshot()).toMatchObject({ view: "planning", closed: false, listState: "ready", result: null });
  expect(c.snapshot().items).toHaveLength(1);
  c.navigate("resources");
  expect(c.snapshot().items[0].analytic_origin).toEqual(section);
  expect(server.calls.filter(call => call.path.endsWith("/plannings") && call.method === "POST")).toHaveLength(1);
});

it.each([false, true])("keeps a derivation confirmed after an older list started (page has newer revision: %s)", async newerRevision => {
  const server = new AnalyticServer(), section = server.putSection(explorerSection(1, "El cuidado del agua en la comunidad"));
  let releasePost!: () => void, releaseList!: () => void, listStarted!: () => void;
  const postGate = new Promise<void>(resolve => { releasePost = resolve; });
  const listGate = new Promise<void>(resolve => { releaseList = resolve; });
  const listReady = new Promise<void>(resolve => { listStarted = resolve; });
  const c = new AcentaController(new AcentaApi(session, async (input, init) => {
    if (init?.method === "POST" && String(input).endsWith("/plannings")) await postGate;
    const response = await server.transport(input, init);
    if (init?.method === "GET" && new URL(String(input), "https://test.invalid").pathname.endsWith("/plannings")) {
      listStarted(); await listGate;
      if (newerRevision && server.docs.size) {
        const created = [...server.docs.values()][0];
        const later = guidedRevised(created, "Later revision", crypto.randomUUID());
        return json({ items: [later], next_cursor: null });
      }
    }
    return response;
  }), null, workspaceId);
  c.useAnalyticSection(section); prepare(c);
  const creation = c.submitDerived();
  c.navigate("resources");
  await listReady;
  releasePost();
  expect(await creation).toBe(true);
  expect(c.snapshot().items).toHaveLength(1);
  expect(c.snapshot().view).toBe("resources");
  releaseList();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(c.snapshot().listState).toBe("ready");
  expect(c.snapshot().items).toHaveLength(1);
  expect(c.snapshot().items[0].receipt.revision).toBe(newerRevision ? 2 : 1);
  expect(c.snapshot().items[0].analytic_origin).toEqual(section);
  // A new authoritative refresh must not retain overlays from the earlier query.
  server.docs.clear();
  server.history.clear();
  await c.loadResources();
  expect(c.snapshot().items).toEqual([]);
});

it("deduplicates a confirmed derivation when a subsequent catalog page also includes it", async () => {
  const { controller: c, server, section } = setup();
  const baseline = guidedPlanning();
  baseline.receipt.planning_id = "00000000-0000-4000-8000-000000000001";
  server.before = async call => {
    if (call.method !== "GET" || call.path.split("?")[0] !== "plannings") return;
    const next = new URLSearchParams(call.path.split("?")[1]).has("after");
    return json({ items: next ? [...server.docs.values()] : [baseline], next_cursor: next ? null : baseline.receipt.planning_id });
  };
  await c.loadResources();
  c.useAnalyticSection(section); prepare(c);
  await c.submitDerived();
  const confirmed = c.snapshot().result!;
  expect(c.snapshot().items).toHaveLength(2);
  await c.loadResources(true);
  expect(c.snapshot().items).toHaveLength(2);
  expect(c.snapshot().items.filter(doc => doc.receipt.planning_id === confirmed.receipt.planning_id)).toHaveLength(1);
});
