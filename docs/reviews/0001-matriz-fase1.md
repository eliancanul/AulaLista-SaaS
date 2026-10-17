# Acenta: matriz reconciliada de 38 asignaciones

Base: [1f9e7c23db7564049b68904db62f98b5730ee0b6](https://github.com/eliancanul/AulaLista-SaaS/commit/1f9e7c23db7564049b68904db62f98b5730ee0b6). Árbol `694da902b3d34b01148d8dc238283094f7b88c11`. Auditoría: 17 de octubre de 2026.

## Lectura correcta

Reconciliación estática de snapshot cuyo árbol se verificó byte a byte contra main; lectura de código/pruebas y logs CI existentes. Sin ejecutar suites nuevas.

La matriz reconoce implementación y evidencia existentes. No cierra automáticamente #12 ni convierte cobertura compartida en aceptación visual individual. #13 atraviesa todos los estados privados; los propietarios principales siguen la matriz de #12.

Tipos: `unit_mock` = controladores/contratos con transporte simulado; `browser_mock` = Chromium con FixtureServer; `http_postgres_actor_test` = navegador y API/PG reales, actor inyectado sólo en test; `auth_real_postgres` = entrada de producción, sesión/CSRF/PG reales, envío de correo sintético; `postgres_runtime` = integración backend con rol runtime.

CI exacta ya ejecutada: [web](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/39058555523), [backend](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/39058555388), [evaluación](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/39058555484). Los logs web muestran 275 unitarias totales (incluyen legado), 33 recorridos de navegador totales, 5 wrappers HTTP/PG y 1 wrapper auth que ejecuta 4 escenarios. Estos totales no son un conteo de los 38 estados.

## Alcance de fase 1 y correspondencia de diseño

- El 17 de octubre de 2026 el usuario aceptó conservar la purga del texto local ante un 401 ambiguo. Tras login se recupera sólo trabajo confirmado en servidor desde la biblioteca; pueden perderse cambios nunca guardados. La continuidad de edición no confirmada tras 401/reautenticación queda aplazada explícitamente como mejora posterior en [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15). No se implementó en este corte. [Contrato y límite](../specs/0003-edicion-durable.md#decisión-de-fase-1-recuperación-tras-sesión-inválida).
- La consulta de Figma vivo del 17 de octubre, registrada en [#12](https://github.com/eliancanul/AulaLista-SaaS/issues/12), verificó 37 frames en [04 · Prototipo interactivo](https://www.figma.com/design/WEmZPyqYaUjBpY2fMhXItU?node-id=20-433). El ID contractual `35:1721` no está disponible: se conserva como variante funcional inferida de herramientas con adjunto, no como frame verificado ni estado visual aceptado. No se creó un frame nuevo.
- Las 38 filas mantienen el inventario contractual original y la evidencia del SHA auditado. Los pendientes de pruebas visuales/contexto/reintento siguen explícitos; no se atribuye aquí la ejecución de candidatos posteriores ni el cierre de #12.

## 20:436 · Inicio
- Propietario: [#14](https://github.com/eliancanul/AulaLista-SaaS/issues/14); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Mostrar inicio y permitir preparar la petición admitida.
- Datos: Prompt, referencia y contexto fixture.
- Persistencia: Entrada local; escritura sólo al seleccionar fuente/enviar.
- Error/recuperación: Acceso privado controlado por #13; acciones futuras deshabilitadas.
- Código: [C-home: Inicio y compositor reales](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L656); [C-auth: Revocación/401/403 purgan estado privado y respaldo](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/auth.ts#L259).
- Pruebas existentes (directa): [B-home: Geometría, compositor, sidebar, modal, teclado y foco](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L188); [I-create: Crear→editar→guardar→recarga sin localStorage; original e historial exactos](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.integration.ts#L8); [A-draft: Crear/editar, atrás, guardar borrador con respuesta perdida, logout y reapertura tras login](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L197).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 20:481 · Contexto elegido
- Propietario: [#14](https://github.com/eliancanul/AulaLista-SaaS/issues/14); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Mostrar el único contexto de ejemplo aprobado para el siguiente envío.
- Datos: waterContext / water-observation-v1.
- Persistencia: Se captura en solicitud/resultado al commit; menú local.
- Error/recuperación: No habilita selección arbitraria ni reetiqueta resultados antiguos.
- Código: [C-context: Selector local del único contexto fixture; no CRUD de clase](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L1013); [C-submit: Captura prompt/fuente/contexto/clave de operación](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L649); [C-result: Resultado según documento durable y fuente exacta](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L174).
- Pruebas existentes (compartida): [U-submit: Adjunto fixture y doble envío bloqueado en vuelo](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L318); [I-create: Crear→editar→guardar→recarga sin localStorage; original e historial exactos](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.integration.ts#L8); [A-draft: Crear/editar, atrás, guardar borrador con respuesta perdida, logout y reapertura tras login](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L197).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: No localicé prueba específica abrir→elegir→cerrar el menú de contexto; controles y captura de fixture sí cubiertos.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 20:508 · Escribir petición
- Propietario: [#14](https://github.com/eliancanul/AulaLista-SaaS/issues/14); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Editar texto y habilitar envío sólo con prompt y adjunto.
- Datos: Prompt acotado a 256 caracteres.
- Persistencia: Local hasta envío; payload se congela por operación.
- Error/recuperación: Entrada no reconocida falla honestamente; no generación libre.
- Código: [C-home: Inicio y compositor reales](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L656); [C-set: Texto local acotado; avance de generación de navegación](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L456); [C-submit: Captura prompt/fuente/contexto/clave de operación](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L649).
- Pruebas existentes (directa): [B-home: Geometría, compositor, sidebar, modal, teclado y foco](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L188); [U-unsupported: Petición no reconocida no obtiene éxito ficticio](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L393); [U-late: Texto nuevo no sustituido por respuesta antigua](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L227); [I-create: Crear→editar→guardar→recarga sin localStorage; original e historial exactos](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.integration.ts#L8).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 20:615 · Enviando
- Propietario: [#14](https://github.com/eliancanul/AulaLista-SaaS/issues/14); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Exponer envío en curso y evitar duplicado/retarget.
- Datos: CreateIntent con clave, fuente, versión y prompt exactos.
- Persistencia: HTTP/PG confirma resultado y recibo; pendiente no es guardado.
- Error/recuperación: Consulta y replay exacto; respuesta tardía no pisa trabajo nuevo.
- Código: [C-home: Inicio y compositor reales](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L656); [C-submit: Captura prompt/fuente/contexto/clave de operación](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L649); [C-create: Respuesta tardía e idempotencia de generación fixture](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L681).
- Pruebas existentes (compartida): [U-submit: Adjunto fixture y doble envío bloqueado en vuelo](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L318); [U-create-lost: Recuperación de creación tras pérdida de respuesta](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L337); [B-late: Respuesta tardía no pisa entrada; biblioteca después de perder backup](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L682).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Existe prueba del bloqueo/enlace de operación, sin aserción visual aislada del texto «Enviando petición al servidor…».
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 22:264 · Resultado
- Propietario: [#14](https://github.com/eliancanul/AulaLista-SaaS/issues/14); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Mostrar duración, contexto, recurso editable y original del resultado confirmado.
- Datos: PlanningDocument + recibo, fuente y revisión.
- Persistencia: PG durable; generación fixture determinista.
- Error/recuperación: Reabrir no genera de nuevo; procedencia sintética explícita.
- Código: [C-result: Resultado según documento durable y fuente exacta](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L174); [C-create: Respuesta tardía e idempotencia de generación fixture](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L681); [C-reopen: Reapertura vía HTTP sin generar](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L1076).
- Pruebas existentes (directa): [B-result: Resultado, edición, guardado, recarga y original intacto](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L460); [I-create: Crear→editar→guardar→recarga sin localStorage; original e historial exactos](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.integration.ts#L8); [A-reload: Crear/editar, recarga misma sesión, commit/recibo perdido, texto posterior y purge por logout en otra pestaña](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L308); [P-create: Fixture agua, respuestas perdidas, edición y biblioteca](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/tests/test_water_fixture.py#L72).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 26:433 · Borrador compacto de petición
- Propietario: [#14](https://github.com/eliancanul/AulaLista-SaaS/issues/14); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Conservar texto del compositor al variar navegación o ancho.
- Datos: Prompt local, separado del borrador de edición guardado en servidor.
- Persistencia: Local; no crea draft de #15 por escribir petición.
- Error/recuperación: Respuesta antigua conserva entrada nueva.
- Código: [C-home: Inicio y compositor reales](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L656); [C-set: Texto local acotado; avance de generación de navegación](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L456); [C-create: Respuesta tardía e idempotencia de generación fixture](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L681).
- Pruebas existentes (compartida): [B-home: Geometría, compositor, sidebar, modal, teclado y foco](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L188); [B-late: Respuesta tardía no pisa entrada; biblioteca después de perder backup](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L682); [U-late: Texto nuevo no sustituido por respuesta antigua](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L227).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Cobertura compartida del compositor/reflow; no equivalencia visual exacta de este nodo acreditada.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 22:299 · Editar actividad
- Propietario: [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Abrir enunciado editable con vista previa y campos no editables.
- Datos: Recurso, elemento, base/revisión y texto.
- Persistencia: Base confirmada vía HTTP; buffer local con respaldo de sesión.
- Error/recuperación: No permite cambiar campos fuera del contrato.
- Código: [C-editor: Editor y estados clean/dirty/saving/saved/error/unknown/conflict](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L334); [C-open: Abre editor del resultado y su revisión](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L742); [C-edit: Texto local; conserva base y proyección de recuperación](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L791).
- Pruebas existentes (directa): [B-result: Resultado, edición, guardado, recarga y original intacto](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L460); [I-create: Crear→editar→guardar→recarga sin localStorage; original e historial exactos](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.integration.ts#L8); [A-reload: Crear/editar, recarga misma sesión, commit/recibo perdido, texto posterior y purge por logout en otra pestaña](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L308); [P-edits: Revisión durable e historial/recibos exactos tras reinicio](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/tests/test_planning_edits.py#L152).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 22:337 · Edición con cambios
- Propietario: [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Separar buffer sucio de revisión y deshacer sólo cambios locales.
- Datos: Texto, generación local, baseline, base exacta.
- Persistencia: Buffer; no cambia PG antes de guardar.
- Error/recuperación: Guardar A no pisa edición B; respaldo no equivale a commit.
- Código: [C-editor: Editor y estados clean/dirty/saving/saved/error/unknown/conflict](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L334); [C-edit: Texto local; conserva base y proyección de recuperación](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L791); [C-undo: Deshacer sólo buffer local](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L816).
- Pruebas existentes (directa): [U-new-edit: Guardado A no pisa edición B](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L402); [U-undo: Deshacer local y bloqueo si escritura incierta](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L422); [I-draft: Red caída, consulta/replay exactos; borrador recuperado en otro contexto](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/draft.integration.ts#L4); [A-reload: Crear/editar, recarga misma sesión, commit/recibo perdido, texto posterior y purge por logout en otra pestaña](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L308).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 22:377 · Guardando
- Propietario: [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Mostrar operación en curso asociada a texto y revisión capturados.
- Datos: EditIntent y CAS/clave inmutables.
- Persistencia: Commit y recibo durables; texto posterior sigue pendiente.
- Error/recuperación: Resultado tardío conserva la edición más nueva.
- Código: [C-editor: Editor y estados clean/dirty/saving/saved/error/unknown/conflict](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L334); [C-save: Guardar revisión o copia con identidad/CAS/clave exactos](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L837); [C-write: Recibo, error, conflicto y conservación de texto posterior](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L906).
- Pruebas existentes (compartida): [U-new-edit: Guardado A no pisa edición B](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L402); [A-reload: Crear/editar, recarga misma sesión, commit/recibo perdido, texto posterior y purge por logout en otra pestaña](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L308); [P-edits: Revisión durable e historial/recibos exactos tras reinicio](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/tests/test_planning_edits.py#L152).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Prueba de carrera/operación existe; falta aserción visual aislada de «Guardando…» si se requiere acreditar cada estado visual.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 22:405 · Guardado
- Propietario: [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Presentar confirmación únicamente tras recibo válido.
- Datos: Revisión, operación, base y fuente exacta.
- Persistencia: PG; revisión y recibo inmutables.
- Error/recuperación: No confundir copia de trabajo o petición pendiente con guardado.
- Código: [C-editor: Editor y estados clean/dirty/saving/saved/error/unknown/conflict](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L334); [C-write: Recibo, error, conflicto y conservación de texto posterior](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L906).
- Pruebas existentes (directa): [B-result: Resultado, edición, guardado, recarga y original intacto](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L460); [I-create: Crear→editar→guardar→recarga sin localStorage; original e historial exactos](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.integration.ts#L8); [A-reload: Crear/editar, recarga misma sesión, commit/recibo perdido, texto posterior y purge por logout en otra pestaña](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L308); [P-edits: Revisión durable e historial/recibos exactos tras reinicio](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/tests/test_planning_edits.py#L152).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 22:444 · Error al guardar
- Propietario: [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Mantener buffer ante fallo definitivo y ofrecer reintento.
- Datos: Buffer original, intento y error controlado.
- Persistencia: No marca guardado; sólo se libera intento ante rechazo definitivo.
- Error/recuperación: Separar error definitivo de 503/respuesta perdida y de expiración.
- Código: [C-editor: Editor y estados clean/dirty/saving/saved/error/unknown/conflict](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L334); [C-write: Recibo, error, conflicto y conservación de texto posterior](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L906).
- Pruebas existentes (parcial): [U-save-error: 422 terminal del replay conserva buffer y deja estado error](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L519); [U-auth-uncertain: Incertidumbre de sesión 503/red preserva buffer suspendido hasta confirmar autoridad](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.test.ts#L373); [P-edits: Revisión durable e historial/recibos exactos tras reinicio](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/tests/test_planning_edits.py#L152).
- Pendiente funcional: La continuidad del buffer ante 401/reautenticación se aplaza fuera de fase 1 por decisión explícita en #15; se mantiene la purga y pueden perderse cambios no guardados.
- Pendiente de evidencia: Unidad cubre error terminal; no localicé prueba UI Acenta del botón «Reintentar guardado» hasta confirmación. flow.browser.ts es legado T3 y no se cuenta.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 22:468 · Guardado sin respuesta
- Propietario: [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Mostrar incertidumbre y comprobar recibo sin duplicar la escritura.
- Datos: Intento exacto más buffer posterior separado.
- Persistencia: Consulta recibo; 404 permite replay del mismo payload/clave, sin clave nueva.
- Error/recuperación: Estado pendiente si no puede resolverse; no polling eterno.
- Código: [C-editor: Editor y estados clean/dirty/saving/saved/error/unknown/conflict](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L334); [C-recover: Consulta y replay exacto acotados del intento](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L1067); [C-write: Recibo, error, conflicto y conservación de texto posterior](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L906).
- Pruebas existentes (directa): [B-lost: Recibo perdido y recuperación sin doble revisión](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L527); [U-save-lost: Recibo exacto sin nueva revisión](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L664); [I-copy: Dos pestañas, CAS409, copia con respuesta perdida, replay y dos versiones en biblioteca](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/copy.integration.ts#L4); [A-reload: Crear/editar, recarga misma sesión, commit/recibo perdido, texto posterior y purge por logout en otra pestaña](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L308).
- Pendiente funcional: Ante 401 ambiguo, el intento/buffer se purgan por la política aceptada para fase 1. Tras login se recupera sólo lo confirmado en biblioteca; continuidad no guardada aplazada en #15.
- Pendiente de evidencia: Hay evidencia real de commit con respuesta abortada y recarga; no acredita recuperación después de 401.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 22:494 · Conflicto de versión
- Propietario: [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Mostrar versión guardada y conservar texto divergente.
- Datos: Base local, revisión ganadora y texto no confirmado.
- Persistencia: CAS impide overwrite; copia sólo por acción explícita.
- Error/recuperación: Sin merge semántico automático.
- Código: [C-editor: Editor y estados clean/dirty/saving/saved/error/unknown/conflict](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L334); [C-save: Guardar revisión o copia con identidad/CAS/clave exactos](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L837); [C-write: Recibo, error, conflicto y conservación de texto posterior](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L906).
- Pruebas existentes (directa): [B-copy: Conflicto visible, dos textos y copia independiente](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L552); [U-copy: Conflicto conserva texto y copia desde base exacta](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L440); [I-copy: Dos pestañas, CAS409, copia con respuesta perdida, replay y dos versiones en biblioteca](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/copy.integration.ts#L4); [P-copy: Copia independiente idempotente y origen exacto](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/tests/test_planning_edits.py#L319).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Dos pestañas y PG están probados con actor de test; conflicto entre dos pestañas con sesión de producción no tiene caso específico localizado.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 22:586 · Salir sin guardar
- Propietario: [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Proteger cierre/panel/logout y conservar borrador confirmado antes de salir.
- Datos: Buffer, revisión base, draft y estado de salida.
- Persistencia: Borrador privado independiente en PG; logout sólo tras confirmación elegida.
- Error/recuperación: Seguir editando cancela salida; recibo tardío no dispara logout antiguo.
- Código: [C-exit: Protección de salida y borrador privado](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L297); [C-draft: Borrador privado con revisión propia, base y operación](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L872); [C-auth: Revocación/401/403 purgan estado privado y respaldo](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/auth.ts#L259).
- Pruebas existentes (directa): [B-draft: Salir conservando borrador y reabrir desde recursos](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L497); [I-draft: Red caída, consulta/replay exactos; borrador recuperado en otro contexto](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/draft.integration.ts#L4); [A-draft: Crear/editar, atrás, guardar borrador con respuesta perdida, logout y reapertura tras login](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L197).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 22:610 · Recuperar borrador
- Propietario: [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Recuperar draft servidor o proyección de editor en la misma sesión.
- Datos: DraftId/base/autor; o proyección sessionStorage y recovery_context.
- Persistencia: Draft durable sobrevive nuevo login; respaldo local sólo misma sesión/pestaña y 24h.
- Error/recuperación: Aislamiento y purga ante logout/otra cuenta; no prometer reauth de buffer sin commit.
- Código: [C-open-draft: Recuperación de borrador desde servidor](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L1102); [C-recovery: Proyección de editor en sessionStorage y misma sesión; TTL fijo 24 h](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/editor-recovery.ts#L58); [C-auth: Revocación/401/403 purgan estado privado y respaldo](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/auth.ts#L259).
- Pruebas existentes (directa): [I-draft: Red caída, consulta/replay exactos; borrador recuperado en otro contexto](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/draft.integration.ts#L4); [A-draft: Crear/editar, atrás, guardar borrador con respuesta perdida, logout y reapertura tras login](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L197); [A-reload: Crear/editar, recarga misma sesión, commit/recibo perdido, texto posterior y purge por logout en otra pestaña](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L308); [U-recovery: Respaldo mínimo, TTL fijo y base autenticada exacta](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/recovery-runtime.test.ts#L28); [U-recovery-purge: Purge por 401/context/logout informa posible commit sin retener clave](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/recovery-runtime.test.ts#L187); [P-draft: Borrador versionado sobre base antigua sin publicar](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/tests/test_planning_edits.py#L269).
- Pendiente funcional: Recuperar edición no confirmada después de 401/reautenticación queda aplazado explícitamente fuera de fase 1 en #15. La recuperación de trabajo confirmado desde biblioteca permanece disponible.
- Pendiente de evidencia: Nueva sesión con draft servidor sí está probada; no confundirla con restituir edición no guardada tras expiración.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 26:585 · Conflicto resuelto
- Propietario: [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Conservar copia independiente vinculada a la base original.
- Datos: Nuevo planningId, origin exacto y texto divergente.
- Persistencia: Copia idempotente en PG, revisión ganadora intacta.
- Error/recuperación: Replay no duplica; no implica fusionar textos.
- Código: [C-save: Guardar revisión o copia con identidad/CAS/clave exactos](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L837); [C-write: Recibo, error, conflicto y conservación de texto posterior](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L906); [C-library: Originales, copias, borradores, vacío y error reales](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L809).
- Pruebas existentes (directa): [B-copy: Conflicto visible, dos textos y copia independiente](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L552); [I-copy: Dos pestañas, CAS409, copia con respuesta perdida, replay y dos versiones en biblioteca](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/copy.integration.ts#L4); [P-copy: Copia independiente idempotente y origen exacto](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/tests/test_planning_edits.py#L319).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 20:535 · Adjuntar referencia
- Propietario: [#16](https://github.com/eliancanul/AulaLista-SaaS/issues/16); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Elegir sólo muestras incorporadas y conservar bytes fuente.
- Datos: SampleId, bytes UTF-8, digest, nombre, versión.
- Persistencia: Fuente/recibo PG al confirmar; no PDF real ni parser.
- Error/recuperación: Rechazar arbitrarios antes de retener/transmitir; cancelar no borra fuente.
- Código: [C-source: Selector de muestras y mensajes de error/espera](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L1031); [C-attach: Fixture permitido; recibo exacto, versión/CAS y selección tardía](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L517).
- Pruebas existentes (directa): [U-invalid-source: Rechaza bytes arbitrarios antes de retener/transmitir](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L146); [I-original: Bytes originales, reemplazo revisión/otra fuente, teclado y foco](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/original.integration.ts#L4); [A-catalog: Reautenticar y descubrir originales sin IDs locales, versiones, vacío y aislamiento](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L73); [P-source: Fuentes exactas e historial inmutable](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/tests/test_materials.py#L250).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 20:560 · Error al adjuntar
- Propietario: [#16](https://github.com/eliancanul/AulaLista-SaaS/issues/16); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Mostrar fallo sin perder selección o petición.
- Datos: Selección anterior, sourceIntent y error.
- Persistencia: No confirmar si recibo no validado.
- Error/recuperación: Pendiente incierto consulta mismo recibo; no cambia selección por respuesta tardía.
- Código: [C-source: Selector de muestras y mensajes de error/espera](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L1031); [C-attach: Fixture permitido; recibo exacto, versión/CAS y selección tardía](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L517).
- Pruebas existentes (compartida): [U-attach-error: Fallo de adjunto conserva selección válida y compositor](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L217); [B-source-lost: Adjunto incierto recuperable tras recarga del arnés](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L637); [B-cancel: Cancelar selector ignora selección tardía](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L603).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Fallo de selección conserva estado en unidad; navegador acredita incertidumbre/cancelación, no cada código de fallo aislado.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 20:582 · Petición preparada con adjunto
- Propietario: [#16](https://github.com/eliancanul/AulaLista-SaaS/issues/16); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Unir petición con fuente/version exacta antes del envío.
- Datos: Prompt y source receipt.
- Persistencia: Fuente durable, petición local hasta enviar.
- Error/recuperación: Quitar/reemplazar no envía ni retargetea operación ya capturada.
- Código: [C-source-line: Referencia exacta, visor, quitar y reemplazar](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L723); [C-submit: Captura prompt/fuente/contexto/clave de operación](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L649); [C-remove: Retira vínculo local, no borra fuente durable](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L500).
- Pruebas existentes (directa): [I-create: Crear→editar→guardar→recarga sin localStorage; original e historial exactos](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.integration.ts#L8); [A-draft: Crear/editar, atrás, guardar borrador con respuesta perdida, logout y reapertura tras login](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L197); [U-retarget: Quitar adjunto no redirige operación enviada](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L268).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 26:463 · Adjunto compacto
- Propietario: [#16](https://github.com/eliancanul/AulaLista-SaaS/issues/16); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Mantener referencia y acciones al reflow del compositor.
- Datos: Nombre, versión y bytes del source actual.
- Persistencia: Estado local apunta a fuente durable.
- Error/recuperación: Abrir visor no sustituye fuente ni pierde texto.
- Código: [C-source-line: Referencia exacta, visor, quitar y reemplazar](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L723); [C-original: Lectura exacta y estados del visor sin alterar selección](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L628).
- Pruebas existentes (compartida): [I-original: Bytes originales, reemplazo revisión/otra fuente, teclado y foco](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/original.integration.ts#L4); [B-tools-source: Herramientas con confirmación tardía de adjunto](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L395); [B-source-library: Catálogo original conserva petición, selección, contexto, foco e historial](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/source-library.browser.ts#L29).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Cobertura común de adjunto/reflow, sin comparación visual nodo a nodo.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 26:499 · Cambiar referencia
- Propietario: [#16](https://github.com/eliancanul/AulaLista-SaaS/issues/16); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Reemplazar por revisión de mismo archivo u otra muestra.
- Datos: Identidad fuente/familia, versión esperada y muestra.
- Persistencia: Misma fuente añade versión CAS; otra fuente recibe identidad propia.
- Error/recuperación: Reselección de muestra ya conocida no escribe; no cambia procedencia de resultados.
- Código: [C-source: Selector de muestras y mensajes de error/espera](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L1031); [C-attach: Fixture permitido; recibo exacto, versión/CAS y selección tardía](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L517).
- Pruebas existentes (directa): [U-replace: Otra fuente vs revisión CAS y reselección de sólo lectura](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/original.test.ts#L141); [I-original: Bytes originales, reemplazo revisión/otra fuente, teclado y foco](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/original.integration.ts#L4); [A-catalog: Reautenticar y descubrir originales sin IDs locales, versiones, vacío y aislamiento](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L73).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 26:524 · Error al reemplazar
- Propietario: [#16](https://github.com/eliancanul/AulaLista-SaaS/issues/16); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Mantener referencia válida y prompt si reemplazo falla.
- Datos: Fuente anterior, base CAS e intento exacto.
- Persistencia: No sobreescribe versión previa; incertidumbre conserva clave/base.
- Error/recuperación: 409 y errores conservan selección; cancelar ignora selección tardía.
- Código: [C-source: Selector de muestras y mensajes de error/espera](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L1031); [C-attach: Fixture permitido; recibo exacto, versión/CAS y selección tardía](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L517).
- Pruebas existentes (compartida): [U-replace-error: Conflicto al reemplazar mantiene selección/prompt](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/original.test.ts#L208); [B-cancel: Cancelar selector ignora selección tardía](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L603); [B-source-lost: Adjunto incierto recuperable tras recarga del arnés](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L637).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: CAS/error está probado en unidad; trayecto real exitoso de reemplazo sí cubierto, no todos los fallos por UI.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 22:522 · Mis recursos
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Listar originales, derivados, copias y borradores propios.
- Datos: Tres colecciones con cursores independientes.
- Persistencia: Consultas HTTP a PG, límite 50 por página.
- Error/recuperación: Carga/error/vacío distinguidos; no depende de IDs de navegador.
- Código: [C-library: Originales, copias, borradores, vacío y error reales](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L809); [C-list: Tres listas acotadas; originales/copia/borrador](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L1155).
- Pruebas existentes (directa): [I-navigation: 51 objetos, vacío, atrás/adelante, editor pendiente, foco/scroll y reflow320](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/navigation.integration.ts#L4); [A-catalog: Reautenticar y descubrir originales sin IDs locales, versiones, vacío y aislamiento](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L73); [I-draft: Red caída, consulta/replay exactos; borrador recuperado en otro contexto](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/draft.integration.ts#L4); [I-copy: Dos pestañas, CAS409, copia con respuesta perdida, replay y dos versiones en biblioteca](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/copy.integration.ts#L4).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 22:547 · Reabrir recurso
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Recuperar contenido y contexto exactos sin generar ni adjuntar automáticamente.
- Datos: PlanningId/revisión/fuente y resultado histórico.
- Persistencia: Lectura servidor; localStorage puede estar vacío.
- Error/recuperación: Objeto ajeno/no existente no devuelve datos; editor sucio no se sustituye.
- Código: [C-reopen: Reapertura vía HTTP sin generar](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L1076); [C-result: Resultado según documento durable y fuente exacta](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L174); [C-library: Originales, copias, borradores, vacío y error reales](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L809).
- Pruebas existentes (directa): [I-create: Crear→editar→guardar→recarga sin localStorage; original e historial exactos](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.integration.ts#L8); [I-copy: Dos pestañas, CAS409, copia con respuesta perdida, replay y dos versiones en biblioteca](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/copy.integration.ts#L4); [A-draft: Crear/editar, atrás, guardar borrador con respuesta perdida, logout y reapertura tras login](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L197); [U-history: Historial conserva editor sucio e impide abrir otro objeto](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/library-navigation.test.ts#L43).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 22:635 · Sin resultados
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Mostrar vacío sólo después de lista confirmada vacía.
- Datos: Colecciones de la cuenta actual.
- Persistencia: Lectura real, sin objetos de relleno.
- Error/recuperación: Fallo/401/404/503 no se convierten en vacío.
- Código: [C-library: Originales, copias, borradores, vacío y error reales](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L809); [C-list: Tres listas acotadas; originales/copia/borrador](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L1155); [C-auth: Revocación/401/403 purgan estado privado y respaldo](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/auth.ts#L259).
- Pruebas existentes (directa): [I-navigation: 51 objetos, vacío, atrás/adelante, editor pendiente, foco/scroll y reflow320](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/navigation.integration.ts#L4); [A-catalog: Reautenticar y descubrir originales sin IDs locales, versiones, vacío y aislamiento](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L73); [B-list-error: Error de biblioteca separado de vacío y retry](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L743).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 26:554 · Recursos con petición conservada
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Entrar/salir de biblioteca preservando petición y referencia.
- Datos: Prompt y selección para próximo envío; destino histórico.
- Persistencia: Navegación local; consulta lista acotada.
- Error/recuperación: Respuesta tardía no redirige vista ni compositor.
- Código: [C-nav: Navegación conserva compositor/editor y descarta lecturas antiguas](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L479); [C-history: Historial con referencias opacas y aislamiento de sesión](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/navigation.ts#L36); [C-list: Tres listas acotadas; originales/copia/borrador](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L1155).
- Pruebas existentes (directa): [A-catalog: Reautenticar y descubrir originales sin IDs locales, versiones, vacío y aislamiento](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/auth.integration.ts#L73); [B-source-library: Catálogo original conserva petición, selección, contexto, foco e historial](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/source-library.browser.ts#L29); [B-late: Respuesta tardía no pisa entrada; biblioteca después de perder backup](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L682).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 26:624 · Alternativas conservadas
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Mostrar/reabrir copia divergente y revisión vigente sin confundir origen.
- Datos: Identidades distintas y origin/base verificables.
- Persistencia: Ambas versiones durables y listables.
- Error/recuperación: Reintento no duplica copia; original no cambia.
- Código: [C-library: Originales, copias, borradores, vacío y error reales](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L809); [C-reopen: Reapertura vía HTTP sin generar](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L1076); [C-save: Guardar revisión o copia con identidad/CAS/clave exactos](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L837).
- Pruebas existentes (directa): [I-copy: Dos pestañas, CAS409, copia con respuesta perdida, replay y dos versiones en biblioteca](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/copy.integration.ts#L4); [P-copy: Copia independiente idempotente y origen exacto](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/tests/test_planning_edits.py#L319); [B-copy: Conflicto visible, dos textos y copia independiente](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L552).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 20:459 · Elegir contexto
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Abrir/cerrar selector del contexto fixture disponible.
- Datos: Un contexto reconocido.
- Persistencia: Sólo overlay local; no endpoint nuevo.
- Error/recuperación: No da apariencia de clases dinámicas.
- Código: [C-context: Selector local del único contexto fixture; no CRUD de clase](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L1013); [C-dialog: Modal, Escape, foco e inercia](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L47); [C-submit: Captura prompt/fuente/contexto/clave de operación](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L649).
- Pruebas existentes (compartida): [B-home: Geometría, compositor, sidebar, modal, teclado y foco](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L188); [U-submit: Adjunto fixture y doble envío bloqueado en vuelo](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L318).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: No localicé interacción específica del diálogo Contexto de clase. Añadir cobertura local reutilizable, sin CRUD ni nuevas opciones.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 26:329 · Contexto elegido (variante)
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Volver al compositor conservando contexto del ejemplo.
- Datos: waterContext y prompt.
- Persistencia: Local; captura al enviar.
- Error/recuperación: No reetiquetar un resultado ya confirmado.
- Código: [C-context: Selector local del único contexto fixture; no CRUD de clase](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L1013); [C-home: Inicio y compositor reales](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L656); [C-result: Resultado según documento durable y fuente exacta](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L174).
- Pruebas existentes (compartida): [I-create: Crear→editar→guardar→recarga sin localStorage; original e historial exactos](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.integration.ts#L8); [B-source-library: Catálogo original conserva petición, selección, contexto, foco e historial](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/source-library.browser.ts#L29).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Caso de menú de contexto inferido de componente compartido; no aserción específica de abrir/cerrar esta variante.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 26:355 · Contexto con borrador de petición
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Consultar contexto sin descartar lo escrito.
- Datos: Prompt local del compositor, no draft servidor.
- Persistencia: No escribe.
- Error/recuperación: Cancelar conserva texto; contexto fijo.
- Código: [C-context: Selector local del único contexto fixture; no CRUD de clase](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L1013); [C-set: Texto local acotado; avance de generación de navegación](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L456).
- Pruebas existentes (compartida): [B-home: Geometría, compositor, sidebar, modal, teclado y foco](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L188); [B-tools: Catálogo y foco en varios tamaños; sin peticiones de generador](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L284).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Tests preservan compositor en modales/herramientas; falta caso dedicado del diálogo contexto con texto.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 26:381 · Contexto con adjunto
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Consultar contexto conservando referencia elegida.
- Datos: Prompt y source/version.
- Persistencia: Overlay local; fuente ya durable.
- Error/recuperación: No adjuntar/cambiar por abrir contexto.
- Código: [C-context: Selector local del único contexto fixture; no CRUD de clase](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L1013); [C-source-line: Referencia exacta, visor, quitar y reemplazar](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L723).
- Pruebas existentes (compartida): [B-source-library: Catálogo original conserva petición, selección, contexto, foco e historial](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/source-library.browser.ts#L29); [U-retarget: Quitar adjunto no redirige operación enviada](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L268).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Sin caso dedicado del diálogo contexto con referencia; componente y conservación de selección probados por otras rutas.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 26:407 · Contexto durante envío
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: No retargetear payload ya enviado al consultar contexto.
- Datos: CreateIntent congelado; selección siguiente separada.
- Persistencia: La operación durable mantiene versión/contexto capturados.
- Error/recuperación: Respuesta tardía no pisa prompt/contexto nuevos.
- Código: [C-context: Selector local del único contexto fixture; no CRUD de clase](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L1013); [C-submit: Captura prompt/fuente/contexto/clave de operación](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L649); [C-create: Respuesta tardía e idempotencia de generación fixture](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L681).
- Pruebas existentes (compartida): [U-late: Texto nuevo no sustituido por respuesta antigua](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L227); [U-retarget: Quitar adjunto no redirige operación enviada](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.test.ts#L268); [B-late: Respuesta tardía no pisa entrada; biblioteca después de perder backup](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L682).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Operación capturada cubierta; falta comprobación del overlay contexto abierto mientras envío está pendiente.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 35:1263 · Menú en inicio
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Expandir/contraer sidebar y navegar sólo acciones disponibles.
- Datos: Estado expanded y destino.
- Persistencia: Local; recursos consultan sólo al abrir.
- Error/recuperación: Funciones futuras deshabilitadas.
- Código: [C-menu: Sidebar local y acciones futuras deshabilitadas](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L602); [C-nav: Navegación conserva compositor/editor y descarta lecturas antiguas](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L479).
- Pruebas existentes (directa): [B-home: Geometría, compositor, sidebar, modal, teclado y foco](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L188); [I-navigation: 51 objetos, vacío, atrás/adelante, editor pendiente, foco/scroll y reflow320](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/navigation.integration.ts#L4).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 35:1438 · Menú con borrador de petición
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Expandir/contraer sin perder texto del compositor.
- Datos: Prompt local.
- Persistencia: No escribe por expandir.
- Error/recuperación: Mantener texto y foco razonables.
- Código: [C-menu: Sidebar local y acciones futuras deshabilitadas](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L602); [C-set: Texto local acotado; avance de generación de navegación](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L456).
- Pruebas existentes (directa): [B-home: Geometría, compositor, sidebar, modal, teclado y foco](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L188).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 35:1615 · Menú con adjunto
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Expandir/contraer manteniendo referencia preparada.
- Datos: Prompt + source/version.
- Persistencia: No cambia fuente durable.
- Error/recuperación: No enviar ni reemplazar por abrir menú.
- Código: [C-menu: Sidebar local y acciones futuras deshabilitadas](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L602); [C-source-line: Referencia exacta, visor, quitar y reemplazar](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L723); [C-nav: Navegación conserva compositor/editor y descarta lecturas antiguas](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L479).
- Pruebas existentes (compartida): [B-home: Geometría, compositor, sidebar, modal, teclado y foco](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L188); [B-source-library: Catálogo original conserva petición, selección, contexto, foco e historial](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/source-library.browser.ts#L29).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: No localicé aserción específica sidebar expandido + adjunto; evidencia compartida de menú y conservación de referencia.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 35:1363 · Herramientas en inicio
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Abrir categorías y mostrar catálogo futuro honestamente.
- Datos: Categoría local, 13 entradas actuales.
- Persistencia: No generadores ni endpoints adicionales.
- Error/recuperación: Opciones no disponibles son texto; sólo acciones existentes enlazadas.
- Código: [C-tools: Categorías locales, catálogo futuro explícito](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L1082); [C-dialog: Modal, Escape, foco e inercia](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L47).
- Pruebas existentes (directa): [B-tools: Catálogo y foco en varios tamaños; sin peticiones de generador](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L284).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 35:1540 · Herramientas con borrador de petición
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Abrir/cambiar/cerrar catálogo sin perder petición.
- Datos: Prompt local y categoría.
- Persistencia: No escribe ni envía.
- Error/recuperación: Escape y cierre devuelven foco; reflow conserva input.
- Código: [C-tools: Categorías locales, catálogo futuro explícito](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L1082); [C-set: Texto local acotado; avance de generación de navegación](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/controller.ts#L456).
- Pruebas existentes (directa): [B-tools: Catálogo y foco en varios tamaños; sin peticiones de generador](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L284); [B-home: Geometría, compositor, sidebar, modal, teclado y foco](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L188).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Conciliar esta evidencia con la aceptación global de #12; sin exigir un endpoint o prueba exclusiva por pantalla.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## 35:1721 · Herramientas con adjunto (función inferida de la matriz)
- Propietario: [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17); autenticación transversal: [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13).
- Función: Usar mismo catálogo con referencia ya preparada.
- Datos: Prompt, source/version y posición del disparador.
- Persistencia: No escribe por abrir herramientas.
- Error/recuperación: Confirmación tardía del adjunto recoloca menú sin perder referencia.
- Código: [C-tools: Categorías locales, catálogo futuro explícito](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L1082); [C-source-line: Referencia exacta, visor, quitar y reemplazar](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/src/acenta/App.tsx#L723).
- Pruebas existentes (compartida): [B-tools-source: Herramientas con confirmación tardía de adjunto](https://github.com/eliancanul/AulaLista-SaaS/blob/1f9e7c23db7564049b68904db62f98b5730ee0b6/web/tests/acenta.browser.ts#L395).
- Pendiente funcional: No se detectó una función ausente dentro del alcance fixture; esto no certifica cada variante visual.
- Pendiente de evidencia: Figma vivo confirmó 37 frames en página 04 y la ausencia de este ID el 17 de octubre de 2026, según #12. Se conserva como asignación funcional inferida de herramientas con adjunto; no se afirma nombre de frame ni aceptación visual individual.
- SHA de toda la evidencia de código/pruebas: `1f9e7c23db7564049b68904db62f98b5730ee0b6`.

## Límites
- 38 asignaciones no equivalen a 38 estados aceptados ni a 38 endpoints.
- Unit/mock y browser/FixtureServer no prueban PostgreSQL por sí solos.
- Los 5 recorridos HTTP/PG usan actor exclusivamente de test; 4 escenarios auth usan entrada de producción y sesiones reales, con transporte de email sustituido.
- OTP de runtime sigue pospuesto; su uso sintético en tests no revoca esa decisión.
- La auditoría inicial no inspeccionó Figma vivo. La conciliación posterior verificó el inventario de 37 frames y la ausencia de 35:1721; no ejecutó aceptación visual/manual de los 38 estados.
- La cobertura se refiere al commit fijado, no a cambios posteriores ni a entorno desplegado.
- La revisión adversarial histórica de PRs no sustituye revisión de cambios futuros.
