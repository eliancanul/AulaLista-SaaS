# Acenta: recorrido conectado B1–B5

El [registro del 17 de octubre de 2026](../README.md#acenta-capacidades-verificadas-y-límites)
enlaza los incrementos integrados. La [matriz #12](../docs/reviews/0001-matriz-fase1.md)
distingue 38 asignaciones contractuales de la aceptación visual pendiente;
no declara completada la fase 1. El estado del trabajo se mantiene en Issues.

React + TypeScript + Vite. La entrada real recupera la sesión mediante
`GET /auth/session` antes de abrir un espacio privado. El acceso implementa
Google Identity Services directo (cliente y nonce de bootstrap) y códigos de
un uso por correo. [Contrato B1](../docs/specs/0005-autenticacion-local.md).

El repositorio no incorpora cuentas, credenciales ni proveedor de correo.
Google tiene [aceptación manual registrada](https://github.com/eliancanul/AulaLista-SaaS/issues/13#issuecomment-6231320343)
sobre el servicio de pruebas en `355399b6f01ea6985ebdb8389691fc532c993e5f`;
no es certificación de este árbol ni de un despliegue posterior. OTP real fue
pospuesto por el usuario y sigue deshabilitado. Sin configuración, la interfaz informa indisponibilidad;
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
el trabajo pendiente en memoria y el respaldo de edición acotado, si pudo escribirse. La interfaz advierte que no se recargue y
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

La ejecución nativa histórica de 2026-10-16 verificó unitarias y build, pero
Chromium abortó por restricción de socket Unix antes de ejecutar los recorridos.
La [CI web posterior de main](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/39058555523),
en `1f9e7c23db7564049b68904db62f98b5730ee0b6`, sí ejecutó 275 unitarias totales,
33 recorridos de navegador, cinco wrappers HTTP/PostgreSQL y el wrapper auth de
cuatro escenarios. Los totales incluyen pruebas legacy; no equivalen a un test
por estado ni a 38 estados visuales aceptados. La matriz enlazada arriba conserva
los huecos de evidencia; la actualización documental no ejecutó suites nuevas.
Cada nuevo candidato requiere sus propios gates. Capturas previstas: acceso 1440×960, inicio y editor 1440×924,
editor móvil 390×844. Cada test espera `document.fonts.ready` cuando compara la
vista de referencia. Revisar también teclado, foco modal, Escape e inercia del
fondo; la captura por sí sola no demuestra esos comportamientos.

## Componentes y contratos

El [incremento de apartados #53](../docs/specs/0012-apartados-analiticos.md)
añade DTO, validación de recibos, transporte scoped y prellenado determinista en
`analytic-sections.ts` y `api.ts`. La procedencia `analytic_origin` fija el
apartado y revisión elegidos y se conserva al leer ediciones, copias y borradores.
Los pares contenido/PDA permanecen manuales, separados de objetivos.
La UI de este recorrido sigue pendiente: no hay todavía nueva entrada visible,
guardia de interrupción ni aceptación visual del apartado. Las regresiones del
recorrido existente no acreditan esos estados pendientes.

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

### Originales en Mis recursos (#36)

La biblioteca consulta fuentes confirmadas aunque no exista una planeación o un
borrador. `GET /scopes/{scope_id}/sources?after={source_uuid}&limit=50` devuelve
`{items: SourceReceipt[], next_cursor: UUID | null}` sin bytes, nombre de archivo
ni MIME. El orden técnico es UUID de fuente ascendente; el cursor es la última
fuente de la página, debe existir en ese ámbito y el límite de lectura admite
1–100 (50 por defecto). No es una cuota de archivos ni un snapshot entre páginas:
nuevas inserciones anteriores al cursor se descubren al actualizar desde el inicio.
Cursores inválidos, inexistentes o ajenos dan 422 `invalid_request`; ámbito ajeno
404 y sesión inválida 401. Las lecturas usan sesión real y `no-store`.

Cada tarjeta fija fuente, número de versión, tamaño, SHA-256 y fecha del recibo.
Una revisión posterior no cambia esa referencia; `Actualizar listado` ofrece la
versión actual. Confirmar una fuente nueva invalida el listado anterior para que
una visita vacía no la oculte. Los originales no se cuentan como copias/planeaciones
y permanecen visibles durante actualización o error. Abrirlos reutiliza la lectura
verificada y no modifica petición, referencia del próximo envío ni edición local.

Sólo los hashes exactos de las tres muestras incorporadas permiten mostrar sus
nombres de ejemplo. Una fuente desconocida dice `Recurso original`, también en el
visor; no se inventa filename, PDF ni procedencia sintética. Decodificación o
integridad no admitidas muestran un estado seguro, sin preview sustitutivo.

`tests/source-library.test.ts` cubre contrato, paginación, errores, versiones y
respuestas tardías. `tests/source-library.browser.ts` cubre catálogo, foco, regreso,
reflow y visor. `tests/auth.integration.ts`, ejecutado por el harness auth existente,
añade la entrada real: confirmar sin generar, vaciar almacenamiento y cookies,
autenticar otra sesión en un contexto nuevo, descubrir, leer todos los bytes y
comparar tamaño/hash, conservar V1 frente a V2 y aislar la cuenta B. Espera el
cooldown real de correo, sin cambiar reloj ni política de autenticación. Este
recorrido requiere Chromium. Su ejecución en el SHA documentado consta en la CI
enlazada arriba; ni los archivos de test ni esa CI acreditan candidatos posteriores.

### Cierre voluntario con edición pendiente (#15, corte parcial)

Desde el espacio de trabajo con sesión confirmada, `Cerrar sesión` reutiliza la
guardia del editor cuando existe una edición sin confirmar, incluso si quedó
oculta al navegar. `Seguir editando` y Escape cancelan
la intención de salir. `Conservar borrador y salir` espera un recibo válido del
borrador privado, ligado al recurso, base y texto de esa generación, antes de
invocar logout. La revisión confirmada y su fuente permanecen intactas. No basta
que termine una promesa: una operación aún incierta, un controller cerrado o una
edición posterior impiden salir. Cambiar de workspace/desmontar la vista invalida
el callback anterior, que nunca puede cerrar la sesión nueva.

Una respuesta perdida se comprueba con la misma clave y, ante recibo 404, se
repite el intento exacto. Doble clic no duplica borradores ni logout. Si ya había
un edit/copy pendiente se resuelve primero, sin convertirlo silenciosamente en
un borrador; un clic explícito posterior conserva el borrador. Comprobar un
borrador confirmado no crea otra revisión al salir. Ante red/503/error, mientras
la sesión siga válida, la guardia permanece y conserva el texto. Si logout falla
después de confirmar el borrador, se mantiene el flujo de reintento de cierre
existente; el borrador ya confirmado se recupera desde Mis recursos.

Esta guardia protege sólo el editor dentro del espacio con sesión confirmada.
En la pantalla de suspensión por no poder revalidar la sesión, `Cerrar sesión`
conserva la purga inmediata y el reintento de logout existentes; no intenta
confirmar un borrador sin autoridad comprobada. No guarda automáticamente la
petición ni un adjunto pendiente y no cambia su tratamiento. 401/403, caducidad, revocación y
cambio de sesión/CSRF mantienen la purga actual. El usuario aceptó para fase 1
esta [limitación de recuperación](../docs/specs/0003-edicion-durable.md#decisión-de-fase-1-recuperación-tras-sesión-inválida):
tras login sólo se recupera lo confirmado en biblioteca; pueden perderse cambios
nunca guardados. La continuidad del texto no confirmado tras 401 se aplaza como
mejora posterior en #15, sin implementación nueva. La recarga de la misma pestaña/sesión ahora admite
el respaldo B3 mínimo descrito abajo; no garantiza recuperación al cerrar el navegador. #15 y
#13 siguen abiertos; esto no habilita el proveedor de correo ni autentica con un
servicio externo real.

`tests/editor-exit.test.ts` y `tests/auth.test.ts` verifican el gate y sus carreras.
`tests/auth.integration.ts` usa la entrada de producción, OTP/cookies/CSRF reales
y PostgreSQL, sustituye sólo el transporte de correo existente y pierde una
respuesta de borrador después de su commit real. Comprueba guardia/cancelación,
recibo previo a logout, reapertura en otra sesión sin storage, fuente/base exactas
y 404 de la cuenta B. El presupuesto del runner admite los cooldowns reales de
correo; no se relaja la política auth. La recogida local de estos tests no
acreditaba su ejecución; la CI del SHA documentado sí los ejecutó. Un nuevo
candidato requiere CI exacta, sin trasladar ese éxito por inferencia.

### Operaciones y trabajo pendiente

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
  incierta con la misma clave mientras el controller sigue vivo. El harness con
  respaldo también prueba recarga; runtime no conserva ese intento al recargar. Elegir de nuevo la referencia ya
  adjunta no crea otra fuente; quitarla no borra bytes confirmados del servidor.
- Cancelar el selector impide aplicar la selección tardía, sin asumir que la
  escritura se canceló. Un prompt o referencia nuevos invalidan el salto visual
  de un resultado anterior; éste sigue disponible en la biblioteca. Esa separación
  también se prueba en el harness con respaldo tras una recarga con operación
  pendiente; esa persistencia no está habilitada en runtime.
- Guardar confirma sólo el texto de esa generación; una edición posterior queda
  pendiente. Deshacer afecta únicamente al buffer y se bloquea con write incierto.
- Conflicto muestra la revisión vigente y conserva el texto local. Conservar
  copia crea otro objeto desde la base exacta, sin merge ni modificación del original.
- Conservar borrador confirma otro recibo/namespace; no anuncia una revisión
  guardada. El cierre con cambios requiere continuar o conservar ese borrador.
- El respaldo local exclusivo del harness usa cuenta/ámbito y UUID de workspace. El bootstrap debe
  conservar esa UUID al recargar la misma pestaña y usar otra para otro workspace;
  el harness lo hace con sessionStorage. No hay índice global de borradores locales
  ni garantía de recuperarlos al borrar storage/cerrar todas las pestañas. El
  borrador confirmado de servidor sí se reabre desde la biblioteca.
- Cuota o respaldo corrupto se informa; el contenido corrupto no se reemplaza.
  Compositor y editor rechazan entradas que superan 256/1000 caracteres antes de
  reemplazar su texto anterior o persistirlas. La restauración valida el indicador
  de borrador confirmado y su revisión; un valor corrupto no autoriza descartarlo.
  El cambio/cierre de sesión elimina el estado privado visible y descarta callbacks
  tardíos; también purga el respaldo si un harness lo configuró. El formato legacy
  nunca se conecta al runtime; éste usa el envelope mínimo descrito abajo.
- Las 13 entradas del catálogo se identifican como herramientas futuras;
  Secuencia didáctica se incluye dentro de Planeación de clase. Búsqueda,
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


## Respaldo temporal de edición B3 (#15, corte parcial)

Un único slot `acenta:editor-recovery:v1` de `sessionStorage`, máximo 16 KiB,
con texto editado (hasta 1000 puntos de código), referencia a la revisión base exacta,
identidad de sesión/workspace y el intent pendiente exacto, si existe. No incluye
prompt, fuentes, resultados, catálogos, selección, email ni credenciales. Si se escribe
texto posterior a un envío, conserva ambos textos con sus generaciones. El codec
rechaza propiedades extra, Unicode inválido, CAS o generaciones incoherentes.
No conecta `BackupStore` legacy. Un navegador sin contexto nuevo/null no recupera.

`auth_session.recovery_context_id` es UUID nullable no secreto, generado una vez por
login con la INSERT existente. Se devuelve desde la fila ya autorizada en login y
GET de sesión. No autoriza, no cifra, no crea endpoint, índice, lookup ni grant de UPDATE.
Migración `0006_editor_recovery`: sin backfill ni servicio contratado. Sesiones
anteriores null siguen funcionando. Cliente nuevo acepta campo ausente; cliente
anterior ignora el campo aditivo. Readiness exige revisión exacta: rollback de binario
0005 necesita downgrade coordinado, sólo probado en DB desechable; se pierde únicamente
el discriminante y no se purgan bytes de navegadores por una migración DB.

La vista privada está cerrada hasta validar sesión. Rehidrata base por ID/revisión,
verifica revision_id y elemento editable, lee latest y, si no hay pending durable,
reconcilia draftId para advertir un posible residuo ya guardado. No hay mutación
automática ni nueva key para sustituir una operación perdida. «Comprobar estado»
conserva namespace, key, clase, destino, payload, draftId y CAS; 404 sólo permite
replay idéntico. Recibo previo no sustituye texto posterior ni borra su respaldo.

Hidden/pagehide/freeze cierran el gate e invalidan callbacks y checks en vuelo.
Visible/pageshow/resume/focus revalidan y deduplican checks en vuelo; una respuesta
o finally anterior no reabre ni desbloquea una comprobación nueva. El sondeo periódico
visible es observacional: con el mismo contexto no desmonta el editor, pierde foco
ni invalida un guardado en vuelo; ante fallo, caducidad o contexto distinto sí cierra
el gate. No se garantiza
revocación instantánea de otras pestañas visibles, snapshots del navegador/SO ni
borrado físico de otra pestaña. Dos clones mantienen el pending exacto; CAS servidor
protege divergencias posteriores. No hay índice multicuentas ni sincronización nueva.

TTL fijo de hasta 24 h desde el episodio, sin extensión al editar o recargar.
La misma sesión debe seguir vigente (absoluta 24 h, idle 2 h); no hay recuperación
tras 401/403, logout, cambio de contexto/cuenta o nuevo login. Esto limita admisión
de recuperación, no conservación por 24 h ni borrado físico puntual: navegador
cerrado/congelado no ejecuta limpieza. Se reintenta al siguiente acceso aplicable.
Los datos quedan en claro: el perfil del navegador o JavaScript del mismo origen
puede leerlos. UUID no es cifrado, ACL ni protección contra ese adversario.

Cuota/lectura/limpieza fallidas son visibles. El intento local se escribe antes
de enviar; si falla, memoria y guardado servidor pueden continuar, sin afirmar
cobertura de recarga y sin bucle de retry por tecla. Si remove falla se intenta
un tombstone constante sin contenido; no demuestra borrado físico. Si también
falla, puede quedar un snapshot anterior sin key durable: en próxima recuperación
se reconcilia el estado guardado, nunca se fabrica un retry. Logout no confirmado
más remove/set fallidos tiene un límite inevitable: tras recarga la sesión aún
viva podría admitir aquel respaldo, porque no quedó evidencia durable del cierre.
La UI anuncia cierre/limpieza sin confirmar y recomienda limpiar datos del sitio
si el navegador es compartido. No se promete resolver ese contraejemplo.

Costo marginal observado en el diseño/código, sin benchmark ni factura:
- Tecla: 0 HTTP, 0 writes DB; serialización y escritura local acotada.
- Login: misma INSERT de sesión con 16 bytes UUID de valor más overhead DB.
- GET auth existente: mismo acceso autorizado, campo JSON aditivo; no renueva idle.
- Activación: hasta 1 GET auth por comprobación en vuelo deduplicada; eventos posteriores
  pueden volver a comprobar. No se añade polling al minuto existente.
- Recarga con respaldo: 2 GET privados (base y latest), más 1 GET draft si no hay pending.
  Estas lecturas privadas sí pueden escribir idle_expires_at; no se afirma cero DB total.
- Comprobar pendiente: 1 GET recibo y, sólo ante404, el write B3 existente idéntico.
- Guardado/logout: limpieza local best effort; mutaciones servidor preexistentes.

Unitarias públicas cubren parser/TTL/sesión/operaciones/races/storage y contraejemplo
de logout fallido. Pruebas PostgreSQL cubren migración, legacy, estabilidad/autoridad
y grants; E2E auth añade recarga, respuesta perdida, texto posterior y lifecycle.
Recogida/build locales no acreditan PostgreSQL o navegador real. Esos gates deben
pasar en CI del commit exacto junto con guardia de logout y catálogo de originales.
Auth E2E mantiene screenshot, trace y video desactivados. #15 continúa abierto.

## Planeación guiada (#52)

`Crear planeación` y `Herramientas → Planear → Planeación de clase` abren el
formulario compacto. Asignatura, grado y tema son obligatorios; duración editable
parte de 50 minutos. Contexto y opciones agrupa método, idioma, texto manual
con condición hipotética explícita, objetivos propios, campo/ejes manuales y una
referencia guardada opcional. No se rellenan PDA ni supuestos de grupo.

La fixture de software sólo admite Ciencias naturales / 3.º de primaria /
El cuidado del agua en la comunidad / active-learning / es. No usa IA, servicios
externos ni un corpus de investigación. El resto recibe `unsupported_fixture`
sin borrar los valores. El contexto se conserva literalmente, sin afirmar que
el resultado se adapte a él. No hay selector de currículo oficial ni carga de
documentos reales. Una referencia T2 conserva ID, versión y hash exactos.

El DTO de creación es v2 en `/scopes/{scope_id}/guided-plannings`, con clave de
idempotencia y límite 4096 bytes. Los resultados se guardan antes de mostrar
confirmación, con recibos scoped y campos source nulos cuando no hay fuente.
Una respuesta incierta bloquea otra creación hasta consultar el recibo o
repetir el intento exacto. B2 permanece en su endpoint y DTO v1.

`GuidedPlanning.tsx` implementa la lectura primero: modal desktop y composición
móvil completa con cabecera propia, documento desplazable, acciones inferiores
y hoja de secciones. `Editar` es opcional. El editor B3 corrige un campo a la vez
(propósito, actividad, tiempo, material o evaluación) sin duplicar texto en el
resultado. Guardar/deshacer libera el selector; las guardias, CAS, borradores,
copias e idempotencia siguen vigentes. Los tiempos son enteros 1–180 por fase;
el total se recalcula sin alterar la duración solicitada original.

Después de 401/reautenticación sólo se reabre lo confirmado en Mis recursos.
No se promete conservar formulario ni texto pendiente después de perder sesión.
`guided-api.test.ts`, `guided-controller.test.ts`, `guided.browser.ts` y
`guided.integration.ts` cubren contrato, recuperación y recorrido HTTP/PostgreSQL.
El nuevo caso de `auth.integration.ts` usa login/cookies/CSRF reales y sólo
sustituye el transporte del correo de prueba, como el harness existente.

Los assets proceden de los nodos Figma aprobados; [ASSETS.md](public/acenta/ASSETS.md)
registra cada exportación. Las capturas de pruebas son evidencia técnica del
candidato, no nueva aprobación de diseño ni aceptación docente.

## Formulario de Programa analítico (#53, corte parcial)

La pestaña `Programa analítico` dentro de Planeación abre el formulario de
escritorio C inspeccionado. Guarda un apartado manual y permite editarlo en la
misma pantalla, con confirmación de revisión, validación de campos y tamaño,
pares contenido/PDA separados y contexto hipotético explícito. Reutiliza
controles y estilos guiados; su buffer y operación pertenecen a un controlador
independiente. No genera texto ni acredita alineación curricular oficial.

Navegar a otra vista conserva ese buffer. La guardia de cierre de sesión y la
advertencia de recarga protegen cambios pendientes; este formulario no añade
respaldo del navegador. `Comprobar guardado` recupera una operación incierta sin
cambiar su clave ni datos. Un conflicto mantiene el texto hasta que se descarte
explícitamente para cargar la revisión vigente. Cancelar la salida invalida su
continuación aunque el guardado termine después.

Quedan pendientes el explorador para reabrir otros apartados, lector de guardado,
derivación visual y diseño móvil A. El reflow de estos controles no certifica esa
composición móvil. Las pruebas `analytic-form.test.ts`,
`analytic-controller.test.ts` y `analytic.browser.ts` cubren este corte;
`analytic.integration.ts` conserva la evidencia HTTP/PostgreSQL del contrato.
El [contrato 0012](../docs/specs/0012-apartados-analiticos.md) delimita los estados
y límites. No se cierra #53 con este formulario parcial.
