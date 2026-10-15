import {test, expect, type Page} from '@playwright/test';
async function load(page: Page, scenario = 'clear') {
  await page.goto('/');
  if (scenario !== 'clear') {await page.getByText('Escenarios de prueba', {exact: true}).click(); await page.getByLabel('Ejemplo o fallo simulado').selectOption(scenario);}
  await page.getByRole('button', {name: 'Cargar ejemplo', exact: true}).click();
  await expect(page.getByLabel('Instrucciones de la actividad 2', {exact: true})).toBeVisible();
}

test('UX01 UX02 clear editing and real reload; no external traffic', async ({page}) => {
  const external: string[] = []; page.on('request', req => {if (!req.url().startsWith('http://127.0.0.1:4173/')) external.push(req.url());});
  await load(page); await expect(page.getByRole('group')).toHaveCount(0);
  await page.getByLabel('Instrucciones de la actividad 2', {exact: true}).fill('Primero, distribuyan las semillas de ejemplo. Después, organicen los recipientes.');
  await expect(page.getByText('Guardado en este navegador', {exact: true})).toBeVisible(); await page.reload();
  await expect(page.getByLabel('Instrucciones de la actividad 2', {exact: true})).toHaveValue('Primero, distribuyan las semillas de ejemplo. Después, organicen los recipientes.');
  await expect(page.locator('input[type=file]')).toHaveCount(0); expect(external).toEqual([]);
  await page.screenshot({path: '../evidence/desktop-edited.png', fullPage: true});
});
test('UX03 UX13 duplicate keyboard activation and reload during loading', async ({page}) => {
  await page.goto('/'); const button = page.getByRole('button', {name: 'Cargar ejemplo', exact: true}); await button.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', {name: 'Cargando ejemplo…', exact: true})).toBeFocused(); await page.reload();
  await expect(page.getByLabel('Instrucciones de la actividad 2', {exact: true})).toBeVisible();
});
test('UX04 UX05 UX06 question survives reload and new version after skip', async ({page}) => {
  await load(page, 'multiple'); const question = page.getByRole('group'); await expect(question).toHaveCount(1); await page.reload(); await expect(question).toHaveCount(1);
  await page.getByRole('button', {name: 'Dejar pendiente', exact: true}).click(); await expect(question).toHaveCount(0); await expect(page.getByText(/Grupo pendiente/)).toBeVisible();
  await expect(page.getByText('Resultado de ejemplo listo para editar', {exact: true})).toBeVisible();
  await page.getByText('Escenarios de prueba', {exact: true}).click(); await page.getByLabel('Ejemplo o fallo simulado').selectOption('multiple'); await page.getByRole('button', {name: 'Simular otra versión', exact: true}).click();
  await expect(page.getByText('Cargando ejemplo… · Simulación', {exact: true})).toBeVisible();
  await expect(page.getByText('Resultado de ejemplo listo para editar', {exact: true})).toBeVisible(); await expect(question).toHaveCount(0);
});
test('UX09 failed storage simulation keeps text and retry recovers', async ({page}) => {
  await load(page); await page.getByText('Escenarios de prueba', {exact: true}).click(); await page.getByLabel('Forzar fallo de guardado (simulación)').check();
  await page.getByLabel('Instrucciones de la actividad 2', {exact: true}).fill('Borrador de ejemplo sin confirmar'); await expect(page.getByRole('alert')).toContainText('No se guardaron');
  await expect(page.getByLabel('Instrucciones de la actividad 2', {exact: true})).toHaveValue('Borrador de ejemplo sin confirmar');
  await page.getByLabel('Forzar fallo de guardado (simulación)').uncheck(); await page.getByRole('button', {name: 'Reintentar guardado'}).click(); await expect(page.getByText('Guardado en este navegador', {exact: true})).toBeVisible();
  await page.reload(); await expect(page.getByLabel('Instrucciones de la actividad 2', {exact: true})).toHaveValue('Borrador de ejemplo sin confirmar');
});
test('UX10 concurrent conflict preserves own text and resolves inline', async ({page, context}) => {
  await load(page); await expect(page.getByText('Resultado de ejemplo listo para editar', {exact: true})).toBeVisible(); const other = await context.newPage(); await other.goto('/');
  await other.getByText('Escenarios de prueba', {exact: true}).click(); await other.getByLabel('Forzar fallo de guardado (simulación)').check();
  await other.getByLabel('Instrucciones de la actividad 2', {exact: true}).fill('Versión propia B');
  await page.getByLabel('Instrucciones de la actividad 2', {exact: true}).fill('Versión guardada A'); await expect(page.getByText('Guardado en este navegador', {exact: true})).toBeVisible();
  await other.getByLabel('Forzar fallo de guardado (simulación)').uncheck(); await other.getByRole('button', {name: 'Reintentar guardado'}).click();
  await expect(other.getByText('Hay dos versiones de este campo')).toBeVisible(); await expect(other.getByLabel('Instrucciones de la actividad 2', {exact: true})).toHaveValue('Versión propia B');
  await other.screenshot({path: '../evidence/conflict.png', fullPage: true}); await other.getByRole('button', {name: 'Usar mi texto', exact: true}).click();
  await expect(other.getByText('Guardado en este navegador', {exact: true})).toBeVisible(); await page.reload(); await expect(page.getByLabel('Instrucciones de la actividad 2', {exact: true})).toHaveValue('Versión propia B');
});
test('UX14 keyboard question and 320px reflow', async ({page}) => {
  await page.setViewportSize({width: 320, height: 800}); await load(page, 'ambiguous'); const groupB = page.getByRole('button', {name: 'Grupo B', exact: true}); await groupB.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Grupo de la actividad 2')).toHaveValue('Grupo B');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path: '../evidence/mobile-320.png', fullPage: true});
});

test('clearing instructions does not hide the result after autosave or reload', async ({page}) => {
  await load(page); await page.getByLabel('Instrucciones de la actividad 1', {exact: true}).fill('');
  await expect(page.getByText('Guardado en este navegador', {exact: true})).toBeVisible();
  await expect(page.getByLabel('Instrucciones de la actividad 2', {exact: true})).toBeVisible(); await page.reload();
  await expect(page.getByLabel('Instrucciones de la actividad 1', {exact: true})).toHaveValue('');
  await expect(page.getByLabel('Instrucciones de la actividad 2', {exact: true})).toBeVisible();
});

test('transient processing controls leave focus on a stable operation control', async ({page}) => {
  await load(page, 'lost-reply'); const check = page.getByRole('button', {name: 'Comprobar estado', exact: true});
  await expect(check).toBeVisible(); await check.press('Enter');
  await expect(page.getByRole('button', {name: 'Ejemplo cargado', exact: true})).toBeFocused();
});
