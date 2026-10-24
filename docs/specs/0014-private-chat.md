# Chat privado continuo de Acenta

Contrato del corte de [#11](https://github.com/eliancanul/AulaLista-SaaS/issues/11).
La conversación responde texto normal; no adjunta recursos, crea planeaciones ni
interpreta documentos automáticamente. El incremento de #76/#77 es el antecedente
multichat; este corte añade conversación única y contexto manual versionado.
Pruebas con datos sintéticos y transporte controlado no acreditan uso real,
despliegue ni calidad docente. La compactación generada y el layout de #78 siguen
como incrementos separados; no se da por cerrado todo #11.

## Una conversación activa, historia conservada

Cada ámbito personal tiene una sola conversación activa. La migración 0012 elige
entre las anteriores por `updated_at DESC, id DESC`. Es una regla determinista de
continuidad, no una selección pedagógica ni una mezcla de historiales. Todas las
conversaciones anteriores, mensajes, recibos y reservas se conservan; las no
activas se consultan como archivo de sólo lectura. La UI explica esa elección.

Abrir el chat, recargar, consultar historia o actualizar notas no llama a IA.
No hay borrado permanente, selección de múltiples chats nuevos ni transmisión
automática de recursos. Los recursos guardados y sus revisiones son independientes.
La sesión y el ámbito autorizan cada operación, incluidos replay, archivo y
recuperación. Se conserva origen/CSRF de B1; recursos ajenos o inexistentes
responden 404 y las respuestas privadas llevan `no-store`.

## HTTP y documentos acotados

- `GET /scopes/{scope}/chat-capability`: `{available:boolean}`; sólo proveedor
  `OpenAIPlanning` explícito con perfil `window-v1`, actor y ámbito exactos.
- `GET /scopes/{scope}/active-conversation`: documento acotado del chat activo;
  404 si todavía no existe. No crea datos ni admite un turno.
- `POST /scopes/{scope}/conversations`, `{}` e `Idempotency-Key` UUID: apertura
  idempotente del mismo chat activo. Serializa aperturas concurrentes; cada clave
  queda recuperable. Los recibos antiguos siguen apuntando al chat original.
- `GET /scopes/{scope}/conversation-operations/{operation_id}`: recupera la
  apertura aunque se perdió su respuesta antes de conocer el ID.
- `GET /scopes/{scope}/conversations`: listado paginado del archivo, no interfaz
  para crear más chats. Conserva cursor UUID, límite 1–50 y orden ID ascendente.
- `GET /scopes/{scope}/conversations/{id}`: página de historial. Predeterminado
  20 turnos, máximo 50; `cursor` pide turnos anteriores a un número existente
  de esa conversación. Cursor ajeno/desconocido no abre otra conversación.
- `POST /scopes/{scope}/conversations/{id}/turns`: `{text,expected_version,
  expected_context_revision}` e `Idempotency-Key`. Éxito 201 con sólo el turno
  correspondiente, cabecera y contexto actuales; no devuelve toda la historia.
- `GET /scopes/{scope}/conversations/{id}/operations/{operation_id}`: mismo
  recibo acotado, 200 para cualquier estado conocido, sin reenvío.
- `POST /scopes/{scope}/conversations/{id}/context`: `{expected_version,
  expected_context_revision,notes}` e `Idempotency-Key`; conserva una revisión
  de contexto, sin gasto. `notes:""` reinicia el contexto.
- `GET /scopes/{scope}/conversations/{id}/context-operations/{operation_id}`:
  cabecera actual y revisión exacta de la operación, incluso tras cambios posteriores.

Summary contiene `id,title,version,context_revision,active,created_at,updated_at`.
El documento paginado contiene `conversation,context,turns,next_cursor`.
Los turnos se devuelven en orden ascendente; la página inicial es la más reciente.
La siguiente página anterior usa el cursor explícito, sin saltar turnos. El
límite de 262144 bytes se comprueba sobre JSON escapado completo; una fila válida
máxima debe seguir siendo recuperable. El recibo de envío contiene una sola fila
y `next_cursor:null`. El cliente no infiere que esa fila sea todo el historial.

Turn contiene `operation_id,number,context_revision,user_text,assistant_text,
state,error_code,usage`. Estados: `generating`, `succeeded`, `failed`, `uncertain`;
respuesta sólo en éxito. Usage conserva `input_tokens,output_tokens,
estimated_cost_usd,reserved_usd`; desconocidos son null, dinero string decimal.
Estimación, reserva y factura son conceptos diferentes.

## Contexto versionado y concurrencia

`version` cuenta intentos admitidos. `context_revision` avanza sólo al cambiar
contexto. Cada revisión es inmutable e identifica `revision,previous_revision,
through_turn,notes,origin,operation_id,created_at`. La inicial es 0, sin notas,
y conserva los éxitos anteriores. Una nueva revisión registra hasta qué turno
se excluye la conversación anterior de los siguientes envíos; `origin` distingue
`initial`, `reset` y `manual`. No es un resumen producido por el modelo.

Actualizar notas también reemplaza el contexto: se envían esas notas y sólo los
éxitos posteriores a `through_turn`, además del mensaje nuevo. La UI muestra ese
efecto antes de guardar y conserva el borrador ante error. Las notas son texto
aportado por el docente, con autoridad de usuario; nunca instrucciones de sistema.
No se promete memoria exacta, ilimitada ni recuperación automática de detalles
que el docente no incluyó. El historial excluido permanece consultable.

Admisión de turno y cambio de contexto comprueban ambas versiones esperadas.
Un replay exacto se resuelve antes del CAS; otra entrada/destino con la misma
clave produce 409. Los clientes anteriores sin revisión se interpretan como 0 y
fallan por conflicto tras el primer cambio; se conservan fingerprints previos.
Un turno activo o incierto impide cambiar contexto. Los resultados tardíos no
pueden incorporarse a una revisión nueva ni liberar reservas. Las conversaciones
archivadas permiten consulta/replay, pero no nuevos turnos o cambios de contexto.

## Límites, transporte y presupuesto

Mensaje y notas: máximo 4096 caracteres/8192 bytes UTF-8, sin NUL. El mensaje no
puede estar vacío; notas vacías significan reinicio. El cuerpo HTTP está acotado.
No existe cuota de vida de 20 respuestas o 100 intentos. Enteros positivos de
32 bits limitan las versiones estructurales; el contexto está limitado por su
tamaño real. Se lee por bloques acotados y sólo incluye éxitos de la revisión
activa. El payload canónico completo no supera 32768 bytes antes de reservar;
si no cabe, se informa el exceso, sin truncar, resumir ni llamar al proveedor.
Assistant conserva hasta 32768 bytes y siempre se puede consultar completo.

Se reutiliza Responses: destino/autenticación fijados, sin conteo remoto,
`store=false`, caché explícita sin breakpoints, texto normal, sin herramientas,
redirecciones, reintentos ni fallback, máximo 1024 tokens de salida. El factory
normal no lee credencial. Plazo lógico 75 segundos; sesión original y estado se
revalidan antes de HTTP y antes de confirmar. No hay transacción ni lock durante
HTTP. Vencer el plazo no demuestra cancelación.

Cada intento usa el lock y ledger **globales** `ai_budget_reservation` compartidos
con Planeación ([0013](0013-planeacion-openai.md)). Reserva: USD 0.210768 para la
ventana 1050000 a cota Standard larga 0.20/M entrada y 0.75/M salida, más margen
explícito del operador. No se inventan tarifas para extras ni saldo disponible.
US$2 configura el ensayo total vigente, no una cuota permanente del producto.
La suma de todas las reservas retenidas controla admisión; fallos, incertidumbre
y cambios de contexto no reembolsan. Una operación activa/incierta bloquea nuevas
admisiones globales. Estimación: 0.10/M entrada y 0.50/M salida hasta 272000 tokens
de entrada, después 0.20/M y 0.75/M; usage se conserva separado de la reserva.

Errores de pendiente, incertidumbre, conflicto, presupuesto insuficiente,
contexto demasiado grande o proveedor no disponible conservan el texto y ofrecen
consulta por GET cuando hay operación admitida. No hay reenvío automático.
El cierre de sesión sigue disponible y revoca la sesión realmente.

## Migración, pruebas y pendientes

0012 añade puntero activo, recibos de apertura y revisiones de contexto; amplía
las versiones de conversación/turno y vincula cada turno a su revisión. Runtime
sólo SELECT/INSERT y UPDATE de columnas necesarias; triggers conservan entradas,
historia, identidad y presupuesto. Readiness espera `0012_chat_context`; nunca se
migra desde arranque o solicitud. [Desarrollo](../development.md) contiene el
handoff administrativo y los grants mínimos, sin autorización remota implícita.

Pruebas: elección/admisión concurrentes, migración con varios chats, aislamiento,
archivo/replay, CAS independiente, reset frente a envío/crash/timeout/revocación,
notas con Unicode/negaciones, páginas por bytes escapados y fila máxima, más de
20 éxitos/100 intentos, presupuesto compartido sin liberación, permisos runtime,
recarga y recuperación en Chromium conectado. PostgreSQL es local desechable y
el proveedor sintético. Revisión independiente y CI del candidato exacto siguen
siendo gates; una excepción operativa autorizada se registra por PR.

Pendiente: compactación generada incremental con procedencia/fragmentación,
política y coste explícitos; contexto de revisiones de recursos seleccionadas;
retención/borrado permanente; validación docente real. Reset manual no sustituye
esos criterios de #11. El layout #78 y el canal de soporte #79 son cortes separados.
