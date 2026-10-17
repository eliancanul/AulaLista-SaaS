# B1: autenticación y sesión personal

Base histórica: `1188050007df15ffac752f72b03915cc44112183`. Issue #13.
Google Identity Services directo + código de un uso por correo. El incremento
original no configuraba cuentas, cliente Google, credenciales ni envío real.
EmailSender no tiene implementación runtime. No hay identidad de desarrollo
seleccionable. Las pruebas sustituyen transporte/verificador, nunca actor.

La [aceptación manual del 17 de octubre de 2026](https://github.com/eliancanul/AulaLista-SaaS/issues/13#issuecomment-6231320343)
registra acceso Google, recarga y cierre/reentrada en el servicio de pruebas sobre
`355399b6f01ea6985ebdb8389691fc532c993e5f`. Es confirmación humana, no una prueba
instrumental de todos los criterios ni de despliegues posteriores. El usuario
pospuso el proveedor/envío real de OTP; permanece deshabilitado. No se declara
cierre integral de #13 ni vinculación de métodos.

## Contrato HTTP estable

Mismo origen. Todas las respuestas auth llevan `Cache-Control: no-store`.
JSON de errores: `{ "detail": "unauthorized|csrf_failed|unavailable|invalid_request|invalid_code|rate_limited" }`.
Cookie previa `__Host-acenta-pre` y sesión `__Host-acenta-session`: Secure,
HttpOnly, SameSite=Lax, Path=/, sin Domain. HTTPS en local o navegador que respete
cookies Secure en localhost; no se rebaja Secure mediante configuración.

- GET /auth/bootstrap →200 `{csrf_token, google_nonce, google_client_id, email_available}`.
  Crea/reutiliza pre-sesión de10min, sin autoridad; client_id es string o null,
  email_available boolean. Sin clave/origen de auth:503.
- POST /auth/google `{credential: string}` →200 sesión (abajo). Exige cookie
  previa, Origin exacto configurado y `X-CSRF-Token` de bootstrap. Token válido
  para cliente+nonce, identidad por issuer/sub. Consumo único de pre-sesión.
  Token inválido/replay:401; sin cliente/config:503; abuso:429.
- POST /auth/email/request `{email: string}` →202
  `{challenge_id: string, message: "Si el correo puede recibir mensajes, recibirás un código."}`.
  Mismas protecciones previas. Respuesta idéntica para correo nuevo/existente y
  límites por correo; desafío señuelo no verificable cuando limitado. Límite IP:429.
  Sin sender/config:503. No declara entrega efectiva. Email mal formado:422.
  Al emitir código nuevo extiende pre-sesión y su cookie para cubrir sus10min completos.
- POST /auth/email/verify `{challenge_id: string, code: string}` →200 sesión.
  Código exactamente8dígitos, desafío ligado a pre-sesión,10min y5intentos.
  Incorrecto/expirado/consumido:400 invalid_code; límite global:429.
- GET /auth/session →200 `{principal_id: UUID, scope_id: UUID, csrf_token: string, recovery_context_id: UUID | null}`;
  ausente/expirada/revocada:401. No incluye email ni token de sesión.
  Consultar estado no renueva inactividad; sólo operaciones privadas admitidas.
- POST /auth/logout (sin body) →204; exige sesión, Origin exacto y CSRF de sesión.
  Revoca servidor y borra ambas cookies. Sesión ausente/expirada:401.

Éxito de ambos logins devuelve el mismo JSON de sesión, rota/revoca sesión previa,
consume pre-sesión y borra cookie previa. CSRF de bootstrap nunca sirve para una
sesión. Todas las escrituras privadas existentes requieren Origin exacto y CSRF
de sesión. GET sólo requiere cookie. No usar localStorage para credenciales.

Sesión absoluta24h/inactividad2h; sólo hash del token256bits en DB. Autorización
se revalida y bloquea dentro de cada transacción privada, después de leer el body.
Una operación ya admitida puede terminar antes de que logout confirme; ninguna
operación nueva pasa después. No se bloquea fila mientras llega body/respuesta.

## Identidades y límites

No asociación automática por email. Google sub con correo nuevo conserva cuenta;
sub distinto con mismo correo es otra identidad. OTP crea identidad propia por
correo normalizado (dominio minúsculas, local-part preservado; no quitar puntos/plus).
Google y correo pueden producir cuentas separadas: vinculación explícita pendiente.
Nunca OTP de email de contacto Google concede acceso a esa cuenta Google.
Solicitud OTP no crea principal. Provisión de principal/ámbito idempotente por
identidad y consumo OTP+sesión atómicos. HMAC con clave servidor y contexto completo.
Reenvío invalida anteriores serializadamente. Límites PG compartidos con ventanas fijas por hora (cooldown de reenvío exacto):1envío/60s,
5/email/h,20/IP/h; verificación20/email/h,100/IP/h. No confiar X-Forwarded-For: los launchers desactivan proxy headers explícitamente.
El peer TCP es la única fuente de IP en este corte; proxies de producción quedan fuera.

Bootstrap y Google limitados por IP. Clave y contadores no registran email/IP en
claro. Los registros expirados requieren purga operativa futura: no hay cron nuevo.

## Disponibilidad y pendientes

Variables explícitas AULALISTA_AUTH_ORIGIN, AULALISTA_AUTH_HMAC_KEY (base64url de
al menos32bytes), AULALISTA_GOOGLE_CLIENT_ID opcional. Nunca cargar .env solo ni
buscar secretos. Ausencia total de auth mantiene privadas en401 y auth en503;
config parcial/inválida falla al arrancar. Google no depende de sender correo.
La clave de ejemplo es sólo marcador, nunca valor utilizable.

Pendientes: proveedor/envío real de correo expresamente pospuesto, vinculación
fresca de métodos y criterios restantes de #13. La configuración Google y su
prueba humana tienen el alcance y SHA registrados arriba; no certifican otra
instalación. Consentimiento marketing no existe ni se
infiere del login. No se envían campañas ni se piden scopes adicionales.


### Campo aditivo de recuperación B3

Migración0006 añade `auth_session.recovery_context_id UUID NULL`, UUIDv4 generado
sólo al crear sesión en finish, sin backfill/default/índice ni UPDATE runtime. GET
usa la fila ya validada. El ID no es secreto ni autoridad, cookie, CSRF o selector.
Sesiones legacy/null y clientes sin el campo conservan auth pero no respaldo.
La recuperación local sólo admite misma sesión confirmada; no atraviesa401/relogin.
La [decisión de fase 1](0003-edicion-durable.md#decisión-de-fase-1-recuperación-tras-sesión-inválida)
acepta conservar la purga ante 401 ambiguo y recuperar sólo trabajo confirmado
desde la biblioteca después del login. Los cambios nunca guardados pueden
perderse; su recuperación se aplaza como mejora posterior, sin cambio de runtime.
Ocultar la vista de acceso conserva formulario/desafío/OTP. Un login cuya respuesta
cruzó esa ocultación sólo abre el espacio tras otro GET de sesión al activar, incluso
si la respuesta llega después de volver; no repite login ni verifica otra vez el código.
Contrato de contenido/límites: [web/README](../../web/README.md#respaldo-temporal-de-edición-b3-15-corte-parcial).
