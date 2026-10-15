# Especificación 0002: de carga a resultado útil y editable

Estado: contrato de producto y plan de evaluación; prototipo sintético local [T3](../tickets/T3-prototipo-flujo-automatico.md) integrado y probado. Flujo real, ensayos y validación docente pendientes. Dirección: [ADR 0002](../adr/0002-ux-interpretacion-automatica.md). La fundación técnica conserva [spec 0001](0001-fundacion.md).

## Resultado y alcance

Con una carga, el docente obtiene material estructurado útil, guardado automáticamente y editable; lo reabre sin perder correcciones ni aceptar etapas. Antes del ensayo se fija una tarea observable que permita reconocer utilidad, por ejemplo localizar y ajustar una actividad del material sin reconstruirla manualmente. Un indicador de progreso, texto aislado o JSON válido no acredita esa tarea.

- **T3, prototipo sintético:** integrado en PR #5 tras revisión previa del contrato/recorrido y revisión independiente de interacción/recuperación con fixtures. Identifica toda simulación; el guardado local es real, sin interpretación real ni persistencia de backend. La validación docente y el cierre global de H2 siguen pendientes.
- **T4–T5, evaluación controlada:** prepara y compara estrategias con entradas y destinos autorizados. Distingue evaluación de agentes, expertos y docentes reales.
- **Producto con documentos reales:** requiere H3 antes de la exposición correspondiente: identidad, autorización, aislamiento, archivos privados y límites, destinos permitidos y recuperación. Esto no bloquea preparar el prototipo sintético ni el ensayo offline.

## Contrato de interacción

1. Cargar material reutiliza el contexto disponible; no abre un cuestionario inicial por defecto. Guarda el original e inicia únicamente procesamiento autorizado.
2. Mostrar estado real y permitir abandonar/retomar. No fingir porcentajes o contenido ya comprendido. Presentar el primer resultado coherente y útil, editable y guardado; conservar utilizable la parte independiente cuando otra esté pendiente.
3. Guardar ediciones automáticamente. Mostrar «Guardado» sólo tras confirmación durable; hasta entonces conservar borrador y comunicar pendiente/error. Un conflicto requiere recuperación visible, nunca sobrescritura silenciosa.
4. Reabrir carga la revisión guardada. Resultados posteriores, trabajos cancelados o reintentos no pisan ediciones confirmadas ni reinterpretan silenciosamente el pasado. Recuperar la operación correspondiente antes de crear otra.
5. Mostrar dudas no críticas junto al contenido sin detener lo independiente. Distinguir hechos apoyados por fuente, inferencias y datos ausentes; no rellenar ausencias como hechos ni llamar al resultado «validado por el docente».

### Una solicitud como máximo por planeación

Una ambigüedad es **material** si dos interpretaciones razonables cambian la actividad o decisión necesaria y la fuente/contexto autorizados no permiten resolverla: por ejemplo, mezclar grupos, atribuir un criterio a otra unidad o escoger una fecha que cambia la jornada. Diferencias cosméticas, campos opcionales ausentes o baja confianza por sí sola no justifican preguntar.

Resolver automáticamente primero, preferentemente con LLM cuando esté autorizada y bajo presupuesto acotado de intentos, tokens y coste. Sólo si la duda sigue siendo imprescindible y tiene una respuesta rápida puede iniciarse una solicitud breve. Pedir la decisión mínima que desbloquea lo importante, sin esconder varias rondas en un formulario. Si es posible, presentar antes el resultado parcial útil.

El límite pertenece a la **planeación**, no al archivo ni al job. Su identidad y el estado de la solicitud deben conservarse coherentemente entre archivos, versiones, sesiones, recargas y reintentos, incluso concurrentes. Presentar la solicitud consume el límite. Recuperar la misma pendiente no crea otra; respuesta incompleta, reapertura o nueva extracción no lo reinician. Después, lo irresoluble queda pendiente visible y editable voluntariamente; no se inicia una segunda ronda ni se inventa una respuesta. Varias dudas no autorizan una entrevista obligatoria.

Errores del parser, infraestructura o autorización requieren estado/recuperación propios; no se trasladan al docente como preguntas semánticas. El límite de una solicitud tampoco autoriza consumo ilimitado para evitar preguntar.

### Casos observables de aceptación

- Caso claro: resultado útil editable sin preguntas ni aceptación de extracción, bloques o conjunto.
- Duda material: resolución automática acotada primero, parte independiente utilizable y como máximo una decisión breve necesaria.
- Varias dudas, respuesta insuficiente o ausente, otro archivo/versión, nueva sesión y reejecución: nunca una segunda solicitud. La misma pendiente puede retomarse; el resto sigue explícitamente pendiente.
- Recarga, navegación atrás/adelante, doble clic, respuesta perdida, sesión vencida y reconexión: no duplican trabajo ni pierden cambios confirmados.
- Edición antes de un resultado tardío y dos pestañas concurrentes: preservan cambios y presentan conflictos recuperables. Cancelar impide que el trabajo tardío sustituya el estado nuevo.
- Teclado, foco, contraste, lectura de estados y pantallas objetivo: se comprueban en la interfaz. Escribir estos criterios no acredita haberlos probado.

