import { test, expect, type Page } from "@playwright/test";
import { FixtureServer, revised, json } from "./acenta-fixtures";
const evidence = process.env.ACENTA_EVIDENCE_DIR ?? "../evidence/acenta";
async function assertTypography(page: Page) {
  const typography = await page.evaluate(async () => {
    const unquote = (name: string) => name.replace(/^["']|["']$/g, "");
    const loaded = [];
    for (const [family, weight] of [
      ["Source Sans 3", "400"],
      ["Source Sans 3", "600"],
      ["Instrument Serif", "400"],
    ]) {
      const faces = await document.fonts.load(`${weight} 16px "${family}"`);
      loaded.push(
        faces.map((face) => ({
          family: unquote(face.family),
          weight: face.weight,
          status: face.status,
        })),
      );
    }
    await document.fonts.ready;
    const controls = [
      ...document.querySelectorAll(
        "body, button:not(.google), input, textarea, .editor-header h2, .element-card, .sheet",
      ),
    ].map((element) => ({
      tag: element.tagName,
      family: unquote(
        getComputedStyle(element).fontFamily.split(",")[0].trim(),
      ),
    }));
    return { loaded, controls };
  });
  expect(typography.loaded).toEqual([
    [{ family: "Source Sans 3", weight: "400", status: "loaded" }],
    [{ family: "Source Sans 3", weight: "600", status: "loaded" }],
    [{ family: "Instrument Serif", weight: "400", status: "loaded" }],
  ]);
  expect(typography.controls.length).toBeGreaterThan(1);
  for (const control of typography.controls) {
    expect(control.family, control.tag).toBe("Source Sans 3");
  }
}
async function assertNoHorizontalOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll("body *")]
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        right: element.getBoundingClientRect().right,
        width: element.getBoundingClientRect().width,
      }))
      .filter((element) => element.right > innerWidth + 1),
  }));
  expect(layout.scrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(
    layout.viewport,
  );
}
async function assertEditorActionsFit(page: Page) {
  const layout = await page.locator(".editor-dialog").evaluate((dialog) => {
    const bounds = (element: Element) => {
      const { top, right, bottom, left } = element.getBoundingClientRect();
      return { top, right, bottom, left };
    };
    const footer = dialog.querySelector(".editor-footer")!;
    return {
      dialog: bounds(dialog),
      footer: bounds(footer),
      body: bounds(dialog.querySelector(".editor-body")!),
      buttons: [...footer.querySelectorAll("button")].map(bounds),
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  expect(layout.buttons).toHaveLength(3);
  expect(layout.body.bottom).toBeLessThanOrEqual(layout.footer.top);
  for (const button of layout.buttons) {
    expect(button.top).toBeGreaterThanOrEqual(layout.footer.top + 12);
    expect(button.bottom).toBeLessThanOrEqual(layout.footer.bottom - 12);
    expect(button.top).toBeGreaterThanOrEqual(Math.max(0, layout.dialog.top));
    expect(button.left).toBeGreaterThanOrEqual(Math.max(0, layout.dialog.left));
    expect(button.bottom).toBeLessThanOrEqual(
      Math.min(layout.dialog.bottom, layout.viewport.height),
    );
    expect(button.right).toBeLessThanOrEqual(
      Math.min(layout.dialog.right, layout.viewport.width),
    );
  }
}
async function assertLoadedAssets(page: Page) {
  await expect(page.locator("img").first()).toBeVisible();
  await assertTypography(page);
  for (const img of await page.locator("img").all()) {
    await expect
      .poll(() =>
        img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0),
      )
      .toBe(true);
  }
  for (const icon of await page.locator("img.icon").all()) {
    const expected = await icon.evaluate((e) =>
      e.classList.contains("small") ? 20 : 24,
    );
    const box = await icon.boundingBox();
    expect(box?.width).toBe(expected);
    expect(box?.height).toBe(expected);
  }
}
async function mount(page: Page) {
  const server = new FixtureServer();
  await page.route("**/scopes/**", async (route) => {
    const request = route.request();
    try {
      const response = await server.transport(
        new URL(request.url()).pathname + new URL(request.url()).search,
        {
          method: request.method(),
          headers: request.headers(),
          body: request.postData(),
        },
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    } catch {
      await route.abort("failed");
    }
  });
  await page.goto("/tests/acenta.html");
  await assertLoadedAssets(page);
  return server;
}
async function create(page: Page) {
  await page
    .getByRole("button", { name: "Ajustar planeación", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Adjuntar referencia", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Planeación de ciencias · ejemplo/ })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Enviar petición" }).click();
  await expect(
    page.getByRole("heading", { name: "Agua que cambia", exact: true }),
  ).toBeVisible();
}
async function edit(page: Page) {
  await create(page);
  await page.getByRole("button", { name: "Abrir resultado editable" }).click();
  await expect(
    page.getByRole("dialog", { name: "Editar actividad" }),
  ).toBeVisible();
  await assertTypography(page);
}
test("access remains closed, current heading is 96px, no personal data is sent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const calls: string[] = [];
  page.on("request", (r) => calls.push(r.url()));
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await assertLoadedAssets(page);
  expect(
    await page
      .getByRole("heading", { name: "Bienvenido" })
      .evaluate((e) => getComputedStyle(e).fontSize),
  ).toBe("96px");
  await page.screenshot({ path: `${evidence}/access-1440.png` });
  await page.getByRole("button", { name: "Continuar con correo" }).click();
  await page.getByLabel("Correo electrónico").fill("invalid");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(
    page.getByText("Escribe un correo válido para continuar."),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByLabel("Correo electrónico").fill("synthetic@example.test");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Acceso pendiente" }),
  ).toBeVisible();
  expect(calls.every((url) => url.startsWith("http://127.0.0.1:4173/"))).toBe(
    true,
  );
  expect(
    calls.some((url) => url.includes("/scopes/") || url.includes("synthetic")),
  ).toBe(false);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});
test("home geometry, modal inertia, keyboard and sidebar preserve input", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 924 });
  await mount(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/home-1440.png` });
  await page.getByLabel("Petición para tu clase").fill("Conservar este texto");
  await page.getByRole("button", { name: "Expandir menú" }).click();
  await expect(page.getByLabel("Petición para tu clase")).toHaveValue(
    "Conservar este texto",
  );
  await page.screenshot({
    path: `${evidence}/home-expanded-1440.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Contraer menú" }).click();
  const tools = page.getByRole("button", { name: "Más herramientas" });
  await tools.click();
  await expect(
    page.getByRole("dialog", { name: "Herramientas" }),
  ).toBeVisible();
  await page
    .locator('.sidebar button[aria-label="Inicio"]')
    .evaluate((e: HTMLElement) => e.focus());
  expect(
    await page.evaluate(() =>
      document.querySelector("dialog")?.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(tools).toBeFocused();
  await expect(page.getByLabel("Petición para tu clase")).toHaveValue(
    "Conservar este texto",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const input = page.getByLabel("Petición para tu clase");
  const multiline =
    "Primera línea para preparar mi clase.\nSegunda línea con materiales y tiempos.\nTercera línea que conserva mis instrucciones.";
  await input.fill(multiline);
  await expect(input).toHaveValue(multiline);
  await expect
    .poll(async () => (await input.boundingBox())!.height)
    .toBeGreaterThan(40);
  expect((await input.boundingBox())!.height).toBeLessThanOrEqual(160);
  await page.screenshot({ path: `${evidence}/home-multiline-1440.png` });
});
test("fixture request yields payload times, saved edit reloads and original remains", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 924 });
  const server = await mount(page);
  await create(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/result-1440.png` });
  await page.getByRole("button", { name: "Abrir resultado editable" }).click();
  await expect(
    page.getByRole("dialog", { name: "Editar actividad" }),
  ).toBeVisible();
  await assertTypography(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/editor-1440.png` });
  await page
    .getByLabel("Texto", { exact: true })
    .fill("Observa con calma y escribe lo que cambió.");
  await expect(page.locator(".sheet-instruction")).toHaveText(
    "Observa con calma y escribe lo que cambió.",
  );
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Guardado confirmado");
  await page.reload();
  await expect(page.getByLabel("Texto", { exact: true })).toHaveValue(
    "Observa con calma y escribe lo que cambió.",
  );
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(page.getByText("30 min", { exact: true })).toBeVisible();
  expect(server.docs.size).toBe(1);
  const doc = [...server.docs.values()][0];
  expect(doc.receipt.revision).toBe(2);
  expect(
    server.history.get(`${doc.receipt.planning_id}/1`)!.result.resources![0]
      .elements[0].text,
  ).toBe("Observa el vaso. Describe lo que ves.");
});
test("dirty close conserves a durable draft and reopens from resources", async ({
  page,
}) => {
  const server = await mount(page);
  await edit(page);
  await page
    .getByLabel("Texto", { exact: true })
    .fill("Borrador privado recuperable");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "¿Salir con cambios?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Seguir editando" }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Conservar borrador", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Mis recursos", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Recuperar borrador" }).click();
  await expect(page.getByLabel("Texto", { exact: true })).toHaveValue(
    "Borrador privado recuperable",
  );
  expect([...server.docs.values()][0].receipt.revision).toBe(1);
  expect(server.drafts.size).toBe(1);
});
test("lost save receipt recovers without duplicate revision", async ({
  page,
}) => {
  const server = await mount(page);
  await edit(page);
  await page
    .getByLabel("Texto", { exact: true })
    .fill("Texto con respuesta perdida");
  server.after = async (call, r) => {
    if (call.method === "POST") throw Error("lost");
    return r;
  };
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(
    page.getByText("Guardado sin confirmar", { exact: true }),
  ).toBeVisible();
  server.after = null;
  await page
    .getByRole("button", { name: "Comprobar estado", exact: true })
    .click();
  await expect(
    page.getByText("Guardado confirmado", { exact: true }),
  ).toBeVisible();
  expect([...server.docs.values()][0].receipt.revision).toBe(2);
});
test("conflict preserves both texts and creates an identified separate copy", async ({
  page,
}) => {
  const server = await mount(page);
  await edit(page);
  const base = [...server.docs.values()][0];
  server.put(revised(base, "Otra pestaña guardó esto"));
  await page
    .getByLabel("Texto", { exact: true })
    .fill("Conservar mi propia versión");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(
    page.getByText("Texto guardado: Otra pestaña guardó esto"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Conservar copia", exact: true })
    .click();
  await expect(
    page.getByText("Guardado confirmado", { exact: true }),
  ).toBeVisible();
  expect(server.docs.size).toBe(2);
  expect(
    server.docs.get(base.receipt.planning_id)!.result.resources![0].elements[0]
      .text,
  ).toBe("Otra pestaña guardó esto");
});
test("mobile access and composer reflow without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bienvenido" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/access-mobile.png` });
  await assertNoHorizontalOverflow(page);
  await mount(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/home-mobile.png` });
  await assertNoHorizontalOverflow(page);
  await edit(page);
  await page.getByLabel("Texto", { exact: true }).fill("Texto móvil");
  await assertEditorActionsFit(page);
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(
    page.getByText("Guardado confirmado", { exact: true }),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertEditorActionsFit(page);
  await page.screenshot({ path: `${evidence}/editor-mobile.png` });
});

