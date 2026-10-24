import { describe, expect, it } from "vitest";
import { AcentaApi } from "../src/acenta/api";
import { ChatController } from "../src/acenta/chat-controller";
import { AcentaController } from "../src/acenta/controller";
import { AcentaNavigation } from "../src/acenta/navigation";
import { appendTurn, chatDocument, chatId, ChatServer, deferredResponse, otherChatId } from "./chat-fixtures";
import { json, session } from "./acenta-fixtures";
async function setup() {
  const server = new ChatServer(), created: string[] = [];
  const c = new ChatController(new AcentaApi(session, server.transport), id => created.push(id));
  await c.loadAvailability(); await c.openActive();
  return {server, c, created};
}
describe("chat continuity without replay or browser text persistence", () => {
  it("sends two turns against confirmed server versions and reloads only confirmed history", async () => {
    const {server, c, created} = await setup();
    c.setDraft("Una clase sobre agua"); await c.submit();
    expect(c.current().draft).toBe(""); expect(created).toHaveLength(1);
    c.setDraft("Ahora hazla más breve"); await c.submit();
    const posts = server.calls.filter(call => call.path.endsWith("/turns"));
    expect(posts.map(call => call.body)).toEqual([{text: "Una clase sobre agua", expected_version: 0, expected_context_revision: 0}, {text: "Ahora hazla más breve", expected_version: 1, expected_context_revision: 0}]);
    expect(c.current().document?.turns[1].assistant_text).toContain("Una clase sobre agua");
    expect(c.hasUnsavedChanges()).toBe(false);
    const reloaded = new ChatController(new AcentaApi(session, server.transport));
    await reloaded.list(); await reloaded.open(created[0]);
    expect(reloaded.current().document).toEqual(c.current().document);
    expect(server.calls.slice(-2).every(call => call.method === "GET")).toBe(true);
  });
  it("recovers a lost turn response with GET and never duplicates its operation", async () => {
    const {server, c} = await setup(); server.documents.set(chatId, chatDocument()); await c.open(chatId);
    server.intercept = call => { if (call.method === "POST") { server.handle(call); throw Error("Lost response"); } };
    c.setDraft("Mensaje que debe conservarse"); await c.submit();
    const pending = c.current().pending;
    expect(c.current().status).toBe("unknown"); expect(c.current().draft).toBe("Mensaje que debe conservarse");
    expect(c.setDraft("Reemplazo inseguro")).toBe(false);
    await c.submit(); await c.recover();
    expect(c.current().pending).toBeNull(); expect(c.current().document?.turns[0].operation_id).toBe(pending?.key);
    expect(server.calls.filter(call => call.method === "POST")).toHaveLength(1);
    expect(server.calls.at(-1)?.path).toBe(`conversations/${chatId}/operations/${pending?.key}`);
  });
  it.each([404, 503])("does not replay an operation after lookup status %i", async status => {
    const {server, c} = await setup(); server.documents.set(chatId, chatDocument()); await c.open(chatId);
    server.intercept = call => call.method === "POST" ? Promise.reject(Error("Lost response")) : json({detail: "not_found"}, status);
    c.setDraft("Mi mensaje"); await c.submit(); const pending = c.current().pending;
    await c.recover(); await c.recover(); await c.submit();
    expect(c.current().pending).toBe(pending); expect(server.calls.filter(call => call.method === "POST")).toHaveLength(1);
    expect(c.current().draft).toBe("Mi mensaje");
  });
  it("recovers lost creation via GET without automatically spending on a turn", async () => {
    const {server, c} = await setup();
    server.intercept = call => { if (call.path === "conversations") { server.handle(call); throw Error("Lost create response"); } };
    c.setDraft("Mi primer mensaje"); await c.submit(); const pending = c.current().pending;
    expect(pending?.kind).toBe("create"); await c.recover();
    expect(c.current()).toMatchObject({pending: null, draft: "Mi primer mensaje"}); expect(c.current().document?.turns).toEqual([]);
    expect(server.calls.at(-1)?.path).toBe(`conversation-operations/${pending?.key}`);
    expect(server.calls.filter(call => call.method === "POST")).toHaveLength(1);
    await c.submit(); expect(c.current().document?.turns).toHaveLength(1);
  });
  it.each([["chat_budget_exhausted", 429], ["chat_unavailable", 503], ["chat_limit_reached", 422], ["chat_context_too_large", 413], ["chat_busy", 409]] as const)("keeps rejected input editable after %s", async (code, status) => {
    const {server, c} = await setup(); server.documents.set(chatId, chatDocument()); await c.open(chatId);
    server.intercept = call => call.method === "POST" ? json({detail: code}, status) : undefined;
    c.setDraft("Mensaje propio"); await c.submit();
    expect(c.current()).toMatchObject({draft: "Mensaje propio", pending: null, status: "error"});
    await c.recover(); expect(server.calls.filter(call => call.method === "POST")).toHaveLength(1);
    expect(c.setDraft("Mensaje corregido")).toBe(true);
  });
  it("requires refresh after conflict, preserves text, and uses the refreshed version", async () => {
    const {server, c} = await setup(); server.documents.set(chatId, chatDocument()); await c.open(chatId);
    appendTurn(server.documents.get(chatId)!, crypto.randomUUID(), "Turno de otra pestaña");
    c.setDraft("Mi turno"); await c.submit(); await c.submit();
    expect(c.current()).toMatchObject({needsRefresh: true, draft: "Mi turno", pending: null});
    expect(server.calls.filter(call => call.method === "POST")).toHaveLength(1);
    await c.refresh(); await c.submit();
    expect(c.current().document?.conversation.version).toBe(2);
    expect(server.calls.at(-1)?.body).toEqual({text: "Mi turno", expected_version: 1, expected_context_revision: 0});
  });
  it("queries failed results before permitting an explicitly chosen new attempt", async () => {
    const {server, c} = await setup(); server.documents.set(chatId, chatDocument()); await c.open(chatId);
    server.intercept = call => {
      if (call.method === "POST") {
        appendTurn(server.documents.get(chatId)!, call.key!, (call.body as {text: string}).text, "failed");
        return json({detail: "chat_failed"}, 409);
      }
    };
    c.setDraft("Mensaje fallido"); await c.submit(); expect(c.current().pending).not.toBeNull(); await c.recover();
    expect(c.current()).toMatchObject({pending: null, draft: "Mensaje fallido", status: "error"});
    const originalKey = server.calls.find(call => call.method === "POST")?.key;
    server.intercept = undefined; await c.submit(); expect(server.calls.at(-1)?.key).not.toBe(originalKey);
    expect(server.calls.at(-1)?.body).toEqual({text: "Mensaje fallido", expected_version: 1, expected_context_revision: 0});
  });
  it.each(["generating", "uncertain"] as const)("reopened %s turns expose only GET recovery", async state => {
    const {server, c} = await setup(); const key = crypto.randomUUID();
    server.documents.set(chatId, appendTurn(chatDocument(), key, "Pendiente", state));
    await c.open(chatId); await c.submit(); await c.recover();
    expect(c.current()).toMatchObject({status: "unknown", pending: {key}});
    expect(server.calls.every(call => call.method === "GET")).toBe(true);
  });
  it("keeps its exact pending operation when a read reveals another unresolved turn", async () => {
    const {server, c} = await setup(); server.documents.set(chatId, chatDocument()); await c.open(chatId);
    server.intercept = call => call.method === "POST" ? Promise.reject(Error("Request delivery unknown")) : undefined;
    c.setDraft("Mi operación incierta"); await c.submit(); const pending = c.current().pending;
    appendTurn(server.documents.get(chatId)!, crypto.randomUUID(), "Operación de otra pestaña", "generating");
    await c.refresh(); expect(c.current().pending).toBe(pending);
    expect(c.current().draft).toBe("Mi operación incierta");
    await c.recover(); expect(c.current().pending).toBe(pending);
    expect(server.calls.filter(call => call.method === "POST")).toHaveLength(1);
  });
  it("keeps a late response in the active chat while an archive is read-only", async () => {
    const {server, c} = await setup(); server.documents.set(chatId, chatDocument()); server.documents.set(otherChatId, chatDocument(otherChatId)); await c.open(chatId);
    const gate = deferredResponse(); let confirmed: Response;
    server.intercept = call => { if (call.method === "POST") { confirmed = server.handle(call); return gate.promise; } };
    c.setDraft("Mensaje A"); const sending = c.submit(); await c.submit(); await c.open(otherChatId);
    expect(c.setDraft("No se escribe en el archivo")).toBe(false); await c.submit(); await c.updateContext(true);
    gate.resolve(confirmed!); await sending;
    expect(c.snapshot().activeId).toBe(otherChatId); expect(c.current().document?.conversation.version).toBe(0);
    await c.openActive(); expect(c.current().document?.conversation.version).toBe(1);
    expect(server.calls.filter(call => call.method === "POST")).toHaveLength(1);
  });
  it.each(["suspend", "close"] as const)("rejects late turn completion after %s", async action => {
    const {server, c} = await setup(); server.documents.set(chatId, chatDocument()); await c.open(chatId);
    const gate = deferredResponse(); let confirmed: Response;
    server.intercept = call => { if (call.method === "POST") { confirmed = server.handle(call); return gate.promise; } };
    c.setDraft("Mensaje privado"); const sending = c.submit(); c[action](); gate.resolve(confirmed!); await sending;
    const calls = server.calls.length; await c.submit(); await c.recover(); await c.list(); await c.open(otherChatId);
    expect(server.calls).toHaveLength(calls);
    if (action === "suspend") {
      expect(c.current()).toMatchObject({draft: "Mensaje privado", status: "unknown"});
      c.resume(); await c.recover(); expect(c.current().document?.turns).toHaveLength(1);
    } else {
      expect(JSON.stringify(c.snapshot())).not.toContain("Mensaje privado"); c.resume(); expect(c.setDraft("No debe admitir")).toBe(false);
    }
  });
  it("suspending during creation leaves no automatic turn and recovers only via GET", async () => {
    const {server, c} = await setup(); const gate = deferredResponse(); let confirmed: Response;
    server.intercept = call => { if (call.path === "conversations") { confirmed = server.handle(call); return gate.promise; } };
    c.setDraft("Mensaje inicial"); const sending = c.submit(); c.suspend(); gate.resolve(confirmed!); await sending;
    c.resume(); await c.recover(); expect(c.current().draft).toBe("Mensaje inicial");
    expect(server.calls.filter(call => call.method === "POST")).toHaveLength(1);
  });
  it("does not replace a newer confirmed turn with an older read", async () => {
    const {server, c} = await setup(); server.documents.set(chatId, chatDocument()); await c.open(chatId);
    const gate = deferredResponse(), older = json(chatDocument());
    server.intercept = call => call.method === "GET" && call.path === `conversations/${chatId}` ? gate.promise : undefined;
    const refreshing = c.refresh(); appendTurn(server.documents.get(chatId)!, crypto.randomUUID(), "Nuevo confirmado");
    server.intercept = undefined; await c.refresh(); gate.resolve(older); await refreshing;
    expect(c.current().document?.conversation.version).toBe(1);
  });
  it("returns to the same active draft after opening an archive without creating", async () => {
    const {server, c} = await setup(); server.documents.set(chatId, chatDocument()); server.documents.set(otherChatId, chatDocument(otherChatId));
    await c.open(chatId); c.setDraft("Borrador activo"); await c.open(otherChatId); await c.openActive();
    expect(c.current().draft).toBe("Borrador activo"); expect(c.snapshot().activeId).toBe(chatId);
    expect(c.discardDrafts()).toBe(true); expect(c.hasUnsavedChanges()).toBe(false);
    expect(server.calls.every(call => call.method === "GET")).toBe(true);
  });
  it("preserves the prior draft on oversized or invalid replacement without network", async () => {
    const {server, c} = await setup(); c.setDraft("Mi mensaje"); const calls = server.calls.length;
    expect(c.setDraft("😀".repeat(2049))).toBe(false); expect(c.setDraft("\ud800")).toBe(false);
    expect(c.current().draft).toBe("Mi mensaje"); expect(server.calls).toHaveLength(calls);
  });
  it("paginates and refreshes the full server list without generating", async () => {
    const {server, c} = await setup();
    for (let index = 0; index < 51; index++) {
      const id = `71000000-0000-4000-8000-${String(index).padStart(12, "0")}`; server.documents.set(id, chatDocument(id));
    }
    await c.list(); expect(c.snapshot().items).toHaveLength(50); await c.list(true); expect(c.snapshot().items).toHaveLength(51);
    expect(c.snapshot().cursor).toBeNull(); await c.list(true); expect(server.calls.every(call => call.method === "GET")).toBe(true);
    c.suspend(); c.resume(); await c.list(); expect(c.snapshot().items).toHaveLength(50);
  });
  it("workspace lifecycle, opaque navigation and storage never retain chat text", async () => {
    const server = new ChatServer(), writes: string[] = [], history: unknown[] = [];
    const c = new AcentaController(new AcentaApi(session, server.transport), {getItem: () => null, setItem: (_key, value) => {writes.push(value);}, removeItem: () => {}});
    const navigation = new AcentaNavigation(c, {replaceState: data => {history.push(data);}, pushState: data => {history.push(data);}}, () => ({x: 0, y: 0, focus: null}), () => {});
    server.documents.set(chatId, appendTurn(chatDocument(), crypto.randomUUID(), "Historial privado"));
    await c.chat.loadAvailability(); c.chat.setDraft("Texto privado no enviado"); c.openChat(chatId);
    await c.chat.refresh(); c.navigate("planning");
    expect(JSON.stringify(writes)).not.toMatch(/Texto privado|Historial privado/);
    expect(JSON.stringify(history)).not.toMatch(/Texto privado|Historial privado|71000000/);
    c.suspend(); expect(c.chat.setDraft("No")).toBe(false); c.resume(); c.closeSession();
    expect(JSON.stringify(c.chat.snapshot())).not.toMatch(/Texto privado|Historial privado/);
    expect(history.at(-1)).toBeNull(); navigation.dispose();
  });
});
