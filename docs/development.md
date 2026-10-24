# Backend: PostgreSQL desechable y fuentes sintéticas

Python 3.12.14 y uv 0.12.23. Dependencias fijadas en `pyproject.toml`/`uv.lock`;
instalación no editable, sin servicios pagados, material docente real ni migración
de datos anteriores. Sin configuración auth, las operaciones privadas responden
401. Las pruebas B1 ejercitan sesiones HTTP y sustituyen sólo transportes externos;
los atajos de actor de otras suites viven exclusivamente en fixtures de test.

## Instalar y migrar

Desde la raíz del checkout, para una instancia desechable nueva:

```sh
uv sync --locked --no-editable
docker compose -f compose.test.yml up -d --wait
export AULALISTA_DATABASE_URL='postgresql+psycopg://aulalista_test@127.0.0.1:55432/aulalista_test'
export AULALISTA_DB_TIMEOUT_SECONDS=3
uv run --locked --no-editable alembic upgrade head
uv run --locked --no-editable alembic current
```

Después de editar código local, repetir `uv sync --locked --no-editable
--reinstall-package aulalista-api` para no probar una wheel anterior de la caché.

Las migraciones requieren el rol dueño de esquema. No se ejecutan en el arranque
ni desde endpoints. El head único esperado es `0013_chat_compaction`, posterior a `0009_planning_branches`, que reúne
las dos migraciones 0008 sin modificar sus revisiones ni sus datos. El downgrade
de `0008_openai_planning` rechaza cualquier intento retenido para no perder
evidencia de envíos; el de `0008_analytic_sections` rechaza apartados confirmados
para conservar historia y procedencia. Consulta [apartados analíticos](specs/0012-apartados-analiticos.md)
y [generación preparada offline](specs/0013-planeacion-openai.md). Los límites de
0007 se describen en la sección de planeación guiada. El downgrade de
`0006_editor_recovery` elimina sólo el UUID de recuperación: no revoca sesiones
ni borra respaldos de navegadores. El binario
0005 no acepta readiness0006; cualquier rollback requiere coordinación explícita.
El downgrade de 0005 elimina identidades,
sesiones, desafíos y contadores; los ámbitos/materiales quedan sin método de
acceso. No es un mecanismo de recuperación. El downgrade de
0004 elimina borradores y origen de copias; el de 0003 elimina planeaciones y
revisiones; el de 0002 elimina fuentes y versiones. Usarlo sólo en esta DB
desechable, nunca para restaurar datos. Las pruebas recrean el esquema desde todas las migraciones.

`.env.example` no se carga automáticamente. El DSN debe especificar driver
`postgresql+psycopg`, usuario, host único y DB. Sólo se permite `sslmode` como
parámetro de URL; timeouts y `search_path` no son anulables por la URL. No hay
fallback a SQLite ni conexión al host/usuario/DB por omisión.

Compose usa exclusivamente PostgreSQL 17.11 desechable, puerto loopback 55432,
rol/DB `aulalista_test`, autenticación trust y tmpfs. Nunca usar esta configuración
para datos reales ni exponerla fuera de loopback.

## Crear rol runtime y arrancar

Ejecutar una vez en la instancia desechable nueva, después de migrar. Este rol no
es dueño de las tablas, no pertenece a roles privilegiados y no puede migrar:

```sh
docker compose -f compose.test.yml exec -T postgres psql -U aulalista_test -d aulalista_test -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE aulalista_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO aulalista_runtime;
GRANT SELECT ON principal, personal_scope, alembic_version TO aulalista_runtime;
GRANT INSERT ON principal, personal_scope TO aulalista_runtime;
GRANT SELECT, INSERT ON auth_identity, auth_pre_session, auth_session, auth_email_challenge, auth_rate TO aulalista_runtime;
GRANT UPDATE (email, email_verified) ON auth_identity TO aulalista_runtime;
GRANT UPDATE (consumed, expires_at) ON auth_pre_session TO aulalista_runtime;
GRANT UPDATE (revoked, idle_expires_at) ON auth_session TO aulalista_runtime;
GRANT UPDATE (attempts, consumed) ON auth_email_challenge TO aulalista_runtime;
GRANT UPDATE (count) ON auth_rate TO aulalista_runtime;
GRANT SELECT, INSERT ON source, source_version TO aulalista_runtime;
GRANT UPDATE (current_version) ON source TO aulalista_runtime;
GRANT SELECT, INSERT ON planning, planning_revision TO aulalista_runtime;
GRANT UPDATE (current_revision) ON planning TO aulalista_runtime;
GRANT SELECT, INSERT ON planning_draft, planning_draft_revision TO aulalista_runtime;
GRANT UPDATE (current_revision) ON planning_draft TO aulalista_runtime;
GRANT SELECT, INSERT ON planning_generation_attempt TO aulalista_runtime;
GRANT SELECT, INSERT ON ai_budget_reservation TO aulalista_runtime;
GRANT UPDATE (state) ON ai_budget_reservation TO aulalista_runtime;
GRANT SELECT, INSERT ON chat_conversation, chat_turn, chat_active_conversation,
    chat_open_operation, chat_context_revision, chat_compaction_step TO aulalista_runtime;
GRANT UPDATE (title, version, updated_at, context_revision)
    ON chat_conversation TO aulalista_runtime;
GRANT UPDATE (state, assistant_text, finished_at, model, service_tier,
    provider_request_id, input_tokens, output_tokens, cached_tokens, cache_write_tokens,
    reasoning_tokens, error_code) ON chat_turn TO aulalista_runtime;
GRANT UPDATE (state, finished_at, counted_input_tokens, generation_requests,
    model, service_tier, provider_request_id, input_tokens, output_tokens, cached_tokens,
    cache_write_tokens, reasoning_tokens, error_code, planning_revision_id)
    ON planning_generation_attempt TO aulalista_runtime;
GRANT SELECT, INSERT ON analytic_section, analytic_section_revision TO aulalista_runtime;
GRANT UPDATE (current_revision) ON analytic_section TO aulalista_runtime;
SQL
export AULALISTA_DATABASE_URL='postgresql+psycopg://aulalista_runtime@127.0.0.1:55432/aulalista_test'
uv run --locked --no-editable uvicorn aulalista_api.app:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log --no-proxy-headers
```

