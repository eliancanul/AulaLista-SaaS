# T4: preparar la comparación reproducible

Referencia técnica e historial del corte. Consulta [Issues y fuentes de verdad](README.md) para elegir trabajo y consultar su estado actual.

Alcance: preparación offline; este documento no acredita un benchmark ejecutado. Dependencia técnica: tarea/salida de [spec 0002](../specs/0002-flujo-automatico-material.md); puede avanzar en paralelo a [T3](T3-prototipo-flujo-automatico.md).

## Corte de implementación

[T4a](T4a-harness-offline.md) incorpora únicamente el instrumento genérico offline
y sus fixtures sintéticas/saneadas. No completa la preparación descrita aquí ni acredita un benchmark
real, un matcher semántico o consumo de proveedor verificado.

## Resultado

Paquete reproducible para el corpus real privado autorizado: particiones, referencia IA revisable, rúbrica, manifiesto y formato de resultados con comprobaciones offline mínimas para comparar extracción + modelo, PDF visual e híbrido. Sigue el protocolo Astra/Luna de spec 0002; la referencia IA no es gold humano. Baseline anterior sólo si está disponible y autorizado. Los sintéticos son smoke del harness, no sustituyen la comparación real.

## Alcance y aceptación

- Congelar originales/referencias en destinos privados autorizados y prevenir fugas entre familias/versiones de desarrollo, validación y holdout. Registrar alcance, n, estratos y destinos permitidos por material. Los históricamente vistos no son holdout nuevo; inventariar y asignar particiones a materiales de reserva antes de exponerlos. El repositorio conserva sólo el protocolo y artefactos sintéticos autorizados.
- Definir tarea observable, hechos críticos, relaciones, ambigüedad material, calidad mínima y pérdida no crítica admisible. Preparar diagnóstico semántico y comparación end-to-end sin obligar a PDF visual a producir extracción textual previa.
- Hacer calculables las métricas de spec 0002, incluyendo fallos/vacíos/abstenciones en denominadores, cobertura y variabilidad. Identificar evaluadores y qué sería evidencia de docentes reales.
- Preparar ablaciones de deduplicación, selección pertinente y reparación localizada; medir consumo completo de selección, verificación, retries y fallos. Tokens y coste monetario permanecen separados, con componentes desconocidos explícitos.
- Documentar el 20 % confirmado de ahorro total de tokens. Proponer y dejar acordados antes del ensayo final el baseline, normalización, distribución del 80 % restante, mínimos, repeticiones y presupuesto; no presentarlos como ya aprobados. Un error crítico nunca se compensa con puntos.
- Verificar offline manifiesto, particiones y cálculos con datos sintéticos, distinguiendo esa prueba de resultados de interpretación. Registrar cómo repetirla y sus límites.

## Fuera de alcance y salida

No envía documentos, contrata servicios, ejecuta llamadas/CLI con gasto, importa datos privados ni elige ganador. Preparar entradas no concede permisos de transmisión. Cierre: paquete reproducible y comprobado offline; toda decisión o autorización restante se identifica y bloquea únicamente la ejecución que dependa de ella en [T5](T5-ensayo-interpretacion.md).
