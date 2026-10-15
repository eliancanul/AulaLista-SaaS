# AulaLista: recorrido sintético T3

Prototipo React + TypeScript + Vite. Una vista: cargar ejemplo incorporado, editar dos actividades y recuperar la revisión local confirmada. No admite archivos personales, no llama a servicios externos, no tiene login ni conexión con el backend. La carga e interpretación están identificadas como simulación. IndexedDB sí realiza almacenamiento local real.

## Ejecutar

Requiere Node 24 (verificado: 24.19.0) y npm. Desde `web/`:

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run dev -- --port 4173
```

Para las pruebas end-to-end en una máquina que permita iniciar Chromium:

```sh
npx playwright install chromium
npm run test:browser
```

También se puede usar un Chromium ya instalado: `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`. El servidor de tests se limita a `127.0.0.1`; el navegador no transmite ejemplos a un backend. Para revisar el artefacto de producción puede servirse `dist/` en loopback mediante un servidor estático. No es un despliegue.

## Qué se conserva

- Una planeación sintética y una operación vigente; doble inicio y eventos tardíos no crean otra operación ni pisan ediciones.
- Identidad y estado de la única aclaración, reservada en la misma transacción que publica el resultado parcial. No se muestra antes de persistir y leer su revisión.
- Original de fixture, versión, intento, campos editados, alternativas automáticas y cada revisión local. Los borradores de escritura quedan también archivados, incluidas alternativas descartadas al resolver un conflicto.
- Las transacciones `readwrite` de IndexedDB serializan la comparación y escritura entre pestañas. Campos independientes se fusionan; el mismo campo tiene resolución inline sin pérdida silenciosa.
- La confirmación exige terminar la transacción y leer la revisión exacta. Una edición posterior pendiente nunca queda confirmada por un guardado anterior.

Al cerrar abruptamente, sólo se garantiza la última revisión confirmada. Sin almacenamiento disponible, el borrador queda en memoria con copia/reintento. La página no sigue ejecutándose cerrada; al volver reanuda la simulación confirmada. Esto no es persistencia de cuenta, sincronización, backup ni la garantía durable del backend.

Los controles plegados «Escenarios de prueba» cambian fixtures conservando la misma identidad y aclaración. «Restablecer pruebas» borra explícitamente sólo los datos sintéticos de este origen para una prueba aislada; no cuenta como recuperación.

## Archivos y límites

- `model.ts`: fixtures e invariantes puras.
- `storage.ts`: almacenamiento local transaccional, revisión de lectura y borradores.
- `controller.ts`: cola de operaciones, ediciones pendientes, recuperación y coordinación entre pestañas.
- `main.tsx` / `style.css`: vista única, controles nativos y escenarios de prueba.
- `tests/state.test.ts`: estado, concurrencia, almacenamiento, errores y regresiones.
- `tests/flow.browser.ts`: recorridos en Chromium, tráfico, teclado, recarga y conflictos.

No se añadió un framework de estilos, router, editor enriquecido, cliente API ni motor de workflows. El historial local no tiene compactación: es aceptable sólo para este pequeño ejemplo sintético y deberá acotarse antes de admitir uso continuo. No se declara conformidad WCAG ni validación con docentes por ejecutar estos tests. Los fallos DOMException del almacenamiento se inyectan en el adaptador con `fake-indexeddb`; no equivalen a haber agotado la cuota física de un navegador.
