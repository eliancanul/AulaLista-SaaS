import { test, expect, type Page } from "@playwright/test";

type Printed = { text: string; html: string; title: string; controls: number };
type PrintProbe = typeof window & {
  printCalls: Printed[];
  printMode: "afterprint" | "return" | "throw";
  mutateBeforeRendering: boolean;
  holdDecode: boolean;
  rejectDecode: boolean;
  releaseDecode(): void;
};

/** The native dialog is outside Playwright: exercise its return/afterprint paths. */
async function mount(page: Page) {
  const requests: string[] = [];
  page.on("request", request => {
    if (/\/scopes\/|\/api\//.test(request.url())) requests.push(request.url());
  });
  await page.addInitScript(() => {
    const host = window as PrintProbe;
    host.printCalls = [];
    host.printMode = "afterprint";
    host.mutateBeforeRendering = false;
    host.holdDecode = false;
    host.rejectDecode = false;
    const previous: Window[] = [];
    const installed = new WeakSet<HTMLIFrameElement>();
    const install = (node: Node) => {
      if (!(node instanceof HTMLIFrameElement) || !node.hasAttribute("data-acenta-print") || installed.has(node)) return;
      installed.add(node);
      const target = node.contentWindow!;
      if (host.holdDecode || host.rejectDecode) {
        const imagePrototype = (target as Window & typeof globalThis).HTMLImageElement.prototype;
        imagePrototype.decode = () => host.rejectDecode
          ? Promise.reject(new Error("Image unavailable"))
          : new Promise<void>(resolve => { host.releaseDecode = resolve; });
      }
      target.print = () => {
        const doc = target.document;
        host.printCalls.push({
          text: doc.body.innerText,
          html: doc.documentElement.outerHTML,
          title: doc.title,
          controls: doc.querySelectorAll("button, nav, input, textarea, select").length,
        });
        // A late event from a removed frame must not dispose this new attempt.
        previous.forEach(old => old.dispatchEvent(new Event("afterprint")));
        if (!node.isConnected) throw new Error("A stale afterprint disposed the new frame");
        previous.push(target);
        if (host.printMode === "throw") throw new Error("Print unavailable in this browser");
        if (host.printMode === "afterprint") target.dispatchEvent(new Event("afterprint"));
      };
      if (host.mutateBeforeRendering) {
        host.mutateBeforeRendering = false;
        host.printHarness.mutateCurrent();
      }
    };
    // Install synchronously, before the component renders into its new frame.
    const append = Element.prototype.append;
    Element.prototype.append = function (...nodes: (Node | string)[]) {
      append.apply(this, nodes);
      nodes.forEach(node => { if (node instanceof Node) install(node); });
    };
    const appendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function <T extends Node>(node: T): T {
      const result = appendChild.call(this, node) as T;
      install(node);
      return result;
    };
  });
  await page.goto("/tests/print-planning.html");
  return requests;
}

const calls = (page: Page) => page.evaluate(() => (window as PrintProbe).printCalls);

for (const mode of ["afterprint", "return"] as const)
  test(`cancel/close through ${mode} cleans up and permits another exact revision`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const requests = await mount(page);
    await page.evaluate(value => { (window as PrintProbe).printMode = value; }, mode);
    const button = page.getByRole("button", { name: "Imprimir", exact: true });
    await expect(button).toHaveAccessibleDescription("Abre el diálogo de impresión. Puedes guardar como PDF si tu navegador lo permite.");
    await button.click();
    await expect.poll(async () => (await calls(page)).length).toBe(1);
    await expect(page.locator("iframe[data-acenta-print]")).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toBeEnabled();
    const first = (await calls(page))[0];
    expect(first.text).toContain("CONTENIDO GUARDADO REVISION UNO.");
    expect(first.text).toContain("Revisión 1");
    expect(first.title).toContain("Revisión 1");
    expect(first.text).toContain("Fixture conservado");
    expect(first.text).not.toMatch(/BORRADOR QUE|CUENTA PRIVADA|NAVEGACION QUE|REVISION DOS/);
    expect(first.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(first.controls).toBe(0);
    await page.getByRole("button", { name: "Cambiar a revisión dos" }).click();
    await button.click();
    await expect.poll(async () => (await calls(page)).length).toBe(2);
    const second = (await calls(page))[1];
    expect(second.text).toContain("CONTENIDO GUARDADO REVISION DOS.");
    expect(second.text).toContain("Revisión 2");
    expect(second.text).not.toContain("CONTENIDO GUARDADO REVISION UNO.");
    await expect(button).toBeFocused();
    await expect(page.locator("iframe[data-acenta-print]")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByLabel("Borrador sin guardar")).toHaveValue("BORRADOR QUE NO DEBE IMPRIMIRSE");
    expect(requests).toEqual([]);
  });

test("captures an immutable revision before rendering and never prints a later mutation", async ({ page }) => {
  const requests = await mount(page);
  await page.evaluate(() => { (window as PrintProbe).mutateBeforeRendering = true; });
  await page.getByRole("button", { name: "Imprimir", exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  const printed = (await calls(page))[0];
  expect(printed.text).toContain("CONTENIDO GUARDADO REVISION UNO.");
  expect(printed.text).toContain("Revisión 1");
  expect(printed.text).not.toMatch(/MUTACION POSTERIOR|ACTIVIDAD MUTADA|Revisión 99/);
  expect(requests).toEqual([]);
});

test("a failed print is honest, cleans its frame, restores focus and can be retried", async ({ page }) => {
  const requests = await mount(page);
  const button = page.getByRole("button", { name: "Imprimir", exact: true });
  await page.evaluate(() => { (window as PrintProbe).printMode = "throw"; });
  await button.click();
  await expect(page.getByRole("alert")).toContainText("No se pudo abrir la impresión");
  await expect(button).toBeFocused();
  await expect(button).toBeEnabled();
  await expect(page.locator("iframe[data-acenta-print]")).toHaveCount(0);
  await page.evaluate(() => { (window as PrintProbe).printMode = "afterprint"; });
  await button.click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(requests).toEqual([]);
});

for (const action of ["Cambiar a revisión dos", "Retirar control de impresión"])
  test(`${action} cancels pending preparation without printing a stale revision`, async ({ page }) => {
    const requests = await mount(page);
    await page.evaluate(() => { (window as PrintProbe).holdDecode = true; });
    await page.getByRole("button", { name: "Imprimir", exact: true }).click();
    await expect(page.getByRole("button", { name: "Preparando impresión…" })).toBeDisabled();
    await expect(page.locator("iframe[data-acenta-print]")).toHaveCount(1);
    await page.getByRole("button", { name: action }).click();
    await expect(page.locator("iframe[data-acenta-print]")).toHaveCount(0);
    await page.evaluate(() => { (window as PrintProbe).releaseDecode(); });
    expect(await calls(page)).toEqual([]);
    if (action === "Cambiar a revisión dos") {
      await page.evaluate(() => { (window as PrintProbe).holdDecode = false; });
      await page.getByRole("button", { name: "Imprimir", exact: true }).click();
      await expect.poll(async () => (await calls(page)).length).toBe(1);
      expect((await calls(page))[0].text).toContain("CONTENIDO GUARDADO REVISION DOS.");
    }
    expect(requests).toEqual([]);
  });

test("an image preparation failure allows a clean retry of the same saved revision", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => { (window as PrintProbe).rejectDecode = true; });
  const button = page.getByRole("button", { name: "Imprimir", exact: true });
  await button.click();
  await expect(page.getByRole("alert")).toContainText("No se pudo abrir la impresión");
  await expect(page.locator("iframe[data-acenta-print]")).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(await calls(page)).toEqual([]);
  await page.evaluate(() => { (window as PrintProbe).rejectDecode = false; });
  await button.click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const fixture of [
  { name: "bounded fields", button: "Cargar contenido extenso", title: "Planeación extensa de prueba de impresión", markers: ["FIN-PROPOSITO", "FIN-ACTIVIDAD-2", "FIN-ACTIVIDAD-3", "FIN-EVALUACION", "FIN-CONTEXTO", "FIN-EJE-7"] },
  { name: "extra stress", button: "Cargar estrés multipágina", title: "Planeación de estrés multipágina", markers: ["Párrafo 001", "FIN-045", "FIN-090", "ULTIMA ACTIVIDAD CONSERVADA", "ULTIMA EVALUACION CONSERVADA"] },
]) test(`${fixture.name} produces an actual multipage Letter PDF with the print document only`, async ({ page }, info) => {
  const requests = await mount(page);
  await page.getByRole("button", { name: fixture.button }).click();
  await page.getByRole("button", { name: "Imprimir", exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  const printed = (await calls(page))[0];
  // Reuse the exact serialized fixture DOM captured inside the actual print call.
  // Product code never interpolates HTML; this test copies the already escaped DOM.
  await page.setContent(printed.html);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(fixture.title);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, image => image.decode()));
  });
  const pdf = await page.pdf({
    path: info.outputPath("planning-letter-multipage.pdf"),
    preferCSSPageSize: true,
    printBackground: false,
    displayHeaderFooter: false,
  });
  // The PDF itself is the artifact; its page dictionaries prove physical layout.
  const pdfText = pdf.toString("latin1");
  const pages = pdfText.match(/\/Type\s*\/Page\b/g) ?? [];
  expect(pages.length).toBeGreaterThanOrEqual(3);
  expect(pdfText).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+612\s+792\s*\]/);
  await info.attach("planning-letter-multipage", { body: pdf, contentType: "application/pdf" });
  const body = await page.locator("body").innerText();
  for (const marker of fixture.markers)
    expect(body).toContain(marker);
  expect(body).toContain("Revisión 2");
  expect(body).toContain("Fixture conservado");
  expect(body).not.toMatch(/BORRADOR QUE|CUENTA PRIVADA|NAVEGACION QUE/);
  await expect(page.locator("button, nav, input, textarea, select")).toHaveCount(0);
  expect(requests).toEqual([]);
});
