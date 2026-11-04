-- =====================================================================
--  Préstalo — Migración: Bloqueo de horarios + Aprobación de grupos
--  Correr UNA vez en Supabase → SQL Editor. Es idempotente (IF NOT EXISTS).
--  No borra datos. Requiere las tablas equipo, usuario, reserva.
-- =====================================================================

-- Bloqueo de horarios: periodos en que un equipo (o todos, si equipo_id es NULL)
-- no puede reservarse — mantención programada, feriados, eventos, etc.
CREATE TABLE IF NOT EXISTS bloqueo_horario (
  id            SERIAL PRIMARY KEY,
  equipo_id     INTEGER REFERENCES equipo(id) ON DELETE CASCADE,   -- NULL = aplica a todos los equipos
  fecha_inicio  TIMESTAMPTZ NOT NULL,
  fecha_fin     TIMESTAMPTZ NOT NULL,
  motivo        VARCHAR(200) NOT NULL,
  creado_por    VARCHAR(12) REFERENCES usuario(rut) ON DELETE SET NULL,
  entidad_id    INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_bloqueo_fechas CHECK (fecha_fin > fecha_inicio)
);
CREATE INDEX IF NOT EXISTS ix_bloqueo_equipo ON bloqueo_horario(equipo_id);
CREATE INDEX IF NOT EXISTS ix_bloqueo_rango  ON bloqueo_horario(fecha_inicio, fecha_fin);

-- Aprobación de grupos: estado de validación del grupo de una reserva grupal.
-- Valores: 'no_aplica' (reserva individual) | 'pendiente' | 'aprobado' | 'rechazado'
ALTER TABLE reserva ADD COLUMN IF NOT EXISTS grupo_estado VARCHAR(12) NOT NULL DEFAULT 'no_aplica';
CREATE INDEX IF NOT EXISTS ix_reserva_grupo_estado ON reserva(grupo_estado);
