import { describe, expect, it } from "vitest";
import { AcentaApi } from "../src/acenta/api";
import { ChatController } from "../src/acenta/chat-controller";
import { parseChatDocument } from "../src/acenta/chat-contracts";
import { AcentaController } from "../src/acenta/controller";
import { AcentaNavigation } from "../src/acenta/navigation";
import { appendTurn, chatDocument, chatId, ChatServer, deferredResponse, otherChatId, turnReceipt } from "./chat-fixtures";
import { json, session } from "./acenta-fixtures";
async function start(server: ChatServer) {
  const c = new ChatController(new AcentaApi(session, server.transport));
  await c.loadAvailability(); await c.openActive(); return c;
}
const fill = (doc: ReturnType<typeof chatDocument>, from: number, to: number) => {
  for (let index = from; index <= to; index++) appendTurn(doc, crypto.randomUUID(), `Mensaje ${index}`);
};
describe("one active chat and bounded history", () => {
  it("concurrent first opens and reload return to one chat without a new creation on read", async () => {
    const server = new ChatServer(), a = await start(server), b = await start(server);
    a.setDraft("Primera pestaña"); b.setDraft("Segunda pestaña"); await Promise.all([a.submit(), b.submit()]);
    expect(server.documents.size).toBe(1); expect(a.snapshot().primaryId).toBe(b.snapshot().primaryId);
    const posts = server.calls.filter(call => call.method === "POST").length;
    const reloaded = await start(server); expect(reloaded.snapshot().primaryId).toBe(a.snapshot().primaryId);
    expect(server.calls.filter(call => call.method === "POST")).toHaveLength(posts);
  });
  it("blocks creation when active lookup is unavailable, preserving the draft", async () => {
    const server = new ChatServer(); server.intercept = call => call.path === "active-conversation" ? json({detail: "unavailable"}, 503) : undefined;
    const c = await start(server); c.setDraft("No perder"); await c.submit();
    expect(c.current().draft).toBe("No perder"); expect(server.calls.every(call => call.method === "GET")).toBe(true);
    server.intercept = undefined; await c.openActive(); await c.submit(); expect(c.current().document?.turns).toHaveLength(1);
  });
  it("reads pages, merges one-turn receipts, and fills gaps after another tab advances", async () => {
    const server = new ChatServer(), doc = chatDocument(); fill(doc, 1, 20); server.documents.set(chatId, doc);
    const c = await start(server); expect(c.current().document?.next_cursor).toBeNull();
    fill(doc, 21, 50); await c.refresh();
    expect(c.current().document?.turns.map(turn => turn.number)).toEqual([...Array.from({length: 20}, (_, i) => i + 1), ...Array.from({length: 20}, (_, i) => i + 31)]);
    expect(c.current().document?.next_cursor).toBe("31"); await c.refresh(chatId, true);
    expect(c.current().document?.turns).toHaveLength(50); expect(c.current().document?.next_cursor).toBeNull();
    c.setDraft("Siguiente turno"); await c.submit();
    expect(c.current().document?.turns).toHaveLength(51);
    expect(server.calls.at(-1)?.body).toMatchObject({expected_version: 50, expected_context_revision: 0});
    const reloaded = await start(server); expect(reloaded.current().document?.turns).toHaveLength(20);
    expect(reloaded.current().document?.next_cursor).toBe("32");
    expect(server.calls.filter(call => call.method === "POST")).toHaveLength(1);
  });
  it("a receipt/header jump preserves a cursor to missing history", async () => {
    const server = new ChatServer(), doc = chatDocument(); fill(doc, 1, 20); server.documents.set(chatId, doc);
    const c = await start(server); c.setDraft("Turno recuperable");
    server.intercept = call => { if (call.method === "POST") { server.handle(call); throw Error("Lost"); } };
    await c.submit(); fill(doc, 22, 51); await c.recover();
    expect(c.current().document?.turns).toHaveLength(21); expect(c.current().needsRefresh).toBe(true);
    await c.refresh(); expect(c.current().document?.next_cursor).toBe("32");
    await c.refresh(chatId, true); expect(c.current().document?.turns).toHaveLength(51);
    expect(c.current().document?.next_cursor).toBeNull();
  });
  it("never downgrades a terminal turn from a stale same-version read", async () => {
    const server = new ChatServer(), doc = appendTurn(chatDocument(), crypto.randomUUID(), "Confirmado"); server.documents.set(chatId, doc);
    const c = await start(server), stale = structuredClone(doc); stale.turns[0].state = "generating"; stale.turns[0].assistant_text = null;
    server.intercept = () => json(stale); await c.refresh();
    expect(c.current().document?.turns[0].state).toBe("succeeded"); expect(c.current().pending).toBeNull();
  });
  it("retains known uncertain usage when a stale same-state page or receipt reports null", async () => {
    const server = new ChatServer(), doc = appendTurn(chatDocument(), crypto.randomUUID(), "Intento incierto", "uncertain"); server.documents.set(chatId, doc);
    const c = await start(server), stale = structuredClone(doc);
    stale.turns[0].usage = {input_tokens: null, output_tokens: null, estimated_cost_usd: null, reserved_usd: "0.020000"};
    server.intercept = () => json(stale); await c.refresh(); await c.recover();
    expect(c.current().document?.turns[0].usage).toEqual(doc.turns[0].usage);
    expect(c.current().pending?.kind).toBe("turn"); expect(server.calls.every(call => call.method === "GET")).toBe(true);
  });
  it("browser back to archive stays read-only and forward/home retain the active draft", async () => {
    const server = new ChatServer(); server.documents.set(chatId, chatDocument()); server.documents.set(otherChatId, chatDocument(otherChatId));
    const c = new AcentaController(new AcentaApi(session, server.transport)); await c.chat.openActive(); c.chat.setDraft("Texto activo");
    const history: unknown[] = [];
    const nav = new AcentaNavigation(c, {replaceState: data => history.push(data), pushState: data => history.push(data)}, () => ({x: 0, y: 0, focus: null}), () => {});
    c.openChat(otherChatId); await c.chat.refresh(); const archiveMarker = history.at(-1);
    c.navigate("home"); expect(c.chat.current().draft).toBe("Texto activo");
    nav.restore(archiveMarker); await c.chat.refresh(); expect(c.chat.isArchive()).toBe(true);
    await c.chat.submit(); c.navigate("home"); expect(c.chat.current().draft).toBe("Texto activo");
    expect(server.calls.every(call => call.method === "GET")).toBe(true); nav.dispose();
  });
});
describe("explicit versioned context without generation or replay", () => {
  it("keeps the draft/history and sends subsequent turns with the new context CAS", async () => {
    const server = new ChatServer(), doc = chatDocument(); fill(doc, 1, 2); server.documents.set(chatId, doc);
    const c = await start(server); c.setDraft("Mensaje aún sin enviar"); c.setContextDraft("Corrección: no usar farol; usar brújula.");
    await c.updateContext();
    expect(c.current()).toMatchObject({draft: "Mensaje aún sin enviar", contextDraft: null, pending: null,
      document: {context: {revision: 1, previous_revision: 0, through_turn: 2, notes: "Corrección: no usar farol; usar brújula."}}});
    expect(c.current().document?.turns).toHaveLength(2);
    expect(server.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual([`conversations/${chatId}/context`]);
    await c.submit(); expect(server.calls.at(-1)?.body).toMatchObject({expected_version: 2, expected_context_revision: 1});
    await c.updateContext(true);
    expect(c.current().document?.context).toMatchObject({revision: 2, through_turn: 3, origin: "reset", notes: ""});
    expect(c.current().document?.turns).toHaveLength(3);
  });
  it.each([404, 503])("unknown context lookup %i retains exact intent and never replays", async status => {
    const server = new ChatServer(); server.documents.set(chatId, chatDocument()); const c = await start(server);
    c.setDraft("Borrador protegido"); c.setContextDraft("Notas protegidas");
    server.intercept = call => call.method === "POST" ? Promise.reject(Error("Unknown delivery")) : json({detail: "not_found"}, status);
    await c.updateContext(); const pending = c.current().pending;
    await c.recover(); await c.recover(); await c.updateContext(true); await c.submit();
    expect(c.current()).toMatchObject({pending, draft: "Borrador protegido", contextDraft: "Notas protegidas", status: "unknown"});
    expect(server.calls.filter(call => call.method === "POST")).toHaveLength(1);
    expect(c.hasUnsavedChanges()).toBe(true); expect(c.discardDrafts()).toBe(false);
  });
  it("a lost update recovers its exact revision even after another update, then refreshes latest", async () => {
    const server = new ChatServer(); server.documents.set(chatId, chatDocument()); const c = await start(server);
    c.setContextDraft("Primera revisión");
    server.intercept = call => { if (call.method === "POST") { server.handle(call); throw Error("Lost"); } };
    await c.updateContext(); server.intercept = undefined;
    const api = new AcentaApi(session, server.transport); await api.updateChatContext(chatId, "Corrección posterior", 0, 1, crypto.randomUUID());
    await c.recover(); expect(c.current().pending).toBeNull(); expect(c.current().needsRefresh).toBe(true);
    c.setDraft("No enviar con contexto viejo"); await c.submit();
    expect(server.calls.filter(call => call.path.endsWith("/turns"))).toHaveLength(0);
    await c.refresh(); expect(c.current().document?.context.notes).toBe("Corrección posterior"); expect(c.current().needsRefresh).toBe(false);
  });
  it("refreshes unseen other-tab turns after a context receipt even when its revision matches", async () => {
    const server = new ChatServer(), doc = chatDocument(); fill(doc, 1, 2); server.documents.set(chatId, doc);
    const c = await start(server); c.setDraft("Mensaje conservado"); c.setContextDraft("Notas confirmables");
    server.intercept = call => { if (call.method === "POST") { server.handle(call); throw Error("Lost context response"); } };
    await c.updateContext(); server.intercept = undefined; appendTurn(doc, crypto.randomUUID(), "Turno de otra pestaña");
    await c.recover();
    expect(c.current()).toMatchObject({draft: "Mensaje conservado", pending: null, needsRefresh: true,
      document: {context: {revision: 1}, conversation: {version: 3}}});
    expect(c.current().document?.turns).toHaveLength(2);
    c.setContextDraft("Corrección local pendiente"); await c.updateContext(); await c.submit();
    expect(server.calls.filter(call => call.method === "POST")).toHaveLength(1);
    await c.refresh(); expect(c.current()).toMatchObject({needsRefresh: false, draft: "Mensaje conservado", contextDraft: "Corrección local pendiente"});
    expect(c.current().document?.turns).toHaveLength(3);
  });
  it("retains whitespace editing intermediates but does not admit them as manual context", async () => {
    const server = new ChatServer(); server.documents.set(chatId, chatDocument()); const c = await start(server);
    expect(c.setContextDraft(" \n")).toBe(true); expect(c.current().contextDraft).toBe(" \n"); await c.updateContext();
    expect(server.calls.every(call => call.method === "GET")).toBe(true);
    expect(c.setContextDraft(" \nCorrección manual")).toBe(true); await c.updateContext();
    expect(c.current().document?.context.notes).toBe(" \nCorrección manual");
  });
  it("context conflicts preserve both texts until refresh and an explicit new action", async () => {
    const server = new ChatServer(); server.documents.set(chatId, chatDocument()); const c = await start(server);
    c.setDraft("Mensaje conservado"); c.setContextDraft("Mi corrección");
    await new AcentaApi(session, server.transport).updateChatContext(chatId, "Otra pestaña", 0, 0, crypto.randomUUID());
    await c.updateContext(); await c.updateContext();
    expect(c.current()).toMatchObject({pending: null, needsRefresh: true, draft: "Mensaje conservado", contextDraft: "Mi corrección"});
    await c.refresh(); expect(c.current().contextDraft).toBe("Mi corrección"); await c.updateContext();
    expect(c.current().document?.context).toMatchObject({revision: 2, previous_revision: 1, notes: "Mi corrección"});
  });
  it.each(["suspend", "close"] as const)("late context completion after %s cannot reopen private state", async action => {
    const server = new ChatServer(); server.documents.set(chatId, chatDocument()); const c = await start(server), gate = deferredResponse();
    let response: Response;
    server.intercept = call => { if (call.method === "POST") { response = server.handle(call); return gate.promise; } };
    c.setContextDraft("Notas privadas"); const saving = c.updateContext(); c[action](); gate.resolve(response!); await saving;
    if (action === "close") expect(JSON.stringify(c.snapshot())).not.toContain("Notas privadas");
    else { expect(c.current().pending?.kind).toBe("context"); c.resume(); await c.recover(); expect(c.current().document?.context.revision).toBe(1); }
    expect(server.calls.filter(call => call.method === "POST")).toHaveLength(1);
  });
  it("treats unsaved context as guarded work and never writes it into browser storage", async () => {
    const server = new ChatServer(); server.documents.set(chatId, chatDocument()); const writes: string[] = [];
    const c = new AcentaController(new AcentaApi(session, server.transport), {getItem: () => null, setItem: (_key, value) => writes.push(value), removeItem() {}});
    await c.chat.openActive(); c.chat.setContextDraft("Contexto local privado"); expect(c.chat.hasUnsavedChanges()).toBe(true);
    c.navigate("planning"); c.navigate("home"); expect(c.chat.current().contextDraft).toBe("Contexto local privado");
    expect(JSON.stringify(writes)).not.toContain("Contexto local privado"); c.closeSession(); expect(c.chat.hasUnsavedChanges()).toBe(false);
  });
});
it("validates bounded pages and exact context receipts including maximal escaped assistant text", async () => {
  const doc = appendTurn(chatDocument(), crypto.randomUUID(), "Unicode 😀"); doc.turns[0].assistant_text = "a" + "\u0001".repeat(32767);
  expect(parseChatDocument(doc).turns[0].assistant_text?.length).toBe(32768);
  const excessive = structuredClone(doc); excessive.turns[0].assistant_text += "x"; expect(() => parseChatDocument(excessive)).toThrow();
  const server = new ChatServer(); server.documents.set(chatId, chatDocument());
  const api = new AcentaApi(session, server.transport), key = crypto.randomUUID();
  const receipt = await api.updateChatContext(chatId, "Texto manual", 0, 0, key);
  for (const changed of [ {...receipt, context: {...receipt.context, notes: "Sustituido"}}, {...receipt, context: {...receipt.context, operation_id: crypto.randomUUID()}}, {...receipt, context: {...receipt.context, through_turn: 1}} ]) {
    server.intercept = () => json(changed);
    await expect(api.chatContextOperation(chatId, "Texto manual", 0, 0, key)).rejects.toMatchObject({code: "invalid_response"});
  }
  const receiptDoc = turnReceipt(doc, doc.turns[0].operation_id); receiptDoc.turns.push({...doc.turns[0], operation_id: crypto.randomUUID(), number: 2}); receiptDoc.conversation.version = 2;
  server.intercept = () => json(receiptDoc);
  await expect(api.chatTurnOperation(chatId, doc.turns[0].operation_id)).rejects.toMatchObject({code: "invalid_response"});
});
