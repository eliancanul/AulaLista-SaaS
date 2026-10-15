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
ni desde endpoints. El head esperado es `0002_source_versions`. El downgrade de
0002 elimina fuentes y versiones; usarlo sólo en esta DB desechable, nunca para
restaurar datos. Las pruebas recrean el esquema desde ambas migraciones.

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
GRANT SELECT, INSERT ON source, source_version TO aulalista_runtime;
GRANT UPDATE (current_version) ON source TO aulalista_runtime;
SQL
export AULALISTA_DATABASE_URL='postgresql+psycopg://aulalista_runtime@127.0.0.1:55432/aulalista_test'
uv run --locked --no-editable uvicorn aulalista_api.app:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log
```

Después de nuevas migraciones, revisar los grants necesarios antes de arrancar.
No dar al runtime el rol dueño/superuser. La app nunca crea principales, ámbitos
ni roles. El rol runtime puede insertar versiones y avanzar la revisión; no puede
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
  `0002_source_versions`; fallo/timeout/revisión distinta: 503 sin detalle interno.
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
uv run --locked --no-editable pytest tests/test_app.py tests/test_config.py
uv run --locked --no-editable pytest tests/test_postgres.py tests/test_materials.py
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
