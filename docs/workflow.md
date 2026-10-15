# Workflow y evidencia

## Secuencia obligatoria

1. **Especificación.** Definir resultado, invariantes, no objetivos y errores observables. Cierre: cada criterio tiene una prueba o una comprobación humana explícita.
2. **Ticket pequeño.** Delimitar un comportamiento completo, dependencias, archivos/consumidores afectados y recuperación. Cierre: escritor y candidato identificados; las decisiones que bloquean ese comportamiento están resueltas.
3. **Pruebas e implementación.** Para lógica nueva, fijar primero el comportamiento; registrar fallo relevante cuando corresponda, cambio mínimo y resultado posterior. Cierre: éxito, negativas y fallos aplicables ejecutados; las omisiones se declaran.
4. **Revisión adversarial independiente.** Otro agente o persona inspecciona el candidato, intenta romper sus garantías y comunica casos reproducibles. Cierre: ningún hallazgo bloqueante abierto; correcciones reexaminadas. El autor no firma su propia revisión independiente.
5. **CI exacta.** Ejecutar checks del candidato final y revalidar su base. Cierre: head y base identificados, checks requeridos realmente ejecutados, resultados disponibles y sin cambios posteriores sin verificar.
6. **Integración.** Verificar autorización vigente y gates anteriores; sólo entonces integrar cuando esté autorizado. Si no hay autorización de merge, entregar un candidato revisado y pendiente de integración. Publicar un PR no equivale a aprobar su merge o despliegue.

La CI puede correr durante el desarrollo; el gate de aceptación es el del candidato final después de la revisión. Un nuevo commit invalida la evidencia anterior para las partes que cambia. Si cambia la base, revisar el diff y ejecutar las pruebas de integración pertinentes contra la nueva base antes de integrar.

## Coordinación directa

Consultores y codificadores se comunican directamente, incluidos desacuerdos y consultas de frontera. Registrar en ticket/PR toda decisión que cambie contrato, alcance, riesgo o prueba; avisar al coordinador. Mantener escritor único por archivo y revisión independiente. Una charla no sustituye una decisión trazable ni un resultado de prueba.

## Evidencia mínima de un candidato

- Ticket/spec y resultado que pretende cerrar.
- Repositorio, rama, SHA de head, SHA de base y diff revisado. Si todavía no hay commits: indicar «candidato local» y su manifiesto de hashes; no atribuirle una CI remota.
- Manifiesto de rutas nuevas/modificadas/retiradas y motivo; sin secretos, dumps o datos privados.
- Comandos exactos, entorno/versiones, código de salida, cantidad de tests y omisiones. Usar los comandos reales del proyecto; evitar una copia documental que diverja del workflow.
- Revisor, candidato revisado, casos intentados, hallazgos y resolución.
- URLs y conclusión de checks del SHA final. Un job omitido o no iniciado no es evidencia positiva.
- Migración, recuperación y límites conocidos aplicables.

## Publicación y seguridad

Revisar el diff completo antes de subirlo. Confirmar repositorio y alcance autorizados en la instrucción vigente; las reglas para otro repositorio no se trasladan implícitamente. Mantener secretos, archivos del entorno, dumps y datos docentes fuera del commit. No copiar material del repositorio anterior sin una razón y revisión explícitas.

Los workflows empiezan con permisos mínimos. Dar de alta credenciales, cambiar protección de rama, contratar servicios, publicar una app o introducir transmisiones a terceros no queda autorizado por añadir CI. Si se necesita un cambio de ese tipo, describirlo y obtener la autorización aplicable.

En un repositorio vacío puede no existir aún una base para PR. El responsable coordina el bootstrap y su autorización; no inventa un PR ni asegura que una revisión remota ya ocurrió. Registrar cualquier excepción técnica antes de modificar la rama por defecto.

## Consultas de producto

Aplicar [hitos de revisión](reviews/README.md) además de la revisión de código. Las consultas evalúan decisiones de producto y riesgos; la revisión adversarial intenta romper la implementación. Una no reemplaza a la otra.
