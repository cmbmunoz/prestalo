-- =====================================================================
--  Préstalo — Migración: Solicitudes especiales con fechas y equipos
--  Correr UNA vez en Supabase → SQL Editor. Idempotente.
-- =====================================================================
ALTER TABLE solicitud_especial ADD COLUMN IF NOT EXISTS fecha_inicio TIMESTAMPTZ;
ALTER TABLE solicitud_especial ADD COLUMN IF NOT EXISTS fecha_fin    TIMESTAMPTZ;
ALTER TABLE solicitud_especial ADD COLUMN IF NOT EXISTS duracion     VARCHAR(40);

-- Equipos solicitados en una solicitud especial
CREATE TABLE IF NOT EXISTS solicitud_equipo (
  solicitud_id INTEGER NOT NULL REFERENCES solicitud_especial(id) ON DELETE CASCADE,
  equipo_id    INTEGER NOT NULL REFERENCES equipo(id)            ON DELETE CASCADE,
  PRIMARY KEY (solicitud_id, equipo_id)
);
CREATE INDEX IF NOT EXISTS ix_solicitud_equipo ON solicitud_equipo(solicitud_id);
