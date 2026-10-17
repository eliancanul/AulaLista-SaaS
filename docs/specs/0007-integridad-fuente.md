# Integridad de fuente, contrato offline v1 (#42)

Estado: implementación offline; revisión independiente y CI del candidato exacto
se registran en el PR. No abre las puertas de documentos reales de #19 ni cambia
T2, sus límites, autenticación, almacenamiento, versiones o endpoints.

## Identidad y custodia

`src/aulalista_api/source_integrity.py` es Python estándar nuevo. Reutiliza el
vocabulario de `materials.receipt`: `scope_id`, `source_id`, `version_id`, `number`,
`sha256` y `size`. El último hash y tamaño se cotejan con **bytes del original**;
no son un hash de texto ni de una imagen. No importa modelos SQL ni crea tablas.

`authority=offline_manifest` identifica versiones locales estables sin inventar
un recibo persistido o una identidad autenticada. `persisted_receipt` puede
registrar un recibo obtenido por un consumidor confiable; la etiqueta y UUIDs
**no prueban autorización ni propiedad**. El consumidor offline recibe el ámbito
y versión de un manifiesto local confiable autorizado, nunca de la salida del
modelo. Cualquier integración runtime deberá ejecutar la autorización vigente de
`materials.authorize` y resolver la versión del servidor antes de estos checks.

El snapshot v1 es JSON canónico congelado en una cadena inmutable. Devuelve copias
al consultar datos. Su digest externo detecta cambios; cada representación tiene
además un digest que incluye identidad/versión, páginas, contenido, metadata,
hashes transitivos de artefactos de entrada/contenedores y digest de su padre.
No reutilizar evidencia de otro snapshot, versión o representación.

Cada artefacto conserva SHA-256 de sus bytes, tamaño, modalidad, método/versión,
padres y mapa de páginas físicas. Una versión de herramienta histórica desconocida
se declara como tal. Un contenedor de respuesta puede incluir varios documentos:
su mapa identifica **la proyección seleccionada**, no una afirmación de que todos
sus bytes pertenecen a ese documento. El replay conserva el selector exacto en el
manifiesto privado y vuelve a extraerlo del contenedor con hash comprobado.

Reabrir exige un digest retenido fuera del archivo; se validan esquema, hashes,
inventario y dependencias. El CLI además relee originales y todos los artefactos
y reconstruye el mismo snapshot/recibo. Los hashes no prueban verdad, fecha,
custodia independiente, permisos de redistribución ni calidad docente. El original
permanece en el almacenamiento privado existente; no se copia al repositorio.

## Inventario y límites

- `total_pages` tiene una procedencia explícita `inventory_basis`. No se infiere
  del máximo número de página de una respuesta ni de texto extraído. El replay
  real usa una cuenta observada por una herramienta local sobre los bytes del
  original. El núcleo no parsea PDFs ni verifica por sí mismo esa observación.
- Toda representación tiene exactamente las páginas físicas `1..total_pages`,
  incluso vacías, fallidas, canceladas o no solicitadas. Se rechazan omisiones,
  duplicados, reordenación del inventario y renumeración.
- `readable`, `no_text`, `failed` y `not_processed` son estados de la observación.
  `readable` sólo significa texto no vacío. Una página fallida puede conservar
  texto parcial junto a su motivo; no pasa a comparación acreditada.
- El estado global se calcula: `partial` ante páginas fallidas/no procesadas;
  `processed` si todas se observaron. Ninguno se llama OCR completo o fiel.
- Un `page_limit` deja todas las páginas posteriores como `not_processed` con
  motivo `page_limit`. Una cancelación conserva el motivo `cancelled`. No se
  aceptan observaciones que excedan ese límite.
- Topes de defensa: 10 000 páginas, 128 MiB por original/artefacto y 2 000 000
  caracteres textuales acumulados por snapshot. Se rechaza el snapshot entero;
  no se corta contenido. Son límites del contrato offline, no nuevos límites
  de carga de T2 ni garantías de memoria total o aislamiento de archivos hostiles.
