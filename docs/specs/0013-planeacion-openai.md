# Especificación 0013: Planeación manual con OpenAI

Preparación offline iniciada sobre `e48b3ba52023bc1afdfb97c53a307fc3403cdc4f` el
18 de octubre de 2026, reconciliada con `50dadcccc7b26b8431bec1128d9c2d2e77b7516a`
el 19 de octubre. Implementación autorizada en rama aislada; sin activación,
llamadas reales, integración en main ni despliegue. Seguimiento autorizado:
[issue #62](https://github.com/eliancanul/AulaLista-SaaS/issues/62), ligado a la
[PR #60](https://github.com/eliancanul/AulaLista-SaaS/pull/60). Regulariza la
trazabilidad de esta preparación offline, sin autorizar activación.

Ampliación offline de admisión en [#67](https://github.com/eliancanul/AulaLista-SaaS/issues/67),
sobre main `51b7d37f263805a55493a073b20d99e5346133dd`: política manual variable
versionada, distinta del ensayo de entradas exactas. #60 ya está integrado;
esta ampliación no activa su transporte ni autoriza credenciales, gasto o despliegue.

## Contrato

La creación v3 conserva los campos manuales de v2 y elimina `fixture_context`.
`POST /scopes/{scope}/generated-plannings` crea una planeación nueva; v1/v2
conservan su significado. Una referencia opcional identifica una versión propia
exacta, sin enviar sus bytes ni sus identificadores al proveedor. No interpreta
archivos ni implementa las secciones analíticas de la PR #57.

La salida conserva el lector y la edición B3 de `guided-planning-v1`, con
procedencia `openai-guided-v1` y aviso impuesto por el servidor. El proveedor no
elige autoridad, procedencia, destinatario ni herramientas. Pydantic comprueba
campos, tipos, texto útil, tres etapas ordenadas y suma exacta de la duración
solicitada; no repara ni acepta salida parcial. Esa validación no acredita
calidad pedagógica, verdad curricular o evaluación con datos reales. Los campos
editables de propósito, evaluación y actividades se limitan a 1000 caracteres,
tanto en el esquema enviado como en la validación, para conservar edición B3.
Una salida que excede ese límite falla sin publicar resultado, conserva reserva
y consumo observado y no se reenvía con la misma operación.

`GET /scopes/{scope}/planning-generation` informa disponibilidad autorizada.
Sin proveedor y perfil explícitos es falsa. El factory normal no obtiene una
credencial del entorno ni abre la capacidad; la activación requiere el preflight
indicado abajo y un adaptador de composición revisado.

### Políticas de admisión inyectadas

`GenerationProfile.input_policy` tiene dos valores cerrados, controlados por el
servidor, nunca por el formulario:

- `exact-input-v1` es el default compatible: exige `allowed_request_sha256` como
  `frozenset` no vacío de SHA-256 exactos. Mantiene la referencia opcional propia
  del contrato v3; cambiar una entrada no incluida sigue rechazándose.
- `manual-variable-v1` exige seleccionar ese valor explícitamente y
  `allowed_request_sha256=None`. Admite entradas variables del DTO manual v3
  únicamente para el actor/ámbito del perfil y con `reference=null`. No acepta
  archivos ni derivación de apartados. Conserva los límites y opciones manuales
  vigentes, sin imponer un idioma o contexto hipotético nuevos. Una lista vacía
  no significa comodín y una lista, incluso no vacía, contradice este modo.

Una política desconocida, actor/ámbito ausente o configuración contradictoria
falla cerrada. Ausencia de perfil/proveedor no habilita generación. No se cambia
el factory normal ni se descubre una credencial. El POST sigue siendo la única
admisión autoritativa; disponibilidad no reserva presupuesto ni promete éxito.

Las entradas del piloto deben ser no sensibles y sin datos identificables de
alumnos o terceros; el DTO limita estructura/tamaño, no certifica privacidad ni
clasifica texto libre. Activar requiere delimitar y autorizar esos datos y su
transmisión de conteo y generación a OpenAI para el actor/ámbito concretos.
La implementación y sus fixtures sintéticas no conceden ese permiso.

La política versionada entra en el fingerprint del perfil y en el snapshot
inmutable `configuration.input_policy` de cada intento nuevo. `request` y
`request_fingerprint` siguen conservando la entrada y su SHA-256 exactos;
`configuration.request_sha256` también los identifica. Sólo exact-input conserva
`approved_request_sha256`: un hash manual no pretende aprobación individual.
Los snapshots históricos sin discriminante conservan su semántica exact-input
original y no se reescriben. Replay consulta el intento anterior antes de evaluar
la política actual: cambiar perfil o apagar capacidad no regenera ni reinterpreta
historia. La configuración JSONB existente basta; no hay migración nueva.

Cambiar nombre, política, actor/ámbito o clave no crea presupuesto fresco: la
reserva acumulada y el bloqueo de intentos activos/inciertos siguen siendo
globales. No se modifica plazo, concurrencia, consumo observado ni recuperación.

### Composición explícita del piloto (#68)

`create_app(planning_provider=..., pilot_config=ManualPilotConfig(...))` añade
una frontera validada al factory existente, no otro servidor ni descubrimiento
de configuración. `ManualPilotConfig` contiene sólo nombre, actor UUID, ámbito
UUID, presupuesto y reserva del conteo en `Decimal`, proveedor, destino, modelo
y política. Todos son explícitos: `openai`, `https://api.openai.com/v1`, el
`MODEL` fijado y `manual-variable-v1` son las únicas elecciones del piloto.
No acepta JSON arbitrario, campos extra, credenciales ni un booleano de aprobación.

Antes de crear el engine o invocar transporte, la composición exige un
`OpenAIPlanning` inyectado, valida identidad/tipos/perfil y dinero positivo,
finito y representable a nueve decimales. El presupuesto configurado debe cubrir
al menos la reserva total redondeada, incluido el conteo; esto no consulta saldo
ni descuenta reservas anteriores. Configuración parcial, desconocida o mezclada
con `generation_profile` falla con `invalid_manual_pilot`, sin reflejar valores
en el error. Los límites de tokens, concurrencia, plazos y reintentos no son
opciones configurables nuevas. Se conserva la inyección técnica anterior de
`generation_profile`, incluida su política exact-input, sin cambiar su contrato.

El proveedor se inyecta por separado. `protected_placeholder` identifica el
marcador de un Network secret protegido y verificado en Codex; `server_api_key`
identifica una credencial privada del servidor, como la suministrada al runtime
de Render. Los modos son explícitos y mutuamente excluyentes. Un servidor no
obtiene sustitución de marcadores por tener una variable de entorno; no se
presupone un proxy de Codex en Render. Ni el tipo `OpenAIPlanning` ni una cadena
no vacía prueban protección, permisos o acceso al destino. El adaptador no busca
credenciales. Las pruebas usan valores sintéticos **con transporte falso**.
La [ruta ejecutable offline](../development.md#componer-el-piloto-manual-offline-68)
demuestra la configuración y el recorrido sin activar un proveedor real.

La disponibilidad sólo describe capacidad configurada para ese actor/ámbito:
no garantiza admisión ni reserva presupuesto. El POST sigue siendo la única
admisión. El formulario conserva entradas rechazadas y describe los límites;
`generation_busy` informa una pausa sin atribuir actividad a otra cuenta ni
pedir recuperar una operación ajena. `pending` puede confirmarse por GET;
`uncertain` permanece incierto, sin documento publicado ni reenvío.

Para cerrar la capacidad, retirar proveedor y `pilot_config` y usar el factory
normal en **todos** los procesos que admiten solicitudes. No basta iniciar un
proceso cerrado si otro habilitado sigue atendiendo. Esto no demuestra cancelar
una transmisión anterior: mantener intentos, reservas y estados inciertos en la
misma DB. Las sesiones válidas conservan lectura, revisión exacta, edición,
biblioteca y recuperación autorizada por GET. No borrar filas, reiniciar el
presupuesto ni ampliar límites para desbloquear una demostración.

Este cambio no resuelve la aceptación operativa de #69. #67 fue integrado por
el usuario en `f11644c7fe37777a57afe8c1b72fff10d80e331f`; su merge no convierte en
verdes los gates de CI o Chromium pendientes. Cada candidato requiere evidencia
propia, revisión independiente y CI exacta. Permisos de transmisión, categorías
de datos, cuenta/proyecto, protección del secreto, tarifas/saldo, destino de
servicio, auth, retención y recuperación siguen siendo puertas independientes;
aprobar software no autoriza credenciales, gastos, despliegue ni uso real.

### Arranque opt-in del servidor (#69)

`aulalista_api.pilot_runtime:create_app` es el factory de servidor explícito;
`aulalista_api.app:create_app` conserva su comportamiento cerrado y no lee estas
variables ni una credencial, aunque estén presentes. El nuevo factory admite
`AULALISTA_PILOT_ENABLED=false` o ausencia como apagado: sirve el recorrido
normal sin leer la configuración piloto ni `OPENAI_API_KEY`. Sólo el valor
exacto `true` solicita composición; cualquier otro valor falla cerrado.
El interruptor configura capacidad, no acredita autorización operativa.

Al habilitar exige `AULALISTA_PILOT_ACTOR_ID`, `AULALISTA_PILOT_SCOPE_ID`,
`AULALISTA_PILOT_BUDGET_USD` y `AULALISTA_PILOT_COUNT_RESERVE_USD`. Valida los
UUID y el perfil no secreto antes de leer la credencial o crear recursos DB.
Nombre `private-manual-pilot-v1`, proveedor, destino, modelo, política, límites,
concurrencia y cero reintentos quedan fijados por código. El presupuesto debe
ser positivo, cubrir una reserva completa y no superar USD 2; la reserva del
conteo es obligatoria, positiva y sin valor por omisión. No se inventa su tarifa.
Se conserva precisión de nueve decimales. Configuración incompleta, dinero
inválido o credencial ausente/inválida produce sólo `invalid_pilot_runtime`.

Después de validar, este factory lee `OPENAI_API_KEY` como secreto privado del
servidor e inyecta `OpenAIPlanning(server_api_key=...)`. El valor no se incluye
en repr, errores seguros, configuración durable, UI o logs de la aplicación.
El operador debe garantizar su procedencia/protección y auditar logs externos;
la variable no es un Network secret de Codex. Esta preparación no lee ni
configura una credencial real y no autoriza su transmisión.

La admisión reutiliza el ledger y lock globales existentes. El techo configurado
se compara con la suma de **todas** las reservas retenidas de la misma DB, entre
actores, estados, procesos y reinicios; no es un presupuesto nuevo por proceso.
Todos los procesos habilitados deben usar el mismo techo conservador de hasta
USD 2. El consumo de este encargo fuera de ese ledger y los costes adicionales
deben descontarse antes de configurarlo: el factory no consulta el saldo ni
impone un límite a otros consumidores de la cuenta OpenAI. Cerrar exige apagar
o retirar la composición en todos los procesos; conserva intentos y reservas.

Las pruebas de configuración no abren red. `test_pilot_composition.py` recorre
la inyección anterior y el nuevo arranque con auth/CSRF/PostgreSQL y transportes
sintéticos; verifica reinicio sin presupuesto fresco. El runner Chromium usa
el factory de servidor y una credencial sintética, sustituyendo únicamente el
transporte externo del modelo y el correo. No acredita una llamada real.

## Intento, presupuesto y recuperación

Una operación admite como máximo un intento, con dos etapas externas distintas:
conteo y generación. La admisión persiste solicitud/huellas, perfil, plazo y
reserva antes del conteo. Una transacción breve serializa reserva y concurrencia;
ninguna transacción ni lock de DB permanece abierto durante HTTP.

Perfil previsto: `gpt-6-luna`, Responses, Standard, `reasoning.effort=none`,
`store=false`, cache explícita sin breakpoints, sin herramientas, redirecciones,
reintentos ni fallback. Entrada medida por `/v1/responses/input_tokens` como
máximo 2048 tokens; salida como máximo 1024 tokens; una operación activa global;
plazo lógico de 75 segundos. `max_output_tokens` incluye razonamiento. El límite
de 4096 bytes del formulario no se presenta como un conteo de tokens.

El conteo usa el mismo contexto y esquema que la generación. Si excede 2048,
no se envía la generación. El conteo ya transmitió el contenido: requiere permiso
y reserva propios. Su precio no se presupone cero. El perfil inyectado exige una
reserva positiva verificada para ese request, presupuesto remanente en USD y
actor/ámbito autorizados y una de las políticas explícitas descritas arriba.
Exact-input exige las huellas SHA-256 aprobadas sin comodines. Otro propietario no puede utilizar ese perfil aunque coincida
su entrada. Las reservas
acumuladas nunca se liberan automáticamente: fallos, consumo desconocido y estados
inciertos conservan su margen. El consumo observado se registra aparte; ausente
es `null`, no cero. Una huella de entrada no sustituye permiso de transmisión.
Una respuesta tardía puede completar campos de consumo antes desconocidos sin
alterar el estado incierto, el plazo, la reserva ni las observaciones ya guardadas.
Un intento incierto también bloquea nuevas admisiones globales hasta conciliación
explícita; ese procedimiento administrativo queda fuera del corte. Vencer el
plazo no libera concurrencia ante una transmisión cuya cancelación es desconocida.

Tarifas observadas el 18 de octubre: entrada Standard USD 0.10/M y salida USD
0.50/M. El peor costo de inferencia con entrada medida N es
`(0.10*N + 0.50*1024)/1_000_000`; a la admisión se reserva N=2048 más la reserva
verificada del conteo. No se reserva la ventana completa del modelo ni se afirma
que esta cifra incluya impuestos, conversión o el conteo.

Los estados `counting` y `generating` se confirman antes de su envío. Repetir la
clave con igual solicitud sólo consulta; cambiar solicitud produce conflicto.
Un reinicio, timeout o resultado perdido no autoriza reenviar. Los estados
pendiente/incierto/fallido devuelven 409 con un código seguro; consultar una clave
desconocida devuelve 404. La UI conserva recuperación de pendientes e inciertos
sólo por GET. Un fallo definitivo permite otra operación únicamente por acción
explícita. El plazo lógico impide confirmar respuestas tardías; no demuestra
cancelación o ausencia de consumo remoto.

El respaldo de generación y el de edición usan slots independientes. Una
advertencia de generación no ofrece descartar el respaldo del editor ni el
intento incierto. «Descartar respaldo de edición» afecta sólo a edición;
consultar una generación conserva ese texto, su respaldo y la navegación vigente.
No hay una acción de descarte de generación que permita olvidar su clave y
reenviar. Las reservas del servidor no cambian por acciones de recuperación UI.

El formulario identifica su acción como «Crear ejemplo de software» o «Generar
con IA». El modo mostrado se pasa explícitamente al envío, también con Enter:
la disponibilidad posterior no convierte una acción de ejemplo en IA. Si deja
de estar disponible la IA, esa acción falla sin envío ni fallback a ejemplo.
La procedencia permanece visible en lector, editor y biblioteca. No se añaden
selectores, modales ni aprobaciones.

Se revalida la sesión/propiedad al admitir, antes de generar y antes de confirmar.
Resultado y revisión inicial se confirman atómicamente; después lectura, replay,
edición, copia y borrador nunca llaman al proveedor ni pisan revisiones humanas.
Los metadatos de consumo no incluyen prompt, respuesta cruda o cabeceras privadas.

## Pruebas y puertas de activación

Tests de software con transporte falso y PostgreSQL real desechable: duplicados,
respuesta perdida, carreras de presupuesto, límite contado, reinicio/timeout,
revocación, validación de salida, conservación de edición/copia y aislamiento.
La carrera usa dos conexiones y propietarios distintos, retiene la primera
admisión antes de su commit y observa el bloqueo real de la segunda. Con un
presupuesto para una reserva, sólo una operación cuenta y genera; la prueba
debe fallar al retirar la serialización global.
Esas fixtures no se enviarán a la API ni se presentarán como prueba educativa.

Para #67, `tests/test_manual_generation.py` recorre auth/CSRF reales, dos entradas
manuales distintas con transporte OpenAI falso, edición y reapertura en PostgreSQL;
prueba configuración cerrada, referencias/bytes rechazados, snapshots inmutables
y rotación de política sin presupuesto ni incertidumbre nuevos. Las pruebas de
carreras, revocación y respuestas tardías de `test_planning_generation.py` ejecutan
ambas políticas. El rojo inicial sobre main admite la primera entrada exacta y
rechaza la segunda por `generation_input_not_approved`, no por falta de una API.

`uv run --locked --no-editable pytest tests/pilot_browser_integration.py` es el
gate adicional en la CI web: Chromium → UI/HTTP/auth reales → PostgreSQL → sólo
transportes externos falsos. Incluye formularios diferentes, edición, reapertura,
revisiones originales, proyección de impresión y recuperación incierta sin reenvío.
Sólo se intercepta el diálogo de impresión, no la red de aplicación. No acredita
impresión física ni PDF real. Se conserva una captura únicamente de datos
sintéticos del lector, nunca cookies/códigos/login. Compilar o listar este test
no demuestra ejecutarlo; un entorno sin Chromium deja ese gate pendiente.

En #68 ese mismo runner atraviesa `ManualPilotConfig` y separa tres escenarios
con DB limpia: éxito de dos entradas, timeout/incierto terminal, y bloqueo global
por un intento de otro actor. Este último preserva formulario sin inventar
recuperación ni tocar transporte. `test_pilot_configuration.py` comprueba la
frontera cerrada; `test_pilot_composition.py` recorre sesión/CSRF/PG reales y
apagado mediante un factory nuevo, conservando documentos, intentos y reservas.
Los mocks UI de `guided.browser.ts` no publican resultado mientras están
pendientes y nunca convierten incertidumbre en éxito. Son fixtures de UI, no
evidencia del backend ni sustituto de Chromium conectado/PDF inspeccionado.

Antes de una llamada real: verificar la credencial existente y su cuenta/proyecto
mediante metadatos seguros. En Codex, Network secret ligado únicamente a
`api.openai.com`; en servidor, entrega privada server-side al factory opt-in,
sin exponer el valor en código, cliente, logs o historial y sin simular un proxy.
Verificar entrada
real exacta aprobada para exact-input o categoría manual variable acotada y
autorizada para el piloto, con actor/ámbito y límites de sesión/periodo/volumen
definidos; cuenta/proyecto y permiso tanto de conteo como generación;
precio/costo del conteo; tarifas vigentes, impuestos/conversión y saldo remanente
dentro del límite de USD 2 totales para este encargo, descontando gasto ya realizado
y sin presumir saldo o recargas históricas; revisión independiente y límite de gasto
efectivo. Sin esos datos, no activar ni recargar. `store=false` no promete cero
retención del proveedor.

Las dos revisiones 0008 conservan su padre `0007_guided_planning` y se reúnen
en `0009_planning_branches`, el único head admitido por readiness. La actualización
desde cualquiera de las dos ramas aplica la hermana faltante sin reescribir
historia. Se conservan los grants, rutas, DTOs y procedencia de apartados,
así como impresión y foco. Los downgrades de cada rama mantienen sus guardas
para no eliminar intentos o apartados retenidos.

Fuentes oficiales consultadas: [modelo](https://developers.openai.com/api/docs/models/gpt-6-luna),
[precios](https://developers.openai.com/api/docs/pricing),
[conteo](https://developers.openai.com/api/docs/guides/token-counting),
[caché](https://developers.openai.com/api/docs/guides/prompt-caching),
[datos](https://developers.openai.com/api/docs/guides/your-data) y
[secretos de red](https://learn.chatgpt.com/docs/environments/cloud-environments).
