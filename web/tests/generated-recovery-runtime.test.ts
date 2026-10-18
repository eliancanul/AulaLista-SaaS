/** Actual AuthController composition with a synthetic HTTP boundary, never a model. */
import { expect, it } from "vitest";
import { AuthApi, AuthController } from "../src/acenta/auth";
import { EditorRecovery, GENERATION_RECOVERY_KEY, RECOVERY_KEY, RECOVERY_TTL } from "../src/acenta/editor-recovery";
import { GuidedServer } from "./guided-server";
import { guidedRequest, guidedPlanning } from "./guided-fixtures";
import { json, session } from "./acenta-fixtures";

function harness() {
  const slots = new Map<string, string>();
  const store = {
    getItem: (key: string) => slots.get(key) ?? null,
    setItem: (key: string, value: string) => { slots.set(key, value); },
    removeItem: (key: string) => { slots.delete(key); },
  };
  const server = new GuidedServer();
  let active: any = { principal_id: session.actorId, scope_id: session.scopeId,
    recovery_context_id: crypto.randomUUID(), csrf_token: "CSRF-MUST-NOT-PERSIST" };
  let time = 1_000_000;
  let state = "generation_pending";
  let input: any;
  let operation: string;
  server.after = async (call, response) => {
    if (call.path === "planning-generation") return json({ available: true });
    if (call.path === "generated-plannings") { input = JSON.parse(call.body!); operation = call.key!; }
    if (call.path === "generated-plannings" || call.path.startsWith("planning-operations/")) {
      if (state) return json({ detail: state }, state === "not_found" ? 404 : 409);
      const doc = guidedPlanning(operation);
      doc.request = input; doc.result.provenance = "openai-guided-v1";
      return json(doc);
    }
    return response;
  };
  const transport: AuthApi["transport"] = async (url, init) => {
    if (url === "/auth/session") return active ? json(active) : json({ detail: "unauthorized" }, 401);
    if (url === "/auth/bootstrap") return json({ csrf_token: "pre", google_nonce: "nonce", google_client_id: null, email_available: false });
    if (url === "/auth/logout") { active = null; return new Response(null, { status: 204 }); }
    return server.transport(url, init);
  };
  return { slots, server, store, fresh: () => new AuthController(new AuthApi(transport), new EditorRecovery(() => store, () => time)),
    set state(value: string) { state = value; }, get active() { return active; }, set active(value) { active = value; },
    get time() { return time; }, set time(value: number) { time = value; } };
}

async function pendingGeneration(h: ReturnType<typeof harness>) {
  const auth = h.fresh(); await auth.start();
  const c = auth.snapshot().controller!;
  c.setGuided(guidedRequest()); await c.loadGenerationAvailability(); await c.submitGuided();
  return { auth, c };
}

it("real authenticated remount restores the same generation key and fixed TTL, then recovers by GET only", async () => {
  const h = harness(), auth = h.fresh();
  await auth.start();
  const c = auth.snapshot().controller!;
  c.setGuided(guidedRequest());
  await c.loadGenerationAvailability();
  await c.submitGuided();
  const key = c.snapshot().pending!.key;
  expect(h.slots.size).toBe(1);
  const raw = [...h.slots.values()][0];
  expect(raw).not.toContain("CSRF-MUST-NOT-PERSIST");
  const envelope = JSON.parse(raw);
  h.time += 100;
  h.server.calls = [];
  const reload = h.fresh(); await reload.start();
  const restored = reload.snapshot().controller!;
  expect(restored.snapshot().pending?.key).toBe(key);
  expect(restored.snapshot().guided).toEqual(guidedRequest());
  expect(JSON.parse([...h.slots.values()][0]).expires_at_ms).toBe(envelope.expires_at_ms);
  expect(JSON.parse([...h.slots.values()][0]).workspace_id).toBe(envelope.workspace_id);
  h.state = "not_found"; await restored.recoverCreate();
  expect(restored.snapshot().pending?.key).toBe(key);
  h.state = ""; await restored.recoverCreate();
  expect(restored.snapshot().result?.receipt.operation_id).toBe(key);
  expect(h.server.calls.every(call => call.method === "GET")).toBe(true);
  expect(h.server.calls.filter(call => call.path === `planning-operations/${key}`).length).toBeGreaterThan(0);
  expect(h.slots.size).toBe(0);
});

it.each(["401", "context", "actor", "scope", "expired", "clock_rollback", "logout"])("does not restore the generation across %s", async boundary => {
  const h = harness(); const { auth } = await pendingGeneration(h);
  if (boundary === "401") h.active = null;
  if (boundary === "context") h.active = { ...h.active, recovery_context_id: crypto.randomUUID() };
  if (boundary === "actor") h.active = { ...h.active, principal_id: crypto.randomUUID() };
  if (boundary === "scope") h.active = { ...h.active, scope_id: crypto.randomUUID() };
  if (boundary === "expired") h.time += RECOVERY_TTL;
  if (boundary === "clock_rollback") h.time--;
  if (boundary === "logout") await auth.logout();
  h.server.calls = [];
  const reload = h.fresh(); await reload.start();
  expect(reload.snapshot().controller?.snapshot().pending ?? null).toBeNull();
  expect(h.slots.has(GENERATION_RECOVERY_KEY)).toBe(false);
  expect(h.server.calls).toHaveLength(0);
});

it("corrupt generation recovery is not used or overwritten, and leaves the editor slot independently recoverable", async () => {
  const h = harness(); const { c } = await pendingGeneration(h);
  const doc = h.server.put(guidedPlanning()); c.openEditor(doc); c.edit("Edición sintética pendiente.");
  const editorRaw = h.slots.get(RECOVERY_KEY)!;
  h.slots.set(GENERATION_RECOVERY_KEY, '{"invalid":"slot"}');
  h.server.calls = [];
  const reload = h.fresh(); await reload.start(); const restored = reload.snapshot().controller!;
  expect(restored.snapshot().pending).toBeNull();
  expect(restored.snapshot().editor?.text).toBe("Edición sintética pendiente.");
  expect(h.slots.get(GENERATION_RECOVERY_KEY)).toBe('{"invalid":"slot"}');
  expect(h.slots.get(RECOVERY_KEY)).toBe(editorRaw);
  restored.setGuided(guidedRequest()); await restored.loadGenerationAvailability(); await restored.submitGuided();
  expect(h.server.calls.every(call => call.method === "GET")).toBe(true);
  expect(restored.snapshot().error).toContain("No se inició");
});

it("restores simultaneous editor and generation slots without a late generation replacing the editor", async () => {
  const h = harness(); const { c } = await pendingGeneration(h);
  const doc = h.server.put(guidedPlanning()); c.openEditor(doc); c.edit("Edición sintética que debe sobrevivir.");
  expect(h.slots.size).toBe(2);
  const reload = h.fresh(); await reload.start(); const restored = reload.snapshot().controller!;
  expect(restored.snapshot().pending).not.toBeNull();
  expect(restored.snapshot().editor?.text).toBe("Edición sintética que debe sobrevivir.");
  h.state = ""; await restored.recoverCreate();
  expect(restored.snapshot().editor?.text).toBe("Edición sintética que debe sobrevivir.");
  expect(restored.snapshot().result?.receipt.planning_id).toBe(doc.receipt.planning_id);
  expect(h.slots.has(GENERATION_RECOVERY_KEY)).toBe(false);
  expect(h.slots.has(RECOVERY_KEY)).toBe(true);
});
