import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { sourceSamples, type SourceReceipt } from "../src/acenta/contracts";

type AuthSession = { principal_id: string; scope_id: string; csrf_token: string };

async function login(page: Page, email: string) {
  await page.getByRole("button", { name: "Continuar con correo", exact: true }).click();
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Enviar código", exact: true }).click();
  await expect(page.getByLabel("Código de un uso", { exact: true })).toBeVisible();
  const mailbox = await page.request.get(`/__test__/mailbox?email=${encodeURIComponent(email)}`);
  expect(mailbox.status()).toBe(200);
  const { code } = await mailbox.json();
  try {
    await page.getByLabel("Código de un uso", { exact: true }).fill(code);
  } catch {
    throw new Error("Could not enter the synthetic one-time code (value withheld).");
  }
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/auth/email/verify");
  await page.getByRole("button", { name: "Verificar código", exact: true }).click();
  const verified = await response;
  expect(verified.status()).toBe(200);
  await expect(page.getByRole("button", { name: "Cerrar sesión", exact: true })).toBeVisible();
  return (await verified.json()) as AuthSession;
}

test("real OTP auth, Secure cookies, PostgreSQL write, reload and cross-account isolation", async ({ page, context }) => {
  // Only the Python sender is replaced; no route interception or actor/session override.
  await page.goto("/");
  const first = await login(page, "browser-a@example.test");
  const cookies = await context.cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === "__Host-acenta-session");
  expect({ secure: sessionCookie?.secure, httpOnly: sessionCookie?.httpOnly, sameSite: sessionCookie?.sameSite, path: sessionCookie?.path }).toEqual({ secure: true, httpOnly: true, sameSite: "Lax", path: "/" });
  expect(cookies.some((cookie) => cookie.name === "__Host-acenta-pre")).toBe(false);
  await page.getByRole("button", { name: "Ajustar planeación", exact: true }).click();
  await page.getByRole("button", { name: "Adjuntar referencia", exact: true }).click();
  const pendingSource = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/sources"));
  await page.getByRole("button", { name: /Planeación de ciencias · ejemplo/ }).click();
  const saved = await pendingSource;
  expect(saved.status()).toBe(201);
  const source = await saved.json();
  expect(source.actor_id).toBe(first.principal_id);
  expect(source.scope_id).toBe(first.scope_id);
  const sourcePath = `/scopes/${first.scope_id}/sources/${source.source_id}/versions/1`;
  expect((await page.request.get(sourcePath)).status()).toBe(200);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  const leakedSession = storage.includes(sessionCookie!.value);
  expect(leakedSession).toBe(false);
  const leakedCsrf = storage.includes(first.csrf_token);
  expect(leakedCsrf).toBe(false);
  await page.reload();
  await expect(page.getByRole("button", { name: "Cerrar sesión", exact: true })).toBeVisible();
  const current = await page.request.get("/auth/session");
  expect((await current.json()).principal_id).toBe(first.principal_id);

  const secondTab = await context.newPage();
  await secondTab.goto("/");
  await expect(secondTab.getByRole("button", { name: "Cerrar sesión", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continuar con correo", exact: true })).toBeVisible();
  expect((await page.request.get(sourcePath)).status()).toBe(401);
  await secondTab.bringToFront();
  await secondTab.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(secondTab.getByRole("button", { name: "Continuar con correo", exact: true })).toBeVisible();
  const second = await login(page, "browser-b@example.test");
  expect(second.principal_id).not.toBe(first.principal_id);
  expect(second.scope_id).not.toBe(first.scope_id);
  expect((await page.request.get(sourcePath)).status()).toBe(404);
  await secondTab.close();
});

test("a fresh authenticated account discovers exact original versions without any planning or browser IDs", async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  // Production entry, real OTP/session/CSRF/DB. Only email delivery is replaced in Python.
  await page.goto("/");
  const account = await login(page, "source-library-a@example.test");
  const firstLoginAt = Date.now();
  const firstCookie = (await context.cookies()).find((c) => c.name === "__Host-acenta-session")!;
  const origin = new URL(page.url()).origin;
  await page.getByLabel("Petición para tu clase").fill("Petición sin generar una planeación");
  await page.getByRole("button", { name: "Adjuntar referencia", exact: true }).click();
  const savedResponse = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/sources"));
  await page.getByRole("button", { name: /^Planeación de ciencias · ejemplo/ }).click();
  const saved = await savedResponse;
  expect(saved.status()).toBe(201);
  const original: SourceReceipt = await saved.json();
  const prefix = `/scopes/${account.scope_id}`;
  const catalogPath = `${prefix}/sources`;
  const versionPath = (number: number) => `${catalogPath}/${original.source_id}/versions/${number}`;
  expect((await (await page.request.get(`${prefix}/plannings`)).json()).items).toEqual([]);
  await page.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
  await expect(page.getByRole("article", { name: "Recurso original · Versión 1", exact: true })).toBeVisible();
  await expect(page.getByText("Aún no hay copias ni borradores guardados.")).toBeVisible();
  await page.getByRole("button", { name: "Volver a la petición" }).click();
  await expect(page.getByLabel("Petición para tu clase")).toHaveValue("Petición sin generar una planeación");
  // Delete all browser references. A separate empty context must authenticate again.
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await context.clearCookies();
  await page.close();
  const fresh = await browser.newContext({ baseURL: origin });
  try {
    const restored = await fresh.newPage();
    await restored.goto("/");
    expect((await restored.request.get(catalogPath)).status()).toBe(401);
    expect(await restored.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    // Respect the real one-minute email resend cooldown; never relax auth settings or clocks.
    const cooldown = 61_000 - (Date.now() - firstLoginAt);
    if (cooldown > 0) await restored.waitForTimeout(cooldown);
    const newSession = await login(restored, "source-library-a@example.test");
    expect(newSession.principal_id).toBe(account.principal_id);
    expect(newSession.scope_id).toBe(account.scope_id);
    const cookie = (await fresh.cookies()).find((c) => c.name === "__Host-acenta-session")!;
    expect(cookie.value === firstCookie.value).toBe(false);
    expect(await restored.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    await expect(restored.getByRole("button", { name: "Adjuntar referencia", exact: true })).toBeVisible();
    const listingResponse = restored.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === catalogPath);
    await restored.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
    const listing = await listingResponse;
    expect(listing.status()).toBe(200);
    expect(listing.headers()["cache-control"]).toBe("no-store");
    expect(await listing.json()).toEqual({ items: [original], next_cursor: null });
    await expect(restored.getByRole("button", { name: "Reabrir copia guardada" })).toHaveCount(0);
    const v1Card = restored.getByRole("article", { name: "Recurso original · Versión 1", exact: true });
    await expect(v1Card.getByRole("heading")).toHaveText(sourceSamples[0].name);
    await expect(v1Card).toContainText(original.sha256);
    await expect(v1Card.locator("time")).toHaveAttribute("datetime", original.created_at);

    // Commit V2 after the catalog was read. The visible V1 reference must remain exact.
    const revision = await restored.request.post(`${catalogPath}/${original.source_id}/versions?expected_version=1`, {
      headers: { "Origin": origin, "X-CSRF-Token": newSession.csrf_token,
        "Idempotency-Key": crypto.randomUUID(), "Content-Type": "application/octet-stream" },
      data: sourceSamples[1].bytes,
    });
    expect(revision.status()).toBe(201);
    const second: SourceReceipt = await revision.json();
    expect(second.number).toBe(2);
    async function openAndVerify(receipt: SourceReceipt, sample: typeof sourceSamples[number]) {
      const card = restored.getByRole("article", { name: `Recurso original · Versión ${receipt.number}`, exact: true });
      const trigger = card.getByRole("button", { name: "Abrir original", exact: true });
      const response = restored.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === versionPath(receipt.number));
      await trigger.focus(); await trigger.press("Enter");
      const read = await response;
      expect(read.status()).toBe(200);
      expect(read.headers()["cache-control"]).toBe("no-store");
      expect(read.headers()["x-version"]).toBe(String(receipt.number));
      expect(read.headers()["x-source-id"]).toBe(receipt.source_id);
      expect(read.headers()["x-actor-id"]).toBe(account.principal_id);
      const viewer = restored.getByRole("dialog", { name: "Original de ejemplo" });
      await expect(viewer.getByRole("status")).toContainText("bytes verificados");
      expect(await viewer.getByLabel("Contenido original").textContent()).toBe(sample.bytes);
      expect(read.url()).toBe(new URL(versionPath(receipt.number), origin).href);
      // Chromium can discard CDP bodies for no-store streams after the page consumes them
      // (microsoft/playwright#42742). Read binary evidence through the same real session.
      const binary = await restored.request.get(read.url(), { maxRedirects: 0 });
      expect(binary.status()).toBe(200);
      for (const header of ["cache-control", "x-version", "x-source-id", "x-actor-id", "x-content-size", "x-content-sha256"])
        expect(binary.headers()[header]).toBe(read.headers()[header]);
      const bytes = await binary.body();
      expect(bytes).toEqual(Buffer.from(sample.bytes, "utf8"));
      expect(bytes.length).toBe(receipt.size);
      expect(read.headers()["x-content-size"]).toBe(String(receipt.size));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(receipt.sha256);
      expect(read.headers()["x-content-sha256"]).toBe(receipt.sha256);
      await restored.keyboard.press("Escape");
      await expect(viewer).toHaveCount(0); await expect(trigger).toBeFocused();
    }
    await openAndVerify(original, sourceSamples[0]);
    await restored.getByRole("button", { name: "Actualizar listado" }).click();
    await expect(v1Card).toHaveCount(0);
    await openAndVerify(second, sourceSamples[1]);
    await restored.getByRole("button", { name: "Volver a la petición" }).click();
    await expect(restored.getByRole("button", { name: "Adjuntar referencia", exact: true })).toBeVisible();
    await expect(restored.getByLabel("Petición para tu clase")).toHaveValue("");
    expect((await (await restored.request.get(`${prefix}/plannings`)).json()).items).toEqual([]);
    expect((await (await restored.request.get(`${prefix}/planning-drafts`)).json()).items).toEqual([]);
    await restored.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
    await expect(restored.getByRole("button", { name: "Continuar con correo", exact: true })).toBeVisible();
    expect((await restored.request.get(catalogPath)).status()).toBe(401);
    const other = await login(restored, "source-library-b@example.test");
    expect(other.scope_id).not.toBe(account.scope_id);
    await restored.getByRole("button", { name: "Mis recursos", exact: true }).first().click();
    await expect(restored.getByText("No hay recursos todavía. Adjunta un ejemplo para empezar.")).toBeVisible();
    await expect(restored.getByRole("article")).toHaveCount(0);
    expect((await restored.request.get(catalogPath)).status()).toBe(404);
    expect((await restored.request.get(versionPath(1))).status()).toBe(404);
    expect((await restored.request.get(`/scopes/${other.scope_id}/sources/${original.source_id}/versions/1`)).status()).toBe(404);
    const foreignCursor = await restored.request.get(`/scopes/${other.scope_id}/sources?after=${original.source_id}`);
    expect(foreignCursor.status()).toBe(422);
    expect(await foreignCursor.json()).toEqual({ detail: "invalid_request" });
  } finally {
    await fresh.close();
  }
});
