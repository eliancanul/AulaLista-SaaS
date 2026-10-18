# Especificación 0010: herramientas y contexto curricular

Estado: diseño aprobado por el usuario el 18 de octubre de 2026 para [#18](https://github.com/eliancanul/AulaLista-SaaS/issues/18); implementación pendiente. Programa analítico queda dentro de Planeación de clase, sin otra tarjeta. Las composiciones de Planeación, lectura y reutilización aprobadas están trasladadas a Figma; la sección 11 precisa su cobertura y los pendientes. Esto no acredita implementación de UI.

## Decisiones y trazabilidad

Seis herramientas prioritarias, formularios guiados familiares con identidad Acenta y resultado editable. Elegir el contexto curricular una vez, admitir aportaciones manuales y derivar una Planeación desde un apartado analítico sin perder correcciones. Mantener 13 entradas de catálogo. Los campos de las otras cinco herramientas son diseño propio, no formularios comprobados de Teachy.

Esta especificación incorpora la propuesta aprobada, cuyo Markdown tenía SHA-256 `d8846dbf2d7ae81820913ecb97c94cb55929635c33663f18c0ec59f5a7f5c627`; actualiza su estado y referencias para el repositorio. La aprobación documental no habilita proveedores, corpus, archivos reales, gasto, generación real ni despliegue. [#19](https://github.com/eliancanul/AulaLista-SaaS/issues/19) conserva esas puertas y [#40](https://github.com/eliancanul/AulaLista-SaaS/issues/40) la evaluación real autorizada.

El estado del trabajo se mantiene en Issues; los cortes siguientes se enlazarán allí tras revisar dependencias y duplicados, sin convertir este documento en otro backlog.

## 1. Alcance y base comprobada

El [issue #18](https://github.com/eliancanul/AulaLista-SaaS/issues/18) pide contratos y una matriz de herramientas/fuentes revisados independientemente. El [comentario correctivo](https://github.com/eliancanul/AulaLista-SaaS/issues/18#issuecomment-6235389378) y el catálogo fijan **13 herramientas**, sustituyendo el conteo histórico de 14. Secuencia didáctica está incluida en Planeación de clase.

Base revalidada el 18 de octubre de 2026 UTC para incorporar el diseño: `b8d668ce054f8dc547e2ef7b8dc49e227e780346` (árbol `76ac97a3dbc926d1b836d9745fc38cd189ffa270`). El recorrido actual utiliza resultados sintéticos acotados; crear Planeación desde cero es una capacidad nueva. Esta propuesta reutiliza las garantías de fuente, revisión y recuperación existentes, sin presentar la simulación como generación real. Véanse [catálogo](https://github.com/eliancanul/AulaLista-SaaS/blob/b8d668ce054f8dc547e2ef7b8dc49e227e780346/web/src/acenta/App.tsx#L157-L175), [contratos actuales](https://github.com/eliancanul/AulaLista-SaaS/blob/b8d668ce054f8dc547e2ef7b8dc49e227e780346/web/src/acenta/contracts.ts) y [flujo automático](https://github.com/eliancanul/AulaLista-SaaS/blob/b8d668ce054f8dc547e2ef7b8dc49e227e780346/docs/specs/0002-flujo-automatico-material.md).

Esta incorporación cambia únicamente documentación. No modifica Figma ni código del producto y no habilita proveedores, documentos reales, búsqueda web, cobro o despliegue. #19 y el benchmark T4/T5 conservan su alcance separado. Los ejemplos siguientes son diseños sintéticos de aceptación de software por ejecutar, no resultados de pruebas, investigación sintética con docentes ni evidencia pedagógica. Las pruebas futuras de este alcance comprueban contratos y recuperación; no miden eficacia educativa ni sustituyen investigación real autorizada.

## 2. Catálogo completo

| Herramienta | Estado de diseño | Resultado que orienta su contrato |
| --- | --- | --- |
| Planeación de clase | Prioritaria; contrato de diseño | Clase o secuencia editable; incluye modalidad Programa analítico |
| Hoja de actividades | Prioritaria; contrato de diseño | Hoja para estudiantes y respuestas separadas cuando proceda |
| Preguntas sobre un texto | Prioritaria; contrato de diseño | Preguntas vinculadas al texto y respuestas sugeridas separadas |
| Adaptar material | Prioritaria; contrato de diseño | Versión adaptada con original conservado |
| Tarjetas de repaso | Prioritaria; contrato de diseño | Pares de anverso/reverso editables |
| Bingo temático | Prioritaria; contrato de diseño | Cartones y guía de términos o pistas |
| Proyecto de aula | Capacidad futura; contrato pendiente | Proyecto organizado por etapas |
| Diagnóstico breve | Capacidad futura; contrato pendiente | Instrumento breve con criterios de lectura |
| Rúbrica y lista de cotejo | Capacidad futura; contrato pendiente | Criterios observables editables |
| Memorama | Capacidad futura; contrato pendiente | Pares de asociación |
| Sopa de letras | Capacidad futura; contrato pendiente | Cuadrícula y solución |
| Adivina con pistas | Capacidad futura; contrato pendiente | Pistas graduadas y respuestas |
| Quiz para proyectar | Capacidad futura; contrato pendiente | Preguntas de presentación y respuestas |

Ninguna entrada se habilita por aparecer en el catálogo. Las siete futuras necesitan su propio contrato completo antes de implementarse. Programa analítico no añade una decimocuarta tarjeta: es una modalidad de Planeación.

## 3. Recorrido y distribución del formulario

1. **Elegir herramienta.** Abrir un formulario específico desde el catálogo de Acenta.
2. **Completar lo esencial.** Mostrar primero los campos requeridos. Recuperar contexto compatible de un material propio cuando exista; no inventar datos del grupo.
3. **Afinar opcionalmente.** Agrupar currículo, contexto, método, idioma y referencias. Mantener sus valores visibles como un resumen breve, con acción para editarlos.
4. **Generar.** Una acción clara; errores de campos junto al dato correspondiente. Sin confirmaciones de extracción ni de cada bloque.
5. **Ver primero; editar si hace falta.** El resultado útil abre en una vista previa modal, con el fondo de la aplicación oscurecido. **Editar** es una acción opcional; no se abre el editor por defecto. El guardado automático indica su estado real y conserva el contexto usado. Mis recursos recupera la revisión confirmada.

**Alcance de edición:** «resultado editable» significa que puede corregirse cuando el docente lo elija; no obliga a editar para consultar, guardar o reabrir. Se conserva la edición básica de fase 1, acotada a elementos declarados editables de sus materiales; su adaptación al nuevo tipo de Planeación todavía debe implementarse y probarse. El editor completo de texto enriquecido queda para una integración posterior y no es requisito de este primer recorrido.

**Composición visual aprobada para los recorridos enlazados en la sección 11:** navegación, tipografía, color y controles propios de Acenta; formulario compacto de una columna, etiquetas persistentes y ayuda breve, sin una barra lateral explicativa. La procedencia se muestra junto al campo o material correspondiente, con el detalle de fuentes accesible en contexto. La vista previa prioriza el material. En móvil se usa una composición propia de lectura y secciones, no una reducción del modal de escritorio. Teclado, foco y avisos accesibles forman parte de la aceptación futura, no se acreditan con este documento.

El campo Contexto permite describir la necesidad del docente. No sustituye los campos guiados ni exige datos identificables de estudiantes. Si describe una situación hipotética, esa condición se conserva al generar, derivar y reabrir: nunca se convierte en un diagnóstico de un grupo real. No exige otra confirmación. Formularios y resultados permanecen privados en el ámbito autorizado.

## 4. Planeación: campos comprobados y propuesta Acenta

### Campos observados en Teachy

La inspección de Planificación Didáctica (NEM) del 17 de octubre de 2026 mostró:

| Campo | Condición observada | Tratamiento propuesto en Acenta |
| --- | --- | --- |
| Asignatura | Requerido | Conservar; no equipararla automáticamente a un campo NEM |
| Grado | Requerido | Elegir y reutilizar dentro del contexto del material |
| Tema | Requerido | Texto breve sobre lo que se trabajará |
| Campo formativo | Opcional | Selección curricular con procedencia o aportación manual |
| Ejes articuladores | Opcional | Selección múltiple reutilizable |
| Objetivos de aprendizaje | Opcional | Objetivo propio o selección con fuente; distinto de un PDA oficial |
| Método de enseñanza | Opcional | Selector; opciones finales propias de Acenta por aprobar |
| Tiempo | Opcional; 50 minutos por defecto | Proponer 30, 50, 100, 120, 150 o personalizado; 50 visible y editable |
| Contexto | Opcional | Texto del docente; no pierde validez por no ser curricular oficial |
| Idioma del material | Opcional | Español inicial, editable |
| Archivo adicional | Opcional | Diseñado como referencia futura, sujeto a admisión y permisos |
| Buscar en la web | Opcional | No activarlo implícitamente; función futura con fuentes y límites claros |

**Diferencia importante:** el banco observado de Objetivos mostraba “Aprendizajes Clave para la Educación Integral y Marco Curricular Común de Educación Media Superior”. No se verificó un banco de PDA del Plan 2022. Acenta no debe renombrar ese banco como NEM ni copiar sus contenidos como corpus. Se reutiliza la estructura del formulario; las afirmaciones curriculares requieren evidencia independiente.

Los métodos observados incluyen aprendizaje activo, clase magistral, práctico, social y emocional, Modelo 5E y una opción con marca Teachy. Esta última no se traslada como método propio de Acenta. Las opciones y etiquetas finales se revisarán en la vista previa.

### Contrato de Planeación

- **Entrada mínima:** asignatura, grado y tema. Tiempo propuesto visible; referencia opcional. Una secuencia permite varias sesiones dentro de la misma herramienta, con extensión por definir.
- **Salida útil:** propósito, actividades ordenadas, tiempos, materiales y propuesta de evaluación formativa. Separar contexto curricular seleccionado, aportaciones del docente y sugerencias generadas.
- **Fuente:** referencia exacta elegida o “Sin referencia adjunta”. Crear desde cero no requiere fabricar un archivo original.
- **Edición:** texto, actividades, tiempos y materiales editables. Cambiar actividades no modifica una cita curricular literal; una paráfrasis pasa a ser aportación editada o sugerencia.
- **Guardar/reabrir:** conservar campos, duración, resultados, revisión y referencias usadas. Reabrir no regenera ni cambia a la fuente más reciente.
- **Errores propios:** duración inválida, referencia ilegible o resultado sin actividades útiles. El contenido ausente se muestra como pendiente; no se presenta una lista vacía como planeación terminada.
- **Aceptación sintética propuesta:** tema inventado, tercer grado y 50 minutos, sin referencia. Resultado editable, tiempos coherentes con 50 y ninguna cita oficial inventada. Editar una actividad, guardar y reabrir conserva el cambio. Si el tiempo cambia, el reajuste es explícito y no borra la edición.

## 5. Programa analítico y reutilización

### Modalidad de Planeación aprobada

Teachy mostró como **obligatorios** Grado, Tema, PDA del Programa Sintético, Situación problemática y Contenidos del Programa Sintético. Los tres últimos son campos de texto libre. Como **opcionales** mostró Campo formativo, Ejes articuladores, Contexto, Idioma, archivo y búsqueda web. No se observó un campo separado de tiempo o método.

En Acenta proponemos conservar esos campos, pudiendo rellenar Contenidos/PDA desde una selección trazable o escribiéndolos manualmente. La aportación manual permite continuar y se identifica como tal. No recibe una etiqueta oficial por parecerse a un texto curricular.

**Resultado propuesto:** apartados editables que relacionen situación contextual, contenidos, PDA y orientaciones de trabajo. Un apartado creado a partir de un tema es un insumo del Programa analítico; no se presenta como un programa anual colectivo completo. El documento SEP aborda su construcción contextual y colectiva; la aplicación no sustituye esa decisión profesional. [SEP 2024, pp. 79-82](https://educacionbasica.sep.gob.mx/wp-content/uploads/2024/06/Programa_Sintetico_Fase_4.pdf#page=79).

### Apartado → Planeación

1. En un apartado guardado, pulsar **Crear planeación**.
2. Prellenar grado, tema, contenido/PDA, campo, ejes y contexto desde la revisión elegida. Añadir sólo lo que falte para esa clase, por ejemplo asignatura o duración.
3. Abrir la nueva Planeación como recurso derivado. Guardar vínculo al apartado y revisión de origen, junto con las fuentes curriculares exactas que correspondan.
4. Las correcciones de la Planeación son propias. Editar después el Programa analítico no las pisa. Una actualización de contexto muestra diferencias y se aplica voluntariamente, sin reescribir actividades confirmadas.

La guía pública de Teachy documenta reutilizar una fila de planificación para prellenar un plan de clase. **No se verificó esa conexión para su Programa Analítico mexicano**: el recorrido anterior es una propuesta de Acenta. [Guía de planificación de Teachy](https://www.teachy.com.br/pt-BR/teachy-help-center/planejamento/como-criar-um-planejamento-na-teachy).

**Aceptación sintética propuesta:** crear un apartado con contenidos/PDA manuales, derivar una Planeación y corregirla. Cambiar luego el apartado no cambia ni su revisión de origen ni las correcciones. Una nueva derivación usa sólo la revisión elegida. Un apartado ajeno o no accesible no revela contenido ni metadatos.

## 6. Contexto NEM: seleccionar una vez, conservar la fuente

**Alcance propuesto inicial de trazabilidad:** demostrar el contrato con Primaria, Fase 4, sin afirmar cobertura de todos los niveles. Ampliar fases requiere inventario y verificación de cada fuente. La creación con contexto manual sigue disponible en el diseño, aun sin banco curricular oficial.

La selección reúne marco curricular, grado/fase, campo, contenido y PDA. Se conserva en el recurso y puede heredarse al crear materiales relacionados. El docente no vuelve a completar lo mismo en cada herramienta. Puede editarlo cuando lo necesite; cambiar de grado o fuente obliga a resolver únicamente las incompatibilidades afectadas, sin entrevistas repetidas.

### Matriz de fuentes y autoridad

| Origen | Identificación necesaria | Presentación y límite |
| --- | --- | --- |
| Documento curricular oficial | Entidad, título, edición declarada, URL, fase/grado, página/tabla y versión exacta; hash al incorporar legítimamente el archivo | Cita localizable; no prueba que toda la actividad esté validada |
| Archivo o texto del docente | Referencia privada y revisión exacta; origen manual si sólo escribió el contenido | Aportación del docente; válida como contexto sin afirmar autoridad oficial |
| Apartado de Programa analítico | Recurso, apartado y revisión de origen; sus fuentes retenidas | Contexto reutilizado, sin actualizar silenciosamente la Planeación |
| Fuente web opcional | URL y versión/captura realmente utilizada, fecha de consulta y ubicación verificable | Evidencia adicional; no convertir cualquier web en autoridad curricular |
| Sugerencia generada | Origen generado y relación con entradas usadas | Propuesta editable, distinta de cita y de dato aportado |
| Sin fuente | Ausencia explícita | Puede producirse material general; no se inventa respaldo NEM |

Se conservan por separado **cita literal**, **síntesis/sugerencia** y **dato ausente**. Si se modifica una cita, la versión modificada deja de mostrarse como literal. La selección de un PDA no certifica eficacia docente, alineación completa ni aprobación institucional.

### Versiones identificadas y decisión pendiente

La comparación documental acotada del 18 de octubre de 2026 identifica ambas fuentes por separado:

| Fuente SEP, Fase 4 | Edición declarada e ISBN | Páginas físicas | Localizadores comprobados, base 1 |
| --- | --- | --- | --- |
| [PDF 2024](https://educacionbasica.sep.gob.mx/wp-content/uploads/2024/06/Programa_Sintetico_Fase_4.pdf) | Primera edición 2024; ISBN en trámite | 96 | Impresa 45 = física 45; impresa 46 = física 46 |
| [PDF 2025](https://educacionbasica.sep.gob.mx/wp-content/uploads/2025/Plan_y_programas_de_estudio_2025/WEB%20FASE%204-2025.pdf) | Primera edición 2025; ISBN 978-607-2605-36-7 | 99 | Impresa 45 = física 47; impresa 46 = física 48 |

SHA-256 de los archivos consultados: 2024 `36e0c3cdbc3221cdf9c4b9f3ec9e889f98060249fc0ab1ddecd419b28bcbe734`; 2025 `84eacf026114b47a3d4cffb6e926068fe6f8cb1c5abae8fd5c063eb9b41e1e26`.

Se cotejaron seis celdas de las primeras filas de las páginas impresas 45 y 46. Cinco coinciden tras normalizar espacios y cortes de renglón; la restante difiere únicamente en la puntuación del inciso sobre cera en cuarto grado. La fila de ecosistemas y sus tres PDA de tercero coinciden en ese cotejo. El ciclo del agua de la impresa 46 corresponde a cuarto, no a tercero. **No se establece equivalencia global de las ediciones ni validación curricular de una actividad.**

**Recomendación pendiente de decisión:** usar la edición bibliográfica 2025 como referencia del piloto limitado, fijando URL, hash y localizador, y conservar 2024 como antecedente. Su ISBN y su inclusión en la [bibliografía oficial USICAMM 2026–2027, entrada 28](https://guias.usicamm.gob.mx/2026-2027/ADEB/primaria/) respaldan esa recomendación, no una sustitución normativa. El prototipo aprobado aún referencia SEP 2024, impresa/física 45; no cambiarlo silenciosamente ni presentar 2025 como ya seleccionada.

Ambos avisos de reproducción indican fines no comerciales, conservación del material y atribución. **No se presume permiso para importar, redistribuir o explotar un corpus curricular en un SaaS comercial.** Esta especificación registra enlaces y metadatos; no incorpora los PDFs, extracciones o corpus. Antes de incorporar contenido al producto deberán resolverse los derechos y el destino autorizado. Tampoco autoriza copiar el banco comercial de Teachy.

## 7. Contratos de las otras cinco herramientas

Los campos siguientes son **propuestas de Acenta**, no formularios de Teachy verificados. Todos heredan edición, guardado, reapertura, autoridad y recuperación de la sección 8.

### Hoja de actividades

- **Entradas propuestas:** grado, tema u objetivo y cantidad/tipo de ejercicios. Contexto y referencia opcionales; reutilizar los del recurso de origen.
- **Salida:** título, instrucciones, ejercicios y espacios de respuesta; respuestas sugeridas separadas cuando proceda.
- **Fuentes:** conservar las utilizadas, o ausencia explícita. Las respuestas basadas en un texto señalan ese texto; no añaden citas curriculares ficticias.
- **Edición y reapertura:** por ejercicio y respuesta, manteniendo su relación. Reabrir conserva orden y correcciones.
- **Errores:** cantidad fuera del límite definido, ejercicio incompleto o desajuste entre pregunta y respuesta. Corregir lo afectado sin reemplazar toda la hoja.
- **Ejemplo sintético:** solicitar cinco ejercicios de clasificación sobre objetos inventados; obtener cinco, editar el tercero y conservarlo tras reapertura. La versión para estudiantes no incluye por accidente las respuestas del docente.

### Preguntas sobre un texto

- **Entradas propuestas:** texto o referencia legible obligatorios; grado, cantidad y tipo de preguntas. Contexto curricular opcional.
- **Salida:** preguntas y respuestas sugeridas separadas, con pasaje de apoyo cuando exista. Distinguir pregunta literal, inferencia y reflexión abierta.
- **Fuentes:** versión exacta del texto base. Una respuesta que el texto no permite sostener no se presenta como hecho encontrado.
- **Edición y reapertura:** preguntas/respuestas por separado; conservar vínculo al pasaje original. Cambiar el texto base crea otra derivación o regeneración explícita.
- **Errores:** texto vacío, inaccesible o demasiado breve para la petición; no sustituirlo silenciosamente por un tema general.
- **Ejemplo sintético:** un párrafo inventado de tres hechos, tres preguntas y una inferencia etiquetada. La respuesta a un dato ausente se reconoce como no sustentada. Una corrección manual permanece al reabrir.

### Adaptar material

- **Entradas propuestas:** material base y necesidad de adaptación obligatorios; grado/nivel, extensión y contexto opcionales. Describir barreras o necesidades funcionales sin exigir diagnósticos ni datos personales.
- **Salida:** material adaptado y resumen breve de cambios; original intacto. La adaptación no se anuncia como certificación de accesibilidad o intervención clínica.
- **Fuentes:** original y revisión exacta; fragmentos añadidos identificados como sugerencias.
- **Edición y reapertura:** editar la versión adaptada, sin alterar el original. Conservar instrucciones de adaptación y cambios posteriores.
- **Errores:** original ilegible, requisitos contradictorios o adaptación que elimina información esencial. Mantener la parte válida y señalar el límite concreto.
- **Ejemplo sintético:** instrucciones inventadas de cuatro pasos; simplificar lenguaje manteniendo los cuatro pasos. Editar uno, reabrir y comprobar conservación del original y la adaptación.

### Tarjetas de repaso

- **Entradas propuestas:** tema o material base, grado y cantidad. Opcionalmente lista de términos, dificultad y formato pregunta/respuesta o concepto/definición.
- **Salida:** pares editables con anverso y reverso; referencia cuando respalda una respuesta.
- **Fuentes:** texto elegido o ausencia explícita. Las definiciones generadas se presentan como propuestas cuando no hay fuente.
- **Edición y reapertura:** editar, ordenar o retirar pares manteniendo sus dos caras relacionadas; sin regenerar el conjunto por cambiar una tarjeta.
- **Errores:** reversos vacíos, duplicados involuntarios o cantidad incompatible con el material. No fabricar variedad ocultando repeticiones.
- **Ejemplo sintético:** seis términos inventados producen seis pares; cambiar el reverso de uno y su posición se conserva al reabrir. La cantidad real queda visible si no puede completarse la solicitada.

### Bingo temático

- **Entradas propuestas:** tema o banco de términos, grado, tamaño de cuadrícula y cantidad de cartones. Opcionales pistas y casilla libre.
- **Salida:** cartones, lista para dirigir el juego y relación entre pistas y respuestas; contenido editable.
- **Fuentes:** términos aportados o generados, conservando su origen. El currículo es contexto opcional, no una licencia para inventar citas.
- **Edición y reapertura:** guardar banco, pistas y distribución exacta. Reabrir no vuelve a sortear. Cambiar el banco muestra qué cartones deben recomponerse.
- **Errores:** banco insuficiente, término repetido dentro del cartón, cartones duplicados no deseados o pistas sin respuesta única. Ofrecer reducir tamaño/cantidad o ampliar el banco, sin generar otra operación a escondidas.
- **Ejemplo sintético:** doce términos inventados, dos cartones 3 × 3 sin casilla libre; nueve términos distintos por cartón, cartones diferentes y pistas consistentes. Reabrir conserva las mismas posiciones.

## 8. Estados, errores y finalización fiable

Estas son garantías propuestas para las seis herramientas y la modalidad Analítico. No añaden una aprobación obligatoria por sección.

| Estado o incidente | Qué ve y puede hacer el docente | Garantía exigida |
| --- | --- | --- |
| Borrador de formulario | Campos conservados, esenciales claramente señalados | No se anuncia generación ni guardado sin evidencia |
| Falta currículo oficial | “Contexto aportado” o “Sin fuente curricular seleccionada” | Puede continuar con contexto manual; no se inventa alineación |
| Referencia no disponible | Nombre/referencia y error concreto; cambiar o retirar | No sustituir por latest, otro documento o una cita inventada |
| Procesando | Estado real; salir y volver sin reenviar | Operación identificable y recuperación del mismo intento |
| Demora o conexión perdida | “Aún no pudimos confirmar el resultado”; comprobar estado | Un timeout no significa fracaso ni autoriza duplicar trabajo |
| Resultado parcial útil | Parte independiente editable y límites visibles | No llamar completo a un material que aún carece de lo esencial |
| Resultado listo | Vista previa legible del material, Editar opcional y guardado confirmado | Una notificación o fila creada no prueba finalización |
| Guardando / sin guardar | Estado y edición pendientes visibles | “Guardado” sólo con recibo durable de esa revisión |
| Conflicto de revisión | Conservar texto local; revisar versión vigente o copia | Sin sobrescritura silenciosa ni merge automático destructivo |
| Fallo terminal | Motivo útil, entradas preservadas y reintento explícito | Reconciliar operación anterior antes de una nueva |
| Cancelación | Estado cancelado y resultado tardío no aplicado al editor | Cancelar la UI no afirma por sí solo cancelación de servidor/proveedor |
| Sesión inválida | Acceso suspendido y reautenticación | No eludir autoridad ni prometer conservar texto no confirmado |

**Finalización comprobable:** contenido con las secciones mínimas de la herramienta, referencia de revisión confirmada y reapertura satisfactoria. Una pantalla en blanco, un aviso “listo” o un indicador indefinido nunca cumplen este criterio.

La implementación futura debe fijar plazos finitos por fase, presupuesto de reintentos y tratamiento de operaciones inciertas. No se proponen segundos arbitrarios ni una promesa de disponibilidad sin medir. Si no se puede confirmar el resultado, se indica ese estado en lugar de mantener una espera engañosa.

**Límite actual que se conserva:** tras 401/reautenticación sólo se garantiza recuperar lo confirmado en la biblioteca; pueden perderse cambios no guardados. La ampliación de recuperación exige un corte propio. No presentar la propuesta de guardado automático como evidencia de que ese límite ya se resolvió. [Edición durable](https://github.com/eliancanul/AulaLista-SaaS/blob/b8d668ce054f8dc547e2ef7b8dc49e227e780346/docs/specs/0003-edicion-durable.md).

El contenido de archivos y webs es dato no confiable: no altera permisos, destinos ni instrucciones del sistema. Los reintentos y recursos se mantienen en el ámbito privado autorizado. Herramienta no implementada significa que no se envía ninguna petición de generación.

## 9. Qué resolver sin LLM y cómo controlar coste

| Trabajo | Primera opción propuesta | Cuándo justificar una LLM |
| --- | --- | --- |
| Campos, cantidades, tiempos y compatibilidad de grado/fase | Validación determinista | No hace falta para comprobar tipos o sumar minutos |
| Selección de contenido/PDA con referencia conocida | Buscar y filtrar registros versionados autorizados | Ayudar a encontrar candidatos semánticos, sin inventar códigos ni autoridad |
| Heredar un apartado, guardar y reabrir | Copia de campos y versiones con reglas explícitas | No hace falta para trasladar datos ya estructurados |
| Crear actividades, preguntas, adaptaciones o pistas | Generación acotada con entradas pertinentes | Cuando aporta redacción o adaptación semántica que la plantilla no resuelve |
| Ordenar tarjetas o distribuir un banco de bingo | Algoritmo determinista y comprobaciones de duplicados | Sólo para proponer contenido o pistas; no para sortear la cuadrícula |
| Revisión de estructura y fuentes | Validación determinista de esquema, referencias y completitud | Revisión semántica acotada cuando exista una necesidad medida |

Propuesta de coste: no llamar a un modelo al editar campos, elegir currículo, reabrir, guardar o redistribuir términos existentes. Reutilizar sólo contexto compatible con fuente, revisión, permiso y configuración; preservar ediciones. Preferir reparación localizada a regeneración total cuando resuelva el fallo sin ocultar dependencias.

Antes de generación real se fijarán límites de entrada/salida, duración, intentos, presupuesto y política de fallos. Medir después coste total por material útil guardado, latencia hasta utilidad, fallos, reintentos y trabajo de corrección. Desconocido se registra como desconocido; no como cero. No hay mediciones de ahorro ni eficacia en esta propuesta. Estas comprobaciones de producto no duplican ni deciden el benchmark T4/T5.

## 10. Aceptación transversal y cortes recomendados

### Ejemplos de aceptación por ejecutar en una implementación futura

- Sin dato curricular: el campo sigue ausente tras generar, editar y reabrir.
- Fuente manual: se admite y se mantiene identificada como aportación, sin etiqueta oficial automática.
- Fuente exacta: el resultado conserva edición y localizador; una nueva versión no cambia el pasado.
- Fixture: un ejemplo sintético siempre conserva esa etiqueta y nunca se presenta como respuesta de un modelo real.
- Vista previa: consultar y cerrar el resultado sin editar es un recorrido válido. Elegir Editar permite la corrección básica y conserva sus garantías de guardado/reapertura; no exige integrar el editor completo.
- Recuperación: doble clic, timeout o respuesta perdida no duplican el material; resultado tardío no pisa una corrección.
- Derivación: Analítico → Planeación conserva el apartado, revisión de origen y condición hipotética del contexto cuando corresponda, sin sincronización destructiva ni conversión en diagnóstico real.
- Herramienta futura: no se envía petición ni se simula que está disponible.
- Privacidad: cuenta ajena no accede a entradas, materiales, fuentes o metadatos privados.
- Cada ejemplo específico de las secciones 4, 5 y 7 debe convertirse en una prueba observable; un JSON válido no acredita utilidad docente.

### Orden propuesto tras la revisión

1. **Aplicar el diseño aprobado:** usar las composiciones y límites de la sección 11, manteniendo [#11](https://github.com/eliancanul/AulaLista-SaaS/issues/11) como referencia. La aprobación visual general ya no está pendiente; antes del corte de alta/edición del apartado analítico deberá concretarse su pantalla específica, sin reabrir lo ya aprobado.
2. **Incorporar los contratos de #18:** matriz y fuentes identificadas, decisiones pendientes explícitas y revisión independiente del documento. El cierre documental exige evidencia del candidato en PR/CI; no certifica implementación ni resuelve derechos o equivalencia curricular pendientes.
3. **Primer corte posterior:** Planeación desde cero con formulario guiado y contexto manual, demostración sintética claramente etiquetada, vista previa inicial, edición básica opcional y guardado/reapertura completos.
4. **Reutilización de apartados:** Analítico → Planeación puede desarrollarse con contexto manual autorizado, sin depender de importar un corpus oficial. La selección desde un banco curricular es un corte separado, condicionado a resolver derechos, fuentes y versión aplicable. No se importa corpus por defecto.
5. **Herramientas por unidades completas:** Hoja, Preguntas, Adaptar, Tarjetas y Bingo; confirmar el orden al preparar cada corte, reutilizar contratos y evitar un generador universal prematuro.

Cada implementación posterior necesita alcance autorizado, pruebas del candidato y revisión independiente. La publicación documental depende de la autorización vigente y del [workflow](../workflow.md); este contrato no concede permisos de merge o despliegue.

## 11. Pendientes de implementación y fuentes

1. **Diseño visual aprobado y trasladado a Figma:** vista de lectura en escritorio con fondo oscurecido y Editar opcional; selector curricular y estado aplicado; campos/validación y generación/recuperación; lectura móvil v4; explorador ancho de apartados y clase derivada. Referencias exactas:
   - [Lectura de material](https://www.figma.com/design/WEmZPyqYaUjBpY2fMhXItU?node-id=163-3502).
   - [Selector curricular](https://www.figma.com/design/WEmZPyqYaUjBpY2fMhXItU?node-id=178-4522) y [contexto aplicado](https://www.figma.com/design/WEmZPyqYaUjBpY2fMhXItU?node-id=178-4521).
   - [Campos y validación](https://www.figma.com/design/WEmZPyqYaUjBpY2fMhXItU?node-id=178-4524) y [generación/recuperación](https://www.figma.com/design/WEmZPyqYaUjBpY2fMhXItU?node-id=178-4525).
   - [Móvil v4](https://www.figma.com/design/WEmZPyqYaUjBpY2fMhXItU?node-id=178-4526) y [lector móvil](https://www.figma.com/design/WEmZPyqYaUjBpY2fMhXItU?node-id=182-4298).
   - [Explorador de apartados](https://www.figma.com/design/WEmZPyqYaUjBpY2fMhXItU?node-id=169-3682) y [Planeación derivada](https://www.figma.com/design/WEmZPyqYaUjBpY2fMhXItU?node-id=169-3681).

   Se verificaron visualmente las capturas y la estructura editable, fuentes y conexiones declaradas del prototipo; no se realizaron pruebas de clics en navegador ni pruebas de UI implementada, teclado, foco o accesibilidad. Editar no tiene destino funcional. Búsqueda, entrada manual y Consultar estado no simulan servicios reales. No se añadió una pantalla de alta/edición de Programa analítico: su modalidad y contrato están aprobados, pero esa composición específica queda por concretar en #53. Este pendiente acotado no mantiene bloqueada toda la especificación documental.
2. **Decisión curricular de diseño pendiente:** elegir y registrar la fuente/edición oficial exacta para la cobertura inicial de Fase 4, considerando la comparación acotada y recomendación de la sección 6. La matriz admite pendientes, pero esa selección aún no está decidida; se mantiene explícita al valorar el cierre documental de #18. Los derechos y la autorización de importar/utilizar un corpus comercial son una puerta operativa separada: no se exige una importación para cerrar el contrato ni se bloquea usar contexto manual autorizado.
3. **Campos de las otras cinco herramientas:** contrato de diseño propio aprobado como propuesta; afinar su interfaz y límites por corte. No se atribuyen a Teachy sin comprobar sus formularios.
4. **Generación real, archivos, web y presupuesto:** [#19](https://github.com/eliancanul/AulaLista-SaaS/issues/19) y autorizaciones propias mantienen sus puertas; sus controles aquí son contrato futuro.

## 12. Evidencia y límites de esta entrega

Fuentes revisadas: issue, catálogo, instrucciones y contratos de la base indicada; formularios observados de Teachy y referencias públicas enlazadas. La guía brasileña sólo respalda el patrón de reutilización, sin trasladar sus afirmaciones BNCC a México. Los envíos observados de Teachy no habían aportado contenido accesible para evaluar calidad o referencias.

Este diseño no acredita tests de implementación, benchmarks, generaciones de Acenta, migraciones, importaciones ni cambios de producto. La revisión documental y la CI aplicable a su candidato se registran en el PR; no certifican generación real, seguridad operativa o eficacia pedagógica. No hay migración o recuperación de datos aplicable a incorporar esta spec.

**Siguiente paso:** integrar la especificación sólo tras revisión y CI del candidato exacto; registrar la decisión bibliográfica pendiente y comprobar las dependencias antes de ejecutar #52/#53. La evidencia visual y la de cada implementación posterior se conservan por separado.
