/** Real production UI/auth/HTTP/PostgreSQL. Never page.route or a model call. */
import { expect, test, type Page } from "@playwright/test";
import type { GeneratedPlanningRequest, PlanningDocument } from "../src/acenta/contracts";

type Session = { principal_id: string; scope_id: string; csrf_token: string };
type PrintHost = typeof window & { pilotPrinted: string[] };
const origin = "http://localhost:4175";
const cases = [
  { topic: "Ciclo del agua en una isla imaginaria", context: "Material sintético A sin datos personales.", language: "es", hypothetical: true },
  { topic: "Geometric figures in a fictional garden", context: "Synthetic software data B, not classroom information.", language: "en", hypothetical: false },
];
const uncertainTopic = "Resultado incierto de software";

async function login(page: Page, email: string): Promise<Session> {
  await page.goto("/");
  await page.getByRole("button", { name: "Continuar con correo", exact: true }).click();
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Enviar código", exact: true }).click();
  await expect(page.getByLabel("Código de un uso", { exact: true })).toBeVisible();
  const mailbox = await page.request.get(`/__test__/mailbox?email=${encodeURIComponent(email)}`);
  expect(mailbox.status()).toBe(200);
  const { code } = await mailbox.json();
  try {
    await page.getByLabel("Código de un uso", { exact: true }).fill(code);
  } catch {
    throw new Error("Could not enter the synthetic one-time code (value withheld).");
  }
  const pending = page.waitForResponse(r => new URL(r.url()).pathname === "/auth/email/verify");
  await page.getByRole("button", { name: "Verificar código", exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  await expect(page.getByRole("button", { name: "Cerrar sesión", exact: true })).toBeVisible();
  return await response.json();
}

async function fillManual(page: Page, input: typeof cases[number]) {
  await page.getByRole("button", { name: "Crear planeación", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generar con IA", exact: true })).toBeVisible();
  await page.getByLabel("Asignatura").selectOption("Ciencias naturales");
  await page.getByLabel("Grado", { exact: false }).selectOption("3.º de primaria");
  await page.getByLabel("Tema", { exact: false }).fill(input.topic);
  const options = page.getByRole("button", { name: /Contexto y opciones/ });
  if (await options.getAttribute("aria-expanded") !== "true") await options.click();
  await page.getByLabel("Idioma del material", { exact: true }).selectOption(input.language);
  await page.getByLabel("Contexto · Aportación manual", { exact: true }).fill(input.context);
  await page.getByLabel("Situación hipotética", { exact: true }).setChecked(input.hypothetical);
}

test("single: one UI generation saves/reopens and rejects another attempt", async ({ page }) => {
  await login(page, "manual-pilot-a@example.test");
  await fillManual(page, cases[0]);
  const created = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/generated-plannings"));
  await page.getByRole("button", { name: "Generar con IA", exact: true }).click();
  expect((await created).status()).toBe(201);
  const reader = page.getByRole("dialog", { name: "Vista previa", exact: true });
  await expect(reader).toContainText(cases[0].topic);
  await reader.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByLabel("Propósito", { exact: true }).fill("Corrección sintética del intento único.");
  const saved = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/revisions"));
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(page.getByText("Guardado confirmado", { exact: true })).toBeVisible();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
  await page.getByRole("button", { name: "Consultar planeación", exact: true }).click();
  await expect(reader).toContainText("Corrección sintética del intento único.");
  await reader.getByRole("button", { name: "Cerrar vista previa", exact: true }).click();
  await page.goto("/");
  await fillManual(page, cases[1]);
  const denied = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/generated-plannings"));
  await page.getByRole("button", { name: "Generar con IA", exact: true }).click();
  expect((await denied).status()).toBe(429);
});

test("success: two manual v3 forms remain independent through save/reopen/print", async ({ page }, info) => {
  // Replace only the OS print dialog. The existing print projection still renders
  // its confirmed document; this is not a claim that a physical printer worked.
  await page.addInitScript(() => {
    const host = window as PrintHost;
    host.pilotPrinted = [];
    const append = Element.prototype.append;
    Element.prototype.append = function (...nodes: (Node | string)[]) {
      append.apply(this, nodes);
      for (const node of nodes) {
        if (!(node instanceof HTMLIFrameElement) || !node.hasAttribute("data-acenta-print")) continue;
        const target = node.contentWindow!;
        target.print = () => {
          host.pilotPrinted.push(target.document.body.innerText);
          target.dispatchEvent(new Event("afterprint"));
        };
      }
    };
  });
  const privateCalls: { method: string; path: string }[] = [];
  const external: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && url.origin !== origin) external.push(url.origin);
    if (url.pathname.startsWith("/scopes/")) privateCalls.push({ method: request.method(), path: url.pathname });
  });
  const account = await login(page, "manual-pilot-a@example.test");
  const prefix = `/scopes/${account.scope_id}`;
  const headers = { Origin: origin, "X-CSRF-Token": account.csrf_token };
  const originals: PlanningDocument[] = [];
  const revised: PlanningDocument[] = [];
  const reader = page.getByRole("dialog", { name: "Vista previa", exact: true });

  for (const [index, input] of cases.entries()) {
    await fillManual(page, input);
    const created = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/generated-plannings"));
    await page.getByRole("button", { name: "Generar con IA", exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const original: PlanningDocument = await response.json();
    originals.push(original);
    expect(original.request).toMatchObject({ contract_version: 3, topic: input.topic, language: input.language,
      context: { text: input.context, hypothetical: input.hypothetical }, reference: null });
    expect(original.request).not.toHaveProperty("fixture_context");
    expect(original.receipt).toMatchObject({ actor_id: account.principal_id, scope_id: account.scope_id,
      revision: 1, source_id: null, source_version: null });
    expect(original.result.provenance).toBe("openai-guided-v1");
    await expect(reader).toBeVisible();
    await expect(reader).toContainText(input.topic);
    await reader.getByRole("button", { name: "Editar", exact: true }).click();
    await page.getByLabel("Propósito", { exact: true }).fill(`Corrección sintética independiente ${index + 1}.`);
    const saved = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/revisions"));
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    const saveResponse = await saved;
    expect(saveResponse.status()).toBe(201);
    const revision: PlanningDocument = await saveResponse.json();
    revised.push(revision);
    expect(revision.receipt.planning_id).toBe(original.receipt.planning_id);
    expect(revision.receipt.revision).toBe(2);
    expect(revision.initial_request).toEqual(original.request);
    expect(revision.result.provenance).toBe("openai-guided-v1");
    await expect(page.getByText("Guardado confirmado", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(reader).toBeVisible();
    await expect(reader.getByRole("button", { name: "Editar", exact: true })).toBeFocused();
    await reader.getByRole("button", { name: "Cerrar vista previa", exact: true }).click();
    await page.getByRole("button", { name: "Volver a la petición", exact: true }).click();
  }
  expect(new Set(originals.map(doc => doc.receipt.planning_id)).size).toBe(2);
  expect(new Set(originals.map(doc => doc.receipt.operation_id)).size).toBe(2);
  expect(new Set(originals.map(doc => doc.receipt.revision_id)).size).toBe(2);

  // Remove every browser-side document/backup. The retained real cookie is the
  // only authority to reopen confirmed revisions from PostgreSQL.
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Consultar planeación", exact: true })).toHaveCount(2);
  for (const [index, input] of cases.entries()) {
    await page.locator(".library-card").filter({ has: page.getByRole("heading", { name: input.topic, exact: true }) })
      .getByRole("button", { name: "Consultar planeación", exact: true }).click();
    await expect(reader).toBeVisible();
    await expect(reader).toContainText(`Corrección sintética independiente ${index + 1}.`);
    await reader.getByText("Datos y procedencia de esta planeación", { exact: true }).click();
    await expect(reader.locator(".guided-context")).toContainText(input.context);
    await expect(reader.locator(".guided-context")).toContainText("Revisión 2 · Guardado confirmado");
    const beforePrint = privateCalls.length;
    for (let repeat = 0; repeat < 2; repeat++) {
      await reader.getByRole("button", { name: "Imprimir", exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as PrintHost).pilotPrinted.length)).toBe(index * 2 + repeat + 1);
      const printed = await page.evaluate(() => (window as PrintHost).pilotPrinted.at(-1)!);
      expect(printed).toContain("Revisión 2");
      expect(printed).toContain(input.topic);
      expect(printed).toContain(`Corrección sintética independiente ${index + 1}.`);
      expect(printed).toContain(input.context);
      expect(privateCalls).toHaveLength(beforePrint);
      await expect(reader.getByRole("button", { name: "Imprimir", exact: true })).toBeFocused();
      await expect(page.locator("iframe[data-acenta-print]")).toHaveCount(0);
    }
    if (index === 1) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: info.outputPath("manual-pilot-synthetic-reader.png") });
    }
    const stored = await page.request.get(`${prefix}/plannings/${originals[index].receipt.planning_id}`);
    expect(stored.status()).toBe(200);
    expect(await stored.json()).toEqual(revised[index]);
    const initial = await page.request.get(`${prefix}/plannings/${originals[index].receipt.planning_id}/revisions/1`);
    expect(initial.status()).toBe(200);
    expect(await initial.json()).toEqual(originals[index]);
    await reader.getByRole("button", { name: "Cerrar vista previa", exact: true }).click();
    await page.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
  }

  const initial = originals[0];
  const post = (data: unknown, key: string = crypto.randomUUID(), extra = headers) => page.request.post(`${prefix}/generated-plannings`, {
    data, headers: { ...extra, "Idempotency-Key": key },
  });
  // These traverse real authentication, contract and policy gates, not routes
  // fulfilled by Playwright. The Python wrapper checks zero extra transport.
  expect((await post(initial.request, initial.receipt.operation_id)).status()).toBe(201);
  expect((await post({ ...initial.request, topic: "Changed operation" }, initial.receipt.operation_id)).status()).toBe(409);
  expect((await post(initial.request, crypto.randomUUID(), { Origin: origin, "X-CSRF-Token": "" })).status()).toBe(403);
  expect((await post(initial.request, crypto.randomUUID(), { ...headers, Origin: "https://foreign.example.test" })).status()).toBe(403);
  const withReference = await post({ ...initial.request, reference: { source_id: crypto.randomUUID(), source_version: 1 } });
  expect(withReference.status()).toBe(422);
  expect(await withReference.json()).toEqual({ detail: "generation_input_not_approved" });
  expect((await post({ ...initial.request, analytic_origin: {} })).status()).toBe(422);
  expect((await post({ ...initial.request, topic: "x".repeat(5000) })).status()).toBe(413);

  // Actual 401 removes authority. A different account sees neither
  // documents nor pilot capability; the profile is never global.
  expect((await page.request.post("/auth/logout", { headers })).status()).toBe(204);
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(page.getByRole("button", { name: "Continuar con correo", exact: true })).toBeVisible();
  expect((await page.request.get(`${prefix}/plannings/${initial.receipt.planning_id}`)).status()).toBe(401);
  const other = await login(page, "manual-pilot-b@example.test");
  expect(other.scope_id).not.toBe(account.scope_id);
  expect((await page.request.get(`${prefix}/plannings/${initial.receipt.planning_id}`)).status()).toBe(404);
  const capability = await page.request.get(`/scopes/${other.scope_id}/planning-generation`);
  expect(await capability.json()).toEqual({ available: false });
  const foreign = await page.request.post(`/scopes/${other.scope_id}/generated-plannings`, {
    data: initial.request, headers: { Origin: origin, "X-CSRF-Token": other.csrf_token, "Idempotency-Key": crypto.randomUUID() },
  });
  expect(foreign.status()).toBe(503);
  expect(await foreign.json()).toEqual({ detail: "generation_unavailable" });
  await page.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Consultar planeación", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Resultado sin confirmar", exact: true })).toHaveCount(0);
  expect(external).toEqual([]);
});


