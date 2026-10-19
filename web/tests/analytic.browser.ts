import { test, expect, type Page } from "@playwright/test";
import { AnalyticServer } from "./analytic-server";
import { json, source } from "./acenta-fixtures";

const evidence = process.env.ACENTA_EVIDENCE_DIR ?? "../evidence/acenta";

async function mount(page: Page, server = new AnalyticServer()) {
  await page.route("**/scopes/**", async route => {
    const request = route.request(), url = new URL(request.url());
    try {
      const response = await server.transport(url.pathname + url.search, {
        method: request.method(), headers: request.headers(), body: request.postData(),
      });
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    } catch {
      await route.abort("failed");
    }
  });
  await page.goto("/tests/acenta.html");
  await page.getByRole("button", { name: "Crear planeación", exact: true }).click();
  await page.getByRole("button", { name: "Programa analítico", exact: true }).click();
  return server;
}

const manual = {
  name: " El cuidado del agua en la comunidad ",
  grade: "3.º de primaria",
  period: " Octubre ",
  situation: " Situación manual sobre el uso del agua. ",
  context: " Comunidad hipotética sin datos personales. ",
  content: " Observar usos cotidianos del agua. ",
  pda: " Describir acciones de cuidado. ",
};
async function fill(page: Page) {
  await page.getByLabel("Nombre del apartado").fill(manual.name);
  await page.getByLabel("Grado").selectOption(manual.grade);
  await page.getByLabel("Periodo").fill(manual.period);
  const contextToggle = page.getByRole("button", { name: /Contexto y situación/ });
  if (await contextToggle.getAttribute("aria-expanded") === "false") await contextToggle.click();
  await page.getByLabel("Situación a trabajar").fill(manual.situation);
  await page.getByLabel("Contexto del grupo", { exact: true }).fill(manual.context);
  await page.getByLabel("Situación hipotética", { exact: true }).check();
  await page.getByLabel(/^Contenido \*$/).fill(manual.content);
  await page.getByLabel("Proceso de desarrollo de aprendizaje (PDA)").fill(manual.pda);
}

