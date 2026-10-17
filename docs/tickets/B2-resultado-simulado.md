# B2: candidato backend independiente de identidad (#14)

Registro histórico de preparación del 2026-10-16 UTC. Las menciones de ausencia de publicación/CI describen ese corte original. El estado actual se consulta en [#14](https://github.com/eliancanul/AulaLista-SaaS/issues/14) y en su PR; la [spec 0003](../specs/0003-edicion-durable.md) documenta el fixture adicional y la edición posteriores.

El backend se integró en [PR #21](https://github.com/eliancanul/AulaLista-SaaS/pull/21)
y su consumidor UI/HTTP en [#22](https://github.com/eliancanul/AulaLista-SaaS/pull/22).
Las restricciones históricas de identidad/UI descritas abajo no representan su
estado actual. Consulta [B1](../specs/0005-autenticacion-local.md) para sesión y
la [matriz #12](../reviews/0001-matriz-fase1.md) para evidencia y pendientes.

Base: `d611d8faf54fde3efd64a4c866d327c90679ab56`. Autor: agente cloud,
checkout `/workspace/AulaLista-SaaS`, rama local `work`, escritor único.
Sin publicación autorizada. No cierra #14: identidad #13 y consumidor Acenta/UI
siguen pendientes. No se modifica T3 ni se afirma compatibilidad visual.

## Contrato v1 fijado antes de implementar

- `POST /scopes/{scope_id}/plannings`, JSON UTF-8 de hasta 4096 bytes,
  `Idempotency-Key` UUID. Campos obligatorios, sin extras: `contract_version: 1`,
  `fixture_context: "timing-example-v1"`, `prompt` (1–256 caracteres),
  `source_id` UUID y `expected_source_version` entero 1–2147483646.
- Única petición admitida: `Ajusta el ejemplo a 40 minutos.`. El fixture nuevo
  independiente contiene una actividad sintética de clasificación de figuras
  de 50 minutos; devuelve apertura 5, clasificación 25 y cierre 10 minutos.
  No interpreta bytes T2: exige igualdad exacta con los bytes fixture publicados
  en `planning_fixture.py`. Cualquier otro contenido/petición da 422
  `unsupported_fixture`, sin resultado. No se aceptan documentos privados.
- Referencia a fuente propia T2 y versión actual esperada. CAS serializado con
  append T2: revisión obsoleta da 409; original intacto. Autorización dentro de
  transacción precede replay; replay precede CAS y validación fixture.
- Respuesta 201 tras commit: `receipt` v1 con namespace `planning-v1`, identidad
  de planeación, revisión independiente 1, ID de revisión, ámbito/actor/operación,
  fecha UTC, fuente/versión exacta/hash; `request` y `result` sintético guardados.
  La identidad de planeación es distinta de archivo, revisión y operación.
- `GET /scopes/{scope_id}/plannings/{planning_id}` y
  `GET /scopes/{scope_id}/planning-operations/{operation_id}` recuperan exactamente
  ese documento sin ejecutar generador. Respuestas privadas `no-store`.
- Namespace, huella y unicidad de operación independientes de T2: la misma UUID
  puede existir en ambos, sin consultar ni devolver el recibo de la otra clase.
  Huella SHA256 de `aulalista-planning-request-v1\0` + JSON canónico de la petición
  (claves ordenadas, compacto, UTF-8, sin escapes ASCII). Clave distinta crea una
  nueva planeación; misma clave/petición recupera original; payload distinto 409.
- Runtime conserva 401 sin bypass. 404 uniforme ajeno/ausente; 409 conflicto;
  413 exceso; 415 tipo; 422 entrada inválida; 503 persistencia. Un 404 de recibo
  sólo indica ausencia visible: una operación concurrente puede seguir pendiente.
  Recuperación del consumidor futuro: consulta acotada + replay exacto con misma
  clave, conservar pendiente si sigue incierto; no crear nueva clave por timeout.
- Fuente, planeación, revisión/recibo coherentes por FK compuestas y transacción.
  Historia inmutable por permisos y trigger; fallo COMMIT revierte todo el resultado.
  Sin chat general, cola, parser, IA, llamadas externas ni credenciales.

## Verificación prevista

PostgreSQL real con runtime no dueño: migración/downgrade, grants, FK entre
ámbitos, inmutabilidad, HTTP/restart, replay/namespace, CAS, carrera de misma
clave, fallo diferido COMMIT, transporte perdido, denegación runtime, límites y
entradas no soportadas. Revisión adversarial independiente del candidato exacto;
CI remota pendiente porque no se publica. Evidencia final separada al terminar.
