# Anclas físicas y anexos, contrato offline v1 (#44)

Estado: ayuda interna determinista sobre [Snapshot](0007-integridad-fuente.md) y
[evidencia literal](0008-evidencia-literal.md). Primer consumidor:
`document_checks.annex_replay`. Sin endpoints, DB, runtime #19, cambios del
compilador, NLI, modelos, búsqueda curricular ni recuperación/generación de anexos.
La revisión independiente y CI corresponden al árbol/commit exactos del PR.

## Resultado útil sin verificaciones del docente

Este módulo **no crea, dispara, reinicia ni exige preguntas**, confirmaciones,
modales o aprobaciones. La frase del issue sobre una posible aclaración no se
implementa aquí: cero rondas humanas nuevas, incluso entre sesiones/versiones o
reintentos. Una referencia ausente o ambigua es diagnóstico junto al resultado;
las sesiones y otras relaciones independientes permanecen utilizables. El replay
sale 0 y conserva ese resultado parcial. Sólo integridad rota o entrada inválida
falla globalmente con código 2; tampoco convierte ese error en una pregunta.

La simplicidad es deliberada: un índice de apariciones, una evaluación de enlaces
y una lista local opcional de candidatos. No hay gestor de catálogos, búsqueda,
motor de grafos, otro batch/estado persistido ni workflow de aprobaciones. Cero
llamadas nuevas a modelos en este consumidor; no se afirma ahorro algorítmico
general ni se atribuye este algoritmo a otro producto.

## Fuente, identidad y pertenencia

`AnchorIndex(context, target_id)` recibe un `VerificationContext` confiable con
un único target de representación fijada, `role=null` y `context_id=null`.
Propietario/ámbito, versión y SHA de bytes/snapshot/representación provienen del
contrato #43. Son configuración autorizada local, no autenticación ni permisos
runtime. Targets, unidades de fuente y candidatos **no proceden de la respuesta
modelo**. Los cambios de fuente/política requieren un contexto distinto.

Cada consulta de `data` y cada `evaluate` recalcula límites desde la representación
controlada. Los IDs son hashes de contexto, clase de aparición, página y rango;
no de títulos ni números. `ordinal` conserva orden físico. Dos proyectos con el
mismo título o dos encabezados Sesión 1 tienen identidades diferentes. Las
referencias incluyen la identidad completa #43; offsets Unicode base cero,
semiabiertos y locales a página física base 1. No se normalizan citas, acentos,
NFC/NFD ni espacios. Las vistas son copias; no se acepta un flag `checked` como
fuente de autoridad.

### Gramática física acotada

- Encabezados al inicio de línea, admitiendo blancos: `Proyecto` con título no
  vacío o `Sesión`/`Sesion` seguido de entero ASCII canónico 1–999999. Se admite
  texto posterior separado por blancos o dos puntos. Una forma candidata no
  reconocida corta la pertenencia; no se adivina el número/título.
- Un proyecto nuevo corta la sesión anterior. Cada sesión conserva sus tramos,
  incluidas continuaciones en páginas legibles y sesiones distintas en una página.
- `failed`, `not_processed` y `no_text` cortan continuidad. `no_text` sólo significa
  que no se observó texto: no demuestra vacío visual ni ausencia de encabezados.
  El texto posterior queda sin asignar hasta otro encabezado comprobable.
- Actividades son **bloques textuales**, no actividades pedagógicas interpretadas:
  comienzan con viñeta `-`/`•` y hasta tres blancos de margen, y terminan ante otra
  viñeta, encabezado o sección reconocida (Inicio, Desarrollo, Cierre, Indicadores
  de, Ajustes razonables, Observaciones). Pueden continuar en otra página legible.
- Una línea de preludio `Fecha:` antes de un encabezado de sesión que contiene
  `Tema:` queda sin asignar; el layout puede situar ahí el tema de la sesión
  siguiente. No se acredita esa línea a la sesión anterior.
- Una unidad controlada `role=resource` corta/excluye actividad. Su contenido no
  puede aportar una clave al bloque de actividad precedente, ni actuar como nuevo
  encabezado de planeación. Una cita de relación que la solape se rechaza.

Se conservan segmentos sin sesión y motivos, páginas no observadas y texto exacto.
Estos límites son reproducibles en la representación textual, **no certifican
geometría PDF, cobertura OCR, límites visuales ni significado**. La primera
extracción puede haber perdido/reordenado contenido. Otras maquetaciones necesitan
un contrato explícito; no se declara comprensión universal por estas regex.

## Menciones y denominadores

Se inventaría cada aparición léxica de la palabra `anexo`/`anexos`, ignorando
mayúsculas sólo para localizarla. Su cita original se conserva. Una aparición
puede contener una lista y, por tanto, varias referencias numéricas físicas:
`anexos 1, 12 y 1` son una mención y tres referencias distintas. La repetición no
deduplica ni concede crédito por sí sola.

La lista admite enteros ASCII canónicos 1–999999 separados por coma, `y` o `e`,
en la misma línea. No absorbe números de otras líneas/páginas. El terminador
admitido es fin de línea, comillas/paréntesis o puntuación; los rótulos explícitos
`punto`/`página` también terminan la referencia sin capturar su número posterior.
No se acepta un prefijo como lista completa ante conectores incompletos, alternativa
`o`, romanos, porcentaje, operadores, rangos, decimales o continuaciones no
soportadas. Los prefijos observados pueden quedar en `candidate_numbers` para
diagnóstico, sin convertirse en referencia resoluble.

