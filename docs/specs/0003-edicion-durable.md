# Especificación 0003: edición durable (B3)

Corte de preparación: 2026-10-16 UTC. Las menciones de ausencia de publicación reflejan el estado al preparar este contrato; el estado y la evidencia actuales se registran en [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15) y en su PR.

Ticket y aceptación: [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15).
Este documento fija el contrato implementado; estado y cierre pertenecen al issue
y al PR con CI del candidato exacto. No sustituye la revisión independiente.

Base de implementación: `d611d8faf54fde3efd64a4c866d327c90679ab56` más el candidato
B2 recuperado. B2 `timing-example-v1` conserva fuente, prompt y resultado. Este
corte añade el delta visual #14 y B3 sin reimplementar B2. La app normal continúa
denegando operaciones privadas con 401; sólo los tests inyectan actores. No hay
identidad real, parser, IA, credenciales, publicación ni despliegue en este corte.

## Delta #14: fixture visual adicional

`water-observation-v1` está definido íntegramente en
`src/aulalista_api/water_fixture.py`: bytes UTF-8 sintéticos propios, prompt exacto
«Hoy tengo 30 minutos. Ajusta los tiempos sin cambiar mis materiales.» y resultado
«Agua que cambia». No son bytes PDF ni interpretación de un archivo adjunto.
La ruta B2 existente comprueba tupla exacta contexto/prompt/fuente propia T2 y CAS
de la fuente, sin admitir documentos libres.

El resultado declara `provenance`, `notice`, contexto Primaria/4.º A/Ciencias,
materiales y tiempos Activar 10→5, Explorar 25→18, Cerrar 10→7 minutos. Total
45→30. Conserva claves estables de actividades y recurso `observation-sheet`:

- `instruction`: statement editable «Observa el vaso. Describe lo que ves.»
- `question`: pregunta no editable «¿Qué observaste? ¿Qué cambió?», dos líneas.

La identidad del recurso es planeación + `resource_key`; no se inventa una
identidad de archivo. La UI consume el payload, sin adaptar figuras de 40 minutos
para aparentar este resultado. El fixture anterior y sus pruebas permanecen.

## Peticiones y respuestas

Todas las escrituras B3 requieren `Idempotency-Key` UUID y Content-Type exacto
`application/json`, body UTF-8 acotado a 8192 bytes incluso sin Content-Length.
Esquemas estrictos sin extras. Campos comunes:

```json
{
  "contract_version": 1,
  "resource_key": "observation-sheet",
  "element_key": "instruction",
  "text": "Observa el vaso y describe sus cambios."
}
```

`text`: 1–1000 caracteres, no vacío/blanco ni NUL/surrogates inválidos. Se conserva
exactamente, sin trim ni normalización. Sólo se modifica un elemento declarado
editable de tipo statement; no es JSON Patch ni edición libre de campos.

### Guardar una revisión confirmada

`POST /scopes/{scope_id}/plannings/{planning_id}/revisions`: campos comunes más
`expected_revision` entero estricto 1–2147483646. CAS transaccional: una sola
conexión gana sobre la misma base; conflicto no cambia puntero, historia ni copia
de trabajo. Guardar el mismo texto sobre la revisión vigente devuelve 422
`unchanged_text` sin historia nueva; sobre una base superada devuelve 409.

Responde 201, también replay, con el documento B2 `receipt`, `request`, `result`.
`request` guarda los campos aceptados, `kind: "edit"` e `initial_request` (petición
B2 original recuperada desde la base inmutable). El documento también expone
`initial_request` para representar el prompt original sin confundirlo con la
escritura actual; permanece igual al editar o copiar repetidamente.
`receipt.revision` aumenta,
`revision_id` y operación identifican esa escritura exacta. Fuente T2 y versión
original permanecen iguales aunque T2 tenga una versión posterior.

