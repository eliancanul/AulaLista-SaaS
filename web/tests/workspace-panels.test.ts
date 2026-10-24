import { expect, it } from "vitest";
import { AcentaController, type View } from "../src/acenta/controller";
import { AcentaApi } from "../src/acenta/api";
import { AcentaNavigation } from "../src/acenta/navigation";
import { appendTurn, chatDocument, chatId, ChatServer, otherChatId } from "./chat-fixtures";
import { json, session } from "./acenta-fixtures";
async function setup() {
  const server = new ChatServer(); server.documents.set(chatId, chatDocument()); server.documents.set(otherChatId, chatDocument(otherChatId));
  const api = new AcentaApi(session, (url, init) => {
    const path = String(url);
    return /\/(?:active-conversation|chat-capability|conversations)/.test(path) ? server.transport(url, init) : Promise.resolve(json({items: [], next_cursor: null}));
  });
  const c = new AcentaController(api); await c.chat.openActive();
  return {c, server};
}
it.each(["resources", "tools", "support", "chat-context"])("%s navigation returns from an archive to the active draft without mutation", async panel => {
  const {c, server} = await setup(); c.chat.setDraft("Mensaje local"); c.chat.setContextDraft("Notas locales");
  c.openChat(otherChatId); await c.chat.refresh(); expect(c.chat.isArchive()).toBe(true);
  c.navigate(panel as View);
  expect(c.chat.isArchive()).toBe(false); expect(c.chat.snapshot().activeId).toBe(chatId);
  expect(c.chat.current()).toMatchObject({draft: "Mensaje local", contextDraft: "Notas locales"});
  expect(server.calls.every(call => call.method === "GET")).toBe(true);
});
it("panel back/forward retains active work and opaque browser markers", async () => {
  const {c, server} = await setup(), markers: unknown[] = [];
  const nav = new AcentaNavigation(c, {replaceState: value => markers.push(value), pushState: value => markers.push(value)}, () => ({x: 0, y: 12, focus: "panel-support"}), () => {});
  c.chat.setDraft("Mensaje privado"); c.chat.setContextDraft("Contexto privado");
  for (const view of ["resources", "tools", "support", "chat-context"]) c.navigate(view as View);
  c.navigate("home");
  nav.restore(markers[2]); expect(c.snapshot().view).toBe("tools");
  nav.restore(markers[4]); expect(c.snapshot().view).toBe("chat-context");
  expect(c.chat.current()).toMatchObject({draft: "Mensaje privado", contextDraft: "Contexto privado"});
  expect(JSON.stringify(markers)).not.toMatch(/Mensaje privado|Contexto privado|71000000|chat-context/);
  expect(server.calls.every(call => call.method === "GET")).toBe(true); nav.dispose();
});
it("opening and closing panels retains an uncertain chat operation and its logout guard", async () => {
  const {c, server} = await setup();
  const doc = appendTurn(chatDocument(), crypto.randomUUID(), "Mensaje incierto", "uncertain"); server.documents.set(chatId, doc); await c.chat.refresh();
  const pending = c.chat.current().pending;
  for (const view of ["resources", "tools", "support", "chat-context", "home"]) c.navigate(view as View);
  expect(c.chat.current().pending).toBe(pending); expect(c.chat.hasUnsavedChanges()).toBe(true);
  await c.chat.recover(); expect(c.chat.current().pending?.key).toBe(pending?.key);
  expect(server.calls.every(call => call.method === "GET")).toBe(true);
});