Después de nuevas migraciones, revisar los grants necesarios antes de arrancar.
0013 añade resúmenes y pasos retenidos, sin ejecutar IA ni modificar mensajes.
Su downgrade rechaza pasos o resúmenes existentes para no destruir procedencia.
La migración y estos grants sólo se ejecutan aquí en PostgreSQL desechable;
aplicarlos en un servicio y desplegar son tareas posteriores separadas.
No dar al runtime el rol dueño/superuser. La autenticación válida aprovisiona principal/ámbito de forma idempotente;
la app nunca crea roles. El rol runtime puede insertar versiones y avanzar la revisión; no puede
actualizar/eliminar/truncar versiones, cambiar propietario o desactivar triggers.
Los triggers bloquean además UPDATE/DELETE/TRUNCATE sobre historia aun cuando un
rol tenga esos privilegios. Un administrador aún puede cambiar el esquema.

El arranque desactiva el access log de Uvicorn porque una URL arbitraria puede
contener datos privados. La app no registra bodies, headers, DSN ni excepciones DB;
sus errores de validación son genéricos. Revisar por separado proxies y cualquier
logging externo. No habilitar echo SQL ni captura de cuerpos/headers sensibles.

El inicializador `tests/postgres-init.sql` configura además PostgreSQL desechable:
`log_error_verbosity=terse`, `log_min_error_statement=panic`, sin statement/duration
logging y con parámetros omitidos. PostgreSQL por omisión puede registrar bytes en
DETAIL de un CHECK fallido; `hide_parameters` del cliente no lo impide. El runtime
no recibe privilegios para configurar logging. Un futuro servidor externo debe
cumplir controles equivalentes antes de usar cualquier dato privado.

## Aislamiento runtime con conexión reciclada (#98)

`uv run --locked --no-editable pytest tests/test_runtime_isolation.py` es un paso
obligatorio separado de backend CI. Reutiliza la DB desechable y el rol runtime
de las fixtures anteriores; requiere las mismas variables y no hace skip. No
se ejecutan simultáneamente suites que recrean su esquema.

La suite usa login/sesión/CSRF y rutas HTTP reales, sin override de actor. Sólo
sustituye transporte de correo/proveedor con datos sintéticos. Un `QueuePool`
exclusivo de test (`pool_size=1`, `max_overflow=0`) fuerza A→B; instrumentación
dentro de las consultas comprueba el mismo objeto psycopg y `backend_pid` para
los requests. También verifica usuario efectivo/de sesión, ausencia de privilegios
superuser/bypass y propiedad ajena de todas las relaciones públicas. El runtime
normal conserva `NullPool`; no se propone cambiar su manejo de conexiones.

Comprueba fuentes V1/V2 y headers de bytes/hash, recibos/replay, planeaciones e
historia, creación guiada con referencia exacta, ediciones, borradores, copias,
apartados y sus derivados exactos, resultado
de generación simulado y chat con turnos, conversación activa y contexto
versionado/reset. B no recupera IDs/claves de A usando el ámbito de A o el propio;
IDs inexistentes y cursores ajenos conservan las respuestas seguras de cada ruta.
Los listados propios vacíos no contienen elementos de A. B puede guardar bytes
idénticos con la misma clave de operación y abrir su propio chat: el aislamiento
no depende de denegar todas las operaciones. Tras los negativos, snapshots de las
filas privadas y lecturas de A permanecen iguales, sin nuevos envíos simulados.
Cada recorrido se repite con cookie revocada restaurada tras logout y con token
inválido, denegando lecturas, replays y escrituras nuevas con 401 genérico/no-store.

