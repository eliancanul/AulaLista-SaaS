# Backend: PostgreSQL desechable y fuentes sintéticas

Python 3.12.14 y uv 0.12.23. Dependencias fijadas en `pyproject.toml`/`uv.lock`;
instalación no editable, sin servicios pagados. No hay login, material docente real
ni migración de datos anteriores. Las operaciones privadas del servidor normal
responden 401; los actores sólo existen en fixtures y overrides de test.

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
ni desde endpoints. El head esperado es `0006_editor_recovery`. Su downgrade elimina sólo el UUID
de recuperación: no revoca sesiones ni borra respaldos de navegadores. El binario
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
SQL
export AULALISTA_DATABASE_URL='postgresql+psycopg://aulalista_runtime@127.0.0.1:55432/aulalista_test'
uv run --locked --no-editable uvicorn aulalista_api.app:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log --no-proxy-headers
```

Después de nuevas migraciones, revisar los grants necesarios antes de arrancar.
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

## Salud y operaciones

- `GET /health/live`: 200 `{"status":"ok"}`, independiente de DB.
- `GET /health/ready`: 200 sólo con conexión y única revisión
  `0006_editor_recovery`; fallo/timeout/revisión distinta: 503 sin detalle interno.
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
uv run --locked --no-editable pytest tests/test_postgres.py tests/test_materials.py tests/test_plannings.py tests/test_water_fixture.py tests/test_planning_edits.py
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
