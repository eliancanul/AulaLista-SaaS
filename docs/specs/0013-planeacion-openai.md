# Especificación 0013: Planeación manual con OpenAI

Candidato offline sobre `e48b3ba52023bc1afdfb97c53a307fc3403cdc4f`, 18 de octubre
de 2026. Implementación autorizada en rama aislada; sin activación, llamadas reales,
merge ni despliegue. La creación del issue de seguimiento fue rechazada por la
revisión automática de permisos: no hay issue publicado para este candidato.

## Contrato

La creación v3 conserva los campos manuales de v2 y elimina `fixture_context`.
`POST /scopes/{scope}/generated-plannings` crea una planeación nueva; v1/v2
conservan su significado. Una referencia opcional identifica una versión propia
exacta, sin enviar sus bytes ni sus identificadores al proveedor. No interpreta
archivos ni implementa las secciones analíticas de la PR #57.

La salida conserva el lector y la edición B3 de `guided-planning-v1`, con
procedencia `openai-guided-v1` y aviso impuesto por el servidor. El proveedor no
elige autoridad, procedencia, destinatario ni herramientas. Pydantic comprueba
campos, tipos, texto útil, tres etapas ordenadas y suma exacta de la duración
solicitada; no repara ni acepta salida parcial. Esa validación no acredita
calidad pedagógica, verdad curricular o evaluación con datos reales.

`GET /scopes/{scope}/planning-generation` informa disponibilidad autorizada.
Sin proveedor y perfil explícitos es falsa. El factory normal no obtiene una
credencial del entorno ni abre la capacidad; la activación requiere el preflight
indicado abajo y un adaptador de composición revisado.

## Intento, presupuesto y recuperación

Una operación admite como máximo un intento, con dos etapas externas distintas:
conteo y generación. La admisión persiste solicitud/huellas, perfil, plazo y
reserva antes del conteo. Una transacción breve serializa reserva y concurrencia;
ninguna transacción ni lock de DB permanece abierto durante HTTP.

Perfil previsto: `gpt-6-luna`, Responses, Standard, `reasoning.effort=none`,
`store=false`, cache explícita sin breakpoints, sin herramientas, redirecciones,
reintentos ni fallback. Entrada medida por `/v1/responses/input_tokens` como
máximo 2048 tokens; salida como máximo 1024 tokens; una operación activa global;
plazo lógico de 75 segundos. `max_output_tokens` incluye razonamiento. El límite
de 4096 bytes del formulario no se presenta como un conteo de tokens.

El conteo usa el mismo contexto y esquema que la generación. Si excede 2048,
no se envía la generación. El conteo ya transmitió el contenido: requiere permiso
y reserva propios. Su precio no se presupone cero. El perfil inyectado exige una
reserva positiva verificada para ese request, presupuesto remanente en USD y
actor/ámbito autorizados y huellas SHA-256 de las entradas exactas aprobadas,
sin comodines. Otro propietario no puede utilizar ese perfil aunque coincida
su entrada. Las reservas
acumuladas nunca se liberan automáticamente: fallos, consumo desconocido y estados
inciertos conservan su margen. El consumo observado se registra aparte; ausente
es `null`, no cero. Una huella de entrada no sustituye permiso de transmisión.
Una respuesta tardía puede completar campos de consumo antes desconocidos sin
alterar el estado incierto, el plazo, la reserva ni las observaciones ya guardadas.
Un intento incierto también bloquea nuevas admisiones globales hasta conciliación
explícita; ese procedimiento administrativo queda fuera del corte. Vencer el
plazo no libera concurrencia ante una transmisión cuya cancelación es desconocida.

Tarifas observadas el 18 de octubre: entrada Standard USD 0.10/M y salida USD
0.50/M. El peor costo de inferencia con entrada medida N es
`(0.10*N + 0.50*1024)/1_000_000`; a la admisión se reserva N=2048 más la reserva
verificada del conteo. No se reserva la ventana completa del modelo ni se afirma
que esta cifra incluya impuestos, conversión o el conteo.

Los estados `counting` y `generating` se confirman antes de su envío. Repetir la
clave con igual solicitud sólo consulta; cambiar solicitud produce conflicto.
Un reinicio, timeout o resultado perdido no autoriza reenviar. Los estados
pendiente/incierto/fallido devuelven 409 con un código seguro; consultar una clave
desconocida devuelve 404. La UI conserva recuperación de pendientes e inciertos
sólo por GET. Un fallo definitivo permite otra operación únicamente por acción
explícita. El plazo lógico impide confirmar respuestas tardías; no demuestra
cancelación o ausencia de consumo remoto.

Se revalida la sesión/propiedad al admitir, antes de generar y antes de confirmar.
Resultado y revisión inicial se confirman atómicamente; después lectura, replay,
edición, copia y borrador nunca llaman al proveedor ni pisan revisiones humanas.
Los metadatos de consumo no incluyen prompt, respuesta cruda o cabeceras privadas.

## Pruebas y puertas de activación

Tests de software con transporte falso y PostgreSQL real desechable: duplicados,
respuesta perdida, carreras de presupuesto, límite contado, reinicio/timeout,
revocación, validación de salida, conservación de edición/copia y aislamiento.
Esas fixtures no se enviarán a la API ni se presentarán como prueba educativa.

Antes de una llamada real: verificar en metadatos seguros `OPENAI_API_KEY` de tipo
Network secret ligado únicamente al destino autorizado `api.openai.com`; entrada
real exacta aprobada, cuenta/proyecto y permiso tanto de conteo como generación;
precio/costo del conteo; tarifas vigentes, impuestos/conversión, saldo remanente
dentro de MXN 100 totales ya recargados; revisión independiente y límite de gasto
efectivo. Sin esos datos, no activar ni recargar. `store=false` no promete cero
retención del proveedor.

La migración nueva parte de `0007_guided_planning`. La PR #57 tiene otra migración
0008 y cambios en integración compartida: rebase y revisión del grafo, readiness,
permisos runtime y rutas serán obligatorios antes de integrar ambos candidatos.

Fuentes oficiales consultadas: [modelo](https://developers.openai.com/api/docs/models/gpt-6-luna),
[precios](https://developers.openai.com/api/docs/pricing),
[conteo](https://developers.openai.com/api/docs/guides/token-counting),
[caché](https://developers.openai.com/api/docs/guides/prompt-caching),
[datos](https://developers.openai.com/api/docs/guides/your-data) y
[secretos de red](https://learn.chatgpt.com/docs/environments/cloud-environments).
