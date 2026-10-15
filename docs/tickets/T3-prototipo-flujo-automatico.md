# T3: probar el recorrido automático visible

Estado: candidato implementado; pruebas locales pasan, revisión UI final y CI del SHA publicado pendientes. Sin validación con docentes ni cierre de H2. Dependencia: [ADR 0002](../adr/0002-ux-interpretacion-automatica.md), [spec 0002](../specs/0002-flujo-automatico-material.md) y revisión del contrato/recorrido [H2](../reviews/README.md) antes de programar el prototipo. Escribir la spec o revisarla entre agentes no acredita H2 UX observado ni validación docente. T4 puede prepararse offline en paralelo.

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

## Candidato local y evidencia

Implementación en [web/](../../web/README.md), React/TypeScript/Vite, sin conexión al backend. El contrato de recorrido fue revisado antes de programar; referencia congelada SHA-256 `176fe31675149d4a661e6537fc5ba756264acabcec12e89474743d84198429e5`. Base técnica/documental: `575da6bda52e2c549db709fdc9db2191b89ab112`.

- `npm ci --ignore-scripts`, `npm test`: 31 pruebas de estado, transacciones, conflictos y recuperación pasan en instalación limpia.
- `npm run build`: TypeScript y build pasan. Guardado confirmado requiere transacción IndexedDB terminada y lectura de la revisión.
- Ocho recorridos Playwright preparados: el shell cloud impide iniciar un Chromium nuevo por su socket local; se registra como no ejecutados con éxito. La revisión independiente sí inspecciona la app en el navegador cloud existente, con su propio informe.
- Workflow frontend separado: Node exacto, dependencias fijadas, pruebas de estado/build y Chromium de Playwright. Su resultado remoto sobre el SHA final sigue pendiente. El workflow del backend no cambia.
- Regresiones locales cubren alternativas de conflicto después de resolver, respuestas elegidas con escritura fallida, borrador vivo tras fallar lectura y vaciar todos los campos sin esconder el editor.

Los fallos de cuota/lectura se inyectan en el adaptador usando fake-indexeddb; no se han agotado cuotas físicas del navegador. Faltan las combinaciones no ensayadas de lector de pantalla, cierre abrupto del sistema y pruebas con docentes. No se presentan las simulaciones como IA real ni se garantiza sincronización de cuenta. El candidato y la evidencia exacta deben identificarse en el PR; nuevos cambios requieren revalidación.
