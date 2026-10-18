import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { PlanningDocument } from "../src/acenta/contracts";

async function login(page: Page, width: number) {
  await page.goto("/");
  await page.getByRole("button", { name: "Continuar con correo", exact: true }).click();
  const email = `guided-accessibility-${width}@example.test`;
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Enviar código", exact: true }).click();
  await expect(page.getByLabel("Código de un uso", { exact: true })).toBeVisible();
  const mailbox = await page.request.get(`/__test__/mailbox?email=${encodeURIComponent(email)}`);
  expect(mailbox.status()).toBe(200);
  const { code } = await mailbox.json();
  try {
    await page.getByLabel("Código de un uso", { exact: true }).fill(code);
  } catch {
    throw new Error("Could not enter the synthetic code (value withheld).");
  }
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/auth/email/verify");
  await page.getByRole("button", { name: "Verificar código", exact: true }).click();
  const verified = await response;
  expect(verified.status()).toBe(200);
  await expect(page.getByRole("button", { name: "Cerrar sesión", exact: true })).toBeVisible();
  const session = await verified.json();
  return session.scope_id as string;
}

async function tabTo(page: Page, target: Locator, reverse = false) {
  await expect(target).toBeVisible();
  for (let count = 0; count < 60; count++) {
    if (await target.evaluate((el) => el === document.activeElement)) {
      await expect(target).toBeInViewport({ ratio: 1 });
      return;
    }
    await page.keyboard.press(reverse ? "Shift+Tab" : "Tab");
  }
  throw new Error("Visible control was not reachable by keyboard within 60 tabs.");
}

async function reflow(page: Page, root: Locator, modal = false) {
  await page.evaluate(() => document.fonts.ready);
  const layout = await root.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const surface = el.querySelector(".guided-reading-surface");
    const controls = Array.from(el.querySelectorAll("button, input, select, textarea"))
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
    return {
      width: innerWidth, height: innerHeight,
      left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      pageWidth: document.documentElement.scrollWidth,
      scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
      surfaceWidth: surface?.scrollWidth, surfaceClient: surface?.clientWidth,
      controls,
    };
  });
  expect(layout.pageWidth).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.left).toBeGreaterThanOrEqual(-1);
  expect(layout.right).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  for (const control of layout.controls) {
    expect(control.left).toBeGreaterThanOrEqual(-1);
    expect(control.right).toBeLessThanOrEqual(layout.width + 1);
  }
  if (layout.surfaceWidth !== undefined)
    expect(layout.surfaceWidth).toBeLessThanOrEqual(layout.surfaceClient! + 1);
  if (modal) {
    expect(layout.top).toBeGreaterThanOrEqual(-1);
    expect(layout.bottom).toBeLessThanOrEqual(layout.height + 1);
  }
  return layout;
}

