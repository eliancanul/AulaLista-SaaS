import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AcentaApi, ApiError } from "../src/acenta/api";
import { AcentaController } from "../src/acenta/controller";
import { sourceSamples, knownSourceSample, type SourceReceipt } from "../src/acenta/contracts";
import { FixtureServer, json, planning, session, source } from "./acenta-fixtures";

const first = { ...source, source_id: "10000000-0000-4000-8000-000000000010" };
const second = { ...source, source_id: "10000000-0000-4000-8000-000000000020" };
const page = (items: SourceReceipt[], next_cursor: string | null = null) => ({ items, next_cursor });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const api = new AcentaApi(session, new FixtureServer().transport);
  return { api, controller: new AcentaController(api) };
}

describe("authorized source catalog contract", () => {
  it("requests bounded pages with same-origin/no-store and validates the exact receipt", async () => {
    const transport = vi.fn(async () => json(page([second])));
    const api = new AcentaApi(session, transport);
    expect(await api.listSources(first.source_id, 1)).toEqual(page([second]));
    expect(transport).toHaveBeenCalledWith(
      `/scopes/${session.scopeId}/sources?after=${first.source_id}&limit=1`,
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );
  });
  it.each([0, 101, 1.5, NaN])("rejects invalid page limit %s before transport", async (limit) => {
    const transport = vi.fn();
    await expect(new AcentaApi(session, transport).listSources(undefined, limit)).rejects.toMatchObject({ status: 422 });
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects a malformed cursor before transport", async () => {
    const transport = vi.fn();
    await expect(new AcentaApi(session, transport).listSources("../foreign")).rejects.toMatchObject({ status: 422 });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    page([{ ...first, actor_id: crypto.randomUUID() }]),
    page([{ ...first, scope_id: crypto.randomUUID() }]),
    page([{ ...first, size: 0 }]),
    page([{ ...first, size: 65537 }]),
    page([{ ...first, sha256: "wrong" }]),
    page([first, first]),
    page([second, first]),
    page([first], second.source_id),
    page([], first.source_id),
    page([first], "bad-cursor"),
  ])("rejects malformed, foreign, duplicated or non-progressing pages %j", async (value) => {
    await expect(new AcentaApi(session, async () => json(value)).listSources()).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("rejects excess entries and entries before the supplied cursor", async () => {
    const api = new AcentaApi(session, async () => json(page([first, second])));
    await expect(api.listSources(undefined, 1)).rejects.toMatchObject({ code: "invalid_response" });
    await expect(api.listSources(first.source_id)).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("recognizes only fixture hashes, including the two independent variations", () => {
    for (const sample of sourceSamples) {
      const digest = createHash("sha256").update(sample.bytes).digest("hex");
      expect(knownSourceSample(digest)?.name).toBe(sample.name);
    }
    expect(knownSourceSample("0".repeat(64))).toBeUndefined();
  });
});

describe("independent originals in Resources", () => {
  it("reloads an earlier empty catalog after a new source is confirmed", async () => {
    const { api, controller: c } = setup();
    await c.loadResources();
    expect(c.state.sources).toEqual([]);
    c.navigate("home"); await c.attach(sourceSamples[0].bytes);
    c.navigate("resources");
    await vi.waitFor(() => expect(c.state.sources).toHaveLength(1));
    expect(c.state.listState).toBe("ready");
    expect(c.state.items).toEqual([]);
  });
  it("does not replace a listed V1 after confirming a revision through the selector", async () => {
    const { api, controller: c } = setup();
    await c.attach(sourceSamples[0].bytes); await c.loadResources();
    const listed = c.state.sources[0];
    vi.spyOn(api, "reviseSource").mockImplementation(async (_id, _number, bytes, key) => ({
      ...listed, number: 2, version_id: crypto.randomUUID(), operation_id: key,
      sha256: createHash("sha256").update(bytes).digest("hex"), size: Buffer.byteLength(bytes),
    }));
    c.navigate("home"); await c.attach(sourceSamples[1].bytes); c.navigate("resources");
    expect(c.state.source?.number).toBe(2);
    expect(c.state.sources).toEqual([listed]);
    expect(c.state.listState).toBe("ready");
  });
  it("discovers a persisted source in a fresh controller without a planning or stored source ID", async () => {
    const server = new FixtureServer();
    const api = new AcentaApi(session, server.transport);
    await new AcentaController(api).attach(sourceSamples[0].bytes);
    const fresh = new AcentaController(api);
    await fresh.loadResources();
    expect(fresh.state.sources).toEqual([expect.objectContaining({ source_id: source.source_id })]);
    expect(fresh.state).toMatchObject({ items: [], drafts: [], source: null, listState: "ready" });
  });
  it("paginates originals independently of exhausted derived lists and preserves pages until explicit refresh", async () => {
    const { api, controller: c } = setup();
    const list = vi.spyOn(api, "list");
    const sources = vi.spyOn(api, "listSources").mockResolvedValueOnce(page([first], first.source_id)).mockResolvedValueOnce(page([second])).mockResolvedValueOnce(page([second]));
    await c.loadResources();
    await c.loadResources(true);
    expect(c.state.sources).toEqual([first, second]);
    expect(sources.mock.calls).toEqual([[undefined], [first.source_id]]);
    expect(list).toHaveBeenCalledTimes(1);
    c.navigate("home"); c.navigate("resources");
    expect(c.state.sources).toEqual([first, second]);
    expect(sources).toHaveBeenCalledTimes(2);
    await c.loadResources();
    expect(c.state.sources).toEqual([second]);
  });
  it("pins a listed V1 while V2 arrives, with explicit refresh exposing V2", async () => {
    const { api, controller: c } = setup();
    const v2 = { ...first, number: 2, version_id: crypto.randomUUID() };
    vi.spyOn(api, "listSources").mockResolvedValueOnce(page([first])).mockResolvedValueOnce(page([v2]));
    const read = vi.spyOn(api, "original").mockResolvedValue({ text: sourceSamples[0].bytes, sha256: first.sha256, size: first.size });
    await c.loadResources();
    const listed = c.state.sources[0];
    await c.openOriginal(listed);
    expect(read).toHaveBeenLastCalledWith(first);
    await c.loadResources();
    expect(c.state.sources[0].number).toBe(2);
    expect(c.state.original?.reference.number).toBe(1);
    await c.openOriginal(listed);
    expect(read).toHaveBeenLastCalledWith(first);
  });
  it("opening and closing an original preserves prompt, selection, editor and view", async () => {
    const { api, controller: c } = setup();
    await c.attach(sourceSamples[0].bytes);
    c.setPrompt("Mi petición pendiente");
    c.openEditor(planning()); c.edit("Mi edición pendiente"); c.navigate("resources");
    const before = { prompt: c.state.prompt, source: c.state.source, editor: c.state.editor };
    vi.spyOn(api, "original").mockResolvedValue({ text: "text", sha256: first.sha256, size: first.size });
    await c.openOriginal(first); c.closeOriginal();
    expect(c.state).toMatchObject({ ...before, view: "resources", original: null });
  });
  it.each([401, 404, 503])("keeps known resources and unsaved work on %s, then retries", async (status) => {
    const { api, controller: c } = setup();
    vi.spyOn(api, "listSources").mockResolvedValueOnce(page([first])).mockRejectedValueOnce(new ApiError(status, "unavailable")).mockResolvedValueOnce(page([second]));
    c.setPrompt("No borrar");
    await c.loadResources(); await c.loadResources();
    expect(c.state).toMatchObject({ sources: [first], prompt: "No borrar", listState: "error" });
    await c.loadResources();
    expect(c.state).toMatchObject({ sources: [second], prompt: "No borrar", listState: "ready", error: "" });
  });
  it.each([false, true])("ignores a late original page after account closure (error=%s)", async (error) => {
    const { api, controller: c } = setup();
    const old = deferred<ReturnType<typeof page>>();
    vi.spyOn(api, "listSources").mockReturnValue(old.promise);
    const pending = c.loadResources(); c.closeSession();
    if (error) old.reject(new ApiError(503, "unavailable")); else old.resolve(page([first]));
    await pending;
    expect(c.state).toMatchObject({ closed: true, sources: [], sourceCursor: null, original: null, error: "" });
    const other = new AcentaController(new AcentaApi({ actorId: crypto.randomUUID(), scopeId: crypto.randomUUID() }));
    expect(other.state.sources).toEqual([]);
  });
  it("discards an old source page after newer navigation and refresh", async () => {
    const { api, controller: c } = setup();
    const old = deferred<ReturnType<typeof page>>();
    vi.spyOn(api, "listSources").mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([second]));
    const pending = c.loadResources(); c.navigate("home");
    await c.loadResources(); old.resolve(page([first])); await pending;
    expect(c.state.sources).toEqual([second]);
  });
});
