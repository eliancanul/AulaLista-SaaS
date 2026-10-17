import { createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { FixtureServer, json, planning, session, source } from "./acenta-fixtures";
import { sourceSamples, type SourceReceipt } from "../src/acenta/contracts";

function original(receipt: SourceReceipt, bytes: Uint8Array<ArrayBuffer> | string) {
  return new Response(bytes, { headers: {
    "Cache-Control": "no-store", "X-Source-Id": receipt.source_id,
    "X-Version": String(receipt.number), "X-Content-SHA256": receipt.sha256,
    "X-Content-Size": String(receipt.size), "X-Actor-Id": session.actorId,
  } });
}
async function mount(page: Page) {
  const server = new FixtureServer();
  let read = () => original(source, sourceSamples[0].bytes);
  await page.route("**/scopes/**", async (route) => {
    const r = route.request(), url = new URL(r.url());
    const response = /\/sources\/[^/]+\/versions\/\d+$/.test(url.pathname)
      ? read()
      : await server.transport(url.pathname + url.search, { method: r.method(), headers: r.headers(), body: r.postData() });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  await page.goto("/tests/acenta.html");
  return { server, reader: (next: typeof read) => { read = next; } };
}
const resources = (page: Page) => page.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
const open = (page: Page) => page.getByRole("article").first().getByRole("button", { name: "Abrir original", exact: true });

test("original-only catalog preserves request, selection, context, keyboard focus and history", async ({ page }, info) => {
  const { server } = await mount(page);
  await resources(page);
  await expect(page.getByText("No hay recursos todavía. Adjunta un ejemplo para empezar.")).toBeVisible();
  await page.getByRole("button", { name: "Volver a la petición" }).click();
  await page.getByLabel("Petición para tu clase").fill("Petición conservada");
  await page.getByRole("button", { name: "Adjuntar referencia", exact: true }).click();
  await page.getByRole("button", { name: /^Planeación de ciencias · ejemplo/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await resources(page);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText("Aún no hay copias ni borradores guardados.")).toBeVisible();
  await expect(page.getByText(/No hay recursos todavía/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reabrir copia guardada" })).toHaveCount(0);
  await open(page).focus(); await open(page).press("Enter");
  const dialog = page.getByRole("dialog", { name: "Original de ejemplo" });
  await expect(dialog.getByRole("status")).toContainText("bytes verificados");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0); await expect(open(page)).toBeFocused();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("original-only-resources-320.png"), fullPage: true });
  await page.goBack();
  await expect(page.getByLabel("Petición para tu clase")).toHaveValue("Petición conservada");
  await expect(page.getByRole("button", { name: "Referencia adjunta", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ciencias ⌄", exact: true })).toBeVisible();
  await page.goForward(); await expect(page.getByRole("article")).toHaveCount(1);
  expect(server.docs.size).toBe(0);
  expect(server.calls.filter((c) => c.method !== "GET")).toHaveLength(1);
});

test("catalog loading/error/retry retains originals and never reports a false empty state", async ({ page }) => {
  const { server } = await mount(page);
  server.sources.set(source.operation_id, source);
  await resources(page); await expect(page.getByRole("article")).toHaveCount(1);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  server.before = async (call) => {
    if (!call.path.startsWith("sources?")) return;
    await blocked;
    return json({ detail: "unavailable" }, 503);
  };
  await page.getByRole("button", { name: "Actualizar listado" }).click();
  await expect(page.getByText("Recuperando recursos…")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  release();
  await expect(page.getByRole("button", { name: "Reintentar listado" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText(/No hay recursos todavía/)).toHaveCount(0);
  server.before = null;
  await page.getByRole("button", { name: "Reintentar listado" }).click();
  await expect(page.getByRole("button", { name: "Reintentar listado" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("unknown originals have honest labels and corruption or unsupported encoding never fabricates a preview", async ({ page }) => {
  const { server, reader } = await mount(page);
  const text = "Contenido opaco permitido, sin nombre ni tipo de documento.";
  const receipt = { ...source, sha256: createHash("sha256").update(text).digest("hex"), size: Buffer.byteLength(text) };
  server.sources.set(receipt.operation_id, receipt);
  reader(() => original(receipt, text));
  await resources(page);
  await expect(page.getByRole("article").getByRole("heading")).toHaveText("Recurso original");
  await expect(page.getByRole("article")).not.toContainText(/PDF|fixture|ejemplo|sintético/i);
  await open(page).click();
  const dialog = page.getByRole("dialog", { name: "Recurso original", exact: true });
  await expect(dialog.getByLabel("Contenido original")).toHaveText(text);
  await expect(dialog).not.toContainText(/PDF|fixture|ejemplo|sintético/i);
  await page.keyboard.press("Escape");
  reader(() => original(receipt, "x".repeat(receipt.size)));
  await open(page).click();
  await expect(dialog.getByRole("alert")).toContainText("No se pudo verificar o mostrar");
  await expect(dialog.getByLabel("Contenido original")).toHaveCount(0);
  await page.keyboard.press("Escape");
  reader(() => json({ detail: "not_found" }, 404));
  await open(page).click();
  await expect(dialog.getByRole("status")).toHaveText("Original no disponible.");
  await expect(dialog.getByLabel("Contenido original")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const bytes = new Uint8Array([255]);
  const binary = { ...receipt, size: 1, sha256: createHash("sha256").update(bytes).digest("hex") };
  server.sources.set(binary.operation_id, binary);
  reader(() => original(binary, bytes));
  await page.getByRole("button", { name: "Actualizar listado" }).click();
  await expect(page.getByRole("article")).toContainText(binary.sha256);
  await open(page).click();
  await expect(dialog.getByRole("alert")).toContainText("No se pudo verificar o mostrar");
  await expect(dialog.getByLabel("Contenido original")).toHaveCount(0);
});

test("opening an original from Resources preserves the suspended dirty editor", async ({ page }) => {
  const { server } = await mount(page);
  server.sources.set(source.operation_id, source); server.put(planning());
  await resources(page);
  await page.getByRole("button", { name: "Reabrir copia guardada" }).click();
  await page.getByLabel("Texto", { exact: true }).fill("Edición local conservada");
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await open(page).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("bytes verificados");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Retomar edición abierta" }).click();
  await expect(page.getByLabel("Texto", { exact: true })).toHaveValue("Edición local conservada");
  expect(server.calls.filter((c) => c.method !== "GET")).toEqual([]);
});

test("source pagination remains usable when there are no plannings or drafts", async ({ page }) => {
  const { server } = await mount(page);
  for (let i = 0; i < 51; i++) {
    const receipt = { ...source, source_id: `90000000-0000-4000-8000-${String(i).padStart(12, "0")}`, operation_id: crypto.randomUUID() };
    server.sources.set(receipt.operation_id, receipt);
  }
  await resources(page); await expect(page.getByRole("article")).toHaveCount(50);
  await page.getByRole("button", { name: "Ver más recursos" }).click();
  await expect(page.getByRole("article")).toHaveCount(51);
  const ids = await page.locator("[data-navigation-focus^='source-']").evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.navigationFocus));
  expect(new Set(ids).size).toBe(51);
  await expect(page.getByRole("button", { name: "Ver más recursos" })).toHaveCount(0);
});
