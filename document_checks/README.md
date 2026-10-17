# Replay privado de integridad de fuente

Consumidor de [contrato v1](../docs/specs/0007-integridad-fuente.md) para evidencias
locales **ya autorizadas**. No llama a modelos, no extrae PDFs, no instala
proveedores y no convierte un manifiesto en un permiso. Es independiente del
harness sintético `evaluation`; nunca admite documentos reales como fixtures de
ese harness. Los tests de este directorio son software sintético, no evidencia OCR.

## Tests sin dependencias

Desde la raíz, Python 3.12.14:

```sh
PYTHONPATH=src:. python3 -B -m unittest discover -s document_checks/tests -v
PYTHONPATH=src:. python3 -B -O -m unittest discover -s document_checks/tests -v
```

Los mismos comandos están en el workflow `evaluation-offline`; CI sólo genera
archivos sintéticos temporales. Lint/formato sigue siendo el del backend completo.

## Entrada privada

Un manifiesto `aulalista-source-replay.v1` enumera `documents` con:

- `identity`: ámbito/fuente/versión/número/SHA/tamaño y autoridad del contrato v1.
- `original`: `path` y `sha256` esperado; rutas relativas al manifiesto o absolutas
  explícitas de archivos autorizados. Es configuración local confiable, nunca
  instrucciones extraídas de un documento o una salida del modelo.
- `total_pages` e `inventory_basis`: cuenta física y procedencia comprobadas.
- `artifacts`: `id`, `path`, `sha256`, `media_type`, `physical_pages`, `parents`,
  `method` y `method_version`. Orden topológico; `original` es la raíz reservada.
- `representations`: `id`, `kind`, `method`, `method_version`, `modality=text`,
  `inputs`, `derived_from`, `page_sources` y opcionalmente `page_limit`/
  `pending_reason`. `raw`/`reference` usan padre null. `transformed` nombra su padre.
- Cada `page_sources` fija `number`, `state`, `artifact` y `pointer`, una lista de
  claves JSON/índices no negativos que selecciona **una cadena exacta** del archivo
  guardado. También admite `units` del contrato; un fallo/sin texto puede tener
  `text` vacío y `reason` sin selector. Páginas ausentes no se renumeran: quedan
  `not_processed`. Los contenedores se conservan por su hash de bytes.
- `comparisons`: objetos `source`, `target`, `mode=reference|transformation`.

Los tests ofrecen un ejemplo sintético mínimo reproducible. Los hashes esperados
vienen de la evidencia inicial, no se recalculan para aceptar una modificación.
Un nuevo snapshot/versión debe ser una decisión explícita del consumidor.

## Ejecutar y reabrir

Rutas ilustrativas privadas, fuera del repositorio:

```sh
PYTHONPATH=src:. python3 -B -m document_checks.replay run /private/manifest.json --out /private/replay-1
sha256sum /private/replay-1/receipt.json
PYTHONPATH=src:. python3 -B -m document_checks.replay verify /private/manifest.json --out /private/replay-1 --receipt-sha256 DIGEST_RETENIDO
```

El destino debe ser nuevo y su carpeta padre debe existir; no sobrescribe una
corrida. El CLI rechaza destinos dentro del repositorio. Retener el digest del
recibo independientemente de los archivos que se verificarán. `verify` relee los
bytes, comprueba hashes, selectores e identidad y reproduce exactamente snapshots
y comparaciones. Cambios de fuente, versión, manifest, respuesta, snapshot o
recibo invalidan la reapertura; no se corrigen silenciosamente.

Los snapshots y recibos **contienen texto privado**. No subirlos a GitHub, CI,
logs o artefactos públicos. El CLI sólo imprime estado genérico. `new_model_calls=0`
describe este replay; no afirma que los artefactos históricos se produjeran sin
modelos ni prueba el consumo de otros procesos. No se invocan APIs de la aplicación
ni se acredita propiedad por un UUID o etiqueta de autoridad.

## Interpretar el resultado

Cada comparación mantiene todos los folios y sus estados. Sólo `compared` tiene
diff; `unavailable` y `comparison_limited` mantienen sus denominadores. Ver texto
no significa OCR fiel. Las diferencias literales, el diff de blancos colapsados y
cualquier métrica histórica tienen protocolos distintos. Una referencia
suministrada no queda certificada como independiente o correcta por este programa.

El caso real de aceptación y sus recibos se conservan en privado. Su resumen
saneado en el PR debe explicar omisiones, cuatro filas conservadas, geometría no
verificada, la pérdida inicial invisible a una transformación posterior y la
muestra previamente vista. Nunca publicar identificadores ni transcripciones.

## Afirmaciones seleccionadas (#43)

`claims_replay` consume el [contrato de evidencia](../docs/specs/0008-evidencia-literal.md)
y un manifiesto `aulalista-claims-replay.v1`. La selección/adjudicación es explícita
por el operador o agente responsable, no una auditoría automática de toda la
respuesta ni revisión docente implícita. El manifiesto contiene:

- `source_manifest`: `path`/`sha256` del manifiesto de fuente anterior; se vuelven
  a leer y verificar sus originales, artefactos, selectores y snapshots.
- `cases`: lista no vacía. Cada caso tiene `id` único, `stage=original|separate_check`,
  `document_index` base cero, `owner_id`, `scope_id` y `snapshot_sha256` fijados.
- `targets`: lista confiable de `{id, representation_id, role, context_id}`.
  Representación y requisitos estructurales no proceden de la respuesta modelo.
- `claims`: afirmaciones con `target`, `kind`, `value` y `evidence`, lista de
  referencias exactas del contrato. Una derivación agrega `derivation={rule,inputs}`.
  Una referencia con offsets no localizados no pasa; no se reemplaza su página
  declarada por otra donde se encontró el valor. Una corrección es otro caso.
- `original_response`: `path`/`sha256` de la respuesta intacta. El adaptador privado
  debe registrar/revisar los spans o selectores de cada afirmación elegida dentro
  del original. El CLI verifica sus bytes, **no interpreta una respuesta arbitraria
  para comprobar automáticamente esa selección**.
- `expectations`: exactamente una adjudicación por target con `target`, `state` y
  `mechanically_decidable` booleano. Conserva los no decidibles en el denominador.

Los tests muestran un manifiesto exclusivamente sintético. Las unidades con papel
estructural deben haber sido obtenidas de la fuente controlada por un proceso
confiable; el modelo no puede crear la evidencia de su propio papel.

```sh
PYTHONPATH=src:. python3 -B -m document_checks.claims_replay run /private/claims.json --out /private/claims-run
sha256sum /private/claims-run/receipt.json
PYTHONPATH=src:. python3 -B -m document_checks.claims_replay verify /private/claims.json --out /private/claims-run --receipt-sha256 DIGEST_RETENIDO
```

El recibo conserva expected/actual por target, falsos aceptados/rechazados y no
decidibles, agrupados por respuesta original o comprobación separada. Los errores
se miden contra las adjudicaciones declaradas; no se certifica su corrección. Para
tasas, informar por separado cuántos casos eran aceptables/rechazables/indecidibles,
y nunca dividir por cero. No llamar precisión general al porcentaje de esa muestra.
`verify` revalida todas las afirmaciones, no confía en estados `backed`/`checked`
guardados. Un formato de manifiesto inválido detiene la corrida con mensaje
genérico; una afirmación insuficiente conserva su resultado junto al dato.

Los archivos resultantes contienen datos privados igual que el replay de fuente.
El workflow existente descubre automáticamente los nuevos tests de este directorio
y los ejecuta normal y con `-O`; no cambia fixtures/scorer/manifiesto de `evaluation`.
