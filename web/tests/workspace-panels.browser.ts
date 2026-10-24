import { expect, test, type Page } from "@playwright/test";
import { ChatServer, appendTurn, chatDocument, chatId, deferredResponse } from "./chat-fixtures";
import { FixtureServer, planning, session, source } from "./acenta-fixtures";
import { sourceSamples } from "../src/acenta/contracts";
async function mount(page: Page) {
  const chat = new ChatServer(), resources = new FixtureServer();
  chat.documents.set(chatId, appendTurn(chatDocument(), crypto.randomUUID(), "Mensaje sintético guardado"));
  await page.route("**/scopes/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const server = /\/(?:active-conversation|chat-capability|conversations|conversation-operations)(?:[/?]|$)/.test(url.pathname) ? chat : resources;
    const response = await server.transport(url.pathname + url.search, {method: request.method(), headers: request.headers(), body: request.postData()});
    await route.fulfill({status: response.status, headers: Object.fromEntries(response.headers), body: await response.text()});
  });
  await page.goto("/tests/acenta.html?chat=1");
  await expect(page.getByLabel("Mensaje para Luna", {exact: true})).toBeVisible();
  await expect(page.getByRole("article", {name: "Tu mensaje 1", exact: true})).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return {chat, resources};
}
const panel = (page: Page, name: string) => page.getByRole("region", {name, exact: true});
test("explicit panels preserve the same composer, drafts, navigation and honest unavailable states", async ({page}) => {
  const {chat, resources} = await mount(page), input = page.getByLabel("Mensaje para Luna", {exact: true});
  await input.fill("Borrador que debe permanecer"); await input.evaluate(node => node.setAttribute("data-retained-composer", "yes"));
  await expect(page.locator(".workspace-panel")).toHaveCount(0);
  await page.getByRole("button", {name: "Revisar contexto", exact: true}).click();
  await panel(page, "Contexto del chat").getByLabel("Notas para el próximo contexto").fill("Notas aún sin guardar");
  await page.getByRole("button", {name: "Mis recursos", exact: true}).click();
  await expect(panel(page, "Mis recursos")).toContainText("No hay recursos todavía");
  await page.getByRole("button", {name: "Herramientas", exact: true}).click();
  await panel(page, "Herramientas").getByRole("tab", {name: "Materiales", exact: true}).click();
  await expect(panel(page, "Herramientas")).toContainText("Todavía no disponible");
  await page.getByRole("button", {name: "Soporte", exact: true}).click();
  await expect(panel(page, "Soporte")).toContainText("Soporte todavía no está disponible en Acenta.");
  await expect(panel(page, "Soporte").locator("form, input, textarea, a")).toHaveCount(0);
  await expect(input).toHaveValue("Borrador que debe permanecer"); await expect(input).toHaveAttribute("data-retained-composer", "yes");
  await page.goBack(); await expect(panel(page, "Herramientas")).toBeVisible();
  await page.goForward(); await expect(panel(page, "Soporte")).toBeVisible();
  await panel(page, "Soporte").getByRole("button", {name: "Cerrar panel", exact: true}).click();
  await expect(page.getByRole("button", {name: "Soporte", exact: true})).toBeFocused();
  await expect(page.locator(".workspace-panel")).toHaveCount(0);
  await page.getByRole("button", {name: "Revisar contexto", exact: true}).click();
  await expect(page.getByLabel("Notas para el próximo contexto")).toHaveValue("Notas aún sin guardar");
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", {name: "Revisar contexto", exact: true})).toBeFocused();
  expect(chat.calls.every(call => call.method === "GET")).toBe(true);
  expect(resources.calls.every(call => call.method === "GET")).toBe(true);
  expect(chat.documents.size).toBe(1); expect(chat.documents.get(chatId)?.turns).toHaveLength(1);
  expect(await page.evaluate(() => location.search)).toBe("?chat=1");
  expect(await page.evaluate(() => JSON.stringify(history.state))).not.toMatch(/Notas aún|Borrador que|71000000|support/);
});
test("keyboard opens a nonmodal panel and Planear returns focus to its own shortcut", async ({page}) => {
  await mount(page);
  const shortcut = page.getByRole("button", {name: "Planear", exact: true});
  await shortcut.focus(); await page.keyboard.press("Enter");
  await expect(panel(page, "Herramientas").getByRole("heading", {name: "Herramientas", exact: true})).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape"); await expect(shortcut).toBeFocused();
  await page.getByRole("button", {name: "Soporte", exact: true}).click();
  await page.getByRole("button", {name: "Cerrar sesión", exact: true}).click();
  // The fixture can close without changes; another test covers the dirty guard.
  await expect(page.getByRole("button", {name: "Continuar con correo", exact: true})).toBeVisible();
});
test("back restores the original panel activator even after reopening it from another button", async ({page}) => {
  await mount(page);
  const shortcut = page.getByRole("button", {name: "Planear", exact: true});
  await shortcut.click();
  await page.getByRole("button", {name: "Soporte", exact: true}).click();
  await page.getByRole("button", {name: "Herramientas", exact: true}).click();
  await page.goBack(); await expect(panel(page, "Soporte")).toBeVisible();
  await page.goBack(); await expect(panel(page, "Herramientas")).toBeVisible();
  await page.keyboard.press("Escape"); await expect(shortcut).toBeFocused();
});
test("late turn and context responses preserve panel selection and focused controls", async ({page}) => {
  const {chat} = await mount(page), input = page.getByLabel("Mensaje para Luna", {exact: true});
  const turn = deferredResponse(); let confirmedTurn: Response;
  chat.intercept = call => { if (call.method === "POST" && call.path.endsWith("/turns")) {confirmedTurn = chat.handle(call); return turn.promise;} };
  await input.fill("Turno con respuesta tardía"); await page.getByRole("button", {name: "Enviar mensaje", exact: true}).click();
  await page.getByRole("button", {name: "Herramientas", exact: true}).click();
  const category = panel(page, "Herramientas").getByRole("tab", {name: "Materiales", exact: true}); await category.focus();
  turn.resolve(confirmedTurn!); await expect(input).toHaveValue(""); await expect(category).toBeFocused();
  await expect(panel(page, "Herramientas")).toBeVisible();
  const context = deferredResponse(); let confirmedContext: Response;
  chat.intercept = call => { if (call.method === "POST" && call.path.endsWith("/context")) {confirmedContext = chat.handle(call); return context.promise;} };
  await page.getByRole("button", {name: "Revisar contexto", exact: true}).click();
  await page.getByLabel("Notas para el próximo contexto").fill("Contexto tardío");
  await page.getByRole("button", {name: "Guardar notas y comenzar contexto", exact: true}).click();
  await page.getByRole("button", {name: "Soporte", exact: true}).click();
  const close = panel(page, "Soporte").getByRole("button", {name: "Cerrar panel", exact: true}); await close.focus();
  context.resolve(confirmedContext!); await expect(page.getByText(/Contexto guardado: revisión 1/)).toBeVisible();
  await expect(close).toBeFocused(); await expect(panel(page, "Soporte")).toBeVisible();
});
test("resource reader back restores panel scroll, focused item and the dirty editor", async ({page}) => {
  const {resources} = await mount(page);
  for (let index = 0; index < 25; index++) resources.put(planning());
  await page.getByRole("button", {name: "Mis recursos", exact: true}).click();
  const resourcePanel = panel(page, "Mis recursos"), item = resourcePanel.getByRole("button", {name: "Reabrir copia guardada", exact: true}).last();
  await expect(resourcePanel.getByRole("button", {name: "Reabrir copia guardada", exact: true})).toHaveCount(25);
  await item.scrollIntoViewIfNeeded(); await item.focus();
  const scroll = await resourcePanel.locator(".workspace-panel-body").evaluate(node => node.scrollTop); expect(scroll).toBeGreaterThan(0);
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", {name: "Editar actividad", exact: true}); await expect(editor).toBeVisible();
  await editor.getByLabel("Texto", {exact: true}).fill("Corrección privada conservada");
  await page.goBack(); await expect(editor).toHaveCount(0); await expect(resourcePanel).toBeVisible();
  await expect(item).toBeFocused(); await expect(item).toBeInViewport();
  await expect.poll(() => resourcePanel.locator(".workspace-panel-body").evaluate(node => node.scrollTop)).toBeCloseTo(scroll, 0);
  await resourcePanel.getByRole("button", {name: "Retomar edición abierta", exact: true}).click();
  await expect(editor.getByLabel("Texto", {exact: true})).toHaveValue("Corrección privada conservada");
});
for (const [width, height] of [[1440, 900], [320, 800], [360, 300]]) {
  test(`resource cards wrap complete metadata and long titles at ${width}×${height}`, async ({page}, info) => {
    await page.setViewportSize({width, height}); const {chat, resources} = await mount(page);
    const input = page.getByLabel("Mensaje para Luna", {exact: true}); await input.fill("Borrador conservado al consultar originales");
    const doc = planning(), title = "Recurso".repeat(20);
    doc.result.title = title; doc.result.resources![0].title = title;
    resources.put(doc); resources.sources.set(source.operation_id, source);
    resources.before = async call => call.path === `sources/${source.source_id}/versions/1`
      ? new Response(sourceSamples[0].bytes, {headers: {"Cache-Control": "no-store", "X-Source-Id": source.source_id,
        "X-Version": "1", "X-Content-SHA256": source.sha256, "X-Content-Size": String(source.size), "X-Actor-Id": session.actorId}})
      : undefined;
    await page.getByRole("button", {name: "Mis recursos", exact: true}).click();
    const region = panel(page, "Mis recursos"), original = region.getByRole("article", {name: "Recurso original · Versión 1", exact: true});
    await expect(region.getByRole("article")).toHaveCount(2);
    await expect(original.locator(".original-metadata")).toHaveText([`Fuente: ${source.source_id}`, `SHA-256: ${source.sha256}`]);
    await expect(region.getByRole("heading", {name: title, exact: true})).toHaveText(title);
    const open = original.getByRole("button", {name: "Abrir original", exact: true});
    await open.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", {name: "Original de ejemplo", exact: true}).getByRole("status")).toContainText("bytes verificados");
    await page.keyboard.press("Escape"); await expect(open).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await region.locator(".workspace-panel-body, .library, .library-card").evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth))).toBe(true);
    const contained = await region.evaluate(node => {
      const bounds = node.getBoundingClientRect();
      return [...node.querySelectorAll(".library-card h2, .library-card p, .library-card button")].every(child => {
        const box = child.getBoundingClientRect(); return box.left >= bounds.left && box.right <= bounds.right;
      });
    }); expect(contained).toBe(true);
    await expect(input).toHaveValue("Borrador conservado al consultar originales");
    expect([...chat.calls, ...resources.calls].every(call => call.method === "GET")).toBe(true);
    await page.screenshot({path: info.outputPath(`workspace-resources-populated-${width}.png`), fullPage: true});
  });
}
test("a late resource read cannot reopen its panel or take focus", async ({page}) => {
  const {resources} = await mount(page), gate = deferredResponse();
  resources.before = call => /^plannings(?:\?|$)/.test(call.path) ? gate.promise : Promise.resolve();
  await page.getByRole("button", {name: "Mis recursos", exact: true}).click();
  await expect(panel(page, "Mis recursos")).toContainText("Recuperando recursos");
  await page.getByRole("button", {name: "Soporte", exact: true}).click();
  const close = panel(page, "Soporte").getByRole("button", {name: "Cerrar panel", exact: true}); await close.focus();
  const arriving = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/plannings"));
  gate.resolve(new Response(JSON.stringify({items: [], next_cursor: null}), {headers: {"content-type": "application/json"}}));
  await (await arriving).finished(); await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => done())));
  await expect(close).toBeFocused(); await expect(panel(page, "Soporte")).toBeVisible();
  await expect(panel(page, "Mis recursos")).toHaveCount(0);
});
test("Escape dismisses a logout guard before its underlying panel and retains context draft", async ({page}) => {
  await mount(page);
  await page.getByRole("button", {name: "Revisar contexto", exact: true}).click();
  await page.getByLabel("Notas para el próximo contexto").fill("Contexto local protegido");
  await page.getByRole("button", {name: "Cerrar sesión", exact: true}).click();
  const guard = page.getByRole("dialog", {name: "¿Salir con mensajes pendientes?", exact: true}); await expect(guard).toBeVisible();
  await page.keyboard.press("Escape"); await expect(guard).toHaveCount(0); await expect(panel(page, "Contexto del chat")).toBeVisible();
  await expect(page.getByLabel("Notas para el próximo contexto")).toHaveValue("Contexto local protegido");
});
for (const [width, height] of [[1440, 900], [1024, 600], [390, 844], [360, 540], [320, 568], [360, 451], [360, 300]]) {
  test(`panels and composer remain reachable without overlap at ${width}×${height}`, async ({page}, info) => {
    await page.setViewportSize({width, height}); const {chat} = await mount(page);
    const input = page.getByLabel("Mensaje para Luna", {exact: true}); await input.fill("Unicode sintético 😀 " + "palabra ".repeat(20));
    const capture = width === 1440 || width === 360 && height === 540;
    if (capture) await page.screenshot({path: info.outputPath(`workspace-closed-${width}.png`), fullPage: true});
    for (const expanded of [false, true]) {
      if (expanded) {
        await page.getByRole("button", {name: "Expandir menú", exact: true}).click();
        await page.locator(".sidebar").evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished)); });
      }
      for (const [button, title] of [["Mis recursos", "Mis recursos"], ["Herramientas", "Herramientas"], ["Revisar contexto", "Contexto del chat"], ["Soporte", "Soporte"]]) {
        const closedHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.getByRole("button", {name: button, exact: true}).click();
        const region = panel(page, title); await expect(region).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (button === "Herramientas") {
          const gap = await region.locator(".catalog-items").evaluate(node => node.getBoundingClientRect().bottom - node.lastElementChild!.getBoundingClientRect().bottom);
          expect(gap).toBeLessThanOrEqual(2);
        }
        if (button === "Revisar contexto") {
          const notes = region.getByLabel("Notas para el próximo contexto");
          await region.getByRole("heading", {name: title, exact: true}).focus();
          await page.keyboard.press("Tab"); await expect(region.getByRole("button", {name: "Cerrar panel", exact: true})).toBeFocused();
          for (const control of [notes, region.getByRole("button", {name: "Descartar cambios de notas", exact: true}),
            region.getByRole("button", {name: "Reiniciar contexto sin borrar historial", exact: true}),
            region.getByRole("button", {name: "Guardar notas y comenzar contexto", exact: true})]) {
            await page.keyboard.press("Tab"); await expect(control).toBeFocused();
            await expect(control).toBeInViewport({ratio: 1});
            if (await control.getAttribute("id") === "chat-context-notes") await notes.fill("Notas sintéticas que siguen sin guardar.");
            const geometry = await control.evaluate(node => ({top: node.getBoundingClientRect().top,
              headerBottom: node.closest(".workspace-panel")!.querySelector("header")!.getBoundingClientRect().bottom}));
            expect(geometry.top).toBeGreaterThanOrEqual(geometry.headerBottom - 1);
          }
        }
        const overlap = await page.evaluate(() => {
          const p = document.querySelector(".workspace-panel")!.getBoundingClientRect(), c = document.querySelector(".chat-composer")!.getBoundingClientRect();
          return p.left < c.right && p.right > c.left && p.top < c.bottom && p.bottom > c.top;
        }); expect(overlap).toBe(false);
        if (capture && !expanded) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({path: info.outputPath(`workspace-${button === "Mis recursos" ? "resources" : button === "Herramientas" ? "tools" : button === "Soporte" ? "support" : "context"}-${width}.png`), fullPage: true});
        }
        expect(await region.evaluate(node => !!(node.compareDocumentPosition(document.querySelector(".chat-composer")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
        if (button === "Revisar contexto") await page.keyboard.press("Tab");
        else await input.focus();
        await expect(input).toBeFocused(); await expect(input).toBeInViewport();
        await region.getByRole("button", {name: "Cerrar panel", exact: true}).click(); await expect(page.locator(".workspace-panel")).toHaveCount(0);
        await expect(page.locator(".tools-menu-space")).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBe(closedHeight);
      }
    }
    expect(chat.calls.every(call => call.method === "GET")).toBe(true);
    await page.getByRole("button", {name: "Revisar contexto", exact: true}).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({path: info.outputPath(`workspace-context-expanded-${width}.png`), fullPage: true});
  });
}
