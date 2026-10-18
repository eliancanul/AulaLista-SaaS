# Especificación 0011: puertas para archivos reales e IA

Contrato documental de [#19](https://github.com/eliancanul/AulaLista-SaaS/issues/19).
Base inspeccionada: `b461c0ffb8861553a2d1aabafebd04588ab336d2`, 18 de octubre
de 2026 UTC. Define qué demostrar antes de retirar restricciones sintéticas;
**no habilita cargas reales, parsing, proveedores, gasto ni piloto**. Las pruebas
operativas descritas aquí están pendientes. Su ejecución, responsables nominales
y resultados pertenecen a los futuros issues/PR, no a un backlog paralelo.

## 1. Frontera comprobada y decisiones abiertas

| En la base inspeccionada | Lo que no acredita |
| --- | --- |
| [B1](0005-autenticacion-local.md): sesión propia revocable, autorización transaccional por ámbito y fallo cerrado sin configuración. | Aislamiento operativo completo, retención/purga o restore de producción. La prueba humana de Google tiene su SHA propio; OTP real sigue pospuesto. |
| [T2](0001-fundacion.md): bytes opacos de 1 a 65 536 por versión, SHA-256 calculado en servidor, historia inmutable y recibo en PostgreSQL. | Admisión segura de PDF, imagen, Office u otro formato. `application/octet-stream` no verifica qué contienen los bytes ni que sean sintéticos. |
| [B2](../tickets/B2-resultado-simulado.md) y [B3](0003-edicion-durable.md): fixtures exactos, guardado, revisión, copia, borrador, recuperación de operación y CAS. | Generación libre, procesamiento externo o continuidad de texto no confirmado tras 401/reautenticación. |
| [Integridad](0007-integridad-fuente.md), [evidencia literal](0008-evidencia-literal.md) y [anclas/anexos](0009-anclas-anexos.md): comprobaciones offline sobre entradas controladas. | Sandbox de archivos, autenticación, extracción fiel, comprensión semántica o validación docente. |
| [Preparación Pydantic/Promptfoo](../../evaluation/promptfoo/README.md): estructura del resultado fixture y adaptadores Python locales. | Contrato de salida real, modelo elegido o CLI Promptfoo aprobada. Su bloqueo de red sigue vigente. |
| [Herramientas y contexto](0010-herramientas-contexto-curricular.md): diseño de creación manual, referencias y reutilización. | Implementación de sus nuevos recorridos en esta base ni permiso para inventar una fuente al crear sin adjunto. |

La autorización real se revalida en
[`materials.authorize`](../../src/aulalista_api/materials.py); los UUID, hashes y
etiquetas offline nunca la sustituyen. [`bounded_content`](../../src/aulalista_api/material_routes.py)
acota el cuerpo aun sin Content-Length, pero no es un detector de formato.
No se anunciará rechazo técnico de todo documento real mientras esa admisión
no exista; los ejemplos actuales y su alcance autorizado siguen siendo sintéticos.

Se conservan FastAPI, PostgreSQL, propiedad personal y separación entre actor,
propietario y eventual pagador de [ADR 0001](../adr/0001-fundacion-personal.md).
Este contrato no elige objetos frente a DB, parser/OCR, cola, SDK, proveedor/modelo,
región ni cuotas comerciales. Esas decisiones necesitan evidencia y alcance propio.

## 2. Matriz de puertas H3

Las responsabilidades siguientes son funciones, no personas ya asignadas ni
aprobaciones efectuadas. Antes de una activación se registra una persona
responsable de cada decisión/operación, un implementador y un revisor independiente
del candidato. El propietario del producto decide el alcance; seguridad/privacidad
y QA/operación revisan [H3](../reviews/README.md). Ningún rol inventa permisos sobre
datos ajenos. Mientras falte una puerta aplicable, esa capacidad permanece cerrada.

| Puerta y responsable de decisión | Evidencia exigida antes de activar | Caso negativo y criterio de parada |
| --- | --- | --- |
| Datos y destinos: propietario del producto con quien tenga autoridad sobre el material; revisión de privacidad. | Registro privado de datos/versiones, propósito, titularidad/permiso, destinatarios exactos y retención; autorización vigente de transmisión cuando corresponda. | Documento ajeno o destino no aprobado: no leer para procesar, transmitir ni reutilizar. Un login, una URL pública o pagar no concede estos derechos. |
| Identidad y aislamiento: backend; revisión de seguridad. | Pruebas con sesiones reales y rol runtime: autorización en lectura, escritura, replay, caché y artefactos; conexiones recicladas A→B sin contexto residual; defensa DB elegida y probada sin privilegios de dueño/bypass. | Cuenta B adivina un ID/clave de A o sesión revocada: denegación sin bytes/metadatos privados. RLS, si se adopta, no reemplaza el caso de uso. Una fuga bloquea el piloto. |
| Admisión: backend y operación. | Lista cerrada de formatos/variantes y valores numéricos de límites; medición por streaming, detección de tipo y prueba de límites en todas las rutas de entrada. | Exceso, tipo falso, variante cifrada/no soportada o carga incompleta: rechazo acotado, sin versión utilizable ni procesamiento. |
| Almacenamiento privado: arquitectura y operación; revisión de seguridad. | Mecanismo mínimo elegido, rol de servicio y accesos privados; integridad de bytes/versiones; protocolo de confirmación y limpieza de restos probado bajo fallos. | Objeto público, cruce de ámbito, enlace reutilizable tras revocación o commit sin bytes recuperables: no confirmar guardado ni abrir acceso. |
| Parser y render: implementador del procesamiento; revisión de seguridad/QA. | Versión/lock, aislamiento efectivo, límites CPU/memoria/tiempo/salida y prueba del proceso real sin red/credenciales. Inventario de páginas y estados conservado. | Documento malformado, bomba de descompresión, salida excesiva, crash o intento de red: cortar; conservar diagnóstico seguro, sin resultado completo ficticio. |
| Retención, caché y revocación: propietario del producto y operación; revisión de privacidad. | Matriz de datos con plazos finitos, purga verificable, dependencias e invalidación; prueba de acceso revocado en originales, derivados, cachés y pendientes. | Borrado parcial, caché entre cuentas o artefacto que revive al reabrir: bloquear acceso afectado y declarar pendiente; no anunciar borrado completo. |
| Backup/restore: operación; revisión independiente de QA/seguridad. | Restauración ensayada de DB y bytes exactos, con recibos, revisiones, permisos y revocaciones; objetivos de pérdida/tiempo aprobados y medidos. | Falta un objeto, hash no coincide o backup anterior revive una sesión/dato revocado: mantener restauración fuera de servicio. |
| Procesamiento/proveedor: propietario del producto; revisión técnica, pedagógica y de privacidad. | [T4](../tickets/T4-preparar-evaluacion.md)/[T5](../tickets/T5-ensayo-interpretacion.md), evidencia pertinente de [#40](https://github.com/eliancanul/AulaLista-SaaS/issues/40), modelo/modalidad/tarea congelados y datos/destino permitidos. | Sin evidencia suficiente, salida inválida o cambio de proveedor/modalidad: no elegir por comodidad ni recurrir silenciosamente a otro servicio. |
| Límites y consumo: propietario del presupuesto y operación. | Cotas de entrada/salida/intentos/concurrencia/coste, mecanismo que las hace cumplir y conciliación de todos los intentos, incluidos fallos e inciertos. | Límite ausente, coste superior al autorizado o consumo incierto sin margen acotado: no iniciar otra llamada ni recargar saldo. |
| Resultado, edición y recuperación: backend/UI; revisión independiente de QA. | Contrato real versionado, compatibilidad de lectura y pruebas de respuesta perdida, conflicto, edición humana y resultado tardío; límite durable de aclaración. | Resultado viejo pisa cambios, doble clic duplica consumo o aparece otra pregunta: detener activación y corregir, sin presentar CI sintética como aceptación real. |

Estas puertas no son pantallas de aprobación por bloque para el docente. Se
resuelven antes de exponer la capacidad. El recorrido conserva cero preguntas por
defecto y la única aclaración interpretativa permitida por la sección 7.

## 3. Datos, admisión y almacenamiento

### Permiso mínimo y trazabilidad

El registro privado de una ejecución identifica: actor/ámbito autorizados;
fuentes y versiones exactas; datos/campos o páginas que saldrán; finalidad;
servicio, cuenta/proyecto y destino; modalidad; vigencia del permiso; retención
aplicable y referencia a su autorización. Una autorización de lectura, una carga
local o un presupuesto no autorizan enviar el material a un proveedor distinto.
Datos de estudiantes/menores o información sensible exigen sus permisos específicos;
el primer ensayo de #40 conserva sus exclusiones. No se vuelven admisibles por
aparecer dentro de un documento profesional.

Originales, imágenes, transcripciones, prompts/respuestas con contenido privado,
identificadores y recibos privados quedan fuera del repo, PR, CI y logs públicos.
La evidencia pública usa código, casos sintéticos y conclusiones saneadas.
Los secretos no se guardan con los materiales ni se entregan al parser/modelo.

### Perfil de admisión obligatorio

Antes de admitir un formato se fijan y prueban valores para:

- Extensiones/MIME/firmas y variantes admitidas; discrepancia de tipo, archivos
  cifrados, macros, contenido activo, archivos contenedores y adjuntos embebidos.
  Lo no contemplado se rechaza; no se prueba otro parser por ensayo y error.
- Bytes máximos por archivo, solicitud y ámbito; número de archivos; páginas,
  píxeles/dimensiones y bytes expandidos cuando correspondan. El inventario real
  se obtiene de forma acotada, sin confiar en metadatos declarados por el cliente.
- Tiempo de carga, procesamiento y salida; límites de memoria/CPU y archivos
  temporales. Tanto Content-Length falso/ausente como transferencia interrumpida
  deben terminar sin reservar almacenamiento ilimitado.
- Procedimiento ante exceso: rechazar la entrada o declarar selección explícita
  de páginas autorizadas, manteniendo las omitidas visibles. Nunca truncar y
  etiquetar el resto como documento completo.

Los 65 536 bytes de T2, 4096 bytes de petición B2, 8192 de escritura B3 y topes
de los módulos offline son límites técnicos existentes, **no cuotas aprobadas de
archivos reales ni de IA**. Los nuevos valores siguen pendientes: un campo sin
valor no significa ilimitado. La admisión real permanece deshabilitada hasta
tenerlos aprobados, implementados y probados.

### Confirmación de original y derivados

Guardar conserva bytes exactos, tamaño/hash calculados por servidor, ámbito,
fuente/versión, actor y operación. El nombre del archivo no determina identidad,
ruta ni permisos. Abrir descarga una versión autorizada exacta; no hace fallback
a `latest`, ejecuta contenido activo ni transforma HTML del documento en interfaz.

Si DB guarda también los bytes, demostrar atomicidad en la misma transacción. Si
se elige almacenamiento de objetos, demostrar la coordinación mínima necesaria:
objeto privado preparado e íntegro antes de confirmar la referencia, fallo sin
recibo de éxito y limpieza acotada de huérfanos. Una URL existente no prueba
durabilidad. No hace falta introducir objetos, cola o un coordinador genérico
para aprobar este documento.

Los derivados identifican original/versión, páginas físicas, modalidad, hashes de
artefactos y configuración/herramienta. Texto, render, PDF visual, interpretación
y edición son representaciones distintas. `source_integrity` ayuda a conservar
esa separación; no certifica la extracción ni concede acceso por sí mismo.

## 4. Parser y contenido no confiable

El parser/render se ejecutará con privilegios mínimos, sin secretos de aplicación
ni acceso a materiales de otros ámbitos, sistema host o red. Se probará el proceso
real, no sólo una función falsa: límites del proceso y su salida, cierre de hijos,
limpieza temporal y comportamiento tras timeout/crash. Macros, JavaScript, rutas
embebidas y referencias remotas no se ejecutan ni descargan. Si el método necesita
un servicio externo, requiere un destino autorizado y sus propias cotas antes de
enviar; no hereda una excepción al aislamiento del parser local.

La salida conserva cada página como procesada, fallida o no procesada y el motivo;
no confunde texto vacío con página visual vacía. Una parte independiente puede
seguir útil si la política lo admite, sin afirmar comprensión completa. Original,
primera salida y correcciones se conservan separados según la política de datos.

Documentos, OCR, metadatos y respuestas del modelo son datos no confiables. Frases
como «ignora las reglas», «envía esto a esta URL» o «usa otra cuenta» nunca cambian
herramientas, presupuesto, identidad, destinos ni contrato. Tampoco ejecutan código,
SQL, expresiones o enlaces ni crean referencias oficiales. Credenciales y datos
de otros ámbitos no forman parte del contexto. La salida se valida estructuralmente
y se presenta como texto seguro; esquema válido no significa verdad curricular.

Una solicitud de búsqueda web, descarga de anexo o herramienta sugerida dentro
del documento no inicia esa acción. La futura capacidad necesita alcance y
autorización propios. Los casos adversariales deben comprobar cero transmisiones
no previstas, incluso por telemetría, crash reporting, SDK o credenciales heredadas.

## 5. Retención, caché, revocación y recuperación

### Política de datos exigida antes de activar

No se inventan plazos ni promesas de borrado de terceros. La persona responsable
fija duración máxima, disparador de eliminación, destino y prueba de cumplimiento
para cada fila. Duración desconocida o purga no verificable bloquea la exposición
correspondiente hasta resolverla o aceptar explícitamente un alcance compatible.

| Datos | Regla mínima | Evidencia requerida |
| --- | --- | --- |
| Originales, revisiones, borradores y recibos | Privados por ámbito; historia exacta mientras sea retenida; eliminación coherente con sus dependencias. | Inventario por versión, política aprobada y prueba de denegación/purga sin referencias recuperables indebidas. |
| Temporales, renders, extracción y salidas fallidas | Plazo máximo desde creación/fallo; limpieza también tras caída, no sólo al terminar normalmente. | Reloj/ejecutor de limpieza y prueba después de crash, sin cuerpos privados en logs. |
| Prompts/respuestas en proveedor y archivos remotos | Retención/configuración/uso de datos reales del servicio elegidos y autorizados; incluir identificadores remotos y método de eliminación cuando exista. | Condiciones verificadas y recibo o límite documentado; no prometer eliminación instantánea ni entrenamiento desactivado sin evidencia. |
| Cachés | Privadas por ámbito; no reutilización entre propietarios, ni siquiera por hash idéntico. | Clave/contexto verificables, expiración e invalidación por versión, política o permiso cambiado. |
| Logs, métricas y trazas | Sólo datos operativos mínimos; sin originales, tokens de sesión, claves o prompts/respuestas privados. | Prueba con fallos que compruebe ausencia de contenido, acceso restringido y plazo de purga. |
| Backups | Plazo máximo de copias, acceso limitado y revocaciones conservadas hasta que la última copia afectada deje de poder restaurarse. | Restore ensayado más eliminación/expiración verificable; no confundir ocultación con borrado físico. |
| Navegador | No ampliar persistencia local de material real implícitamente. El respaldo B3 actual está en claro y limitado a la misma sesión. | Decisión explícita sobre datos admitidos y prueba de TTL, logout, cambio de cuenta y límites de limpieza. |

Una caché debe ligar ámbito, fuente/versión y hash, representación, tarea/contexto,
configuración del parser/modelo/prompt/esquema y política relevante. Reutilizarla
exige reautorizar acceso y vigencia, no basta acertar la clave. Revocar un dato
invalida sus entradas dependientes. No se introduce organización/membresía en el
modelo personal ni caché global de contenido privado. Si no hay un caso medido
que justifique caché, se omite; el contrato no obliga a construirla.

### Revocar no es borrar ni cancelar una transmisión ya realizada

La revocación de sesión B1 y la revocación de acceso/uso de una fuente son cosas
distintas. La segunda aún necesita implementación. Debe impedir lecturas, nuevos
procesamientos, replays que revelen contenido y reutilización de derivados/cachés
afectados. Revalidar permiso también antes de enviar a un proveedor y antes de
aceptar su resultado; un job admitido antes no adquiere permiso perpetuo.

Una revocación no retira bytes que ya recibió un tercero o un usuario. Se detienen
nuevos envíos; se solicita cancelación/eliminación sólo por mecanismos autorizados
y se registra su resultado real. Una cancelación o timeout no demuestra que no
hubo consumo. El resultado tardío no vuelve visible un material revocado.

Antes de implementar borrado se define qué ocurre con referencias, copias,
ediciones y recibos dependientes: denegar el acceso afectado, conservar sólo
metadatos mínimos necesarios o eliminar según política y autorización. No se
conserva una copia accesible del contenido dentro de un recibo «borrado». Las
revisiones hoy son inmutables y T2 no ofrece borrado: no se promete una cascada
que el código actual no tiene, ni se eluden los controles con el rol runtime.

### Restore conjunto y respuesta perdida

El plan de recuperación fija RPO/RTO y un punto coherente de DB/objetos si existen,
incluyendo versiones exactas, recibos/idempotencia, referencias y revocaciones.
Se ensaya en un destino aislado autorizado, sin activar notificaciones, envíos ni
consumo de proveedor. Se verifican hashes, FKs, punteros e inventario; ningún
registro confirmado apunta a bytes ausentes y ningún objeto ajeno se vuelve legible.

Restaurar un backup antiguo no debe resucitar sesiones, permisos o material
borrado. Antes de servir tráfico se aplican las revocaciones posteriores y se
invalidan sesiones/cachés que no puedan reconciliarse; si no se puede demostrar
vigencia, se deniega acceso. Pendientes externos se concilian con recibos, sin
reenviar al arrancar. El downtime termina sólo cuando esas comprobaciones pasan.
Downgrade de migración o recrear una DB de tests no prueba este procedimiento.

Se preserva la [decisión de fase 1 tras 401](0003-edicion-durable.md#decisión-de-fase-1-recuperación-tras-sesión-inválida):
el texto local no confirmado puede perderse. Tras login se recupera sólo lo
confirmado, bajo la sesión autorizada. Una respuesta perdida puede haber hecho
commit; consultar su operación antes de crear otra. El respaldo de hasta 24 h
no acredita recuperación entre sesiones ni revocación física de todos los bytes
de navegador/SO. Un archivo real requiere revisar esta exposición antes de admitirlo.

## 6. Límites y separación de ensayo e integración

Cada ejecución real necesita un perfil congelado y autorizado con valores
numéricos: archivos/bytes/páginas o imágenes; contexto y entrada máximos; salida
máxima; intentos totales y por etapa; concurrencia; timeout; tokens disponibles
por categoría; presupuesto total y moneda. Incluye selección, OCR, verificación,
reparación, escalamiento, fallos y reintentos. Un timeout no reinicia la cuota.

Antes de cada intento, el sistema comprueba permiso vigente y margen para su
peor coste permitido, sumando consumo confirmado y reserva de intentos en vuelo
o inciertos. La reserva/concurrencia debe ser atómica para que dos peticiones no
gasten el mismo saldo. No hay retries automáticos por defecto ni cambio de modelo
para sortear una cota. Un perfil con retries debe fijar máximo y condiciones, y
haber resuelto antes el efecto del intento previo. Sin cota verificable, no llamar.

Registrar operación lógica e intentos por separado, modelo/modalidad exactos,
entrada/configuración congeladas, estado, tiempos de alcance declarado y consumo
observado. Entrada/salida/caché/razonamiento desconocidos son `null`, no cero;
no se estiman tokens de bytes/palabras ni se equipara una suscripción con la API.
La falta de una medida puede dejar una comparación inconclusa; si impide acotar
el presupuesto, bloquea nuevos intentos. Tarifa, moneda/conversión, cargos y margen
se verifican para la ejecución concreta, sin publicar credenciales o facturación.

Un acuerdo de proveedor o presupuesto para un ensayo separado no elige SDK,
arquitectura ni configuración del producto. No sustituye páginas/datos y destino
autorizados, tarea/modelo/modalidad fijados, forma segura de credencial ni evidencia
de consumo. Preparar un runner o probar un transporte falso comprueba software;
no es una llamada real ni evidencia de calidad docente.

[T4](../tickets/T4-preparar-evaluacion.md) fija corpus, particiones, referencia,
rúbrica y métricas; [T5](../tickets/T5-ensayo-interpretacion.md) compara y sustenta
la decisión, pudiendo concluir «falta evidencia». [#40](https://github.com/eliancanul/AulaLista-SaaS/issues/40)
conserva aprobación de páginas, exclusiones y separación entre evaluación real y
sintética. Este contrato no repite su benchmark, no agrega cohortes incompatibles
ni altera el peso del 20 % de ahorro de tokens y los demás criterios pendientes
de [spec 0002](0002-flujo-automatico-material.md). Una decisión experimental no
abre H3 ni autoriza su integración; ésta requiere un corte explícito posterior.

## 7. Sustituir el fixture conservando el trabajo del docente

Hoy [`planning_fixture.generate`](../../src/aulalista_api/planning_fixture.py)
es puro y acepta una tupla exacta. Se llama dentro de la transacción de
[`Plannings.write`](../../src/aulalista_api/plannings.py).
El [esquema actual](../../src/aulalista_api/planning_result.py) exige
`provenance: synthetic-fixture-v1`. Cambiar esa función por una llamada externa
no resuelve permisos, tiempos, idempotencia ni compatibilidad, y mantendría una
transacción/locks durante la red. No hacerlo como sustitución transparente.

El incremento real debe demostrar estos contratos con el mínimo diseño necesario,
sin exigir desde aquí nuevas capas, tabla genérica de jobs o una cola:

1. **Entrada y origen fijos.** Autorizar y capturar ámbito, operación, petición
   canónica, fuente/versión y contexto exactos. Si la creación es manual, registrar
   ausencia de referencia y conservar aportaciones/condición hipotética; no crear
   un original ficticio ni atribuir un PDA oficial sin evidencia.
2. **Operación lógica e intento externo separados.** Misma clave/payload/destino
   recupera la misma operación; clave reutilizada para otra solicitud da conflicto.
   Confirmar durablemente identidad y estado antes del envío, sin mantener locks
   de la edición durante la red. El intento tiene recibo propio cuando el proveedor
   lo ofrece. No se promete exactamente una ejecución externa si éste no permite
   conciliar un crash entre envío y recibo; queda incierto, sin retry ciego.
3. **Resultado real versionado.** Contrato explícito de procedencia y salida,
   validación antes de persistir, compatibilidad de lectores con fixtures guardados
   y referencias a lo realmente usado. No etiquetar IA como fixture, ni cambiar
   metadatos de revisiones históricas para hacerlas pasar por resultados nuevos.
   Comprobar utilidad, límites, claves editables y referencias además del esquema.
4. **Guardado y CAS.** Éxito sólo tras commit de revisión y recibo coherentes.
   Revalidar autoridad y revisión base antes de confirmar. Si hubo edición humana,
   conservarla y presentar un conflicto/resultado separado recuperable; no mover
   el puntero ni hacer merge automático. Reabrir y replay devuelven la revisión
   exacta; no ejecutan otra generación ni cambian a la fuente actual.
5. **Edición, copia y borrador.** Conservar claves editables y procedencia según
   [B3](0003-edicion-durable.md); una copia guarda su origen exacto. Cambiar el
   generador no ensancha silenciosamente la edición, impone otra confirmación de
   contenido ni elimina revisión, copia o recuperación tras conflicto.
6. **Tardíos y cancelación.** UI y servidor ligan respuesta a cuenta, ámbito,
   planeación, revisión, operación y estado vigente. Cerrar, navegar, editar,
   cancelar, revocar o cambiar cuenta impide que el callback viejo reemplace el
   estado nuevo. Cancelar UI no prueba que el proveedor no trabajó/cobró; conservar
   trazabilidad sin volver a publicar el resultado ni borrar ediciones.

### Una aclaración interpretativa durable

Aplicar el contrato de [spec 0002](0002-flujo-automatico-material.md): resolver
automáticamente dentro del presupuesto; cero preguntas por defecto y máximo una
solicitud breve, material e imprescindible **por planeación**. Presentarla consume
el límite, aunque no se conteste o la respuesta sea insuficiente. Su identidad y
estado deben persistir y reservarse atómicamente antes de presentarla para impedir
dos ganadoras concurrentes. Reintentar entrega la misma pendiente, no otra pregunta.

Versiones, archivos, sesiones, recargas, reextracciones e identificadores técnicos
nuevos no reinician el límite de la misma planeación. Si quedan otras dudas, son
pendientes visibles y editables voluntariamente; no se inventan respuestas ni se
esconde una entrevista obligatoria dentro de la solicitud. No restringe la
conversación que el docente inicie voluntariamente. Fallos de parser, red, permisos,
cuota o sesión tienen errores y recuperación propios; no consumen ni fabrican una
pregunta semántica. Este estado durable aún no está implementado por el fixture.

## 8. Pruebas futuras y evidencia de cierre

Todos los casos de esta tabla son **aceptación por ejecutar en su implementación**.
Un test sintético prueba el mecanismo; la evaluación con documentos reales necesita
su permiso y se registra aparte. No se concede calidad pedagógica por CI verde.

| Caso | Resultado observable exigido |
| --- | --- |
| Archivo excesivo, tipo falso, malformado o transferencia cortada | Trabajo y memoria acotados; sin recibo de éxito, parser alternativo ni contenido parcial llamado completo. |
| Fuente ajena, ID/hash adivinado y conexión A→B reciclada | Lecturas, replays, temporales y cachés no revelan datos de A; headers/client IDs no crean autoridad. |
| Parser en loop/crash, expansión masiva o intento de red | Proceso detenido dentro de cota, hijos/temporales controlados; diagnóstico sin contenido privado; cero salida de red inesperada. |
| Instrucción adversarial en texto, metadatos, OCR o salida | No cambia destino, herramientas, cuenta, presupuesto o permisos; no se ejecuta contenido ni se fabrican citas. |
| Revocación durante carga/envío y resultado tardío | No hay nuevo envío/lectura tras revocación ni reaparición por callback; el consumo anterior conserva su estado real. |
| Borrado con derivados, caché, recibos y backups | Dependencias dejan de ser accesibles conforme al alcance; purgas parciales se informan; restore no resucita contenido. |
| Restore con objetos ausentes/corruptos y revocaciones posteriores | Servicio cerrado hasta conciliar integridad y autoridad; no reenviar pendientes ni recuperar sesiones obsoletas. |
| Doble clic, respuesta perdida y crash después de envío externo | Misma operación recuperable, sin duplicado lógico ni retry externo ciego; incertidumbre y coste conservados. |
| Dos intentos compiten por el último margen de presupuesto | Reserva atómica; no superar límite por concurrencia, fallos o etapas auxiliares. |
| Salida inválida/excesiva o sin utilidad mínima | No anunciar resultado terminado; conservar diagnóstico y partes independientes sólo si son utilizables y autorizadas. |
| Edición/copia/borrador, cambio de fuente, dos pestañas y respuesta tardía | Historia y origen exactos; CAS/conflicto recuperable; ninguna edición humana sobrescrita. |
| Una aclaración ya presentada, otra sesión/archivo/retry y entrega concurrente | Máximo una solicitud lógica; recuperar la misma pendiente; errores técnicos separados y diálogo voluntario permitido. |
| 401/relogin y cambio de cuenta | No filtrar respaldo; reapertura sólo del trabajo confirmado según el límite de fase 1. |

Para cerrar **#19 documental**, el PR debe aportar base/candidato exactos, diff
sólo documental, comprobaciones de referencias/coherencia, revisión independiente
de seguridad, QA/operación y arquitectura, hallazgos resueltos y CI aplicable del
SHA final conforme al [workflow](../workflow.md). No exige ejecutar estos casos
operativos antes de tener su implementación ni permite marcarlos aprobados.

Para abrir **la capacidad real/piloto**, los issues posteriores enlazarán cada
puerta aplicable con decisión/permiso vigente, responsable nominal, candidato y
prueba ejecutada, comando/entorno, resultado, omisiones y evidencia privada segura
cuando corresponda. Deben revalidarse head/base y cambios de datos/destinos/límites.
Una puerta fallida o pendiente detiene la activación. Fusionar esta especificación,
un ensayo exitoso o las pruebas del fixture no equivalen a esa apertura.
