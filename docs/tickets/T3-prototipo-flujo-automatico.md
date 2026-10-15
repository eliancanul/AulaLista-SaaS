# T3: probar el recorrido automático visible

Estado: incremento sintético integrado en [PR #5](https://github.com/eliancanul/AulaLista-SaaS/pull/5), con revisión independiente y CI premerge/postmerge correctas. Sin validación con docentes ni cierre global de H2. Dependencia: [ADR 0002](../adr/0002-ux-interpretacion-automatica.md), [spec 0002](../specs/0002-flujo-automatico-material.md) y revisión previa del contrato/recorrido [H2](../reviews/README.md), realizada antes de programar. La revisión de agentes no acredita utilidad docente real. T4 continúa su preparación offline.

## Resultado

Prototipo ejecutable, inequívocamente sintético: carga → resultado útil editable → guardado/reapertura. Un caso claro y otro con ambigüedad material permiten descubrir fricción antes de añadir infraestructura.

## Alcance y aceptación

- Recorrido claro sin preguntas ni aceptación de extracción, interpretación, bloque o conjunto.
- Duda material: resolución automática simulada identificada como tal, parte independiente utilizable y máximo una solicitud breve necesaria por planeación. Comprobar archivos/versiones, reintentos, sesiones, respuesta insuficiente y dudas restantes sin segunda ronda.
- Guardado pendiente/confirmado, error y conflicto comprensibles. T3 demuestra guardado local real verificable y reapertura en el mismo navegador, etiquetado «Guardado en este navegador»; el procesamiento se identifica como simulado y no se conecta al backend. Esto no acredita persistencia en servidor ni sincronización entre dispositivos. Una integración posterior con persistencia backend requerirá T2 en un entorno de prueba aislado, sin introducir actores de test en el runtime normal.
- Ejecutar los casos de recuperación, concurrencia, navegación y accesibilidad de spec 0002; registrar evidencia, hallazgos y límites. Una maqueta estática no acredita esos comportamientos.
- Aportar a [H2](../reviews/README.md) el prototipo y sus resultados; mantener separada la prueba planificada con docentes de las comprobaciones de agentes.

## Fuera de alcance y salida

Proveedor IA, documentos reales, login falso público, cobro, despliegue y motor universal de workflows. Restaurar fixtures permite repetir los casos. No presentar respuestas simuladas como comprensión real. El cierre técnico de este incremento acredita el recorrido y recuperación sintéticos probados, sin hallazgos bloqueantes abiertos en ese alcance. Las comprobaciones adicionales y la validación docente siguen pendientes; no declara H2 ni utilidad docente real.

## Integración y evidencia

Implementación en [web/](../../web/README.md), React/TypeScript/Vite, sin conexión al backend. El contrato de recorrido fue revisado antes de programar; referencia congelada SHA-256 `176fe31675149d4a661e6537fc5ba756264acabcec12e89474743d84198429e5`. Base técnica/documental: `575da6bda52e2c549db709fdc9db2191b89ab112`.

- `npm ci --ignore-scripts`, `npm test`: 31 pruebas de estado, transacciones, conflictos y recuperación pasan en instalación limpia.
- `npm run build`: TypeScript y build pasan. Guardado confirmado requiere transacción IndexedDB terminada y lectura de la revisión.
- Ocho recorridos Playwright ejecutados correctamente en CI remota. El shell cloud no pudo iniciar Chromium por su socket local; esa limitación local se mantiene y no se presenta como éxito local. La revisión independiente también inspeccionó la app en el navegador cloud existente con teclado, dos pestañas, recarga y zoom/reflow.
- Workflow frontend separado: Node exacto, dependencias fijadas, pruebas de estado/build y Chromium de Playwright. El workflow del backend no cambia.
- Regresiones locales cubren alternativas de conflicto después de resolver, respuestas elegidas con escritura fallida, borrador vivo tras fallar lectura y vaciar todos los campos sin esconder el editor.

Head revisado: `c3ee082d01c087575a7e6e1577a048c3c5092574`; árbol
`770d18468cb1dd76e252b289fca5c038c90c097e`. Merge:
`d58255bcaa71e874d69022e0e96a7a59adfd0a70`, mismo árbol y padres base/head comprobados.
La revisión atribuye los roles a agentes, no a identidades humanas independientes.

- CI premerge: [backend, 114 pruebas y privacidad PostgreSQL](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/38697244645) y [web, 31 unitarias y ocho E2E](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/38697244706).
- CI postmerge del SHA anterior: [backend](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/38698461663) y [web](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/38698461715), con las mismas cantidades y logs del checkout exacto.
- El primer run web tuvo dos fallos de selector: los elementos DETAILS también exponían rol group. Se corrigieron los selectores y se añadió una comprobación de nombre accesible; se conservaron las ocho pruebas y sus expectativas. El PR registra el fallo, la corrección y su revisión.

Los fallos de cuota/lectura se inyectan en el adaptador usando fake-indexeddb; no se han agotado cuotas físicas del navegador. Faltan las combinaciones no ensayadas de lector de pantalla, cierre abrupto del sistema y pruebas con docentes. No se presentan las simulaciones como IA real ni se garantiza sincronización de cuenta. Nuevos cambios requieren revalidación del candidato exacto.