test("uncertain: timeout stops generation and repeated GETs never publish a result", async ({ page }) => {
  const privateCalls: { method: string; path: string }[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/scopes/")) privateCalls.push({ method: request.method(), path });
  });
  const account = await login(page, "manual-pilot-a@example.test");
  const prefix = `/scopes/${account.scope_id}`;
  const headers = { Origin: origin, "X-CSRF-Token": account.csrf_token };
  const post = (data: unknown, key: string = crypto.randomUUID()) => page.request.post(`${prefix}/generated-plannings`, {
    data, headers: { ...headers, "Idempotency-Key": key },
  });
  await fillManual(page, { ...cases[0], topic: uncertainTopic });
  const uncertainResponse = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/generated-plannings"));
  await page.getByRole("button", { name: "Generar con IA", exact: true }).click();
  const failed = await uncertainResponse;
  expect(failed.status()).toBe(409);
  expect(await failed.json()).toEqual({ detail: "generation_uncertain" });
  const uncertainKey = failed.request().headers()["idempotency-key"];
  const uncertainInput = failed.request().postDataJSON() as GeneratedPlanningRequest;
  expect(uncertainKey).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Resultado sin confirmar", exact: true })).toBeVisible();
  await expect(page.getByLabel("Tema", { exact: false })).toHaveValue(uncertainTopic);
  const callsBeforeRecovery = privateCalls.length;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Resultado sin confirmar", exact: true })).toBeVisible();
  for (let count = 0; count < 2; count++) {
    const recovery = page.waitForResponse(r => r.request().method() === "GET" && new URL(r.url()).pathname.endsWith(`/planning-operations/${uncertainKey}`));
    await page.getByRole("button", { name: "Consultar estado", exact: true }).click();
    expect((await recovery).status()).toBe(409);
    await expect(page.getByLabel("Tema", { exact: false })).toBeDisabled();
  }
  expect(privateCalls.slice(callsBeforeRecovery).every(call => call.method === "GET")).toBe(true);
  expect((await post(uncertainInput, uncertainKey)).status()).toBe(409);
  const blocked = await post({ ...uncertainInput, topic: "No eludir la ocupación con otra entrada" });
  expect(blocked.status()).toBe(409);
  expect(await blocked.json()).toEqual({ detail: "generation_busy" });

  expect((await page.request.get(`${prefix}/plannings`)).status()).toBe(200);
  expect((await (await page.request.get(`${prefix}/plannings`)).json()).items).toEqual([]);
  await expect(page.getByRole("dialog", { name: /Vista previa|Lectura de planeación/ })).toHaveCount(0);
});

