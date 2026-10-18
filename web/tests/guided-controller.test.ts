import { describe, expect, it } from "vitest";
import { AcentaApi } from "../src/acenta/api";
import { AcentaController } from "../src/acenta/controller";
import { guidedExample } from "../src/acenta/guided-planning";
import { GuidedServer } from "./guided-server";
import { guidedRevised, guidedRequest } from "./guided-fixtures";
import { json, session, workspaceId } from "./acenta-fixtures";
const setup = () => {
  const server = new GuidedServer();
  const controller = new AcentaController(
    new AcentaApi(session, server.transport),
    null,
    workspaceId,
  );
  controller.navigate("planning");
  controller.setGuided(guidedRequest());
  return { server, controller };
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
describe("guided creation and B3 invariants", () => {
  it("creates once on a double submit without any fabricated source or editor", async () => {
    const { server, controller: c } = setup();
    await Promise.all([c.submitGuided("example"), c.submitGuided("example")]);
    expect(server.calls.filter((x) => x.method === "POST")).toHaveLength(1);
    expect(server.calls[0].path).toBe("guided-plannings");
    expect(c.snapshot().result?.receipt.source_id).toBeNull();
    expect(c.snapshot().view).toBe("result");
    expect(c.snapshot().editor).toBeNull();
  });
  it("validates locally and keeps unsupported values after a certain rejection", async () => {
    const { server, controller: c } = setup();
    c.setGuided({ ...guidedExample(), topic: "" });
    await c.submitGuided("example");
    expect(server.calls).toHaveLength(0);
    c.setGuided({ ...guidedExample(), subject: "Matemáticas" });
    await c.submitGuided("example");
    expect(c.snapshot().pending).toBeNull();
    expect(c.snapshot().guided.subject).toBe("Matemáticas");
    expect(c.snapshot().error).toContain("Tus datos siguen aquí");
  });
  it("keeps the same key and recovers a committed but lost response before admitting another creation", async () => {
    const { server, controller: c } = setup();
    server.after = async (call, response) => {
      if (call.path === "guided-plannings") throw Error("transport lost");
      return response;
    };
    await c.submitGuided("example");
    const key = c.snapshot().pending!.key;
    expect(c.snapshot().submit).toBe("unknown");
    expect(c.snapshot().result).toBeNull();
    server.after = null;
    await c.submitGuided("example");
    expect(c.snapshot().result?.receipt.operation_id).toBe(key);
    expect(server.docs.size).toBe(1);
    expect(server.calls.map((x) => x.path)).toEqual([
      "guided-plannings",
      `planning-operations/${key}`,
    ]);
  });
  it("late create after navigation is listed without reopening the reader", async () => {
    const { server, controller: c } = setup(),
      gate = deferred();
    server.before = async (call) => {
      if (call.path === "guided-plannings") await gate.promise;
    };
    const pending = c.submitGuided("example");
    c.navigate("home");
    gate.resolve();
    await pending;
    expect(c.snapshot().view).toBe("home");
    expect(c.snapshot().result).toBeNull();
    expect(c.snapshot().items).toHaveLength(1);
  });
  it("does not admit late create after session suspension", async () => {
    const { server, controller: c } = setup(),
      gate = deferred();
    server.before = async () => {
      await gate.promise;
    };
    const pending = c.submitGuided("example");
    c.suspend();
    gate.resolve();
    await pending;
    expect(c.snapshot().result).toBeNull();
    expect(c.snapshot().pending).not.toBeNull();
    expect(c.snapshot().submit).toBe("unknown");
  });
  it("saves every basic field durably without replacing manual origin", async () => {
    const { server, controller: c } = setup();
    await c.submitGuided("example");
    const initial = c.snapshot().result!.request;
    for (const [resource, element, text] of [
      ["planning", "purpose", "Propósito revisado"],
      ["activity:introduction", "statement", "Inicio revisado"],
      ["activity:exploration", "minutes", "45"],
      ["planning", "material-1", "Colores compartidos"],
      ["planning", "formative_assessment", "Revisión con una pregunta"],
    ]) {
      c.openEditor(c.snapshot().result!, resource, element);
      c.edit(text);
      c.selectEditorTarget("planning", "purpose");
      expect(c.snapshot().editor?.elementKey).toBe(element);
      await c.save();
      expect(c.snapshot().editor?.save).toBe("saved");
      c.closeEditor();
    }
    const id = c.snapshot().result!.receipt.planning_id;
    await c.open(id);
    expect(c.snapshot().editor).toBeNull();
    expect(c.snapshot().result?.initial_request).toEqual(initial);
    expect(c.snapshot().result?.result.duration_minutes).toBe(65);
    expect(server.docs.get(id)?.receipt.revision).toBe(6);
  });
  it("preserves dirty text on CAS conflict and can save an independent copy", async () => {
    const { server, controller: c } = setup();
    await c.submitGuided("example");
    const base = c.snapshot().result!;
    c.openEditor();
    c.edit("Mi corrección pendiente");
    server.put(guidedRevised(base, "Otra revisión"));
    await c.save();
    expect(c.snapshot().editor?.save).toBe("conflict");
    expect(c.snapshot().editor?.text).toBe("Mi corrección pendiente");
    await c.save(true);
    expect(server.docs.size).toBe(2);
    expect(c.snapshot().result?.origin?.revision).toBe(1);
    expect(c.snapshot().result?.initial_request).toEqual(base.request);
  });
  it("keeps a failed numeric correction editable and never calls it saved", async () => {
    const { controller: c } = setup();
    await c.submitGuided("example");
    c.openEditor(c.snapshot().result!, "activity:closure", "minutes");
    c.edit("0");
    await c.save();
    expect(c.snapshot().editor?.save).toBe("error");
    expect(c.snapshot().editor?.text).toBe("0");
  });
  it("a malformed response never announces a confirmed creation", async () => {
    const { server, controller: c } = setup();
    server.after = async (call, response) => {
      if (call.path !== "guided-plannings") return response;
      const d = await response.json();
      d.receipt.source_id = crypto.randomUUID();
      return json(d, 201);
    };
    await c.submitGuided("example");
    expect(c.snapshot().result).toBeNull();
    expect(c.snapshot().pending).not.toBeNull();
    expect(c.snapshot().submit).toBe("unknown");
  });
  it("preserves and reopens a private guided draft at its exact target without changing the confirmed revision", async () => {
    const { server, controller: c } = setup();
    await c.submitGuided("example");
    c.openEditor(c.snapshot().result!, "activity:closure", "statement");
    c.edit("Cierre pendiente de prueba");
    await c.preserveDraft();
    expect(c.snapshot().editor?.draftSaved).toBe(true);
    const id = c.snapshot().editor!.draftId;
    expect([...server.docs.values()][0].receipt.revision).toBe(1);
    c.closeEditor();
    const next = new AcentaController(
      new AcentaApi(session, server.transport),
      null,
      crypto.randomUUID(),
    );
    await next.openDraft(id);
    expect(next.snapshot().editor).toMatchObject({
      resourceKey: "activity:closure",
      elementKey: "statement",
      text: "Cierre pendiente de prueba",
      draftSaved: true,
    });
    await next.save();
    expect(next.snapshot().result?.receipt.revision).toBe(2);
  });
  it("replays an absent operation using the original key after a request never arrived", async () => {
    const { server, controller: c } = setup();
    server.before = async (call) => {
      if (call.path === "guided-plannings") throw Error("before delivery");
    };
    await c.submitGuided("example");
    const key = c.snapshot().pending!.key;
    server.before = null;
    await c.recoverCreate();
    expect(c.snapshot().result?.receipt.operation_id).toBe(key);
    expect(server.docs.size).toBe(1);
    expect(
      server.calls.filter((x) => x.method === "POST").map((x) => x.key),
    ).toEqual([key, key]);
  });
});
