import { test, expect, type Page } from "@playwright/test";
import { GuidedServer } from "./guided-server";
import { guidedPlanning, guidedRevised } from "./guided-fixtures";
import { json } from "./acenta-fixtures";
const evidence = process.env.ACENTA_EVIDENCE_DIR ?? "../evidence/acenta";
async function mount(page: Page, server = new GuidedServer()) {
  await page.route("**/scopes/**", async (route) => {
    const q = route.request();
    try {
      const url = new URL(q.url());
      const r = await server.transport(url.pathname + url.search, {
        method: q.method(),
        headers: q.headers(),
        body: q.postData(),
      });
      await route.fulfill({
        status: r.status,
        headers: Object.fromEntries(r.headers),
        body: await r.text(),
      });
    } catch {
      await route.abort("failed");
    }
  });
  await page.goto("/tests/acenta.html");
  await page
    .getByRole("button", { name: "Crear planeación", exact: true })
    .click();
  return server;
}
test("available AI creation stays pending without resending and displays the recovered provenance", async ({ page }) => {
  const server = new GuidedServer();
  let pending = true;
  server.after = async (call, response) => {
    if (call.path === "planning-generation") return json({ available: true });
    if (call.path === "generated-plannings") {
      const input = JSON.parse(call.body!);
      expect(input.contract_version).toBe(3);
      expect(input).not.toHaveProperty("fixture_context");
      const doc = guidedPlanning(call.key!);
      doc.request = input;
      doc.result.provenance = "openai-guided-v1";
      doc.result.notice = "Respuesta sintética de transporte para comprobar software; no valida calidad educativa.";
      server.put(doc);
      return json({ detail: "generation_pending" }, 409);
    }
    if (pending && call.path.startsWith("planning-operations/"))
      return json({ detail: "generation_uncertain" }, 409);
    return response;
  };
  await mount(page, server);
  await expect(page.getByRole("status")).toContainText("La generación con IA está disponible");
  await page.getByRole("button", { name: "Usar datos del ejemplo" }).click();
  await page.getByRole("button", { name: "Crear planeación", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Resultado sin confirmar" })).toBeVisible();
  await page.getByRole("button", { name: "Consultar estado", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No se pudo confirmar el resultado");
  pending = false;
  await page.getByRole("button", { name: "Consultar estado", exact: true }).click();
  const reader = page.getByRole("dialog", { name: "Vista previa", exact: true });
  await expect(reader).toBeVisible();
  await expect(reader.locator(".guided-type")).toContainText("Generada con IA");
  expect(server.calls.filter(call => call.path === "generated-plannings")).toHaveLength(1);
});
async function create(page: Page) {
  await page.getByRole("button", { name: "Usar datos del ejemplo" }).click();
  await page
    .getByRole("button", { name: "Crear planeación", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: /Vista previa|Lectura de planeación/ }),
  ).toBeVisible();
}
async function geometry(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const info = await page
    .locator("dialog[open]")
    .last()
    .evaluate((el) => ({
      w: innerWidth,
      h: innerHeight,
      box: el.getBoundingClientRect().toJSON(),
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
  expect(info.box.left).toBeGreaterThanOrEqual(0);
  expect(info.box.right).toBeLessThanOrEqual(info.w + 1);
  expect(info.box.top).toBeGreaterThanOrEqual(0);
  expect(info.box.bottom).toBeLessThanOrEqual(info.h + 1);
  expect(info.scroll).toBeLessThanOrEqual(info.client + 1);
  for (const img of await page.locator("dialog[open] img").all())
    expect(
      await img.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
      ),
    ).toBe(true);
}
test("guided form validates in place, preserves optional manual provenance and previews before editing", async ({
  page,
}) => {
  const server = await mount(page);
  await page
    .getByRole("button", { name: "Crear planeación", exact: true })
    .click();
  await expect(page.getByLabel("Asignatura")).toBeFocused();
  expect(server.docs.size).toBe(0);
  await page.getByRole("button", { name: "Usar datos del ejemplo" }).click();
  await page.getByRole("button", { name: /Contexto y opciones/ }).click();
  await page
    .getByLabel("Contexto · Aportación manual", { exact: true })
    .fill("Situación sintética sin datos personales");
  await page.getByLabel("Situación hipotética").check();
  await page
    .getByLabel("Objetivos de aprendizaje · Manuales")
    .fill("Objetivo escrito por el docente");
  await page.screenshot({
    path: `${evidence}/52-form-desktop.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Crear planeación", exact: true })
    .dblclick();
  const dialog = page.getByRole("dialog", {
    name: "Vista previa",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Editar planeación", exact: true }),
  ).toHaveCount(0);
  expect(server.docs.size).toBe(1);
  await geometry(page);
  await page.screenshot({ path: `${evidence}/52-preview-desktop.png` });
  await page.getByText("Datos y procedencia de esta planeación").click();
  await expect(dialog).toContainText(
    "Situación hipotética. Situación sintética",
  );
  await expect(dialog).toContainText("Sin referencia adjunta");
  await page.getByRole("button", { name: "Cerrar vista previa" }).click();
  await page
    .getByRole("button", { name: "Consultar planeación", exact: true })
    .click();
  await expect(dialog).toBeVisible();
});
for (const width of [320, 390, 700, 701, 1440])
  test(`guided reader and optional editor fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 800 ? 844 : 924 });
    await mount(page);
    await create(page);
    await geometry(page);
    const mobile = width <= 700;
    if (mobile) {
      const d = page.getByRole("dialog", {
        name: "Lectura de planeación",
        exact: true,
      });
      await expect(d).toBeVisible();
      await page
        .getByRole("button", { name: "Secciones", exact: true })
        .click();
      const sheet = page.getByRole("dialog", {
        name: "Ir a una sección",
        exact: true,
      });
      await expect(sheet).toBeVisible();
      await geometry(page);
      if (width === 390)
        await page.screenshot({ path: `${evidence}/52-sections-mobile.png` });
      await sheet
        .getByRole("button", { name: "Evaluación formativa", exact: true })
        .click();
      await expect(page.locator('[data-section="assessment"]')).toBeFocused();
      await expect(sheet).toHaveCount(0);
      if (width === 390)
        await page.screenshot({ path: `${evidence}/52-reader-mobile.png` });
    }
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Editar planeación", exact: true }),
    ).toBeVisible();
    await geometry(page);
    await page
      .getByLabel("Propósito", { exact: true })
      .fill("Propósito manual revisado");
    await expect(page.getByLabel("Campo a corregir")).toBeDisabled();
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(
      page.getByText("Guardado confirmado", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Campo a corregir")
      .selectOption("activity:exploration/minutes");
    await page
      .getByLabel("Minutos · Desarrollo · Proponer acciones", { exact: true })
      .fill("45");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(
      page.getByText("Guardado confirmado", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(
      page.getByRole("dialog", {
        name: mobile ? "Lectura de planeación" : "Vista previa",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".guided-meta")).toContainText("65 minutos");
  });
test("unknown creation is recovered without duplicates; CAS conflict preserves the correction", async ({
  page,
}) => {
  const server = await mount(page);
  server.after = async (call, response) => {
    if (call.path === "guided-plannings") throw Error("lost after commit");
    return response;
  };
  await page.getByRole("button", { name: "Usar datos del ejemplo" }).click();
  await page
    .getByRole("button", { name: "Crear planeación", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Resultado sin confirmar" }),
  ).toBeVisible();
  await expect(page.getByLabel("Tema")).toBeDisabled();
  server.after = null;
  await page
    .getByRole("button", { name: "Consultar estado", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Vista previa" }),
  ).toBeVisible();
  expect(server.docs.size).toBe(1);
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page
    .getByLabel("Propósito", { exact: true })
    .fill("Mi revisión pendiente");
  const original = [...server.docs.values()][0];
  server.put(guidedRevised(original, "Otro cambio confirmado"));
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(
    page.getByText("Conflicto de versión", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Propósito", { exact: true })).toHaveValue(
    "Mi revisión pendiente",
  );
  await page
    .getByRole("button", { name: "Conservar copia", exact: true })
    .click();
  await expect(
    page.getByText("Guardado confirmado", { exact: true }),
  ).toBeVisible();
  expect(server.docs.size).toBe(2);
});

for (const resized of [false, true])
  test(`Escape closes only the section sheet${resized ? " after resizing" : " and restores focus"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page);
    await create(page);
    const sections = page.getByRole("button", {
      name: "Secciones",
      exact: true,
    });
    await sections.click();
    const sheet = page.getByRole("dialog", {
      name: "Ir a una sección",
      exact: true,
    });
    await expect(sheet).toBeVisible();
    if (resized) await page.setViewportSize({ width: 1200, height: 900 });
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(
      page.getByRole("dialog", {
        name: resized ? "Vista previa" : "Lectura de planeación",
        exact: true,
      }),
    ).toBeVisible();
    if (!resized) await expect(sections).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Consultar planeación", exact: true }),
    ).toBeVisible();
  });

for (const width of [320, 1280])
  test(`collapsed options preserve a concise manual summary at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mount(page);
    const summary = page.getByLabel("Resumen de contexto y opciones");
    await expect(summary).toContainText("Aprendizaje activo · Español");
    await expect(summary).toContainText("Sin contexto");
    await expect(summary).toContainText("Sin referencia adjunta");
    const toggle = page.getByRole("button", { name: /Contexto y opciones/ });
    await toggle.click();
    await page.getByLabel("Método de enseñanza").selectOption("5e");
    await page.getByLabel("Idioma del material").selectOption("en");
    const context = "Situación sintética sin datos personales. ".repeat(15);
    await page
      .getByLabel("Contexto · Aportación manual", { exact: true })
      .fill(context);
    await page.getByLabel("Situación hipotética").check();
    await page
      .getByLabel("Objetivos de aprendizaje · Manuales")
      .fill("Primer objetivo propio\nSegundo objetivo propio");
    await page
      .getByLabel("Campo formativo · Manual", { exact: true })
      .fill("Campo aportado manualmente");
    await page
      .getByLabel("Ejes articuladores · Manuales")
      .fill("Eje manual de prueba");
    await page
      .getByRole("button", { name: "Conservar referencia de ejemplo" })
      .click();
    const reference = page.getByLabel("Referencia guardada · Opcional");
    await expect(reference).not.toHaveValue("");
    const selectedReference = await reference
      .locator("option:checked")
      .innerText();
    await toggle.click();
    await expect(toggle).toContainText("Editar opciones");
    await expect(summary).toContainText("Modelo 5E · Inglés");
    await expect(summary).toContainText(
      "Hipotético: Situación sintética sin datos personales.",
    );
    await expect(summary).not.toContainText(context);
    for (const text of [
      "Primer objetivo propio · Segundo objetivo propio",
      "Campo aportado manualmente",
      "Eje manual de prueba",
      selectedReference,
    ])
      await expect(summary).toContainText(text);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${evidence}/52-options-summary-${width}.png`,
      fullPage: true,
    });
    await toggle.click();
    await expect(
      page.getByLabel("Contexto · Aportación manual", { exact: true }),
    ).toHaveValue(context);
    await expect(page.getByLabel("Situación hipotética")).toBeChecked();
    await expect(reference.locator("option:checked")).toHaveText(
      selectedReference,
    );
  });
