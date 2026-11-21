import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AcentaApi } from "../src/acenta/api";
import { Chat } from "../src/acenta/Chat";
import { AcentaController } from "../src/acenta/controller";
import { session } from "./acenta-fixtures";
import { appendTurn, chatDocument, chatId, ChatServer } from "./chat-fixtures";

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useSyncExternalStore: <T,>(_subscribe: unknown, snapshot: () => T) =>
      snapshot(),
  };
});

const renderChat = (controller: AcentaController) =>
  renderToStaticMarkup(
    createElement(Chat, { controller, onPlan() {}, onContext() {} }),
  );

it("shows borderless school/subject context and contextual composer placeholder", () => {
  const c = new AcentaController(
    new AcentaApi(session, new ChatServer().transport),
  );
  let html = renderChat(c);
  expect(html).toContain("Benito Juárez · 4.º A");
  expect(html).toContain(">Matemáticas</h1>");
  expect(html).toContain(
    "Pide una ficha o planeación de Matemáticas para 4.º A…",
  );
  expect(html).toContain('aria-label="Opciones del chat"');
  expect(html).toContain("Consultar archivo anterior");
  expect(html).toContain("Revisar contexto");
  expect(html).toContain("Planear");

  c.schools.switchSchool("hidalgo");
  c.schools.selectSubject("hidalgo", "hidalgo-con");
  html = renderChat(c);
  expect(html).toContain("Miguel Hidalgo · 3.º B");
  expect(html).toContain(">Conocimiento del Medio</h1>");
  expect(html).toContain(
    "Pide una ficha o planeación de Conocimiento del Medio para 3.º B…",
  );
});

it("renders archived-topic divider after turns excluded by through_turn", async () => {
  const server = new ChatServer();
  const c = new AcentaController(new AcentaApi(session, server.transport));
  let doc = appendTurn(chatDocument(), crypto.randomUUID(), "Turno archivado");
  doc.context = {
    ...doc.context,
    revision: 1,
    previous_revision: 0,
    through_turn: 1,
    notes: "",
    origin: "reset",
    operation_id: crypto.randomUUID(),
  };
  doc.conversation.context_revision = 1;
  doc = appendTurn(doc, crypto.randomUUID(), "Turno nuevo");
  server.documents.set(chatId, doc);
  await c.chat.open(chatId);

  const html = renderChat(c);
  expect(html).toContain("chat-turn is-archived");
  expect(html).toContain("Conversación anterior · archivada");
  expect(html.indexOf("Turno archivado")).toBeLessThan(
    html.indexOf("Conversación anterior · archivada"),
  );
  expect(html.indexOf("Conversación anterior · archivada")).toBeLessThan(
    html.indexOf("Turno nuevo"),
  );
});

it("omits archived-topic divider when through_turn is zero", async () => {
  const server = new ChatServer();
  const c = new AcentaController(new AcentaApi(session, server.transport));
  const doc = appendTurn(chatDocument(), crypto.randomUUID(), "Primer turno");
  server.documents.set(chatId, doc);
  await c.chat.open(chatId);

  const html = renderChat(c);
  expect(html).not.toContain("Conversación anterior · archivada");
  expect(html).not.toContain("chat-turn is-archived");
});
