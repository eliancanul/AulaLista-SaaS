# AulaLista SaaS

Base de desarrollo de AulaLista SaaS para docentes individuales.

El proyecto está en desarrollo. Los incrementos de código y documentación se revisan mediante pull requests.

## Trabajo y documentación

- [GitHub Issues](https://github.com/eliancanul/AulaLista-SaaS/issues) concentra tareas, prioridades, dependencias y estado. El [plan Acenta #12](https://github.com/eliancanul/AulaLista-SaaS/issues/12) enlaza los cortes B1–B5 y la planificación posterior.
- Specs y ADR conservan contratos y decisiones; PR y CI acreditan cada candidato. Sigue el [workflow](docs/workflow.md) para desarrollar y entregar un cambio.
- [Referencias e historial de cortes](docs/tickets/README.md) conserva evidencia técnica, sin mantener un backlog paralelo.

## Acenta: capacidades verificadas y límites

Reconciliación documental del 17 de octubre de 2026 sobre
`1f9e7c23db7564049b68904db62f98b5730ee0b6`, árbol
`694da902b3d34b01148d8dc238283094f7b88c11`. Es un registro de evidencia;
el estado del trabajo permanece en [#12](https://github.com/eliancanul/AulaLista-SaaS/issues/12).

- B2: petición admitida, resultado fixture durable y consumidor Acenta conectados
  en [PR #21](https://github.com/eliancanul/AulaLista-SaaS/pull/21) y
  [#22](https://github.com/eliancanul/AulaLista-SaaS/pull/22).
- B3: edición, borrador y copia en
  [#25](https://github.com/eliancanul/AulaLista-SaaS/pull/25), guardia antes de logout
  en [#39](https://github.com/eliancanul/AulaLista-SaaS/pull/39) y respaldo de recarga
  en la misma pestaña/sesión en [#41](https://github.com/eliancanul/AulaLista-SaaS/pull/41).
  El respaldo usa `sessionStorage`, TTL fijo de hasta 24 h y sesión aún válida;
  no cubre recuperación de edición no confirmada tras 401/reautenticación.
  El usuario aceptó esta limitación para fase 1: tras login se recupera sólo lo
  confirmado en la biblioteca y pueden perderse cambios nunca guardados.
  La continuidad del texto no guardado se aplaza como mejora posterior trazable
  en [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15); no se implementó.
- B4: visor, original exacto y reemplazo de ejemplos en
  [#26](https://github.com/eliancanul/AulaLista-SaaS/pull/26).
- B5: biblioteca y navegación en [#27](https://github.com/eliancanul/AulaLista-SaaS/pull/27),
  catálogo independiente de originales en [#38](https://github.com/eliancanul/AulaLista-SaaS/pull/38).
- B1: Google tiene [aceptación manual registrada](https://github.com/eliancanul/AulaLista-SaaS/issues/13#issuecomment-6231320343)
  sobre `355399b6f01ea6985ebdb8389691fc532c993e5f`; no certifica todos los criterios
  de #13 ni un despliegue posterior. El usuario pospuso el envío real de OTP por
  correo; permanece deshabilitado. Las pruebas OTP sustituyen sólo ese transporte.

La [matriz de #12](docs/reviews/0001-matriz-fase1.md) distingue implementación,
evidencia compartida y huecos de aceptación: 38 asignaciones contractuales,
37 frames de diseño y una variante funcional inferida. No acredita 38 estados
visuales aprobados ni cierra la fase 1. La CI del SHA documentado está en
[backend](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/39058555388),
[web](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/39058555523) y
[evaluación](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/39058555484);
no sustituye revisión ni CI de un candidato nuevo.

[#18](https://github.com/eliancanul/AulaLista-SaaS/issues/18) y
[#19](https://github.com/eliancanul/AulaLista-SaaS/issues/19) pertenecen a una fase
posterior. Los controles offline de integridad, evidencia literal y anclas/anexos
integrados en [#45](https://github.com/eliancanul/AulaLista-SaaS/pull/45),
[#46](https://github.com/eliancanul/AulaLista-SaaS/pull/46) y
[#47](https://github.com/eliancanul/AulaLista-SaaS/pull/47) no habilitan documentos
reales, parsing o IA en el producto. No hay cobro ni piloto docente acreditados.

## Planeación guiada: corte manual de #52

El formulario de Planeación de clase admite una fixture de software explícita
sin adjuntar fuente: Ciencias naturales, 3.º de primaria y cuidado del agua.
Conserva contexto manual/hipotético y referencia opcional exacta; abre primero
un lector de escritorio o móvil y permite correcciones básicas durables con B3.
Otros valores reciben un rechazo claro y permanecen en el formulario. No es
un generador general, una selección curricular oficial ni validación pedagógica.
[Contrato, pruebas y límites](web/README.md#planeación-guiada-52) describen el corte;
su PR y CI deben acreditar el candidato exacto, sin trasladar la evidencia anterior.

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

T0–T3 preceden al recorrido conectado descrito arriba. Sus pruebas no acreditan
interpretación real ni validación con docentes; H2 conserva sus criterios humanos.
El [registro B2](docs/tickets/B2-resultado-simulado.md) conserva el contrato original
de resultado fixture durable y recibo independiente. Docentes individuales,
suscripción con precio pendiente e inicio limpio siguen como alcance de producto.

## Arranque y pruebas

La [preparación Pydantic y Promptfoo](evaluation/promptfoo/README.md) valida el
contrato de resultado existente y prueba adaptadores Python locales. La ejecución
de Promptfoo queda bloqueada por solicitudes de red incluso con telemetría
desactivada; este corte no instala ni ejecuta su CLI.

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

- [Interfaz Acenta: ejecutar, probar y conocer límites](web/README.md)
- [Instrucciones de contribución](AGENTS.md)
- [Decisión de fundación](docs/adr/0001-fundacion-personal.md)
- [Contrato de fundación](docs/specs/0001-fundacion.md)
- [Dirección UX y decisión de interpretación](docs/adr/0002-ux-interpretacion-automatica.md)
- [Flujo automático y plan de evaluación](docs/specs/0002-flujo-automatico-material.md)
- [Herramientas y contexto curricular](docs/specs/0010-herramientas-contexto-curricular.md): diseño aprobado de #18; #52 implementa únicamente el corte manual/fixture de Planeación.
- [Tareas y dependencias actuales](https://github.com/eliancanul/AulaLista-SaaS/issues)
- [Referencias e historial de cortes](docs/tickets/README.md)
- [Workflow y evidencia](docs/workflow.md)
- [Consultas por hitos](docs/reviews/README.md)
- [Registro de coordinación](docs/reviews/0000-coordinacion.md)

## Fuentes y límites

Los contratos de producto proceden de [AulaLista #165](https://github.com/eliancanul/AulaLista/issues/165) y [#166](https://github.com/eliancanul/AulaLista/issues/166). El integrador verificó los enlaces y su correspondencia con conservación de originales, versiones y autoridad el 15 de octubre de 2026 UTC. Las decisiones actuales de público, stack e inicio limpio prevalecen sobre hipótesis históricas institucionales o de migración.

Este repositorio nuevo conserva esos contratos sin copiar código, fixtures, dumps ni documentos privados del anterior, que permanece intacto. Si se decide reutilizar un artefacto después, se revisan expresamente propósito, procedencia, licencia y datos.


## Autenticación y configuración (B1 / #13)

El [contrato B1](docs/specs/0005-autenticacion-local.md) define Google Identity
Services directo, OTP de correo, sesión propia revocable y ámbito personal.
Sin configuración explícita el servidor falla cerrado; el repositorio no contiene
credenciales ni proveedor de correo runtime. La aceptación manual de Google y la
postergación del correo se distinguen arriba de la evidencia sintética. La
vinculación de métodos sigue pendiente y nunca ocurre por coincidencia de email.
