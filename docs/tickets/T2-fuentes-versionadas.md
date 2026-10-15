# T2: conservar una fuente sintética y sus versiones

Estado: pendiente. Dependencia: T1. Spec: [0001](../specs/0001-fundacion.md), que define autoridad, datos, idempotencia y límites.

## Resultado

HTTP guarda V1 del ámbito A, una nueva app/Session recupera sus bytes exactos, V2 no modifica V1 y B no puede acceder. El servidor sin overrides continúa devolviendo 401 a toda operación de materiales.

## Alcance mínimo completo

- Un módulo de materiales con crear fuente/V1, añadir versión propia, leer versión exacta y consultar recibo propio.
- Original sintético opaco de 1 a 65 536 bytes, hash y tamaño calculados por servidor; Source/SourceVersion con ámbitos coherentes.
- Autoridad en el caso de uso, no solamente en la ruta. Principales y ámbitos preparados directamente por fixtures.
- Escritura transaccional, recibo idempotente y concurrencia optimista. Inmutabilidad bajo el rol runtime previsto.
- Tests HTTP y PostgreSQL real en la CI existente; conexiones independientes para carreras.

Antes de implementar, fijar rutas, status/cuerpos de éxito y conflictos, representación de huella, presupuesto de lectura y protección de inmutabilidad en el ticket. Esas decisiones deben satisfacer la spec y ser verificables; no requieren un framework genérico.

## Aceptación adversarial

- T2.1 Persistencia: V1 se recarga byte por byte desde Session y app nuevas; hash, tamaño y actor corresponden al original guardado.
- T2.2 Historia: tras V2, V1 conserva bytes y metadatos; revisión actual y secuencia son coherentes.
- T2.3 Autoridad: B no lee, añade ni recupera recibos de A con IDs/claves conocidos; tampoco con ámbito manipulado. Recurso ajeno e inexistente son indistinguibles en respuesta.
- T2.4 Runtime: una app nueva sin overrides devuelve 401 en cada operación privada, incluso con headers inventados e IDs válidos. No hay bypass habilitable por configuración.
- T2.5 Reintento: simular pérdida de respuesta tras commit; misma solicitud/clave obtiene el recibo original sin duplicar, incluso después de avanzar la revisión.
- T2.6 Conflicto de clave: variar bytes, destino o revisión esperada con la misma clave devuelve 409 sin alterar estado.
- T2.7 Carrera: dos conexiones compiten por la misma revisión; exactamente una confirma. La otra recibe conflicto. Verificar estado final desde una tercera lectura.
- T2.8 Atomicidad: fallo controlado antes del commit deja cero efectos; reintento posterior puede confirmar una única vez.
- T2.9 Integridad: PostgreSQL rechaza referencia fuente–ámbito cruzada y número de versión duplicado; el rol runtime no actualiza ni elimina una versión confirmada.
- T2.10 Límites: rechazar cero bytes y 65 537; aceptar 1 y 65 536. Probar entrada sin tamaño declarado y cortar lectura acotada, sin estado parcial.
- T2.11 Privacidad: errores y logs no incluyen contenido, DSN, credenciales o stack traces públicos.
- T2.12 Evidencia: revisión independiente, pruebas esperadas y CI ejecutadas en candidato exacto con base revalidada; ningún skip se presenta como éxito.

## Fuera de alcance

Listados globales, búsqueda, parsing, PDF, OCR, interpretación, aceptación curricular, jornada, UI, identidad real, RLS y suscripción. No implementar almacenamiento contratado ni adapters vacíos.

## Recuperación y salida

Recrear DB de test y volver a ejecutar el recorrido con fixtures sintéticas. Este ensayo no acredita restauración de producción. T2 cierra el primer corte técnico sólo si pasan sus garantías completas; identidad y archivos reales quedan bloqueados por sus puertas posteriores.
