/** Production authentication/UI composition; all HTTP responses are software fixtures. */
import { test, expect, type Page } from "@playwright/test";
import { AcentaController } from "../src/acenta/controller";
import { AcentaApi } from "../src/acenta/api";
import { EditorRecovery, GENERATION_RECOVERY_KEY, RECOVERY_KEY } from "../src/acenta/editor-recovery";
import { GuidedServer } from "./guided-server";
import { guidedPlanning, guidedRequest } from "./guided-fixtures";
import { json, session } from "./acenta-fixtures";

async function mount(page: Page, corruptGeneration = false, editorUnavailable = false) {
  const slots = new Map<string, string>();
  const store = {
    getItem: (key: string) => slots.get(key) ?? null,
    setItem: (key: string, value: string) => { slots.set(key, value); },
    removeItem: (key: string) => { slots.delete(key); },
  };
  const identity = { principal_id: session.actorId, scope_id: session.scopeId,
    recovery_context_id: crypto.randomUUID(), csrf_token: "synthetic-browser-csrf" };
  const server = new GuidedServer();
  let state = "generation_uncertain";
  server.after = async (call, response) => {
    if (call.path === "planning-generation") return json({ available: true });
    if (state && (call.path === "generated-plannings" || call.path.startsWith("planning-operations/")))
      return json({ detail: state }, state === "not_found" ? 404 : 409);
    return response;
  };
  const recovery = new EditorRecovery(() => store);
  recovery.admit(identity); recovery.generations.admit(identity, true);
  const controller = new AcentaController(new AcentaApi(session, server.transport), null, crypto.randomUUID(), recovery);
  controller.setGuided(guidedRequest()); await controller.loadGenerationAvailability(); await controller.submitGuided("ai");
  const generationKey = controller.snapshot().pending!.key;
  const doc = server.put(guidedPlanning()); controller.openEditor(doc); controller.edit("Edición que debe sobrevivir a la recuperación de IA.");
  if (corruptGeneration) slots.set(GENERATION_RECOVERY_KEY, '{"invalid":"generation"}');
  const originalEditor = slots.get(RECOVERY_KEY)!;
  if (editorUnavailable) server.before = async call => call.path.startsWith("plannings/") && call.method === "GET"
    ? json({ detail: "unavailable" }, 503) : undefined;
  await page.addInitScript(entries => {
    if (!sessionStorage.getItem("synthetic-recovery-seeded")) {
      for (const [key, value] of entries) sessionStorage.setItem(key, value);
      sessionStorage.setItem("synthetic-recovery-seeded", "true");
    }
  }, [...slots]);
  await page.route("**/auth/session", route => route.fulfill({ json: identity }));
  await page.route("**/scopes/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const response = await server.transport(url.pathname + url.search, {
      method: request.method(), headers: request.headers(), body: request.postData(),
    });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  server.calls = [];
  await page.goto("/");
  return { server, generationKey, originalEditor, set state(value: string) { state = value; } };
}

test("a generation warning cannot offer to discard an independently restored editor backup", async ({ page }) => {
  const h = await mount(page, true);
  await expect(page.getByRole("dialog", { name: "Editar planeación", exact: true })).toBeVisible();
  await expect(page.getByLabel("Propósito", { exact: true })).toHaveValue("Edición que debe sobrevivir a la recuperación de IA.");
  await expect(page.getByRole("button", { name: /Descartar respaldo/ })).toHaveCount(0);
  await expect(page.getByText(/No pudimos utilizar el respaldo de la generación/)).toHaveCount(1);
  expect(await page.evaluate(key => sessionStorage.getItem(key), RECOVERY_KEY)).toBe(h.originalEditor);
  expect(await page.evaluate(key => sessionStorage.getItem(key), GENERATION_RECOVERY_KEY)).toBe('{"invalid":"generation"}');
  expect(h.server.calls.every(call => call.method === "GET")).toBe(true);
});

test("discarding the editor backup leaves generation recovery intact across navigation and GET 404", async ({ page }) => {
  const h = await mount(page, false, true);
  const generationRaw = await page.evaluate(key => sessionStorage.getItem(key), GENERATION_RECOVERY_KEY);
  const discard = page.getByRole("button", { name: "Descartar respaldo de edición", exact: true });
  await expect(discard).toBeVisible();
  await discard.click();
  expect(await page.evaluate(key => sessionStorage.getItem(key), RECOVERY_KEY)).toBeNull();
  expect(await page.evaluate(key => sessionStorage.getItem(key), GENERATION_RECOVERY_KEY)).toBe(generationRaw);
  await expect(discard).toHaveCount(0);
  h.state = "not_found";
  await page.getByRole("button", { name: "Volver al inicio", exact: true }).click();
  await page.getByRole("button", { name: "Consultar estado de generación", exact: true }).click();
  await page.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
  await page.getByRole("button", { name: "Volver a la petición", exact: true }).click();
  await page.getByRole("button", { name: "Crear planeación", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Resultado sin confirmar", exact: true })).toBeVisible();
  await expect(page.getByLabel("Tema")).toBeDisabled();
  await page.getByRole("button", { name: "Consultar estado", exact: true }).click();
  expect(await page.evaluate(key => sessionStorage.getItem(key), GENERATION_RECOVERY_KEY)).toBe(generationRaw);
  expect(h.server.calls.filter(call => call.path === `planning-operations/${h.generationKey}`)).toHaveLength(3);
  expect(h.server.calls.every(call => call.method === "GET")).toBe(true);
});

test("panels preserve the exact pending generation and only consult it after an explicit click", async ({page}) => {
  const h = await mount(page, false, true);
  await page.getByRole("button", {name: "Volver al inicio", exact: true}).click();
  await expect(page.getByRole("region", {name: "Planeación pendiente", exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "Consultar estado de generación", exact: true})).toBeVisible();
  const retained = await page.evaluate(key => sessionStorage.getItem(key), GENERATION_RECOVERY_KEY);
  const before = h.server.calls.filter(call => call.path === `planning-operations/${h.generationKey}`).length;
  await page.getByRole("button", {name: "Planear", exact: true}).click();
  const panel = page.getByRole("region", {name: "Herramientas", exact: true});
  await expect(panel.getByRole("heading", {name: "Planeación pendiente", exact: true})).toBeVisible();
  await page.getByRole("button", {name: "Mis recursos", exact: true}).click();
  await expect(page.getByRole("region", {name: "Mis recursos", exact: true})).toBeVisible();
  await page.goBack(); await expect(panel).toBeVisible();
  expect(h.server.calls.filter(call => call.path === `planning-operations/${h.generationKey}`)).toHaveLength(before);
  h.state = "not_found";
  await panel.getByRole("button", {name: "Consultar estado de generación", exact: true}).click();
  await expect(panel.getByRole("button", {name: "Consultar estado de generación", exact: true})).toBeEnabled();
  expect(h.server.calls.filter(call => call.path === `planning-operations/${h.generationKey}`)).toHaveLength(before + 1);
  expect(await page.evaluate(key => sessionStorage.getItem(key), GENERATION_RECOVERY_KEY)).toBe(retained);
  expect(h.server.calls.every(call => call.method === "GET")).toBe(true);
});