La defensa comprobada combina autorización transaccional del caso de uso con
los grants limitados, FKs compuestas y triggers de historia existentes; sus pruebas
de restricciones/carreras continúan en las suites previas. **El rol runtime tiene
SELECT amplio sobre materiales de distintos ámbitos: no hay aislamiento SQL por
fila ni RLS acreditado.** Esta suite comprueba la frontera HTTP, no protege frente
a SQL arbitrario ejecutado con ese rol ni acredita configuración de producción.
No añade objetos, URLs de descarga externas, temporales, parsing, caché de contenido,
borrado/revocación de fuentes ni restore. Esas superficies no implementadas siguen
pendientes; los artefactos aquí son bytes y JSON persistidos en PostgreSQL. No cierra
H3 ni habilita documentos reales, proveedores reales, gasto o piloto. El PR/CI del
candidato exacto registra resultados y revisión; este documento describe cobertura.

## Salud y operaciones

- `GET /health/live`: 200 `{"status":"ok"}`, independiente de DB.
- `GET /health/ready`: 200 sólo con conexión y única revisión
  `0013_chat_compaction`; fallo/timeout/revisión distinta: 503 sin detalle interno.
- `AULALISTA_DB_TIMEOUT_SECONDS`: entero 2–30, predeterminado 3. Deadline HTTP de
  readiness completo, incluyendo espera, DNS, conexión y consulta; también fija
  timeouts de driver/servidor. Una sola sonda en vuelo evita acumular hilos.
- Conexiones síncronas sin pool persistente y una Session/transacción por operación.
  Aislamiento READ COMMITTED explícito: replay observa el commit del rival tras
  esperar su clave; CAS evalúa la revisión vigente aunque el rol tenga otro default.
- [Contrato HTTP de T2](tickets/T2-fuentes-versionadas.md): crear fuente/V1, añadir
  revisión esperada, recuperar bytes exactos y consultar recibo scoped. Sólo bytes
  sintéticos opacos de 1–65 536; nada se interpreta ni ejecuta. Recibos/headers usan
  UTC, independientemente de la timezone de sesión PostgreSQL.
- Idempotencia por ámbito/UUID: huella determinista de operación, destino, revisión
  y bytes completos. Replay se comprueba antes de CAS para recuperar resultados
  antiguos. El recibo vive en la versión confirmada y no necesita tabla de trabajos.

## Pruebas obligatorias

**El comando de integración destruye y reconstruye el esquema público de la DB de
pruebas.** Exige localhost, nombre y rol exactos `aulalista_test`, consentimiento
explícito y marcador `AulaLista disposable integration tests`. Rechaza otros
destinos antes de conectarse y un marcador ausente antes de borrar. Usa el dueño
sólo para preparar fixtures; las apps de materiales se conectan como runtime.

```sh
export AULALISTA_TEST_DATABASE_URL='postgresql+psycopg://aulalista_test@127.0.0.1:55432/aulalista_test'
export AULALISTA_TEST_ALLOW_RESET=1
uv run --locked --no-editable ruff check .
uv run --locked --no-editable ruff format --check .
uv run --locked --no-editable pytest tests/test_app.py tests/test_config.py tests/test_browser_runner.py
uv run --locked --no-editable pytest tests/test_postgres.py tests/test_materials.py tests/test_plannings.py tests/test_water_fixture.py tests/test_planning_edits.py tests/test_guided_planning_integration.py
docker compose -f compose.test.yml logs --no-color postgres > /tmp/aulalista-postgres.log
uv run --locked --no-editable python tests/check_postgres_log.py /tmp/aulalista-postgres.log
uv pip check
uv build --no-sources
```

El workflow ejecuta estos pasos con PostgreSQL real, sin skip/fallback. Los tests
T1 siguen cubriendo migraciones, restricciones de ámbito, readiness, timeout y
reconexión. La prueba de desconexión necesita conectarse a la DB de mantenimiento
`postgres` para bloquear/restaurar sólo `aulalista_test`; no son permisos runtime.
T2 añade HTTP→caso→DB, roles separados, aislamiento A/B, restart, historia,
recibos, carreras con PIDs distintos, fallo diferido de commit, transporte perdido,
bytes/límites/streaming, constraints, inmutabilidad y logs del proceso Uvicorn.
Un probe causa CHECK fallido con un marcador sintético; el paso obligatorio
posterior inspecciona logs reales de PostgreSQL sin imprimirlos. Exige el error
esperado y ausencia de bytes, DETAIL de filas o sentencias SQL.

## Integración del navegador con la API de prueba

Con la DB desechable y variables de pruebas anteriores, instalar las dependencias
web y Chromium fijado por Playwright, y ejecutar desde la raíz:

```sh
(cd web && npm ci --ignore-scripts && npx --no-install playwright install --with-deps chromium)
uv run --locked --no-editable pytest tests/browser_integration.py
```

Este comando explícito reutiliza las migraciones, actores y rol runtime no dueño
de las pruebas PostgreSQL. Levanta una API HTTP en un puerto loopback efímero y
Playwright abre la entrada de tests mediante Vite en `127.0.0.1:4173`; el proxy
de pruebas comunica el navegador con la API real, sin interceptar sus respuestas.
Al terminar, también ante fallo o timeout, cierra API y grupo de procesos web.
El workflow web ejecuta esta prueba además de los recorridos con servidor fixture.