`GET /scopes/{scope_id}/plannings/{planning_id}` devuelve la revisión vigente.
`GET /scopes/{scope_id}/plannings/{planning_id}/revisions/{number}` devuelve la
revisión exacta. `GET /scopes/{scope_id}/planning-operations/{operation_id}`
devuelve el documento de esa operación, nunca sustituido por una revisión nueva.
Crear, editar y copiar comparten namespace `planning-v1` y unicidad por ámbito;
huellas distintas impiden confundir clases o destinos con una misma UUID.

### Conservar copia tras conflicto

`POST /scopes/{scope_id}/plannings/{planning_id}/copies`: campos comunes más
`base_revision` entero estricto 1–2147483646. Admite una base propia superada:
construye el derivado de esa revisión exacta y del enunciado local, sin merge.

201 devuelve documento con nueva planeación/revisión 1 y campo adicional:

```json
{
  "origin": {
    "planning_id": "UUID de origen",
    "revision_id": "UUID de revisión de origen",
    "revision": 1
  }
}
```

`request.kind` es `copy`; `request.origin` y la FK inmutable registran el origen.
La FK obliga origen, copia y fuente exacta a compartir ámbito y versión T2.
Editar el derivado conserva ese origen; copiar un derivado registra su origen
inmediato, cuya historia permite continuar la cadena. El original no cambia.
Misma clave y payload devuelve la misma copia, también tras respuesta perdida.

### Conservar borrador privado

`PUT /scopes/{scope_id}/plannings/{planning_id}/drafts/{draft_id}`: campos comunes
más `base_revision` y `expected_draft_revision` (entero estricto 0–2147483646).
`draft_id` es una UUID estable de esa copia de trabajo elegida por cliente. Crear
requiere expected 0 y conserva la unicidad global de esa identidad. Actualizar
exige su revisión vigente: un destino ausente o ajeno devuelve el mismo 404;
un CAS incorrecto de un borrador propio existente devuelve 409. Dos pestañas con el
mismo draft_id no se pisan. Otra copia de trabajo requiere identidad explícita
nueva; un retry conserva draft_id, operation_id y payload completos.

La base puede ser una revisión propia ya superada. El servidor conserva un
snapshot del resultado de esa base con el texto local, sin avanzar la planeación.
No se rebasa automáticamente. La base pertenece a la misma planeación y ámbito
mediante FK compuesta. No se permite trasladar un draft_id a otro objeto.

201 devuelve `receipt`, `request` exacta, `result` completo del borrador e
`initial_request` original recuperada desde la base inmutable. Recibo:

```json
{
  "contract_version": 1,
  "namespace": "planning-draft-v1",
  "draft_id": "UUID",
  "revision_id": "UUID de revisión de borrador",
  "draft_revision": 1,
  "planning_id": "UUID",
  "base_revision": 1,
  "base_revision_id": "UUID de revisión confirmada",
  "scope_id": "UUID",
  "actor_id": "UUID",
  "operation_id": "UUID",
  "created_at": "fecha UTC"
}
```

`GET /scopes/{scope_id}/planning-drafts/{draft_id}` recupera su última revisión.
`GET /scopes/{scope_id}/planning-draft-operations/{operation_id}` recupera una
operación exacta, incluso después de actualizar ese borrador. Namespace de
borradores separado de fuentes T2 y planeaciones; la misma UUID no mezcla recibos.
Abrirlo no publica, guarda ni sobrescribe la revisión confirmada.

### Biblioteca mínima del corte

`GET /scopes/{scope_id}/plannings` y
`GET /scopes/{scope_id}/planning-drafts` responden
`{"items": [documentos completos vigentes], "next_cursor": "UUID o null"}`.
Parámetros `limit` 1–100, predeterminado 50, y `after` UUID. Orden ascendente por
UUID con índices de ámbito/identidad; pasar next_cursor como after para continuar.
No es un snapshot entre páginas: objetos creados mientras se pagina pueden
necesitar refrescar desde el principio. Nunca se usa este listado para resolver
el recibo de una operación incierta.

Se incluyen sólo para reabrir trabajo y ver original/copia/borrador en el flujo
B3/#17; no añaden búsqueda, filtros, recents ni historial visual completo.

## Persistencia, errores y recuperación

