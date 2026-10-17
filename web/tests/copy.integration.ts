import { test, expect } from "@playwright/test";
import { waterSource, type PlanningDocument } from "../src/acenta/contracts";

test("two tabs preserve a conflict and recover one committed copy after a lost receipt and replay", async ({ page, context }) => {
  // Only the pytest copy scenario drops its first successful copy response.
  // Writes, conflict detection, operation recovery and replay use real PostgreSQL.
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
  const other = await context.newPage();
  await other.goto("/tests/acenta-api.html");
  await other.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
  await other.getByRole("button", { name: "Reabrir copia guardada", exact: true }).click();
  const baseline = await page.getByLabel("Texto", { exact: true }).inputValue();
  await expect(other.getByLabel("Texto", { exact: true })).toHaveValue(baseline);
  const winner = "Primera pestaña: registra los cambios del agua.";
  const divergent = "Segunda pestaña: dibuja lo observado y compara.";
  await page.getByLabel("Texto", { exact: true }).fill(winner);
  await other.getByLabel("Texto", { exact: true }).fill(divergent);
  const saving = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/revisions"));
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  const savedHttp = await saving;
  expect(savedHttp.status()).toBe(201);
  const saved: PlanningDocument = await savedHttp.json();
  expect(saved.receipt).toMatchObject({ planning_id: created.receipt.planning_id, revision: 2 });
  await expect(page.getByText("Guardado confirmado", { exact: true })).toBeVisible();
  const conflicting = other.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/revisions"));
  await other.getByRole("button", { name: "Guardar", exact: true }).click();
  expect((await conflicting).status()).toBe(409);
  await expect(other.getByText("Conflicto de versión", { exact: true })).toBeVisible();
  await expect(other.getByText(`Texto guardado: ${winner}`, { exact: true })).toBeVisible();
  await expect(other.getByLabel("Texto", { exact: true })).toHaveValue(divergent);
  const copying = other.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/copies"));
  await other.getByRole("button", { name: "Conservar copia", exact: true }).click();
  const lost = await copying;
  expect(lost.status()).toBe(503);
  const key = lost.request().headers()["idempotency-key"];
  expect(key).toBeTruthy();
  await expect(other.getByText("Guardado sin confirmar", { exact: true })).toBeVisible();
  await expect(other.getByLabel("Texto", { exact: true })).toHaveValue(divergent);
  await expect(other.getByRole("button", { name: "Deshacer", exact: true })).toBeDisabled();
  const recovering = other.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/planning-operations/${key}`));
  await other.getByRole("button", { name: "Comprobar estado", exact: true }).click();
  const recoveredHttp = await recovering;
  expect(recoveredHttp.status()).toBe(200);
  const copy: PlanningDocument = await recoveredHttp.json();
  expect(copy.receipt.planning_id).not.toBe(created.receipt.planning_id);
  expect(copy.receipt).toMatchObject({
    operation_id: key, revision: 1,
    actor_id: process.env.AULALISTA_E2E_ACTOR_ID, scope_id: process.env.AULALISTA_E2E_SCOPE_ID,
    source_id: created.receipt.source_id, source_version_id: created.receipt.source_version_id,
    source_sha256: created.receipt.source_sha256,
  });
  expect(copy.origin).toEqual({ planning_id: created.receipt.planning_id, revision_id: created.receipt.revision_id, revision: 1 });
  await expect(other.getByText("Guardado confirmado", { exact: true })).toBeVisible();
  // Replay the exact captured operation, not a new key or a mocked response.
  const replay = await other.request.post(lost.url(), { headers: { "Idempotency-Key": key }, data: lost.request().postDataJSON() });
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(copy);
  const listing = await other.request.get(`${prefix}/plannings`);
  expect(listing.status()).toBe(200);
  const listed = await listing.json();
  expect(listed.next_cursor).toBeNull();
  expect(listed.items).toHaveLength(2);
  expect(listed.items.map((d: PlanningDocument) => d.receipt.planning_id).sort()).toEqual([created.receipt.planning_id, copy.receipt.planning_id].sort());
  await other.getByLabel("Texto", { exact: true }).fill("Cambio local posterior a la copia confirmada.");
  await other.getByRole("button", { name: "Deshacer", exact: true }).click();
  await expect(other.getByLabel("Texto", { exact: true })).toHaveValue(divergent);
  for (const [path, expected] of [
    [planning, saved], [`${planning}/revisions/1`, created],
    [`${planning}/revisions/2`, saved], [`${prefix}/plannings/${copy.receipt.planning_id}`, copy],
  ] as const) {
    const response = await other.request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(expected);
  }
  const source = await other.request.get(`${prefix}/sources/${created.receipt.source_id}/versions/${created.receipt.source_version}`);
  expect(source.status()).toBe(200);
  expect(source.headers()["x-content-sha256"]).toBe(created.receipt.source_sha256);
  expect(await source.text()).toBe(waterSource);
  // Reopen both from the server library after removing the local backup.
  await context.clearCookies();
  await other.evaluate(() => localStorage.clear());
  await other.reload();
  await other.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
  await expect(other.getByRole("button", { name: "Reabrir copia guardada", exact: true })).toHaveCount(2);
  const texts = new Set<string>();
  for (let index = 0; index < 2; index++) {
    await other.getByRole("button", { name: "Reabrir copia guardada", exact: true }).nth(index).click();
    texts.add(await other.getByLabel("Texto", { exact: true }).inputValue());
    await other.getByRole("button", { name: "Cerrar", exact: true }).click();
    await other.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
  }
  expect(texts).toEqual(new Set([winner, divergent]));
});