La sesión se inyecta exclusivamente en `tests/browser_integration.py` y en el
entrypoint/config de navegador bajo tests. No se incluye en la wheel ni en el
build web de producción. El servidor normal mantiene 401: esta integración no
resuelve la identidad real de #13 ni hace que #14 esté listo para uso personal.

## Retirar únicamente el recurso de prueba

```sh
docker compose -f compose.test.yml down
unset AULALISTA_TEST_DATABASE_URL AULALISTA_TEST_ALLOW_RESET AULALISTA_DATABASE_URL
```

El tmpfs desaparece con el contenedor. No hay comandos para borrar bases externas.
La recuperación probada es downgrade/upgrade y recreación de la DB desechable;
no acredita backup/restore de producción ni revocación de datos reales.

## Evidencia y límites

La validación local usa PostgreSQL 17.11 extraído de paquetes oficiales Debian en
un cluster exclusivo porque el entorno no tiene Docker. Verifica SQL y driver;
Compose local no se ha ejecutado. La imagen oficial y el workflow se verifican en
CI del SHA final, con revisión independiente referida al mismo candidato.

No hay identidad real, RLS, autorización de documentos reales ni restore de
producción. El runtime tiene permisos SQL amplios de lectura: el aislamiento de
T2 está en el caso de uso, no protege contra compromiso de la app/rol. Las puertas
del piloto exigen reforzarlo. Tampoco hay UI, parsing, OCR, IA, cobro o despliegue.

## B2 preparatorio: resultado fixture durable

[Contrato B2](tickets/B2-resultado-simulado.md): POST JSON acotado a 4096 bytes,
fuente T2 fixture exacta y revisión esperada; respuesta/recibo tras commit.
Lecturas de planeación y operación propias no ejecutan generador. Namespace
`planning-v1` separado de recibos T2; misma UUID no mezcla operaciones.
`planning_revision` es inmutable, protegida por FK de fuente/ámbito, trigger y
permisos mínimos. B3 añade UPDATE sólo de current_revision sobre planeaciones y
borradores, nunca sobre la historia.
La migración explícita 0003 agrega las tablas y una clave compuesta de referencia
a source_version, sin alterar sus bytes ni recibos. Downgrade destruye resultados: no
es restauración de producción. Revisar y aplicar grants al provisionar tras migrar.

Sólo tests inyectan actor. Identidad real #13 y UI Acenta conectada siguen pendientes;
no es un recorrido usable, parser ni IA. Las pruebas B2 incluyen recuperación tras
COMMIT con transporte fallido, CAS contra append T2, aislamiento y rollback diferido.


## B3: edición, borradores y copias

[Contrato B3](specs/0003-edicion-durable.md): edición de un enunciado permitido con
CAS e idempotencia; borrador privado versionado con identidad y CAS propios; copia
independiente desde una revisión exacta con origen y fuente conservados. La
migración explícita 0004 conserva B2, agrega las tablas de borradores y protege
la relación origen/fuente/ámbito con FKs compuestas. Requiere los grants arriba
indicados, nunca permisos de UPDATE/DELETE/TRUNCATE sobre revisiones.

El nuevo fixture `water-observation-v1` corresponde a Agua que cambia/30 minutos
y Ficha de observación. No modifica el fixture original `timing-example-v1`.
Ambos usan bytes sintéticos opacos exactos; no son PDF, parser ni IA.

No hay endpoint de deshacer: sólo revierte texto local aún no guardado. Un recibo
siempre representa su operación exacta; un GET de planeación representa current.
Los borradores no avanzan esa revisión y pueden basarse en una revisión antigua.
Los listados mínimos paginan por UUID para reabrir original/copia/borrador.

Downgrade 0004 destruye borradores y metadatos de origen; no es restauración. Si
una revisión B3 supera el límite antiguo de 4096 bytes de request, el downgrade
rechaza la reducción y revierte su transacción. Usar migraciones hacia adelante
para datos que deban conservarse; no se acredita backup/restore de producción.

Pruebas B3 añaden dos conexiones runtime reales para CAS y replay, reinicio de app,
fallo diferido de commit, pérdida de respuesta tras commit, recibo aún no visible,
borradores ajenos y sobre base superada, copia idempotente tras conflicto,
inmutabilidad y fuente/origen coherentes. Los tests frontend son un gate separado;
identidad real #13 sigue pendiente y runtime permanece cerrado.


## Autenticación preparatoria B1

Ver [contrato HTTP y límites](specs/0005-autenticacion-local.md). Sin configuración
explícita, las operaciones privadas siguen cerradas. No introducir secretos en
archivos del repo. `.env.example` contiene sólo nombres y marcadores, no valores
utilizables; no se carga automáticamente. Este corte no permite recibir OTP en
runtime: EmailSender carece de proveedor. El harness de pruebas es el único que
inyecta verificador/transporte; nunca se distribuye como mecanismo de acceso.

