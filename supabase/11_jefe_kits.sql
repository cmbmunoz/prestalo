-- =====================================================================
--  Pañol 2.0 — Build v20 · Migración 11
--  (1) Rol Jefe de Pañol  (2) Kits de equipos por asignatura (por modelo)
--  IMPORTANTE: el ADD VALUE del enum va SOLO, sin usar el nuevo valor en la
--  misma transacción (ver 12_seed_jefe_kits.sql para la carga demo).
-- =====================================================================
SET search_path TO public;

-- (1) Nuevo rol operativo intermedio ---------------------------------
ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'jefe_panol';

-- (2) Kits por asignatura --------------------------------------------
-- El kit se asocia a una asignatura y se compone POR MODELO (categoría +
-- nombre + modelo + marca) con una cantidad; al reservarlo se asignan
-- unidades disponibles de cada modelo en la sede.
ALTER TABLE kit ADD COLUMN IF NOT EXISTS asignatura_id INTEGER REFERENCES asignatura(id) ON DELETE CASCADE;
ALTER TABLE kit ADD COLUMN IF NOT EXISTS entidad_id    INTEGER REFERENCES entidad(id)    ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS kit_item (
    id           SERIAL PRIMARY KEY,
    kit_id       INTEGER NOT NULL REFERENCES kit(id) ON DELETE CASCADE,
    categoria_id INTEGER NOT NULL REFERENCES categoria(id) ON DELETE RESTRICT,
    nombre       VARCHAR(160) NOT NULL,     -- nombre del equipo (modelo legible)
    modelo       VARCHAR(120),
    marca        VARCHAR(120),
    cantidad     INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0)
);

CREATE INDEX IF NOT EXISTS ix_kit_asignatura ON kit(asignatura_id);
CREATE INDEX IF NOT EXISTS ix_kit_item_kit   ON kit_item(kit_id);