async function assertGlobalBusyPreservesManualForm(page: Page) {
  const topic = page.getByLabel("Tema", { exact: false });
  const context = page.getByLabel("Contexto · Aportación manual", { exact: true });
  const before = {
    subject: await page.getByLabel("Asignatura").inputValue(),
    grade: await page.getByLabel("Grado", { exact: false }).inputValue(),
    topic: await topic.inputValue(),
    context: await context.inputValue(),
    language: await page.getByLabel("Idioma del material", { exact: true }).inputValue(),
    hypothetical: await page.getByLabel("Situación hipotética", { exact: true }).isChecked(),
  };
  const privateCalls: { method: string; path: string }[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/scopes/")) privateCalls.push({ method: request.method(), path });
  });
  const status = page.getByRole("status");
  await expect(status).toContainText(/no (?:garantiza|asegura).*admi|admi.*no.*garantiza/i);
  await expect(status).toContainText(/no.*reserva.*presupuesto|presupuesto.*no.*reserv/i);
  const responsePromise = page.waitForResponse(response => response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/generated-plannings"));
  await page.getByRole("button", { name: "Generar con IA", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(409);
  expect(await response.json()).toEqual({ detail: "generation_busy" });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(/no se inició/i);
  await expect(alert).toContainText(/tus datos.*(?:aquí|conserv)/i);
  await expect(alert).not.toContainText(/otra generación|en curso|cuenta|usuario|anterior|consult[ae].*estado|recuper/i);
  await expect(page.getByRole("heading", { name: "Resultado sin confirmar", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Consultar estado/ })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: /Vista previa|Lectura de planeación/ })).toHaveCount(0);
  await expect(topic).toBeEnabled();
  await expect(topic).toHaveValue(before.topic);
  await expect(context).toHaveValue(before.context);
  await expect(page.getByLabel("Asignatura")).toHaveValue(before.subject);
  await expect(page.getByLabel("Grado", { exact: false })).toHaveValue(before.grade);
  await expect(page.getByLabel("Idioma del material", { exact: true })).toHaveValue(before.language);
  expect(await page.getByLabel("Situación hipotética", { exact: true }).isChecked()).toBe(before.hypothetical);
  await topic.fill(`${before.topic} revisado`);
  await expect(topic).toHaveValue(`${before.topic} revisado`);
  expect(privateCalls).toHaveLength(1);
  expect(privateCalls[0].method).toBe("POST");
  expect(privateCalls[0].path).toMatch(/\/generated-plannings$/);
}

test("busy: a global stop reveals no foreign operation and preserves the form", async ({ page }) => {
  await login(page, "manual-pilot-a@example.test");
  await fillManual(page, cases[1]);
  await assertGlobalBusyPreservesManualForm(page);
});