test("cancelled attachment cannot select late or dismiss a newer modal", async ({
  page,
}) => {
  const server = await mount(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.before = async (call) => {
    if (call.path === "sources" && call.method === "POST") await gate;
  };
  await page.getByLabel("Petición para tu clase").fill("Conservar petición");
  await page
    .getByRole("button", { name: "Adjuntar referencia", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Planeación de ciencias · ejemplo/ })
    .click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Más herramientas" }).click();
  release();
  await expect.poll(() => server.sources.size).toBe(1);
  await expect(
    page.getByRole("dialog", { name: "Herramientas" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Referencia adjunta", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Petición para tu clase")).toHaveValue(
    "Conservar petición",
  );
});

test("lost attachment response remains recoverable after reload without a duplicate source", async ({
  page,
}) => {
  const server = await mount(page);
  server.after = async (call, response) => {
    if (call.path === "sources" && call.method === "POST") throw Error("lost");
    return response;
  };
  await page
    .getByRole("button", { name: "Adjuntar referencia", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Planeación de ciencias · ejemplo/ })
    .click();
  await expect(
    page.getByText(
      "Referencia sin confirmar. Selecciónala para comprobar el recibo.",
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  server.after = null;
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page
    .getByRole("button", { name: "Comprobar estado del adjunto" })
    .click();
  await expect(
    page.getByRole("button", { name: "Referencia adjunta", exact: true }),
  ).toBeVisible();
  expect(server.calls.filter((call) => call.path === "sources")).toHaveLength(
    1,
  );
});

test("late result preserves new input; library reopens saved text after local storage loss", async ({
  page,
}) => {
  const server = await mount(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.before = async (call) => {
    if (call.path === "plannings" && call.method === "POST") await gate;
  };
  await page
    .getByRole("button", { name: "Ajustar planeación", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Adjuntar referencia", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Planeación de ciencias · ejemplo/ })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Enviar petición" }).click();
  await page
    .getByLabel("Petición para tu clase")
    .fill("Nueva petición mientras llega la anterior");
  release();
  await expect(page.getByText("Enviando petición al servidor…")).toHaveCount(0);
  await expect(page.getByLabel("Petición para tu clase")).toHaveValue(
    "Nueva petición mientras llega la anterior",
  );
  await page
    .getByRole("button", { name: "Mis recursos", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Reabrir copia guardada" }).click();
  await page
    .getByLabel("Texto", { exact: true })
    .fill("Texto durable desde biblioteca");
  await page.getByRole("button", { name: "Guardar", exact: true }).dblclick();
  await expect(
    page.getByText("Guardado confirmado", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page
    .getByRole("button", { name: "Mis recursos", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Reabrir copia guardada" }).click();
  await expect(page.getByLabel("Texto", { exact: true })).toHaveValue(
    "Texto durable desde biblioteca",
  );
  expect(server.docs.size).toBe(1);
  expect([...server.docs.values()][0].receipt.revision).toBe(2);
  expect(
    server.calls.filter(
      (call) => call.path.endsWith("/revisions") && call.method === "POST",
    ),
  ).toHaveLength(1);
});

test("library failure is distinct from empty and retry clears the error", async ({
  page,
}) => {
  const server = await mount(page);
  server.before = async (call) =>
    call.path === "plannings"
      ? json({ detail: "unavailable" }, 503)
      : undefined;
  await page
    .getByRole("button", { name: "Mis recursos", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Reintentar listado" }),
  ).toBeVisible();
  await expect(
    page.getByText("No hay recursos todavía. Ajusta el ejemplo para empezar."),
  ).toHaveCount(0);
  server.before = null;
  await page.getByRole("button", { name: "Reintentar listado" }).click();
  await expect(
    page.getByText("No hay recursos todavía. Ajusta el ejemplo para empezar."),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
