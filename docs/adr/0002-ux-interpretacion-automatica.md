# ADR 0002: resultado automático y editable, estrategia por evidencia

Fecha: 2026-10-15 UTC. Estado: dirección de producto confirmada; estrategia de interpretación pendiente de evaluación. [T3](../tickets/T3-prototipo-flujo-automatico.md) integra el prototipo sintético local con revisión y CI; implementación del flujo real, benchmark y validación con docentes pendientes.

## Contexto

El propietario prioriza mínima fricción: subir material y recibir un resultado útil, guardado automáticamente y editable. Las garantías de [ADR 0001](0001-fundacion-personal.md) siguen vigentes; su separación de responsabilidades internas no obliga al docente a aceptar etapas.

Esta dirección sustituye las recomendaciones del informe estratégico del 15 de octubre de 2026 sobre contexto confirmado obligatorio, aceptación general, cualquier límite de aclaraciones heredado incompatible con el máximo actual y extracción previa como requisito universal. Ese informe se conserva como antecedente, sin copiarlo ni reescribirlo aquí. Sus garantías de seguridad, autoridad y versionado se mantienen.

## Decisiones confirmadas

- Carga → resultado útil automáticamente guardado y editable. Sin aprobación general, por bloque o por etapa de extracción/interpretación. Las ediciones se conservan al reabrir y frente a resultados tardíos.
- Resolver automáticamente primero con fuente y contexto autorizados, preferentemente mediante LLM bajo límites explícitos de intentos, tokens y coste. El método concreto depende de la evaluación; esta preferencia no autoriza llamadas ni gasto.
- Cero preguntas por defecto. Sólo si es imprescindible y resoluble rápidamente, máximo una solicitud breve de aclaración/corrección por planeación. El límite persiste entre archivos, versiones, sesiones y reintentos; una respuesta insuficiente no habilita otra ronda. Lo irresoluble queda pendiente visible junto al resultado parcial útil, con edición voluntaria.
- Seguridad, autoridad, atomicidad y versiones siguen siendo responsabilidades internas. Un resultado guardado no se etiqueta como aceptado o validado por el docente. Guardar/interpretar tampoco publica, acredita aprendizaje, cambia permisos ni autoriza destinos nuevos.
- El ahorro total de tokens tiene peso **20 %** en la evaluación. Puede tolerarse una pequeña pérdida de precisión no crítica, delimitada antes del ensayo; ningún ahorro compensa errores críticos, pérdida de significado esencial o fallos de privacidad/autoridad.

## Decisión abierta

Comparar extracción + modelo, PDF visual + modelo e híbrido sobre los mismos originales y tarea. Un baseline anterior sólo entra si está disponible, es reproducible y su uso está autorizado. No se reconstruye el legado para hacerlo competir.

No se eligen todavía proveedor, modelo, cascada, cola ni número de etapas. La comparación end-to-end decide; un diagnóstico con extracción común puede aislar errores semánticos, pero no excluir PDF visual de la prueba decisiva. La evidencia de origen debe representar lo realmente usado por cada candidato.

La distribución del **80 % restante**, la fórmula de normalización del 20 %, los umbrales, el baseline y los presupuestos todavía no están acordados. Se fijan antes del ensayo final; mientras falten, no hay puntuación ponderada ni ganador aprobados. Se reportan también resultados sin ponderar y coste monetario separado de tokens.

## Consecuencias y verificación

El contrato observable y el plan de evaluación viven en [spec 0002](../specs/0002-flujo-automatico-material.md). No se introduce una entidad o pantalla de aprobación por heredar el nombre `AcceptanceSnapshot`. Un caso pedagógico futuro que necesite una confirmación concreta requiere su propio contrato, sin convertirlo en una aprobación universal de interpretación.

[T3](../tickets/T3-prototipo-flujo-automatico.md) comprueba el recorrido sintético; [T4](../tickets/T4-preparar-evaluacion.md) prepara la comparación offline; [T5](../tickets/T5-ensayo-interpretacion.md) ejecuta sólo con permisos y presupuesto aplicables. No prueban utilidad docente real hasta observarla con personas del público objetivo. Documentos reales conservan la puerta H3 de [revisiones](../reviews/README.md).

Reconsiderar la estrategia al obtener resultados reproducibles por tipo de documento o cambiar tarea/alcance. Registrar la decisión con sus límites; si ningún candidato cumple, declarar la insuficiencia. No añadir una segunda estrategia sin beneficio medido.