- Autorización dentro de cada caso de uso precede replay y lectura. Ajeno/ausente
  devuelve el mismo 404 genérico. Headers/IDs del cliente no crean autoridad.
- Replay exacto precede CAS. Huella SHA-256 sobre prefijo
  `aulalista-planning-edit-v1\0` y JSON canónico de
  `[kind, planning_id, draft_id|null, request]`: UTF-8, claves ordenadas, compacto,
  sin escapes ASCII. La clave no autoriza otro destino, clase o contenido.
- Cada éxito se devuelve después del commit. Fallo previo o al commit revierte
  puntero, revisión, copia y recibo juntos. Transacciones READ COMMITTED y locks
  de operación serializan misma clave; CAS y lock de draft protegen claves distintas.
- 401 identidad ausente; 404 ajeno/ausente; 409 `conflict` tanto CAS como key reuse;
  413 exceso; 415 media; 422 entrada o target no soportado/unchanged_text;
  503 persistencia. No se filtran SQL, texto, DSN ni credenciales. Las lecturas,
  éxitos B3 y errores controlados privados usan no-store, incluidos los 404 de
  recibos pendientes, 401, errores de validación y 503 de persistencia.
- Un 404 de operación no demuestra que falló: puede estar en vuelo. Consultar y
  repetir exactamente la misma operación; si sigue incierta, conservar pendiente.
  Cambiar texto o deshacer local no cancela una petición ya enviada.
- Deshacer pertenece sólo al buffer local. No hay endpoint de undo ni mutación
  de revisiones confirmadas. Resultado tardío no debe sustituir edición posterior.
  Buffer local y pendiente se asocian a cuenta/ámbito/objeto y generación; al
  cambiar cuenta no se muestran ni envían a la nueva. Esta obligación corresponde
  al controller y sus pruebas, no a un éxito supuesto del backend.
- «Conservar borrador» sólo se anuncia guardado en servidor tras recibo confirmado.
  Un fallo deja respaldo local pendiente de esa cuenta sin prometer otro dispositivo.
  La salida/navegación con cambios necesita decisión explícita de UI.

## Migración y comprobaciones

Migración `0004_planning_edits`: origen de copias, FKs, límite interno de request
de revisión a 8192, tablas draft/revisión e índices de listado. HTTP B2 conserva
su límite 4096. B2 ya persistido no se reescribe. Historia y borradores versionados
son inmutables por permisos y trigger; runtime sólo actualiza current_revision
en los objetos puntero. Grants y comandos en [desarrollo](../development.md).

Downgrade sólo para base desechable: destruye borradores y metadatos de origen,
no restaura contenido. Volver a límite 4096 puede rechazar revisiones B3 largas;
la transacción de migración revierte ese downgrade. No usar como rollback de
datos de usuario ni prometer restore de producción.

Pruebas backend incluyen regresión B2 y fixture nuevo, estrictos/Unicode/límites,
runtime 401, ámbito A/B, base ausente/ajena, historia/fuente exacta, replay antiguo,
doble petición, dos conexiones y PIDs, CAS de revisión y borrador, copia desde base
superada, rollback diferido, respuesta perdida tras commit, recibo todavía ausente
en vuelo, reabrir desde nueva app, FK de origen/fuente, grants y migración.

Evidencia local y revisión independiente se registran con el candidato exacto en
el PR. Las pruebas backend no acreditan UI visual, identidad real, recuperación
de navegador por cuenta, CI remota, calidad curricular ni aptitud de producción.


## Respaldo de recarga en la misma sesión (incremento parcial #15)

El [contrato acotado](../../web/README.md#respaldo-temporal-de-edición-b3-15-corte-parcial)
añade un único envelope mínimo en sessionStorage, TTL fijo recuperable de hasta24h,
base autenticada exacta y pending B3 idéntico. Ninguna mutación ocurre al restaurar.
El ID nullable de sesión se define en [0005](0005-autenticacion-local.md); no otorga
autoridad ni permite recuperar tras401/relogin. Limpieza física es best effort,
fallos visibles y datos locales en claro. No cubre fuentes/creaciónB2 ni cierra#15.
