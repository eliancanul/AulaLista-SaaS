# Pendientes Acenta: referencia para los tickets existentes

Corte documental: **24 de octubre de 2026, 02:44 UTC**. Base inspeccionada:
[`33fb285eedf67e88b9151284db1b194227531517`](https://github.com/eliancanul/AulaLista-SaaS/commit/33fb285eedf67e88b9151284db1b194227531517).
Autor: agente Astra, por delegación del coordinador. Lectura de código, specs,
issues y PR; sin nuevas ejecuciones del producto, llamadas reales de IA ni gasto.

Este inventario responde a la solicitud de reunir los pendientes para el equipo.
**Issues conserva el backlog activo**, las asignaciones y los cambios de estado;
este documento es una fotografía de alcance y aceptación, no otra cola mantenida.
Los identificadores M/F son anclas de lectura, no tickets nuevos. Antes de tomar
trabajo, consultar el issue enlazado y su candidato vigente conforme al
[workflow](../workflow.md). Una mejora aplazada dentro de un issue cerrado no
queda implementada por ese cierre: reutilizar su contexto y delimitar el siguiente
corte en Issues cuando se asigne, evitando duplicados.

## Cómo leer el corte

- **Prioridad:** P0 = MVP solicitado ahora; P1 = siguiente trabajo ya delimitado;
  P2 = capacidad posterior confirmada o contrato aún por completar. No impone
  fechas ni cambia prioridades remotas. El orden posterior #53 → #65 → #66
  proviene de #18/#66; no bloquea el MVP manual.
- **Estado de capacidad:** no implementado; parcial; bloqueado por una dependencia
  concreta; pendiente de validación real. «Integrado» sólo describe código de main.
  El estado abierto/cerrado de GitHub se registra aparte.
- **Aceptación:** todos los casos siguientes son condiciones que debe demostrar
  el futuro candidato, salvo evidencia histórica expresamente identificada.
  Un test escrito o un transporte falso no demuestra IA real ni utilidad docente.
- **Dependencias:** sólo las del alcance concreto. OCR, documentos, corpus oficial,
  #53, #65 y #66 **no son dependencias del chat de texto ni de Planeación manual**.

El MVP pedido comprende conversación privada normal de varios turnos y Planeación
manual variable, con presupuesto compartido, errores recuperables, guardado,
reapertura e impresión. El ensayo limitado no convierte el producto en una sola
generación global. La conversación voluntaria tampoco consume el límite de una
aclaración interpretativa de una planeación de [spec 0002](../specs/0002-flujo-automatico-material.md).

## Evidencia y trabajo concurrente

| Fuente | Hecho conciliado y límite |
| --- | --- |
| Main del corte | #70 integra admisión manual variable de #67; #71 composición de #68; #72 corrige selección/impresión/foco; #73 añade arranque servidor explícito. El factory normal permanece cerrado. La generación implementada es Planeación estructurada, no chat normal. |
| [PR #74](https://github.com/eliancanul/AulaLista-SaaS/pull/74) | Único PR abierto devuelto por la consulta del repositorio a esta hora; draft, head remoto `509e4a670ac56eab46961a98509614841295ba02`, base `33fb285…`. Su perfil de un intento es el candidato publicado anterior y está siendo sustituido por la instrucción posterior de conversación/uso reiterado. No es aceptación del MVP. |
| Evidencia histórica de #74 | El PR registra 771 tests backend y 8 recorridos Chromium locales para **509e4a6**, con transportes externos sintéticos. Sus tres jobs de CI fallaron sin pasos ejecutados; cero reruns. Esa revisión y esos conteos no certifican otro head ni autorizan integrar #74. |
| Revisión local de presupuesto, comunicada por el coordinador | Reemplazo de #74 en curso: perfil reutilizable `window-v1`, reserva central compartida con backfill de Planeación. SHA y conteos locales se registran en su PR al publicar el candidato; faltan gates del candidato final. No es integración ni verificación independiente de este documento. |
| Chat, comunicado por el coordinador | Backend y frontend en worktrees separados, desarrollo en curso para #11: texto, varios turnos, historial privado, recarga y presupuesto común. Sin candidato final ni PR propio publicado al corte. Revisar su SHA y evidencia al asignar/integrar; este ledger no espera su implementación. |
| Aceptación operativa | #69 sigue abierto y no aceptado. En este encargo se comunicó USD 2 como techo **total** de pruebas reales, con gasto de este hilo 0; eso no verifica saldo externo. El presupuesto de prueba no define precio ni cuota comercial. No se comprobó aquí el servicio desplegado, la DB remota ni la facturación. |

## MVP ahora

### M1. Conversación privada de texto, varios turnos — P0

**Issue:** [#11](https://github.com/eliancanul/AulaLista-SaaS/issues/11), abierto;
necesita enlazar el corte de implementación solicitado, conservando su origen de
diseño. **Estado:** no implementado en la base; desarrollo concurrente en curso.

**Problema/resultado:** el compositor fixture no ofrece la conversación cotidiana
solicitada. Enviar texto normal, continuar sobre lo dicho y volver a la conversación
propia tras recarga. **Alcance/exclusiones:** turnos usuario/asistente, nueva
conversación e historial privado; texto sin adjuntos, OCR, micrófono, herramientas
externas ni envío automático de recursos. No forzar el DTO de Planeación como chat.
**Dependencias:** sesión/ámbito de B1, contrato y persistencia del chat, M2 y el
perfil permitido; no #53/#65/#66.

**Aceptación y pruebas:** dos turnos donde el segundo necesita el primero; el
contexto enviado corresponde a esa conversación y cuenta. Recargar/listar/reabrir
mantiene orden e identidad sin generar de nuevo; empezar otra no mezcla contexto.
Cuenta B, sesión revocada, IDs adivinados y callbacks de A no revelan historial.
Doble clic, respuesta perdida e incertidumbre conservan una operación y presupuesto.
Pruebas API/PostgreSQL, carrera con Planeación y Chromium conectado con sólo el
transporte externo sustituido; ejecución real acotada y autorizada se registra
aparte. **Evidencia:** #11 y controles deshabilitados de
[App.tsx](../../web/src/acenta/App.tsx) y [auditoría del inventario](../reviews/0002-pendientes-20261024.md).

### M2. Presupuesto compartido y operaciones reiteradas — P0

**Issues:** [#67](https://github.com/eliancanul/AulaLista-SaaS/issues/67) cerrado,
[#68](https://github.com/eliancanul/AulaLista-SaaS/issues/68) y
[#69](https://github.com/eliancanul/AulaLista-SaaS/issues/69) abiertos; PR #74 en
revisión. **Estado:** parcial; reserva de Planeación integrada, presupuesto
compartido con chat pendiente del candidato nuevo.

**Problema/resultado:** varias operaciones permitidas deben consumir el mismo
techo sin que cambiar cuenta, clave, perfil, proceso o reiniciar lo renueve.
**Alcance/exclusiones:** reservas durables antes del transporte, concurrencia y
fallos/inciertos retenidos; no recargas, precios comerciales ni liberación automática.
El perfil local nuevo reserva por operación la ventana 1,05 M y salida 1024,
USD 0,210768 más reserva adicional obligatoria según el handoff; es una cota
del candidato, no gasto observado ni tarifa revalidada por esta auditoría.
**Dependencias:** candidato revisado de #74 y contrato compartido de M1; confirmar
tarifas/cargos/saldo por el responsable antes del uso real, sin copiar datos privados.

**Aceptación y pruebas:** dos operaciones exitosas admisibles pueden continuar
mientras quede margen; chat y Planeación compiten por el último margen y sólo
gana lo presupuestable. Migración conserva todas las reservas anteriores;
reinicio, cambio de actor/perfil y fallo no dan saldo nuevo. Incertidumbre impide
reenviar o gastar su reserva. Consumo desconocido permanece `null`. Revalidar
sesión y plazo antes de transmitir. PostgreSQL real con conexiones concurrentes,
upgrade desde esquemas admitidos y regresiones de ambos consumidores; publicar
revisión/CI del SHA nuevo. **Evidencia:** [spec 0013](../specs/0013-planeacion-openai.md),
#67/#68/#69, PR #74 y handoff local diferenciado arriba.

### M3. Planeación manual variable útil — P0

**Issues:** [#52](https://github.com/eliancanul/AulaLista-SaaS/issues/52),
[#62](https://github.com/eliancanul/AulaLista-SaaS/issues/62), #67 y #69.
**Estado:** parcial y pendiente de validación real; formulario, lector, edición
básica, proveedor preparado y admisión variable integrados. #52/#62 siguen abiertos
con texto histórico; no reconstruirlos por ese estado administrativo.

**Problema/resultado:** crear para temas/contextos manuales diferentes y conservar
un resultado pertinente. **Alcance/exclusiones:** asignatura/grado/tema y opciones
actuales, sin referencia obligatoria, ausencia curricular explícita; no programa
anual, selector oficial, archivos o adaptación pedagógica acreditada por esquema.
**Dependencias:** M2, composición de #68 y gates aplicables de #69.

**Aceptación y pruebas:** al menos dos entradas variables admitidas llegan por
sesión/HTTP/PostgreSQL al lector, con resultados distintos y origen correcto;
propósito, actividades, suma de tiempos, materiales y evaluación cumplen el
contrato. Entrada/salida inválida conserva formulario y no anuncia una planeación
terminada. Ausencia de fuente y contexto hipotético sobreviven al guardar/reabrir.
Recorrido real de #69 con revisión humana de defectos, separado de pruebas de
software de `test_manual_generation.py` y `pilot_browser_integration.py`.
**Evidencia:** [spec 0010](../specs/0010-herramientas-contexto-curricular.md),+[0013](../specs/0013-planeacion-openai.md), PR #56/#59/#60/#70–#73.

### M4. Acceso y aislamiento en el candidato servido — P0

**Issues:** [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13), cerrado
para fase 1, y #69. **Estado:** pendiente de validación real del candidato nuevo.
**Problema/resultado:** entrar a la capacidad privada autorizada y recuperar sólo
el trabajo propio. **Alcance/exclusiones:** Google, sesión, CSRF, propiedad,
expiración/logout y acceso al runtime previsto; OTP real y vinculación son F10.
**Dependencias:** destino/candidato/configuración definidos por el responsable
operativo y M1–M3 integrados cuando corresponda; no nueva autenticación.

**Aceptación y pruebas:** login/recarga/logout/reentrada en el destino y SHA
declarados; revocación/cambio de cuenta corta lecturas, escrituras y respuestas
tardías; otro actor no lista ni abre contenido. Fallo cerrado sin configuración.
Auth/HTTP/PostgreSQL y smoke humano del despliegue autorizado; Google aceptado
históricamente sobre `355399b…` no valida automáticamente otro despliegue.
**Evidencia:** [B1](../specs/0005-autenticacion-local.md), aceptación enlazada en
#13 y puertas de #69. No se ejecutó ese smoke en esta auditoría.

### M5. Errores y recuperación sin duplicar consumo — P0

**Issues:** #11, #62/#68/#69. **Estado:** parcial; mecanismos de Planeación
integrados, aceptación de chat y del candidato común pendiente.
**Problema/resultado:** una demora, un rechazo o un fallo incierto no debe perder
la operación ni invitar a repetir gasto. **Alcance/exclusiones:** estados legibles,
consulta autorizada del mismo intento y entradas preservadas cuando proceda; no
autorretry de proveedor, falsa cancelación ni administración de incertidumbres.
**Dependencias:** M1–M3 y sus recibos; separación del buffer de edición de M6.

**Aceptación y pruebas:** distinguir rechazo definitivo, pendiente, incierto,
presupuesto/ocupación y sesión inválida. GET no llama al proveedor; el mismo POST
recupera o rechaza según contrato sin duplicar envío. Incierto no se convierte en
éxito por un mock ni libera reservas; cerrar/navegar no aplica callbacks viejos.
Pruebas de timeout, crash/reinicio, respuesta perdida, revocación y doble clic
por HTTP/PostgreSQL y navegador, con mensajes/foco observados. **Evidencia:**
[0013](../specs/0013-planeacion-openai.md), `test_planning_generation.py`,
`pilot-generation.connected.ts`; esos archivos son puntos de partida, no nuevas
ejecuciones acreditadas aquí.

### M6. Editar, guardar y reabrir la revisión confirmada — P0

**Issues:** [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15), #52/#69.
**Estado:** pendiente de validación real sobre IA; edición/recibo/CAS/biblioteca
ya integrados. **Problema/resultado:** conservar una corrección voluntaria sin
regenerar ni perder el original. **Alcance/exclusiones:** edición básica existente,
copia/borrador cuando aplique, revisión exacta; editor enriquecido y continuidad
de cambios nunca guardados tras 401 quedan en F8/F9. **Dependencias:** M3–M5.

**Aceptación y pruebas:** generar → corregir actividad/propósito/evaluación →
guardar con recibo → cerrar/reabrir conserva texto y origen, sin llamada IA.
Dos pestañas producen conflicto recuperable; respuesta tardía no pisa edición.
Nueva sesión recupera lo confirmado; 401 mantiene la purga acordada de buffer
no confirmado. HTTP/PostgreSQL, navegador y comprobación del recorrido real de
#69. **Evidencia:** [B3](../specs/0003-edicion-durable.md), PR #25/#39/#41/#56/#59
y addendum de #12; no se presenta el guardado explícito actual como autosave general.

### M7. Imprimir Planeación confirmada — P0

**Issues:** [#61](https://github.com/eliancanul/AulaLista-SaaS/issues/61), #69.
**Estado:** pendiente de validación real del candidato; código integrado por
#58 y corrección de foco por #72. **Problema/resultado:** imprimir la revisión
abierta con contenido completo. **Alcance/exclusiones:** diálogo nativo y PDF si
lo ofrece el navegador; no descarga automática, confirmación de impresión física
ni impresión de otras herramientas. **Dependencias:** M3/M6 y lector existente.

**Aceptación y pruebas:** una revisión antigua abierta se imprime aunque exista
otra nueva; sin borrador, controles, cuenta ni IDs internos. Multipágina conserva
el final, procedencia real y texto seguro. Cancelar/reintentar devuelve foco y
no guarda/regenera. Distinguir diálogo interceptado de PDF efectivamente creado
e inspeccionado y navegador probado. **Evidencia:** [contrato de impresión](../specs/impresion-planeacion-confirmada.md),+`print-planning.browser.ts`, #61/#72 y runner conectado; su mera presencia no
acredita un PDF del nuevo candidato.

### M8. Aceptar el recorrido privado y registrar sus límites — P0

**Issue:** [#69](https://github.com/eliancanul/AulaLista-SaaS/issues/69), abierto.
**Estado:** bloqueado para cierre por candidato/CI/evidencia real pendientes.
**Problema/resultado:** decidir con evidencia si funciona el recorrido completo,
sin llamar listo al producto por integrar software. **Alcance/exclusiones:**
Planeación de #69 y aceptación separada de chat en #11, con presupuesto total
común; no lanzamiento público, multi-docente, cobro ni eficacia educativa.
**Dependencias:** M1–M7 aplicables, revisión independiente y CI del candidato
exacto, permisos/configuración/destino y contabilidad operativa verificados.

**Aceptación y pruebas:** registrar SHA/configuración no secreta, operaciones
reales realizadas, límites, observaciones humanas y resultado go/no-go; dos
temas/contextos para #69 y dos turnos relacionados para #11. Apagar capacidad
impide nuevos envíos conservando lectura y reservas. No adoptar una excepción
de merge de #72/#73 para #74. Si falta un gate, indicar cuál y conservar el
estado pendiente. **Evidencia:** #69 y [workflow](../workflow.md); los responsables
de DB/despliegue aportarán sus recibos por separado.

## Después del MVP: cortes ya respaldados

### F1. Lector y reapertura de apartados — P1 · parcial

**Issue:** [#53](https://github.com/eliancanul/AulaLista-SaaS/issues/53), abierto.
**Problema/resultado:** leer tras guardar y volver a editar el apartado exacto.
**Alcance/exclusiones:** lector específico de escritorio C, formulario existente,
CAS y Usar apartado; no otro backend, generación de programas ni móvil A aún.
**Dependencias:** #57/#63/#64 integrados y referencia visual exacta accesible.
**Aceptación/pruebas:** crear → guardar → lector → reabrir → editar/guardar;
conservar todos los pares, contexto y revisión; conflicto/operación incierta no
pisa buffers. Derivar antes/después conserva orígenes independientes. Chromium
conectado, foco/cancelación, PostgreSQL cuando aplique y comparación visual.
**Evidencia:** [0012](../specs/0012-apartados-analiticos.md), #53 y PR #57/#63/#64.

### F2. Apartados en móvil A — P1 · bloqueado por F1

**Issue:** [#65](https://github.com/eliancanul/AulaLista-SaaS/issues/65), abierto.
**Problema/resultado:** completar el recorrido con la composición móvil aprobada.
**Alcance/exclusiones:** formulario/lector/reapertura y transiciones a explorador;
el reflow genérico existente no es móvil A, ni exige rediseño global.
**Dependencias:** merge del corte lector/reapertura de #53, no su cierre total;
referencia A exacta. **Aceptación/pruebas:** todos los pares/contenido largo y
acciones accesibles, tacto/teclado/foco, cambios de ancho sin pérdida de buffers,
errores/recuperación equivalentes; recorrido HTTP/PostgreSQL y capturas cotejadas
del candidato. **Evidencia:** #65, elección C/A en [0012](../specs/0012-apartados-analiticos.md).

### F3. Hoja de actividades y clave docente — P1 · bloqueado por decisiones

**Issue:** [#66](https://github.com/eliancanul/AulaLista-SaaS/issues/66), abierto.
**Problema/resultado:** hoja editable con respuestas docentes separadas.
**Alcance/exclusiones:** primer corte sintético y durable; no API libre ni otras
herramientas. **Dependencias:** orden acordado F1 → F2 → F3, aunque Hoja no necesita
técnicamente el esquema analítico; decidir tipos/límites, composición y alcance
de impresión antes de código. **Aceptación/pruebas:** cinco ejercicios de la
fixture, corregir tercero/respuesta y reabrir conserva relación/orden; la vista
del alumnado no filtra clave. Invalidaciones, ausencia de fuente, CAS/replay,
aislamiento y tardíos conservan garantías. Unitarias/PG/navegador y revisión de
composición; el número cinco es caso de prueba, no cuota aprobada.
**Evidencia:** #66 y [0010 §7](../specs/0010-herramientas-contexto-curricular.md#7-contratos-de-las-otras-cinco-herramientas).

### F4. Otras cuatro herramientas priorizadas — P2 · no implementadas

**Issue de referencia:** [#18](https://github.com/eliancanul/AulaLista-SaaS/issues/18).
Cada fila delimita un resultado ya propuesto en spec 0010; aún necesita un corte
pequeño en Issues al asignarse, sin abrir ahora duplicados. **Dependencias comunes:**
afinar composición y límites por herramienta; edición/recibos/aislamiento
existentes. Generación real tendrá gates propios; un corte sintético no depende
de OCR/corpus. **Exclusiones comunes:** motor universal, eficacia docente,
publicación/envíos y herramientas no elegidas.

| Herramienta / problema y alcance | Aceptación observable y pruebas del futuro corte |
| --- | --- |
| Preguntas sobre un texto: preguntas y respuestas ligadas al texto exacto elegido. | Respuesta literal tiene pasaje de apoyo; inferencia/reflexión se distingue y dato ausente no se presenta como encontrado. Editar pregunta/respuesta conserva relación/origen al reabrir. Texto vacío/ajeno y atribución sin apoyo fallan; contrato, aislamiento y recorrido conectado. |
| Adaptar material: ajustar extensión/lenguaje o formato conservando original y significado esencial. | Caso sintético de cuatro pasos conserva los cuatro al simplificar; original intacto, adaptación editable/reabrible con revisión de origen. Petición incompatible o pérdida crítica visible; pruebas de invariantes, recuperación y navegador. |
| Tarjetas de repaso: pares anverso/reverso, fuente o ausencia explícita. | Cantidad admitida y pares completos sin duplicados; editar uno mantiene la pareja/orden al reabrir. Límites, respuesta vacía, aislamiento y doble envío comprobados; contrato y UI conectada. |
| Bingo temático: cartones, banco y guía de términos/pistas, distribución durable. | Caso de doce términos/dos cartones 3×3: nueve términos distintos por cartón, cartones diferentes y pistas coherentes; reabrir conserva posiciones. Banco insuficiente/duplicado/cambio de banco tiene tratamiento explícito; validadores deterministas y recorrido conectado. |

**Evidencia:** [0010 §7–10](../specs/0010-herramientas-contexto-curricular.md),+catálogo de App.tsx y #18. El rótulo histórico «seis P0» de #18 describe aquella
priorización del catálogo, no hace estas cuatro herramientas dependencias del MVP actual.

### F5. Siete entradas futuras sin contrato completo — P2 · bloqueadas por definición

**Issue de referencia:** #18. **Problema/resultado:** conservar el catálogo
confirmado sin prometer generadores inexistentes. **Dependencias:** seleccionar
un corte, definir entrada/salida, límites, edición/fuentes, errores y diseño.
**Exclusiones:** implementar por el mero hecho de existir una tarjeta.

| Entrada | Resultado orientador confirmado; aceptación aún por concretar |
| --- | --- |
| Proyecto de aula | Proyecto por etapas; contrato completo pendiente. |
| Diagnóstico breve | Instrumento con criterios de lectura; contrato completo pendiente. |
| Rúbrica y lista de cotejo | Criterios observables editables; contrato completo pendiente. |
| Memorama | Pares de asociación; contrato completo pendiente. |
| Sopa de letras | Cuadrícula y solución; contrato completo pendiente. |
| Adivina con pistas | Pistas graduadas y respuestas; contrato completo pendiente. |
| Quiz para proyectar | Preguntas de presentación y respuestas; contrato completo pendiente. |

**Aceptación y pruebas de preparación por entrada:** contrato revisado con un caso
de éxito, inválido, fuente ausente/ajena, guardar/reabrir y recuperación; implementación
y pruebas futuras quedan pendientes hasta fijarlo. Hoy comprobar que la entrada
no activa peticiones ni produce éxito ficticio. **Evidencia:** [catálogo 0010 §2](../specs/0010-herramientas-contexto-curricular.md#2-catálogo-completo).
Son 13 entradas en total: Planeación, Hoja, las cuatro F4 y estas siete. Secuencia
didáctica y Programa analítico están dentro de Planeación, sin tarjetas adicionales.

### F6. Contexto curricular trazable y reutilizable — P2 · bloqueado por decisiones

**Issue:** #18. **Problema/resultado:** elegir una vez contenido/PDA y reutilizarlo
sin inventar autoridad. **Alcance/exclusiones:** cobertura inicial propuesta
Primaria Fase 4, cita literal/localizador/versiones, aportación manual válida;
no cobertura nacional completa, copia del banco Teachy ni importación comercial
por ser un PDF público. **Dependencias:** decisión de edición exacta 2024/2025
y, para incorporar contenido, derechos/destinos resueltos; implementación de selector.

**Aceptación/pruebas:** selección se conserva al crear/derivar/reabrir; cambiar
grado/fuente sólo resuelve incompatibilidades afectadas. Cita editada deja de ser
literal, ausencia no se vuelve oficial y versión nueva no cambia el pasado.
Pruebas de autoridad/revisiones/aislamiento y selector conectado. El cierre
documental de #18 no exige importar un corpus. **Evidencia:** [0010 §6/11](../specs/0010-herramientas-contexto-curricular.md);
recomendación 2025 no es decisión adoptada; prototipo aún referencia 2024.

### F7. Conversación con contexto y recursos reutilizables — P2 · parcial

**Issues:** #11/#18; base de biblioteca [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17)
y originales [#36](https://github.com/eliancanul/AulaLista-SaaS/issues/36) cerrados.
**Problema/resultado:** trabajar con contexto activo visible y consultar recursos
sin perder conversación. **Alcance/exclusiones:** selección explícita de recurso,
clase/sesión o contexto autorizado, referencias exactas y cambios propuestos
distintos de aplicados; no CRUD escolar, marketplace ni envío implícito de biblioteca.
Biblioteca mínima/original exacto ya existen; no reconstruirlos.
**Dependencias:** M1 y contrato de cada incorporación de contexto/destino; documentos
reales esperan F12 sólo cuando formen parte del envío.

**Aceptación/pruebas:** abrir/cerrar recurso mantiene conversación y compositor;
selección muestra qué revisión se usará y otra cuenta/revocación la deniega.
Material ausente no tiene preview ficticia. Proponer cambios no modifica el
recurso hasta la acción definida; reversión se ofrece sólo con soporte probado.
Pruebas de navegación/foco, versiones, aislamiento, red observada y no envío al
consultar. **Evidencia:** #11, #18 y [catálogo de fuentes](../specs/0006-catalogo-fuentes.md).

### F8. Editor de texto enriquecido — P2 · no implementado

**Issues de referencia:** #18/#52, con garantías de #15. **Problema/resultado:**
ampliar corrección más allá de los campos básicos. **Alcance/exclusiones:** integración
posterior mencionada en 0010; formatos, composición y límites aún sin contrato,
sin hacerla requisito del lector/edición básica actuales. **Dependencias:** definir
ese corte antes de asignar código. **Aceptación/pruebas:** contrato de formatos y
contenido seguro, ida/vuelta guardar/reabrir, origen/CAS/recuperación y teclado
definidos y luego comprobados; no aceptar HTML ejecutable ni pérdida silenciosa.
**Evidencia:** [0010 §3](../specs/0010-herramientas-contexto-curricular.md#3-recorrido-y-distribución-del-formulario), #52.

### F9. Continuidad de cambios no guardados tras 401 — P2 · no implementado

**Issue de referencia:** #15, cerrado con esta mejora expresamente aplazada.
**Problema/resultado:** recuperar edición nunca confirmada después de reautenticación.
**Alcance/exclusiones:** corte futuro específico; hoy se purga ante 401 ambiguo
y sólo se garantiza trabajo confirmado. **Dependencias:** decisión de almacenamiento,
autoridad/retención y diseño seguro entre sesiones, sin reutilizar un ID local como permiso.
**Aceptación/pruebas:** misma cuenta reautenticada recupera sólo el buffer permitido;
otra cuenta no lo ve; revocación, TTL, dos pestañas, operación incierta y cambios
posteriores se concilian sin duplicar ni sobrescribir. Pruebas auth/PG/navegador.
**Evidencia:** [decisión B3](../specs/0003-edicion-durable.md#decisión-de-fase-1-recuperación-tras-sesión-inválida).
El respaldo actual en `sessionStorage`, hasta 24 h y misma sesión, no satisface esto.

### F10. Pendientes explícitos de acceso — P2

**Issue de referencia:** #13, cerrado para fase 1; [contrato B1](../specs/0005-autenticacion-local.md).

| Capacidad, estado y resultado | Alcance/exclusiones y dependencias | Aceptación observable / pruebas |
| --- | --- | --- |
| OTP real por correo: parcial, transporte runtime no implementado y pospuesto por el usuario. | Reutilizar challenge/límites/sesión; proveedor y propósito autorizados antes de activar. No campañas. | Entrega real, expiración/un uso/reenvío/abuso y errores sin enumeración de cuentas; transporte real separado de tests sintéticos; caída no finge envío. |
| Vinculación de métodos: no implementado. | Prueba fresca de control de ambos métodos y flujo definido; nunca fusión por email coincidente. | Métodos vinculados acceden al mismo ámbito; identidad ajena, coincidencia de email y replay no enlazan. Pruebas auth/PG, carreras y recuperación. |
| Consentimiento opcional de marketing: no implementado. | Finalidad/retirada y registro separado; rechazo no bloquea login. Sin proveedor/campañas ni contacto autorizado por este documento. | Opción no premarcada; aceptar/rechazar/retirar conserva acceso; ausencia/revocación impide uso promocional. Pruebas de estado y ausencia de envíos. |

La purga operativa de registros auth expirados permanece dentro de retención en
F12; no se introduce un cron como requisito del chat de texto por esta referencia.

### F11. Escala visual y compatibilidad pendiente — P1 · parcial

**Issue:** [#31](https://github.com/eliancanul/AulaLista-SaaS/issues/31), abierto.
**Problema/resultado:** resolver el reporte de tamaño excesivo donde aún sea
reproducible. **Alcance/exclusiones:** acceso y espacio autenticado, reproducción
de Firefox/estado del navegador; ajuste vertical Chromium integrado por #55,
sin diagnosticar «zoom global» por inferencia. **Dependencias:** observación del
navegador/viewport/zoom/fuentes afectados y entorno de prueba disponible.
**Aceptación/pruebas:** comparación a igual viewport con diseño aprobado, causa
reproducida y corrección si corresponde; reflow, teclado/foco/texto ampliado y
acciones sin recortes. Firefox/WebKit no se dan por probados por Chromium.
**Evidencia:** [UI31](UI31-altura-acceso.md), PR #55 y comentarios de #31;
la descarga de navegador históricamente denegada no se reintenta por este documento.

### F12. Admisión y operación de documentos reales — P2 · bloqueado para activar

**Issues:** [#19](https://github.com/eliancanul/AulaLista-SaaS/issues/19),
[#40](https://github.com/eliancanul/AulaLista-SaaS/issues/40), abiertos.
**Problema/resultado:** conservar/procesar material real bajo permisos y límites
comprobados. **Alcance/exclusiones:** puertas de [0011](../specs/0011-puertas-archivos-ia.md)
ya especificadas por #54; su implementación/aceptación operativa está pendiente.
No es prerrequisito del MVP manual. **Dependencias:** decisiones/datos/destinos
del alcance concreto y cortes en Issues antes de activar; almacenamiento/parser/
RLS/cola no se eligen sólo por aparecer como alternativas.

| Puerta y resultado pendiente | Aceptación observable y pruebas exigidas |
| --- | --- |
| Admisión por formato, tamaño/páginas y carga acotada. | Tipo falso, cifrado/no soportado, exceso o interrupción rechazan sin original utilizable falso; streaming y expansión medidos. Bytes opacos T2 no son admisión real. |
| Almacenamiento privado e integridad. | Bytes/versión/hash/recibo coherentes; fallos de commit y restos recuperables; rol runtime y cuenta ajena no leen. Si se eligen objetos, demostrar coordinación/limpieza. |
| Parser/render aislado y contenido no confiable. | Malformado/bomba/loop/red/hijos/salida excesiva se acotan con proceso real; todas las páginas mantienen estado, sin ejecutar instrucciones del documento. |
| Permisos, revocación, retención/purga y caché si se justifica. | Reautorizar antes de envío/lectura/replay; derivados/caché no reviven acceso. Política finita, purga tras crash y logs sin cuerpos; no equiparar logout a borrado de fuente. |
| Backup/restore operativo. | Restauración aislada de DB/bytes y revisiones, hash/FKs/recibos íntegros; aplicar revocaciones posteriores sin reenviar pendientes. RPO/RTO aprobados y medidos. Downgrade no demuestra restore. |

**Evidencia:** spec 0011 §2–5/8 y contratos offline
[0007](../specs/0007-integridad-fuente.md), [0008](../specs/0008-evidencia-literal.md),
[0009](../specs/0009-anclas-anexos.md), integrados por #45–#47; esos controles no
certifican parser, documentos reales ni seguridad operativa.

### F13. Interpretación automática del material y fuentes web — P2 · no implementado

**Issues:** #19/#18, con evaluación #40. **Problema/resultado:** carga → resultado
útil automáticamente guardado/editable, preservando lo independiente y la autoridad.
**Alcance/exclusiones:** flujo de spec 0002, resultado real versionado, dudas visibles
y máximo una aclaración indispensable durable por planeación; no límite de un turno
de chat. Búsqueda web es opcional futura y exige su propio alcance de fuentes/destinos.
No anexos descargados ni web automática por instrucciones en material.
**Dependencias:** F12 aplicable, evaluación F14 y método/cotas concretos aprobados.

**Aceptación/pruebas:** caso claro sin preguntas, duda material tras resolución
automática acotada, otra sesión/versión/retry jamás crea segunda aclaración;
carreras presentan la misma pendiente. Resultado parcial identifica ausencias;
autosave confirma recibo y no pisa ediciones ante tardíos/conflicto. Web conserva
URL/versión/localizador realmente usados y distingue cita/sugerencia/ausencia.
Pruebas de producto, persistencia/concurrencia, inyección de instrucciones y
recorrido conectado; benchmark y observación docente separados.
**Evidencia:** [0002](../specs/0002-flujo-automatico-material.md), [0011 §6–8](../specs/0011-puertas-archivos-ia.md),+[0010 §4/6](../specs/0010-herramientas-contexto-curricular.md). Planeación manual
estructurada de 0013 no acredita interpretación de documentos ni este autosave.

### F14. Evaluación real y decisión de estrategia — P2 · pendiente de validación real

**Issue:** #40; referencias [T4](T4-preparar-evaluacion.md),
[T5](T5-ensayo-interpretacion.md). **Problema/resultado:** escoger por calidad,
cobertura y coste observado; «falta evidencia» es una conclusión válida.
**Alcance/exclusiones:** corpus real autorizado, referencia independiente/revisable,
extracción+modelo frente a visual/híbrido; no reabrir como trabajo nuevo #32/#33/#34,
cerrados y sustituidos por #40, ni mezclar sintéticos con evidencia docente.
**Dependencias:** páginas/destinos autorizados, particiones por documento/familia,
exposición declarada, rúbrica/presupuesto/candidatos congelados; peso de tokens 20 %,
restante 80 %, normalización y mínimos aún por acordar antes del ensayo final.

**Aceptación/pruebas:** replay privado reproducible, referencias/páginas exactas,
omisiones/fallos en denominadores, intentos completos, consumo desconocido `null`,
sin inferir coste API de suscripción. Decisión/insuficiencia documentada en ADR;
revisión IA no se convierte en gold humano. H2/observación con docentes y H4
comercial necesitan evidencia humana propia antes de sus afirmaciones.
**Evidencia:** #40, [0002](../specs/0002-flujo-automatico-material.md),+[hitos](../reviews/README.md). Los recibos y páginas privados no pertenecen al repo.

**Instrumento asociado:** [#49](https://github.com/eliancanul/AulaLista-SaaS/issues/49)
sigue abierto pero preparación Pydantic/Promptfoo está integrada por #50. Estado
parcial/bloqueado para ejecutar CLI por la restricción de red documentada. Alcance:
adaptadores locales y contrato existente, sin proveedor nuevo ni evaluación docente.
Aceptación: reconciliar cierre del corte offline con su PR/CI; si se retoma CLI,
resolver el acceso permitido y registrar ejecución real, sin sortear la restricción.
Ver [README de Promptfoo](../../evaluation/promptfoo/README.md).

## Incertidumbres y decisiones que no son features aprobadas

1. Los SHA locales de chat/presupuesto cambian mientras se implementan. El
   coordinador debe enlazar el candidato publicado y su nueva revisión/CI en
   #11/#74/#69; nunca trasladar las 771/8 pruebas de 509e4a6 al reemplazo.
2. #52/#61/#62/#68/#19/#49 conservan cuerpos/estados anteriores a sus merges;
   conciliar allí el alcance integrado y lo pendiente. Este documento no cierra
   issues ni cambia estados remotos. #13/#15 cerrados conservan F9/F10 aplazados.
3. Micrófono, Ajustes y Buscar aparecen deshabilitados en main. No se localizó un
   contrato completo para voz o ajustes generales; no cuentan como terminados ni
   se convierten aquí en tickets de implementación. La búsqueda de apartados sí
   existe; eso no demuestra búsqueda global de conversaciones/recursos.
4. El alcance exacto de secuencias de varias sesiones, actualización voluntaria
   de contexto con diferencias y exploración visual de todo el historial requiere
   concretar contrato en #18/#11 si se selecciona; conservar revisiones en DB no
   demuestra esas interfaces. No agregar otra tarjeta de Secuencia.
5. La suscripción futura está en [ADR 0001](../adr/0001-fundacion-personal.md),
   pero precio, cobro/cancelación y soporte no tienen corte ejecutable aprobado
   localizado. Resolver con evidencia H4 y decisión del propietario antes de un
   ticket comercial; no inventar proveedor, plazo ni motor de pagos.
6. No hay evidencia en este corte de aceptación real completa de #69, chat final,
   eficacia pedagógica, corpus oficial habilitado o producto listo para producción.
   Los 38 estados se explican en la [auditoría del inventario](../reviews/0002-pendientes-20261024.md).

## Cierre de esta entrega documental

El PR debe enlazar #11/#18/#69 y este corte, identificar base/head/manifiesto,
comprobar rutas/enlaces locales y diff sólo documental y aportar revisión
independiente de completitud y coherencia. No requiere ejecutar nuevamente suites
de producto por añadir referencias; CI aplicable y revisión pertenecen al
candidato documental exacto. La publicación draft se coordina tras esa revisión;
publicar no acepta features, integra código ni habilita operaciones remotas.
