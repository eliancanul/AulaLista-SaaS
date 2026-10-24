import { expect, it } from "vitest";
import { parseChatDocument } from "../src/acenta/chat-contracts";
import { appendTurn, chatDocument } from "./chat-fixtures";
import { AcentaApi } from "../src/acenta/api";
import { ChatController } from "../src/acenta/chat-controller";
import { ChatServer, chatId, deferredResponse, turnReceipt } from "./chat-fixtures";
import { json, session } from "./acenta-fixtures";

it("accepts a versioned automatic summary without changing the admitted turn context", () => {
  const doc = appendTurn(chatDocument(), crypto.randomUUID(), "Continuamos");
  const compacted = {...doc, conversation: {...doc.conversation, version: 2, context_revision: 1},
    context: {...doc.context, revision: 1, previous_revision: 0, through_turn: 1,
      operation_id: crypto.randomUUID(), origin: "summary", notes: "No usar nombres de alumnos.",
      summary: {text: "Tema: agua. Corrección: 30 minutos, no 45.", from_turn: 1, steps: 1}}};
  expect(parseChatDocument(compacted).context).toEqual(compacted.context);
  expect(parseChatDocument(compacted).turns[0].context_revision).toBe(0);
});

it.each(["chat_budget_exhausted", "chat_compaction_limit"])("%s rejects admission and leaves the draft editable without recovery", async code => {
  const server = new ChatServer(); server.documents.set(chatId, chatDocument());
  const c = new ChatController(new AcentaApi(session, server.transport));
  await c.loadAvailability(); await c.openActive();
  server.intercept = call => call.method === "POST" ? json({detail: code}, code === "chat_budget_exhausted" ? 429 : 413) : undefined;
  c.setDraft("Borrador conservado"); await c.submit();
  expect(c.current().draft).toBe("Borrador conservado"); expect(c.current().pending).toBeNull();
  expect(c.current().error).toContain("No se inició el turno");
  c.setDraft("Borrador corregido"); expect(c.current().draft).toBe("Borrador corregido");
  const count = server.calls.length; await c.recover(); expect(server.calls).toHaveLength(count);
});

it("recovers a lost compaction response with one GET and preserves unrelated note edits", async () => {
  const server = new ChatServer(), doc = appendTurn(chatDocument(), crypto.randomUUID(), "Primer mensaje");
  server.documents.set(chatId, doc);
  const c = new ChatController(new AcentaApi(session, server.transport));
  await c.loadAvailability(); await c.openActive(); c.setContextDraft("No perder mis notas");
  server.intercept = call => {
    if (call.method !== "POST") return;
    appendTurn(doc, call.key!, "Continuar");
    doc.context = {...doc.context, revision: 1, previous_revision: 0, origin: "summary", operation_id: call.key!, through_turn: 1,
      summary: {text: "Corrección: 30 minutos, no 45.", from_turn: 1, steps: 1}};
    doc.conversation.context_revision = 1;
    throw Error("Response lost after commit");
  };
  c.setDraft("Continuar"); await c.submit(); expect(c.current().pending?.kind).toBe("turn");
  await c.recover();
  expect(c.current().document?.context.summary?.text).toContain("30 minutos, no 45");
  expect(c.current().draft).toBe(""); expect(c.current().contextDraft).toBe("No perder mis notas");
  expect(c.current().document?.turns).toHaveLength(2);
  expect(server.calls.filter(call => call.method === "POST")).toHaveLength(1);
  expect(server.calls.at(-1)?.path).toContain("/operations/");
});

it("ignores an older revision lookup that arrives after a newer lookup or session closure", async () => {
  const server = new ChatServer(), doc = chatDocument(); server.documents.set(chatId, doc);
  const c = new ChatController(new AcentaApi(session, server.transport)); await c.openActive();
  const late = deferredResponse(); let delayed = true;
  server.intercept = call => call.path.includes("context-revisions/") ? delayed ? late.promise : json({...doc, steps: []}) : undefined;
  const first = c.inspectContext(0); delayed = false; await c.inspectContext(0);
  c.close(); late.resolve(json({...doc, steps: []})); await first;
  expect(c.current().contextInspection).toBeNull(); expect(c.current().document).toBeNull();
});

it.each(["empty", "too large", "escaped too large", "range", "steps", "origin"])("rejects malformed automatic summary: %s", kind => {
  const doc = appendTurn(chatDocument(), crypto.randomUUID(), "Texto");
  const value = {...doc, conversation: {...doc.conversation, context_revision: 1}, context: {...doc.context,
    revision: 1, previous_revision: 0, operation_id: crypto.randomUUID(), origin: "summary", through_turn: 1,
    summary: {text: "Resumen", from_turn: 1, steps: 1}}};
  if (kind === "empty") value.context.summary.text = " ";
  if (kind === "too large") value.context.summary.text = "😀".repeat(1024);
  if (kind === "escaped too large") value.context.summary.text = "\\".repeat(2048);
  if (kind === "range") value.context.summary.from_turn = 2;
  if (kind === "steps") value.context.summary.steps = 9;
  if (kind === "origin") value.context.origin = "reset";
  expect(() => parseChatDocument(value)).toThrow();
});

it("reviews an exact old context by GET without replacing active context or drafts", async () => {
  const server = new ChatServer(), original = chatDocument();
  const current = structuredClone(original);
  current.context = {...current.context, revision: 1, previous_revision: 0,
    origin: "manual", operation_id: crypto.randomUUID(), notes: "Notas vigentes"};
  current.conversation.context_revision = 1;
  server.documents.set(chatId, current);
  server.intercept = call => call.path.endsWith("context-revisions/0")
    ? json({...original, conversation: current.conversation, steps: []}) : undefined;
  const c = new ChatController(new AcentaApi(session, server.transport));
  await c.openActive(); c.setDraft("No perder"); c.setContextDraft("Corrección pendiente");
  await c.inspectContext(0);
  expect(c.current().contextInspection?.context.revision).toBe(0);
  expect(c.current().document?.context.notes).toBe("Notas vigentes");
  expect(c.current().draft).toBe("No perder");
  expect(c.current().contextDraft).toBe("Corrección pendiente");
  expect(server.calls.every(call => call.method === "GET")).toBe(true);
});
