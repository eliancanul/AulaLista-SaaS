# AulaLista-SaaS

## Antes de modificar

1. Lee [README](README.md) para las capacidades y límites comprobados y [ADR 0001](docs/adr/0001-fundacion-personal.md) para decisiones vigentes.
2. Escoge una tarea en [GitHub Issues](https://github.com/eliancanul/AulaLista-SaaS/issues). Revisa su estado, dependencias, aceptación y specs/ADR enlazados antes de escribir código. [docs/tickets](docs/tickets/README.md) conserva referencias técnicas e historial; no es el backlog activo.
3. Identifica autor, rama/directorio y archivos del cambio. Mantén un único escritor por archivo; coordina directamente con otros agentes cuando compartan una frontera.

## Entregar un cambio

Sigue [workflow](docs/workflow.md): especificación → issue pequeño → pruebas → revisión adversarial independiente → CI del candidato exacto → integración autorizada. Mantén tareas, prioridades, dependencias y estado en Issues; contratos/decisiones en specs/ADR; evidencia del candidato en PR y CI. Una revisión pasada pierde vigencia cuando cambia su candidato.

Resuelve el comportamiento completo con el menor cambio claro. Reutiliza código del repositorio y dependencias justificadas; introduce abstracciones sólo para una frontera presente. Conserva validación, seguridad, errores que evitan pérdida de datos y accesibilidad. Toda lógica no trivial tiene una prueba que falle si se rompe su garantía.

## Fronteras

- FastAPI y PostgreSQL; recursos privados con ámbito personal obligatorio y propietario explícito.
- Identidad del actor, propiedad del material y eventual pagador son conceptos distintos.
- Comienza con código y datos sintéticos nuevos. El repositorio anterior sólo aporta contratos de producto revisados; sus checks no certifican éste.
- Las operaciones privadas exigen una sesión válida y autorización del ámbito; sin configuración auth el servidor falla cerrado. Los actores de test viven exclusivamente en fixtures/overrides de test. Consulta el [contrato B1](docs/specs/0005-autenticacion-local.md) y los límites vigentes del [recorrido Acenta](web/README.md).
- Consulta [especificación](docs/specs/0001-fundacion.md) al tocar autorización, persistencia, versiones o reintentos. PostgreSQL real verifica restricciones y carreras.
- Consulta [revisiones por hitos](docs/reviews/README.md) al completar dos tickets, cambiar una decisión de producto o cruzar un hito. Los roles son perspectivas de análisis asistidas por IA, no personas contratadas.
- Consulta [workflow](docs/workflow.md) antes de publicar: permisos vigentes, diff completo, ausencia de secretos/datos privados y evidencia exacta. Este archivo no concede autorización para publicar, hacer merge, desplegar, contratar ni ampliar accesos.

## Comunicación

Consultores, implementadores y revisores pueden hablar directamente. Toda decisión que cambie alcance, contrato, pruebas o riesgo queda en el issue, spec/ADR o PR correspondiente y se comunica al coordinador. El implementador no sustituye al revisor independiente ni resuelve hallazgos únicamente por acuerdo verbal.

## Límites de los cortes

La fundación T0–T2 no acreditaba UI ni autenticación. Acenta B1–B5 incorpora el recorrido conectado con ejemplos y sesión, con pendientes explícitos en [#12](https://github.com/eliancanul/AulaLista-SaaS/issues/12). Precios, cobro, documentos reales, parsing, IA y migración de datos conservan sus puertas posteriores. No declares completa la fase 1, producción o un piloto por integrar un incremento o por superar CI.
