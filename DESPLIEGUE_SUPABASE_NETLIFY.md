# Publicar Préstalo en la nube — Supabase (base de datos) + Netlify (web + API)

Al terminar tendrás la **web y la API en una URL pública** `https://tu-sitio.netlify.app`
(accesible desde cualquier celular, en cualquier red) y la **base de datos en Supabase**.
La app iOS apuntará a esa misma URL.

> Yo no puedo crear tus cuentas de Supabase ni de Netlify (requieren tu registro).
> Todo lo demás ya está preparado en este proyecto: solo pegas SQL y cliqueas.

Arquitectura:
```
Celular / Web  ─►  Netlify (sitio público/public + API serverless /api)  ─►  Supabase (PostgreSQL)
```

---

## PARTE 1 — Base de datos en Supabase

1. Entra a **https://supabase.com** → crea cuenta → **New project**.
   - Nombre: `prestalo`. Define una **contraseña de base de datos** y **anótala**.
   - Elige región (ej. South America / São Paulo). Espera ~2 min a que se cree.

2. Menú izquierdo → **SQL Editor** → **New query**.
   - Abre el archivo `supabase/01_schema_supabase.sql`, **copia todo** y pégalo. **Run**.
   - Nueva query: pega `supabase/02_seed_supabase.sql` (datos demo + usuarios). **Run**.
   - (Opcional, RF-56 automático) Database → Extensions → habilita **pg_cron**; luego
     en SQL Editor pega `supabase/03_noshow_cron.sql` y **Run**.

3. Obtén la cadena de conexión: menú **Project Settings → Database → Connection string**
   → pestaña **URI**, modo **Transaction** (puerto 6543).
   Copia la URI; reemplaza `[YOUR-PASSWORD]` por la contraseña del paso 1. Queda algo así:
   ```
   postgresql://postgres.abcdefgh:TU_PASSWORD@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
   ```
   Guárdala: es tu `DATABASE_URL`.

---

## PARTE 2 — Publicar en Netlify (web + API)

Necesitas **Node.js** y la **Netlify CLI** en tu Mac:
```bash
npm install -g netlify-cli
```

1. Entra a la carpeta del backend (la que tiene `netlify.toml`):
```bash
cd ~/Downloads/prestalo_app
```
```bash
npm install
```

2. Inicia sesión en Netlify (abre el navegador):
```bash
netlify login
```

3. Crea el sitio y súbelo (primer deploy):
```bash
netlify deploy --build
```
- Elige **Create & configure a new site**, nombre `prestalo` (o el que quieras).
- Al terminar te da una **Draft URL**. Aún falta la variable de entorno (paso 4).

4. Configura la conexión a Supabase como variable de entorno:
```bash
netlify env:set DATABASE_URL "postgresql://postgres.abcdefgh:TU_PASSWORD@aws-0-sa-east-1.pooler.supabase.com:6543/postgres"
```
Y el secreto para los tokens (invéntate una cadena larga):
```bash
netlify env:set PRESTALO_SECRET "cambia-esto-por-una-cadena-larga-y-secreta"
```

**Correo de recuperación de contraseña (opcional pero recomendado):** para que el
enlace de "¿Olvidaste tu contraseña?" llegue por email real, configura un SMTP.
Con una cuenta Gmail y una **contraseña de aplicación** (Google → Seguridad →
Verificación en 2 pasos → Contraseñas de aplicaciones):
```bash
netlify env:set SMTP_HOST "smtp.gmail.com"
netlify env:set SMTP_PORT "465"
netlify env:set SMTP_USER "tucorreo@gmail.com"
netlify env:set SMTP_PASS "la-contraseña-de-aplicacion-de-16-letras"
netlify env:set MAIL_FROM "Préstalo <tucorreo@gmail.com>"
netlify env:set PUBLIC_URL "https://TU-SITIO.netlify.app"
```
Sin estas variables, la recuperación igual valida los datos pero **no envía**
el correo (modo simulación: registra el enlace en los logs de la función).

5. Publica a producción:
```bash
netlify deploy --build --prod
```
Te dará la **URL pública**: `https://TU-SITIO.netlify.app`.

6. Verifica: abre en el navegador `https://TU-SITIO.netlify.app` → debe cargar el login.
   Entra con `44.444.444-4` / `prestalo` (admin) y revisa el panel.

> Alternativa sin CLI: sube esta carpeta a un repositorio de GitHub y en Netlify
> **Add new site → Import from Git**. En **Site settings → Environment variables**
> agrega `DATABASE_URL` y `PRESTALO_SECRET`. Netlify detecta `netlify.toml` solo.

---

## PARTE 3 — Apuntar la app iOS a la URL pública

1. Edita `~/Developer/PrestaloiOS/Sources/Net/APIClient.swift`, la línea `baseURL`:
```swift
var baseURL = URL(string: "https://TU-SITIO.netlify.app")!
```
   (También puedes usar sed: `sed -i '' 's#https://TU-SITIO.netlify.app#https://tu-sitio-real.netlify.app#' Sources/Net/APIClient.swift`)

2. Como ahora es **HTTPS**, ya no necesitas la excepción de red; puedes dejarla, no afecta.

3. Recompila e instala en el iPhone:
```bash
cd ~/Developer/PrestaloiOS
xcodegen
xcodebuild -project Prestalo.xcodeproj -scheme Prestalo -configuration Debug -destination 'id=00008030-000114A81491402E' -derivedDataPath build DEVELOPMENT_TEAM=Y2JBMF33BX CODE_SIGN_STYLE=Automatic CODE_SIGNING_ALLOWED=YES -allowProvisioningUpdates build
```
```bash
xcrun devicectl device install app --device 00008030-000114A81491402E "build/Build/Products/Debug-iphoneos/Prestalo.app"
```

Ahora la app funciona **desde cualquier lugar** (Wi-Fi o datos móviles), porque ya no
depende de tu Mac: habla con Netlify, que habla con Supabase.

---

## Notas y solución de problemas
- **La web carga pero el login falla / "Error interno":** casi siempre es `DATABASE_URL`.
  Revísala (`netlify env:get DATABASE_URL`) y que la contraseña sea la correcta. Vuelve a
  `netlify deploy --build --prod` tras cambiarla.
- **Descarga de plantillas Excel:** el `netlify.toml` ya marca el tipo .xlsx como binario.
  Si una descarga llegara corrupta, dime y ajustamos `binary` en la función.
- **Subida de Excel (importar):** funciona vía la función; si un archivo grande fallara,
  usa archivos de pocas filas o lo pasamos a carga por lotes.
- **RF-56 (no-show):** en la nube no hay `setInterval`; por eso se programa con pg_cron en
  Supabase (`03_noshow_cron.sql`). Sin eso, las reservas no se expiran solas.
- **Seguridad:** cambia `PRESTALO_SECRET` y las claves demo antes de un uso real. Las claves
  demo (`prestalo`) ya vienen hasheadas en el seed; cámbialas desde la propia app o la base.
- **Build de Netlify falla al empaquetar la función:** en `netlify.toml` cambia
  `node_bundler = "esbuild"` por `node_bundler = "zisi"` y vuelve a desplegar.
