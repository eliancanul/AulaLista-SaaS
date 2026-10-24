import { expect, test, type Page } from "@playwright/test";
import { appendTurn, chatDocument, chatId, ChatServer } from "./chat-fixtures";

async function access(page: Page, available = true) {
  await page.route("**/auth/session", route => route.fulfill({status: 401, json: {detail: "unauthorized"}}));
  await page.route("**/auth/bootstrap", route => route.fulfill(available ? {json: {
    csrf_token: "help-fixture", google_nonce: "help-fixture", google_client_id: null, email_available: true,
  }} : {status: 503, json: {detail: "unavailable"}}));
  await page.goto("/");
  await expect(page.getByRole("button", {name: "Ayuda de acceso", exact: true})).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test("help works before login with access unavailable, keyboard focus and no requests", async ({page}) => {
  await page.setViewportSize({width: 320, height: 568});
  await access(page, false);
  const requests: string[] = []; page.on("request", request => {
    if (request.method() === "GET" && request.url() === "http://127.0.0.1:4173/acenta/fonts/SourceSans3-Semibold.ttf") return;
    requests.push(request.url());
  });
  const trigger = page.getByRole("button", {name: "Ayuda de acceso", exact: true});
  await trigger.focus(); await page.keyboard.press("Enter");
  const help = page.getByRole("region", {name: "Ayuda de acceso", exact: true});
  await expect(help.getByRole("heading", {name: "Ayuda de acceso", exact: true})).toBeFocused();
  await expect(help).toContainText("No hay atención humana ni un plazo de respuesta comprometido.");
  await help.getByText("Acceso a tu cuenta", {exact: true}).click();
  await expect(help).toContainText("Google y correo pueden crear cuentas separadas");
  await expect(help.locator("form, input, textarea, a")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({path: test.info().outputPath("help-access-320.png"), fullPage: true});
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0); await expect(trigger).toBeFocused();
  expect(requests).toEqual([]);
});

test("opening access help retains email and an unfinished code without auth calls", async ({page}) => {
  await access(page);
  await page.getByRole("button", {name: "Continuar con correo", exact: true}).click();
  const email = page.getByLabel("Correo electrónico", {exact: true}); await email.fill("synthetic@example.test");
  const trigger = page.getByRole("button", {name: "Ayuda de acceso", exact: true});
  await trigger.click();
  await page.getByRole("button", {name: "Cerrar ayuda", exact: true}).click();
  await expect(email).toHaveValue("synthetic@example.test"); await expect(trigger).toBeFocused();
  await page.route("**/auth/email/request", route => route.fulfill({json: {challenge_id: "synthetic-challenge", message: "Código de prueba solicitado"}}));
  await page.getByRole("button", {name: "Enviar código", exact: true}).click();
  const code = page.getByLabel("Código de un uso", {exact: true}); await code.fill("1234");
  const requests: string[] = []; page.on("request", request => {
    if (request.method() === "GET" && request.url() === "http://127.0.0.1:4173/acenta/fonts/SourceSans3-Semibold.ttf") return;
    requests.push(request.url());
  });
  await trigger.click(); await page.getByRole("button", {name: "Cerrar ayuda", exact: true}).click();
  await expect(code).toHaveValue("1234");
  await expect(page.getByRole("heading", {name: "Revisa tu correo", exact: true})).toBeVisible();
  expect(requests).toEqual([]);
});

test("local support preserves an uncertain chat without replay or transmission", async ({page}) => {
  const chat = new ChatServer();
  chat.documents.set(chatId, appendTurn(chatDocument(), crypto.randomUUID(), "Mensaje sintético incierto", "uncertain"));
  await page.route("**/scopes/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const response = await chat.transport(url.pathname + url.search, {method: request.method(), headers: request.headers(), body: request.postData()});
    await route.fulfill({status: response.status, headers: Object.fromEntries(response.headers), body: await response.text()});
  });
  await page.goto("/tests/acenta.html?chat=1");
  await expect(page.getByRole("article", {name: "Tu mensaje 1", exact: true})).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const before = structuredClone([...chat.documents]), calls = chat.calls.length, requests: string[] = [];
  page.on("request", request => requests.push(request.url()));
  const trigger = page.getByRole("button", {name: "Soporte", exact: true}); await trigger.click();
  const help = page.getByRole("region", {name: "Soporte", exact: true});
  await expect(help).toContainText("Ayuda dentro de Acenta");
  await expect(help).toContainText("Esta ayuda es local: no envía tu conversación, documentos ni datos de acceso.");
  await help.getByText("Cuando una operación no termina", {exact: true}).click();
  await expect(help).toContainText("Consultar estado");
  await page.screenshot({path: test.info().outputPath("help-workspace.png"), fullPage: true});
  await expect(help.locator("form, input, textarea, a")).toHaveCount(0);
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await expect(page.getByRole("article", {name: "Tu mensaje 1", exact: true})).toContainText("Mensaje sintético incierto");
  expect(chat.calls).toHaveLength(calls); expect([...chat.documents]).toEqual(before); expect(requests).toEqual([]);
});

test("a late access response leaves local help open and focused", async ({page}) => {
  await access(page);
  let finish!: () => void;
  const response = new Promise<void>(resolve => { finish = resolve; });
  await page.route("**/auth/email/request", async route => {
    await response;
    await route.fulfill({json: {challenge_id: "synthetic-late-challenge", message: "Código de prueba solicitado"}});
  });
  await page.getByRole("button", {name: "Continuar con correo", exact: true}).click();
  await page.getByLabel("Correo electrónico", {exact: true}).fill("synthetic@example.test");
  await page.getByRole("button", {name: "Enviar código", exact: true}).click();
  await expect(page.getByRole("button", {name: "Solicitando…", exact: true})).toBeDisabled();
  await page.getByRole("button", {name: "Ayuda de acceso", exact: true}).click();
  const heading = page.getByRole("heading", {name: "Ayuda de acceso", exact: true});
  await expect(heading).toBeFocused();
  finish();
  await expect(page.getByLabel("Código de un uso", {exact: true})).toBeVisible();
  await expect(heading).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", {name: "Ayuda de acceso", exact: true})).toBeFocused();
  await expect(page.getByLabel("Código de un uso", {exact: true})).toBeVisible();
});
