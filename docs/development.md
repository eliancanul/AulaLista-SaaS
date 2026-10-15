# Backend T1: PostgreSQL desechable

Python 3.12.14 y uv 0.12.23. Dependencias directas y transitivas fijadas en
`pyproject.toml`/`uv.lock`; instalación no editable, sin servicios pagados.
No hay login, fuentes, datos de demo o migración de datos anteriores.

## Instalar, migrar y arrancar

Desde la raíz del checkout:

```sh
uv sync --locked --no-editable
docker compose -f compose.test.yml up -d --wait
export AULALISTA_DATABASE_URL='postgresql+psycopg://aulalista_test@127.0.0.1:55432/aulalista_test'
export AULALISTA_DB_TIMEOUT_SECONDS=3
uv run --locked --no-editable alembic upgrade head
uv run --locked --no-editable alembic current
uv run --locked --no-editable uvicorn aulalista_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

`.env.example` sólo documenta variables: no se carga automáticamente. El DSN debe
especificar driver `postgresql+psycopg`, usuario, host único y DB. Sólo se permite
`sslmode` como parámetro de URL; los timeouts y `search_path` no son anulables por
la URL. No hay fallback a SQLite ni conexión al host/usuario/DB por omisión.
Las migraciones no se ejecutan en el arranque ni desde endpoints.

La instancia de Compose es exclusivamente desechable: PostgreSQL 17.11, puerto
127.0.0.1:55432, rol y DB `aulalista_test`, autenticación trust, almacenamiento tmpfs.
Nunca usar esta configuración para datos reales ni exponerla fuera de loopback.

## Salud y modelo

- `GET /health/live`: 200 `{"status":"ok"}`, independiente de DB.
- `GET /health/ready`: 200 sólo si la única revisión registrada es
  `0001_personal_scope`; error de conexión, revisión ausente/incorrecta o timeout:
  503 `{"status":"unavailable"}`. No devuelve detalles internos.
- `AULALISTA_DB_TIMEOUT_SECONDS`: entero 2–30, predeterminado 3. Es deadline HTTP
  completo, incluyendo espera de la sonda, DNS, conexión y consulta. También fija
  los timeouts del driver y servidor. Una sola sonda en vuelo por aplicación
  impide acumular hilos cuando un fallo de red excede el timeout del driver.
- Conexiones síncronas sin pool persistente, una Session por operación; al cerrar
  se desconecta. La siguiente operación abre conexión nueva y puede recuperarse.
- Principal sólo tiene UUID. PersonalScope tiene UUID y un propietario UUID
  obligatorio, único y existente. No autentica, no contiene email o plan y no
  mezcla actor, dueño y eventual pagador. No hay operaciones privadas HTTP en T1.

## Pruebas obligatorias

**El siguiente comando destruye y reconstruye el esquema público de la DB de
pruebas.** No admite ninguna conexión por omisión. Exige localhost, nombre y rol
exactos `aulalista_test`, consentimiento explícito y marcador del servidor
`AulaLista disposable integration tests`, creado al provisionar la instancia.
Rechaza otros destinos antes de conectarse y un marcador ausente antes de borrar.

```sh
export AULALISTA_TEST_DATABASE_URL='postgresql+psycopg://aulalista_test@127.0.0.1:55432/aulalista_test'
export AULALISTA_TEST_ALLOW_RESET=1
uv run --locked --no-editable ruff check .
uv run --locked --no-editable ruff format --check .
uv run --locked --no-editable pytest tests/test_app.py tests/test_config.py
uv run --locked --no-editable pytest tests/test_postgres.py
uv pip check
uv build --no-sources
```

Las pruebas PostgreSQL no se omiten si falta servicio/configuración: fallan.
Su paso CI independiente falla también si no se recoge ninguna prueba.
Verifican migraciones repetibles, constraints mediante SQL directo, ausencia de
seeds, nueva Session/engine, fallo de conexión y reconexión, bloqueo real de la
revisión con timeout, config fail-closed y protección de limpieza. El servidor de
test necesita una conexión a la DB de mantenimiento `postgres` del mismo servidor
para bloquear y restaurar conexiones sólo a `aulalista_test` durante esa prueba;
no son los permisos recomendados para el futuro rol de producción.

La recuperación probada es sólo downgrade/upgrade en esta DB desechable. No
acredita backup/restore de producción, RLS ni piloto multicuenta.

## Retirar únicamente el recurso de prueba

```sh
docker compose -f compose.test.yml down
unset AULALISTA_TEST_DATABASE_URL AULALISTA_TEST_ALLOW_RESET AULALISTA_DATABASE_URL
```

El volumen es tmpfs y desaparece al retirar ese contenedor. No se incluyen
comandos para borrar bases externas.

## Evidencia y límites

La validación local se ejecuta con PostgreSQL 17.11 real, extraído de paquetes
oficiales Debian en un directorio desechable, porque este entorno no dispone de
Docker. Esto verifica SQL y driver; no afirma haber ejecutado Compose localmente.
La ejecución de la imagen oficial y el workflow debe quedar registrada por la CI
del SHA final antes de integrar. La revisión independiente también debe referir
ese candidato; los tests de T0 o de repositorios anteriores no lo certifican.
