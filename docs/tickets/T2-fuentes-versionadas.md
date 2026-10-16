# T2: conservar una fuente sintética y sus versiones

Referencia técnica e historial del corte. Consulta [Issues y fuentes de verdad](README.md) para elegir trabajo y consultar su estado actual.

Integración histórica: integrado mediante PR #3, con revisión independiente/H1 y CI premerge/postmerge correctas. El recibo de integración al final registra el candidato. Dependencia: T1 integrado. Spec: [0001](../specs/0001-fundacion.md), que define autoridad, datos, idempotencia y límites.

## Resultado

HTTP guarda V1 del ámbito A, una nueva app/Session recupera sus bytes exactos, V2 no modifica V1 y B no puede acceder. El servidor sin overrides continúa devolviendo 401 a toda operación de materiales.

En T2, «versión confirmada» significa persistida mediante commit, no aceptada por el docente. Conservar fuentes y versiones es una garantía interna: no añade UI, interpretación ni aprobación docente y no elige la estrategia de [spec 0002](../specs/0002-flujo-automatico-material.md).

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

## Contrato fijado antes de implementar (2026-10-15 UTC)

Base T1: main `a8dc576f041ca7cf6fd755a54a5027280c4e4f75`,
[PR #2](https://github.com/eliancanul/AulaLista-SaaS/pull/2),
[CI postmerge success](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/38688115249).
Autor: agente `implementar_fuentes_versionadas`, directorio exclusivo
`aulalista-saas-sources`; integrador y revisión independiente separados.

- `POST /scopes/{scope_id}/sources`: cuerpo binario `application/octet-stream`,
  `Idempotency-Key` UUID; crea fuente/V1. Devuelve 201 y recibo JSON.
- `POST /scopes/{scope_id}/sources/{source_id}/versions?expected_version=N`:
  mismo cuerpo/clave, N entero positivo; 201 con recibo JSON.
- `GET /scopes/{scope_id}/sources/{source_id}/versions/{number}`: bytes exactos,
  200 octet-stream y headers `X-Source-Id`, `X-Version`, `X-Content-SHA256`,
  `X-Content-Size`, `X-Actor-Id`, `X-Created-At`, `X-Operation-Id`.
- `GET /scopes/{scope_id}/operations/{operation_id}`: 200 con el recibo original.
  El recibo contiene IDs de fuente/versión/ámbito/operación/actor, número, hash,
  tamaño y momento UTC. Repetir un POST confirmado conserva 201 y el mismo recibo,
  incluso cuando la fuente ya avanzó. No devuelve el contenido dentro del recibo.
- 401 sin actor autenticado; 404 idéntico para ámbito/fuente/versión/operación
  ajenos o ausentes; 409 `conflict` para reutilizar clave con solicitud distinta o
  revisión obsoleta; 413 exceso; 422 entrada inválida/vacía; 415 tipo incorrecto;
  503 `unavailable` ante fallo de persistencia. Upload interrumpido: 422 sin efectos.
  Errores sin input ni detalles DB.
  Ningún header, query ni configuración genera identidad: sólo overrides de test.
- Huella SHA-256 del prefijo ASCII `aulalista-source-request-v1` seguido de un
  byte NUL, seguido del JSON UTF-8
  compacto de `[kind, target, expected_version]`, un byte NUL y bytes completos.
  `kind` es `create` o `append`; target es null al crear o UUID canónico al añadir;
  expected_version es 0 al crear. El ámbito delimita la clave única en DB.
- Lectura HTTP incremental: máximo acumulado 65 536 bytes; Content-Length mayor
  se rechaza antes de leer. Transferencia sin longitud también corta al primer
  chunk que rebase el presupuesto, sin copiar/acumularlo. El tamaño de un chunk
  entregado por ASGI depende del servidor; la app no pide ni almacena un cuerpo
  completo ilimitado. Límite repetido en caso de uso y CHECK PostgreSQL.
- SourceVersion conserva el recibo. La transacción revalida propietario, serializa
  la misma clave por advisory lock transaccional (hash de ámbito/clave), comprueba
  replay antes de comparar revisión y aplica UPDATE condicional de revisión.
  Fuente, versión y recibo confirman juntos. No hay tabla/framework de trabajos.
- Inmutabilidad por triggers UPDATE/DELETE/TRUNCATE sobre versiones y permisos
  mínimos del rol runtime sin privilegios de owner/bypass; la app no usa el rol
  de migración. SQL directo verifica ambas defensas. No se promete RLS en T2.

Archivos previstos: módulo de materiales y rutas, migración 0002, registro de
modelos/revisión, instalación de rutas, tests materiales y actualización mínima
de CI/documentación/expectativas de esquema T1. Sin dependencias nuevas.


## Comprobaciones del autor (antes de integración)

- 114 pruebas pasaron: 43 API/config, 21 PostgreSQL heredadas y 50 de materiales;
  más un verificador obligatorio de logs reales de PostgreSQL.
- Python 3.12.14, uv 0.12.23 y PostgreSQL 17.11 real, cluster desechable exclusivo.
  Se usa el mismo lock de T1, sin dependencias nuevas. Instalación no editable.
- Los tests crean los dos actores directamente y arrancan cada app de materiales
  con `aulalista_runtime`, sin superuser/owner/membership/BYPASSRLS. El servidor
  real Uvicorn sin overrides conserva 401. Se comprueba también autorización
  llamando al caso de uso sin rutas.
- Carreras de dos conexiones (PIDs distintos): append con claves distintas,
  replay simultáneo y create simultáneo con misma clave/cuerpos iguales o distintos.
  Una tercera lectura confirma exactamente una nueva versión/fuente.
- Fallo diferido de PostgreSQL en COMMIT revierte fuente, avance y versión/recibo;
  retirar el fallo y repetir la clave confirma una sola vez. Pérdida real simulada
  del transporte de respuesta posterior al commit conserva un recibo recuperable.
- Límite probado con extremos, streaming sin longitud, longitud engañosa,
  interrupción y corte antes de pedir más chunks. Hash de bytes no UTF-8 verificado.
- El arranque documentado desactiva access logs de Uvicorn para no registrar
  URLs arbitrarias. El smoke arranca ese proceso, envía marcadores sintéticos en
  query/header/body y revisa sus logs. Configurar logging externo requiere su
  propia revisión; no se promete ocultar datos de un proxy fuera de esta app.
- Evidencia exacta local y manifiesto se entregaron separados del código. En ese
  corte, revisión independiente, H1 y CI del candidato final quedaban pendientes;
  los resultados locales no los sustituyeron. El cierre posterior figura al final.

## Decisiones coordinadas

`revisar_contrato_fuentes` revisó el contrato antes de congelar el candidato y pidió
hacer explícitos sanitización de validación, runtime distinto del owner y precedencia
clave/autoridad. Se incorporan los tres: autorización de scope primero, clave y
huella después, existencia del destino y CAS al final. Un destino distinto con
clave propia existente da 409 aunque ese destino no exista; un scope ajeno da 404
antes de consultar cualquier recibo. Esto no concede autoridad sobre el destino.

Hallazgo temprano H1: el revisor independiente reprodujo que `created_at.isoformat()`
variaba con timezone de sesión DB, alterando el recibo de un replay. Se normaliza
siempre a UTC y se añade regresión que cambia el rol a Asia/Tokyo entre apps;
verifica POST repetido, GET recibo y header de versión idénticos. En ese corte quedó
pendiente el reexamen independiente del manifiesto final; el autor no lo cerró
por sí mismo. El recibo posterior de integración consta al final.


Se acordó con el revisor fijar READ COMMITTED explícitamente en el engine. La
regresión con default del rol SERIALIZABLE produjo 503 en el perdedor tanto para
claves distintas como iguales, incumpliendo 409/replay. Con aislamiento explícito,
la misma prueba debe observar la versión confirmada y cumplir el contrato sin un
motor genérico de retries. Se reejecutan también todos los tests T1 del engine.


Se amplía sólo el provisionado desechable para T2.11: se confirmó que PostgreSQL
por omisión volcaba BYTEA sintético en DETAIL de CHECK fallidos. El inicializador
deshabilita detalle de filas, sentencias y parámetros en logs; el runtime no gana
permisos. La prueba produce un error real con marcador conocido y el workflow
inspecciona el log del contenedor sin publicarlo. Servidores/proxies externos
necesitan controles equivalentes; no se afirma seguridad de configuración ajena.

## Recibo de integración (2026-10-15 UTC)

El integrador confirmó T2 integrado mediante [PR #3](https://github.com/eliancanul/AulaLista-SaaS/pull/3), con revisión independiente/H1 y CI premerge satisfechas. Main: `b4dd71e2bca607f6b6cce04d77bec92db2fc7dba`; árbol `f69f92f36e265872ff7d23c952a4ea620fa8ce42`, igual al candidato `f2672d16c6de9c681514e639e7b2c2febe8b0138`. [CI premerge](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/38690972072): success, 114 pruebas. [CI postmerge](https://github.com/eliancanul/AulaLista-SaaS/actions/runs/38691499410): success sobre ese main, 114 pruebas y logs de PostgreSQL verificados, según el recibo posterior del integrador.

Este recibo cierra los pendientes de integración de T2 anteriores, sin atribuir ejecución de esas pruebas a la conciliación documental. H2, interpretación, documentos reales y piloto siguen pendientes.