## Garantías internas y procedencia

Conservar original exacto, versiones, actor autorizado, operación/intento y revisión guardada. Identificar por hash los artefactos realmente usados: extracción, páginas renderizadas o PDF directo según el candidato, junto con configuración y referencias localizables. No exigir una extracción textual independiente a toda interpretación visual. Son responsabilidades y datos mínimos, no una orden de crear un número fijo de tablas, servicios o pantallas.

El contenido de documentos es dato no confiable: sus instrucciones no cambian permisos, herramientas ni destinos. No permitir filtraciones entre ámbitos, pérdida de cambios confirmados, sobrescritura tardía, procedencia fabricada o afirmación falsa de guardado. Versionado, autoridad, atomicidad e idempotencia siguen las garantías de la fundación; este contrato no abre las operaciones privadas del runtime sin identidad real.

## Comparación para elegir estrategia

### Candidatos y dos recorridos de medida

| Candidato | Entrada al intérprete | Riesgo que debe revelar |
|---|---|---|
| A. Extracción + modelo | Texto/estructura, con OCR cuando proceda | Pérdida de tablas, orden, imágenes o relaciones antes del modelo |
| B. PDF visual + modelo | PDF o páginas visuales compatibles | Omisiones, referencias falsas, coste/latencia y límites de documentos largos |
| C. Híbrido | Texto/estructura más evidencia visual pertinente | Pasos o llamadas adicionales sin mejora suficiente |

Un baseline anterior es opcional si está disponible y autorizado. Ningún candidato gana por su arquitectura. Si el híbrido escala entre métodos, sus disparadores y llamadas extra forman parte del candidato medido.

- **Diagnóstico semántico:** extracción congelada común y tarea idéntica para modelos/prompts compatibles. Aísla interpretación de extracción; no decide el ganador global.
- **End-to-end:** mismos originales/tarea para A/B/C. Cuenta carga, lectura/render/OCR, colas, llamadas, validaciones, reintentos, resultado guardado, aclaración y corrección. Es la comparación decisiva.

### Preparación reproducible

1. Fijar tarea, salida mínima común y rúbrica antes de puntuar. Definir hechos/relaciones críticos, ambigüedades, errores tolerables y tarea completada sin sesgar la salida hacia un proveedor. La revisión experta del ensayo no añade aprobación docente al producto.
2. Usar corpus sintético o material con uso y destino autorizados. Cubrir digitales, escaneados, mixtos, tablas, columnas, imágenes, baja legibilidad y documentos largos; declarar estratos excluidos. Separar desarrollo, validación y holdout antes de ajustar; mantener familias de plantillas/versiones juntas para evitar fugas.
3. Congelar hashes de entradas, referencias y salidas; código/motor/modelo/proveedor exactos, instrucciones, esquema, parámetros disponibles, límites y política de retries. Conservar respuestas e intentos fallidos sin prometer reproducción idéntica del proveedor.
4. Fijar alcance, presupuesto y repeticiones antes de ejecutar. Registrar diferencias nativas de las estrategias, latencia desde inicio de carga y por etapa, incluidos arranque y cola.
5. Evaluar semántica sin revelar candidato cuando sea viable; registrar evaluador, desacuerdos y adjudicación. Un juez automático puede asistir, no acredita validación docente. Mantener fallos, vacíos, abstenciones y límites en el denominador; reportar n, cobertura, variabilidad y resultados por estrato. No ajustar al ver el holdout.

### Protocolo del ensayo previsto

- Astra analiza el corpus real privado autorizado y produce una **referencia IA revisable**, nunca un gold humano. Su origen y limitaciones se identifican; los desacuerdos o errores requieren revisión, sin presentar esa referencia como validación docente.
- Luna se evalúa sobre las mismas entradas mediante la sesión Codex del Mac ya autorizada, sin API pagada ni compras. Esta vía de ensayo no elige la arquitectura ni proveedor del producto. Permisos, alcance y destinos se verifican para cada ensayo; documentar el protocolo no amplía la autorización ni ejecuta el trabajo.
- Los sintéticos sólo sirven como smoke del harness; no sustituyen la comparación real. Familias y versiones se mantienen juntas en las particiones. Los documentos históricamente vistos no cuentan como holdout nuevo. Antes de exponer materiales nuevos de reserva se hace el inventario y se fija su partición.
- En el repositorio sólo se conserva el protocolo y herramientas/datos sintéticos autorizados: originales, referencias IA concretas, identificadores de Drive, nombres personales, credenciales, rutas privadas y contenido curricular quedan fuera. Los manifiestos/resultados privados se conservan en destinos autorizados, separados del código.
- Ejecución y ganador siguen pendientes. Informes parciales de tiempo, modelo o consumo no constituyen prueba final; la evidencia debe corresponder a entradas, configuración, intentos y denominadores congelados.

