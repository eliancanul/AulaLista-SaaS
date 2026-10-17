import { test, expect } from "@playwright/test";
import { sourceSamples, type SourceReceipt } from "../src/acenta/contracts";

test("original bytes, keyboard recovery and fixed replacement use real T2 persistence", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/acenta-api.html");
  await page
    .getByRole("button", { name: "Adjuntar referencia", exact: true })
    .click();
  async function select(index: number) {
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        /\/sources(?:\/[^/]+\/versions)?$/.test(new URL(r.url()).pathname),
    );
    await page
      .getByRole("button", {
        name: new RegExp(`^${sourceSamples[index].name}`),
      })
      .click();
    const http = await response;
    expect(http.status()).toBe(201);
    return (await http.json()) as SourceReceipt;
  }
  const initial = await select(0);
  const trigger = page.getByRole("button", {
    name: "Abrir original",
    exact: true,
  });
  await trigger.click();
  const viewer = page.getByRole("dialog", { name: "Original de ejemplo" });
  await expect(viewer.getByRole("status")).toContainText("bytes verificados");
  expect(await viewer.getByLabel("Contenido original").textContent()).toBe(
    sourceSamples[0].bytes,
  );
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Reemplazar", exact: true }).click();
  const revised = await select(1);
  expect(revised.source_id).toBe(initial.source_id);
  expect(revised.number).toBe(2);
  await trigger.click();
  await expect(viewer.getByRole("status")).toContainText("bytes verificados");
  expect(await viewer.getByLabel("Contenido original").textContent()).toBe(
    sourceSamples[1].bytes,
  );
  await viewer.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("button", { name: "Reemplazar", exact: true }).click();
  const other = await select(2);
  expect(other.source_id).not.toBe(initial.source_id);
  expect(other.number).toBe(1);
  const before = await page.request.get(
    `/scopes/${initial.scope_id}/sources/${initial.source_id}/versions/1`,
  );
  expect(before.status()).toBe(200);
  expect(await before.text()).toBe(sourceSamples[0].bytes);
  await page.getByRole("button", { name: "Reemplazar", exact: true }).click();
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") writes.push(r.url());
  });
  await page
    .getByRole("button", { name: new RegExp(`^${sourceSamples[1].name}`) })
    .click();
  await trigger.click();
  await expect(viewer.getByRole("status")).toContainText("bytes verificados");
  expect(await viewer.getByLabel("Contenido original").textContent()).toBe(
    sourceSamples[1].bytes,
  );
  expect(writes).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("original-verified.png"),
    fullPage: true,
  });
});
