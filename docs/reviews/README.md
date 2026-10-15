# Consultas por hitos

## Propósito y honestidad

Revisar el producto periódicamente desde perspectivas de negocio, marketing, UX, UI, arquitectura, deuda técnica, seguridad, QA/operación y pedagogía. Son roles de análisis asistidos por IA; no representan asesores humanos, empresas contratadas, entrevistas reales ni una actividad permanente. La decisión final de negocio corresponde al propietario del producto.

Este documento programa criterios de consulta durante el trabajo; no afirma que una sesión haya ocurrido. Una consulta efectuada requiere artefacto revisado, fecha, autor real del análisis, hallazgo y decisión registrada. Evidencia de docentes o de mercado se identifica por separado de hipótesis de los agentes.

## Cadencia ligada al avance

Hacer una consulta breve al cerrar cada dos tickets terminados o antes de cruzar un hito, lo que ocurra primero. Un cambio material de alcance, público, arquitectura, privacidad o coste dispara revisión inmediata de las perspectivas afectadas. Durante inactividad no se simulan sesiones ni se promete vigilancia continua.

Seleccionar únicamente los roles pertinentes al cambio; no convocar todos para cada PR. El revisor adversarial de código mantiene independencia del autor aunque consulte directamente con él.

## Preguntas y evidencia

| Perspectiva | Pregunta principal | Evidencia o decisión verificable |
|---|---|---|
| CEO / negocio | ¿Este tramo reduce el riesgo principal para el docente individual? | Prioridad, supuesto por validar, coste de oportunidad y decisión de continuar/recortar |
| Marketing | ¿La promesa describe una capacidad demostrada y un público definido? | Mensaje propuesto, evidencia disponible y afirmaciones que todavía no se pueden hacer |
| UX | ¿El docente completa el objetivo y recupera su trabajo en error/conflicto? | Recorrido, estados, prueba observable y dudas a validar con docentes |
| UI / accesibilidad | ¿Jerarquía, foco, teclado, contraste y estados comunican correctamente? | Pantalla/flujo revisado, fallos concretos y criterios de aceptación |
| Arquitectura / deuda técnica | ¿La frontera es necesaria y el cambio mínimo conserva invariantes? | Dependencias justificadas, deuda específica con disparador de revisión y propuesta de simplificación |
| Seguridad / privacidad | ¿Quién puede acceder, qué sale del sistema y qué falla de forma segura? | Casos de abuso, fronteras de datos, bloqueantes y prueba exigida |
| QA / operación | ¿Se repite el resultado y se recupera un fallo real? | Pruebas de contrato, CI exacta, fallos reproducidos, recuperación y límites medidos |
| Pedagogía | ¿La información conserva significado y autoridad docente? | Rúbrica/criterio propuesto; validación docente real antes de afirmar utilidad o aprendizaje |

## Hitos

- **H0, alcance inicial antes de T1:** negocio/marketing, arquitectura/deuda y seguridad comprueban público, promesa limitada, propiedad e inicio limpio. Salida: ADR, no objetivos y tickets coherentes. UX/UI aportan límites de alcance sin diseñar pantallas todavía.
- **H1, antes de aceptar T2:** arquitectura/deuda, seguridad y QA intentan romper aislamiento, historia y reintento. Salida: hallazgos resueltos o corte bloqueado, con evidencia del candidato. Estado: satisfecho en la integración de PR #3, según el [recibo de T2](../tickets/T2-fuentes-versionadas.md), con CI postmerge correcta.
- **H2, primer recorrido visible (pendiente):** revisar contrato y recorrido antes de programar [T3](../tickets/T3-prototipo-flujo-automatico.md). Después, UX/UI y accesibilidad verifican en el prototipo sintético carga, primera utilidad, guardado, edición, máximo una solicitud breve indispensable por planeación y recuperación según [spec 0002](../specs/0002-flujo-automatico-material.md), antes de añadir infraestructura ajena al recorrido. Pedagogía contribuye a la rúbrica de [T4](../tickets/T4-preparar-evaluacion.md), cuya preparación offline puede avanzar en paralelo, sin imponer aceptación por bloque. Salida: hallazgos observados, correcciones y prueba planificada con docentes; negocio/marketing limita la promesa a lo demostrado. Escribir la spec o revisarla entre agentes no acredita H2 UX observado ni investigación con docentes.
- **H3, antes de documentos reales/piloto:** seguridad/privacidad y QA/operación revisan identidad, permisos, almacenamiento, parser, destinos y recuperación. Salida: cada gate tiene prueba y responsable; mientras falte uno, el piloto permanece cerrado.
- **H4, antes de precio/cobro o ampliar el piloto:** negocio, marketing, UX, pedagogía y operación revisan evidencia docente, disposición a pagar, costes, cancelación y soporte. Salida: decisión del propietario y pendientes comerciales; no fijar precios como hechos sin datos.

Los hitos son trabajo interno del equipo, no pantallas ni confirmaciones que deba atravesar el docente. Son puertas de decisión, no autorización de contratos, gastos, comunicaciones a docentes o despliegue.

## Registro mínimo de una consulta realizada

Crear una sección en el ticket/PR o un registro breve en este directorio con: fecha; autor real y perspectiva; artefacto y SHA/hash revisados; pregunta; evidencia; hallazgo; recomendación; decisión tomada/pendiente; responsable; siguiente prueba y condición de revisión. Si no hubo investigación real con usuarios, decirlo.

Consultar directamente con implementadores está permitido. Registrar cambios de alcance y decisiones; comunicar bloqueantes al coordinador sin esperar al siguiente hito. El código no se aprueba por votación de roles: debe satisfacer spec, revisión independiente y CI.
