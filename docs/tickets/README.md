# Tickets: fundación y primer recorrido

Estado (2026-10-15 UTC): T0/T1/T2 y el prototipo sintético T3 integrados.
[PR #5](https://github.com/eliancanul/AulaLista-SaaS/pull/5) produjo el commit
`d58255bcaa71e874d69022e0e96a7a59adfd0a70`; [T3](T3-prototipo-flujo-automatico.md)
registra revisión independiente y CI premerge/postmerge correctas. T4/T5, el flujo
real y la validación docente permanecen pendientes; H2 no está cerrado.

| Ticket | Resultado | Dependencia | Estado |
|---|---|---|---|
| [T0](T0-bootstrap-api.md) | FastAPI reproducible y CI propia | Entorno/escritor confirmados | Integrado, PR #1 |
| [T1](T1-postgresql-ambito.md) | PostgreSQL, migraciones y ámbito personal | T0 integrado | Integrado, PR #2 |
| [T2](T2-fuentes-versionadas.md) | Fuente sintética durable e historial aislado | T1 integrado | Integrado, PR #3; CI postmerge correcta |
| [T3](T3-prototipo-flujo-automatico.md) | Prototipo sintético automático, editable y recuperable | ADR/spec 0002 y revisión previa del flujo H2; T2 para persistencia real | Integrado, PR #5; persistencia local y CI postmerge correcta |
| [T4](T4-preparar-evaluacion.md) | Comparación preparada y reproducible offline | Tarea/salida de spec 0002; paralelo a T3 | Pendiente |
| [T4a](T4a-harness-offline.md) | Instrumento genérico y smoke sintético offline | T4/spec 0002; sin dependencia de modelos | Implementado; aceptación, CI e integración en el PR asociado |
| [T5](T5-ensayo-interpretacion.md) | Ensayo y decisión de estrategia | T4 y autorización aplicable a cada ejecución/destino | Pendiente |

El orden técnico es T0 → T1 → T2. T0 y T1 son incrementos separados. Completar T1 no declara terminada la fundación ni permite sustituir PostgreSQL por SQLite. T2 mantiene su alcance sin UI, IA o cobro. El diseño/revisión del siguiente flujo y T4 offline pueden avanzar en paralelo; programar el prototipo requiere primero revisar contrato y recorrido H2.

[ADR 0002](../adr/0002-ux-interpretacion-automatica.md) y [spec 0002](../specs/0002-flujo-automatico-material.md) guían T3–T5: carga → resultado útil automáticamente guardado y editable, resolución automática primero y máximo una solicitud breve necesaria por planeación. No hay aprobación general ni cascada elegida. El peso confirmado del ahorro total de tokens es 20 %; el resto de la puntuación y sus umbrales están pendientes. Estos tickets no acreditan H2, benchmark ni validación docente completados.

T0–T2 constituyen trabajo técnico acotado. T2 no habilita acceso de docentes o archivos reales. Identidad y archivos reales se especifican después; precios pueden investigarse en paralelo sin introducir un motor de pagos.

El repositorio viejo permanece intacto. Las tareas del primer borrador que modificaban ADR de Django/escuelas sólo aplicaban a un arranque dentro de ese repositorio; aquí se reemplazan por ADR 0001 y esta documentación activa. No se arrastra su CI, candidate freeze o historial de tests como prueba.
