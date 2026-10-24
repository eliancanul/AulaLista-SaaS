# Conciliación del backlog de Acenta · 24 de octubre de 2026

Base comprobada: [2a608090b73136727fef632b0da8db0971e32b1f](https://github.com/eliancanul/AulaLista-SaaS/commit/2a608090b73136727fef632b0da8db0971e32b1f), árbol
`c3f515c5b0145e46404d53147a691646185dfe3e`. PR [#77](https://github.com/eliancanul/AulaLista-SaaS/pull/77)
fue integrado por el usuario a las 03:47:15 UTC; el chat sí está en main.
No se repitió el merge. Esta auditoría no comprueba despliegue, DB remota,
credenciales ni uso real. Integrado, desplegado y aceptado son estados distintos.

**GitHub Issues es el backlog activo.** Esta conciliación enlaza los tickets
creados/actualizados; no es otra cola que deba sincronizarse. El
[ledger de #75](PENDIENTES-2026-10-24.md) conserva su fotografía anterior de
33fb285. La dirección vigente reemplaza su navegación multichat por un chat
continuo; no reescribe retroactivamente lo que aquel corte verificó.

## Prioridad actual y decisiones conservadoras

1. [#11](https://github.com/eliancanul/AulaLista-SaaS/issues/11): un chat activo por ámbito, historial paginado y contexto versionado;
   tres subcortes dentro del mismo issue: continuidad/migración, reinicio de
   contexto sin destrucción y compactación presupuestada. Las conversaciones
   previas se preservan, sin mezclarlas automáticamente. Los recursos guardados
   siguen independientes. Los límites actuales de 20 éxitos/100 intentos y 32 KiB
   no se convierten en una cuota permanente del producto.
2. [#78](https://github.com/eliancanul/AulaLista-SaaS/issues/78): una sola composición para barra de funciones **izquierda**,
   chat central y accesos rápidos inferiores. Paneles tras pulsar una acción;
   no aparición automática, compositor tapado ni duplicación de todo el menú.
   Colapsado, móvil, teclado/Escape/foco/retorno y conservación de trabajo forman
   parte de la aceptación. Cada herramienta mantiene su ticket funcional.
3. [#79](https://github.com/eliancanul/AulaLista-SaaS/issues/79): definir y conectar una ruta honesta de soporte. Canal,
   responsable, datos y expectativas pendientes; no inventar proveedor o SLA.
   La definición puede avanzar sin terminar el layout ni un sistema de cobro.
4. [#69](https://github.com/eliancanul/AulaLista-SaaS/issues/69): aceptación real pendiente del MVP privado de Planeación; chat se
   acepta en [#11](https://github.com/eliancanul/AulaLista-SaaS/issues/11). Comparten presupuesto global, reservas y errores.
   El techo total de US$2 del ensayo no es un saldo nuevo por ticket ni un plan
   comercial. OCR y [#53](https://github.com/eliancanul/AulaLista-SaaS/issues/53)/[#65](https://github.com/eliancanul/AulaLista-SaaS/issues/65)/[#66](https://github.com/eliancanul/AulaLista-SaaS/issues/66) no bloquean este MVP manual.

### Decisiones que todavía faltan

- **Limpiar:** distinguir ocultar vista, archivar, reiniciar contexto y borrar
  permanentemente. Propuesta conservadora: nueva revisión/raíz de contexto,
  manteniendo mensajes, recibos, reservas y recursos. Retención y destrucción
  requieren decisión explícita antes de implementar algo irreversible. No
  prometer borrado del proveedor por reiniciar contexto.
- **Legado y compactación:** fijar elección inicial del chat activo sin borrar
  los anteriores; política/disparador, límites de pasos y coste de compactación.
  Resumen derivado con procedencia, no memoria exacta ni fuente de autoridad.
  Compactar y responder son operaciones distintas; si se prometen ambas, su
  cota conjunta debe reservarse de forma durable. GET/recarga/migración no gastan.
- **Soporte:** ayuda local o contacto y, si hay transmisión, destino autorizado,
  responsable, datos mínimos y respuesta esperada. Nunca adjuntar automáticamente
  conversaciones, archivos, cookies, claves o datos de alumnos.
- **Visual:** la referencia de Teachy encontrada acredita formularios y
  reutilización, no la barra exacta que el usuario recuerda. La referencia y la
  posición final de accesos inferiores quedan por validar; no copiar marcas ni
  usar propuestas rechazadas como aprobación. Capturas sintéticas muestran
  espacio inferior en el ejemplo antiguo, no un hueco universal del chat móvil.

Estas decisiones acotan los tickets; no exigen otra aprobación para mantener
el backlog ni autorizan llamadas, infraestructura o comunicaciones.

## Tickets nuevos publicados

Treinta cortes que faltaban en Issues: dos de experiencia actual, seis de
continuidades ya previstas, once del catálogo, siete puertas operativas y cuatro
de flujo/evaluación/decisión. Los de definición entregan un contrato revisable;
no se presentan como funciones implementadas. Los estados son los del corte de
publicación; consultar el issue para trabajo posterior.

| ID de esta conciliación / ticket | Resultado delimitado | Prioridad y estado al publicar |
| --- | --- | --- |
| N01 · [#78](https://github.com/eliancanul/AulaLista-SaaS/issues/78) | Aplicar el layout del chat único con accesos y paneles | P0 · pendiente de definición visual exacta; no implementado |
| N02 · [#79](https://github.com/eliancanul/AulaLista-SaaS/issues/79) | Definir y conectar el acceso a soporte de Acenta | P0 · pendiente de definición del recorrido y canal |
| N03 · [#80](https://github.com/eliancanul/AulaLista-SaaS/issues/80) | Seleccionar y reutilizar contexto curricular trazable | P2 · bloqueado por selección bibliográfica y derechos; no implementado |
| N04 · [#81](https://github.com/eliancanul/AulaLista-SaaS/issues/81) | Definir el editor enriquecido conservando revisiones | P2 · pendiente de definición del corte de editor |
| N05 · [#82](https://github.com/eliancanul/AulaLista-SaaS/issues/82) | Recuperar edición no confirmada tras reautenticación | P2 · no implementado; política entre sesiones pendiente |
| N06 · [#83](https://github.com/eliancanul/AulaLista-SaaS/issues/83) | Habilitar el transporte real de OTP de correo | P2 · pospuesto por el usuario; transporte runtime no implementado |
| N07 · [#84](https://github.com/eliancanul/AulaLista-SaaS/issues/84) | Vincular métodos de acceso con prueba fresca de control | P2 · no implementado; flujo por concretar |
| N08 · [#85](https://github.com/eliancanul/AulaLista-SaaS/issues/85) | Registrar consentimiento promocional opcional y revocable | P2 · no implementado; finalidad/política pendiente |
| N09 · [#86](https://github.com/eliancanul/AulaLista-SaaS/issues/86) | Concretar Preguntas sobre un texto y su primer recorrido | P2 · contrato propuesto; composición/límites pendientes |
| N10 · [#87](https://github.com/eliancanul/AulaLista-SaaS/issues/87) | Concretar Adaptar material conservando el original | P2 · contrato propuesto; composición/límites pendientes |
| N11 · [#88](https://github.com/eliancanul/AulaLista-SaaS/issues/88) | Concretar Tarjetas de repaso editables | P2 · contrato propuesto; composición/límites pendientes |
| N12 · [#89](https://github.com/eliancanul/AulaLista-SaaS/issues/89) | Concretar Bingo con distribución durable | P2 · contrato propuesto; composición/límites pendientes |
| N13 · [#90](https://github.com/eliancanul/AulaLista-SaaS/issues/90) | Definir el primer contrato de Proyecto de aula | P2 · definición pendiente; implementación no autorizada |
| N14 · [#91](https://github.com/eliancanul/AulaLista-SaaS/issues/91) | Definir el primer contrato de Diagnóstico breve | P2 · definición pendiente; implementación no autorizada |
| N15 · [#92](https://github.com/eliancanul/AulaLista-SaaS/issues/92) | Definir Rúbrica y lista de cotejo editables | P2 · definición pendiente; implementación no autorizada |
| N16 · [#93](https://github.com/eliancanul/AulaLista-SaaS/issues/93) | Definir el primer contrato de Memorama | P2 · definición pendiente; implementación no autorizada |
| N17 · [#94](https://github.com/eliancanul/AulaLista-SaaS/issues/94) | Definir el primer contrato de Sopa de letras | P2 · definición pendiente; implementación no autorizada |
| N18 · [#95](https://github.com/eliancanul/AulaLista-SaaS/issues/95) | Definir el primer contrato de Adivina con pistas | P2 · definición pendiente; implementación no autorizada |
| N19 · [#96](https://github.com/eliancanul/AulaLista-SaaS/issues/96) | Definir el primer contrato de Quiz para proyectar | P2 · definición pendiente; implementación no autorizada |
| N20 · [#97](https://github.com/eliancanul/AulaLista-SaaS/issues/97) | Delimitar permisos, datos y destinos del primer uso de documentos | P2 · pendiente de decisión/permiso para el alcance real |
| N21 · [#98](https://github.com/eliancanul/AulaLista-SaaS/issues/98) | Verificar aislamiento de materiales y derivados con rol runtime | P2 · pendiente de verificación de las superficies reales |
| N22 · [#99](https://github.com/eliancanul/AulaLista-SaaS/issues/99) | Admitir sólo formatos y cargas reales acotados | P2 · bloqueado: falta fijar formatos y límites numéricos |
| N23 · [#100](https://github.com/eliancanul/AulaLista-SaaS/issues/100) | Confirmar originales reales en almacenamiento privado e íntegro | P2 · bloqueado: falta definir mecanismo, alcance y permisos |
| N24 · [#101](https://github.com/eliancanul/AulaLista-SaaS/issues/101) | Aislar parser y render con límites medidos | P2 · bloqueado: falta fijar formato, método y límites |
| N25 · [#102](https://github.com/eliancanul/AulaLista-SaaS/issues/102) | Aplicar retención, revocación y purga coherentes | P2 · bloqueado por política finita y recursos del alcance |
| N26 · [#103](https://github.com/eliancanul/AulaLista-SaaS/issues/103) | Ensayar restauración íntegra sin revivir accesos revocados | P2 · bloqueado por plan/destino y operación autorizada |
| N27 · [#104](https://github.com/eliancanul/AulaLista-SaaS/issues/104) | Interpretar material en un resultado útil guardado y editable | P2 · bloqueado por método/cotas y gates aplicables |
| N28 · [#105](https://github.com/eliancanul/AulaLista-SaaS/issues/105) | Definir búsqueda web opcional con fuentes verificables | P2 · definición pendiente; no implementado |
| N29 · [#106](https://github.com/eliancanul/AulaLista-SaaS/issues/106) | Preparar y observar el recorrido con docentes para cerrar H2 | P2 · pendiente de protocolo y participación autorizada |
| N30 · [#107](https://github.com/eliancanul/AulaLista-SaaS/issues/107) | Definir la oferta de suscripción y las puertas de cobro | P2 · decisión comercial pendiente; sin contrato ejecutable de cobro |

## Issues existentes actualizados

Se actualizaron 18: [#11](https://github.com/eliancanul/AulaLista-SaaS/issues/11), [#18](https://github.com/eliancanul/AulaLista-SaaS/issues/18), [#19](https://github.com/eliancanul/AulaLista-SaaS/issues/19), [#52](https://github.com/eliancanul/AulaLista-SaaS/issues/52), [#61](https://github.com/eliancanul/AulaLista-SaaS/issues/61), [#62](https://github.com/eliancanul/AulaLista-SaaS/issues/62), [#68](https://github.com/eliancanul/AulaLista-SaaS/issues/68), [#69](https://github.com/eliancanul/AulaLista-SaaS/issues/69), [#53](https://github.com/eliancanul/AulaLista-SaaS/issues/53), [#65](https://github.com/eliancanul/AulaLista-SaaS/issues/65), [#66](https://github.com/eliancanul/AulaLista-SaaS/issues/66), [#31](https://github.com/eliancanul/AulaLista-SaaS/issues/31), [#40](https://github.com/eliancanul/AulaLista-SaaS/issues/40), [#49](https://github.com/eliancanul/AulaLista-SaaS/issues/49), [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13), [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15), [#12](https://github.com/eliancanul/AulaLista-SaaS/issues/12), [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17).
Se conservó íntegro el cuerpo anterior bajo un encabezado histórico. No se
cerró ni reabrió ninguno; el estado administrativo no sustituye evidencia.

- [#11](https://github.com/eliancanul/AulaLista-SaaS/issues/11) conserva chat/contexto/recursos; no se abrieron tres duplicados de
  sus subcortes. [#53](https://github.com/eliancanul/AulaLista-SaaS/issues/53) conserva comparar/aplicar/rechazar contexto derivado
  sin sobrescribir actividades, correcciones o historia; no se duplicó ese trabajo.
- [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13) y [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15) siguen cerrados para su fase1. Enlazan sus sucesores de
  OTP/vinculación/consentimiento y buffer tras401; sus límites históricos no
  desaparecen por crear los tickets. [#12](https://github.com/eliancanul/AulaLista-SaaS/issues/12) y [#17](https://github.com/eliancanul/AulaLista-SaaS/issues/17) también conservan
  cierre y evidencia de su alcance.
- [#52](https://github.com/eliancanul/AulaLista-SaaS/issues/52)/[#61](https://github.com/eliancanul/AulaLista-SaaS/issues/61)/[#62](https://github.com/eliancanul/AulaLista-SaaS/issues/62)/[#68](https://github.com/eliancanul/AulaLista-SaaS/issues/68) distinguen el código ya integrado
  de sus verificaciones operativas pendientes. El modo window no necesita una
  tarifa de un endpoint de conteo remoto que no invoca.
- [#40](https://github.com/eliancanul/AulaLista-SaaS/issues/40) conserva los ensayos exploratorios reales ya registrados y sus
  límites: muestra vista, sin aceptación general/API/pedagogía. No reinicia OCR.
  [#49](https://github.com/eliancanul/AulaLista-SaaS/issues/49) conserva preparación offline y el bloqueo de ejecución CLI; no
  vuelve a abrir [#32](https://github.com/eliancanul/AulaLista-SaaS/issues/32)/[#33](https://github.com/eliancanul/AulaLista-SaaS/issues/33)/[#34](https://github.com/eliancanul/AulaLista-SaaS/issues/34) como trabajo nuevo.
- [#31](https://github.com/eliancanul/AulaLista-SaaS/issues/31) conserva el síntoma Firefox pendiente; Safari se normalizó según
  el reporte humano, sin causa confirmada de la diferencia. No atribuirlo a un
  zoom global ni a la nueva composición.

## Cobertura del MVP anterior

| Grupo de #75 | Capacidad | Dueños en Issues | Evidencia y límite actuales |
| --- | --- | --- | --- |
| M1 | Chat único, continuidad, contexto y recursos | [#11](https://github.com/eliancanul/AulaLista-SaaS/issues/11) | Chat multiturno integrado; dirección de conversación única y compactación pendiente. |
| M2 | Presupuesto compartido | [#62](https://github.com/eliancanul/AulaLista-SaaS/issues/62), [#68](https://github.com/eliancanul/AulaLista-SaaS/issues/68), [#69](https://github.com/eliancanul/AulaLista-SaaS/issues/69) | Implementado; consumo y operación real pendientes. Incluye futuros intentos de compactación. |
| M3 | Planeación manual variable | [#52](https://github.com/eliancanul/AulaLista-SaaS/issues/52), [#62](https://github.com/eliancanul/AulaLista-SaaS/issues/62), [#67](https://github.com/eliancanul/AulaLista-SaaS/issues/67), [#69](https://github.com/eliancanul/AulaLista-SaaS/issues/69) | Código integrado; aceptación humana/real pendiente. |
| M4 | Acceso y aislamiento servido | [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13), [#69](https://github.com/eliancanul/AulaLista-SaaS/issues/69) | Google/sesión históricos; smoke del candidato desplegado por verificar. |
| M5 | Errores y recuperación | [#11](https://github.com/eliancanul/AulaLista-SaaS/issues/11), [#62](https://github.com/eliancanul/AulaLista-SaaS/issues/62), [#68](https://github.com/eliancanul/AulaLista-SaaS/issues/68), [#69](https://github.com/eliancanul/AulaLista-SaaS/issues/69) | Recibos/GET existentes; preservar al ampliar contexto y comprobar uso real. |
| M6 | Editar, guardar y reabrir | [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15), [#52](https://github.com/eliancanul/AulaLista-SaaS/issues/52), [#69](https://github.com/eliancanul/AulaLista-SaaS/issues/69) | Edición básica integrada; mejora tras401 separada. |
| M7 | Imprimir revisión confirmada | [#61](https://github.com/eliancanul/AulaLista-SaaS/issues/61), [#69](https://github.com/eliancanul/AulaLista-SaaS/issues/69) | Código/PDF comprobados; no equivalen a impresión física ni aceptación del nuevo deploy. |
| M8 | Aceptación privada | [#69](https://github.com/eliancanul/AulaLista-SaaS/issues/69) y [#11](https://github.com/eliancanul/AulaLista-SaaS/issues/11) | No aceptada; chat y Planeación comparten techo de ensayo, no dos presupuestos. |

## Cobertura posterior confirmada

| Grupo de #75 | Capacidad | Dueño activo / continuidad |
| --- | --- | --- |
| F1 | Lector/reapertura de apartados | [#53](https://github.com/eliancanul/AulaLista-SaaS/issues/53) |
| F2 | Móvil A de apartados | [#65](https://github.com/eliancanul/AulaLista-SaaS/issues/65) |
| F3 | Hoja de actividades y clave | [#66](https://github.com/eliancanul/AulaLista-SaaS/issues/66) |
| F4 | Cuatro herramientas priorizadas | [#86](https://github.com/eliancanul/AulaLista-SaaS/issues/86), [#87](https://github.com/eliancanul/AulaLista-SaaS/issues/87), [#88](https://github.com/eliancanul/AulaLista-SaaS/issues/88), [#89](https://github.com/eliancanul/AulaLista-SaaS/issues/89) |
| F5 | Siete contratos futuros | [#90](https://github.com/eliancanul/AulaLista-SaaS/issues/90), [#91](https://github.com/eliancanul/AulaLista-SaaS/issues/91), [#92](https://github.com/eliancanul/AulaLista-SaaS/issues/92), [#93](https://github.com/eliancanul/AulaLista-SaaS/issues/93), [#94](https://github.com/eliancanul/AulaLista-SaaS/issues/94), [#95](https://github.com/eliancanul/AulaLista-SaaS/issues/95), [#96](https://github.com/eliancanul/AulaLista-SaaS/issues/96) |
| F6 | Selector curricular | [#18](https://github.com/eliancanul/AulaLista-SaaS/issues/18) y [#80](https://github.com/eliancanul/AulaLista-SaaS/issues/80) |
| F7 | Contexto/recursos y actualización derivada | [#11](https://github.com/eliancanul/AulaLista-SaaS/issues/11) y [#53](https://github.com/eliancanul/AulaLista-SaaS/issues/53) |
| F8 | Editor enriquecido | [#81](https://github.com/eliancanul/AulaLista-SaaS/issues/81) |
| F9 | Buffer tras reautenticación | [#82](https://github.com/eliancanul/AulaLista-SaaS/issues/82); antecedente [#15](https://github.com/eliancanul/AulaLista-SaaS/issues/15) |
| F10 | Acceso/consentimiento pospuestos | [#83](https://github.com/eliancanul/AulaLista-SaaS/issues/83), [#84](https://github.com/eliancanul/AulaLista-SaaS/issues/84), [#85](https://github.com/eliancanul/AulaLista-SaaS/issues/85); antecedente [#13](https://github.com/eliancanul/AulaLista-SaaS/issues/13) |
| F11 | Escala y compatibilidad | [#31](https://github.com/eliancanul/AulaLista-SaaS/issues/31) |
| F12 | Documentos y operación | [#19](https://github.com/eliancanul/AulaLista-SaaS/issues/19) → [#97](https://github.com/eliancanul/AulaLista-SaaS/issues/97), [#98](https://github.com/eliancanul/AulaLista-SaaS/issues/98), [#99](https://github.com/eliancanul/AulaLista-SaaS/issues/99), [#100](https://github.com/eliancanul/AulaLista-SaaS/issues/100), [#101](https://github.com/eliancanul/AulaLista-SaaS/issues/101), [#102](https://github.com/eliancanul/AulaLista-SaaS/issues/102), [#103](https://github.com/eliancanul/AulaLista-SaaS/issues/103) |
| F13 | Interpretación automática y web opcional | [#104](https://github.com/eliancanul/AulaLista-SaaS/issues/104), [#105](https://github.com/eliancanul/AulaLista-SaaS/issues/105) |
| F14 | Evaluación y decisiones | [#40](https://github.com/eliancanul/AulaLista-SaaS/issues/40), [#49](https://github.com/eliancanul/AulaLista-SaaS/issues/49), [#106](https://github.com/eliancanul/AulaLista-SaaS/issues/106), [#107](https://github.com/eliancanul/AulaLista-SaaS/issues/107) |

El orden lector/reapertura [#53](https://github.com/eliancanul/AulaLista-SaaS/issues/53) → móvil A [#65](https://github.com/eliancanul/AulaLista-SaaS/issues/65) → Hoja [#66](https://github.com/eliancanul/AulaLista-SaaS/issues/66) se
mantiene. Es una prioridad acordada; no una dependencia técnica de chat o de
todas las demás herramientas. Admisión y almacenamiento acuerdan un perfil
antes de implementar: almacenamiento no espera el cierre de admisión, evitando
una dependencia circular. La definición de soporte tampoco espera el layout.

## Las trece entradas del catálogo

| Entrada | Ticket propietario |
| --- | --- |
| Planeación de clase | [#52](https://github.com/eliancanul/AulaLista-SaaS/issues/52), [#61](https://github.com/eliancanul/AulaLista-SaaS/issues/61), [#62](https://github.com/eliancanul/AulaLista-SaaS/issues/62), [#69](https://github.com/eliancanul/AulaLista-SaaS/issues/69) |
| Hoja de actividades | [#66](https://github.com/eliancanul/AulaLista-SaaS/issues/66) |
| Concretar Preguntas sobre un texto y su primer recorrido | [#86](https://github.com/eliancanul/AulaLista-SaaS/issues/86) |
| Concretar Adaptar material conservando el original | [#87](https://github.com/eliancanul/AulaLista-SaaS/issues/87) |
| Concretar Tarjetas de repaso editables | [#88](https://github.com/eliancanul/AulaLista-SaaS/issues/88) |
| Concretar Bingo con distribución durable | [#89](https://github.com/eliancanul/AulaLista-SaaS/issues/89) |
| Definir el primer contrato de Proyecto de aula | [#90](https://github.com/eliancanul/AulaLista-SaaS/issues/90) |
| Definir el primer contrato de Diagnóstico breve | [#91](https://github.com/eliancanul/AulaLista-SaaS/issues/91) |
| Definir Rúbrica y lista de cotejo editables | [#92](https://github.com/eliancanul/AulaLista-SaaS/issues/92) |
| Definir el primer contrato de Memorama | [#93](https://github.com/eliancanul/AulaLista-SaaS/issues/93) |
| Definir el primer contrato de Sopa de letras | [#94](https://github.com/eliancanul/AulaLista-SaaS/issues/94) |
| Definir el primer contrato de Adivina con pistas | [#95](https://github.com/eliancanul/AulaLista-SaaS/issues/95) |
| Definir el primer contrato de Quiz para proyectar | [#96](https://github.com/eliancanul/AulaLista-SaaS/issues/96) |

Secuencia didáctica y Programa analítico permanecen dentro de Planeación;
no hay una entrada14. Resumen docente, exportación DOCX, imágenes o estrategias
exploradas en [#40](https://github.com/eliancanul/AulaLista-SaaS/issues/40) no se convierten en nuevas herramientas aprobadas.
Buscar global, Ajustes, Micrófono y etiquetas de cuenta/plan no tienen contrato
seleccionado completo: el layout debe explicar su indisponibilidad o retirarlas
del corte, no inventar funciones a partir de un control disabled.

## Correspondencia de las diez puertas H3

La [spec0011](../specs/0011-puertas-archivos-ia.md) tiene diez puertas. Las siete
nuevas son datos/destinos [#97](https://github.com/eliancanul/AulaLista-SaaS/issues/97), aislamiento [#98](https://github.com/eliancanul/AulaLista-SaaS/issues/98),
admisión [#99](https://github.com/eliancanul/AulaLista-SaaS/issues/99), almacenamiento [#100](https://github.com/eliancanul/AulaLista-SaaS/issues/100), parser [#101](https://github.com/eliancanul/AulaLista-SaaS/issues/101),
retención [#102](https://github.com/eliancanul/AulaLista-SaaS/issues/102) y restore [#103](https://github.com/eliancanul/AulaLista-SaaS/issues/103).
Las otras tres ya tienen dueño: proveedor/método → [#40](https://github.com/eliancanul/AulaLista-SaaS/issues/40) y
[#104](https://github.com/eliancanul/AulaLista-SaaS/issues/104); límites/consumo → [#62](https://github.com/eliancanul/AulaLista-SaaS/issues/62)/[#68](https://github.com/eliancanul/AulaLista-SaaS/issues/68)/[#69](https://github.com/eliancanul/AulaLista-SaaS/issues/69) más
las cotas específicas de documentos; resultado/edición/recuperación →
[#104](https://github.com/eliancanul/AulaLista-SaaS/issues/104) con B3 y una aclaración interpretativa durable.
[#19](https://github.com/eliancanul/AulaLista-SaaS/issues/19) es el índice contractual; escribir o cerrar ese contrato no certifica
las siete operaciones. No se seleccionaron almacenamiento, parser, RLS o servicios
de pago por aparecer como alternativas.

## Evidencia y revisión de esta entrega

Se consultaron los 33 issues existentes con su estado completo y los comentarios
relevantes, las specs/ADR, UI, ledger75 y auditoría de sus 38 asignaciones. Esa cifra
histórica no es 38 funciones nuevas ni aceptación visual38/38. Auditorías de
cobertura, frontend/soporte y backend/contexto: agentes Astra xhigh. La revisión
independiente y los hashes del candidato final se registran en el PR; no atribuir
a este documento pruebas de producto nuevas ni observación docente.

Comprobaciones exigidas para publicar: unicidad de tickets y títulos, todas las
referencias resueltas a números reales, lectura posterior de cuerpos/estados,
cobertura M1–M8/F1–F14/13 herramientas/10 puertas, enlaces locales, diff sólo
documental y revisión independiente. CI sin pasos no es verde y no autoriza merge.
