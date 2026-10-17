import { test, expect, type Page } from "@playwright/test";

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
