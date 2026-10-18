import { test, expect } from "@playwright/test";

test("analytic client recovers a committed section and preserves exact independent origins through real HTTP/PostgreSQL", async ({ page }) => {
  await page.goto("/tests/acenta-api.html");
  const result = await page.evaluate(async session => {
    // Import the actual browser client; the harness injects identity only in its test API.
    const modulePath = "/src/acenta/api.ts";
    const { AcentaApi } = await import(modulePath) as typeof import("../src/acenta/api");
    const api = new AcentaApi(session);
    const data = {
      contract_version: 1 as const,
      name: "El cuidado del agua en la comunidad", grade: "3.º de primaria", period: "Octubre",
      context: { text: " Comunidad hipotética de prueba. ", hypothetical: true },
      situation: " Situación manual sobre el uso del agua. ",
      entries: [{ content: " Observar usos cotidianos. ", pda: " Describir acciones de cuidado. " }],
      formative_field: "Campo manual", articulating_axes: ["Eje manual"], language: "es", reference: null,
    };
    const key = crypto.randomUUID();
    let lostStatus: number | undefined;
    try { await api.createAnalyticSection(data, key); }
    catch (error) { lostStatus = (error as { status: number }).status; }
    // Python drops only the first successful response after the real commit.
    const original = await api.analyticSectionOperation(key);
    const replay = await api.createAnalyticSection(data, key);
    const classData = { contract_version: 1 as const, subject: "Ciencias naturales", duration_minutes: 50, method: "active-learning" };
    const planning = await api.deriveAnalyticPlanning(original, classData, crypto.randomUUID());
    const edited = await api.save(planning.receipt.planning_id, {
      contract_version: 1, expected_revision: 1, resource_key: "planning", element_key: "purpose", text: "Propósito corregido para esta clase.",
    }, crypto.randomUUID());
    const copy = await api.copy(planning.receipt.planning_id, {
      contract_version: 1, base_revision: 2, resource_key: "planning", element_key: "purpose", text: "Propósito de una copia independiente.",
    }, crypto.randomUUID());
    const draft = await api.draft(planning.receipt.planning_id, crypto.randomUUID(), {
      contract_version: 1, base_revision: 2, expected_draft_revision: 0,
      resource_key: "planning", element_key: "purpose", text: "Borrador de la clase.",
    }, crypto.randomUUID());
    const changed = structuredClone(data);
    changed.context.text = "Otro contexto manual hipotético.";
    changed.entries[0].pda = "Otra aportación manual.";
    const updated = await api.saveAnalyticSection(original.receipt.section_id, 1, changed, crypto.randomUUID());
    let conflictStatus: number | undefined;
    try { await api.saveAnalyticSection(original.receipt.section_id, 1, data, crypto.randomUUID()); }
    catch (error) { conflictStatus = (error as { status: number }).status; }
    const nextPlanning = await api.deriveAnalyticPlanning(updated, classData, crypto.randomUUID());
    return {
      lostStatus, conflictStatus, data, original, replay, updated, planning, edited, copy, draft, nextPlanning,
      originalReopened: await api.readAnalyticSection(original.receipt.section_id, 1),
      latestReopened: await api.readAnalyticSection(original.receipt.section_id),
      planningReopened: await api.read(planning.receipt.planning_id),
      copyReopened: await api.read(copy.receipt.planning_id),
      draftReopened: await api.readDraft(draft.receipt.draft_id),
      sections: await api.listAnalyticSections(),
    };
  }, { actorId: process.env.AULALISTA_E2E_ACTOR_ID!, scopeId: process.env.AULALISTA_E2E_SCOPE_ID! });
  expect(result.lostStatus).toBe(503);
  expect(result.conflictStatus).toBe(409);
  expect(result.original.data).toEqual(result.data);
  expect(result.original.provenance).toBe("manual-v1");
  expect(result.replay).toEqual(result.original);
  expect(result.originalReopened).toEqual(result.original);
  expect(result.latestReopened).toEqual(result.updated);
  expect(result.sections.items).toEqual([result.updated]);
  for (const document of [result.planning, result.edited, result.copy, result.draft, result.planningReopened, result.copyReopened, result.draftReopened])
    expect(document.analytic_origin).toEqual(result.original);
  expect(result.planningReopened.result.purpose).toBe("Propósito corregido para esta clase.");
  expect(result.copyReopened.result.purpose).toBe("Propósito de una copia independiente.");
  expect(result.draftReopened.result.purpose).toBe("Borrador de la clase.");
  expect(result.nextPlanning.analytic_origin).toEqual(result.updated);
  expect(result.planning.receipt.source_id).toBeNull();
  // The new section UI is deliberately outside this partial increment. Derived
  // classes remain usable through the already implemented library and reader.
  await page.reload();
  await page.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Consultar planeación", exact: true })).toHaveCount(3);
  await page.getByRole("button", { name: "Consultar planeación", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "Vista previa", exact: true })).toBeVisible();
});
