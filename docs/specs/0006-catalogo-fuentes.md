# Especificación 0006: catálogo de originales confirmados

Contrato del backend de [#36](https://github.com/eliancanul/AulaLista-SaaS/issues/36),
sobre main `355399b6f01ea6985ebdb8389691fc532c993e5f`. Complementa la biblioteca de
planeaciones/borradores y el visor exacto existentes. Un backend aislado no cierra
el ticket: también requiere catálogo visible y recorrido autenticado en navegador.

## Lectura acotada

`GET /scopes/{scope_id}/sources?after={source_id}&limit=50`

Respuesta 200:

```json
{
  "items": [
    {
      "source_id": "00000000-0000-4000-8000-000000000001",
      "version_id": "00000000-0000-4000-8000-000000000002",
      "scope_id": "00000000-0000-4000-8000-000000000003",
      "number": 1,
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "size": 280,
      "actor_id": "00000000-0000-4000-8000-000000000004",
      "created_at": "2026-10-17T00:00:00+00:00",
      "operation_id": "00000000-0000-4000-8000-000000000005"
    }
  ],
  "next_cursor": null
}
```

Los valores del ejemplo son ilustrativos. Cada entrada reutiliza exactamente el
contrato `SourceReceipt`/`receipt` de la versión confirmada, incluida su fecha de
creación. El servidor enumera una entrada por fuente propia: la versión que era
actual en la consulta. No depende de una planeación, copia, borrador ni IDs
conservados en navegador. No enumera el historial de versiones.

- Orden técnico: `Source.id` UUID ascendente. No es orden cronológico.
- `after` es el UUID de una fuente del ámbito autorizado, excluido del resultado;
  el siguiente tramo contiene IDs estrictamente mayores. No es una credencial ni
  un cursor firmado: otro UUID de fuente propia también es un límite válido.
- `next_cursor` es el `source_id` de la última entrada entregada sólo cuando existe
  otra entrada; es `null` al terminar. Página vacía: `items: []`, cursor `null`.
- Límite predeterminado 50; mínimo 1, máximo 100. Es un límite técnico de lectura,
  coherente con los listados existentes, y no una cuota de archivos. Se consulta
  como máximo `limit + 1` filas de metadatos para determinar la continuación.
- El orden no omite ni repite fuentes en un conjunto sin inserciones. No existe
  snapshot entre páginas: una inserción concurrente puede caer antes del cursor.
  Actualizar comienza desde el inicio y permite descubrir esas inserciones.
  Avanzar una versión no cambia la posición UUID de su fuente.
- La consulta no carga `content` ni `request_fingerprint`; tampoco los incluye en
  JSON. No agrega filename, MIME, nombre original, cuerpo, preview ni tipo PDF.

## Autoridad, errores y referencias exactas

La sesión se resuelve mediante la dependencia existente y se revalida dentro de
la transacción de lectura; se autoriza el propietario del ámbito antes de buscar
el cursor. Cada página requiere la misma autoridad que las lecturas exactas.
Todas las respuestas, incluidos errores, llevan `Cache-Control: no-store`.

- Sin sesión vigente: 401 `unauthorized`.
- Ámbito ajeno o inexistente: 404 `not_found`, sin distinguirlos.
- UUID de cursor válido pero ajeno o inexistente en el ámbito autorizado:
  422 `invalid_request`, sin distinguir ambos casos. Se autoriza el ámbito primero.
- Parámetros malformados, UUID inválido/excesivo o límite fuera de 1–100:
  422 `invalid_request` genérico. La validación HTTP puede rechazar sintaxis antes
  de consultar el ámbito. La frontera del caso de uso también valida límite y tipo
  de cursor: un acceso interno no evita la cota.
- Fallo de persistencia: 503 `unavailable`, por el manejador existente.

Una tarjeta captura el recibo recibido y abre
`/scopes/{scope_id}/sources/{source_id}/versions/{number}` mediante el lector
verificable existente. Si el catálogo mostró V1 y luego se confirma V2, esa tarjeta
sigue abriendo V1. Actualizar el catálogo devuelve explícitamente el recibo V2;
no se sustituye silenciosamente la referencia anterior por la versión actual.
El consumidor valida identidad, versión, tamaño, hash y decodificación conforme
al visor de #16. Metadatos inválidos, bytes ausentes/corruptos o formato no admitido
exigen estado seguro; nunca un preview fabricado ni fallback a latest.

La API carece de filename/MIME. El consumidor sólo puede usar nombres sintéticos
comprobables de las tres muestras conocidas; para lo desconocido usa etiqueta
genérica y no afirma PDF ni fixture. Navegar/abrir no selecciona una fuente para
un envío ni crea planeaciones/copias.

## Evidencia y límites

`tests/test_materials.py` cubre vacío, reinicio, metadatos idénticos al recibo,
bytes/tamaño/SHA completos de V1 tras V2, independencia de planeaciones,
paginación/orden, 50 por omisión y 100 máximo, cursores inválidos/ajenos,
autorización y consulta SQL sin bytes. `tests/test_auth_integration.py` añade nueva
sesión OTP sin IDs locales, aislamiento entre cuentas y revocación que ocurre
entre resolver la dependencia HTTP y ejecutar la lectura. Sólo se reemplazan
transportes/verificadores externos de pruebas; no se sustituyen actores/sesiones
en estos últimos recorridos. Ambas suites usan PostgreSQL real y rol runtime.

Sin migración ni almacenamiento adicional. No cambia el límite de 65 536 bytes,
la admisión de fixtures, las lecturas históricas, retención/purga, revocación de
derivados ni la recuperación de una escritura todavía incierta tras reload.
El listado no prueba integridad leyendo todos los bytes; ésa sigue siendo la
responsabilidad del lector verificable al abrir. No acredita uploads/documentos
reales, servicios externos, piloto, revisión independiente ni CI por sí solo.
