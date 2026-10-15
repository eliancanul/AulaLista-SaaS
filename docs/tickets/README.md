# Tickets de fundación

Estado al congelar documentación v2: T0 implementado localmente; autor reporta 21 tests, lint, formato y build correctos. Revisión independiente de código y CI remota pendientes. T1/T2 siguen especificados y pendientes de implementación. Actualizar cada estado con evidencia del candidato exacto.

| Ticket | Resultado | Dependencia | Estado |
|---|---|---|---|
| [T0](T0-bootstrap-api.md) | FastAPI reproducible y CI propia | Entorno/escritor confirmados | Implementado localmente; revisión y CI pendientes |
| [T1](T1-postgresql-ambito.md) | PostgreSQL, migraciones y ámbito personal | T0 o bootstrap incluido en el mismo candidato | Pendiente |
| [T2](T2-fuentes-versionadas.md) | Fuente sintética durable e historial aislado | T1 | Pendiente |

El orden es T0 → T1 → T2. Se puede incorporar T0 dentro de T1 si sigue siendo un cambio comprensible y comprobable. Separarlo no permite declarar terminada la fundación ni sustituir PostgreSQL por SQLite. T1 es el siguiente corte inmediato, sin interponer UI, IA o cobro.

Los tres tramos constituyen trabajo técnico acotado. T2 no habilita acceso de docentes o archivos reales. Identidad y archivos reales se especifican después; precios pueden investigarse en paralelo sin introducir un motor de pagos.

El repositorio viejo permanece intacto. Las tareas del primer borrador que modificaban ADR de Django/escuelas sólo aplicaban a un arranque dentro de ese repositorio; aquí se reemplazan por ADR 0001 y esta documentación activa. No se arrastra su CI, candidate freeze o historial de tests como prueba.