### Ahorro de tokens y coste

Comparar contra un baseline razonablemente eficiente y congelado, con ablaciones de una técnica a la vez y luego de su combinación prometedora:

- **Deduplicación contextual:** quitar redundancia sin eliminar actividades, filas o criterios distintos por compartir texto; conservar referencias.
- **Selección pertinente:** enviar regiones necesarias y verificar cobertura de dependencias, anexos y tablas continuadas; medir consumo del selector y sus omisiones.
- **Reparación localizada:** corregir el tramo y contexto necesarios, verificar relaciones afectadas y comparar contra repetir todo.
- **Contexto/salida compactos y reutilización:** medir pérdida semántica; reutilizar sólo lo compatible con versiones/dependencias. Un descuento de caché no equivale a menos tokens procesados.

Contar todo el recorrido: selección, extracción/OCR que facture tokens, interpretación, verificación, reparación, retries, escalamiento y fallos. Desglosar entrada/salida, razonamiento y modalidades según lo disponible. Componentes no expuestos se declaran desconocidos, nunca cero. Mostrar por separado tokens lógicos, facturados/cacheados disponibles, páginas/imágenes y coste monetario completo. El tiempo humano medido se reporta aparte, sin tarifa inventada.

Para atribuir ahorro a una optimización, comparar baseline/variante sobre el mismo corpus, modelo/proveedor y alcance. Entre proveedores mostrar consumo nativo y cobertura sin sumar unidades incompatibles. Fallos o salidas vacías no fabrican ahorro. Si la contabilidad no permite una comparación homologable, declararla inconclusa en ese componente.

### Métricas y decisión

| Dimensión | Medida y límite de interpretación |
|---|---|
| Utilidad | Tiempo desde inicio de carga a resultado útil guardado/editable; separar primera utilidad de resultado completo |
| Fricción | Solicitudes iniciadas por planeación (0 o 1), necesidad, tiempo de respuesta y pendientes; una segunda incumple el contrato |
| Corrección | Cambios necesarios y gravedad, tiempo activo para completar la tarea; separar preferencias voluntarias y simulación de uso docente real |
| Calidad | Omisiones/invenciones, significado, unidad/grupo, relaciones, tablas/imágenes y referencias semánticamente correctas; esquema válido no prueba comprensión |
| Ambigüedad | Dudas materiales omitidas, preguntas innecesarias y falsos resueltos; una pendiente no cuenta como resuelta ni obliga a otra pregunta |
| Recuperación | Finalización, abandonos, fallos y recuperación; un estado técnico recuperable no equivale a tarea terminada |
| Operación | Tokens totales y coste completo por planeación y por tarea útil, latencia/variabilidad por etapa y estrato; mantener todos los denominadores |

Primero excluir candidatos que fallen invariantes de seguridad/producto o mínimos semánticos predefinidos. Errores críticos y pérdida de contenido esencial no se compensan con ahorro. Delimitar antes del ensayo la pequeña pérdida de precisión no crítica admisible.

Entre candidatos elegibles, el ahorro total de tokens tiene peso **20 %**. La distribución del **80 % restante**, fórmula/normalización y umbrales de calidad, latencia, corrección y presupuesto siguen pendientes: fijarlos antes del ensayo final, junto con su justificación. No se adopta una fórmula por defecto. Presentar métricas sin ponderar, coste separado y sensibilidad de la recomendación a pesos; no proclamar un ganador si falta evidencia o comparabilidad.

Preferir la solución más simple que reduzca esfuerzo y tiempo hasta utilidad dentro de calidad/presupuesto. Si ninguna cumple, identificar el estrato que falla y acotar/adaptar el alcance. Una segunda estrategia exige beneficio medido. El benchmark no reemplaza probar con personas del público objetivo antes de afirmar utilidad o ahorro docente reales.

## Entregas y límites de autorización

[T3](../tickets/T3-prototipo-flujo-automatico.md) registra la revisión previa, las comprobaciones observadas del prototipo sintético y su integración. La preparación offline de [T4](../tickets/T4-preparar-evaluacion.md) continúa; esas comprobaciones de agentes no acreditan validación docente. [T5](../tickets/T5-ensayo-interpretacion.md) depende de T4 y las autorizaciones aplicables. La integración posterior del método elegido conserva el mismo contrato UX, sin exponer etapas internas como aprobaciones.

Esta especificación no ejecuta ni aprueba servicios, gasto, transmisión de documentos, contacto con docentes, despliegue o trabajo en otro entorno. Los ensayos separados conservan su propia autorización y evidencia. El cierre global de H2, benchmark, piloto e integración del flujo real siguen pendientes.
