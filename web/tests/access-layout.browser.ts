import { test, expect, type Page } from "@playwright/test";

async function openAccess(page: Page, emailAvailable = true, unavailable = false, googleAvailable = false) {
  await page.route("**/auth/session", (route) =>
    route.fulfill({ status: 401, json: { code: "unauthorized" } }),
  );
  await page.route("**/auth/bootstrap", (route) =>
    route.fulfill(unavailable
      ? { status: 503, json: { code: "unavailable" } }
      : { json: {
          csrf_token: "layout-fixture", google_nonce: "layout-fixture",
          google_client_id: googleAvailable ? "layout-fixture" : null, email_available: emailAvailable,
        } }),
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Continuar con correo" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function accessGeometry(page: Page) {
  return page.evaluate(() => {
    const bounds = (selector: string) => {
      const { top, bottom, width, height } = document.querySelector(selector)!.getBoundingClientRect();
      return { top, bottom, width, height };
    };
    return {
      selector: bounds(".access-selector, .access-form"),
      footer: bounds(".access-legal"), brand: bounds(".access-brand"),
      photo: bounds(".access-photo"),
      viewportHeight: innerHeight, viewportWidth: innerWidth,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      headingSize: getComputedStyle(document.querySelector("h1")!).fontSize,
    };
  });
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 1470, height: 762 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1201, height: 768 },
  { width: 1200, height: 768 },
  { width: 1024, height: 768 },
  { width: 801, height: 768 },
  { width: 800, height: 768 },
  { width: 390, height: 844 },
]) {
  for (const emailAvailable of [true, false]) {
    test(`access fits ${viewport.width}x${viewport.height}, email ${emailAvailable}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openAccess(page, emailAvailable);
      const layout = await accessGeometry(page);
      expect(layout.selector.top).toBeGreaterThanOrEqual(layout.brand.bottom + 24);
      expect(layout.footer.top).toBeGreaterThanOrEqual(layout.selector.bottom + 31);
      expect(layout.footer.bottom).toBeLessThanOrEqual(viewport.height);
      expect(layout.scrollHeight).toBeLessThanOrEqual(viewport.height);
      expect(layout.scrollWidth).toBeLessThanOrEqual(viewport.width);
      if (viewport.width > 800) {
        expect(layout.photo.height).toBe(viewport.height);
      }
      if (viewport.width === 1440) {
        expect(layout.headingSize).toBe("96px");
        expect(layout.selector.top).toBe(360);
        expect(layout.selector.width).toBe(420);
        expect(layout.footer.bottom).toBe(898);
      }
      await page.screenshot({ path: `${test.info().outputDir}/access.png` });
    });
  }
}

for (const viewport of [
  { width: 1280, height: 400 },
  { width: 320, height: 568 },
]) {
  test(`access actions remain reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openAccess(page, false, true);
    const layout = await accessGeometry(page);
    expect(layout.selector.top).toBeGreaterThanOrEqual(layout.brand.bottom + 24);
    expect(layout.footer.top).toBeGreaterThanOrEqual(layout.selector.bottom + 31);
    expect(layout.scrollWidth).toBeLessThanOrEqual(viewport.width);
    const terms = page.getByRole("button", { name: "Términos y condiciones" });
    for (let attempt = 0; attempt < 2; attempt++) {
      await terms.focus();
      await expect(terms).toBeInViewport();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "Documentos en preparación" })).toBeVisible();
      await page.getByRole("button", { name: "Volver", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Bienvenido" })).toBeVisible();
    }
  });
}

test("short access scrolls naturally for errors without overlapping legal actions", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openAccess(page, false, true);
  await expect(page.getByRole("alert").filter({
    hasText: "El acceso no está disponible ahora. Vuelve a intentarlo.",
  })).toBeVisible();
  const layout = await accessGeometry(page);
  expect(layout.footer.top).toBeGreaterThanOrEqual(layout.selector.bottom + 31);
  expect(layout.scrollWidth).toBeLessThanOrEqual(1280);
  const terms = page.getByRole("button", { name: "Términos y condiciones" });
  await terms.scrollIntoViewIfNeeded();
  await expect(terms).toBeInViewport();
  await terms.click();
  await expect(page.getByRole("heading", { name: "Documentos en preparación" })).toBeVisible();
  await page.getByRole("button", { name: "Volver", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bienvenido" })).toBeVisible();
});

test("email validation stays above the legal footer in a short window", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openAccess(page);
  await page.getByRole("button", { name: "Continuar con correo" }).click();
  await page.getByRole("button", { name: "Enviar código" }).click();
  await expect(page.getByRole("alert").filter({
    hasText: "Escribe un correo válido para continuar.",
  })).toHaveText("Escribe un correo válido para continuar.");
  const layout = await accessGeometry(page);
  expect(layout.footer.top).toBeGreaterThanOrEqual(layout.selector.bottom + 31);
  expect(layout.scrollWidth).toBeLessThanOrEqual(1280);
  await page.getByRole("button", { name: "Aviso de privacidad" }).click();
  await expect(page.getByRole("heading", { name: "Documentos en preparación" })).toBeVisible();
});

// SDK geometry fixture only: this does not certify Google's live widget or sign-in.
test("Google configured and email disabled keeps legal actions in view", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 762 });
  await page.addInitScript(() => {
    window.google = { accounts: { id: {
      initialize() {}, cancel() {},
      renderButton(element) {
        const button = document.createElement("button");
        button.textContent = "Continuar con Google";
        button.style.cssText = "width:320px;height:40px;padding:0";
        element.append(button);
      },
    } } };
  });
  await openAccess(page, false, false, true);
  await expect(page.getByRole("button", { name: "Continuar con Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuar con correo" })).toBeDisabled();
  const layout = await accessGeometry(page);
  expect(layout.footer.top).toBeGreaterThanOrEqual(layout.selector.bottom + 31);
  expect(layout.footer.bottom).toBeLessThanOrEqual(762);
  expect(layout.scrollHeight).toBe(762);
});
