# Acenta: interfaz #14 y edición durable #15

React + TypeScript + Vite. La entrada real recupera la sesión mediante
`GET /auth/session` antes de abrir un espacio privado. El acceso implementa
Google Identity Services directo (cliente y nonce de bootstrap) y códigos de
un uso por correo. [Contrato B1](../docs/specs/0005-autenticacion-local.md).

Este corte es preparatorio: no configura cliente Google, cuentas, credenciales
ni proveedor de correo. Sin configuración, la interfaz informa indisponibilidad;
no existen actores seleccionables, identidad por header ni flags demo. El código
no afirma que un correo se entregó: muestra la respuesta genérica del servidor.
No solicita consentimiento de marketing ni vincula Google y correo por email.

Las credenciales sólo viajan al endpoint auth de mismo origen. La sesión usa
cookie HttpOnly; el token CSRF queda en memoria y acompaña escrituras privadas.
Runtime no almacena sesiones, borradores ni respuestas privadas en localStorage.
La recarga recupera la autoridad del servidor; recursos y borradores confirmados
se recuperan desde la biblioteca. El trabajo aún sin guardar conserva su aviso
antes de salir. Cierre, caducidad y cambio de cuenta eliminan el controlador,
sus referencias privadas y las respuestas pendientes. El logout fallido oculta
el espacio y exige reintentar antes de ofrecer cambio de cuenta. La sesión se
revalida al volver a la pestaña y cada minuto visible, sin alargar su inactividad. Una caída de red, error de servicio o respuesta inválida de esa
comprobación suspende el espacio y bloquea nuevas peticiones privadas, conservando
el trabajo pendiente sólo en memoria. La interfaz advierte que no se recargue y
permite reintentar. Sólo una sesión confirmada idéntica recupera ese buffer; una
sesión caducada o distinta lo elimina. Nunca se trata un fallo de red como prueba
de caducidad.

Las pruebas antiguas de #14/#15 conservan fixtures aislados de runtime; no
acreditan autenticación externa. El harness auth offline sustituye únicamente
el sender/verificador, usa sesión real y tiene su configuración separada de CI.
No completa #13 ni habilita producción o documentos reales.

## Ejecutar y verificar

Node 24, npm y Python 3 (validador de assets de biblioteca estándar), desde `web/`:

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run dev -- --port 4173
```

`dist/` sólo incluye la entrada de producción. No desplegar el servidor Vite de
desarrollo ni publicar `tests/` como un acceso alternativo.

```sh
# Chromium ya instalado; alternativamente Playwright Chromium oficial.
ACENTA_EVIDENCE_DIR=../evidence/acenta \
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

Playwright sirve loopback 127.0.0.1:4173 y usa fixtures de test. Los recorridos
Acenta están en `tests/acenta.browser.ts`; `tests/acenta.html` es su única entrada.
`tests/legacy.html` conserva la prueba T3 previa con IndexedDB, sin confundir esa
persistencia local con B2/B3. Ningún actor de test se importa desde `src/main.tsx`.

El recorrido HTTP real está separado de esos mocks. Tras instalar las dependencias
de web y preparar PostgreSQL desechable como indica [desarrollo](../docs/development.md),
ejecuta desde la raíz:

```sh
uv run --locked --no-editable pytest tests/browser_integration.py
```

Pytest usa el rol runtime de pruebas, inyecta el actor únicamente en su app de test
y levanta la API en loopback. Ejecuta `npm run test:integration`, que usa
`playwright.integration.config.ts`, el proxy `tests/vite-api.config.ts` y la entrada
`tests/acenta-api.html`. Las variables `AULALISTA_E2E_*` sólo existen para esa
configuración explícita; no hay configuración Vite de producción que las consuma.
No ejecutar ese comando npm aisladamente ni exponer estos servidores de test.
La prueba no intercepta HTTP: crea la fuente y el resultado, edita, elimina el
respaldo local, recarga y reabre desde PostgreSQL. Comprueba además los bytes
originales, la revisión inicial inmutable y el recibo exacto del guardado.
Esta identidad inyectada no acredita B1 ni permite cerrar #14.

La ejecución nativa de 2026-10-16 verificó unitarias y build. Chromium abortó por
restricción de socket Unix antes de ejecutar los recorridos. **QA visual/browser
queda pendiente del entorno de revisión**; los archivos de test no son evidencia
de haberlos pasado. Capturas previstas: acceso 1440×960, inicio y editor 1440×924,
editor móvil 390×844. Cada test espera `document.fonts.ready` cuando compara la
vista de referencia. Revisar también teclado, foco modal, Escape e inercia del
fondo; la captura por sí sola no demuestra esos comportamientos.

## Componentes y contratos

- `src/acenta/App.tsx`: acceso, shell, composer, menús, resultado, editor, guardia
  de salida y biblioteca mínima para reabrir revisiones/copia/borrador.
- `src/acenta/style.css`: tokens visuales, fuentes locales y reflow responsive.
- `src/acenta/contracts.ts`: DTO de fuentes T2 y resultados B2/B3; fixture agua
  explícito, sin PDF real ni contenido interpretado.
