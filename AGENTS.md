# AulaLista-SaaS

## Antes de modificar

1. Lee [README](README.md) para el estado comprobado y [ADR 0001](docs/adr/0001-fundacion-personal.md) para decisiones vigentes.
2. Escoge un ticket en [fundación](docs/tickets/README.md). Lee su especificación, dependencias y aceptación antes de escribir código.
3. Identifica autor, rama/directorio y archivos del cambio. Mantén un único escritor por archivo; coordina directamente con otros agentes cuando compartan una frontera.

## Entregar un cambio

Sigue [workflow](docs/workflow.md): especificación → ticket pequeño → pruebas → revisión adversarial independiente → CI del candidato exacto → integración autorizada. Registra evidencia y pendientes en el ticket o PR. Una revisión pasada pierde vigencia cuando cambia su candidato.

Resuelve el comportamiento completo con el menor cambio claro. Reutiliza código del repositorio y dependencias justificadas; introduce abstracciones sólo para una frontera presente. Conserva validación, seguridad, errores que evitan pérdida de datos y accesibilidad. Toda lógica no trivial tiene una prueba que falle si se rompe su garantía.

## Fronteras

- FastAPI y PostgreSQL; recursos privados con ámbito personal obligatorio y propietario explícito.
- Identidad del actor, propiedad del material y eventual pagador son conceptos distintos.
- Comienza con código y datos sintéticos nuevos. El repositorio anterior sólo aporta contratos de producto revisados; sus checks no certifican éste.
- Hasta completar identidad real, las operaciones privadas del servidor normal deniegan acceso. Los actores de test viven exclusivamente en fixtures/overrides de test.
- Consulta [especificación](docs/specs/0001-fundacion.md) al tocar autorización, persistencia, versiones o reintentos. PostgreSQL real verifica restricciones y carreras.
- Consulta [revisiones por hitos](docs/reviews/README.md) al completar dos tickets, cambiar una decisión de producto o cruzar un hito. Los roles son perspectivas de análisis asistidas por IA, no personas contratadas.
- Consulta [workflow](docs/workflow.md) antes de publicar: permisos vigentes, diff completo, ausencia de secretos/datos privados y evidencia exacta. Este archivo no concede autorización para publicar, hacer merge, desplegar, contratar ni ampliar accesos.

## Comunicación

Consultores, implementadores y revisores pueden hablar directamente. Toda decisión que cambie alcance, contrato, pruebas o riesgo queda en el ticket/ADR/PR y se comunica al coordinador. El implementador no sustituye al revisor independiente ni resuelve hallazgos únicamente por acuerdo verbal.

## Fuera del primer corte

Precios, cobro, UI, autenticación de producción, documentos reales, parsing, IA, infraestructura contratada y migración de datos tienen puertas posteriores. No los declares listos por completar la fundación.
