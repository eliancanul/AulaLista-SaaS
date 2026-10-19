import { test, expect, type Page } from "@playwright/test";
import { GuidedServer } from "./guided-server";
import { guidedRevised } from "./guided-fixtures";

async function mount(page: Page) {
  await page.addInitScript(() => {
    const host = window as typeof window & { guidedPrints: string[] };
    host.guidedPrints = [];
    const append = Element.prototype.append;
    Element.prototype.append = function (...nodes: (Node | string)[]) {
      append.apply(this, nodes);
      for (const node of nodes) {
        if (!(node instanceof HTMLIFrameElement) || !node.hasAttribute("data-acenta-print")) continue;
        const target = node.contentWindow!;
        target.print = () => {
          host.guidedPrints.push(target.document.body.innerText);
          target.dispatchEvent(new Event("afterprint"));
        };
      }
    };
  });
  const server = new GuidedServer();
  await page.route("**/scopes/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const response = await server.transport(url.pathname + url.search, {
      method: request.method(), headers: request.headers(), body: request.postData(),
    });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  await page.goto("/tests/acenta.html");
  await page.getByRole("button", { name: "Crear planeación", exact: true }).click();
  await page.getByRole("button", { name: "Usar datos del ejemplo" }).click();
  await page.getByRole("button", { name: "Crear ejemplo de software", exact: true }).click();
  return server;
}

const printed = (page: Page) => page.evaluate(() => (window as typeof window & { guidedPrints: string[] }).guidedPrints);

for (const width of [320, 1280])
  test(`guided reader at ${width}px prints its saved revision and retains navigation and editing`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const server = await mount(page);
    const reader = page.getByRole("dialog", { name: width === 320 ? "Lectura de planeación" : "Vista previa", exact: true });
    await expect(reader).toBeVisible();
    const button = reader.getByRole("button", { name: "Imprimir", exact: true });
    await expect(button).toBeVisible();
    const before = server.calls.length;
    for (const count of [1, 2]) {
      await button.click();
      await expect.poll(async () => (await printed(page)).length).toBe(count);
      await expect(button).toBeFocused();
      await expect(page.locator("iframe[data-acenta-print]")).toHaveCount(0);
    }
    expect(server.calls).toHaveLength(before);
    for (const text of await printed(page)) {
      expect(text).toContain("Revisión 1");
      expect(text).toContain("Fixture conservado");
      expect(text).not.toContain("Abre el diálogo de impresión");
    }
    expect(await reader.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`print-reader-${width}.png`) });
    if (width === 320) {
      const sections = page.getByRole("button", { name: "Secciones", exact: true });
      await sections.click();
      await expect(page.getByRole("dialog", { name: "Ir a una sección", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sections).toBeFocused();
    }
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Editar planeación", exact: true });
    await expect(editor).toBeVisible();
    await page.getByLabel("Propósito", { exact: true }).fill("PROPOSITO CONFIRMADO DOS PARA IMPRIMIR");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByText("Guardado confirmado", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(reader).toBeVisible();
    const saved = [...server.docs.values()][0];
    expect(saved.receipt.revision).toBe(2);
    server.put(guidedRevised(saved, "LATEST TRES NUNCA CONSULTADO PARA IMPRIMIR"));
    const beforeLastPrint = server.calls.length;
    await button.click();
    await expect.poll(async () => (await printed(page)).length).toBe(3);
    const final = (await printed(page))[2];
    expect(final).toContain("Revisión 2");
    expect(final).toContain("PROPOSITO CONFIRMADO DOS PARA IMPRIMIR");
    expect(final).not.toContain("LATEST TRES");
    await expect(button).toBeFocused();
    expect(server.calls).toHaveLength(beforeLastPrint);
  });