Google usa google-auth y caché HTTP de certificados con timeout de3segundos.
No se solicita client secret, refresh token ni acceso a otros servicios Google.
No se han creado credenciales ni validado servicios externos. La conexión real
requiere configuración y comprobaciones autorizadas posteriores. La migración
0005 no concede permisos; revisar/aplicar grants sólo en entorno autorizado.
Los límites PG son ventanas fijas de hora/minuto, excepto cooldown de reenvío
exacto60segundos. Purga de filas expiradas y retención se resolverán antes del
piloto; no se añade tarea programada ni se borra historial ahora.

El arranque local desactiva también `ProxyHeadersMiddleware` con
`--no-proxy-headers`: Uvicorn confía por defecto en cabeceras reenviadas desde
loopback, lo que permitiría alterar la IP usada por los límites. Todos los
launchers del repositorio fijan `proxy_headers=False` o su equivalente CLI.
No habilitar proxy headers sin diseñar y probar una frontera de confianza explícita.
La adaptación [Render demo](render-demo.md) mantiene el peer TCP compartido, añade
un presupuesto global PG y prepara UI/API same-origin; no acredita un despliegue
ni confianza en cabeceras del edge.

### Planeación guiada (corte manual/fixture #52)

`POST /scopes/{scope_id}/guided-plannings` admite el DTO v2, separado del ajuste
B2. `uv run --locked --no-editable pytest tests/test_guided_planning.py` comprueba
contrato y fixture; `tests/test_guided_planning_integration.py` exige PostgreSQL
real. Ambos están enumerados en backend CI. El contrato B3 sigue v1: propósito,
actividades/tiempos, materiales y evaluación son proyecciones editables de un
único resultado canónico, sin texto duplicado.

Sólo se admite Ciencias naturales / 3.º de primaria / El cuidado del agua en la
comunidad / active-learning / es. Es una fixture de software determinista, no
un corpus de investigación ni una salida de IA. Contexto manual, condición
hipotética, objetivos propios, campo y ejes manuales se guardan literalmente;
no se usan como supuesto de adaptación ni como PDA oficiales. Sin referencia,
los cuatro campos source del recibo son null; con referencia se conserva la
versión exacta ya admitida aunque exista una posterior.

Migración `0007_guided_planning`: permite source_version_id nulo y añade la FK
origin_scope, preservando CAS, autorización por ámbito e idempotencia. Downgrade primero
exige NOT NULL: falla transaccionalmente si hay planeaciones sin fuente, sin
borrar datos. El binario anterior tampoco entiende el DTO v2 aunque incluya
referencia; se prefiere roll-forward, nunca un rollback destructivo.

Los tests del navegador para este corte son fixtures de software claramente
rotuladas; el recorrido `guided.integration.ts` atraviesa HTTP y PostgreSQL
reales y pierde una respuesta tras commit para comprobar recuperación por
recibo. Una nueva sesión sólo reabre datos confirmados; no se promete recuperar
el formulario ni texto pendiente después de 401.

### Adaptador OpenAI preparado offline

[Spec 0013](specs/0013-planeacion-openai.md) define el DTO manual v3 y su intento
durable. `create_app()` mantiene OpenAI deshabilitado; no descubre ni lee
`OPENAI_API_KEY`. La inyección técnica recibe `planning_provider` y
`generation_profile`; el piloto #68 añade la configuración cerrada descrita
abajo. Uso real sólo tras resolver las puertas de activación. Los
tests inyectan un transporte falso, jamás una credencial o una llamada real.

`planning-generation` devuelve disponibilidad autorizada. `generated-plannings`
admite entradas según la política explícita exact-input o manual-variable,
reserva antes del conteo,
limita la entrada contada y confirma la salida validada. La tabla
`planning_generation_attempt` conserva reserva, configuración y consumo observado;
campos desconocidos son null. No se libera reserva automáticamente. Un intento
incierto bloquea nuevas admisiones hasta conciliación explícita, todavía no
implementada. Lectura, edición, copia y replay no ejecutan el proveedor.

Las pruebas nuevas son `test_generated_contract.py`, `test_openai_planning.py`,
`test_planning_generation.py` y `test_generated_routes.py`; las dos últimas
requieren el PostgreSQL desechable y el rol runtime. La UI distingue procedencia
real preparada y ejemplo de software; sus pruebas simulan respuestas y no
acreditan inferencia real. La descarga local del Chromium fijado puede requerir
acceso a su CDN; usar otra versión local debe registrarse como evidencia distinta
de CI, nunca como equivalencia.

### Componer el piloto manual offline (#68)

La composición offline usa el mismo `create_app` con `ManualPilotConfig` no secreto y un
`OpenAIPlanning` explícito. Este ejemplo sólo demuestra composición sintética;
su transporte rechaza sin red. Los UUID son ilustrativos, no atajos de sesión.
Requiere el DSN de desarrollo preparado como arriba, y no escucha en ningún puerto:

