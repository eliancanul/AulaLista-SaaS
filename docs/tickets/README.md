# Tickets de fundación

Estado de T1 (2026-10-15 UTC): T0 integrado mediante [PR #1](https://github.com/eliancanul/AulaLista-SaaS/pull/1), base `11c8d4d3e41295dbf5d49023f36b78f4eff1d1e0`. T1 tiene candidato local con 64 tests, lint, formato y build correctos; revisión independiente y CI remota del SHA final pendientes. T2 sigue pendiente de implementación.

| Ticket | Resultado | Dependencia | Estado |
|---|---|---|---|
| [T0](T0-bootstrap-api.md) | FastAPI reproducible y CI propia | Entorno/escritor confirmados | Integrado, PR #1 |
| [T1](T1-postgresql-ambito.md) | PostgreSQL, migraciones y ámbito personal | T0 integrado | Candidato local; revisión y CI pendientes |
| [T2](T2-fuentes-versionadas.md) | Fuente sintética durable e historial aislado | T1 | Pendiente |

El orden es T0 → T1 → T2. T0 y T1 son incrementos separados. Completar T1 no declara terminada la fundación ni permite sustituir PostgreSQL por SQLite. El siguiente corte es T2, sin interponer UI, IA o cobro.

Los tres tramos constituyen trabajo técnico acotado. T2 no habilita acceso de docentes o archivos reales. Identidad y archivos reales se especifican después; precios pueden investigarse en paralelo sin introducir un motor de pagos.

El repositorio viejo permanece intacto. Las tareas del primer borrador que modificaban ADR de Django/escuelas sólo aplicaban a un arranque dentro de ese repositorio; aquí se reemplazan por ADR 0001 y esta documentación activa. No se arrastra su CI, candidate freeze o historial de tests como prueba.
