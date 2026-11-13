# Préstalo — Aplicación web (Node + Express + PostgreSQL)

App de gestión de préstamo e inventario de equipos, conectada a la base de
datos del modelo entidad-relación v2. Login por perfil con validaciones y
restricciones de la normativa UST-IPST 2018 aplicadas en el servidor.

> El modelo **white-label (multi-entidad) está oculto** en la interfaz: la app
> opera sobre una entidad fija (Préstalo). La tabla `entidad` existe en la base
> pero no se expone ni se puede conmutar desde la UI.

## Requisitos
- Node.js 18+ y PostgreSQL 14+.

## Puesta en marcha
```bash
# 1) Crear la base (una vez)
createdb prestalo_db

# 2) Instalar dependencias
npm install

# 3) Cargar schema + datos demo + claves
node setup.js

# 4) Levantar el servidor
npm start           # o: node server.js
# Abrir http://localhost:3000
```
Variables de entorno opcionales: `PGHOST`, `PGUSER`, `PGDATABASE`, `PGPORT`, `PORT`, `PRESTALO_SECRET`.

## Usuarios demo (clave: `prestalo`)
| RUT | Perfil |
|---|---|
| 11.111.111-1 | Alumno |
| 22.222.222-2 | Docente |
| 33.333.333-3 | Pañolero |
| 44.444.444-4 | Administrador |

## Funcionalidades por perfil
- **Alumno / Docente:** catálogo filtrado por **elegibilidad** de su asignatura (RF-54), ficha, **reserva** con declaración de uso académico (RF-55), **reserva grupal** con integrantes (RF-52), **recintos** con 72 h + autorización (RF-51/53), mis reservas, consultas WhatsApp.
- **Pañolero:** agenda de entregas, **check-out** con verificación de QR, **recepción de devoluciones** (en naranja), con registro de condición; daño ⇒ **bloqueo por reposición** + sanción (RF-59).
- **Administrador:** panel de KPIs, inventario (alta y cambio de estado), **autorización multinivel** de recintos (Jefatura → DAO), gestión de **sanciones**, usuarios.

## Validaciones y restricciones (server-side)
- Autenticación por RUT + clave (hash scrypt) y **control de acceso por rol** (RBAC) en cada endpoint.
- RF-55 declaración de uso académico obligatoria · RF-54 elegibilidad equipo×asignatura · RF-57/58 **sanción vigente bloquea** la reserva · RF-51/53 recintos: 72 h + autorización Jefatura/DAO · RF-52 reserva grupal · RF-59 daño ⇒ reposición.
- Integridad reforzada además por CHECK/FK en la base (ver `db/01_schema.sql`).

## Estructura
```
server.js      API + reglas de negocio
db.js          conexión PostgreSQL (schema prestalo)
auth.js        hash de clave (scrypt) y token HMAC
public/        frontend (index.html, app.js, styles.css)
db/            01_schema.sql, 02_seed.sql
setup.js       inicializador de base
```

## Nota sobre la app móvil (iOS)
Esta API es la misma que consumiría la app nativa iOS (SwiftUI). El cliente web
incluido sirve como panel operativo y como referencia de los flujos.

## Novedades v2 (añadidas)
- **RF-56 — expiración por no-show:** rutina automática (cada 5 min) que expira reservas con atraso > 1 h sin justificación y libera el equipo. Justificar: `POST /api/reservas/:id/justificar`. Forzar manual (admin): `POST /api/admin/run-noshow`.
- **RF-61 — chatbot WhatsApp:** motor que responde desde los datos reales y la normativa (`whatsapp.js`); chat en la pestaña *Consultas*. Webhook compatible con Meta: `GET/POST /webhook/whatsapp`. El envío real requiere `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` y `WHATSAPP_VERIFY_TOKEN` (WhatsApp Business API); sin esas variables opera en modo simulación (registra, no envía).