```python
from decimal import Decimal
from uuid import UUID
from aulalista_api.app import create_app
from aulalista_api.openai_planning import BASE_URL, MODEL, OpenAIPlanning, ProviderError
from aulalista_api.pilot import ManualPilotConfig


def synthetic_transport(url, payload):
    raise ProviderError("provider_rejected", uncertain=False)


config = ManualPilotConfig(
    name="synthetic-pilot-only",
    actor_id=UUID("00000000-0000-4000-8000-000000000001"),
    scope_id=UUID("00000000-0000-4000-8000-000000000002"),
    budget_usd=Decimal("0.1"),
    count_request_reserve_usd=Decimal("0.0001"),
    provider="openai",
    destination=BASE_URL,
    model=MODEL,
    input_policy="manual-variable-v1",
)
app = create_app(
    pilot_config=config,
    planning_provider=OpenAIPlanning(
        "software-placeholder-only", transport=synthetic_transport
    ),
)
```

La demostración vertical nueva con resultados, sesión/CSRF y PostgreSQL reales
se ejecuta con `uv run --locked --no-editable pytest tests/test_pilot_configuration.py
tests/test_pilot_composition.py`, tras provisionar la DB desechable. No necesita
ni admite una credencial real. Para Chromium, reutilizar el runner ya existente
`uv run --locked --no-editable pytest tests/pilot_browser_integration.py`, que
separa `success`, `uncertain` y `busy`. Sólo el transporte externo es falso;
compilar o listar pruebas no acredita ejecutarlas ni inspeccionar capturas/PDF.

No quitar el transporte falso del ejemplo ni reemplazar el marcador por una
API key. La composición no verifica protección de una credencial, permisos,
tarifas vigentes o saldo. Antes de cualquier uso real resolver el preflight de
[spec 0013](specs/0013-planeacion-openai.md) y la aceptación operativa #69.
Cerrar mediante `create_app()` en todos los procesos de admisión conserva la DB
y la lectura autorizada; no cancela transmisiones inciertas ni libera reservas.

### Preparar el arranque privado del servidor (#69)

Preparación de código y pruebas, sin activación. El factory normal anterior no
lee `OPENAI_API_KEY`, no habilita generación y sigue siendo el start por omisión.
El factory alternativo, seleccionado explícitamente por el operador, es:

```sh
.venv/bin/python -m uvicorn aulalista_api.pilot_runtime:create_app --factory \
  --host 0.0.0.0 --port "$PORT" --no-access-log --no-proxy-headers
```

Ese comando es una referencia para el servicio autorizado, no una instrucción
de desplegar ahora. Build y migraciones permanecen separados; el DSN del servicio
siempre es el del runtime, nunca el dueño. No se cambia el Blueprint de ejemplo.

Para habilitar después de completar las puertas de #69, hacen falta:

| Variable | Significado |
| --- | --- |
| `AULALISTA_PILOT_ENABLED` | Ausente/`false`: cerrado. Sólo `true` compone el piloto. No es prueba de autorización. |
| `AULALISTA_PILOT_ACTOR_ID` | UUID del principal autenticado autorizado, no el email ni un actor fixture. |
| `AULALISTA_PILOT_SCOPE_ID` | UUID de su ámbito personal real. |
| `AULALISTA_PILOT_BUDGET_USD` | Decimal positivo de hasta USD 2, que cubra una reserva y considere el gasto del encargo fuera del ledger. |
| `AULALISTA_PILOT_COUNT_RESERVE_USD` | Reserva positiva verificada del conteo; obligatoria, sin tarifa inventada ni default. |
| `OPENAI_API_KEY` | Credencial privada **del servidor**, suministrada por su mecanismo de secretos existente; nunca en Git, cliente, `.env` compartido o argumentos CLI. |

La configuración pública se valida antes de leer la key. Perfil/modelo/destino
son fijos y no aceptan selectores por entorno. La key se suministra como
`server_api_key`; `protected_placeholder` sigue reservado a Network secrets de
Codex con sustitución real comprobada. Render no se considera ese proxy.
La exclusión de repr no certifica cómo se aprovisionó la credencial.

Secuencia posterior, con autorización propia de activación/despliegue:

1. Confirmar revisión, CI, esquema `0009_planning_branches`, grants runtime y sesión
   privada; revalidar que no haya otro proceso de admisión con un límite distinto.
2. Confirmar cuenta/proyecto, destino `api.openai.com`, permisos de conteo y
   generación, tarifas vigentes, reserva del conteo, costes adicionales y saldo
   remanente dentro de USD 2 **totales** para el encargo. La cifra `0.0001` del
   ejemplo offline es sintética, no una tarifa aprobada. No crear credenciales,
   recargar ni ampliar servicios por seguir esta guía.
3. Leer sólo agregados del ledger mediante la ruta administrativa autorizada:
   `count(*)`, `sum(reserved_usd)`, sumas de `count_requests`/`generation_requests`
   y cantidad de estados `counting`/`generating`/`uncertain`. No mostrar solicitudes,
   cookies ni claves. Sin consumo observado, el dato sigue desconocido, no cero.
4. Configurar el mismo techo conservador en todos los procesos. La admisión exige
   `reservas globales + reserva nueva <= presupuesto`; cambiar actor, nombre,
   key o proceso no reinicia esa suma. No borrar intentos ni liberar reservas.
