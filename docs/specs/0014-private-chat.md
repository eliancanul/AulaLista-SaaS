# Chat privado de Acenta

Contrato del incremento de [#11](https://github.com/eliancanul/AulaLista-SaaS/issues/11),
autorizado para implementación el 24 de octubre de 2026. Las pruebas usan sólo
datos sintéticos y transporte falso; no acreditan uso real, despliegue ni calidad
docente. La conversación responde texto normal y no adjunta recursos ni crea
planeaciones automáticamente.

## Persistencia y HTTP

La sesión y el ámbito personal autorizan cada operación, incluidos recuperación,
replay y listado. Se conserva el mismo control de origen/CSRF de B1. Recursos
ajenos e inexistentes responden 404. Las respuestas privadas llevan `no-store`.

- `GET /scopes/{scope}/chat-capability`: `{available:boolean}`. Sólo proveedor
  `OpenAIPlanning` explícito con perfil `window-v1`, actor y ámbito exactos.
- `POST /scopes/{scope}/conversations`, cuerpo `{}` e `Idempotency-Key` UUID:
  201 con documento; misma clave en el ámbito recupera la misma conversación.
- `GET /scopes/{scope}/conversation-operations/{operation_id}`: recupera la
  creación incluso cuando su respuesta se perdió antes de conocer el ID.
- `GET /scopes/{scope}/conversations`: `{items,next_cursor}`, cursor UUID,
  límite 1–50, orden ID ascendente y cursor igual al último ID entregado cuando
  hay otra página. Un cursor ajeno/desconocido responde 404.
- `GET /scopes/{scope}/conversations/{id}`: documento completo durable.
- `POST /scopes/{scope}/conversations/{id}/turns`, cuerpo
  `{text,expected_version}` e `Idempotency-Key`: 201 en éxito.
- `GET /scopes/{scope}/conversations/{id}/operations/{operation_id}`: documento
  completo, 200 para cualquier estado conocido, sin reenvío.

Summary contiene `id,title,version,created_at,updated_at`; Document contiene
`conversation:Summary,turns:Turn[]`. Turn contiene `operation_id,number,user_text,
assistant_text,state,error_code,usage`. Estado: `generating`, `succeeded`,
`failed` o `uncertain`; assistant_text sólo existe en éxito. Usage contiene
`input_tokens,output_tokens,estimated_cost_usd,reserved_usd`; tokens y estimación
desconocidos son null, dinero es string decimal. Una estimación no es factura.

Versión avanza al admitir cada intento, incluidos los fallidos. Misma operación
y payload se recupera antes de comprobar versión; otro payload/destino produce
409 conflict. No existe edición ni borrado de turnos. Cambiar configuración o
reiniciar no cambia el resultado ni permite reenviar una operación admitida.

## Admisión y transporte

Texto: 1–4096 caracteres, máximo 8192 bytes UTF-8, no vacío ni NUL. Cuerpo HTTP
acotado. Máximo 100 intentos y 20 respuestas exitosas por conversación. El
contexto incluye todos los éxitos anteriores en orden y el user nuevo, nunca
intentos fallidos ni contenido del cliente presentado como historia. Payload
canónico completo máximo 32768 bytes antes de reservar. Al exceder límites se
rechaza expresamente sin truncar historia. Assistant máximo 32768 bytes.

Se reutiliza el transporte Responses de OpenAI: destino/autenticación fijados,
sin conteo remoto, `store=false`, caché explícita sin breakpoints, texto normal,
sin herramientas, redirecciones, reintentos ni fallback, máximo 1024 tokens de
salida. No se lee una credencial en el factory normal. Plazo lógico 75 segundos;
sesión original y estado se revalidan antes de HTTP y antes de confirmar. No hay
transacción ni lock durante HTTP. Vencer el plazo no demuestra cancelación.

Cada intento usa el lock y ledger **globales** `ai_budget_reservation` de
[0013](0013-planeacion-openai.md), compartidos con planeación. La migración 0011
espeja cada intento chat mediante `mirror_ai_budget('chat')`. Reserva por intento:
USD 0.210768 para ventana 1050000 tokens a cota Standard larga 0.20/M entrada y
0.75/M salida, más margen explícito del operador. No se inventan tarifas para
extras ni saldo disponible. US$2 es el techo configurado del ensayo completo,
no un límite permanente de un turno. La suma de todas las reservas retenidas
controla admisión. Fallos e incertidumbre no reembolsan reservas. Una operación
activa o incierta bloquea nuevas admisiones globales; conciliación fuera del corte.
La estimación usa 0.10/M y 0.50/M hasta 272000 tokens de entrada, después 0.20/M y
0.75/M; usage observado se conserva separado de la reserva.

Errores seguros: 409 `chat_pending`, `chat_uncertain`, `chat_failed`, `conflict`,
`chat_busy`; 429 `chat_budget_exhausted`; 422 `chat_limit_reached`,
`invalid_request`; 413 `chat_context_too_large`; 503 `chat_unavailable`.
El cliente conserva el texto ante errores y usa GET para consultar operaciones
pendientes/inciertas. No hay reenvío automático ni adjunto implícito.

## Esquema y comprobación

0011 añade conversación y turnos; runtime sólo SELECT/INSERT y UPDATE de columnas
necesarias. Triggers impiden modificar entrada, reserva, perfil, identidad,
estado terminal o salida confirmada. Un incierto permite únicamente completar
campos de consumo previamente null. Downgrade rechaza cualquier conversación
retenida. Readiness espera `0011_private_chat`; no se migra por solicitud.

Pruebas requeridas: contexto de dos turnos; creación recuperable; restart/replay;
CAS concurrente; sesión revocada antes de HTTP y al volver; gasto compartido con
planeación; fallos e incertidumbre sin reembolso; límites; privacidad HTTP/CSRF;
grants, restricciones y downgrade mediante PostgreSQL desechable real. La CI
del candidato y revisión independiente siguen siendo puertas del workflow.
