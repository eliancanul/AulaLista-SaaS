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
  // The analytic explorer/reader remain pending. Derived classes retain the
  // already implemented library and reader.
  await page.reload();
  await page.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Consultar planeación", exact: true })).toHaveCount(3);
  await page.getByRole("button", { name: "Consultar planeación", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "Vista previa", exact: true })).toBeVisible();
});

test("analytic form saves and revises exact manual data through real HTTP and PostgreSQL", async ({ page }) => {
  await page.goto("/tests/acenta-api.html");
  await page.getByRole("button", { name: "Crear planeación", exact: true }).click();
  await page.getByRole("button", { name: "Programa analítico", exact: true }).click();
  await page.getByLabel("Nombre del apartado").fill(" Apartado manual desde el formulario ");
  await page.getByLabel("Grado").selectOption("3.º de primaria");
  await page.getByLabel("Periodo").fill(" Octubre · 2026 ");
  await page.getByLabel("Contexto del grupo", { exact: true }).fill(" Comunidad imaginaria. ");
  await page.getByLabel("Situación hipotética", { exact: true }).check();
  await page.getByLabel("Situación a trabajar").fill(" Situación escrita por el docente. ");
  await page.getByLabel(/^Contenido \*$/).fill(" Contenido manual. ");
  await page.getByLabel("Proceso de desarrollo de aprendizaje (PDA)").fill(" PDA manual. ");
  const createResponse = page.waitForResponse(response => response.request().method() === "POST" &&
    new URL(response.url()).pathname.endsWith("/analytic-sections"));
  await page.getByRole("button", { name: "Guardar apartado", exact: true }).click();
  const created = await createResponse;
  expect(created.status()).toBe(201);
  const original = await created.json();
  await expect(page.getByRole("status").filter({ hasText: "Apartado guardado" })).toBeVisible();
  expect(original.data).toMatchObject({
    name: " Apartado manual desde el formulario ", period: " Octubre · 2026 ",
    context: { text: " Comunidad imaginaria. ", hypothetical: true },
    entries: [{ content: " Contenido manual. ", pda: " PDA manual. " }], reference: null,
  });
  const path = `/scopes/${process.env.AULALISTA_E2E_SCOPE_ID}/analytic-sections/${original.receipt.section_id}`;
  await page.getByLabel("Situación a trabajar").fill(" Otra situación manual. ");
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page.getByText("Revisión 2 confirmada.", { exact: true })).toBeVisible();
  const reopened = await page.request.get(path);
  expect(reopened.status()).toBe(200);
  expect(reopened.headers()["cache-control"]).toBe("no-store");
  expect((await reopened.json()).data).toEqual({ ...original.data, situation: " Otra situación manual. " });
  expect(await (await page.request.get(`${path}/revisions/1`)).json()).toEqual(original);
});

test("analytic client searches the whole catalog before paginating through real HTTP and PostgreSQL", async ({ page }) => {
  await page.goto("/tests/acenta-api.html");
  const result = await page.evaluate(async session => {
    const modulePath = "/src/acenta/api.ts";
    const { AcentaApi, ApiError } = await import(modulePath) as typeof import("../src/acenta/api");
    const api = new AcentaApi(session);
    const saved = [];
    for (let index = 0; index < 3; index++) {
      const key = crypto.randomUUID();
      const data = {
        contract_version: 1 as const, name: `Explorador & 100%_ · ${index}`, grade: "3.º de primaria", period: "Octubre",
        context: null, situation: "Una situación sintética.", entries: [{ content: "Contenido propio.", pda: "PDA propio." }],
        formative_field: "Campo de prueba", articulating_axes: [], language: "es", reference: null,
      };
      // The harness may drop this journey's first successful write response.
      try { saved.push(await api.createAnalyticSection(data, key)); }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 503) throw error;
        saved.push(await api.analyticSectionOperation(key));
      }
    }
    saved.sort((a, b) => a.receipt.section_id.localeCompare(b.receipt.section_id));
    const filters = { q: "EXPLORADOR & 100%_", grade: "3.º de primaria", formative_field: "Campo de prueba" };
    const first = await api.listAnalyticSections(undefined, 2, filters);
    const second = await api.listAnalyticSections(first.next_cursor!, 2, filters);
    const empty = await api.listAnalyticSections(undefined, 2, { ...filters, grade: "4.º de primaria" });
    return { saved, first, second, empty };
  }, { actorId: process.env.AULALISTA_E2E_ACTOR_ID!, scopeId: process.env.AULALISTA_E2E_SCOPE_ID! });
  expect(result.first).toEqual({ items: result.saved.slice(0, 2), next_cursor: result.saved[1].receipt.section_id });
  expect(result.second).toEqual({ items: result.saved.slice(2), next_cursor: null });
  expect(result.empty).toEqual({ items: [], next_cursor: null });
});
