/** Synthetic wire responses only: no provider, credentials, or educational claims. */
import { expect, it } from "vitest";
import { AcentaApi } from "../src/acenta/api";
import { AcentaController, type BackupStore } from "../src/acenta/controller";
import { GuidedServer } from "./guided-server";
import { guidedPlanning, guidedRequest } from "./guided-fixtures";
import { json, session, workspaceId, type Call } from "./acenta-fixtures";

class GeneratedServer extends GuidedServer {
  available: unknown = true;
  generationState: string | null = null;
  generationStatus = 409;
  protected override handle(call: Call): Response {
    if (call.path === "planning-generation") return json({ available: this.available });
    if (this.generationState && (call.path === "generated-plannings" || call.path.startsWith("planning-operations/")))
      return json({ detail: this.generationState }, this.generationStatus);
    if (call.path === "generated-plannings" && call.method === "POST") {
      const input = JSON.parse(call.body!);
      const doc = guidedPlanning(call.key!);
      doc.request = input;
      doc.result.provenance = "openai-guided-v1";
      doc.result.notice = "Respuesta sintética de transporte para probar software; sin evaluación educativa.";
      return json(this.put(doc), 201);
    }
    return super.handle(call);
  }
}

function setup(storage: BackupStore | null = null) {
  const server = new GeneratedServer();
  const controller = new AcentaController(new AcentaApi(session, server.transport), storage, workspaceId);
  controller.navigate("planning");
  controller.setGuided(guidedRequest());
  return { server, controller };
}

it("uses the real-generation contract only after the server advertises availability", async () => {
  const { server, controller: c } = setup();
  expect(c.snapshot().generationAvailable).toBe(false);
  await c.loadGenerationAvailability();
  expect(c.snapshot().generationAvailable).toBe(true);
  await Promise.all([c.submitGuided(), c.submitGuided()]);
  expect(server.calls.filter(c => c.method === "POST")).toHaveLength(1);
  expect(server.calls.at(-1)?.path).toBe("generated-plannings");
  expect(JSON.parse(server.calls.at(-1)!.body!)).not.toHaveProperty("fixture_context");
  expect(c.snapshot().result?.request.contract_version).toBe(3);
  expect(c.snapshot().result?.result.provenance).toBe("openai-guided-v1");
});

it("restores a generated pending operation after reload and only queries its original key", async () => {
  const saved = new Map<string, string>();
  const storage: BackupStore = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => { saved.set(key, value); },
    removeItem: key => { saved.delete(key); },
  };
  const { server, controller: c } = setup(storage);
  await c.loadGenerationAvailability();
  server.generationState = "generation_uncertain";
  await c.submitGuided();
  const key = c.snapshot().pending!.key;
  const restored = new AcentaController(new AcentaApi(session, server.transport), storage, workspaceId);
  expect(restored.snapshot().backupError).toBe(false);
  expect(restored.snapshot().pending?.key).toBe(key);
  expect(restored.snapshot().generationAvailable).toBe(false);
  await restored.recoverCreate();
  expect(server.calls.at(-1)?.path).toBe(`planning-operations/${key}`);
  expect(server.calls.filter(c => c.method === "POST")).toHaveLength(1);
});

it.each(["generation_pending", "generation_uncertain"])("keeps %s recoverable with GET only, including a later missing response", async code => {
  const { server, controller: c } = setup();
  await c.loadGenerationAvailability();
  server.generationState = code;
  await c.submitGuided();
  const key = c.snapshot().pending?.key;
  expect(key).toBeTruthy();
  expect(c.snapshot().submit).toBe("unknown");
  await c.submitGuided();
  server.generationState = null;
  await c.recoverCreate();
  expect(c.snapshot().pending?.key).toBe(key);
  expect(server.calls.filter(c => c.method === "POST")).toHaveLength(1);
  expect(server.calls.slice(-2).map(c => c.path)).toEqual([
    `planning-operations/${key}`, `planning-operations/${key}`,
  ]);
});

it("a failed generation permits a new key only after another explicit submission", async () => {
  const { server, controller: c } = setup();
  await c.loadGenerationAvailability();
  server.generationState = "generation_pending";
  await c.submitGuided();
  const first = c.snapshot().pending!.key;
  server.generationState = "generation_failed";
  await c.recoverCreate();
  expect(c.snapshot().pending).toBeNull();
  expect(c.snapshot().submit).toBe("error");
  expect(c.snapshot().error).toContain("nueva creación");
  await c.recoverCreate();
  expect(server.calls.filter(c => c.method === "POST")).toHaveLength(1);
  server.generationState = null;
  await c.submitGuided();
  expect(c.snapshot().result?.receipt.operation_id).not.toBe(first);
  expect(server.calls.filter(c => c.method === "POST")).toHaveLength(2);
});

it("reports unavailable generation as a definite pre-admission rejection and preserves the form", async () => {
  const { server, controller: c } = setup();
  await c.loadGenerationAvailability();
  server.generationState = "generation_unavailable";
  server.generationStatus = 503;
  await c.submitGuided();
  expect(c.snapshot().pending).toBeNull();
  expect(c.snapshot().submit).toBe("error");
  expect(c.snapshot().guided).toEqual(guidedRequest());
  expect(c.snapshot().error).toContain("no está disponible");
  expect(server.calls.filter(c => c.method === "POST")).toHaveLength(1);
});

it.each([false, "true", null])("keeps generation closed for unavailable or invalid capability %s", async available => {
  const { server, controller: c } = setup();
  server.available = available;
  await c.loadGenerationAvailability();
  expect(c.snapshot().generationAvailable).toBe(false);
  await c.submitGuided();
  expect(server.calls.at(-1)?.path).toBe("guided-plannings");
  expect(c.snapshot().result?.result.provenance).toBe("synthetic-fixture-v1");
});

it("cannot enable generation from a capability response arriving after session suspension", async () => {
  const { server, controller: c } = setup();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  server.before = async () => gate;
  const pending = c.loadGenerationAvailability();
  c.suspend();
  release();
  await pending;
  expect(c.snapshot().generationAvailable).toBe(false);
  expect(server.calls.filter(c => c.method === "POST")).toHaveLength(0);
});

it("preserves generated provenance and manual origin through edits, copies, drafts and reopening without generating again", async () => {
  const { server, controller: c } = setup();
  await c.loadGenerationAvailability();
  await c.submitGuided();
  const initial = c.snapshot().result!.request;
  c.openEditor();
  c.edit("Propósito editado en prueba de software.");
  await c.save();
  expect(c.snapshot().editor?.save).toBe("saved");
  c.edit("Texto conservado como borrador de software.");
  await c.preserveDraft();
  const draft = c.snapshot().editor!.draftId;
  expect(c.snapshot().editor?.draftSaved).toBe(true);
  c.closeEditor();
  await c.openDraft(draft);
  expect(c.snapshot().editor?.text).toBe("Texto conservado como borrador de software.");
  await c.save(true);
  expect(c.snapshot().editor?.save).toBe("saved");
  const copy = c.snapshot().result!;
  expect(copy.origin?.revision).toBe(2);
  c.closeEditor();
  await c.open(copy.receipt.planning_id);
  expect(c.snapshot().result?.initial_request).toEqual(initial);
  expect(c.snapshot().result?.result.provenance).toBe("openai-guided-v1");
  expect(server.calls.filter(c => c.path === "generated-plannings")).toHaveLength(1);
});
