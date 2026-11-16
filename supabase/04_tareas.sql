-- =====================================================================
--  Préstalo — Migración: Módulo de Tareas (flujo académico)
--  Correr UNA vez en Supabase → SQL Editor. Es idempotente (IF NOT EXISTS).
--  No borra datos. Requiere las tablas asignatura, equipo, reserva, usuario.
-- =====================================================================

-- Tarea creada por el docente para una asignatura/sección
CREATE TABLE IF NOT EXISTS tarea (
  id            SERIAL PRIMARY KEY,
  asignatura_id INTEGER NOT NULL REFERENCES asignatura(id) ON DELETE CASCADE,
  docente_rut   VARCHAR(12) REFERENCES usuario(rut) ON DELETE SET NULL,
  titulo        VARCHAR(200) NOT NULL,
  descripcion   TEXT,
  fecha_inicio  TIMESTAMPTZ NOT NULL,
  fecha_fin     TIMESTAMPTZ NOT NULL,
  tipo          VARCHAR(12) NOT NULL DEFAULT 'individual' CHECK (tipo IN ('individual','grupal')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_tarea_fechas CHECK (fecha_fin > fecha_inicio)
);
CREATE INDEX IF NOT EXISTS ix_tarea_asignatura ON tarea(asignatura_id);

-- Equipos habilitados para una tarea (los que el alumno puede reservar dentro de ella)
CREATE TABLE IF NOT EXISTS tarea_equipo (
  tarea_id  INTEGER NOT NULL REFERENCES tarea(id)  ON DELETE CASCADE,
  equipo_id INTEGER NOT NULL REFERENCES equipo(id) ON DELETE CASCADE,
  PRIMARY KEY (tarea_id, equipo_id)
);

-- Enlace opcional de una reserva a la tarea dentro de la que se hizo
ALTER TABLE reserva ADD COLUMN IF NOT EXISTS tarea_id INTEGER REFERENCES tarea(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_reserva_tarea ON reserva(tarea_id);
