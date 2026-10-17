# Preparación de demo Acenta en Render

Estado: adaptación de código y guía para una **futura demo**. Este documento no
acredita un despliegue, una DB aprovisionada ni un login real con Google.
No crea servicios, credenciales, accesos ni suscripciones. La activación requiere
su autorización y comprobaciones propias; publicar o integrar este código no la
sustituye. No habilita un piloto con documentos docentes reales ni producción.

## Arquitectura y alcance

Un servicio web Python sirve API y build de UI desde **el mismo origen HTTPS**.
`scripts/build-render.sh` compila `web` e incorpora el bundle a la wheel instalada
no editable. No se ejecuta Vite como servidor público, ni se necesita un segundo
sitio estático, CORS abierto o cookies entre dominios. El build no migra ni
necesita credenciales de base de datos. PostgreSQL conserva estado; el filesystem
local no es almacenamiento de materiales, identidades o sesiones.

El arranque conserva `--no-proxy-headers`: no confía en `X-Forwarded-For` ni
`Forwarded`. La dirección usada por los límites por IP es el peer TCP inmediato;
detrás de Render puede representar un proxy compartido y **no identifica al
visitante**. Se mantiene además el límite global de autenticación persistido en
PostgreSQL, independiente de IP y proceso: 120 solicitudes agregadas por minuto
(ventanas fijas) entre bootstrap, Google y OTP. Cada intento consume presupuesto
antes de CSRF/payload/proveedor, incluso si acaba rechazado. Las cuotas previas por
peer/correo siguen aplicándose. Sesión, logout y health no consumen este presupuesto. El cap limita admisiones, no consultas PG: incluso rechazos actualizan el
contador y no constituye una defensa total L7/DoS. Usuarios de la demo pueden competir
por los mismos límites y recibir 429. No anunciar protección individual por IP
ni resolver 429 confiando en headers arbitrarios. Abrir una política de proxy
confiable sería otro cambio con revisión y pruebas.

El contenido de materiales sigue siendo sintético. Un login Google real procesa
identidad real (identificador del proveedor y correo verificado), aunque los
materiales sean ficticios; requiere autorización de ese uso y de sus destinos.
No subir archivos de alumnos, nombres de menores, expedientes o documentos reales.
OTP por correo no tiene proveedor runtime: debe seguir indisponible, sin prometer
entrega de códigos. No se añaden parsing, IA, pagos o vinculación de identidades.

## Plantilla deliberadamente inactiva

