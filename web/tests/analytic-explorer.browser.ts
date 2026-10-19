import { test, expect, type Page } from "@playwright/test";
import { AnalyticServer } from "./analytic-server";
import { explorerCatalog, explorerSection } from "./analytic-explorer-fixtures";
import { json } from "./acenta-fixtures";

const evidence = process.env.ACENTA_EVIDENCE_DIR ?? "../evidence/acenta";
const canonical = () => explorerSection(10, "El cuidado del agua en la comunidad");
async function mount(page: Page, server = new AnalyticServer()) {
  await page.route("**/scopes/**", async route => {
    const request = route.request(), url = new URL(request.url());
    try {
      const response = await server.transport(url.pathname + url.search, { method: request.method(), headers: request.headers(), body: request.postData() });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    } catch { await route.abort("failed"); }
  });
  await page.goto("/tests/acenta.html");
  await page.getByRole("button", { name: "Crear planeación", exact: true }).click();
  return server;
}
const explorer = (page: Page) => page.getByRole("dialog", { name: "Usar un apartado guardado", exact: true });
async function open(page: Page) {
  await page.getByRole("button", { name: "Usar un apartado guardado", exact: true }).click();
  await expect(explorer(page)).toBeVisible();
  await expect(explorer(page).getByLabel("Tus apartados", { exact: true })).toHaveAttribute("aria-busy", "false");
}
async function use(page: Page) {
  await open(page);
  await explorer(page).getByRole("button", { name: /^El cuidado del agua en la comunidad/ }).click();
  await explorer(page).getByRole("button", { name: "Usar apartado →", exact: true }).click();
  await expect(page.getByLabel("Tema del apartado")).toHaveValue(canonical().data.name);
}

