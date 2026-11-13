# Publicar Préstalo en Render (web + API) — URL pública fija y gratis

Render corre tu backend Express **tal cual**: un solo servicio sirve la web y la API,
y la rutina de no-show (RF-56) funciona sola porque el servicio queda vivo (no es serverless).
La base de datos sigue en **Supabase** (no cambia nada ahí).

Al terminar tendrás algo como: `https://prestalo.onrender.com`

> Nota del plan gratis: si nadie entra por ~15 min, el servicio se "duerme" y la primera
> visita después tarda ~30–50 s en despertar. Para un demo es suficiente.

---

## PARTE 1 — Base de datos (ya la tienes)

No hay que tocar Supabase. Reutilizas la **misma cadena de conexión del pooler**
que ya configuraste antes (la que empieza con `postgresql://postgres.jviabfedzrajcznkrcji:...@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`).
Tenla a mano: en Render la pegarás como `DATABASE_URL`.

Si por alguna razón las tablas no están cargadas, en Supabase → SQL Editor corre otra vez
`supabase/01_schema_supabase.sql` y luego `supabase/02_seed_supabase.sql`.

---

## PARTE 2 — Subir el código a GitHub

Render despliega desde un repositorio Git. Crea uno vacío en GitHub (botón **New repository**,
nombre `prestalo`, sin README) y luego, en la carpeta del backend, ejecuta estos comandos
**uno por uno** (reemplaza `TU-USUARIO` por tu usuario de GitHub):

```bash
cd ~/Downloads/prestalo_app
```
```bash
git init
```
```bash
git add .
```
```bash
git commit -m "Prestalo backend para Render"
```
```bash
git branch -M main
```
```bash
git remote add origin https://github.com/TU-USUARIO/prestalo.git
```
```bash
git push -u origin main
```

Si Git te pide usuario/clave, usa tu usuario de GitHub y un **token personal**
(GitHub → Settings → Developer settings → Personal access tokens → genera uno con permiso `repo`).

---

## PARTE 3 — Crear el servicio en Render

1. Entra a **https://render.com** → crea cuenta (puedes entrar con GitHub) → **New → Blueprint**.
2. Conecta tu GitHub y elige el repo `prestalo`. Render detecta el archivo `render.yaml`
   y propone un servicio web llamado **prestalo** (build `npm install`, start `node server.js`).
3. Antes de crear, te pedirá el valor de **DATABASE_URL** (quedó marcado como "se ingresa a mano"):
   pega la cadena del pooler de Supabase. `PRESTALO_SECRET` se genera solo.
4. **Create / Apply**. Render instala e inicia el servicio (2–4 min). Al terminar te da la URL pública.

> Alternativa sin Blueprint: **New → Web Service** → eliges el repo →
> Runtime `Node`, Build `npm install`, Start `node server.js`, y en **Environment**
> agregas `DATABASE_URL` (pooler de Supabase) y `PRESTALO_SECRET` (una cadena larga tuya).

### (Opcional) Correo real de recuperación
En el servicio → **Environment** agrega, cuando quieras activar el envío de correos:
```
SMTP_HOST = smtp.gmail.com
SMTP_PORT = 465
SMTP_USER = tucorreo@gmail.com
SMTP_PASS = (contraseña de aplicación de 16 letras de Google)
MAIL_FROM = Préstalo <tucorreo@gmail.com>
PUBLIC_URL = https://prestalo.onrender.com
```
Sin esto, la recuperación valida los datos pero no envía el correo (modo simulación en los logs).

### (Opcional) Asistente de IA en la app
Para activar el botón flotante de chat (consultas sobre Préstalo y la normativa del pañol),
agrega en **Environment** la clave de Anthropic:
```
ANTHROPIC_API_KEY = sk-ant-...   (tu API key de console.anthropic.com)
```
Opcionales: `ASISTENTE_MODEL` (por defecto `claude-haiku-5-5`) y `ASISTENTE_MAX_TOKENS` (700).
Sin `ANTHROPIC_API_KEY`, el botón aparece pero el asistente responde que falta configurarla.

---

## PARTE 4 — Verificar

1. Abre `https://TU-SERVICIO.onrender.com` → debe cargar el login de Préstalo.
2. Prueba la API directo: `https://TU-SERVICIO.onrender.com/api/categorias` → debe devolver JSON (no un error).
3. Entra con un usuario demo, por ejemplo **44.444.444-4 / prestalo** (admin) y revisa el panel.

Si `/api/categorias` muestra `{"error":"Error interno", ...}`, mira los **Logs** del servicio en Render:
- `connect` / `getaddrinfo` / `password` → revisa `DATABASE_URL` (que sea el pooler y la clave correcta).
- `relation ... does not exist` → faltó correr el esquema/seed en Supabase (Parte 1).

---

## PARTE 5 — Dejar la app DEMO en el iPhone (nativa, por cable)

> Importante: el código Swift no se puede compilar en este entorno (es Linux). Todo este
> paso se hace en tu **Mac con Xcode**. El código está sin verificar aquí.

1. Apunta la app a tu URL de Render. Edita `~/Developer/PrestaloiOS/Sources/Net/APIClient.swift`,
   la línea `baseURL`, y déjala así (con tu URL real):
```swift
var baseURL = URL(string: "https://TU-SERVICIO.onrender.com")!
```
   O con sed (reemplaza la URL real):
```bash
cd ~/Developer/PrestaloiOS
```
```bash
sed -i '' 's#https://TU-SITIO.netlify.app#https://TU-SERVICIO.onrender.com#' Sources/Net/APIClient.swift
```

2. Genera el proyecto y compila contra el iPhone conectado por cable (desbloqueado y con Modo
   Desarrollador activado). Usa tu Team y el id de tu iPhone:
```bash
xcodegen
```
```bash
xcodebuild -project Prestalo.xcodeproj -scheme Prestalo -configuration Debug -destination 'id=00008030-000114A81491402E' -derivedDataPath build DEVELOPMENT_TEAM=Y2JBMF33BX CODE_SIGN_STYLE=Automatic CODE_SIGNING_ALLOWED=YES -allowProvisioningUpdates build
```
```bash
xcrun devicectl device install app --device 00008030-000114A81491402E "build/Build/Products/Debug-iphoneos/Prestalo.app"
```

3. En el iPhone, la primera vez: Ajustes → General → VPN y gestión de dispositivos →
   confía en tu perfil de desarrollador. Abre la app y entra con un usuario demo.

Como ahora el backend es HTTPS (Render), la app funciona **desde cualquier lugar** (Wi-Fi o datos),
sin depender de tu Mac.

> Si `xcodebuild` o `devicectl` dan error, mándame las últimas líneas y lo resolvemos.
> El id `00008030-000114A81491402E` y el Team `Y2JBMF33BX` son los que veníamos usando;
> si cambiaste de iPhone, obtén el nuevo id con `xcrun devicectl list devices`.