5. Tras activar y comprobar la disponibilidad de la sesión autorizada, ejecutar
   sólo las dos entradas sintéticas acordadas, secuencialmente, conciliando ledger
   antes/después. Ante pendiente o incierto, parar y consultar por GET sin reenvío.
   Lectura, edición, reapertura e impresión nunca generan otra llamada.
6. Para cerrar, retirar la composición o poner `AULALISTA_PILOT_ENABLED=false`
   y reiniciar todos los procesos que admiten solicitudes. Confirmar capacidad
   cerrada y lectura autorizada de lo guardado sin tocar intentos ni presupuesto.

Pruebas deterministas: `tests/test_pilot_runtime.py`, la suite existente
`tests/test_pilot_composition.py` y `tests/pilot_browser_integration.py`. Sólo usan
credenciales sintéticas y transportes externos falsos. No ejecutar fixtures de
integración contra Render ni conectar una credencial real a esas pruebas.


### Presupuesto por operación sin conteo remoto (#69)

Variante explícita: `aulalista_api.pilot_runtime:create_window_app`. Conserva el
start normal cerrado y el factory remoto anterior. Misma sesión, rutas y UI:
no ejecutar un adaptador aislado ni fixtures contra Render.

Variables: `AULALISTA_PILOT_ENABLED=true`, `AULALISTA_PILOT_ACTOR_ID`,
`AULALISTA_PILOT_SCOPE_ID`, `AULALISTA_PILOT_BUDGET_USD` (<= 2),
`AULALISTA_PILOT_ADDITIONAL_RESERVE_USD` (obligatoria, >= 0, cargos verificados)
y `OPENAI_API_KEY` por el mecanismo existente de secretos del servidor.
`AULALISTA_PILOT_COUNT_RESERVE_USD` no se lee en esta variante. Actor/ámbito
proceden de `/auth/session`; no copiar cookies/CSRF ni mostrar la respuesta
completa. La cota de inferencia fija es USD 0.210768, más la reserva adicional;
no equivale a consumo observado. Consulte la enmienda y fuentes de spec 0013.

Handoff administrativo para el agente dueño de la DB, **no ejecutado remotamente**:

1. Confirmar commit, respaldo recuperable y revisión actual con el procedimiento
   administrativo existente. Cerrar admisión; no tocar allowlist ni elevar runtime.
2. En ventana coordinada y con credencial administrativa sólo en entorno seguro,
   ejecutar `uv run --locked --no-editable alembic current` y confirmar 0009.
   Aplicar únicamente `uv run --locked --no-editable alembic upgrade 0010_window_budget`;
   confirmar `current`, preservar datos/agregados y comprobar grants runtime
   existentes. No poner DSN administrativo en build/start, historial o logs.
3. La tabla compartida `ai_budget_reservation` copia las reservas anteriores.
   Sus triggers reflejan nuevas admisiones/estados sin modificar importes. Aplicar
   los grants mínimos anteriores: SELECT/INSERT y UPDATE sólo de state en ella.
   No conceder UPDATE de `count_strategy`, DELETE, TRUNCATE ni privilegios owner.
4. Coordinar despliegue del commit revisado que espera 0010; binario anterior
   deja readiness en 503 tras upgrade. Downgrade a 0009 sólo es posible si no
   existe un intento `window-v1`; con uno retenido se conserva 0010 y se
   cierra la capacidad, sin borrar/reseteos para revertir.
5. Verificar precios/cargos, saldo total y agregado global de reservas. No iniciar
   si existe intento activo/incierto ni si el nuevo total supera el presupuesto.
   Todos los procesos y productos deben usar el mismo ledger y techo. Cada
   nueva operación reserva su cota; replay nunca reenvía. No existe una cuota
   permanente de una generación. US$2 configura este encargo de pruebas.
6. Con autorización separada de configuración/despliegue/uso, arrancar:

```sh
.venv/bin/python -m uvicorn aulalista_api.pilot_runtime:create_window_app --factory \
  --host 0.0.0.0 --port "$PORT" --no-access-log --no-proxy-headers
```

Comprobar readiness y capacidad privada; generar **una** entrada sintética por
UI autenticada para el ensayo acotado. Nuevas operaciones válidas siguen el
mismo presupuesto compartido. Conciliar llamadas/tokens observados y reserva con el proveedor;
no presentar reserva como gasto facturado. Ante incertidumbre sólo GET; no reenvío.
Cerrar con `AULALISTA_PILOT_ENABLED=false` y reiniciar admisores. No liberar reserva.


### Chat privado y migraciones 0011–0013

