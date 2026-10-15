# Especificación 0001: fuente personal recuperable

Estado: contrato de T0–T2, integrados. Último main
`b4dd71e2bca607f6b6cce04d77bec92db2fc7dba` mediante
[PR #3](https://github.com/eliancanul/AulaLista-SaaS/pull/3).
El cierre de [T2](../tickets/T2-fuentes-versionadas.md) registra revisión
independiente/H1 y CI premerge/postmerge correctas para los candidatos registrados.
Fuentes de alcance: README y ADR 0001.

## Resultado

Un test HTTP guarda una fuente sintética del principal A, reinicia la aplicación y recupera exactamente sus bytes desde una nueva Session. Añade V2 y conserva V1. El principal B no puede leer ni modificar esa fuente. El servidor normal sigue sin aceptar operaciones privadas porque aún no tiene autenticación real.

## Contratos

### Salud y configuración

Liveness sólo informa de la vida del proceso. Readiness de persistencia existe a partir de T1: verifica conexión y revisión de esquema esperada en un plazo acotado, responde 200 si ambas son válidas y 503 si no. No devuelve secretos ni detalles internos. Ausencia de DSN obligatorio o motor distinto de PostgreSQL falla claramente en T1. Las migraciones son un paso explícito; ningún request las ejecuta.

### Propiedad

Un principal tiene como máximo un ámbito personal; cada ámbito tiene exactamente un propietario existente. Cada recurso privado pertenece a un ámbito no nulo. El caso de uso comprueba autoridad dentro de la operación; campos, headers o IDs suministrados por el cliente no crean autoridad. Recurso ajeno e inexistente producen el mismo 404 sin contenido ni metadatos privados.

### Fuente e historia

`Source` identifica el material y su ámbito. `SourceVersion` identifica la fuente y ámbito coherentes, número de versión, bytes, tamaño y SHA-256 calculados por servidor, actor, momento y operación creadora. El contenido es opaco y sintético; no se analiza ni ejecuta. La procedencia sintética no acredita licencia de documentos futuros ni consentimiento para entrenar.

En este corte, «confirmada» significa persistida mediante commit; no supone aceptación docente ni añade una aprobación al recorrido futuro de [spec 0002](0002-flujo-automatico-material.md). T2 conserva fuentes/versiones internas y no selecciona cómo se interpretarán.

La revisión actual puede avanzar; una versión confirmada conserva sus bytes y metadatos. La DB rechaza referencias cruzadas entre ámbitos y números duplicados. La protección frente a update/delete se prueba con el rol runtime previsto, sin privilegios de dueño o bypass. No se ofrece borrado en este corte.

### Escritura y recibo

Operaciones: crear fuente/V1, añadir versión propia indicando revisión esperada, leer una versión exacta y recuperar el recibo de una operación propia. La clave de operación es única por ámbito. La huella comprende operación, destino, bytes y revisión esperada, con representación determinista documentada.

- Misma clave y misma solicitud confirmada: mismo resultado, incluso si la revisión actual ya avanzó.
- Misma clave y solicitud distinta: 409 sin efectos.
- Nueva operación con revisión obsoleta: 409 sin efectos.
- Respuesta perdida tras commit: el recibo permite recuperar la operación original con autorización revalidada.
- Fallo anterior al commit: ninguna fuente vacía, versión parcial o recibo exitoso.
- Dos conexiones que avanzan la misma revisión: una confirma y otra recibe conflicto; nunca dos ganadoras.

El recibo puede vivir en la propia versión si satisface el contrato. No hace falta un motor genérico de idempotencia.

### Límites y privacidad

Admitir entre 1 y 65 536 bytes por versión sintética, incluidos extremos. Rechazar exceso antes de retener una entrada ilimitada; aplicar límite también a transferencia de tamaño no declarado. Respuestas y logs no exponen DSN, credenciales, documentos ni stack traces públicos. Fixtures sin datos de personas o material docente privado.

## Qué acredita cada tramo

- T0: instalación, arranque mínimo y comprobaciones propias del backend.
- T1: configuración de PostgreSQL, migraciones, salud de DB y restricciones de ámbito.
- T2: fuente durable, historia, autoridad, transacciones, reintentos y concurrencia reales.

Cada ticket añade pruebas al mismo contrato y CI. Las comprobaciones omitidas no cuentan como éxito. Tests sintéticos no acreditan calidad pedagógica, UX validada o aptitud para producción.

## Puertas posteriores

Antes de un piloto: identidad real y sesión revocable; autorización de cada recurso; aislamiento reforzado y conexiones recicladas; archivos privados y sus límites; política de datos/destinos; parser aislado; restore conjunto de DB/objetos y revocaciones. Antes de cobrar: precio y unidad de servicio, impuestos, cancelación, reembolso y derechos ante impago. Cada puerta tendrá tickets propios antes de implementarse.
