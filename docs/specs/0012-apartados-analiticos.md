# Apartados manuales de Programa analítico (#53)

Contrato del incremento de persistencia de [#53](https://github.com/eliancanul/AulaLista-SaaS/issues/53),
sobre `e48b3ba52023bc1afdfb97c53a307fc3403cdc4f`, que ya integra #52 mediante
PR #56. Complementa [0010](0010-herramientas-contexto-curricular.md) y conserva
los contratos de [fundación](0001-fundacion.md) y [edición](0003-edicion-durable.md).

Este corte proporciona API y contratos del consumidor. **No completa #53:** la
interfaz de alta/edición, explorador, lectura y derivación queda pendiente. Antes
de implementarla deben materializarse e inspeccionarse las maquetas aprobadas. El usuario
eligió escritorio C y móvil A con la condición de mantener código limpio,
reutilizar controles/estilos de GuidedForm y GuidedReader y separar la lógica del
apartado de la de Planeación. Las cuatro referencias cubren formulario y
guardado de escritorio C, e inicio y contenidos de móvil A. No se incorporan
sus archivos ni identificadores privados al repositorio.

El explorador y la derivación conservan las composiciones de Figma enlazadas en
0010 §11. Este incremento no escribe Figma ni acredita validación visual, de
foco, teclado, reflow o interrupción del nuevo recorrido.

## Datos y autoridad

Un apartado tiene entidad y revisiones propias, dentro de un ámbito personal.
Sus datos manuales contienen nombre/tema, grado, periodo, situación, de uno a
ocho pares contenido/PDA, contexto opcional con condición hipotética explícita,
campo y ejes manuales opcionales, idioma y referencia privada exacta opcional.
El nombre del apartado se utiliza como tema de la clase derivada. No se
reinterpreta el texto ni se transforman los PDA en objetivos de aprendizaje.

Cada documento devuelve `{receipt, data, provenance: "manual-v1"}`. El recibo
identifica apartado, revisión, ámbito, actor, operación y momento confirmado.
Los campos `source_*` son todos nulos sin referencia; con referencia retienen la
versión, ID y hash admitidos. Una referencia adjunta no convierte la aportación
manual en contenido oficial ni se interpreta. No existe selección curricular
oficial nueva en este corte.

El contexto hipotético permanece hipotético. Se conservan texto, espacios,
orden y pares exactos. No se añaden diagnósticos, datos docentes, programa anual
colectivo, LLM ni infraestructura de generación.

## Operaciones

Todas las rutas empiezan con `/scopes/{scope_id}` y usan la sesión verificada,
el actor interno y la autorización del ámbito dentro de cada operación. Las
escrituras requieren `Idempotency-Key` y las respuestas privadas son `no-store`.

| Ruta | Contrato |
| --- | --- |
| `POST /analytic-sections` | Crear revisión 1 con datos `contract_version: 1`. |
| `POST /analytic-sections/{id}/revisions` | Guardar `{contract_version: 1, expected_revision, data}` mediante CAS. |
| `GET /analytic-sections/{id}` | Leer revisión vigente propia. |
| `GET /analytic-sections/{id}/revisions/{n}` | Leer revisión exacta, sin seleccionar latest. |
| `GET /analytic-section-operations/{key}` | Recuperar el documento confirmado por esa operación. |
| `GET /analytic-sections?after={id}&limit=50` | Página por UUID ascendente; límite 1–100 y cursor del ámbito. |
| `POST /analytic-sections/{id}/revisions/{n}/plannings` | Crear Planeación desde esa revisión exacta. |

El guardado usa el namespace `analytic-section-v1`, separado de fuentes y
planeaciones. La huella incluye destino, revisión esperada y datos completos.
El replay se comprueba antes del CAS: misma clave y solicitud confirma el mismo
resultado aunque el apartado haya avanzado; clave reutilizada con otros datos
o CAS obsoleto da 409. El recibo sólo se expone después del commit. Una respuesta
perdida se recupera con la misma operación. Recursos ajenos e inexistentes no
revelan contenido, IDs ni metadatos.
Una nueva operación de edición sin cambios devuelve `422 unchanged_text` y no
crea una revisión ni avanza el contador.

Los datos canónicos del apartado se limitan a 8000 bytes tanto al crear como al
editar; el cuerpo HTTP admite 8192 bytes, reservando espacio para el envelope de
edición. Un apartado admitido al crear puede volver a guardarse con el mismo
tamaño. Su representación JSONB se limita a 16384 bytes. Los límites individuales
no garantizan que la combinación quepa:
el exceso total produce 413 sin guardar parcialmente. El historial es inmutable
mediante restricciones, triggers y permisos del rol runtime.

## Derivación e independencia

La solicitud de derivación contiene sólo `contract_version: 1`, asignatura,
duración visible/editable (50 por defecto, de 15 a 180 minutos) y método. El
servidor autoriza la revisión elegida y su referencia exacta antes de crear.
Copia nombre como tema, grado, contexto, campo, ejes, idioma y referencia al
contrato guiado v2. Conserva los pares contenido/PDA, periodo y situación en
`analytic_origin`, que devuelve el documento exacto de origen.

Una FK con ámbito fija `analytic_revision_id`; no se reutiliza
`origin_revision_id`, que sigue identificando copias de Planeación. La lectura
resuelve esa revisión inmutable, no la vigente del apartado. Las ediciones,
copias y borradores de Planeación conservan la misma relación y mantienen sus
propios cambios. Editar el apartado no actualiza derivaciones anteriores.

El namespace de derivación es `planning-v1` y su recuperación utiliza
`GET /planning-operations/{key}`. La huella diferencia la derivación de la
creación guiada directa e incluye el origen exacto y los datos de clase. El
cliente no puede enviar ni falsificar el snapshot de origen. Los contratos v1
y v2 anteriores mantienen sus huellas, límites y endpoints.

La salida reutiliza únicamente el fixture sintético ya admitido por #52:
Ciencias naturales, 3.º de primaria, cuidado del agua, aprendizaje activo y
español. Guardar un apartado manual no depende de ese fixture; derivar una
combinación no admitida devuelve `422 unsupported_fixture`, sin generar una
Planeación ni alterar el apartado. No se añade generación libre ni se afirma
adaptación pedagógica al contexto manual.

## Migración y validación

`0008_analytic_sections` añade dos tablas del apartado y la relación opcional
desde revisiones de Planeación. Readiness exige la nueva revisión. Los grants
runtime permiten leer/insertar historia y avanzar sólo el contador vigente del
apartado. El downgrade se reserva para bases desechables; debe rechazar la
pérdida de apartados confirmados. No es restauración de datos ni autorización de
despliegue.

Las pruebas deben cubrir validación, bytes, referencias, aislamiento, replay,
conflicto, carreras, commit fallido, respuesta perdida, inmutabilidad,
migración/rollback e independencia de revisiones y ediciones/copias/borradores.
PostgreSQL real acredita restricciones y carreras. El PR registra comandos,
candidato exacto, revisión independiente y omisiones; los tests no equivalen a
aceptación docente ni cierran la UI pendiente. El límite de recuperación tras
401 de fase 1 permanece vigente.
