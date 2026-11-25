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

test("private multi-turn chat survives reload and account changes without new generation", async ({page}, info) => {
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
  expect(second.turns[0].user_text).toBe(secondText);
  // The Python fake only emits this when the request includes the first assistant
  // answer containing "farol"; it must not infer it from the second user text.
  expect(second.turns[0].assistant_text).toContain("Contexto confirmado: farol");
  await expect(page.getByRole("article", {name: "Respuesta 2", exact: true})).toContainText("Contexto confirmado: farol");
  const usage = page.getByRole("article", {name: "Respuesta 2", exact: true});
  await usage.getByText("Consumo de este turno", {exact: true}).click();
  await expect(usage).toContainText("Tokens de entrada observados");
  await expect(usage).toContainText("Reserva del intento");
  await expect(usage).toContainText("no es consumo observado ni una factura");
  await page.screenshot({path: info.outputPath("chat-synthetic-desktop.png")});
  await page.setViewportSize({width: 360, height: 800});
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: info.outputPath("chat-synthetic-mobile.png")});
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
  await expect(page.getByRole("article", {name: "Tu mensaje 1", exact: true})).toContainText(firstText);
  await expect(page.getByRole("article", {name: "Respuesta 2", exact: true})).toContainText("Contexto confirmado: farol");
  expect(privateCalls.filter(call => call.method === "POST")).toHaveLength(postsBeforeRead);

  await input.fill("Borrador privado nunca enviado");
  await input.evaluate(node => node.setAttribute("data-composer-retained", "yes"));
  for (const name of ["Mis recursos", "Herramientas"]) {
    await page.getByRole("button", {name, exact: true}).click();
    await expect(page.getByRole("region", {name, exact: true})).toBeVisible();
    await expect(input).toHaveValue("Borrador privado nunca enviado");
    await expect(input).toHaveAttribute("data-composer-retained", "yes");
  }
  // Support is a modal dialog over the open panel, not a panel of its own.
  await page.getByRole("button", {name: "Soporte", exact: true}).click();
  await expect(page.getByRole("dialog", {name: "Soporte", exact: true})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", {name: "Soporte", exact: true})).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Soporte", exact: true})).toBeFocused();
  await expect(input).toHaveValue("Borrador privado nunca enviado");
  await expect(input).toHaveAttribute("data-composer-retained", "yes");
  expect(privateCalls.filter(call => call.method === "POST")).toHaveLength(postsBeforeRead);
  await page.getByRole("button", {name: "Cerrar sesión", exact: true}).click();
  const exit = page.getByRole("dialog", {name: "¿Salir con mensajes pendientes?", exact: true});
  await expect(exit).toBeVisible();
  await exit.getByRole("button", {name: "Revisar mensajes pendientes", exact: true}).click();
  await expect(input).toHaveValue("Borrador privado nunca enviado");
  await page.getByRole("button", {name: "Cerrar sesión", exact: true}).click();
  await exit.getByRole("button", {name: "Descartar mensajes sin enviar y continuar salida", exact: true}).click();
  await expect(page.getByRole("button", {name: "Continuar con correo", exact: true})).toBeVisible();
  const other = await login(page, "chat-pilot-b@example.test");
  await expect(input).toHaveValue("");
  await page.getByRole("button", {name: "Consultar archivo anterior", exact: true}).click();
  await expect(page.getByText("No hay historiales anteriores guardados.", {exact: true})).toBeVisible();
  expect((await page.request.get(`/scopes/${other.scope_id}/conversations/${first.conversation.id}`)).status()).toBe(404);
  expect((await page.request.get(`/scopes/${owner.scope_id}/conversations/${first.conversation.id}`)).status()).toBe(404);
  expect(privateCalls.filter(call => call.method === "POST" && call.path.endsWith("/turns"))).toHaveLength(2);
  expect(external).toEqual([]);
});

test("uncertain: explicit logout revokes the session without replaying the turn", async ({page}) => {
  const privateCalls: {method: string; path: string}[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/scopes/")) privateCalls.push({method: request.method(), path});
  });
  await login(page, "chat-pilot-a@example.test");
  const text = "Provoca incertidumbre sintética sin datos privados.";
  await page.getByLabel("Mensaje para Luna", {exact: true}).fill(text);
  const sending = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/turns"));
  await page.getByRole("button", {name: "Enviar mensaje", exact: true}).click();
  expect((await sending).status()).toBe(409);
  const consult = page.getByRole("button", {name: "Consultar estado del envío", exact: true});
  await expect(consult).toBeEnabled();
  await expect(page.getByLabel("Mensaje para Luna", {exact: true})).toHaveValue(text);
  const querying = page.waitForResponse(response => response.request().method() === "GET" && /\/conversations\/[^/]+\/operations\/[^/]+$/.test(new URL(response.url()).pathname));
  await consult.click();
  const queried = await querying;
  expect(queried.status()).toBe(200);
  const document: ChatDocument = await queried.json();
  expect(document.turns).toHaveLength(1);
  expect(document.turns[0]).toMatchObject({state: "uncertain", user_text: text, assistant_text: null});
  await expect(consult).toBeEnabled();
  expect(privateCalls.filter(call => call.method === "POST" && call.path.endsWith("/turns"))).toHaveLength(1);
  await page.getByRole("button", {name: "Soporte", exact: true}).click();
  await expect(page.getByRole("dialog", {name: "Soporte", exact: true})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", {name: "Soporte", exact: true})).toHaveCount(0);
  const callsBeforeLogout = privateCalls.length;

  await page.getByRole("button", {name: "Cerrar sesión", exact: true}).click();
  const exit = page.getByRole("dialog", {name: "¿Salir con mensajes pendientes?", exact: true});
  await expect(exit).toContainText("Cerrar sesión no cancela el procesamiento");
  const closing = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/auth/logout");
  await exit.getByRole("button", {name: "Continuar cierre de sesión sin confirmar el envío", exact: true}).click();
  expect((await closing).status()).toBe(204);
  await expect(page.getByRole("button", {name: "Continuar con correo", exact: true})).toBeVisible();
  expect((await page.request.get("/auth/session")).status()).toBe(401);
  expect(privateCalls).toHaveLength(callsBeforeLogout);
  expect(privateCalls.filter(call => call.method === "POST" && call.path.endsWith("/turns"))).toHaveLength(1);
});

