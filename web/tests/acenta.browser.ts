import { test, expect, type Page } from "@playwright/test";
import { FixtureServer, revised, json, request, source } from "./acenta-fixtures";
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
async function mount(page: Page, recovery = false) {
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
  await page.goto(`/tests/acenta.html${recovery ? "?recovery=1" : ""}`);
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
  await expect(page.getByRole("button", { name: "Continuar con correo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Continuar con Google" })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveText("El acceso no está disponible ahora. Vuelve a intentarlo.");
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
test("Planear keeps Planeación and Proyecto without a separate Secuencia action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 924 });
  const server = await mount(page);
  const input = page.getByLabel("Petición para tu clase");
  await input.fill("Conservar mi petición y contexto");
  const context = await page.locator(".composer-controls").innerText();
  const trigger = page.getByRole("button", { name: "Más herramientas" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("dialog", { name: "Herramientas" });
  await expect(menu.getByRole("button", { name: "Cerrar", exact: true })).toBeFocused();
  await expect(menu.getByRole("tab", { name: "Planear", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(menu.locator(".catalog-items > p")).toHaveText([
    "Proyecto de aula, todavía no disponible",
  ]);
  await expect(menu.getByText("Secuencia didáctica", { exact: true })).toHaveCount(0);
  await expect(menu.locator(".catalog-items a, .catalog-items input, .catalog-items img")).toHaveCount(0);
  await expect(menu.getByText("Planeación guiada disponible como ejemplo; las demás herramientas están pendientes", { exact: true })).toBeVisible();
  await expect(menu.getByRole("button")).toHaveText([
    "Cerrar", "Planeación de clase", "Ajustar planeación ↗", "Revisar recurso ↗",
  ]);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/tools-planeacion-secuencia-1440x924.png` });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(input).toHaveValue("Conservar mi petición y contexto");
  await expect(page.locator(".composer-controls")).toHaveText(context, { useInnerText: true });
  expect(server.calls).toHaveLength(0);
  await trigger.click();
  await menu.getByRole("button", { name: "Ajustar planeación ↗", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(input).toHaveValue("Hoy tengo 30 minutos. Ajusta los tiempos sin cambiar mis materiales.");
  await expect(page.locator(".composer-controls")).toHaveText(context, { useInnerText: true });
  expect(server.calls).toHaveLength(0);
});
for (const viewport of [
  { width: 1440, height: 924 },
  { width: 1470, height: 762 },
  { width: 390, height: 844 },
  { width: 320, height: 844 },
]) {
  test(`tools open below their trigger, stay contained and return focus at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const server = await mount(page);
    const input = page.getByLabel("Petición para tu clase");
    await input.fill("Conservar mi petición");
    const trigger = page.getByRole("button", { name: "Más herramientas" });
    const menu = page.getByRole("dialog", { name: "Herramientas" });
    const assertPlacement = async () => {
      await page.locator(".sidebar").evaluate(async (element) => {
        await Promise.all(
          element.getAnimations().map((animation) => animation.finished),
        );
      });
      await expect
        .poll(async () => {
          const anchor = (await trigger.boundingBox())!;
          return Math.abs(
            (await menu.boundingBox())!.y - anchor.y - anchor.height - 8,
          );
        })
        .toBeLessThan(1);
      const anchor = (await trigger.boundingBox())!;
      const box = (await menu.boundingBox())!;
      const current = page.viewportSize()!;
      expect(box.y).toBeCloseTo(anchor.y + anchor.height + 8, 0);
      expect(box.width).toBe(Math.min(560, current.width - 32));
      expect(box.x).toBeCloseTo(
        Math.max(
          16,
          Math.min(
            anchor.x + anchor.width - box.width,
            current.width - box.width - 16,
          ),
        ),
        0,
      );
      expect(box.x).toBeGreaterThanOrEqual(16);
      expect(box.x + box.width).toBeLessThanOrEqual(current.width - 16);
      expect(box.y + box.height).toBeLessThanOrEqual(current.height - 16);
      expect(box.height).toBeGreaterThan(100);
      await assertNoHorizontalOverflow(page);
    };
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(
      menu.getByRole("button", { name: "Cerrar", exact: true }),
    ).toBeFocused();
    await assertPlacement();
    await page.screenshot({
      path: `${evidence}/tools-${viewport.width}x${viewport.height}.png`,
    });
    const box = (await menu.boundingBox())!;
    await page.mouse.click(box.x + 3, box.y + 3);
    await expect(menu).toBeVisible();
    for (const [name, item] of [
      ["Materiales", "Hoja de actividades"],
      ["Evaluar", "Diagnóstico breve"],
      ["Juegos y repaso", "Bingo temático"],
      ["Planear", "Planeación de clase"],
    ]) {
      await menu.getByRole("tab", { name, exact: true }).click();
      await expect(
        menu.getByRole("tab", { name, exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(menu.locator(".catalog-items")).toContainText(item);
    }
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".tools-menu-space")).toHaveCount(0);
    await expect(input).toHaveValue("Conservar mi petición");
    await trigger.click();
    await menu.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.mouse.click(10, 10);
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    const resized =
      viewport.width > 800
        ? { width: 390, height: 844 }
        : { width: 1440, height: 924 };
    await page.setViewportSize(resized);
    await assertPlacement();
    await page.setViewportSize({ width: 390, height: 400 });
    await expect(page.locator(".tools-menu-space")).toHaveCount(1);
    await assertPlacement();
    await page.screenshot({
      path: `${evidence}/tools-short-from-${viewport.width}.png`,
    });
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(page.locator(".tools-menu-space")).toHaveCount(0);
    await trigger.click();
    await assertPlacement();
    await menu
      .getByRole("button", { name: "Revisar recurso", exact: false })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Adjuntar referencia" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(input).toHaveValue("Conservar mi petición");
    await expect(page.locator(".tools-menu-space")).toHaveCount(0);
    expect(server.calls).toHaveLength(0);
  });
}
test("tools follow a late attachment confirmation that moves their trigger", async ({
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
  const pendingAttachment = page.getByRole("dialog", {
    name: "Adjuntar referencia",
  });
  await expect(pendingAttachment.getByRole("status")).toBeVisible();
  await expect(pendingAttachment.getByRole("status")).toHaveText(
    "Referencia sin confirmar. Comprueba el recibo antes de cambiarla.",
  );
  const options = pendingAttachment.locator(".menu-option");
  await expect(options).toHaveCount(3);
  for (const option of await options.all()) await expect(option).toBeDisabled();
  await expect(
    pendingAttachment.getByRole("button", {
      name: "Comprobar estado del adjunto",
      exact: true,
    }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  server.after = null;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.before = async () => {
    await gate;
  };
  await page
    .getByRole("button", { name: "Comprobar estado del adjunto" })
    .click();
  const trigger = page.locator(".tool-tray .more");
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Herramientas" });
  const before = (await menu.boundingBox())!.y;
  release();
  await expect(page.locator(".attachment-line")).toBeVisible();
  await expect
    .poll(async () => (await menu.boundingBox())!.y)
    .toBeGreaterThan(before);
  await expect
    .poll(async () => {
      const anchor = (await trigger.boundingBox())!;
      return Math.abs(
        (await menu.boundingBox())!.y - anchor.y - anchor.height - 8,
      );
    })
    .toBeLessThan(1);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Referencia adjunta", exact: true }),
  ).toBeVisible();
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
  const pendingAttachment = page.getByRole("dialog", {
    name: "Adjuntar referencia",
  });
  await expect(pendingAttachment.getByRole("status")).toBeVisible();
  await expect(pendingAttachment.getByRole("status")).toHaveText(
    "Referencia sin confirmar. Comprueba el recibo antes de cambiarla.",
  );
  const options = pendingAttachment.locator(".menu-option");
  await expect(options).toHaveCount(3);
  for (const option of await options.all()) await expect(option).toBeDisabled();
  await expect(
    pendingAttachment.getByRole("button", {
      name: "Comprobar estado del adjunto",
      exact: true,
    }),
  ).toBeEnabled();
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
    page.getByText("No hay recursos todavía. Adjunta un ejemplo para empezar."),
  ).toHaveCount(0);
  server.before = null;
  await page.getByRole("button", { name: "Reintentar listado" }).click();
  await expect(
    page.getByText("No hay recursos todavía. Adjunta un ejemplo para empezar."),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("continuing to edit cancels logout while an older draft response is delayed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 924 });
  const server = await mount(page);
  await edit(page);
  await page.getByLabel("Texto", { exact: true }).fill("Primera edición antes de salir");
  await page.goBack(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  const guard = page.getByRole("dialog", { name: "¿Salir con cambios?", exact: true });
  await expect(guard).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/logout-draft-guard-1440.png` });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  server.after = async (call, response) => {
    if (call.method === "PUT" && call.path.includes("/drafts/")) await gate;
    return response;
  };
  await guard.getByRole("button", { name: "Conservar borrador y salir", exact: true }).click();
  await expect(guard.getByRole("button", { name: "Conservar borrador y salir", exact: true })).toBeDisabled();
  await guard.getByRole("button", { name: "Seguir editando", exact: true }).click();
  await page.getByLabel("Texto", { exact: true }).fill("Edición más reciente que debe permanecer");
  release(); server.after = null;
  await expect(page.getByRole("status")).toHaveText("Cambios sin guardar");
  await expect(page.getByLabel("Texto", { exact: true })).toHaveValue("Edición más reciente que debe permanecer");
  expect(server.drafts.size).toBe(1);
  expect([...server.drafts.values()][0].request.text).toBe("Primera edición antes de salir");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Conservar borrador", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(server.drafts.size).toBe(1);
  expect([...server.drafts.values()][0].receipt.draft_revision).toBe(2);
  expect([...server.drafts.values()][0].request.text).toBe("Edición más reciente que debe permanecer");
  expect([...server.docs.values()][0].receipt.revision).toBe(1);
});


for (const width of [1440, 390]) test(`synthetic same-session recovery notice and restored editor at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 924 });
  const server = await mount(page, true);
  await edit(page);
  const text = "Edición sintética recuperable: observa el agua y describe sus cambios.";
  await page.getByLabel("Texto", { exact: true }).fill(text);
  await page.reload();
  await expect(page.getByLabel("Texto", { exact: true })).toHaveValue(text);
  const dialog = page.getByRole("dialog", { name: "Editar actividad", exact: true });
  await expect(dialog.getByText(/El respaldo queda en claro/)).toBeVisible();
  await expect(dialog.getByText(/Recuperamos el texto de esta pestaña/)).toBeVisible();
  expect(server.calls.filter(call => call.method !== "GET" && call.path.includes("/revisions"))).toHaveLength(0);
  await assertTypography(page);
  await assertNoHorizontalOverflow(page);
  await assertEditorActionsFit(page);
  await page.screenshot({ path: `${evidence}/editor-recovery-${width}.png` });
});

for (const state of ["prompt", "attachment", "sending"] as const) {
  test(`class context preserves ${state}, exact request and newer navigation`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 924 });
    const server = await mount(page);
    const input = page.getByLabel("Petición para tu clase");
    await input.fill(request.prompt);
    if (state !== "prompt") {
      await page.getByRole("button", { name: "Adjuntar referencia", exact: true }).click();
      await page.getByRole("button", { name: /Planeación de ciencias · ejemplo/ }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    const attachment = page.locator(".attachment-line");
    const attachmentText = state === "prompt" ? null : await attachment.innerText();
    const controls = await page.locator(".composer-controls").innerText();
    const writes = () => server.calls.filter((call) => call.method === "POST");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.before = async (call) => {
      if (call.path === "plannings" && call.method === "POST") await gate;
    };
    if (state === "sending") {
      await page.getByRole("button", { name: "Enviar petición" }).click();
      await expect(page.getByRole("status")).toHaveText("Enviando petición al servidor…");
      await expect(page.getByRole("button", { name: "Enviar petición" })).toBeDisabled();
      await expect.poll(() => writes().length).toBe(2);
      expect(JSON.parse(writes()[1].body!)).toEqual(request);
      expect(writes()[1].key).toMatch(/^[0-9a-f-]{36}$/);
      await page.screenshot({ path: `${evidence}/context-sending-1440.png` });
      await input.press("Control+Enter");
    }
    const exactWrites = structuredClone(writes());
    const assertPreserved = async () => {
      await expect(input).toHaveValue(request.prompt);
      await expect(page.locator(".composer-controls")).toHaveText(controls, { useInnerText: true });
      if (attachmentText === null) await expect(attachment).toHaveCount(0);
      else await expect(attachment).toHaveText(attachmentText, { useInnerText: true });
      expect(writes()).toEqual(exactWrites);
    };
    const dialog = page.getByRole("dialog", { name: "Contexto de clase", exact: true });
    const option = dialog.getByRole("button", { name: /^Primaria · 4.º A\s*Ciencias · Agua que cambia$/ });
    for (const name of ["Ciencias ⌄", "Primaria · 4.º A ⌄"]) {
      const trigger = page.getByRole("button", { name, exact: true });
      for (const dismissal of ["Escape", "Cancelar", "elegir"]) {
        await trigger.focus();
        await page.keyboard.press("Enter");
        await expect(dialog).toBeVisible();
        await expect(option).toBeFocused();
        await expect(dialog.getByRole("button")).toHaveCount(2);
        await page.keyboard.press("Tab");
        await expect(dialog.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(option).toBeFocused();
        expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
        await page.locator('.sidebar button[aria-label="Inicio"]').evaluate((element: HTMLElement) => element.focus());
        await expect(option).toBeFocused();
        if (dismissal === "Escape") await page.keyboard.press("Escape");
        else if (dismissal === "Cancelar") await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
        else {
          await page.screenshot({ path: `${evidence}/context-${state}-${name === "Ciencias ⌄" ? "subject" : "group"}-1440.png` });
          await page.keyboard.press("Enter");
        }
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await assertPreserved();
      }
    }
    await page.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Mis recursos", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Actualizar listado", exact: true })).toBeEnabled();
    await page.goBack();
    await expect(input).toBeVisible();
    await page.getByRole("button", { name: "Ciencias ⌄", exact: true }).click();
    await expect(dialog).toBeVisible();
    await page.goForward();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Mis recursos", exact: true })).toBeVisible();
    await expect(page.locator("main")).toBeFocused();
    release();
    if (state === "sending") {
      await expect(page.getByRole("button", { name: "Reabrir copia guardada" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Mis recursos", exact: true })).toBeVisible();
    }
    await page.goBack();
    await assertPreserved();
    await expect(page.getByText("Enviando petición al servidor…", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if (state === "sending") {
      await expect(page.getByRole("button", { name: "Enviar petición" })).toBeEnabled();
      expect([...server.docs.values()][0].receipt).toMatchObject({
        operation_id: exactWrites[1].key,
        source_id: source.source_id,
        source_version_id: source.version_id,
        source_version: 1,
        source_sha256: source.sha256,
      });
    }
  });
}

test("definitive save error keeps the edit and retry visibly confirms one new revision", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 924 });
  const server = await mount(page);
  await edit(page);
  const text = "Observa los cambios del agua y escribe una explicación.";
  const input = page.getByLabel("Texto", { exact: true });
  await input.fill(text);
  const attempts = () => server.calls.filter((call) => call.path.endsWith("/revisions") && call.method === "POST");
  server.before = async (call) => call.path.endsWith("/revisions") && call.method === "POST"
    ? json({ detail: "unsupported_target" }, 422) : undefined;
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Editar actividad", exact: true });
  await expect(editor.getByRole("status")).toHaveText("Cambios pendientes");
  await expect(editor.getByRole("alert")).toHaveText("Revisa los datos del ejemplo antes de continuar.");
  const retry = editor.getByRole("button", { name: "Reintentar guardado", exact: true });
  await expect(retry).toBeEnabled();
  await expect(input).toHaveValue(text);
  await expect(editor.locator(".sheet-instruction")).toHaveText(text);
  expect(attempts()).toHaveLength(1);
  const rejected = structuredClone(attempts()[0]);
  const base = structuredClone([...server.docs.values()][0]);
  expect(base.receipt.revision).toBe(1);
  await retry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/editor-definitive-error-1440.png` });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  server.before = async (call) => {
    if (call.path.endsWith("/revisions") && call.method === "POST") await gate;
  };
  await retry.click();
  await expect(editor.getByRole("status")).toHaveText("Guardando…");
  await expect(editor.getByRole("button", { name: "Guardar", exact: true })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "Deshacer", exact: true })).toBeDisabled();
  await expect(retry).toHaveCount(0);
  await expect(input).toHaveValue(text);
  await expect.poll(() => attempts().length).toBe(2);
  expect(attempts()[1]).toMatchObject({ path: rejected.path, method: rejected.method, body: rejected.body });
  expect(attempts()[1].key).not.toBe(rejected.key);
  expect(JSON.parse(attempts()[1].body!)).toEqual({
    contract_version: 1, expected_revision: 1,
    resource_key: "observation-sheet", element_key: "instruction", text,
  });
  await page.screenshot({ path: `${evidence}/editor-retry-saving-1440.png` });
  release();
  await expect(editor.getByRole("status")).toHaveText("Guardado confirmado");
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "Guardar", exact: true })).toBeDisabled();
  await expect(input).toHaveValue(text);
  await page.reload();
  await expect(input).toHaveValue(text);
  await expect(editor.getByRole("status")).toHaveText("Sin cambios");
  expect(attempts()).toHaveLength(2);
  expect(server.docs.size).toBe(1);
  expect([...server.docs.values()][0].receipt).toMatchObject({
    planning_id: base.receipt.planning_id, revision: 2,
    operation_id: attempts()[1].key,
    source_id: base.receipt.source_id, source_version_id: base.receipt.source_version_id,
  });
  expect(server.history.get(`${base.receipt.planning_id}/1`)).toEqual(base);
});

for (const width of [1440, 390]) {
  test(`sidebar expansion preserves the attached reference and prompt at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 924 });
    const server = await mount(page);
    const input = page.getByLabel("Petición para tu clase");
    await input.fill(request.prompt);
    await page.getByRole("button", { name: "Adjuntar referencia", exact: true }).click();
    await page.getByRole("button", { name: /Planeación de ciencias · ejemplo/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const attachment = page.locator(".attachment-line");
    const attached = await attachment.innerText();
    const sourceWrites = structuredClone(server.calls);
    for (const expanded of [true, false, true, false]) {
      await page.getByRole("button", { name: expanded ? "Expandir menú" : "Contraer menú", exact: true }).click();
      const toggle = page.getByRole("button", { name: expanded ? "Contraer menú" : "Expandir menú", exact: true });
      await expect(toggle).toHaveAttribute("aria-expanded", String(expanded));
      await expect(toggle).toBeFocused();
      await page.locator(".sidebar").evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
      });
      await expect(input).toHaveValue(request.prompt);
      await expect(attachment).toHaveText(attached, { useInnerText: true });
      await expect(page.getByRole("button", { name: "Referencia adjunta", exact: true })).toBeVisible();
      await assertNoHorizontalOverflow(page);
      expect(server.calls).toEqual(sourceWrites);
    }
    await page.getByRole("button", { name: "Expandir menú", exact: true }).click();
    await page.locator(".sidebar").evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await page.screenshot({ path: `${evidence}/sidebar-attachment-expanded-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Contraer menú", exact: true }).click();
    await page.getByRole("button", { name: "Enviar petición" }).click();
    await expect(page.getByRole("heading", { name: "Agua que cambia", exact: true })).toBeVisible();
    const writes = server.calls.filter((call) => call.method === "POST");
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[1].body!)).toEqual(request);
    expect([...server.docs.values()][0].receipt).toMatchObject({
      source_id: source.source_id, source_version_id: source.version_id,
      source_version: 1, source_sha256: source.sha256,
    });
  });
}
