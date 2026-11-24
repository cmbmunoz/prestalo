// =====================================================================
//  Pañol 2.0 — Migración idempotente al arranque.
//  Agrega columnas/valores nuevos SIN romper si ya existen. Cada sentencia
//  corre aislada: si una falla (p. ej. permisos), se registra y continúa.
//  Observaciones del comité (nov-2026): ventanas y bloques horarios por
//  sede, estado «en_revision» + liberación, tasa de uso, exclusividad por
//  carrera y campos de notificación.
// =====================================================================
const db = require('./db');

const STEPS = [
  // Estado de equipo «en_revision» (posterior a la devolución)
  `ALTER TYPE estado_equipo ADD VALUE IF NOT EXISTS 'en_revision'`,
  // Equipo: liberación post-revisión, tasa de uso y carrera propietaria
  `ALTER TABLE equipo ADD COLUMN IF NOT EXISTS fecha_fin_revision TIMESTAMPTZ`,
  `ALTER TABLE equipo ADD COLUMN IF NOT EXISTS usos_acumulados INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE equipo ADD COLUMN IF NOT EXISTS carrera_id INTEGER`,
  // Entidad (sede): ventanas horarias, bloque, revisión y evidencia
  `ALTER TABLE entidad ADD COLUMN IF NOT EXISTS ventana_diurna_ini  TIME DEFAULT '08:00'`,
  `ALTER TABLE entidad ADD COLUMN IF NOT EXISTS ventana_diurna_fin  TIME DEFAULT '18:35'`,
  `ALTER TABLE entidad ADD COLUMN IF NOT EXISTS ventana_vesp_ini    TIME DEFAULT '18:40'`,
  `ALTER TABLE entidad ADD COLUMN IF NOT EXISTS ventana_vesp_fin    TIME DEFAULT '22:00'`,
  `ALTER TABLE entidad ADD COLUMN IF NOT EXISTS bloque_minutos      INTEGER DEFAULT 30`,
  `ALTER TABLE entidad ADD COLUMN IF NOT EXISTS minutos_revision    INTEGER DEFAULT 60`,
  `ALTER TABLE entidad ADD COLUMN IF NOT EXISTS evidencia_entrega    BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE entidad ADD COLUMN IF NOT EXISTS evidencia_devolucion BOOLEAN DEFAULT FALSE`,
  // Notificación: tipo y estado de envío (log; el envío real se activa con SMTP)
  `ALTER TABLE notificacion ADD COLUMN IF NOT EXISTS tipo   VARCHAR(30)`,
  `ALTER TABLE notificacion ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'pendiente'`,
];

async function migrate() {
  for (const sql of STEPS) {
    try {
      await db.query(sql);
    } catch (e) {
      // 42710/42701/duplicate ⇒ ya aplicado; otros ⇒ log y continuar
      console.log(`[migrate] omitido (${e.code || '?'}): ${sql.slice(0, 60)}…`);
    }
  }
  console.log('[migrate] listo');
}

module.exports = { migrate };
