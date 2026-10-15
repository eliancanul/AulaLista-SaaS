# T1: persistir identidad interna y ámbito personal en PostgreSQL

Estado: pendiente. Dependencia: T0; puede incluir su bootstrap si se acuerda un único candidato. Spec: [0001](../specs/0001-fundacion.md). ADR: [0001](../adr/0001-fundacion-personal.md).

## Resultado

Desde PostgreSQL vacía y desechable se aplican migraciones versionadas. La DB impide ámbitos sin propietario o duplicados para el mismo principal. Readiness sólo responde disponible con conexión y esquema correctos.

## Alcance

1. SQLAlchemy, psycopg y Alembic, con versiones compatibles fijadas tras verificar instalación. Acceso síncrono y Session por operación.
2. PostgreSQL local/test reproducible. DSN requerido, tiempos de espera acotados y protección de limpieza para la base desechable.
3. Migración inicial de `Principal(id)` y `PersonalScope(id, owner_principal_id NOT NULL UNIQUE REFERENCES Principal)`; tipos elegidos y coherentes. Sin credenciales, correo obligatorio ni planes en Principal.
4. Readiness de conexión y revisión de esquema esperada. Migraciones explícitas, independientes del arranque de cada worker o request.
5. Ampliar la CI del backend con PostgreSQL real, migraciones y pruebas. Documentar los comandos verificados y recursos de prueba.

## Aceptación

- T1.1: una base vacía alcanza la revisión esperada con migraciones; repetir `upgrade head` no altera el resultado ni duplica registros.
- T1.2: PostgreSQL rechaza ámbito sin dueño, dueño inexistente y segundo ámbito del mismo dueño, incluso saltando validadores Python.
- T1.3: readiness responde 200 con DB/esquema correctos; 503 con DB caída o revisión incorrecta dentro del plazo configurado. Liveness sigue independiente.
- T1.4: falta de DSN o URL SQLite falla sin fallback ni exposición de secretos.
- T1.5: ninguna limpieza puede dirigirse por omisión a una DB normal. El test demuestra rechazo a un destino no identificado como desechable sin ejecutar destrucción.
- T1.6: no hay `create_all` sustituyendo migraciones, datos de demo en runtime ni login por header/ID fijo.
- T1.7: la CI falla si PostgreSQL no está disponible o no se ejecutan las pruebas previstas. Registrar tests, SHA de head/base y revisión independiente del candidato final.

## Fuera de alcance

Materiales, login/OIDC, UI, instituciones, RLS, parsing, IA, colas, cobro y despliegue. La ausencia de RLS no aprueba un piloto multicuenta.

## Recuperación y salida

Recrear exclusivamente la DB de prueba desde migraciones; comprobar que se recupera el esquema esperado. No llamar a esto backup/restore de producción. Entregar migración, pruebas reales, README y evidencia exacta según workflow. La siguiente entrega es T2.
