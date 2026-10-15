# T1: persistir identidad interna y ámbito personal en PostgreSQL

Estado: integrado mediante [PR #2](https://github.com/eliancanul/AulaLista-SaaS/pull/2), main `a8dc576f041ca7cf6fd755a54a5027280c4e4f75`, con [CI postmerge success](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/38688115249). Dependencia: T0 integrado en `11c8d4d3e41295dbf5d49023f36b78f4eff1d1e0`. Spec: [0001](../specs/0001-fundacion.md). ADR: [0001](../adr/0001-fundacion-personal.md).

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


## Evidencia del candidato local (2026-10-15 UTC)

- Base: main `11c8d4d3e41295dbf5d49023f36b78f4eff1d1e0`; los 11 hashes de código T0 coinciden con la copia de origen.
- PostgreSQL 17.11 real, Python 3.12.14, uv 0.12.23; SQLAlchemy 2.1.4, psycopg 3.3.6 y Alembic 1.20.0 instalados desde lock.
- 64 tests pasan: 43 API/config y 21 PostgreSQL/seguridad de pruebas; lint, formato, compatibilidad y wheel/sdist pasan. Cero tests omitidos.
- Comandos y modelo de recursos: [desarrollo](../development.md). Migración `0001_personal_scope`; UUID en ambos conceptos y FK obligatoria/única.
- T1.1–T1.6 cubiertos localmente. T1.7 pendiente de revisión independiente, head final y checks remotos; no se atribuye CI remota a este candidato.
- PostgreSQL local se ejecutó desde paquetes oficiales Debian extraídos, sin Docker disponible. El workflow verifica la imagen oficial en CI; Compose local aún no se ha ejecutado en este entorno.
- Recuperación mínima: downgrade/upgrade probado únicamente en DB desechable marcada. Sin backups de producción, RLS, auth, fuentes, datos reales ni despliegue.


## Cierre de T1

El integrador confirmó revisión independiente y CI premerge/postmerge correctas
con 64 tests. El bloque de evidencia local anterior se conserva como historia;
sus pendientes remotos quedaron cerrados en PR #2. La ampliación T2 conserva
las 64 pruebas y sólo actualiza las expectativas del esquema/rutas añadidos.