test("analytic desktop form validates, explicitly saves exact manual text, and revises without duplicating", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const server = await mount(page);
  await page.getByRole("button", { name: "Guardar apartado", exact: true }).click();
  await expect(page.getByLabel("Nombre del apartado")).toBeFocused();
  expect(server.sections.size).toBe(0);
  await fill(page);
  expect(server.sections.size).toBe(0);
  await page.getByRole("button", { name: /Contexto y situación/ }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${evidence}/53-form-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Guardar apartado", exact: true }).dblclick();
  await expect(page.getByRole("status").filter({ hasText: "Apartado guardado" })).toBeVisible();
  expect(server.sections.size).toBe(1);
  const original = [...server.sections.values()][0];
  expect(original.provenance).toBe("manual-v1");
  expect(original.data).toMatchObject({
    name: manual.name, grade: manual.grade, period: manual.period,
    situation: manual.situation, entries: [{ content: manual.content, pda: manual.pda }],
    context: { text: manual.context, hypothetical: true }, reference: null,
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Nombre del apartado").fill(" Mi apartado revisado ");
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Apartado guardado" })).toBeVisible();
  expect(server.sections.size).toBe(1);
  expect([...server.sections.values()][0].receipt.revision).toBe(2);
  expect(server.sectionHistory.get(`${original.receipt.section_id}/1`)).toEqual(original);
  expect(server.calls.filter(call => call.path === "analytic-sections" && call.method === "POST")).toHaveLength(1);
  expect(server.calls.filter(call => call.path.endsWith("/revisions") && call.method === "POST")).toHaveLength(1);
});

test("collapsed pairs reopen for validation and optional fields preserve exact manual provenance", async ({ page }) => {
  const server = new AnalyticServer();
  server.sources.set(source.operation_id, source);
  await mount(page, server);
  await fill(page);
  await page.getByRole("button", { name: "Más opciones", exact: true }).click();
  await page.getByLabel("Campo formativo · Manual", { exact: true }).fill(" Campo elegido manualmente ");
  await page.getByLabel("Ejes articuladores · Manuales", { exact: true }).fill(" Eje manual primero \n Eje manual segundo ");
  await page.getByLabel("Idioma", { exact: true }).selectOption("en");
  const reference = page.getByLabel("Referencia guardada · Opcional", { exact: true });
  await expect(reference.locator("option")).toHaveCount(2);
  await reference.selectOption(`${source.source_id}/${source.number}`);
  await page.getByRole("button", { name: "+ Añadir contenido y PDA", exact: true }).click();
  await expect(page.getByLabel("Contenido 2")).toBeFocused();
  await page.getByLabel("Contenido 2").fill(" Segundo contenido independiente ");
  const entries = page.getByRole("button", { name: /^Contenidos y PDA/ });
  await entries.click();
  await page.getByRole("button", { name: "Guardar apartado", exact: true }).click();
  await expect(entries).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Proceso de desarrollo de aprendizaje (PDA) 2")).toBeFocused();
  expect(server.sections.size).toBe(0);
  await page.getByLabel("Proceso de desarrollo de aprendizaje (PDA) 2").fill(" Segundo PDA independiente ");
  await page.getByRole("button", { name: "Guardar apartado", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Apartado guardado" })).toBeVisible();
  const document = [...server.sections.values()][0];
  expect(document.data.entries).toEqual([
    { content: manual.content, pda: manual.pda },
    { content: " Segundo contenido independiente ", pda: " Segundo PDA independiente " },
  ]);
  expect(document.data).toMatchObject({
    formative_field: " Campo elegido manualmente ",
    articulating_axes: [" Eje manual primero ", " Eje manual segundo "], language: "en",
    reference: { source_id: source.source_id, source_version: source.number },
  });
  expect(document.receipt).toMatchObject({
    source_id: source.source_id, source_version_id: source.version_id,
    source_version: source.number, source_sha256: source.sha256,
  });
  expect(document.provenance).toBe("manual-v1");
  await expect(page.getByText("Aportación manual. No es una cita del programa curricular oficial.")).toBeVisible();
});

test("inherited form controls support keyboard focus and narrow reflow", async ({ page }) => {
  // Generic accessibility/reflow coverage; this is not acceptance of mobile design A.
  await page.setViewportSize({ width: 360, height: 800 });
  const server = await mount(page);
  await fill(page);
  const context = page.getByRole("button", { name: /Contexto y situación/ });
  await context.focus();
  await page.keyboard.press("Enter");
  await expect(context).toBeFocused();
  await expect(context).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("Resumen de contexto y situación")).toContainText(manual.context.trim());
  await page.keyboard.press("Enter");
  await expect(context).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Contexto del grupo", { exact: true })).toHaveValue(manual.context);
  const add = page.getByRole("button", { name: "+ Añadir contenido y PDA", exact: true });
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Contenido 2")).toBeFocused();
  await page.getByLabel("Contenido 2").fill("Par temporal que se quitará");
  const remove = page.getByRole("button", { name: "Quitar contenido y PDA 2", exact: true });
  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(add).toBeFocused();
  await expect(page.getByLabel("Contenido 2")).toHaveCount(0);
  await expect(page.getByLabel(/^Contenido \*$/)).toHaveValue(manual.content);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const save = page.getByRole("button", { name: "Guardar apartado", exact: true });
  await save.scrollIntoViewIfNeeded();
  const box = await save.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Apartado guardado" })).toBeVisible();
  expect(server.sections.size).toBe(1);
});

test("lost creation response recovers the same operation and leaves manual fields intact", async ({ page }) => {
  const server = await mount(page);
  await fill(page);
  server.after = async (call, response) => {
    if (call.path === "analytic-sections" && call.method === "POST") throw Error("lost after commit");
    return response;
  };
  await page.getByRole("button", { name: "Guardar apartado", exact: true }).click();
  const recover = page.getByRole("button", { name: "Comprobar guardado", exact: true });
  await expect(recover).toBeVisible();
  await expect(page.getByLabel("Nombre del apartado")).toBeDisabled();
  await expect(page.getByLabel("Nombre del apartado")).toHaveValue(manual.name);
  expect(server.sections.size).toBe(1);
  server.after = null;
  await recover.click();
  await expect(page.getByRole("status").filter({ hasText: "Apartado guardado" })).toBeVisible();
  await expect(page.getByLabel("Nombre del apartado")).toBeEnabled();
  await expect(page.getByLabel("Contexto del grupo", { exact: true })).toHaveValue(manual.context);
  await expect(page.getByLabel("Situación hipotética", { exact: true })).toBeChecked();
  const writes = server.calls.filter(call => call.path === "analytic-sections" && call.method === "POST");
  expect(writes).toHaveLength(1);
  expect(server.calls.filter(call => call.path === `analytic-section-operations/${writes[0].key}`)).toHaveLength(1);
  expect(server.sections.size).toBe(1);
});

test("lost revision response recovers the saved edit without creating another revision", async ({ page }) => {
  const server = await mount(page);
  await fill(page);
  await page.getByRole("button", { name: "Guardar apartado", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Apartado guardado" })).toBeVisible();
  const original = [...server.sections.values()][0];
  await page.getByLabel("Nombre del apartado").fill(" Revisión con respuesta perdida ");
  server.after = async (call, response) => {
    if (call.path.endsWith("/revisions") && call.method === "POST") throw Error("lost after revision commit");
    return response;
  };
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page.getByRole("button", { name: "Comprobar guardado", exact: true })).toBeVisible();
  expect([...server.sections.values()][0].receipt.revision).toBe(2);
  server.after = null;
  await page.getByRole("button", { name: "Comprobar guardado", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Apartado guardado" })).toBeVisible();
  await expect(page.getByLabel("Nombre del apartado")).toHaveValue(" Revisión con respuesta perdida ");
  expect(server.calls.filter(call => call.path.endsWith("/revisions") && call.method === "POST")).toHaveLength(1);
  expect(server.sectionHistory.get(`${original.receipt.section_id}/1`)).toEqual(original);
});

test("a rejected write keeps the form editable and can be retried explicitly", async ({ page }) => {
  const server = await mount(page);
  await fill(page);
  server.before = async call => call.path === "analytic-sections" && call.method === "POST"
    ? json({ detail: "invalid_request" }, 422) : undefined;
  await page.getByRole("button", { name: "Guardar apartado", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Nombre del apartado")).toBeEnabled();
  await expect(page.getByLabel("Nombre del apartado")).toHaveValue(manual.name);
  await expect(page.getByRole("button", { name: "Comprobar guardado", exact: true })).toHaveCount(0);
  expect(server.sections.size).toBe(0);
  server.before = null;
  await page.getByRole("button", { name: "Guardar apartado", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Apartado guardado" })).toBeVisible();
  expect(server.sections.size).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a revision conflict preserves the correction until replacement is explicitly confirmed", async ({ page }) => {
  const server = await mount(page);
  await fill(page);
  await page.getByRole("button", { name: "Guardar apartado", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Apartado guardado" })).toBeVisible();
  const original = [...server.sections.values()][0];
  const current = server.section({ ...original.data, name: "Cambio confirmado en otra pestaña" }, undefined, original);
  await page.getByLabel("Nombre del apartado").fill("Mi corrección todavía pendiente");
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Nombre del apartado")).toHaveValue("Mi corrección todavía pendiente");
  await expect(page.getByRole("button", { name: "Guardar cambios", exact: true })).toBeDisabled();
  expect(server.sections.get(original.receipt.section_id)).toEqual(current);
  const replace = page.getByRole("button", { name: "Descartar mis cambios y cargar revisión actual", exact: true });
  page.once("dialog", dialog => dialog.dismiss());
  await replace.click();
  await expect(page.getByLabel("Nombre del apartado")).toHaveValue("Mi corrección todavía pendiente");
  page.once("dialog", dialog => dialog.accept());
  await replace.click();
  await expect(page.getByLabel("Nombre del apartado")).toHaveValue(current.data.name);
  expect(server.sections.size).toBe(1);
  expect(server.sections.get(original.receipt.section_id)?.receipt.revision).toBe(2);
});

test("back and forward preserve the unsaved section and the unload guard across workspace views", async ({ page }) => {
  const server = await mount(page);
  await fill(page);
  const unloadPrevented = () => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(await unloadPrevented()).toBe(true);
  await page.goBack();
  await expect(page.getByRole("button", { name: "Programa analítico", exact: true })).toBeVisible();
  expect(await unloadPrevented()).toBe(true);
  await page.goForward();
  await expect(page.getByLabel("Nombre del apartado")).toHaveValue(manual.name);
  const context = page.getByRole("button", { name: /Contexto y situación/ });
  if (await context.getAttribute("aria-expanded") === "false") await context.click();
  await expect(page.getByLabel("Situación a trabajar")).toHaveValue(manual.situation);
  await expect(page.getByLabel("Contexto del grupo", { exact: true })).toHaveValue(manual.context);
  await expect(page.getByLabel("Situación hipotética", { exact: true })).toBeChecked();
  expect(server.sections.size).toBe(0);
  await page.getByRole("button", { name: "Guardar apartado", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Apartado guardado" })).toBeVisible();
  expect(await unloadPrevented()).toBe(false);
});

test("logout from another view protects the section and can return to its exact unsaved buffer", async ({ page }) => {
  const server = await mount(page);
  await fill(page);
  await page.getByRole("button", { name: "Volver al inicio", exact: true }).click();
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  const guard = page.getByRole("dialog", { name: "¿Salir con cambios en el apartado?", exact: true });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Seguir editando", exact: true }).click();
  await expect(guard).toHaveCount(0);
  await expect(page.getByLabel("Nombre del apartado")).toHaveValue(manual.name);
  expect(server.sections.size).toBe(0);
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  await guard.getByRole("button", { name: "Guardar apartado y salir", exact: true }).click();
  await expect(guard).toHaveCount(0);
  await expect(page.getByLabel("Nombre del apartado")).toHaveCount(0);
  expect(server.sections.size).toBe(1);
  expect([...server.sections.values()][0].data.context).toEqual({ text: manual.context, hypothetical: true });
});

test("logout cannot discard an uncertain save and leaves only after its confirmation", async ({ page }) => {
  const server = await mount(page);
  await fill(page);
  server.after = async (call, response) => {
    if (call.path === "analytic-sections" && call.method === "POST") throw Error("lost before logout");
    return response;
  };
  await page.getByRole("button", { name: "Guardar apartado", exact: true }).click();
  await expect(page.getByRole("button", { name: "Comprobar guardado", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  const guard = page.getByRole("dialog", { name: "¿Salir con cambios en el apartado?", exact: true });
  await expect(guard).toBeVisible();
  await expect(guard.getByRole("button", { name: "Descartar cambios y salir", exact: true })).toHaveCount(0);
  server.after = null;
  await guard.getByRole("button", { name: "Comprobar guardado", exact: true }).click();
  await expect(guard).toHaveCount(0);
  await expect(page.getByLabel("Nombre del apartado")).toHaveCount(0);
  expect(server.sections.size).toBe(1);
  expect(server.calls.filter(call => call.path === "analytic-sections" && call.method === "POST")).toHaveLength(1);
});

for (const recovering of [false, true])
  test(`continuing the section cancels logout while ${recovering ? "recovery" : "saving"} is delayed`, async ({ page }) => {
    const server = await mount(page);
    await fill(page);
    if (recovering) {
      server.after = async (call, response) => {
        if (call.path === "analytic-sections" && call.method === "POST") throw Error("lost before logout");
        return response;
      };
      await page.getByRole("button", { name: "Guardar apartado", exact: true }).click();
      await expect(page.getByRole("button", { name: "Comprobar guardado", exact: true })).toBeVisible();
    }
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    server.after = async (call, response) => {
      if (recovering ? call.path.startsWith("analytic-section-operations/") : call.path === "analytic-sections" && call.method === "POST") await gate;
      return response;
    };
    await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
    const guard = page.getByRole("dialog", { name: "¿Salir con cambios en el apartado?", exact: true });
    await guard.getByRole("button", { name: recovering ? "Comprobar guardado" : "Guardar apartado y salir", exact: true }).click();
    await expect(guard.getByRole("button", { name: "Comprobar guardado", exact: true })).toBeDisabled();
    await guard.getByRole("button", { name: "Seguir editando", exact: true }).click();
    await expect(guard).toHaveCount(0);
    release();
    await expect(page.getByRole("status").filter({ hasText: "Apartado guardado" })).toBeVisible();
    await expect(page.getByLabel("Nombre del apartado")).toHaveValue(manual.name);
    await page.getByLabel("Nombre del apartado").fill("Sigo trabajando después de cancelar la salida");
    await expect(page.getByRole("status").filter({ hasText: "Cambios sin guardar" })).toBeVisible();
    expect(server.sections.size).toBe(1);
    expect([...server.sections.values()][0].data.name).toBe(manual.name);
  });