- `src/acenta/api.ts`: requests scoped same-origin/no-store, límites de bytes,
  validación de recibos/payload y ausencia de headers de autoridad del cliente.
- `src/acenta/controller.ts`: intentos estables, CAS, recuperación por recibo,
  buffer local por generación y respaldo por cuenta/ámbito/workspace.
- `tests/acenta-contract-examples.json`: respuestas reales obtenidas en fixtures
  de PostgreSQL; IDs y contenido sintéticos, sin credenciales.

El resultado consume títulos, elementos, tiempos y contexto del payload. Las
revisiones B3 muestran `initial_request` cuando existe; su `request` describe la
edición actual, sin inventar una solicitud original. El ejemplo agua de 30 min
es un fixture adicional autorizado y comprobado por backend; no transforma en UI
el fixture B2 previo de 40 min. La fuente exacta permanece inmutable.

Contratos: [B2](../docs/tickets/B2-resultado-simulado.md) y
[B3](../docs/specs/0003-edicion-durable.md). Tareas/estado:
[#14](https://github.com/eliancanul/AulaLista-SaaS/issues/14) y
[#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15).

## Recuperación y límites

- Un write conserva clave UUID y payload. Tras timeout o respuesta incierta,
  consultar su operación y, ante 404, repetir exactamente la misma petición.
  Un 404 de recibo no demuestra fracaso. Fallar al recuperar no descarta la clave.
  Un rechazo de negocio del replay exacto sí termina ese intento: 409, o los 422
  `unsupported_fixture` (crear), `unsupported_target` (editar/copiar/borrador) y
  `unchanged_text` (editar). El backend comprueba la operación antes de emitirlos.
  Se conserva el texto y se habilita la siguiente decisión explícita. 401/404,
  validación de transporte, timeout o recibos contradictorios siguen inciertos.
- El selector sólo acepta los bytes del ejemplo incorporado antes de guardarlos
  localmente o enviarlos. Comprueba tamaño/hash del recibo y recupera una fuente
  incierta con la misma clave tras recargar. Elegir de nuevo la referencia ya
  adjunta no crea otra fuente; quitarla no borra bytes confirmados del servidor.
- Cancelar el selector impide aplicar la selección tardía, sin asumir que la
  escritura se canceló. Un prompt o referencia nuevos invalidan el salto visual
  de un resultado anterior; éste sigue disponible en la biblioteca. Esa separación
  también se conserva tras una recarga con una operación pendiente.
- Guardar confirma sólo el texto de esa generación; una edición posterior queda
  pendiente. Deshacer afecta únicamente al buffer y se bloquea con write incierto.
- Conflicto muestra la revisión vigente y conserva el texto local. Conservar
  copia crea otro objeto desde la base exacta, sin merge ni modificación del original.
- Conservar borrador confirma otro recibo/namespace; no anuncia una revisión
  guardada. El cierre con cambios requiere continuar o conservar ese borrador.
- El respaldo local usa cuenta/ámbito y UUID de workspace. El bootstrap debe
  conservar esa UUID al recargar la misma pestaña y usar otra para otro workspace;
  el harness lo hace con sessionStorage. No hay índice global de borradores locales
  ni garantía de recuperarlos al borrar storage/cerrar todas las pestañas. El
  borrador confirmado de servidor sí se reabre desde la biblioteca.
- Cuota o respaldo corrupto se informa; el contenido corrupto no se reemplaza.
  Compositor y editor rechazan entradas que superan 256/1000 caracteres antes de
  reemplazar su texto anterior o persistirlas. La restauración valida el indicador
  de borrador confirmado y su revisión; un valor corrupto no autoriza descartarlo.
  El cambio/cierre de sesión elimina el estado privado visible y descarta callbacks
  tardíos, conservando su respaldo bajo la cuenta original.
- Los 14 títulos del catálogo se identifican como herramientas futuras. Búsqueda,
  nueva conversación, ajustes y micrófono están pendientes. No hay generación
  libre, interpretación documental ni validación NEM/curricular declarada.

## Diseño y assets

[Procedencia y licencias](public/acenta/ASSETS.md). Se conservaron fuentes e iconos
reales del diseño Figma. El logo es la reconstrucción autorizada, no un master
original. La foto usa el recorte aprobado del paquete: su importación a Figma
falló con 405, diferencia documentada respecto al placeholder. El titular derecho
eliminado permanece ausente. «Bienvenido» conserva el cambio humano actual de
96 px en desktop; en pantallas pequeñas se adapta al ancho.

No se añadió framework de estilos, router, cliente externo ni dependencia de
runtime. Los assets se sirven localmente, sin CDN de fuentes ni servicios de IA.
No se declara conformidad WCAG o validación con docentes por ejecutar tests.

El gate de assets verifica raíz XML SVG, dimensiones, referencias externas, CRC de PNG
y directorios/tablas TTF, además de sus hashes. El SVG Google aprobado utiliza
foreignObject para su gradiente; su visualización completa requiere revisión en
Chromium porque CairoSVG no admite ese contenido. No se sustituye por un dibujo.
