# Navegación del espacio docente

Corte funcional de [#78](https://github.com/eliancanul/AulaLista-SaaS/issues/78),
sobre el chat único de [0014](0014-private-chat.md). Se conserva la identidad
visual de Acenta. La referencia exacta de la barra de competencia y la aprobación
visual humana siguen pendientes; las capturas de software permiten revisar este
candidato, no atribuirle esa aprobación ni aceptación docente.

## Una conversación, funciones accesibles

La barra permanece a la izquierda y agrupa acceso al chat, recursos, herramientas
y soporte. Puede expandirse para mostrar etiquetas; no crea una lista de chats
ni repite las trece herramientas en el menú. El archivo anterior sigue siendo
una consulta de sólo lectura dentro del recorrido del chat.

El chat y su compositor permanecen montados al abrir o cambiar paneles de
recursos, herramientas, contexto o soporte. La biblioteca, el catálogo y la
edición de contexto reutilizan sus controladores; no se mantienen copias del
chat ni un segundo almacén de borradores. El estado de navegación vive en memoria
y los marcadores del historial del navegador siguen siendo opacos. No se añaden
mensajes, IDs privados o notas a URL, history ni almacenamiento del navegador.

Los accesos inferiores se sitúan junto al compositor y ofrecen acciones
contextuales acotadas: revisar contexto y llegar a Planeación. Cuando existe un
intento pendiente, se conserva el acceso para recuperar ese mismo intento.
No se rellena el espacio mediante un alto mínimo artificial, un catálogo duplicado
o pop-ups automáticos. Abrir un acceso nunca envía el mensaje ni inicia generación.

## Paneles y estados honestos

Un panel se abre por una acción explícita de clic/teclado o por atrás/adelante
solicitado por el usuario. No se abre al recibir una respuesta tardía, al recargar
o por un temporizador. Cerrar o cambiar panel conserva mensaje, notas y trabajo
de las herramientas. No aplica un cambio de contexto, descarta texto ni adjunta
un recurso automáticamente.

- **Recursos:** conserva carga, error, vacío, paginación, originales y revisiones.
  Abrir un recurso concreto sigue su lector/editor y las guardias existentes.
  Consultar no lo incorpora al contexto ni lo transmite al proveedor.
- **Herramientas:** un único catálogo por categorías. Planeación conserva su
  formulario y recuperación. Las funciones ausentes se identifican como pendientes;
  no producen un éxito ficticio, una llamada ni un resultado de ejemplo encubierto.
- **Contexto:** mismas notas, revisión, corte de turnos, CAS y consulta de estado
  de 0014, presentados en un panel en flujo. Ocultarlo conserva la edición local;
  guardar o reiniciar sigue requiriendo su acción explícita.
- **Soporte:** ayuda local sobre acceso, chat/contexto, recursos/Planeación y
  operaciones pendientes, según [#79](https://github.com/eliancanul/AulaLista-SaaS/issues/79).
  Es contenido del producto, distinguible de Luna. No recibe solicitudes ni promete
  atención humana, responsable o plazo de respuesta. No necesita suscripción.

Los formularios y lectores/editores de documentos siguen siendo tareas existentes
abiertas mediante una selección explícita. Sus diálogos no se confunden con los
paneles de navegación. Impresión, guardado, revisiones, recuperación de Planeación
y cierre de sesión mantienen sus controles y garantías.

## Ayuda local (#79)

La ruta aprobada es ayuda dentro del producto: el acceso **Soporte** abre contenido
estático incluido en la aplicación. Antes de iniciar sesión, **Ayuda de acceso**
está disponible incluso cuando los métodos de acceso no están configurados o
fallan. El texto explica sólo controles existentes y sus límites: usar el mismo
método de acceso, consultar estados inciertos, revisar contexto, abrir recursos y
recuperar lo confirmado. La ayuda no diagnostica una cuenta ni verifica el saldo.

No hay formulario, chat de soporte, enlace externo, correo, adjunto, telemetría ni
servicio de tickets. Abrir, leer y cerrar ayuda no genera solicitudes de API ni
adjunta conversación, documentos, cookies, códigos o datos personales a un envío.
Los recursos estáticos de la aplicación, incluidas sus fuentes locales, se cargan
del mismo origen; no hay destinos externos de ayuda. Las operaciones de acceso
siguen sus contratos; la ayuda no las inicia, reintenta o cancela. No existe confirmación de envío porque
no se ofrece envío. No se inventa canal, proveedor, responsable, horario o SLA.

Abrir/cerrar conserva el chat y las notas, las ediciones de recursos, el formulario
de acceso y el código en curso. El acceso previo al login usa una región no modal
en el flujo: abrir enfoca su título; cerrar o Escape devuelve foco al activador.
Los temas se despliegan con controles nativos. La ayuda de workspace reutiliza
el mismo panel y sus guardias/foco, sin nuevo estado de conversación ni recuperación.

## Reflow, teclado y foco

El panel ocupa espacio real junto al chat cuando cabe; en pantallas estrechas se
apila en el flujo. No usa una capa que tape el compositor. Al cerrar se retira su
espacio y no queda un hueco reservado. El documento permite desplazamiento cuando
la altura no alcanza; controles y texto largo siguen accesibles, sin overflow
horizontal accidental ni recorte por un alto fijo.

Activadores nativos identifican destino y estado expandido. La región del panel
tiene nombre y cierre accesible. Abrir lleva foco a un control o título útil una
sola vez, sin que nuevas respuestas lo roben. Cerrar/Escape devuelve foco al
activador conectado; si ya no existe, usa un acceso equivalente o el área principal.
Tab puede entrar y salir del panel no modal. Los diálogos y guardias existentes
tienen prioridad sobre Escape; cerrar un diálogo no cierra también el panel.

Atrás/adelante conserva destino, foco y trabajo usando la navegación existente.
La lectura tardía no cambia el destino. Chat, contexto y Planeación generada
(contrato 3) pendientes o inciertos ofrecen su consulta por GET; navegar no
reenvía ni cancela. La recuperación de ejemplos B2 y edición conserva su contrato
existente, incluido el replay idempotente cuando corresponda.
Logout mantiene las guardias de mensaje, contexto y editor y revoca realmente la
sesión cuando el usuario decide salir.

## Verificación y límites

Pruebas de contrato/controlador: destinos y callbacks tardíos; borradores de chat
y notas conservados; volver al activo desde el archivo; cero POST por navegación;
contexto/Planeación inciertos y guardias de salida. Chromium verifica la misma
instancia del compositor, teclado/Escape/foco, atrás/adelante, recursos y estados
pendientes, tamaños desktop/móvil/cortos y ausencia de intersección panel/compositor.
Capturas sintéticas del candidato exacto se inspeccionan por separado de los tests.
Simular un viewport corto no acredita el teclado virtual físico de un dispositivo.

El recorrido conectado usa sesión, HTTP y PostgreSQL desechable con transporte
sintético. No hay nuevos endpoints, esquema, dependencias, proveedor, credenciales,
gastos o despliegue. Revisión independiente, tests pertinentes del SHA exacto y
comprobación de CI preceden a la integración. La atención humana, la implementación
de las herramientas pendientes y la aceptación visual/docente se registran aparte.
