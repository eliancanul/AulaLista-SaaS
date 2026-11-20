# Guía rápida: Local sin seguridad → Render con Google OAuth + Epson L3250

## 1) Probar primero en local (sin seguridad / sin Google OAuth)

1. Copia la plantilla local y pon tu `OPENAI_API_KEY` y tus datos de Gmail SMTP:
   ```bash
   cp .env.local.example .env.local
   ```
2. Inicia PostgreSQL, migraciones, build de `web/` y el servidor local:
   ```bash
   bash scripts/dev-local.sh
   ```
3. Abre `http://127.0.0.1:8010` (entra automáticamente como docente local):
   - Ve a **Impresora** → guarda el correo de tu Epson (`xxx@print.epsonconnect.com`) → pulsa **"Enviar hoja de prueba"**.
   - Ve a **Anexos** → genera un anexo con IA (`gpt-6-luna`) → edita → pulsa **"Aprobar para imprimir"** → descarga PDF o elige **Imprimir ahora** / **Programar impresión**.

---

## 2) Configurar Gmail SMTP + Epson Email Print (sin comprar dominio)

1. En tu cuenta de Gmail, activa la verificación en 2 pasos y crea una **Contraseña de aplicación** (`https://myaccount.google.com/apppasswords`).
2. Usa esa contraseña de 16 caracteres en `SMTP_PASSWORD` (con `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=tu-correo@gmail.com`, `PRINT_FROM_EMAIL=tu-correo@gmail.com`).
3. En **Epson Connect** (`https://www.epsonconnect.com`):
   - Obtén el correo de tu Epson L3250 (`...@print.epsonconnect.com`).
   - Agrega `PRINT_FROM_EMAIL` en **Approved Senders List (Lista de remitentes aprobados)**.
   - Recomendado: desactiva la opción de imprimir el cuerpo del correo (aunque AulaLista ya envía cuerpo vacío + únicamente el PDF adjunto).

---

## 3) Despliegue mínimo usable en Render (HTTPS + Google OAuth para 2 docentes)

1. **Base de datos PostgreSQL:** crea una DB gratuita en Neon o Render y copia su URL en formato:
   `postgresql+psycopg://usuario:password@host/dbname?sslmode=require`
2. **Google OAuth:** en Google Cloud Console → *Credentials* → *OAuth 2.0 Client ID (Web)*:
   - Agrega tu URL de Render (ej. `https://aulalista-docentes.onrender.com`) en **Authorized JavaScript origins**.
   - Copia el `Client ID` (`...apps.googleusercontent.com`) en `AULALISTA_GOOGLE_CLIENT_ID`.
3. **Servicio Web en Render:** usa la configuración de `deploy/render.example.yaml`:
   - `AULALISTA_AUTH_ORIGIN`: `https://tu-app.onrender.com` (sin `/` final).
   - `AULALISTA_AUTH_HMAC_KEY`: genera una clave segura con:
     ```bash
     python3 -c "import os, base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
     ```
   - `AULALISTA_ALLOWED_EMAILS`: los 2 correos de Gmail de tus papás separados por coma (`mama@gmail.com,papa@gmail.com`).
   - `OPENAI_API_KEY` y `OPENAI_MODEL=gpt-6-luna`.
   - Variables `SMTP_*` + `PRINT_FROM_EMAIL`.
   - `AULALISTA_PRINT_CRON_SECRET`: cadena aleatoria larga.
4. **Trabajos programados si usas Render Free (que se duerme por inactividad):**
   - Si tu servicio en Render entra en suspensión, configura un cron gratuito externo (ej. cron-job.org cada 5 min) haciendo `POST https://tu-app.onrender.com/internal/print-jobs/dispatch` con header `X-Print-Cron-Secret: <tu-secreto>`.
   - El despacho usa `SELECT ... FOR UPDATE SKIP LOCKED`, por lo que nunca duplica impresiones.