test("explorer searches the whole catalog, combines exact filters, paginates and previews literal manual text", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const server = new AnalyticServer();
  explorerCatalog().forEach(document => server.putSection(document));
  await mount(page, server); await open(page);
  const modal = explorer(page), rows = modal.locator(".analytic-result");
  await expect(rows).toHaveCount(6);
  await expect(modal.getByText("Página 1 · 6 mostrados", { exact: true })).toBeVisible();
  await modal.getByRole("button", { name: "Página siguiente", exact: true }).click();
  await expect(rows).toHaveCount(3);
  await modal.getByRole("button", { name: "Página anterior", exact: true }).click();
  await expect(rows).toHaveCount(6);
  await modal.getByLabel("Buscar por título o tema").fill("100%_ \\");
  await expect(rows).toHaveCount(1);
  await expect(modal.getByRole("heading", { name: "El agua & 100%_ \\" })).toBeVisible();
  await modal.getByLabel("Filtrar por grado exacto").fill("4.º de primaria");
  await expect(rows).toHaveCount(0);
  await expect(modal.getByRole("button", { name: "Usar apartado →", exact: true })).toBeDisabled();
  await modal.getByLabel("Filtrar por grado exacto").fill("3.º de primaria");
  await modal.getByLabel("Filtrar por campo formativo exacto").fill("Campo manual");
  await expect(rows).toHaveCount(1);
  const preview = modal.getByLabel("Vista previa del apartado");
  await expect(preview).toContainText("Segundo PDA manual.");
  await expect(preview).toContainText("Hipotético");
  await expect(preview).toContainText("Sin referencia adjunta");
  expect(await preview.getByText(" Primer PDA manual. ", { exact: true }).textContent()).toBe(" Primer PDA manual. ");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/analytic-explorer-desktop.png`, fullPage: true });
  expect(server.calls.filter(call => call.method === "POST")).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Usar un apartado guardado", exact: true })).toBeFocused();
});

test("readonly derivation uses the selected revision, then editing and reopening the result preserve it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const server = new AnalyticServer(), original = server.putSection(canonical());
  await mount(page, server);
  await page.getByLabel("Tema", { exact: true }).fill("Mi preparación independiente");
  await use(page);
  await expect(page.getByLabel("Tema del apartado")).toHaveAttribute("readonly", "");
  await expect(page.getByText("PDA 2 · Sólo lectura", { exact: true })).toBeVisible();
  await page.getByLabel("Asignatura").fill("Ciencias naturales");
  await page.getByLabel("Duración · minutos").fill("50");
  const newData = { ...original.data, entries: [{ content: "Nueva revisión ajena a esta clase", pda: "PDA nuevo" }] };
  server.section(newData, crypto.randomUUID(), original);
  await page.getByRole("button", { name: "Ver apartado", exact: true }).click();
  const originDialog = page.getByRole("dialog", { name: "Apartado de origen", exact: true });
  await expect(originDialog).toContainText("Revisión 1");
  await expect(originDialog).toContainText("Segundo PDA manual.");
  await originDialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/analytic-derived-readonly-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Crear ejemplo →", exact: true }).click();
  const reader = page.getByRole("dialog", { name: "Vista previa", exact: true });
  await expect(reader).toBeVisible();
  expect([...server.docs.values()][0].analytic_origin).toEqual(original);
  await reader.getByText("Datos y procedencia de esta planeación", { exact: true }).click();
  await reader.getByText("Apartado de origen · Revisión 1", { exact: true }).click();
  await expect(reader).toContainText("Segundo PDA manual.");
  await reader.getByRole("button", { name: "Editar", exact: true }).first().click();
  const editor = page.getByRole("dialog", { name: "Editar planeación", exact: true });
  await editor.getByLabel("Propósito", { exact: true }).fill("Propósito cambiado en el resultado.");
  await editor.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(editor.getByText("Guardado confirmado", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("button", { name: "Cerrar vista previa", exact: true }).click();
  await page.getByRole("button", { name: "Consultar planeación", exact: true }).click();
  await expect(reader).toContainText("Propósito cambiado en el resultado.");
  expect([...server.docs.values()][0].analytic_origin).toEqual(original);
  expect(server.sections.get(original.receipt.section_id)?.receipt.revision).toBe(2);
});

test("query errors are retryable and unsupported creation retains all preparation", async ({ page }) => {
  const server = new AnalyticServer(); server.putSection(canonical());
  let fail = true;
  server.after = async (call, response) => call.path.startsWith("analytic-sections?") && fail ? json({ detail: "unavailable" }, 503) : response;
  await mount(page, server); await open(page);
  await expect(explorer(page).getByRole("alert")).toBeVisible();
  await expect(explorer(page).getByRole("button", { name: "Usar apartado →", exact: true })).toBeDisabled();
  fail = false;
  await explorer(page).getByRole("button", { name: "Reintentar consulta", exact: true }).click();
  await expect(explorer(page).locator(".analytic-result")).toHaveCount(1);
  await explorer(page).getByRole("button", { name: "Usar apartado →", exact: true }).click();
  await page.getByLabel("Asignatura").fill("Matemáticas");
  await page.getByRole("button", { name: "Crear ejemplo →", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Tu preparación se conserva");
  await expect(page.getByLabel("Asignatura")).toHaveValue("Matemáticas");
  await expect(page.getByLabel("Asignatura")).toBeEnabled();
  await expect(page.getByLabel("Tema del apartado")).toHaveValue(canonical().data.name);
  expect(server.docs.size).toBe(0);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Seguir preparando", exact: true }).click();
  await expect(page.getByLabel("Asignatura")).toHaveValue("Matemáticas");
});

test("lost creation response recovers once and cannot discard or replace the uncertain origin", async ({ page }) => {
  const server = new AnalyticServer(); server.putSection(canonical());
  await mount(page, server); await use(page);
  await page.getByLabel("Asignatura").fill("Ciencias naturales");
  server.after = async (call, response) => { if (call.path.endsWith("/plannings") && call.method === "POST") throw Error("lost after commit"); return response; };
  await page.getByRole("button", { name: "Crear ejemplo →", exact: true }).click();
  await expect(page.getByRole("button", { name: "Comprobar creación", exact: true })).toBeVisible();
  await expect(page.getByLabel("Asignatura")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancelar", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Usar un apartado guardado", exact: true })).toBeDisabled();
  expect(server.docs.size).toBe(1);
  server.after = null;
  await page.getByRole("button", { name: "Comprobar creación", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Vista previa", exact: true })).toBeVisible();
  expect(server.calls.filter(call => call.path.endsWith("/plannings") && call.method === "POST")).toHaveLength(1);
});

test("cancel and session exit preserve the independent form until an explicit discard", async ({ page }) => {
  const server = new AnalyticServer(); server.putSection(canonical());
  await mount(page, server);
  await page.getByLabel("Tema", { exact: true }).fill("Texto independiente");
  await use(page);
  await page.getByLabel("Asignatura").fill("Mi asignatura");
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  const exit = page.getByRole("dialog", { name: "¿Salir con una clase pendiente?", exact: true });
  await expect(exit).toBeVisible();
  await exit.getByRole("button", { name: "Seguir preparando", exact: true }).click();
  await expect(page.getByLabel("Asignatura")).toHaveValue("Mi asignatura");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Descartar preparación", exact: true }).click();
  await expect(page.getByLabel("Tema", { exact: true })).toHaveValue("Texto independiente");
  expect(server.docs.size).toBe(0);
});

test("generic narrow reflow keeps search, preview and readonly derivation reachable by keyboard", async ({ page }) => {
  // Accessibility coverage, not acceptance of mobile A or a new mobile design.
  await page.setViewportSize({ width: 360, height: 800 });
  const server = new AnalyticServer(); server.putSection(canonical());
  await mount(page, server); await open(page);
  await expect(explorer(page).getByLabel("Buscar por título o tema")).toBeFocused();
  const button = explorer(page).getByRole("button", { name: "Usar apartado →", exact: true });
  await button.focus(); await page.keyboard.press("Enter");
  await expect(page.getByLabel("Tema del apartado")).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "Crear ejemplo →", exact: true }).click();
  await expect(page.getByLabel("Asignatura")).toBeFocused();
  await expect(page.getByLabel("Asignatura")).toHaveAttribute("aria-invalid", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/analytic-derived-reflow-360.png`, fullPage: true });
});

