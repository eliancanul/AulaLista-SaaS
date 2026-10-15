# T3: probar el recorrido automático visible

Estado: pendiente; no implementado ni validado con docentes. Dependencia: [ADR 0002](../adr/0002-ux-interpretacion-automatica.md), [spec 0002](../specs/0002-flujo-automatico-material.md) y revisión del contrato/recorrido [H2](../reviews/README.md) antes de programar el prototipo. Escribir la spec o revisarla entre agentes no acredita H2 UX observado ni validación docente. T4 puede prepararse offline en paralelo.

## Resultado

Prototipo ejecutable, inequívocamente sintético: carga → resultado útil editable → guardado/reapertura. Un caso claro y otro con ambigüedad material permiten descubrir fricción antes de añadir infraestructura.

## Alcance y aceptación

- Recorrido claro sin preguntas ni aceptación de extracción, interpretación, bloque o conjunto.
- Duda material: resolución automática simulada identificada como tal, parte independiente utilizable y máximo una solicitud breve necesaria por planeación. Comprobar archivos/versiones, reintentos, sesiones, respuesta insuficiente y dudas restantes sin segunda ronda.
- Guardado pendiente/confirmado, error y conflicto comprensibles. T3 demuestra guardado local real verificable y reapertura en el mismo navegador, etiquetado «Guardado en este navegador»; el procesamiento se identifica como simulado y no se conecta al backend. Esto no acredita persistencia en servidor ni sincronización entre dispositivos. Una integración posterior con persistencia backend requerirá T2 en un entorno de prueba aislado, sin introducir actores de test en el runtime normal.
- Ejecutar los casos de recuperación, concurrencia, navegación y accesibilidad de spec 0002; registrar evidencia, hallazgos y límites. Una maqueta estática no acredita esos comportamientos.
- Aportar a [H2](../reviews/README.md) el prototipo y sus resultados; mantener separada la prueba planificada con docentes de las comprobaciones de agentes.

## Fuera de alcance y salida

Proveedor IA, documentos reales, login falso público, cobro, despliegue y motor universal de workflows. Restaurar fixtures permite repetir los casos. No presentar respuestas simuladas como comprensión real. Cierre: recorrido y recuperación probados, sin hallazgos bloqueantes abiertos; los pendientes mantienen el ticket abierto. No declara H2 ni utilidad docente real por existir este ticket.
