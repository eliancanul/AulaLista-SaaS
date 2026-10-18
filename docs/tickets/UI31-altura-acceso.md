# UI31: acceso en ventanas de poca altura

Candidato local, 2026-10-18. Base: `b461c0ffb8861553a2d1aabafebd04588ab336d2`.
Contrato técnico del corte vertical de [#31](https://github.com/eliancanul/AulaLista-SaaS/issues/31);
el estado del trabajo permanece en ese issue. No cierra la investigación de escala
general en Firefox/Safari.

Se recuperó el patch del 17 de octubre sobre `355399b6f01ea6985ebdb8389691fc532c993e5f`,
SHA-256 `decd85ae90d02736b0a414ad1c168ed8a4b0cbf2f5c9ef96114d09b990116941`.
La corrección CSS se aplica sin cambios sobre esta nueva base; las pruebas añaden
1366×768, fronteras responsive y ventanas pequeñas con scroll natural.
La revisión y pruebas históricas no certifican este candidato nuevo.

## Contrato

- Corregir el mínimo fijo de 960 px y el espacio superior fijo del acceso.
- Mantener fuentes, tamaños tipográficos, logo, colores y geometría de referencia
  del selector (420 px de ancho, y=360) en 1440×960.
- En ventanas desktop bajas, el acceso inicial con correo disponible debe caber
  sin scroll vertical; pie legal debajo del contenido y dentro de la ventana.
- Contenido adicional de errores o formularios puede requerir scroll: nunca
  superponer el pie ni recortar acciones para simular que cabe.
- Mantener reflow móvil, sin cambiar el inicio, zoom global, auth o servicios.

## Verificación y límites

Regresiones Playwright: referencia 1440×960; escritorio 1470×762, 1366×768,
1280×720 y 1024×768; fronteras 1200/1201 y 800/801; móvil 390×844;
ventanas 1280×400 y 320×568 con scroll permitido. Incluyen fallo de bootstrap,
validación de correo, acceso a documentos legales repetido con teclado y Google
simulado con correo deshabilitado. Los stubs sólo comprueban disposición;
no acreditan el widget Google real ni autenticación externa.

Validación local actual: 275 unitarias y comprobación TypeScript/build correctos;
64 recorridos Chromium correctos, incluidas las 25 pruebas nuevas. Se usó Chromium
Headless Shell 154.0.8037.57 de Debian oficial con sus recursos de la misma versión.
El Chromium completo abortaba antes de navegar por una restricción de socket Unix;
no se cambiaron permisos. La contraprueba actual sobre la base falla porque el pie
termina en y=898 a 1470×762; la misma prueba pasa con el candidato.

La [primera CI](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/39131653272)
del head `f5517631fe2bbd4f671df24983c5b0a4bd9db8a7` pasó 62/64 recorridos: dos
selectores de alerta históricos eran ambiguos al coexistir con el aviso de recuperación
añadido en main. Se acotaron al mensaje esperado, conservando todas las comprobaciones
geométricas y sin cambiar CSS. La nueva CI exacta y ratificación independiente se
registran en el PR; no reutilizar el resultado del head anterior.
El foco programático usado en dos pruebas no certifica tabulación/restauración completa.
Firefox/WebKit, widget Google real, teclado virtual y ampliación de texto siguen
fuera de lo acreditado; no se reintenta una descarga de navegador denegada.