test("cancelling origin selection retains the preparation and a late recovery never resumes cancelled logout", async ({ page }) => {
  const server = new AnalyticServer(); server.putSection(canonical()); server.putSection(explorerSection(11, "Otro origen manual"));
  await mount(page, server); await use(page);
  await page.getByLabel("Asignatura").fill("Ciencias naturales");
  await page.getByLabel("Duración · minutos").fill("45");
  await open(page);
  await explorer(page).getByRole("button", { name: /^Otro origen manual/ }).click();
  await explorer(page).getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByLabel("Tema del apartado")).toHaveValue(canonical().data.name);
  await expect(page.getByLabel("Duración · minutos")).toHaveValue("45");
  server.after = async (call, response) => { if (call.path.endsWith("/plannings") && call.method === "POST") throw Error("lost after commit"); return response; };
  await page.getByRole("button", { name: "Crear ejemplo →", exact: true }).click();
  await expect(page.getByRole("button", { name: "Comprobar creación", exact: true })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  server.after = async (call, response) => { if (call.path.startsWith("planning-operations/")) await gate; return response; };
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  const exit = page.getByRole("dialog", { name: "¿Salir con una clase pendiente?", exact: true });
  await expect(exit.getByRole("button", { name: "Descartar preparación y salir", exact: true })).toHaveCount(0);
  await exit.getByRole("button", { name: "Comprobar creación", exact: true }).click();
  await exit.getByRole("button", { name: "Seguir preparando", exact: true }).click();
  release();
  await expect(page.getByText("Clase confirmada. Puedes consultarla en Mis recursos.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Asignatura")).toHaveValue("Ciencias naturales");
  await expect(page.getByRole("button", { name: "Cerrar sesión", exact: true })).toBeVisible();
  expect(server.docs.size).toBe(1);
  await page.getByRole("button", { name: "Mis recursos", exact: true }).click();
  await expect(page.getByRole("button", { name: "Consultar planeación", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Consultar planeación", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Vista previa", exact: true })).toBeVisible();
});

test("literal text resembling markup is never interpreted by the preview", async ({ page }) => {
  const server = new AnalyticServer(), section = canonical();
  section.data.entries[0].pda = '<img src=x onerror="window.alert(1)">';
  server.putSection(section);
  await mount(page, server); await open(page);
  const preview = explorer(page).getByLabel("Vista previa del apartado");
  await expect(preview.getByText(section.data.entries[0].pda, { exact: true })).toBeVisible();
  expect(await preview.locator("img").count()).toBe(0);
});
