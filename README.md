# AulaLista SaaS

Base de desarrollo de AulaLista SaaS para docentes individuales.

El proyecto está en desarrollo. Los incrementos de código y documentación se revisan mediante pull requests.

## Estado del primer corte

T0 y T1 están integrados; [PR #2](https://github.com/eliancanul/AulaLista-SaaS/pull/2)
deja main en `a8dc576f041ca7cf6fd755a54a5027280c4e4f75`, con
[CI postmerge correcta](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/38688115249).
T2 añade fuentes sintéticas opacas de 1 a 65 536 bytes, versiones inmutables,
recibos recuperables, propiedad personal y concurrencia transaccional. Su candidato
local pasó pruebas HTTP y PostgreSQL real; revisión independiente y CI exacta
siguen siendo puertas de integración registradas en el ticket/PR.

El servidor normal devuelve 401 en todas las operaciones privadas: todavía no hay
identidad real. Sólo los tests inyectan actores y usan un rol DB runtime distinto
del dueño de migraciones. No hay UI, documentos reales, parsing, IA, cobro ni piloto
habilitado. Docentes individuales, suscripción con precio pendiente e inicio
limpio siguen como alcance de producto. No se contrata ningún servicio.

## Arranque y pruebas

Sigue [desarrollo y PostgreSQL desechable](docs/development.md) para instalar,
provisionar la DB de prueba, migrar explícitamente, arrancar, ejecutar tests y
retirar sólo ese recurso. La configuración ahora **requiere un DSN PostgreSQL**:
el comando de arranque de T0 sin DSN ya no es suficiente.

`GET /health/live` acredita vida del proceso. `GET /health/ready` sólo responde 200
con conexión y revisión de esquema esperada; fallos devuelven 503 dentro del plazo
configurado. La documentación HTTP está deshabilitada salvo
`AULALISTA_DOCS_ENABLED=true`; `.env.example` no se carga automáticamente.

El workflow del backend ejecuta API/config y PostgreSQL real en pasos obligatorios
separados; no usa SQLite ni omite integración cuando falta DB. Las versiones exactas
están en `pyproject.toml` y `uv.lock`. Los tests importan el paquete instalado no
editable. La evidencia local no sustituye checks remotos del SHA final.

## Orden de construcción

1. [T0](docs/tickets/T0-bootstrap-api.md): arranque mínimo de FastAPI, health y CI propia.
2. [T1](docs/tickets/T1-postgresql-ambito.md): PostgreSQL, migraciones y ámbito personal; integrado en PR #2.
3. [T2](docs/tickets/T2-fuentes-versionadas.md): fuente sintética versionada, recuperación, aislamiento, transacciones y reintentos; candidato de este incremento.

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
