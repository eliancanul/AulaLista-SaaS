# Impresión de una Planeación guiada confirmada

Corte pequeño de Plan2 sobre el recorrido de [#52](https://github.com/eliancanul/AulaLista-SaaS/issues/52).
No depende de apartados analíticos ni amplía los contratos de generación.

## Resultado e invariantes

Desde el lector de una Planeación guiada se ofrece **Imprimir**. La ayuda explica
que abre el diálogo del navegador y permite guardar como PDF si éste lo ofrece;
no anuncia una descarga automática ni un resultado de impresión exitoso.

La entrada es el `PlanningDocument` confirmado que recibe el lector, identificado
por `receipt.revision_id`. Cada clic captura ese documento completo. No consulta
`latest`, no usa el buffer del editor y no guarda, copia ni regenera. Un borrador
(`planning-draft-v1`) no entra en la proyección imprimible. Cambiar de revisión o
desmontar el lector retira cualquier preparación anterior.

El documento separado contiene la marca Acenta, número de revisión y estado
confirmado, título completo, asignatura, grado, duración, propósito, actividades
con tiempos, materiales, evaluación y datos/procedencia manuales conservados.
Incluye el aviso original de fixture y mantiene explícita la ausencia curricular.
No añade respuestas, claves docentes, diagnósticos ni atribución oficial. Una
referencia adjunta se indica con su versión, sin reinterpretar su contenido.

No se proyectan los identificadores internos ni datos de cuenta del recibo.
Todo contenido se renderiza como texto mediante React, sin HTML interpolado.
La impresión usa un documento aislado: navegación, editor, botones, otros
documentos y mensajes de la interfaz no forman parte de él.

## Presentación y ciclo de vida

- Papel Carta vertical, márgenes de 0.6 pulgadas, fondo blanco, texto oscuro,
  marca pequeña en escala de grises y sin superficies de color.
- Encabezados unidos al texto siguiente; párrafos largos pueden ocupar varias
  páginas, con viudas/huérfanas controladas y palabras extensas ajustadas al ancho.
  Se conservan saltos de línea y no se trunca ni reduce el contenido para encajarlo.
- Se espera a que la marca esté decodificada antes de invocar la impresión.
- Cancelar/cerrar permite volver a imprimir y devuelve el foco al botón. No se
  deduce si se imprimió a partir de `afterprint` o del retorno de `print()`.
- Si la preparación o la llamada falla, se muestra un error recuperable y se
  conserva la revisión. La impresión no cambia los controles móviles Secciones/Editar.
- Se reutilizan React, el logo y el navegador; no se incorpora dependencia PDF,
  servicio, credencial ni transmisión externa.

Los ajustes del sistema de impresión (impresora, escala, encabezados/pies y
destino PDF) pertenecen al navegador. La salida Carta es el tamaño solicitado
por CSS, verificable en un PDF real con `preferCSSPageSize`.

## Referencia de flujo

La [guía oficial de Teachy](https://www.teachy.com.br/pt-BR/teachy-help-center/ferramentas-ia/como-criar-um-plano-de-aula-completo-com-ia-na-teachy),
consultada el 18 de octubre de 2026 y actualizada el 18 de septiembre de 2026,
describe la descarga desde el resultado: crea un PDF como material descargable.
Se reutiliza esa ubicación de la acción. El diálogo nativo, Carta y la revisión
exacta son decisiones propias de Acenta, no capacidades atribuidas a Teachy.
La consulta documental no requirió cuenta, créditos ni nuevas generaciones.

## Evidencia requerida

Pruebas de revisión elegida frente a revisión posterior y borrador; ausencia de
mutaciones y llamadas de guardado/generación; texto malicioso literal; cancelación,
repetición, errores y limpieza; reflow y foco. Generar un PDF real multipágina,
extraer su texto para comprobar continuidad/ausencias e inspeccionar sus páginas.
Separar el diálogo simulado del navegador de la evidencia PDF real y declarar
los navegadores efectivamente verificados. PR y CI acreditan el candidato exacto.

No cierra Hoja de actividades + clave docente, Plan2 completo, generación libre,
validación curricular ni producción. No implica merge o despliegue.