- El diff tiene un presupuesto de 20 000 caracteres por página de cada lado.
  Excederlo conserva esa página/denominador como `comparison_limited`, sin
  igualdad, éxito o cobertura inventados. No acredita un benchmark de rendimiento.

## Texto, estructura y aliases

`raw`, `transformed` y `reference` son representaciones separadas. Una transformación
apunta a su padre y conserva los mismos artefactos de entrada. Una referencia es
un insumo aparte, nunca fabricado de una igualdad de tokens. Sólo se comparan
textos de la misma fuente/versión, inventario e inputs; no se comparan offsets de
un PNG, un PDF o de dos extracciones como si fueran una cadena común.

El diff literal distingue saltos, espacios, signos, acentos y Unicode tal como
están guardados. Sus offsets son índices Python de caracteres Unicode, base cero,
intervalo semiabierto, dentro de la representación nombrada. Informa sustituciones,
inserciones y eliminaciones con ambos tramos. `SequenceMatcher` no calcula CER,
WER ni una distancia mínima: el diff puede alinear ocurrencias repetidas de más
de una forma. Una eliminación/inserción puede ser reordenamiento; no se inventa
la causa. Counters de tokens son alarmas auxiliares: detectan omisiones/duplicados
y el caso de mismos tokens con orden distinto, sin acreditar filas/columnas.

`whitespace_collapsed` es una segunda medición declarada, con sus propios offsets
y denominadores. Sólo colapsa blancos; no quita acentos, gráficos o normaliza
Unicode. No se mezcla con la medición literal ni con métricas históricas de otro
protocolo. El resultado nunca pone `textual_coverage_verified=true`.

Unidades opcionales conservan intervalos exactos, orden, papel, metadata y
referencias de dependencia. Allí pueden conservarse filas, columnas y geometría
**si el artefacto la contiene**. Igualdad de anotaciones no prueba geometría real;
`visual_structure_verified` siempre es falso. No se fabrican celdas combinadas.
La fuente, sus encabezados, pies y ocurrencias repetidas no se modifican.

`compact_aliases` devuelve sólo una vista de encabezados/pies explícitamente
anotados dentro de una representación. Agrupa únicamente texto, papel, metadata
y lista de dependencias exactamente iguales; mantiene IDs de cada ocurrencia,
intervalos originales y destinos de dependencias. Cuerpos y encabezados no pueden
colisionar por sus IDs. No es un detector automático ni deduplicación global.

## Consumidor y evidencia

[El consumidor `document_checks`](../../document_checks/README.md) está separado
por ruta, esquema y comandos del harness `evaluation`, que conserva intacto
`synthetic=true`, sus fixtures, manifest, scorer y regresiones de #7/#9.

El replay privado de #40 compara las tres páginas ya expuestas contra su referencia
IA congelada y adjudicada por otro agente. Conserva originales, PNGs, respuestas
y denominadores por documento/página; no es holdout ni validación humana/docente.
No vuelve a ejecutar modelos. GitHub recibe únicamente este contrato, código y
tests de software sintéticos; el manifiesto, contenido y recibo reales quedan
fuera del repositorio y de CI.

La omisión observada de encabezado/pie se detecta **contra la referencia**. Si la
primera extracción ya la perdió, una proyección identidad posterior coincide y
no puede detectarla: esa igualdad no acredita cobertura. La prueba privada
conserva cuatro filas de respuesta y sus celdas vacías; la simplificación de
celdas combinadas se registra por separado como estructura no verificada. Los
contadores históricos que normalizan gráficos no se presentan como diff literal.

## Procedencia y exclusiones

Diseño nuevo a partir del contrato #42, specs 0001/0002 y la auditoría de AulaLista.
No se copian módulos, tests, corpus, monolitos o fragmentos del legado sin licencia
verificada. No se añaden dependencias, OCR, llamadas pagadas, NLI, ATLAS, colas,
almacenamiento ni endpoints. La biblioteca estándar usa la licencia de Python ya
presente en el entorno; ninguna prueba sintética mide rendimiento pedagógico.
