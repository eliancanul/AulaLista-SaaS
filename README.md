# AulaLista SaaS

Base de desarrollo de AulaLista SaaS para docentes individuales.

El proyecto está en desarrollo. Los incrementos de código y documentación se revisan mediante pull requests.

## Trabajo y documentación

- [GitHub Issues](https://github.com/eliancanul/AulaLista-SaaS/issues) concentra tareas, prioridades, dependencias y estado. El [plan Acenta #12](https://github.com/eliancanul/AulaLista-SaaS/issues/12) enlaza los cortes B1–B5 y la planificación posterior.
- Specs y ADR conservan contratos y decisiones; PR y CI acreditan cada candidato. Sigue el [workflow](docs/workflow.md) para desarrollar y entregar un cambio.
- [Referencias e historial de cortes](docs/tickets/README.md) conserva evidencia técnica, sin mantener un backlog paralelo.

## Historial técnico del primer corte

T0, T1 y T2 están integrados; [PR #3](https://github.com/eliancanul/AulaLista-SaaS/pull/3)
integró T2 en `b4dd71e2bca607f6b6cce04d77bec92db2fc7dba`. T2 conserva fuentes
sintéticas opacas de 1 a 65 536 bytes, versiones inmutables, recibos recuperables,
propiedad personal y concurrencia transaccional. Revisión independiente/H1 y
[CI premerge, 114 pruebas](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/38690972072)
constan en el cierre de [T2](docs/tickets/T2-fuentes-versionadas.md).
[CI postmerge correcta](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/38691499410)
verifica ese commit, 114 pruebas y logs de PostgreSQL.

[T3](docs/tickets/T3-prototipo-flujo-automatico.md) está integrado mediante
[PR #5](https://github.com/eliancanul/AulaLista-SaaS/pull/5), commit
`d58255bcaa71e874d69022e0e96a7a59adfd0a70`. La revisión independiente y CI
postmerge verificaron 114 pruebas backend, 31 unitarias frontend y ocho recorridos
Chromium. El prototipo usa ejemplos sintéticos y guardado local en el navegador.

El servidor normal devuelve 401 en todas las operaciones privadas: todavía no hay
identidad real. Sólo los tests inyectan actores y usan un rol DB runtime distinto
del dueño de migraciones. No hay UI de producto conectada al servidor, documentos reales, parsing, IA, cobro ni piloto
habilitado. El [prototipo sintético local](web/README.md) no acredita interpretación
real, persistencia de cuenta ni validación con docentes; H2 sigue abierto.
Docentes individuales, suscripción con precio pendiente e inicio
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

## Alcance de los contratos

T0 por sí solo no prueba persistencia. T1 no almacena materiales. T2 completa el primer corte técnico, sin habilitar un piloto con documentos reales. Las pruebas de persistencia requieren PostgreSQL desechable, sin sustitución por SQLite.

El contrato del recorrido prioriza mínima fricción: resolver automáticamente primero, preferentemente con LLM dentro de límites y permisos; cero preguntas por defecto y máximo una solicitud breve necesaria por planeación, persistente entre archivos, versiones, sesiones y reintentos. No exige aceptación de etapas, bloques o conjunto. [ADR 0002](docs/adr/0002-ux-interpretacion-automatica.md) confirma esta dirección y el peso del 20 % al ahorro total de tokens; estrategia, demás pesos, fórmula y umbrales siguen abiertos. Preparar el prototipo y la evaluación no implica contratar servicios, enviar documentos ni habilitar un piloto.

## Documentación

- [Prototipo sintético local: ejecutar y probar](web/README.md)
- [Instrucciones de contribución](AGENTS.md)
- [Decisión de fundación](docs/adr/0001-fundacion-personal.md)
- [Contrato de fundación](docs/specs/0001-fundacion.md)
- [Dirección UX y decisión de interpretación](docs/adr/0002-ux-interpretacion-automatica.md)
- [Flujo automático y plan de evaluación](docs/specs/0002-flujo-automatico-material.md)
- [Tareas y dependencias actuales](https://github.com/eliancanul/AulaLista-SaaS/issues)
- [Referencias e historial de cortes](docs/tickets/README.md)
- [Workflow y evidencia](docs/workflow.md)
- [Consultas por hitos](docs/reviews/README.md)
- [Registro de coordinación](docs/reviews/0000-coordinacion.md)

## Fuentes y límites

Los contratos de producto proceden de [AulaLista #165](https://github.com/eliancanul/AulaLista/issues/165) y [#166](https://github.com/eliancanul/AulaLista/issues/166). El integrador verificó los enlaces y su correspondencia con conservación de originales, versiones y autoridad el 15 de octubre de 2026 UTC. Las decisiones actuales de público, stack e inicio limpio prevalecen sobre hipótesis históricas institucionales o de migración.

Este repositorio nuevo conserva esos contratos sin copiar código, fixtures, dumps ni documentos privados del anterior, que permanece intacto. Si se decide reutilizar un artefacto después, se revisan expresamente propósito, procedencia, licencia y datos.
