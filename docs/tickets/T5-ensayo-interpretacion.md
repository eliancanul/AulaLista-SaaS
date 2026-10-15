# T5: ejecutar el ensayo y decidir la estrategia

Estado: pendiente; ensayo no ejecutado, sin ganador. Dependencia: [T4](T4-preparar-evaluacion.md), criterios/presupuestos fijados y autorización aplicable a cada ejecución y transmisión al destino concreto. Preparar el ensayo no concede esos permisos.

## Resultado

Comparación end-to-end y diagnóstico semántico conforme a [spec 0002](../specs/0002-flujo-automatico-material.md), con resultados por estrato y recomendación razonada. Son resultados válidos «ninguno cumple» o «falta evidencia».

## Aceptación

- Mismos originales/tarea y candidatos congelados; repeticiones y alcance declarados. Aplicar el protocolo privado Astra/Luna de spec 0002, sin confundir referencia IA revisable con gold humano ni sintéticos con comparación real. Evaluación ciega cuando sea viable, referencias y rúbrica previas, holdout sin ajustes retrospectivos.
- Calidad mínima, errores críticos y precisión no crítica tolerable fijados antes de puntuar. Verificar cero preguntas en casos claros y máximo una solicitud breve necesaria por planeación; pendientes no se inventan como resueltos.
- Medir utilidad, corrección, recuperación, cobertura y latencia. Distinguir simulación/evaluación de agentes o expertos de observación con docentes reales.
- Conservar todos los intentos, fallos y consumo del recorrido completo. Reportar tokens nativos y coste monetario separados; mostrar límites de comparabilidad y ahorro contra baseline homologable.
- Aplicar el 20 % de ahorro de tokens sólo entre candidatos que superan invariantes/mínimos; usar el resto de pesos y fórmula acordados antes del ensayo. Mostrar resultados sin ponderar, sensibilidad y ejemplos de errores.
- Actualizar [ADR 0002](../adr/0002-ux-interpretacion-automatica.md) con evidencia, decisión y límites. Favorecer menor complejidad ante empate práctico; no incorporar otra estrategia sin beneficio medido.

## Límites y salida

El ticket no autoriza por sí mismo gasto, destinos nuevos, contacto con docentes o despliegue. Si un candidato no puede ejecutarse con permisos/presupuesto aplicables, registrar la limitación sin simular evidencia. El ensayo no habilita documentos reales ni piloto: [H3](../reviews/README.md) conserva sus requisitos. Cierre: evidencia reproducible y decisión sustentada o insuficiencia explícita; la integración posterior del flujo real requiere su propio incremento.
