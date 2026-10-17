import { describe, it, expect, vi } from "vitest";
import { AcentaNavigation } from "../src/acenta/navigation";
import { AcentaController } from "../src/acenta/controller";
import { AcentaApi, ApiError } from "../src/acenta/api";
import { FixtureServer, session, planning, revised } from "./acenta-fixtures";
function setup() {
  const api = new AcentaApi(session, new FixtureServer().transport);
  const controller = new AcentaController(api);
  return { api, controller };
}
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
describe("library navigation and suspended editing", () => {
  it("preserves loaded pages/cursors on return and refreshes only explicitly", async () => {
    const { api, controller: c } = setup(), first = planning(), second = planning();
    const list = vi.spyOn(api, "list").mockResolvedValueOnce({ items: [first], next_cursor: "next" })
      .mockResolvedValueOnce({ items: [second], next_cursor: null })
      .mockResolvedValueOnce({ items: [second], next_cursor: null });
    vi.spyOn(api, "listDrafts").mockResolvedValue({ items: [], next_cursor: null });
    c.navigate("resources"); await flush();
    await c.loadResources(true);
    expect(list.mock.calls).toEqual([[undefined], ["next"]]);
    c.navigate("home"); c.navigate("resources"); await flush();
    expect(c.state.items).toEqual([first, second]);
    expect(list).toHaveBeenCalledTimes(2);
    await c.loadResources();
    expect(c.state.items).toEqual([second]);
  });
  it.each([false, true])("ignores stale list completion/error and permits a new list (error=%s)", async (error) => {
    const { api, controller: c } = setup(), old = deferred<Awaited<ReturnType<typeof api.list>>>(), doc = planning();
    vi.spyOn(api, "list").mockReturnValueOnce(old.promise).mockResolvedValue({ items: [doc], next_cursor: null });
    vi.spyOn(api, "listDrafts").mockResolvedValue({ items: [], next_cursor: null });
    c.navigate("resources"); c.navigate("home"); c.navigate("resources"); await flush();
    if (error) old.reject(new ApiError(503, "unavailable"));
    else old.resolve({ items: [planning()], next_cursor: "stale" });
    await flush();
    expect(c.state).toMatchObject({ view: "resources", items: [doc], listState: "ready", error: "", cursor: null });
  });
  it("retains a dirty editor through history and blocks opening another object", async () => {
    const { api, controller: c } = setup(), doc = planning(), other = planning();
    c.restoreNavigation({ view: "result", result: doc }); c.openEditor(); c.edit("Trabajo privado pendiente");
    const editor = c.state.editor, source = c.state.source;
    c.restoreNavigation({ view: "home", result: null });
    c.restoreNavigation({ view: "result", result: other });
    expect(c.state.editor).toBe(editor); expect(c.state.source).toBe(source);
    const read = vi.spyOn(api, "read");
    await c.open(other.receipt.planning_id);
    expect(read).not.toHaveBeenCalled(); expect(c.state.editor).toBe(editor);
    c.resumeEditor(); expect(c.state.result).toBe(doc); expect(c.state.editor?.text).toBe("Trabajo privado pendiente");
  });
  it("ignores an older detail after newer detail or navigation", async () => {
    const { api, controller: c } = setup(), old = deferred<ReturnType<typeof planning>>(), a = planning(), b = planning();
    vi.spyOn(api, "read").mockReturnValueOnce(old.promise).mockResolvedValueOnce(b);
    const opening = c.open(a.receipt.planning_id); await c.open(b.receipt.planning_id);
    old.resolve(a); await opening;
    expect(c.state.result).toBe(b);
    const late = deferred<ReturnType<typeof planning>>(); vi.spyOn(api, "read").mockReturnValueOnce(late.promise);
    const pending = c.open(a.receipt.planning_id); c.navigate("home"); late.reject(new ApiError(404, "not_found")); await pending;
    expect(c.state.view).toBe("home"); expect(c.state.error).toBe("");
  });
  it("does not let a pending detail switch a result after editing begins", async () => {
    const { api, controller: c } = setup(), doc = planning(), other = planning();
    c.restoreNavigation({ view: "result", result: doc }); c.openEditor();
    const response = deferred<ReturnType<typeof planning>>();
    vi.spyOn(api, "read").mockReturnValue(response.promise);
    const open = c.open(other.receipt.planning_id); c.edit("Edición más reciente");
    response.resolve(other); await open;
    expect(c.state.result).toBe(doc); expect(c.state.editor?.text).toBe("Edición más reciente");
  });
  it.each([401, 404, 503])("keeps %s detail failure visible without inventing a document", async (status) => {
    const { api, controller: c } = setup(); vi.spyOn(api, "read").mockRejectedValue(new ApiError(status, "error"));
    await c.open(crypto.randomUUID());
    expect(c.state.result).toBeNull(); expect(c.state.error).not.toBe("");
  });
  it.each([false, true])("keeps copy confirmation in the open editor (recovery=%s)", async (recovery) => {
    const { api, controller: c } = setup(), doc = planning();
    c.restoreNavigation({ view: "result", result: doc }); c.openEditor(); c.edit("Copia conservada");
    let editorOpen = true;
    const changed = vi.fn(() => { editorOpen = false; });
    const pushState = vi.fn();
    const navigation = new AcentaNavigation(c, { replaceState: vi.fn(), pushState },
      () => ({ x: 0, y: 0, focus: null }), changed);
    if (recovery) {
      vi.spyOn(api, "copy").mockRejectedValue(new ApiError(0, "network"));
      await c.save(true);
      const key = c.state.editor!.pending!.key;
      vi.spyOn(api, "operation").mockResolvedValue(revised(doc, "Copia conservada", key, true));
      await c.recoverEditor();
    } else {
      vi.spyOn(api, "copy").mockImplementation(async (_id, _payload, key) => revised(doc, "Copia conservada", key, true));
      await c.save(true);
    }
    expect(c.state.editor?.save).toBe("saved");
    expect(c.state.result?.receipt.planning_id).not.toBe(doc.receipt.planning_id);
    expect(editorOpen).toBe(true); expect(changed).not.toHaveBeenCalled(); expect(pushState).not.toHaveBeenCalled();
    c.edit("Sigo editando la copia"); expect(c.state.editor?.text).toBe("Sigo editando la copia");
    navigation.dispose();
  });
  it("applies a late write to its editor without replacing another historical result", async () => {
    const { api, controller: c } = setup(), doc = planning(), other = planning();
    const response = deferred<ReturnType<typeof planning>>();
    vi.spyOn(api, "save").mockReturnValue(response.promise);
    c.restoreNavigation({ view: "result", result: doc }); c.openEditor(); c.edit("Edición confirmada");
    const save = c.save();
    const key = c.state.editor!.pending!.key;
    c.restoreNavigation({ view: "result", result: other });
    response.resolve(revised(doc, "Edición confirmada", key)); await save;
    expect(c.state.result).toBe(other);
    expect(c.state.editor?.document.receipt.revision).toBe(2);
    expect(c.state.editor?.save).toBe("saved");
    c.resumeEditor(); expect(c.state.result?.receipt.revision).toBe(2);
  });
  it.each([401, 404, 503])("distinguishes empty listing from %s errors and recovers", async (status) => {
    const { api, controller: c } = setup();
    vi.spyOn(api, "list").mockRejectedValueOnce(new ApiError(status, "unavailable"))
      .mockResolvedValue({ items: [], next_cursor: null });
    vi.spyOn(api, "listDrafts").mockResolvedValue({ items: [], next_cursor: null });
    await c.loadResources(); expect(c.state.listState).toBe("error");
    await c.loadResources(); expect(c.state).toMatchObject({ items: [], drafts: [], listState: "ready", error: "" });
  });
});
