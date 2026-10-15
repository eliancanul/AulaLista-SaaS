# AulaLista SaaS

Base de desarrollo de AulaLista SaaS para docentes individuales.

El proyecto está en desarrollo. Los incrementos de código y documentación se revisan mediante pull requests.

## Estado del primer corte

T0 ya tiene implementación local: paquete FastAPI, `GET /health/live`, configuración explícita de documentación, tests y workflow propio. El implementador reportó 21 tests, lint, formato y build correctos con Python 3.12.14 y uv 0.12.23. Se inspeccionaron esos archivos y su log; este registro no sustituye la revisión independiente del código ni la CI remota, pendientes al congelar la documentación el 15 de octubre de 2026 UTC.

El bootstrap de main fue verificado por el integrador en `adad3f4f64d6078d4914ef6ba348774428e92c24`. Esta documentación amplía su README mínimo y debe incorporarse junto al candidato T0 revisado. No hay todavía persistencia, autenticación de usuarios, UI o un piloto habilitado.

Decisiones confirmadas: FastAPI, PostgreSQL, docentes individuales, suscripción con precio pendiente e inicio limpio sin migración de datos. React, TypeScript y Vite siguen como recomendación para el frontend posterior. Ningún proveedor de identidad, IA, almacenamiento o cobro se contrata al introducir esta base.

## Arranque local de T0

Requisitos del candidato: Python 3.12.14 y uv 0.12.23. Ejecutar desde la raíz del checkout:

```sh
uv sync --locked --no-editable
uv run --locked --no-editable uvicorn aulalista_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

`GET http://127.0.0.1:8000/health/live` devuelve `{"status":"ok"}`. Sólo acredita vida del proceso. No existe readiness de base de datos en T0.

`AULALISTA_DOCS_ENABLED` admite `true` o `false`, ignorando mayúsculas y espacios exteriores. Su valor por defecto es `false`. `true` habilita `/docs` y `/openapi.json`; `/redoc` permanece deshabilitado. Un valor inválido impide crear la app y el error no reproduce el valor. `.env.example` es una referencia: la app no carga archivos `.env` automáticamente; la variable se establece en el entorno del proceso.

El servidor se detiene con Ctrl+C. T0 no crea DB ni recursos remotos. Dependencias y versiones exactas viven en `pyproject.toml` y `uv.lock`.

## Comprobaciones

Los comandos del candidato y de `.github/workflows/backend.yml` son:

```sh
uv sync --locked --no-editable
uv run --locked --no-editable ruff check .
uv run --locked --no-editable ruff format --check .
uv run --locked --no-editable pytest
uv pip check
uv build --no-sources
```

Las pruebas ejercitan el paquete instalado, no sólo imports de una carpeta fuente. Que estos comandos hayan pasado localmente no acredita un run remoto; el PR debe aportar checks del SHA final y base revalidada.

## Orden de construcción

1. [T0](docs/tickets/T0-bootstrap-api.md): arranque mínimo de FastAPI, health y CI propia.
2. [T1](docs/tickets/T1-postgresql-ambito.md): PostgreSQL, migraciones y ámbito personal con restricciones verificadas; siguiente incremento inmediato.
3. [T2](docs/tickets/T2-fuentes-versionadas.md): fuente sintética versionada, recuperación, aislamiento, transacciones y reintentos.

T0 por sí solo no prueba persistencia. T1 no almacena materiales. T2 completa el primer corte técnico, pero no habilita un piloto con documentos reales. Las pruebas de persistencia requieren PostgreSQL desechable, sin sustitución por SQLite.

## Documentación

- [Instrucciones de contribución](AGENTS.md)
- [Decisión de fundación](docs/adr/0001-fundacion-personal.md)
- [Contrato de fundación](docs/specs/0001-fundacion.md)
- [Tickets y dependencias](docs/tickets/README.md)
- [Workflow y evidencia](docs/workflow.md)
- [Consultas por hitos](docs/reviews/README.md)
- [Registro de coordinación](docs/reviews/0000-coordinacion.md)

## Fuentes y límites

Los contratos de producto proceden de [AulaLista #165](https://github.com/eliancanul/AulaLista/issues/165) y [#166](https://github.com/eliancanul/AulaLista/issues/166). El integrador verificó los enlaces y su correspondencia con conservación de originales, versiones y autoridad el 15 de octubre de 2026 UTC. Las decisiones actuales de público, stack e inicio limpio prevalecen sobre hipótesis históricas institucionales o de migración.

Este repositorio nuevo conserva esos contratos sin copiar código, fixtures, dumps ni documentos privados del anterior, que permanece intacto. Si se decide reutilizar un artefacto después, se revisan expresamente propósito, procedencia, licencia y datos.
