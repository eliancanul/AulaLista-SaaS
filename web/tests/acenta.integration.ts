import { test, expect } from "@playwright/test";
import {
  waterSource,
  type PlanningDocument,
  type SourceReceipt,
} from "../src/acenta/contracts";

test("real HTTP and PostgreSQL preserve the fixture, edit and source after browser storage loss", async ({
  page,
}) => {
  // No route interception or in-memory server: pytest owns the test API and database.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bienvenido" })).toBeVisible();
  await page.goto("/tests/acenta-api.html");
  await page
    .getByRole("button", { name: "Ajustar planeación", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Adjuntar referencia", exact: true })
    .click();
  const sourceResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/sources"),
  );
  await page
    .getByRole("button", { name: /Planeación de ciencias · ejemplo/ })
    .click();
  const sourceHttp = await sourceResponse;
  expect(sourceHttp.status()).toBe(201);
  const source: SourceReceipt = await sourceHttp.json();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const createdResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/plannings"),
  );
  await page.getByRole("button", { name: "Enviar petición" }).dblclick();
  const createdHttp = await createdResponse;
  expect(createdHttp.status()).toBe(201);
  const created: PlanningDocument = await createdHttp.json();
  expect(created.receipt).toMatchObject({
    namespace: "planning-v1",
    revision: 1,
    source_id: source.source_id,
    source_version: source.number,
    source_sha256: source.sha256,
    actor_id: process.env.AULALISTA_E2E_ACTOR_ID,
    scope_id: process.env.AULALISTA_E2E_SCOPE_ID,
  });
  await expect(
    page.getByRole("heading", { name: "Agua que cambia", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("30 min", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Abrir resultado editable" }).click();
  const text = "Observa con calma y registra los cambios del agua.";
  await page.getByLabel("Texto", { exact: true }).fill(text);
  const savedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/revisions"),
  );
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  const savedHttp = await savedResponse;
  expect(savedHttp.status()).toBe(201);
  const saved: PlanningDocument = await savedHttp.json();
  expect(saved.receipt).toMatchObject({
    planning_id: created.receipt.planning_id,
    revision: 2,
    source_id: source.source_id,
    source_version_id: source.version_id,
  });
  await expect(
    page.getByText("Guardado confirmado", { exact: true }),
  ).toBeVisible();

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page
    .getByRole("button", { name: "Mis recursos", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Reabrir copia guardada" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Reabrir copia guardada" }).click();
  await expect(page.getByLabel("Texto", { exact: true })).toHaveValue(text);
  const prefix = `/scopes/${source.scope_id}`;
  const original = await page.request.get(
    `${prefix}/sources/${source.source_id}/versions/${source.number}`,
  );
  expect(original.status()).toBe(200);
  expect(original.headers()["x-content-sha256"]).toBe(source.sha256);
  expect(await original.text()).toBe(waterSource);
  const initialRevision = await page.request.get(
    `${prefix}/plannings/${created.receipt.planning_id}/revisions/1`,
  );
  expect(initialRevision.status()).toBe(200);
  expect((await initialRevision.json()).result).toEqual(created.result);
  const receipt = await page.request.get(
    `${prefix}/planning-operations/${saved.receipt.operation_id}`,
  );
  expect(receipt.status()).toBe(200);
  expect(await receipt.json()).toEqual(saved);
});