[deploy/render.example.yaml](../deploy/render.example.yaml) es una referencia,
fuera de `render.yaml` raíz. No seleccionarla en Render ni copiarla al archivo
activo antes de autorizar la creación y el despliegue. Define `plan: free`
explícito, `autoDeployTrigger: "off"` y ningún recurso PostgreSQL ni hook de
migración. `off` desactiva los despliegues automáticos posteriores: **no impide
que crear/sincronizar un Blueprint aprovisione recursos o inicie un primer deploy**.
No usar un nombre que coincida con un servicio existente sin revisar el destino.
La sintaxis y la semántica de los campos están en la
[referencia oficial Blueprint](https://render.com/docs/blueprint-spec).

El runtime nativo incluye Node/npm para compilar la UI; se fijan Python 3.12.14,
uv 0.12.23 y la rama Node 24. Node 24 permite actualizaciones de parche: registrar
la versión efectiva en cada validación, sin atribuir reproducibilidad binaria a
ese pin de versión mayor. Fuentes: [herramientas nativas](https://render.com/docs/native-runtimes),
[Python y uv](https://render.com/docs/python-version),
[selección de Node](https://render.com/docs/node-version).

Comandos de referencia desde la raíz (el build instala dependencias; no desplegar):

```sh
bash scripts/build-render.sh
# Sólo tras configurar un entorno autorizado y su DB runtime:
.venv/bin/python -m uvicorn aulalista_api.app:create_app --factory \
  --host 0.0.0.0 --port "$PORT" --no-access-log --no-proxy-headers
```

Render proporciona `PORT`; no cambiarlo por un puerto reservado. Para pruebas
locales definir un puerto local y enlazar `127.0.0.1` en vez de exponer la máquina.
`/health/live` sólo comprueba el proceso; `/health/ready`, utilizado por la
plantilla, exige DB accesible y revisión de esquema esperada.

## Configuración posterior, sólo con autorización

Las variables `sync: false` carecen de valor en Git. No pegar secretos en PRs,
logs, capturas, comandos compartidos o este documento. No incluirlos en el bundle
web ni usar variables `VITE_*` para secretos. El servidor no carga `.env` solo.

- `AULALISTA_DATABASE_URL`: DSN **del rol runtime**, con driver
  `postgresql+psycopg`, usuario, host y DB explícitos. Una URL entregada por el
  proveedor con otro prefijo debe adaptarse, preservando componentes y escapado.
  Sólo se admite `sslmode` como parámetro; para conexión externa exigir TLS y
  validar el modo/certificado según el proveedor. No rebajar TLS para superar
  un error de conexión. Nunca usar el dueño de migraciones como runtime.
- `AULALISTA_AUTH_ORIGIN`: origen HTTPS público exacto de UI y API, sin path ni
  barra final. No comodines ni origen local en una demo pública.
- `AULALISTA_AUTH_HMAC_KEY`: clave base64url de al menos 32 bytes, aprovisionada
  por un flujo seguro autorizado. No generar ni configurar una por seguir esta
  guía sin esa autorización. Su rotación requiere plan de invalidación de sesiones.
- `AULALISTA_GOOGLE_CLIENT_ID`: cliente web autorizado, coincidente con el
  configurado en Google; es identificador público, no client secret. La app lo
  obtiene en bootstrap. No necesita almacenar un secreto OAuth de cliente.
- `AULALISTA_DOCS_ENABLED=false` y `AULALISTA_DB_TIMEOUT_SECONDS=3` conservan
  documentación HTTP cerrada y el plazo de comprobación de DB.

Sin configuración auth se mantiene acceso privado cerrado; configuración parcial
o inválida debe fallar. Conservar cookies Secure, HttpOnly y host-only, CSRF y
comprobación exacta de Origin. No convertir errores de configuración en login
simulado ni introducir actores de test en el artefacto público.

### PostgreSQL: preparación separada

Antes del primer arranque, decidir y autorizar proveedor, región, duración, coste,
acceso y retirada. La plantilla no selecciona ni crea una DB automáticamente.
Desde un entorno administrativo autorizado, ejecutar las migraciones con el dueño
del esquema y comprobar `alembic current`. Aplicar al rol runtime los grants
mínimos de [desarrollo](development.md), revisados contra las migraciones del SHA
que se desplegará. Esas instrucciones contienen una DB local desechable: **no
copiar su autenticación trust ni ejecutar el reset de tests contra una DB remota**.

No pasar el DSN dueño al servicio, a su build o a su start. No arrancar con
migraciones automáticas. Verificar que runtime no es owner/superuser, no posee
BYPASSRLS ni membresías privilegiadas y conserva sólo los privilegios requeridos.
Después de migrar, probar readiness y autorización bajo ese rol. Auditar logging
de PostgreSQL y plataforma antes de identidad real: desactivar access log en
Uvicorn no controla los logs de Render, proxies ni errores SQL del proveedor.

Los registros auth expirados todavía requieren una política operativa de purga;
esta preparación no crea cron ni concede DELETE al runtime. Definir duración
breve, seguimiento de capacidad y retirada autorizada de los datos de la demo.
No usar downgrade para recuperar datos: puede destruir identidades e historia.

### Google: comprobación real pendiente

El administrador debe autorizar y configurar un proyecto/cliente de tipo web,
branding/consentimiento y el origen HTTPS final en **Authorized JavaScript
origins**. Seguir la [guía oficial GIS](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
Este flujo usa callback JavaScript y POST same-origin, no un endpoint inventado de
redirección OAuth. No añadir scopes de Gmail/Drive ni permisos ajenos al login.
Verificar requisitos de publicación/usuarios de prueba para la audiencia elegida.

Tras autorización, comprobar con una cuenta acordada: bootstrap, Google, creación
del ámbito personal, sesión, guardar/reabrir un material sintético y logout.
Probar errores de nonce, CSRF y origen, y aislamiento con dos identidades distintas.
No guardar tokens, cookies ni correos reales en evidencia; registrar resultado,
SHA y fecha. Una prueba con verificador sustituido no acredita login externo.

## Límites del plan gratuito

Revisión documental: 2026-10-17 UTC. Revalidar antes de activar:

- Web free duerme tras 15 minutos sin tráfico; despertar tarda aproximadamente
  un minuto. Hay 750 horas mensuales compartidas por workspace.
- Filesystem efímero; sin disco persistente, SSH/shell ni one-off jobs en web free.
- PostgreSQL free: una instancia por workspace, 1 GB, caducidad a los 30 días;
  después hay 14 días para actualizar antes de borrado. Sin backups gestionados.
- Bandwidth y builds consumen cuotas. Con método de pago pueden generar cargos
  adicionales; sin él pueden suspenderse servicios o builds. Un límite de gasto
  de builds no debe interpretarse como garantía universal de coste cero.

Fuente: [Render Free](https://render.com/docs/free). `plan: free` no garantiza una
demo gratuita indefinida. Antes de activar, revisar uso existente, facturación,
fecha de expiración y un plan de retirada; cualquier ampliación de pago requiere
su autorización. No programar pings para evitar el reposo.

## Gates antes de anunciar una demo disponible

1. Revisión independiente aprobada y CI correcta del SHA exacto; build wheel/UI
   y pruebas sin secretos, fixtures o entradas de navegador de tests publicadas.
2. Autorización de creación, credenciales/accesos y despliegue; proveedor/plan,
   cuenta, destino, uso de identidad y límites de coste confirmados.
3. Migración y grants verificados; HTTPS y origen final configurados; readiness
   200, rutas privadas 401 sin sesión y UI servida desde la wheel.
4. Google real y aislamiento probados; OTP indisponible; material sintético;
   logging revisado y evidencia redactada sin datos personales.
5. Registrar URL realmente comprobada, SHA desplegado, límites conocidos,
   responsable de retirada y fecha de caducidad. No afirmar estos gates como
   cumplidos por disponer de la plantilla o por pasar pruebas locales.
