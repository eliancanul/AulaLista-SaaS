# Apartados manuales de Programa analítico (#53)

Contrato del incremento de persistencia de [#53](https://github.com/eliancanul/AulaLista-SaaS/issues/53),
sobre `e48b3ba52023bc1afdfb97c53a307fc3403cdc4f`, que ya integra #52 mediante
PR #56. Complementa [0010](0010-herramientas-contexto-curricular.md) y conserva
los contratos de [fundación](0001-fundacion.md) y [edición](0003-edicion-durable.md).

El incremento inicial añadió API, contratos y formulario de alta/edición de
escritorio C. El corte de consulta de PR #63 añadió búsqueda global y filtros;
la UI posterior se construye sobre su merge `4172980fe9f9f9424c1222121016bfe153c05088`.
**No completa #53:** siguen pendientes el lector específico tras guardar el
apartado, reabrir su formulario de edición y la composición móvil A. El reflow
no acredita ese diseño móvil ni el recorrido completo del issue.

El usuario eligió escritorio C y móvil A, con reutilización de controles y estilos
de GuidedForm/GuidedReader y lógica del apartado separada de Planeación. El
explorador conserva la [composición aprobada](https://www.figma.com/design/WEmZPyqYaUjBpY2fMhXItU?node-id=169-3682).
La [derivación con datos heredados de sólo lectura](https://www.figma.com/design/WEmZPyqYaUjBpY2fMhXItU?node-id=199-5014)
fue aprobada el 19 de octubre de 2026: sólo asignatura, duración y método son
editables antes de crear. El original de diseño permanece conservado. No se
incorporan capturas ni datos privados al repositorio.

## Formulario de escritorio

La modalidad **Programa analítico** se abre desde Planeación, sin añadir una
tarjeta al catálogo. Reutiliza Logo y los controles/estilos de GuidedForm:
nombre, grado y periodo visibles; contexto/situación y pares contenido/PDA
expandibles. Campo, ejes, idioma y referencia exacta son opciones manuales.
La ausencia de una referencia oficial permanece explícita.

**Guardar apartado** es una acción explícita. Una confirmación conserva abierto
el formulario y permite guardar revisiones posteriores del mismo apartado.
No se abre un lector provisional tras guardar. El explorador permite consultar
y usar otros apartados confirmados, sin cargar ni sobrescribir este formulario;
éste retiene únicamente el apartado actual durante la sesión.

Su controlador mantiene datos e intención separados del editor de Planeación.
Una respuesta incierta bloquea cambios y ofrece **Comprobar guardado**: consulta
la operación, correlaciona los datos y la revisión exactos y, ante ausencia,
reenvía la misma clave y solicitud. Doble clic no crea otra operación. Un
conflicto conserva el texto; cargar la revisión vigente exige descartar
explícitamente los cambios. No combina ni sobrescribe revisiones silenciosamente.

La navegación dentro de la pestaña conserva el formulario. Cerrar sesión exige
resolver el guardado o descartar explícitamente; cancelar esa salida invalida
también su continuación asíncrona. Recarga/cierre con cambios o una operación
pendiente activa la advertencia del navegador. No se añade almacenamiento local
ni recuperación de este buffer tras recarga o 401: guardar antes de salir sigue
siendo necesario. Suspensión/cierre de sesión invalida respuestas tardías.

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
| `GET /analytic-sections?after={id}&limit=50` | Página de revisiones vigentes por UUID ascendente; límite 1–100 y cursor del ámbito. Admite `q`, `grade` y `formative_field`. |
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

## Consulta para el explorador

El incremento iniciado sobre `93e4ab913bb76685231542e1487fe3a95d1bb2cf`
prepara la consulta del [explorador aprobado](https://www.figma.com/design/WEmZPyqYaUjBpY2fMhXItU?node-id=169-3682),
inspeccionado junto con la composición de derivación. Sólo modifica API,
contrato cliente y pruebas; no implementa ni rediseña esas pantallas, y no cierra #53.

- `q` es una subcadena literal del nombre/tema del apartado, de hasta 200
  caracteres Unicode antes de quitar espacios exteriores. Vacío o sólo espacios
  no filtra. PostgreSQL compara sin distinguir mayúsculas; se conservan tildes,
  signos y espacios interiores. `%`, `_`, barras y comillas no son comodines ni
  código SQL. No busca en PDA, situación, contexto, archivos o revisiones antiguas.
- `grade` (hasta 80 caracteres) y `formative_field` (hasta 120) son filtros
  opcionales de igualdad exacta, conservando mayúsculas y espacios. Se omiten
  para consultar todos; un filtro vacío, sólo espacios, NUL o Unicode inválido
  se rechaza con `422 invalid_request`, sin eco del texto. No hay vocabulario
  curricular nuevo ni filtro por autoridad oficial.
- Los tres criterios se combinan con AND sobre todas las revisiones vigentes
  del ámbito autorizado **antes** de aplicar el límite. No se filtra una página
  ya descargada. Sin coincidencias devuelve `{items: [], next_cursor: null}`;
  el contrato no devuelve un total ni datos de otros ámbitos.
- El cursor sigue siendo el UUID del último apartado devuelto y el orden sigue
  siendo ascendente, sin offsets. Se autoriza cada página. Un cursor ajeno y uno
  inexistente tienen el mismo rechazo genérico; un apartado propio que deje de
  coincidir tras editarse sigue siendo un límite válido para continuar.
- Cada página consulta el estado confirmado actual; no es un snapshot entre
  solicitudes. No repite IDs ya recorridos, pero inserciones o cambios de filtros
  anteriores al cursor requieren volver a consultar desde el inicio para verse.
  El consumidor debe conservar los criterios al continuar y reiniciar el cursor
  al cambiar búsqueda/filtros. No se promete una vista congelada frente a ediciones
  concurrentes ni se introduce un buscador general para toda la biblioteca.

El cliente codifica cada criterio por separado en la query, comprueba sus límites
antes del transporte y conserva la validación de ámbito, documentos, orden y
cursor de respuesta. Las consultas privadas siguen siendo `no-store`; los logs
de acceso/URL permanecen deshabilitados según el contrato de desarrollo.
No se añaden dependencias, migraciones, índices de texto ni permisos. La consulta
examina nombres vigentes del ámbito con el timeout existente; no acredita una
escala de biblioteca aún no medida.

La regresión incluye búsqueda más allá de la primera página, combinación de
filtros, revisiones, caracteres literales, límites y errores seguros, cursores,
aislamiento y revocación de sesión. PostgreSQL real acredita la semántica SQL;
el cliente se comprueba además atravesando HTTP. La UI descrita a continuación
resuelve selección, respuestas tardías y estados vacíos/error sin ampliar la API.

## Explorador y preparación visual

Desde Planeación, **Usar un apartado guardado** abre el modal con seis filas por
página y vista previa de la selección. Búsqueda y filtros llaman a la consulta
scoped completa; no filtran una página local. Grado y campo aceptan su texto
manual exacto: no hay facetas completas ni vocabulario oficial inventado.
Los grados comunes son sugerencias editables. El mensaje visible explica la
igualdad exacta y el alcance literal del nombre. Se indica página y cantidad
mostrada, nunca un total que la API no devuelve.

Cambiar criterios reinicia el cursor y retira inmediatamente la selección vieja.
Anterior vuelve a consultar un cursor conocido; cada página refleja el estado
confirmado actual. Respuestas o errores de consultas anteriores no repueblan el
modal. Cerrar, navegar, suspender o cerrar sesión invalida su consulta. Carga,
vacío y error son estados distintos; el error admite reintento. No se escribe ni
se crea una clase al buscar, seleccionar, previsualizar o cancelar.

La vista previa muestra nombre, grado, periodo, situación, todos los pares
contenido/PDA en su orden, contexto/condición hipotética, campo/ejes, idioma y
referencia exacta o ausencia. El texto manual se presenta literalmente, sin HTML
ni reinterpretación curricular. **Usar apartado** conserva una copia inmutable
de la revisión seleccionada y abre la preparación de la clase. **Ver apartado**
consulta esa misma copia, no la revisión vigente. No ofrece Editar el apartado.

La preparación mantiene tema y todos los datos heredados de sólo lectura. Sólo
asignatura, duración y método se envían a la ruta de derivación existente. El
formulario guiado independiente y el editor manual del apartado conservan sus
buffers. Elegir explícitamente otro apartado conserva los tres datos de clase;
cancelar el explorador no sustituye el origen. Descartar una preparación exige
confirmación y devuelve al formulario guiado anterior.

**Crear ejemplo** es la única creación. La disponibilidad limitada del fixture
está explicada antes de enviar; no se habilita IA. Un intento incierto bloquea
cambios, descarte y sustitución del origen. **Comprobar creación** consulta la
operación y sólo ante 404 reenvía la misma clave, origen y solicitud. Se correlacionan
operación, revisión inicial, solicitud y origen completos antes de confirmar.
Un rechazo cierto conserva la preparación editable. La confirmación tardía se
conserva en recursos, sin cambiar una navegación posterior. Suspensión/cierre
invalida respuestas tardías; no reaparece contenido de una sesión cerrada.

El resultado usa GuidedReader y la edición básica existente. Su procedencia
permite desplegar el apartado y revisión exactos incluso después de editar o
reabrir la clase. No sincroniza correcciones del apartado con clases anteriores.
La guardia de salida protege la preparación: un intento incierto debe resolverse;
descartar requiere acción explícita. Comprobar desde la guardia nunca cierra la
sesión automáticamente ni reactiva una salida cancelada. Recarga/cierre avisa de
trabajo pendiente. No añade almacenamiento local ni amplía recuperación tras 401.

`analytic-explorer.test.ts`, `analytic-derivation.test.ts` y
`analytic-workspace.test.ts` prueban estas fronteras. Los recorridos de
`analytic-explorer.browser.ts` cubren búsqueda, readonly, errores, recuperación,
resultado editable, foco, cancelación y reflow genérico. `analytic.integration.ts`
añade el recorrido visual con HTTP/PostgreSQL y una edición concurrente del
apartado posterior a su selección. La aprobación visual de implementación exige
inspeccionar las capturas del candidato exacto; compilar o listar tests no ejecuta
Chromium. El PR debe distinguir lo ejecutado de las puertas aún pendientes.

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
