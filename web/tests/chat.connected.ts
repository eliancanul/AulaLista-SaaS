/** Production UI + real cookies/CSRF/HTTP/PostgreSQL; no page.route or model calls. */
import { expect, test, type Page } from "@playwright/test";
import type { ChatDocument } from "../src/acenta/chat-contracts";
type Session = {principal_id: string; scope_id: string; csrf_token: string};
const origin = "http://localhost:4175";
const firstText = "Recuerda la palabra farol para esta conversación sintética.";
const secondText = "¿Qué palabra acordamos? Responde usando el contexto confirmado.";

async function login(page: Page, email: string): Promise<Session> {
  await page.goto("/");
  await page.getByRole("button", {name: "Continuar con correo", exact: true}).click();
  await page.getByLabel("Correo electrónico", {exact: true}).fill(email);
  await page.getByRole("button", {name: "Enviar código", exact: true}).click();
  await expect(page.getByLabel("Código de un uso", {exact: true})).toBeVisible();
  const mailbox = await page.request.get(`/__test__/mailbox?email=${encodeURIComponent(email)}`);
  expect(mailbox.status()).toBe(200);
  const {code} = await mailbox.json();
  try { await page.getByLabel("Código de un uso", {exact: true}).fill(code); }
  catch { throw new Error("Could not enter the synthetic one-time code (value withheld)."); }
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === "/auth/email/verify");
  await page.getByRole("button", {name: "Verificar código", exact: true}).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  await expect(page.getByRole("button", {name: "Cerrar sesión", exact: true})).toBeVisible();
  return response.json();
}

test("private multi-turn chat survives reload and account changes without new generation", async ({page}) => {
  const privateCalls: {method: string; path: string}[] = [], external: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && url.origin !== origin) external.push(url.origin);
    if (url.pathname.startsWith("/scopes/")) privateCalls.push({method: request.method(), path: url.pathname});
  });
  const owner = await login(page, "chat-pilot-a@example.test");
  const input = page.getByLabel("Mensaje para Luna", {exact: true});
  await expect(input).toBeVisible();
  const send = async (text: string) => {
    await input.fill(text);
    const pending = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/turns"));
    await page.getByRole("button", {name: "Enviar mensaje", exact: true}).click();
    const response = await pending;
    expect(response.status()).toBe(201);
    await expect(input).toHaveValue("");
    return await response.json() as ChatDocument;
  };
  const first = await send(firstText);
  expect(first.conversation.version).toBe(1);
  expect(first.turns[0].user_text).toBe(firstText);
  expect(first.turns[0].state).toBe("succeeded");
  await expect(page.getByRole("article", {name: "Respuesta 1", exact: true})).toContainText("farol");
  const second = await send(secondText);
  expect(second.conversation.id).toBe(first.conversation.id);
  expect(second.conversation.version).toBe(2);
  expect(second.turns[1].user_text).toBe(secondText);
  // The Python fake only emits this when the request includes the first assistant
  // answer containing "farol"; it must not infer it from the second user text.
  expect(second.turns[1].assistant_text).toContain("Contexto confirmado: farol");
  await expect(page.getByRole("article", {name: "Respuesta 2", exact: true})).toContainText("Contexto confirmado: farol");
  const usage = page.getByRole("article", {name: "Respuesta 2", exact: true});
  await usage.getByText("Consumo de este turno", {exact: true}).click();
  await expect(usage).toContainText("Tokens de entrada observados");
  await expect(usage).toContainText("Reserva del intento");
  await expect(usage).toContainText("no es consumo observado ni una factura");
  await page.setViewportSize({width: 360, height: 800});
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({width: 1280, height: 900});

  // No confirmed conversation or draft enters browser storage/history/URL.
  const browserData = await page.evaluate(() => ({
    local: {...localStorage}, session: {...sessionStorage}, history: history.state, url: location.href,
  }));
  expect(JSON.stringify(browserData)).not.toContain(firstText);
  expect(JSON.stringify(browserData)).not.toContain(secondText);
  expect(JSON.stringify(browserData.history)).not.toContain(first.conversation.id);
  const postsBeforeRead = privateCalls.filter(call => call.method === "POST").length;
  expect(privateCalls.filter(call => call.method === "POST" && call.path.endsWith("/turns"))).toHaveLength(2);
  await page.reload();
  await page.getByRole("button", {name: "Conversaciones", exact: true}).click();
  await expect(page.getByRole("button", {name: "Abrir conversación", exact: true})).toHaveCount(1);
  await page.getByRole("button", {name: "Abrir conversación", exact: true}).click();
  await expect(page.getByRole("article", {name: "Tu mensaje 1", exact: true})).toContainText(firstText);
  await expect(page.getByRole("article", {name: "Respuesta 2", exact: true})).toContainText("Contexto confirmado: farol");
  expect(privateCalls.filter(call => call.method === "POST")).toHaveLength(postsBeforeRead);

  await input.fill("Borrador privado nunca enviado");
  await page.getByRole("button", {name: "Cerrar sesión", exact: true}).click();
  const exit = page.getByRole("dialog", {name: "¿Salir con mensajes pendientes?", exact: true});
  await expect(exit).toBeVisible();
  await exit.getByRole("button", {name: "Revisar mensajes pendientes", exact: true}).click();
  await page.getByRole("button", {name: "Abrir conversación", exact: true}).click();
  await expect(input).toHaveValue("Borrador privado nunca enviado");
  await page.getByRole("button", {name: "Cerrar sesión", exact: true}).click();
  await exit.getByRole("button", {name: "Descartar mensajes sin enviar y continuar salida", exact: true}).click();
  await expect(page.getByRole("button", {name: "Continuar con correo", exact: true})).toBeVisible();
  const other = await login(page, "chat-pilot-b@example.test");
  await expect(input).toHaveValue("");
  await page.getByRole("button", {name: "Conversaciones", exact: true}).click();
  await expect(page.getByText("Aún no tienes conversaciones guardadas.", {exact: true})).toBeVisible();
  expect((await page.request.get(`/scopes/${other.scope_id}/conversations/${first.conversation.id}`)).status()).toBe(404);
  expect((await page.request.get(`/scopes/${owner.scope_id}/conversations/${first.conversation.id}`)).status()).toBe(404);
  expect(privateCalls.filter(call => call.method === "POST" && call.path.endsWith("/turns"))).toHaveLength(2);
  expect(external).toEqual([]);
});