El mismo factory `aulalista_api.pilot_runtime:create_window_app` conecta chat de
texto y Planeación al **mismo** presupuesto. No hay clave ni tope independiente.
El chat guarda historial confirmado por ámbito. La revisión activa de contexto
identifica las notas escritas por el docente y los turnos posteriores que se
enviarán; no adjunta recursos automáticamente. El payload permanece acotado a
32 KiB; un envío puede compactar automáticamente conservando historia y notas,
con reserva conjunta de resumen y respuesta según [0014](specs/0014-private-chat.md). No hay cuota de vida de
20 respuestas o 100 intentos. Reiniciar o actualizar contexto conserva historia,
recibos y reservas; no genera un resumen automático ni llama al proveedor.
Consumo observado/estimación/reserva se presentan por separado, nunca como factura.

Tras integrar un candidato revisado, el operador dueño de la DB debe ampliar la
ventana administrativa anterior: comprobar revisión actual, respaldo y cierre
de admisión. El upgrade a 0013 indicado abajo recorre 0010, 0011 y 0012 si aún están
pendientes; no se deben ejecutar destinos anteriores a la revisión actual. La
credencial administrativa permanece sólo en el mecanismo seguro existente.
La revisión 0011 es un paso intermedio, no el requisito del nuevo binario.
No ejecutar estas instrucciones
contra Render como parte de tests ni poner el DSN dueño en build/start.

Además de los grants de 0010, el runtime necesita únicamente:

```sql
GRANT SELECT, INSERT ON chat_conversation, chat_turn TO aulalista_runtime;
GRANT UPDATE (title, version, updated_at) ON chat_conversation TO aulalista_runtime;
GRANT UPDATE (state, assistant_text, finished_at, model, service_tier,
    provider_request_id, input_tokens, output_tokens, cached_tokens, cache_write_tokens,
    reasoning_tokens, error_code) ON chat_turn TO aulalista_runtime;
```

No conceder actualización de entrada, reserva, actor/perfil ni DELETE/TRUNCATE.
Downgrade 0011 rechaza conversaciones retenidas, incluso vacías; cerrar capacidad
conserva historial. Un rollback de binario no restaura la revisión de esquema.
Verificar permisos, datos y readiness durante el despliegue coordinado. Después,
con autorización operativa, el ensayo real usa sólo mensajes sintéticos por UI,
revisa contexto en segundo turno, recarga/reabre y concilia consumo; debe caber
con Planeación y cualquier gasto previo dentro de USD2 totales. No reenviar
pendientes/inciertos: consultar su operación por GET.

Contrato y pruebas: [spec 0014](specs/0014-private-chat.md),
`tests/test_openai_chat.py`, `tests/test_chat.py`, `tests/test_chat_routes.py` y
`tests/chat_browser_integration.py`. Esas pruebas sólo usan transporte externo
sintético y PostgreSQL local desechable; no acreditan aún respuesta real.

#### Conversación única, contexto y resúmenes versionados: 0012–0013

En la misma ventana administrativa coordinada, con admisiones detenidas y un
respaldo verificado, comprobar `alembic current` y ejecutar únicamente:

```sh
uv run --locked --no-editable alembic upgrade 0013_chat_compaction
uv run --locked --no-editable alembic current
```

El operador usa su mecanismo seguro existente para el DSN administrativo, sin
imprimirlo ni guardarlo en historial, build/start o archivos versionados. Estas
instrucciones son un handoff; las pruebas nunca las ejecutan contra Render.

La migración conserva conversaciones, turnos, operaciones y reservas. Elige una
conversación activa por ámbito por `updated_at DESC, id DESC`; las demás quedan
como historia consultable, sin mezclar sus mensajes. La revisión inicial conserva
el contexto anterior. Nuevas aperturas regresan al mismo chat. Una actualización
o reinicio crea una revisión inmutable con el número de turno cubierto; no borra
mensajes, recursos ni consumo. Aplicar estos grants además de los de 0011:

```sql
GRANT SELECT, INSERT ON chat_active_conversation, chat_open_operation,
    chat_context_revision, chat_compaction_step TO aulalista_runtime;
GRANT UPDATE (context_revision) ON chat_conversation TO aulalista_runtime;
```

Verificar conteos/identificadores previos, suma y estados de reservas, referencias
de contexto y permisos mínimos. No conceder UPDATE de las revisiones ni DELETE,
TRUNCATE o privilegios owner al runtime. El binario nuevo requiere exactamente
0013; coordinar su arranque y sondas con la ventana, sin migración automática.
Si hay historia retenida, conservar el esquema y cerrar admisión ante un problema;
un rollback de binario no restaura compatibilidad. Revisar el bloqueo de downgrade
antes de cualquier plan de reversión, sin borrar datos para forzarlo.

El ensayo posterior, autorizado y coordinado por separado, debe comprobar que
dos pestañas abren el mismo chat, que actualizar contexto excluye los turnos
anteriores del siguiente envío y que éstos siguen disponibles en el historial.
GET, recarga, apertura y actualización manual no llaman a IA. 0013 conserva
resúmenes y pasos con procedencia inmutable; cada envío reserva conjuntamente
los pasos previstos más una respuesta en el ledger global. Sus pruebas están en
`tests/test_chat_compaction.py` y en el recorrido de aislamiento runtime.
Migración/despliegue remotos y ensayo real siguen aplazados; estas instrucciones
no autorizan su ejecución ni dependen de una máquina personal.