for (const width of [320, 390, 700, 701, 1440]) {
  test(`guided keyboard, focus and reflow with real auth/API/PostgreSQL at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width <= 700 ? 844 : 924 });
    const externalRequests: string[] = [];
    let submissions = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (/^https?:$/.test(url.protocol) && url.origin !== "http://localhost:4175")
        externalRequests.push(url.origin);
      if (request.method() === "POST" && url.pathname.endsWith("/guided-plannings"))
        submissions++;
    });
    const scope = await login(page, width);
    const create = page.getByRole("button", { name: "Crear planeación", exact: true });
    await tabTo(page, create);
    await page.keyboard.press("Enter");
    const form = page.locator(".guided-page");
    await expect(form.getByRole("heading", { name: "Planeación de clase" })).toBeVisible();
    await tabTo(page, create);
    await page.keyboard.press("Enter");
    const subject = page.getByLabel("Asignatura", { exact: false });
    await expect(subject).toBeFocused();
    await expect(subject).toHaveAttribute("aria-invalid", "true");
    await expect(subject).toHaveAttribute("aria-describedby", "guided-subject-error");
    await expect(page.locator("#guided-subject-error")).toBeVisible();
    await expect(form.getByRole("alert")).toContainText("campos marcados");
    expect(submissions).toBe(0);
    await reflow(page, form);

    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await expect(subject).toHaveValue("Ciencias naturales");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Grado", { exact: false })).toBeFocused();
    await page.keyboard.press("Home");
    for (let grade = 0; grade < 3; grade++) await page.keyboard.press("ArrowDown");
    await expect(page.getByLabel("Grado", { exact: false })).toHaveValue("3.º de primaria");
    await page.keyboard.press("Tab");
    const topic = page.getByLabel("Tema", { exact: false });
    await expect(topic).toBeFocused();
    await page.keyboard.insertText("Tema no admitido por el ejemplo");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Duración (minutos)")).toBeFocused();
    await page.keyboard.press("Tab");
    const options = page.getByRole("button", { name: /Contexto y opciones/ });
    await expect(options).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(options).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Método de enseñanza")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Idioma del material")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Contexto · Aportación manual", { exact: true })).toBeFocused();
    const context = "Situación ficticia para probar el recorrido de software. ".repeat(8);
    await page.keyboard.insertText(context);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Situación hipotética")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByLabel("Situación hipotética")).toBeChecked();
    await reflow(page, form);
    await tabTo(page, options, true);
    await page.keyboard.press("Enter");
    await expect(options).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Resumen de contexto y opciones")).toContainText("Hipotético:");

    await tabTo(page, create);
    const rejected = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/guided-plannings"));
    await page.keyboard.press("Enter");
    expect((await rejected).status()).toBe(422);
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(topic).toHaveValue("Tema no admitido por el ejemplo");
    const catalog = await page.request.get(`/scopes/${scope}/plannings`);
    expect(catalog.status()).toBe(200);
    expect((await catalog.json()).items).toHaveLength(0);
    await reflow(page, form);

    await tabTo(page, topic, true);
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText("El cuidado del agua en la comunidad");
    await tabTo(page, create);
    const created = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/guided-plannings"));
    await page.keyboard.press("Enter");
    const response = await created;
    expect(response.status()).toBe(201);
    const document: PlanningDocument = await response.json();
    expect(document.request.contract_version).toBe(2);
    expect(document.receipt.scope_id).toBe(scope);
    expect(document.receipt.source_id).toBeNull();
    expect(submissions).toBe(2);
    const reader = page.getByRole("dialog", { name: width <= 700 ? "Lectura de planeación" : "Vista previa", exact: true });
    await expect(reader).toBeVisible();
    await expect(reader.getByRole("button", { name: width <= 700 ? "Mis recursos" : "Editar", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(width <= 700 ? reader.locator("summary") : reader.getByRole("button", { name: "Cerrar vista previa", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(reader.getByRole("button", { name: width <= 700 ? "Mis recursos" : "Editar", exact: true })).toBeFocused();
    const layout = await reflow(page, reader, true);
    const layoutPath = test.info().outputPath(`reader-layout-${width}.json`);
    await writeFile(layoutPath, JSON.stringify(layout, null, 2));
    await test.info().attach(`reader-layout-${width}`, { path: layoutPath, contentType: "application/json" });

    const details = reader.locator("summary");
    await tabTo(page, details);
    await page.keyboard.press("Enter");
    await expect(reader.locator(".guided-context")).toContainText(`Situación hipotética. ${context}`);
    await reflow(page, reader, true);
    if (width <= 700) {
      const sections = reader.getByRole("button", { name: "Secciones", exact: true });
      await tabTo(page, sections);
      await page.keyboard.press("Enter");
      const sheet = page.getByRole("dialog", { name: "Ir a una sección", exact: true });
      await expect(sheet.getByRole("button", { name: "Cerrar secciones", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(sheet.getByRole("button", { name: "Propósito", exact: true })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(sheet.getByRole("button", { name: "Cerrar secciones", exact: true })).toBeFocused();
      await reflow(page, sheet, true);
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await expect(reader).toBeVisible();
      await expect(sections).toBeFocused();
      await page.keyboard.press("Enter");
      await tabTo(page, sheet.getByRole("button", { name: "Evaluación formativa", exact: true }));
      await page.keyboard.press("Enter");
      await expect(sheet).toHaveCount(0);
      await expect(reader.locator('[data-section="assessment"]')).toBeFocused();
      await expect(reader.locator('[data-section="assessment"]')).toBeInViewport();
    }
    const edit = reader.getByRole("button", { name: "Editar", exact: true });
    await tabTo(page, edit);
    await page.keyboard.press("Enter");
    const editor = page.getByRole("dialog", { name: "Editar planeación", exact: true });
    await expect(editor).toBeVisible();
    await reflow(page, editor, true);
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(reader).toBeVisible();
    // Opening the editor unmounts the reader. The new modal uses its first
    // control: mobile Mis recursos, desktop Editar; no test-forced focus.
    await expect(reader.getByRole("button", { name: width <= 700 ? "Mis recursos" : "Editar", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("main")).toBeFocused();
    const reopen = page.getByRole("button", { name: "Consultar planeación", exact: true });
    await tabTo(page, reopen);
    await page.keyboard.press("Enter");
    await expect(reader).toBeVisible();
    await reflow(page, reader, true);
    if (width === 700) {
      // A live breakpoint change must not close the reader or lose focus to
      // the background when its previously focused Secciones control unmounts.
      await tabTo(page, reader.getByRole("button", { name: "Secciones", exact: true }));
      await page.keyboard.press("Enter");
      const sheet = page.getByRole("dialog", { name: "Ir a una sección", exact: true });
      await expect(sheet).toBeVisible();
      await page.setViewportSize({ width: 701, height: 924 });
      const desktop = page.getByRole("dialog", { name: "Vista previa", exact: true });
      await expect(desktop).toBeVisible();
      await reflow(page, sheet, true);
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await expect(desktop).toBeVisible();
      const focused = () => desktop.evaluate((el) => ({
        insideReader: el.contains(globalThis.document.activeElement),
        activeTag: globalThis.document.activeElement?.tagName,
        activeRole: globalThis.document.activeElement?.getAttribute("role"),
        activeLabel: globalThis.document.activeElement?.getAttribute("aria-label"),
      }));
      const focusPath = test.info().outputPath("focus-after-breakpoint.json");
      await writeFile(focusPath, JSON.stringify(await focused(), null, 2));
      await test.info().attach("focus-after-breakpoint", { path: focusPath, contentType: "application/json" });
      await expect.poll(focused).toMatchObject({ insideReader: true });
      await reflow(page, desktop, true);
      await tabTo(page, desktop.getByRole("button", { name: "Editar", exact: true }));
      await page.keyboard.press("Tab");
      await expect(desktop.getByRole("button", { name: "Cerrar vista previa", exact: true })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(desktop.getByRole("button", { name: "Editar", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("main")).toBeFocused();
    }
    const saved = await page.request.get(`/scopes/${scope}/plannings/${document.receipt.planning_id}`);
    expect(saved.status()).toBe(200);
    expect((await saved.json()).receipt).toEqual(document.receipt);
    expect(externalRequests).toEqual([]);
  });
}
