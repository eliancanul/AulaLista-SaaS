import { test, expect } from "@playwright/test";
import type { PlanningDocument } from "../src/acenta/contracts";
test("guided request without source survives response loss and all basic edits through real HTTP/PostgreSQL", async ({
  page,
}) => {
  // Real API/database. Python discards only the first committed creation response.
  await page.goto("/tests/acenta-api.html");
  await page
    .getByRole("button", { name: "Crear planeación", exact: true })
    .click();
  await page.getByRole("button", { name: "Usar datos del ejemplo" }).click();
  await page.getByRole("button", { name: /Contexto y opciones/ }).click();
  await page
    .getByLabel("Contexto · Aportación manual", { exact: true })
    .fill("Escenario hipotético de prueba de software");
  await page.getByLabel("Situación hipotética").check();
  await page
    .getByRole("button", { name: "Crear ejemplo de software", exact: true })
    .dblclick();
  await expect(
    page.getByRole("heading", { name: "Resultado sin confirmar" }),
  ).toBeVisible();
  const recovery = page.waitForResponse(
    (r) =>
      r.request().method() === "GET" &&
      new URL(r.url()).pathname.includes("/planning-operations/"),
  );
  await page
    .getByRole("button", { name: "Consultar estado", exact: true })
    .click();
  const recovered = await recovery;
  expect(recovered.status()).toBe(200);
  const original: PlanningDocument = await recovered.json();
  expect(original.receipt.source_id).toBeNull();
  expect(original.receipt.revision).toBe(1);
  await expect(
    page.getByRole("dialog", { name: "Vista previa", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  const updates = [
    ["planning/purpose", "Propósito", "Propósito corregido manualmente"],
    [
      "activity:introduction/statement",
      "Actividad · Inicio · Observar usos cotidianos",
      "Inicio corregido manualmente",
    ],
    [
      "activity:exploration/minutes",
      "Minutos · Desarrollo · Proponer acciones",
      "45",
    ],
    ["planning/material-0", "Material 1", "Cuaderno de prueba"],
    [
      "planning/formative_assessment",
      "Evaluación formativa",
      "Pregunta de cierre corregida",
    ],
  ];
  let latest = original;
  for (const [target, label, text] of updates) {
    await page.getByLabel("Campo a corregir").selectOption(target);
    await page.getByLabel(label, { exact: true }).fill(text);
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname.endsWith("/revisions"),
    );
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    latest = await response.json();
    await expect(
      page.getByText("Guardado confirmado", { exact: true }),
    ).toBeVisible();
  }
  expect(latest.receipt.revision).toBe(6);
  expect(latest.initial_request).toEqual(original.request);
  expect(latest.result.duration_minutes).toBe(65);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Mis recursos", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Consultar planeación", exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Consultar planeación", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Vista previa", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".guided-paper")).toContainText(
    "Propósito corregido manualmente",
  );
  await expect(page.locator(".guided-meta")).toContainText("65 minutos");
  await page.getByText("Datos y procedencia de esta planeación").click();
  await expect(page.locator(".guided-context")).toContainText(
    "Situación hipotética. Escenario hipotético de prueba de software",
  );
  const prefix = `/scopes/${process.env.AULALISTA_E2E_SCOPE_ID}`;
  expect(
    (await (await page.request.get(`${prefix}/plannings`)).json()).items,
  ).toHaveLength(1);
  expect(
    (
      await (
        await page.request.get(
          `${prefix}/plannings/${original.receipt.planning_id}/revisions/1`,
        )
      ).json()
    ).result,
  ).toEqual(original.result);
});
