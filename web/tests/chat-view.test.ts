import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AcentaApi } from "../src/acenta/api";
import { AuthApi, AuthController } from "../src/acenta/auth";
import { AcentaController } from "../src/acenta/controller";
import { Chat, ChatUsageDetails, Conversations } from "../src/acenta/Chat";
import { appendTurn, chatDocument, chatId, ChatServer, deferredResponse } from "./chat-fixtures";
import { json, session } from "./acenta-fixtures";
vi.mock("react", async original => {
  const react = await original<typeof import("react")>();
  return {...react, useSyncExternalStore: <T,>(_subscribe: unknown, snapshot: () => T) => snapshot()};
});
const render = (controller: AcentaController) => renderToStaticMarkup(createElement(Chat, {controller, onExample() {}, onTools() {}}));
it("renders escaped text, multiline answers and observed usage separately from reserve", async () => {
  const server = new ChatServer(), c = new AcentaController(new AcentaApi(session, server.transport));
  const doc = appendTurn(chatDocument(), crypto.randomUUID(), "<script>private()</script>\nPregunta");
  doc.turns[0].assistant_text = "<img src=x onerror=private()>\nRespuesta";
  server.documents.set(chatId, doc); await c.chat.open(chatId);
  const html = render(c);
  expect(html).toContain("&lt;script&gt;private()&lt;/script&gt;\nPregunta");
  expect(html).toContain("&lt;img src=x onerror=private()&gt;\nRespuesta");
  expect(html).not.toContain("<script>"); expect(html).not.toContain("<img src=\"x\"");
  expect(html).toContain("Tokens de entrada observados"); expect(html).toContain("23");
  expect(html).toContain("0.000120 USD"); expect(html).toContain("Reserva del intento");
  expect(html).toContain("no es consumo observado ni una factura"); expect(html).toContain("saldo disponible no está informado");
});
it("unknown usage never renders as zero or a known billed cost", () => {
  const html = renderToStaticMarkup(createElement(ChatUsageDetails, {usage: {input_tokens: null, output_tokens: null, estimated_cost_usd: null, reserved_usd: "0.02"}}));
  expect(html.match(/Desconocido/g)).toHaveLength(3); expect(html).not.toContain("<dd>0</dd>");
  expect(html).toContain("0.02 USD");
});
it("shows an accessible text-only composer and preserves planning entry points", () => {
  const c = new AcentaController(new AcentaApi(session, new ChatServer().transport)), html = render(c);
  expect(html).toContain('for="chat-message"'); expect(html).toContain('aria-describedby="chat-input-hint"');
  expect(html).toContain("Enviar mensaje"); expect(html).toContain("Crear planeación"); expect(html).toContain("Ajustar planeación");
  expect(html).toContain("Mis recursos"); expect(html).not.toContain("Adjuntar");
});
it("history errors differ from empty state and retained drafts stay discoverable", async () => {
  const server = new ChatServer(), c = new AcentaController(new AcentaApi(session, server.transport));
  c.chat.setDraft("Privado sin confirmar"); server.intercept = () => json({detail: "unavailable"}, 503);
  await c.chat.list(); let html = renderToStaticMarkup(createElement(Conversations, {controller: c}));
  expect(html).toContain('role="alert"'); expect(html).not.toContain("Aún no tienes conversaciones");
  expect(html).toContain("Texto pendiente en esta pestaña"); expect(html).not.toContain("Privado sin confirmar");
  server.intercept = undefined; await c.chat.list(); html = renderToStaticMarkup(createElement(Conversations, {controller: c}));
  expect(html).toContain("Aún no tienes conversaciones");
});
function authenticated() {
  const server = new ChatServer();
  let identity = {...session, csrf: "chat-session-csrf"};
  let privateStatus = 200;
  const auth = new AuthController(new AuthApi(async (input, init) => {
    const path = String(input);
    if (path === "/auth/session") return json({principal_id: identity.actorId, scope_id: identity.scopeId, csrf_token: identity.csrf});
    if (path === "/auth/bootstrap") return json({csrf_token: "pre", google_nonce: "nonce", google_client_id: null, email_available: false});
    if (path === "/auth/logout") return new Response(null, {status: 204});
    if (privateStatus !== 200) return json({detail: "unauthorized"}, privateStatus);
    return server.transport(input, init);
  }));
  return {auth, server, deny: (status: number) => {privateStatus = status;}, change: () => {identity = {...identity, actorId: crypto.randomUUID(), scopeId: crypto.randomUUID()};}};
}
it("actual auth wrapper attaches CSRF to chat writes and purges memory on logout", async () => {
  const {auth, server} = authenticated(); await auth.start(); const c = auth.snapshot().controller!;
  await c.chat.loadAvailability(); c.chat.setDraft("Mensaje autenticado"); await c.chat.submit();
  expect(server.calls.filter(call => call.method === "POST").map(call => new Headers(call.init.headers).get("X-CSRF-Token"))).toEqual(["chat-session-csrf", "chat-session-csrf"]);
  c.chat.setDraft("Texto aún sin enviar"); await auth.logout();
  expect(c.snapshot().closed).toBe(true); expect(c.chat.hasUnsavedChanges()).toBe(false);
  expect(JSON.stringify(c.chat.snapshot())).not.toMatch(/Mensaje autenticado|Texto aún sin enviar/);
});
it.each([401, 403])("auth status %i clears drafts and rejects the late private response", async status => {
  const {auth, deny} = authenticated(); await auth.start(); const c = auth.snapshot().controller!;
  await c.chat.loadAvailability(); c.chat.setDraft("Texto privado"); deny(status); await c.chat.submit();
  expect(c.snapshot().closed).toBe(true); expect(c.chat.hasUnsavedChanges()).toBe(false);
  expect(JSON.stringify(c.chat.snapshot())).not.toContain("Texto privado");
});
it("revalidation of a different account discards the previous chat controller", async () => {
  const {auth, change} = authenticated(); await auth.start(); const previous = auth.snapshot().controller!;
  previous.chat.setDraft("Borrador de la primera cuenta"); change(); await auth.revalidate(true);
  expect(previous.snapshot().closed).toBe(true); expect(previous.chat.hasUnsavedChanges()).toBe(false);
  expect(auth.snapshot().controller).not.toBe(previous);
  expect(auth.snapshot().controller!.chat.current().draft).toBe("");
});
it("auth suspension keeps pending memory but admits a response only after matching session recovery", async () => {
  const {auth, server} = authenticated(); await auth.start(); const c = auth.snapshot().controller!;
  await c.chat.loadAvailability(); server.documents.set(chatId, chatDocument()); await c.chat.open(chatId);
  const gate = deferredResponse(); let confirmed: Response;
  server.intercept = call => { if (call.method === "POST") {confirmed = server.handle(call); return gate.promise;} };
  c.chat.setDraft("Envío privado pendiente"); const sending = c.chat.submit(); auth.suspend();
  gate.resolve(confirmed!); await sending; expect(c.chat.current().status).toBe("unknown");
  expect(c.chat.hasUnsavedChanges()).toBe(true); await auth.revalidate(true); await c.chat.recover();
  expect(c.chat.current().document?.turns).toHaveLength(1); expect(c.chat.current().draft).toBe("");
  expect(server.calls.filter(call => call.method === "POST")).toHaveLength(1);
});
