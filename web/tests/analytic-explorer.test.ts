import { describe, expect, it } from "vitest";
import { AcentaApi, type Transport } from "../src/acenta/api";
import { AnalyticExplorerController } from "../src/acenta/analytic-explorer";
import { AnalyticServer } from "./analytic-server";
import { json, session } from "./acenta-fixtures";
import { explorerCatalog } from "./analytic-explorer-fixtures";

function setup(transport?: Transport) {
  const server = new AnalyticServer();
  const catalog = explorerCatalog();
  for (const doc of catalog) server.putSection(doc);
  return { server, catalog, controller: new AnalyticExplorerController(new AcentaApi(session, transport ?? server.transport)) };
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}

describe("analytic explorer query and exact selection", () => {
  it("opens the first six rows and selects an exact document without writes", async () => {
    const { controller: c, catalog, server } = setup();
    expect(c.snapshot().open).toBe(false);
    await c.open();
    expect(c.snapshot()).toMatchObject({ open: true, status: "ready", items: catalog.slice(0, 6), selected: catalog[0], pageIndex: 0 });
    c.select(catalog[4].receipt.section_id);
    expect(c.snapshot().selected).toEqual(catalog[4]);
    expect(server.calls.every(call => call.method === "GET")).toBe(true);
  });

  it("retains exact criteria across next/previous and resets them from page one", async () => {
    const { controller: c, server, catalog } = setup();
    await c.open();
    await c.next();
    expect(c.snapshot()).toMatchObject({ items: catalog.slice(6), pageIndex: 1, nextCursor: null });
    await c.next();
    expect(server.calls).toHaveLength(2);
    await c.previous();
    expect(c.snapshot().items).toEqual(catalog.slice(0, 6));
    await c.search({ q: "AGUA", grade: "3.º de primaria", formative_field: "Campo manual" });
    expect(c.snapshot()).toMatchObject({ items: [catalog[7]], selected: catalog[7], pageIndex: 0 });
    const url = new URL(server.calls.at(-1)!.path, "https://test.invalid");
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "6", q: "AGUA", grade: "3.º de primaria", formative_field: "Campo manual" });
    await c.previous();
    expect(server.calls).toHaveLength(4);
  });

  it("passes unchanged query criteria when continuing a filtered page", async () => {
    const { controller: c, server } = setup();
    await c.open();
    await c.search({ q: "apartado" });
    const after = c.snapshot().nextCursor;
    await c.next();
    const query = new URL(server.calls.at(-1)!.path, "https://test.invalid").searchParams;
    expect(query.get("q")).toBe("apartado");
    expect(query.get("after")).toBe(after);
    expect(c.snapshot().items).toHaveLength(1);
  });

  it("does not accept a row outside the current page", async () => {
    const { controller: c, catalog } = setup();
    await c.open();
    expect(c.select(catalog[8].receipt.section_id)).toBe(false);
    expect(c.snapshot().selected).toEqual(catalog[0]);
  });

  it("keeps a selected revision independent of later fixture updates", async () => {
    const { controller: c, server, catalog } = setup();
    await c.open();
    const changed = structuredClone(catalog[0]);
    changed.receipt.revision = 2;
    changed.data.context!.text = "A later manual revision";
    server.putSection(changed);
    expect(c.snapshot().selected).toEqual(catalog[0]);
  });

  it("shows an empty result without retaining the previous selection", async () => {
    const { controller: c } = setup();
    await c.open();
    await c.search({ q: "No existe" });
    expect(c.snapshot()).toMatchObject({ status: "ready", items: [], selected: null, nextCursor: null });
  });

  it("clears stale results immediately when criteria change and ignores an older response", async () => {
    const old = deferred(), recent = deferred();
    let calls = 0;
    const { controller: c, catalog } = setup(async () => ++calls === 1 ? old.promise : recent.promise);
    const opening = c.open();
    const search = c.search({ q: "AGUA" });
    expect(c.snapshot()).toMatchObject({ status: "loading", items: [], selected: null });
    recent.resolve(json({ items: [catalog[7]], next_cursor: null }));
    await search;
    old.resolve(json({ items: catalog.slice(0, 6), next_cursor: catalog[5].receipt.section_id }));
    await opening;
    expect(c.snapshot()).toMatchObject({ filters: { q: "AGUA" }, items: [catalog[7]], selected: catalog[7] });
  });

  it("ignores an old error after a more recent query succeeds", async () => {
    const old = deferred();
    let calls = 0;
    const { controller: c, catalog } = setup(async () => ++calls === 1 ? old.promise : json({ items: [catalog[7]], next_cursor: null }));
    const opening = c.open();
    await c.search({ q: "AGUA" });
    old.resolve(json({ detail: "not_available" }, 503));
    await opening;
    expect(c.snapshot()).toMatchObject({ status: "ready", error: "", items: [catalog[7]] });
  });

  it("retries the same failed page and criteria without stale data", async () => {
    let fail = false;
    const server = new AnalyticServer();
    const catalog = explorerCatalog();
    for (const doc of catalog) server.putSection(doc);
    const requests: string[] = [];
    const { controller: c } = setup(async (input, init) => {
      requests.push(String(input));
      return fail ? json({ detail: "unavailable" }, 503) : server.transport(input, init);
    });
    await c.open();
    fail = true;
    await c.next();
    expect(c.snapshot()).toMatchObject({ status: "error", items: [], selected: null, pageIndex: 1 });
    const failed = requests.at(-1);
    fail = false;
    await c.retry();
    expect(requests.at(-1)).toBe(failed);
    expect(c.snapshot()).toMatchObject({ status: "ready", items: catalog.slice(6), pageIndex: 1 });
  });

  it("makes invalid filters a safe visible error before transport", async () => {
    const { controller: c, server } = setup();
    await c.open();
    await c.search({ q: "x".repeat(201) });
    expect(c.snapshot()).toMatchObject({ status: "error", items: [], selected: null });
    expect(c.snapshot().error).not.toContain("xxx");
    expect(server.calls).toHaveLength(1);
  });

  it.each(["close", "suspend", "dispose"] as const)("invalidates queries and clears private data on %s", async action => {
    const gate = deferred();
    const { controller: c, catalog } = setup(async () => gate.promise);
    const opening = c.open();
    c[action]();
    gate.resolve(json({ items: [catalog[0]], next_cursor: null }));
    await opening;
    expect(c.snapshot()).toMatchObject({ open: false, status: "idle", items: [], selected: null });
    if (action !== "close") {
      await c.open();
      expect(c.snapshot().open).toBe(false);
    }
  });

  it("reopens fresh after close and resumes after suspension", async () => {
    const { controller: c, catalog } = setup();
    await c.open();
    await c.search({ q: "agua" });
    c.close();
    await c.open();
    expect(c.snapshot()).toMatchObject({ filters: {}, pageIndex: 0, items: catalog.slice(0, 6) });
    c.suspend();
    c.resume();
    await c.open();
    expect(c.snapshot().items).toEqual(catalog.slice(0, 6));
    c.dispose();
    c.resume();
    await c.open();
    expect(c.snapshot().open).toBe(false);
  });
});
