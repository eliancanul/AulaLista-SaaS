import { test, expect } from "@playwright/test";
import { waterPrompt, type SourceReceipt } from "../src/acenta/contracts";

test("real library pages survive history with private editing, focus and narrow reflow", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  // Real HTTP/PostgreSQL; identity and documents remain synthetic test fixtures.
  await page.goto("/tests/acenta-api.html");
  const url = page.url();
  await page.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
  await expect(page.getByText("No hay recursos todavía. Adjunta un ejemplo para empezar.")).toBeVisible();
  await page.getByRole("button", { name: "Volver a la petición" }).click();
  await page.getByRole("button", { name: "Adjuntar referencia", exact: true }).click();
  const sourceResponse = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/sources"));
  await page.getByRole("button", { name: /^Planeación de ciencias · ejemplo/ }).click();
  const source: SourceReceipt = await (await sourceResponse).json();
  const prefix = `/scopes/${source.scope_id}`;
  // The real API's default page size is 50. Seed one additional immutable result.
  for (let i = 0; i < 51; i++) {
    const response = await page.request.post(`${prefix}/plannings`, {
      headers: { "Idempotency-Key": crypto.randomUUID() },
      data: { contract_version: 1, fixture_context: "water-observation-v1", prompt: waterPrompt,
        source_id: source.source_id, expected_source_version: source.number },
    });
    expect(response.status()).toBe(201);
  }
  await page.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
  await page.getByRole("button", { name: "Actualizar listado" }).click();
  const entries = page.getByRole("button", { name: "Reabrir copia guardada" });
  await expect(entries).toHaveCount(50);
  await page.getByRole("button", { name: "Ver más recursos" }).click();
  await expect(entries).toHaveCount(51);
  const trigger = entries.last();
  await trigger.scrollIntoViewIfNeeded(); await trigger.focus();
  const scroll = await page.evaluate(() => window.scrollY);
  await trigger.press("Enter");
  const text = "Texto pendiente privado " + "observación".repeat(50);
  await page.getByLabel("Texto", { exact: true }).fill(text);
  expect(page.url()).toBe(url);
  const marker = await page.evaluate(() => JSON.stringify(history.state));
  expect(marker).not.toContain(source.source_id); expect(marker).not.toContain(text);
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(entries).toHaveCount(51);
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(scroll, 0);
  await page.goForward();
  await page.getByRole("button", { name: "Abrir resultado editable" }).click();
  await expect(page.getByLabel("Texto", { exact: true })).toHaveValue(text);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Seguir editando" }).click();
  await expect(page.getByLabel("Texto", { exact: true })).toHaveValue(text);
  await page.setViewportSize({ width: 320, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("navigation-editor-320.png"), fullPage: true });
  await page.goBack();
  await expect(entries).toHaveCount(51);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("navigation-library-320.png"), fullPage: true });
  await page.getByRole("button", { name: "Retomar edición abierta" }).click();
  await expect(page.getByLabel("Texto", { exact: true })).toHaveValue(text);
});
