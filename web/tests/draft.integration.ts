import { test, expect } from "@playwright/test";
import { waterSource, type DraftDocument, type PlanningDocument } from "../src/acenta/contracts";

test("offline draft retry preserves identity and a fresh browser recovers the server draft", async ({ page, context, browser }) => {
  // Real API and PostgreSQL, with fixture identity supplied only by pytest.
  await page.goto("/tests/acenta-api.html");
  await page.getByRole("button", { name: "Ajustar planeación", exact: true }).click();
  await page.getByRole("button", { name: "Adjuntar referencia", exact: true }).click();
  await page.getByRole("button", { name: /Planeación de ciencias · ejemplo/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const creation = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/plannings"));
  await page.getByRole("button", { name: "Enviar petición" }).click();
  const createdHttp = await creation;
  expect(createdHttp.status()).toBe(201);
  const created: PlanningDocument = await createdHttp.json();
  const prefix = `/scopes/${created.receipt.scope_id}`;
  const planning = `${prefix}/plannings/${created.receipt.planning_id}`;
  await page.getByRole("button", { name: "Abrir resultado editable" }).click();
  const originalText = await page.getByLabel("Texto", { exact: true }).inputValue();
  await page.getByLabel("Texto", { exact: true }).fill("Cambio local para deshacer.");
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  await expect(page.getByLabel("Texto", { exact: true })).toHaveValue(originalText);
  const text = "Borrador privado: observa el agua y anota lo que cambia.";
  await page.getByLabel("Texto", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await context.setOffline(true);
  const failedWrite = page.waitForRequest(r => r.method() === "PUT" && r.url().includes("/drafts/"));
  await page.getByRole("button", { name: "Conservar borrador", exact: true }).click();
  const attempted = await failedWrite;
  const key = attempted.headers()["idempotency-key"];
  expect(key).toBeTruthy();
  await expect(page.getByRole("alert")).toContainText("No pudimos confirmar");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Seguir editando" }).click();
  await expect(page.getByLabel("Texto", { exact: true })).toHaveValue(text);
  await expect(page.getByText("Guardado sin confirmar", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deshacer", exact: true })).toBeDisabled();
  await context.setOffline(false);
  const lookup = page.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/planning-draft-operations/${key}`));
  const retry = page.waitForResponse(r => r.request().method() === "PUT" && r.url() === attempted.url());
  await page.getByRole("button", { name: "Comprobar estado", exact: true }).click();
  expect((await lookup).status()).toBe(404);
  const savedHttp = await retry;
  expect(savedHttp.status()).toBe(201);
  expect(savedHttp.request().headers()["idempotency-key"]).toBe(key);
  expect(savedHttp.request().postDataJSON()).toEqual(attempted.postDataJSON());
  const draft: DraftDocument = await savedHttp.json();
  expect(draft.receipt).toMatchObject({
    operation_id: key, draft_id: new URL(attempted.url()).pathname.split("/").at(-1),
    draft_revision: 1, planning_id: created.receipt.planning_id,
    base_revision: 1, base_revision_id: created.receipt.revision_id,
    actor_id: process.env.AULALISTA_E2E_ACTOR_ID, scope_id: process.env.AULALISTA_E2E_SCOPE_ID,
  });
  expect(draft.request.text).toBe(text);
  await expect(page.getByText("Borrador privado conservado", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // No storageState transfer: another browser context must recover via HTTP.
  const fresh = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    expect(await fresh.storageState()).toEqual({ cookies: [], origins: [] });
    const reopened = await fresh.newPage();
    await reopened.goto("/tests/acenta-api.html");
    await reopened.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
    await expect(reopened.getByRole("button", { name: "Recuperar borrador", exact: true })).toHaveCount(1);
    const recovered = reopened.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/planning-drafts/${draft.receipt.draft_id}`));
    await reopened.getByRole("button", { name: "Recuperar borrador", exact: true }).click();
    expect(await (await recovered).json()).toEqual(draft);
    await expect(reopened.getByLabel("Texto", { exact: true })).toHaveValue(text);
    for (const path of [planning, `${planning}/revisions/1`]) {
      const response = await reopened.request.get(path);
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual(created);
    }
    const source = await reopened.request.get(`${prefix}/sources/${created.receipt.source_id}/versions/${created.receipt.source_version}`);
    expect(source.status()).toBe(200);
    expect(source.headers()["x-content-sha256"]).toBe(created.receipt.source_sha256);
    expect(await source.text()).toBe(waterSource);
    const operation = await reopened.request.get(`${prefix}/planning-draft-operations/${key}`);
    expect(operation.status()).toBe(200);
    expect(await operation.json()).toEqual(draft);
  } finally {
    await fresh.close();
  }
});