`parse_state` distingue `numbered`, `unnumbered`, `unsupported_number_expression`
y `qualified_unresolved`. La detección conservadora de `no`, `nunca`, `sin`, `si`,
`cuando`, `opcional`/`opcionalmente` examina el bloque completo, incluidas líneas
continuadas; puede abstenerse de más. No es un detector semántico exhaustivo. Una
mención sin número, condicional, negada o expresión fuera de gramática conserva
texto y contexto. Una expresión numérica sintácticamente válida pero calificada
retiene sus referencias físicas como objetivos no resueltos. En **todos** los
casos `obligation=not_inferred`: ninguna regex prueba necesidad o uso obligatorio.

## Relaciones y recursos

`evaluate(proposals, candidates=[])` fija objetivos desde las referencias de la
fuente, incluso si ninguna propuesta llega. Una propuesta contiene
`reference_id`, `session_id`, `activity_id` y `evidence` completa #43. Para estado
`evidenced` debe concordar con la pertenencia recalculada; la cita debe incluir la
**mención concreta completa, incluido su número/lista**, estar en un tramo de esa
actividad y pasar identidad/página/rango/texto exactos. Una cita cruzada, genérica
o cortada antes del número queda `unknown` con motivo. La presencia física no
prueba corrección temática, normativa o pedagógica.

Declaraciones repetidas se agrupan por aparición; no aumentan crédito. Todas sus
citas deben pasar, por lo que una buena no oculta otra inválida. Extras quedan
separados, y reordenar propuestas/candidatos no cambia el resultado. Un enlace
insuficiente no invalida otros independientes ni borra las sesiones.

La lista opcional confiable de candidatos tiene sólo `{id, number, key, location}`.
IDs únicos, número 1–999999 y clave ASCII explícita de 1–128 caracteres
(letras/dígitos, `_`, `-`, `.`). `location` puede ser null. Un número coincidente
sólo agrupa candidatos; nunca identifica un archivo. Para `located`:

1. La **clave completa** aparece en cada cita de relación válida, con delimitadores
   seguros comprobados también fuera del recorte. `resource-1` no es `resource-12`
   ni `resource-1-extra`; se recomiendan claves entre comillas. No hay búsqueda difusa.
2. Exactamente un candidato coincide; nunca se escoge el primero entre varios.
3. Su localización propia pasa #43 y está dentro de una unidad confiable de la
   misma representación/snapshot con `role=resource`, `metadata.annex_number`,
   `metadata.resource_key` concordantes y `metadata.origin=source`.

La anotación del recurso es responsabilidad del consumidor confiable, no evidencia
creada por el modelo. Recursos externos a este snapshot pueden permanecer como
candidatos sin ubicación; no se localizan en este corte. Un recurso generado no
se trata como recuperación del original. `resource_state` es `located`, `missing`,
`ambiguous` o `unresolved`; solamente `located` tiene ID/evidencia de recurso.
No se fabrica `confirmed_page`, URL, preview ni contenido.

Dos usos con clave y localización propias pueden compartir recurso legítimamente.
Si se repite un número sin esa prueba, se conservan todas sus apariciones,
candidatos y diagnóstico de identidad no resuelta. La repetición **no implica
error, renumeración ni instrucción de revisar uno por uno**.

## Replay, métricas y alcance real

El [consumidor](../../document_checks/README.md) verifica bytes de originales y
respuesta guardada, reconstruye el snapshot e inventaría la fuente completa
observada. Recibe una selección explícita de spans de respuesta, enlaces
localizados por el adaptador y una adjudicación de referencia independiente de
las predicciones. Comprobar el span no certifica automáticamente la correspondencia
semántica entre respuesta y enlace. `run` guarda JSON canónico y recibo;
`verify` relee, recalcula y exige igualdad exacta, sin confiar en veredictos guardados.

La aceptación privada de este corte conserva **8 encabezados físicos, 18 menciones
léxicas, 8 referencias numéricas y 10 menciones genéricas**. Esperados/detectados
coinciden en esos inventarios; cero omitidos/extras en la muestra examinada por
agentes. No se presenta recall de ocho números como exhaustividad de dieciocho
menciones ni comprensión de todo el documento.

De los ocho resúmenes iniciales guardados se seleccionó una referencia numerada
por resumen. El original incluye números y rangos de páginas; **no incluye los
offsets ni las citas completas de enlace**, localizados ahora por el adaptador
contra esas páginas y registrados aparte. Ocho comprobaciones reconstruidas tienen
evidencia física; cero falsos rechazos entre esas ocho adjudicadas aceptables.
No hay casos adjudicados rechazables en esta selección real, por lo que no se
publica una tasa de falsa aceptación sobre cero. Los negativos son software
sintético y se informan por separado. Cero enlaces de esos ocho quedan no decidibles
físicamente; las diez menciones genéricas permanecen sin resolver como referencias
numéricas, y ninguna disponibilidad/obligación semántica se acredita.

Los anexos completos están ausentes: cero recursos localizados, ocho faltantes;
las dos apariciones de anexo 1 de sesiones diferentes permanecen distintas y con
identidad ambigua, sin inferir error. Las ocho sesiones siguen disponibles. La
respuesta original, revisión y comprobaciones posteriores están separadas; no se
corrige retrospectivamente el original. Muestra previamente vista y selección por
agentes, sin holdout, adjudicación docente, precisión general ni aval curricular.

Código stdlib nuevo adaptado a contratos #42/#43, sin portar el monolito/licencia
incierta. Fixtures públicos sólo de software; no son evidencia OCR/pedagógica.
Originales, vistas, respuestas, transcripciones, anotaciones, IDs y hashes reales
permanecen privados, fuera del repo/CI. Se reutilizan los recibos previos: los hashes
no retenidos antes de las corridas históricas no se presentan como congelación
previa. No se cambia `synthetic=true`, ni los contratos/regresiones de #7/#9.
