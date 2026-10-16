# Referencias e historial de cortes

Las tareas, prioridades, dependencias y estado se mantienen en [GitHub Issues](https://github.com/eliancanul/AulaLista-SaaS/issues). Este directorio conserva contratos de cortes, criterios de aceptación y evidencia histórica; no se elige ni actualiza trabajo desde una tabla de estados local. El [workflow](../workflow.md) define dónde registrar cada cambio.

## Trabajo en Issues

El [plan Acenta #12](https://github.com/eliancanul/AulaLista-SaaS/issues/12) es la entrada al recorrido conectado. Consulta allí la secuencia y el estado vigente; los enlaces siguientes son un mapa, no una copia del backlog:

- [B1 #13: acceso personal y sesión](https://github.com/eliancanul/AulaLista-SaaS/issues/13)
- [B2 #14: ajuste del ejemplo y resultado guardado](https://github.com/eliancanul/AulaLista-SaaS/issues/14)
- [B3 #15: edición, deshacer y guardado](https://github.com/eliancanul/AulaLista-SaaS/issues/15)
- [B4 #16: adjuntos de ejemplo](https://github.com/eliancanul/AulaLista-SaaS/issues/16)
- [B5 #17: biblioteca y contexto](https://github.com/eliancanul/AulaLista-SaaS/issues/17)
- [P1 #18: herramientas y contexto curricular](https://github.com/eliancanul/AulaLista-SaaS/issues/18)
- [P2 #19: puertas para archivos reales e IA](https://github.com/eliancanul/AulaLista-SaaS/issues/19), que referencia T4/T5 sin duplicar el contrato de evaluación

## Referencias técnicas conservadas

| Corte | Contrato o evidencia histórica |
|---|---|
| [T0](T0-bootstrap-api.md) | FastAPI reproducible y CI propia; PR #1 |
| [T1](T1-postgresql-ambito.md) | PostgreSQL, migraciones y ámbito personal; PR #2 |
| [T2](T2-fuentes-versionadas.md) | Fuente sintética durable e historial aislado; PR #3 |
| [T3](T3-prototipo-flujo-automatico.md) | Prototipo sintético, editable y recuperable en el navegador; PR #5 |
| [T4](T4-preparar-evaluacion.md) | Contrato de preparación de la comparación reproducible offline |
| [T4a](T4a-harness-offline.md) | Instrumento genérico y smoke sintético offline; PR #6 |
| [T4: puntuación](T4-scoring-duplicados.md) | Afirmaciones duplicadas y contradictorias; issue #7 y PR #8 |
| [T4: deduplicación](T4-dedup-dependencias.md) | Conservación de dependencias y metadata; issue #9 y PR #10 |
| [T5](T5-ensayo-interpretacion.md) | Contrato de ensayo autorizado y decisión basada en evidencia |

Las integraciones históricas se acreditan en cada PR y en los recibos enlazados desde estas referencias. Conservar un contrato o integrar una reparación del instrumento no acredita T4/T5 completos, H2, un benchmark real ni validación docente. Las nuevas decisiones técnicas se registran en specs/ADR, con enlaces desde el issue correspondiente.

## Límites técnicos de la fundación

La fundación se construyó en el orden T0 → T1 → T2. T0 y T1 son incrementos separados. Completar T1 no declara terminada la fundación ni permite sustituir PostgreSQL por SQLite. T2 mantiene su alcance sin UI, IA o cobro. El diseño/revisión del siguiente flujo y T4 offline pueden avanzar en paralelo; programar el prototipo requiere primero revisar contrato y recorrido H2.

[ADR 0002](../adr/0002-ux-interpretacion-automatica.md) y [spec 0002](../specs/0002-flujo-automatico-material.md) guían T3–T5: carga → resultado útil automáticamente guardado y editable, resolución automática primero y máximo una solicitud breve necesaria por planeación. No hay aprobación general ni cascada elegida. El peso confirmado del ahorro total de tokens es 20 %; el resto de la puntuación y sus umbrales están pendientes. Estos tickets no acreditan H2, benchmark ni validación docente completados.

T0–T2 constituyen trabajo técnico acotado. T2 no habilita acceso de docentes o archivos reales. Identidad y archivos reales se especifican después; precios pueden investigarse en paralelo sin introducir un motor de pagos.

El repositorio viejo permanece intacto. Las tareas del primer borrador que modificaban ADR de Django/escuelas sólo aplicaban a un arranque dentro de ese repositorio; aquí se reemplazan por ADR 0001 y los contratos versionados de este repositorio. No se arrastra su CI, candidate freeze o historial de tests como prueba.
