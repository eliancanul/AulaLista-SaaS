import { describe, expect, it, vi } from "vitest";
import { AcentaApi } from "../src/acenta/api";
import { AcentaController } from "../src/acenta/controller";
import { EditorExitGuard } from "../src/acenta/editor-exit";
import { FixtureServer, session, planning, json } from "./acenta-fixtures";

function setup() {
  const server = new FixtureServer();
  const document = planning();
  server.put(document);
  const controller = new AcentaController(new AcentaApi(session, server.transport));
  controller.openEditor(document);
  controller.edit("Texto privado pendiente");
  const exit = vi.fn();
  const guard = new EditorExitGuard(controller, exit);
  return { server, controller, exit, guard };
}

describe("explicit pending-editor exit", () => {
  it("does not leave until a private draft is confirmed, without changing the saved revision", async () => {
    const { server, controller, exit, guard } = setup();
    const original = structuredClone(controller.snapshot().editor!.document);
    guard.request();
    expect(guard.snapshot().open).toBe(true);
    expect(exit).not.toHaveBeenCalled();
    await guard.preserve();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().editor).toMatchObject({
      text: "Texto privado pendiente", draftSaved: true, pending: null,
      document: original,
    });
    expect(server.drafts.size).toBe(1);
    expect(server.docs.get(original.receipt.planning_id)).toEqual(original);
  });
  it("continuing to edit cancels exit even if the earlier draft is later confirmed", async () => {
    const { server, controller, exit, guard } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.before = async () => { await gate; };
    guard.request();
    const saving = guard.preserve();
    guard.cancel();
    controller.edit("Edición posterior a Seguir editando");
    release(); await saving;
    expect(exit).not.toHaveBeenCalled();
    expect(guard.snapshot()).toEqual({ open: false, busy: false });
    expect(controller.snapshot().editor).toMatchObject({ text: "Edición posterior a Seguir editando", draftSaved: false });
  });
  it("cancels exit without an edit while the prior draft confirmation is in flight", async () => {
    const { server, exit, guard } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.before = async () => { await gate; };
    guard.request(); const saving = guard.preserve();
    guard.cancel(); release(); await saving;
    expect(exit).not.toHaveBeenCalled();
  });
  it("allows a clean editor to leave once without inventing a draft", () => {
    const { server, controller, exit, guard } = setup();
    controller.undo(); guard.request(); guard.request();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(server.calls).toHaveLength(0);
  });
  it("stays open for an unconfirmed operation even if text matches the baseline", async () => {
    const { server, controller, exit, guard } = setup();
    server.before = async () => json({ detail: "unavailable" }, 503);
    await controller.preserveDraft(); controller.edit(controller.snapshot().editor!.baseline);
    guard.request(); await guard.preserve();
    expect(guard.snapshot().open).toBe(true); expect(exit).not.toHaveBeenCalled();
  });
  it.each(["503", "network", "invalid-receipt"])("retains text and exact draft attempt after %s and retries it", async (failure) => {
    const { server, controller, exit, guard } = setup();
    const text = controller.snapshot().editor!.text;
    server.before = async () => {
      if (failure === "network") throw new Error("offline");
      return failure === "invalid-receipt" ? json({ receipt: {} }, 201)
        : json({ detail: "unavailable" }, Number(failure));
    };
    guard.request(); await guard.preserve();
    const intent = structuredClone(controller.snapshot().editor!.pending);
    expect(intent).not.toBeNull(); expect(exit).not.toHaveBeenCalled();
    expect(guard.snapshot().open).toBe(true);
    expect(controller.snapshot().editor!.text).toBe(text);
    server.before = null;
    await guard.preserve();
    const writes = server.calls.filter((c) => c.path.includes("/drafts/") && c.method === "PUT");
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(controller.snapshot().drafts[0].receipt.operation_id).toBe(intent!.key);
    expect(exit).toHaveBeenCalledTimes(1);
  });
  it("recovers a lost response from its receipt without writing another draft", async () => {
    const { server, controller, exit, guard } = setup();
    server.after = async () => { throw new Error("response lost after commit"); };
    guard.request(); await guard.preserve();
    const pending = structuredClone(controller.snapshot().editor!.pending);
    expect(server.drafts.size).toBe(1); expect(exit).not.toHaveBeenCalled();
    server.after = null; await guard.preserve();
    expect(controller.snapshot().drafts[0].receipt.operation_id).toBe(pending!.key);
    expect(server.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    expect(server.drafts.size).toBe(1); expect(exit).toHaveBeenCalledTimes(1);
  });
  it("duplicate clicks cannot start more than one write or leave twice", async () => {
    const { server, exit, guard } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.before = async () => { await gate; };
    guard.request(); const first = guard.preserve();
    guard.request(); await guard.preserve();
    expect(exit).not.toHaveBeenCalled(); expect(server.calls).toHaveLength(1);
    release(); await first;
    guard.request(); await guard.preserve();
    expect(server.drafts.size).toBe(1); expect(exit).toHaveBeenCalledTimes(1);
  });
  it("a newer edit without cancelling never authorizes exit on an older receipt", async () => {
    const { server, controller, exit, guard } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.before = async () => { await gate; };
    guard.request(); const saving = guard.preserve();
    controller.edit("Texto más reciente");
    release(); await saving;
    expect(exit).not.toHaveBeenCalled(); expect(guard.snapshot().open).toBe(true);
    expect(controller.snapshot().editor).toMatchObject({ text: "Texto más reciente", draftSaved: false, save: "dirty" });
    expect([...server.drafts.values()][0].request.text).toBe("Texto privado pendiente");
  });
  it.each(["dispose", "closeSession"])("a late confirmation cannot leave after %s", async (action) => {
    const { server, controller, exit, guard } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.before = async () => { await gate; };
    guard.request(); const saving = guard.preserve();
    if (action === "dispose") guard.dispose(); else controller.closeSession();
    release(); await saving;
    guard.request(); expect(exit).not.toHaveBeenCalled();
  });
  it.each([false, true])("reconciles an uncertain edit/copy before a separate explicit draft (copy=%s)", async (copy) => {
    const { server, controller, exit, guard } = setup();
    server.after = async () => { throw new Error("lost"); };
    await controller.save(copy);
    const pending = structuredClone(controller.snapshot().editor!.pending);
    server.after = null; guard.request(); await guard.preserve();
    expect(controller.snapshot().editor!.pending).toBeNull();
    expect(controller.snapshot().editor!.document.receipt.operation_id).toBe(pending!.key);
    expect(server.drafts.size).toBe(0); expect(exit).not.toHaveBeenCalled();
    await guard.preserve();
    expect(server.drafts.size).toBe(1); expect(exit).toHaveBeenCalledTimes(1);
  });
  it("a busy controller's no-op never counts as draft confirmation", async () => {
    const { server, controller, exit, guard } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.before = async () => { await gate; };
    const saving = controller.save();
    guard.request(); await guard.preserve();
    expect(exit).not.toHaveBeenCalled(); expect(server.calls).toHaveLength(1);
    release(); await saving;
    expect(exit).not.toHaveBeenCalled();
  });
  it("does not create another revision after checking a confirmed draft", async () => {
    const { server, controller, exit, guard } = setup();
    server.after = async () => { throw new Error("lost"); };
    guard.request(); await guard.preserve();
    server.after = null; await controller.recoverEditor();
    expect(controller.snapshot().editor!.draftSaved).toBe(true);
    await guard.preserve();
    expect(server.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("keeps an uncertain key when its receipt and exact replay still return 404", async () => {
    const { server, controller, exit, guard } = setup();
    server.before = async () => { throw new Error("offline"); };
    guard.request(); await guard.preserve();
    const intent = structuredClone(controller.snapshot().editor!.pending);
    server.before = async () => json({ detail: "not_found" }, 404);
    await guard.preserve();
    expect(controller.snapshot().editor!.pending).toEqual(intent);
    expect(controller.snapshot().editor!.text).toBe("Texto privado pendiente");
    expect(exit).not.toHaveBeenCalled(); expect(guard.snapshot().open).toBe(true);
    server.before = null; await guard.preserve();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().drafts[0].receipt.operation_id).toBe(intent!.key);
  });

});