test("versioned context: manual notes and reset retain one chat and its history", async ({page, context}, info) => {
  const writes: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/scopes/")) writes.push(new URL(request.url()).pathname);
  });
  const owner = await login(page, "chat-pilot-a@example.test");
  const input = page.getByLabel("Mensaje para Luna", {exact: true});
  const send = async (text: string) => {
    await input.fill(text);
    const pending = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/turns"));
    await page.getByRole("button", {name: "Enviar mensaje", exact: true}).click();
    const response = await pending; expect(response.status()).toBe(201); await expect(input).toHaveValue("");
    return await response.json() as ChatDocument;
  };
  const first = await send(firstText); await send(secondText);
  expect(first.turns).toHaveLength(1);
  await expect(page.getByRole("button", {name: "Nueva conversación", exact: true})).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Conversaciones", exact: true})).toHaveCount(0);

  // A second tab reads the same singleton with no creation or generation.
  const secondTab = await context.newPage(); await secondTab.goto("/");
  await expect(secondTab.getByRole("article", {name: "Respuesta 2", exact: true})).toContainText("farol");
  const same = await secondTab.request.get(`/scopes/${owner.scope_id}/active-conversation`);
  expect(same.status()).toBe(200); expect((await same.json()).conversation.id).toBe(first.conversation.id); await secondTab.close();

  await input.fill("¿Qué palabra corresponde al contexto actualizado?");
  const trigger = page.getByRole("button", {name: "Revisar contexto", exact: true});
  await trigger.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("region", {name: "Contexto del chat", exact: true});
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Los mensajes anteriores seguirán visibles, pero dejarán de enviarse al modelo.");
  await dialog.getByLabel("Notas para el próximo contexto", {exact: true}).fill("Contexto nuevo: usamos la palabra brújula, no farol.");
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  await expect(input).toHaveValue("¿Qué palabra corresponde al contexto actualizado?");
  await trigger.click(); await expect(dialog.getByLabel("Notas para el próximo contexto", {exact: true})).toHaveValue("Contexto nuevo: usamos la palabra brújula, no farol.");
  const saved = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/context"));
  await dialog.getByRole("button", {name: "Guardar notas y comenzar contexto", exact: true}).click();
  expect((await saved).status()).toBe(201); await expect(dialog).toContainText("Contexto guardado: revisión 1.");
  await page.screenshot({path: info.outputPath("chat-context-synthetic-desktop.png")});
  await page.setViewportSize({width: 360, height: 540});
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button", {name: "Cerrar panel", exact: true}).click(); await expect(trigger).toBeFocused();
  await expect(input).toHaveValue("¿Qué palabra corresponde al contexto actualizado?");
  const third = await send("¿Qué palabra corresponde al contexto actualizado?");
  expect(third.turns).toHaveLength(1); expect(third.turns[0]).toMatchObject({number: 3, context_revision: 1, assistant_text: "Contexto actualizado: brújula"});
  const fourth = await send("Confirma la palabra del contexto nuevo.");
  expect(fourth.turns).toHaveLength(1); expect(fourth.turns[0]).toMatchObject({number: 4, context_revision: 1, assistant_text: "Contexto confirmado: brújula"});
  await page.screenshot({path: info.outputPath("chat-context-synthetic-mobile.png")});
  const beforeReload = writes.length; await page.reload();
  await expect(page.getByRole("article", {name: "Tu mensaje 1", exact: true})).toContainText(firstText);
  await expect(page.getByRole("article", {name: "Respuesta 4", exact: true})).toContainText("Contexto confirmado: brújula");
  expect(writes).toHaveLength(beforeReload);
  await trigger.click();
  const reset = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/context"));
  await dialog.getByRole("button", {name: "Reiniciar contexto sin borrar historial", exact: true}).click();
  const response = await reset; expect(response.status()).toBe(201);
  expect((await response.json()).context).toMatchObject({revision: 2, previous_revision: 1, through_turn: 4, notes: "", origin: "reset"});
  await expect(dialog).toContainText("Contexto guardado: revisión 2."); await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByRole("article", {name: "Tu mensaje 1", exact: true})).toContainText(firstText);
  await expect(page.getByRole("article", {name: "Respuesta 4", exact: true})).toContainText("Contexto confirmado: brújula");
  await expect(page.getByText("Contexto activo · revisión 2.", {exact: false})).toBeVisible();
  expect(writes.filter(path => path.endsWith("/turns"))).toHaveLength(4);
  expect(writes.filter(path => path.endsWith("/context"))).toHaveLength(2);
  const persisted = await page.request.get(`/scopes/${owner.scope_id}/active-conversation`);
  expect((await persisted.json()).conversation.id).toBe(first.conversation.id);
});
